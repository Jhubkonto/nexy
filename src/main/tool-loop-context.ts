import type { ProviderMessage } from './provider-core-types'
import type { ToolDefinition } from './provider-types'
import { estimateInputTokens } from '../shared/token-estimate'
import type { OutputBudgetRecovery } from './output-budget'

export interface ToolLoopOptions {
  contextWindow?: number
  maxOutputTokens?: number
  onHistory?: (messages: ProviderMessage[]) => void
  outputRecovery?: OutputBudgetRecovery
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
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'tool') {
      const group = groups.at(-1)
      const assistant = group?.slice().reverse().find((m) => m.role === 'assistant')
      if (assistant?.role === 'assistant' && assistant.tool_calls?.some((c) => c.id === message.tool_call_id)) group!.push(message)
      continue
    }
    if (message.role === 'user' || message === task || groups.length === 0 || groups.at(-1)!.includes(task!)) {
      groups.push([message])
    } else if (message.role === 'assistant' && message.tool_calls?.length) {
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
