import type { ProviderMessage } from './provider-core-types'
import type { ToolDefinition } from './provider-types'
import { estimateInputTokens } from '../shared/token-estimate'
import type { OutputBudgetRecovery } from './output-budget'
import { continuationText } from '../shared/conversation-continuity'

export interface ToolLoopOptions {
  contextWindow?: number
  maxOutputTokens?: number
  onHistory?: (messages: ProviderMessage[]) => void
  outputRecovery?: OutputBudgetRecovery
  compact?: (messages: ProviderMessage[], tools: ToolDefinition[], budget: number, task: ProviderMessage | undefined) => Promise<ProviderMessage[]>
  onInterrupted?: () => void
}

export const FINAL_ANSWER_INSTRUCTION = 'Tool use has ended for this turn. This overrides earlier instructions to continue calling tools. Answer the latest user task now using only the results already collected. Do not request tools, output tool-call markup, or promise further investigation. If evidence is incomplete, state what was established and what remains unknown.'

export function toolLoopInputBudget(options: ToolLoopOptions): number {
  const window = options.contextWindow ?? 32_768
  const output = options.maxOutputTokens ?? 8_192
  // Leave headroom for tokenizer differences and the terminal instruction.
  return Math.max(0, Math.floor(window * 0.9) - output - 512)
}

export function estimateToolRequestTokens(messages: ProviderMessage[], tools: ToolDefinition[]): number {
  // Includes reasoning, tool arguments, schemas, images, and message framing.
  return estimateInputTokens(messages) + estimateInputTokens(tools)
}

/** Drop whole turns/exchanges, preserving system instructions and the actual current task. */
export function trimToolLoopContext(
  messages: ProviderMessage[], tools: ToolDefinition[], budget: number, task: ProviderMessage | undefined,
): ProviderMessage[] {
  if (estimateToolRequestTokens(messages, tools) <= budget) return messages
  const systems = messages.filter((m) => m.role === 'system')
  const groups: ProviderMessage[][] = []
  let inCurrentTurn = false
  for (const message of messages) {
    if (message === task) inCurrentTurn = true
    if (message.role === 'system') continue
    if (message.role === 'tool') {
      const group = groups.at(-1)
      const assistant = group?.slice().reverse().find((m) => m.role === 'assistant')
      if (assistant?.role === 'assistant' && assistant.tool_calls?.some((c) => c.id === message.tool_call_id)) group!.push(message)
      continue
    }
    if (message.role === 'user' || message === task || groups.length === 0 || groups.at(-1)!.includes(task!)) {
      groups.push([message])
    } else if (inCurrentTurn && message.role === 'assistant' && message.tool_calls?.length) {
      groups.push([message])
    } else {
      groups.at(-1)!.push(message)
    }
  }
  const notice: ProviderMessage = { role: 'user', content: '[Older conversation exchanges were omitted to fit the context window. Continue from the retained task and results; do not assume omitted actions succeeded.]' }
  const build = () => [...systems, ...groups.flat()]
  // Omit oldest groups first, including whole assistant/tool batches.
  while (estimateToolRequestTokens([...build(), notice], tools) > budget) {
    const index = groups.findIndex((group) => !group.includes(task!))
    if (index < 0) throw new Error('The current task and system instructions exceed the model context budget. Shorten the message or use a model with a larger context window.')
    groups.splice(index, 1)
  }
  return [...build(), notice]
}

/** Summarize the omitted prefix while retaining valid tool batches and the current task. */
export async function compactToolLoopContext(
  messages: ProviderMessage[], tools: ToolDefinition[], budget: number, task: ProviderMessage | undefined,
  generate?: (prompt: string) => Promise<string>,
): Promise<ProviderMessage[]> {
  if (estimateToolRequestTokens(messages, tools) <= budget) return messages
  const summaryTokens = Math.min(1536, Math.floor(budget * 0.2))
  let retained: ProviderMessage[]
  try { retained = trimToolLoopContext(messages, tools, budget - summaryTokens - 64, task) }
  catch { return trimToolLoopContext(messages, tools, budget, task) }
  const kept = new Set(retained)
  const omitted = messages.filter((message) => message.role !== 'system' && !kept.has(message))
  if (!omitted.length) return retained
  const transcript = continuationText(omitted)
  let summary = omitted.map((message) => continuationText([message]).slice(0, 400)).join('\n').slice(0, summaryTokens * 3)
  if (generate) {
    try {
      let rolling = ''
      for (let offset = 0; offset < transcript.length; offset += 16000) {
        const text = await generate(`Summarize this older exchange for continuation without tools. Preserve goals, constraints, decisions, factual findings, changed files, test outcomes, unresolved questions and next actions. Do not infer success. Return JSON arrays under goals, constraints, decisions, filesTouched, commandsRun, openQuestions, nextActions, recentContextNotes. Limit output to ${summaryTokens * 3} characters.\nPrevious summary:\n${rolling}\nNext chronological segment:\n${transcript.slice(offset, offset + 16000)}`)
        const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.values(parsed).every((value) => Array.isArray(value) && value.every((item) => typeof item === 'string')) || text.length > summaryTokens * 3) throw new Error('Invalid summary')
        rolling = text
      }
      if (rolling) summary = rolling
    } catch { /* Retain the bounded deterministic result. */ }
  }
  const notice: ProviderMessage = { role: 'user', content: `[Earlier exchange summary]\n${summary}` }
  const systemEnd = retained[0]?.role === 'system' ? 1 : 0
  const result = [...retained.slice(0, systemEnd), notice, ...retained.slice(systemEnd)]
  return estimateToolRequestTokens(result, tools) <= budget ? result : retained
}
