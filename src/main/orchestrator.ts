import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getAgentConfig } from './agents'
import type { ToolDefinition } from './provider-types'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getProviderCredential,
  streamProviderMessage,
  sendProviderWithTools,
  type MessageContent,
  type ProviderMessage,
  type ProviderName
} from './providers'
import { broadcastToMobile } from './ws-server'
import { startActivity, endActivity } from './activity-tracker'
import { runAgentTurn } from './agent-turn-runner'

export const MAX_DELEGATION_DEPTH = 5

export interface OrchestratorAgent {
  agentId: string
  agentName: string
  agentIcon: string
  isPrimary: boolean
  sortOrder: number
}

export interface TeamActivityStep {
  stepId: string
  agentId: string
  agentName: string
  agentIcon: string
  task: string
  status: 'delegating' | 'done' | 'error'
  result?: string
  durationMs?: number
}

export interface OrchestratorOptions {
  projectId: string
  projectName: string
  leaderAgentId: string
  teamAgents: OrchestratorAgent[]
  conversationId: string
  window?: BrowserWindow
  selectedModel: string
  generationOptions: { temperature: number; maxTokens: number }
  maxDelegationDepth?: number
  showActivity?: boolean
}

const DELEGATE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'delegate_to_agent',
    description:
      'Forward a sub-task to a team member specialist agent and receive their result before continuing.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The exact agent ID of the team member to delegate to.'
        },
        task: {
          type: 'string',
          description: 'A clear, self-contained description of the sub-task for the specialist.'
        },
        context: {
          type: 'string',
          description: 'Optional extra context to pass to the specialist.'
        }
      },
      required: ['agent_id', 'task']
    }
  }
}

function buildTeamManifest(teamAgents: OrchestratorAgent[], projectName: string): string {
  const nonLeaders = teamAgents.filter((a) => !a.isPrimary)
  if (nonLeaders.length === 0) return ''

  const lines = nonLeaders.map((a) => {
    const cfg = getAgentConfig(a.agentId)
    const desc = typeof cfg?.systemPrompt === 'string'
      ? cfg.systemPrompt.split('\n')[0].slice(0, 120)
      : 'General purpose agent'
    return `- agent_id: "${a.agentId}", name: "${a.agentName}" (${a.agentIcon}): ${desc}`
  })

  return (
    `\n\n## Team Leadership — Project "${projectName}"\n` +
    `You are the lead agent for this project. You have access to the following specialists via the delegate_to_agent tool:\n` +
    lines.join('\n') +
    `\n\nGuidelines:\n` +
    `- Use delegate_to_agent to assign sub-tasks to the most appropriate specialist.\n` +
    `- You MUST call delegate_to_agent rather than describing what you would do — never narrate a delegation without calling the tool.\n` +
    `- After receiving all specialist results, synthesize them into one final answer for the user.\n` +
    `- Do NOT delegate the same task twice.\n` +
    `- If the task is trivial and no specialist adds value, you may answer directly without delegating.`
  )
}

/**
 * Stream the leader's final answer using the appropriate provider.
 * Routes to the correct streaming function based on provider.
 */
async function callLeaderStreaming(
  provider: ProviderName,
  credential: import('./credential-vault').ProviderCredentialInput | null,
  model: string,
  window: BrowserWindow | undefined,
  messages: ProviderMessage[],
  conversationId: string,
  generationOptions: { temperature: number; maxTokens: number }
): Promise<string> {
  if (!credential) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }

  const onChunk = (chunk: string) => window?.webContents.send('chat:stream-response', chunk)
  return streamProviderMessage(provider, credential, model, messages, conversationId, onChunk, generationOptions)
}

/**
 * Call a specialist agent using its configured provider, with one retry if no output was emitted.
 * Uses a per-step request ID to allow parallel specialist calls without request tracking collisions.
 * Thin wrapper over the shared runAgentTurn primitive (agent-turn-runner.ts), which also backs the
 * automated workflow executor's per-step agent calls.
 */
async function callSpecialist(
  agentId: string,
  projectId: string,
  fallbackModel: string,
  taskContent: string,
  stepId: string,
  window: BrowserWindow | undefined,
  conversationId: string,
  generationOptions: { temperature: number; maxTokens: number }
): Promise<string> {
  return runAgentTurn({
    agentId,
    projectId,
    conversationId,
    fallbackModel,
    taskContent,
    // Per-step request ID to avoid collision when multiple specialists run in parallel
    requestId: `${conversationId}:${stepId}`,
    generationOptions,
    onChunk: (chunk) => window?.webContents.send('chat:team-step-stream', { stepId, chunk }),
  })
}

/**
 *
 * Returns the final response text and the list of delegation steps that occurred.
 * The final response is also streamed to the window via chat:stream-response events.
 */
export async function runOrchestration(
  opts: OrchestratorOptions,
  userContent: MessageContent,
  historyMessages: ProviderMessage[]
): Promise<{ finalContent: string; teamActivity: TeamActivityStep[] }> {
  const {
    projectName,
    leaderAgentId,
    teamAgents,
    window,
    selectedModel,
    generationOptions,
    maxDelegationDepth = MAX_DELEGATION_DEPTH
  } = opts

  // Resolve the leader's provider and model
  const leaderModel = selectedModel !== 'default' ? selectedModel : DEFAULT_PROVIDER_MODEL
  const { provider: leaderProvider, model: resolvedLeaderModel } = getProviderForAgent(leaderModel)
  const leaderCredential = getProviderCredential(leaderProvider, {
    projectId: opts.projectId,
    agentId: leaderAgentId,
    conversationId: opts.conversationId,
  })

  const leaderCfg = getAgentConfig(leaderAgentId)
  const leaderSystemPrompt =
    typeof leaderCfg?.systemPrompt === 'string' ? leaderCfg.systemPrompt : undefined

  const teamManifest = buildTeamManifest(teamAgents, projectName)

  const teamActivitySteps: TeamActivityStep[] = []

  const loopMessages: ProviderMessage[] = [
    {
      role: 'system' as const,
      content: leaderSystemPrompt
        ? `${leaderSystemPrompt}${teamManifest}`
        : `You are an AI programming assistant.${teamManifest}`
    },
    ...historyMessages,
    { role: 'user' as const, content: userContent }
  ]

  const memberIds = new Set(teamAgents.filter((a) => !a.isPrimary).map((a) => a.agentId))

  // Only OpenAI and Anthropic reliably support tool_choice='required'; other providers
  // (OpenRouter, Groq, Mistral, etc.) may reject it — use 'auto' for them instead.
  const supportsRequiredToolChoice = leaderProvider === 'openai' || leaderProvider === 'anthropic'

  for (let depth = 0; depth < maxDelegationDepth; depth++) {
    // On the first pass, nudge the model to call the delegate tool if specialists exist.
    // Subsequent passes use 'auto' so the model can finalise without forcing another delegation.
    const toolChoice = (depth === 0 && memberIds.size > 0 && supportsRequiredToolChoice) ? 'required' : 'auto'
    const result = await sendProviderWithTools(
      leaderProvider,
      leaderCredential,
      resolvedLeaderModel,
      loopMessages,
      memberIds.size > 0 ? [DELEGATE_TOOL] : [],
      toolChoice,
      generationOptions
    )

    // No tool calls — leader produced final answer; stream it character by character
    if (result.toolCalls.length === 0) {
      const finalContent = result.content ?? ''
      for (const char of finalContent) {
        window?.webContents.send('chat:stream-response', char)
      }
      window?.webContents.send('chat:stream-response', null)
      return { finalContent, teamActivity: teamActivitySteps }
    }

    // Validate and categorise tool calls into valid delegations and error results
    const validCalls: typeof result.toolCalls = []
    const errorResults: Array<{ id: string; error: string }> = []

    for (const call of result.toolCalls) {
      const args = call.arguments as Record<string, unknown>
      const agentId = typeof args.agent_id === 'string' ? args.agent_id : null
      const task = typeof args.task === 'string' && args.task.trim() ? args.task : null

      if (call.name !== 'delegate_to_agent' || !agentId || !task) {
        errorResults.push({ id: call.id, error: 'Invalid tool call: missing or malformed agent_id/task.' })
        continue
      }
      if (!memberIds.has(agentId)) {
        const known = teamAgents.find((a) => a.agentId === agentId)
        errorResults.push({
          id: call.id,
          error: known
            ? `Error: Cannot delegate to the primary leader agent "${agentId}".`
            : `Error: Unknown agent_id "${agentId}". Please choose from the listed team members.`
        })
        continue
      }
      validCalls.push(call)
    }

    // Run all valid specialist calls concurrently
    const parallelResults = await Promise.all(validCalls.map(async (call) => {
      const { agent_id: targetAgentId, task, context } = call.arguments as {
        agent_id: string; task: string; context?: string
      }
      const targetAgent = teamAgents.find((a) => a.agentId === targetAgentId)!
      const stepId = randomUUID()
      const step: TeamActivityStep = {
        stepId,
        agentId: targetAgentId,
        agentName: targetAgent.agentName,
        agentIcon: targetAgent.agentIcon,
        task: String(task).slice(0, 500),
        status: 'delegating'
      }
      teamActivitySteps.push(step)
      window?.webContents.send('chat:team-activity', { ...step })
      broadcastToMobile({ event: 'chat:team-activity', data: { conversationId: opts.conversationId, ...step } })
      const activityId = `orchestration:${stepId}`
      startActivity({ id: activityId, kind: 'orchestration', label: `Delegating to ${targetAgent.agentName}…`, conversationId: opts.conversationId })

      const taskContent = context ? `${task}\n\nContext:\n${context}` : task
      const delegateStart = Date.now()
      let specialistResult: string
      try {
        specialistResult = await callSpecialist(
          targetAgentId, opts.projectId, resolvedLeaderModel, taskContent, stepId, window, opts.conversationId, generationOptions
        )
        step.status = 'done'
        step.result = specialistResult
      } catch (err) {
        specialistResult = `Specialist agent error: ${(err as Error).message}`
        step.status = 'error'
        step.result = specialistResult
      }
      endActivity(activityId)
      step.durationMs = Date.now() - delegateStart
      window?.webContents.send('chat:team-activity', { ...step })
      broadcastToMobile({ event: 'chat:team-activity', data: { conversationId: opts.conversationId, ...step } })
      return { call, result: specialistResult }
    }))

    // Append ONE assistant message with ALL tool calls (preserving original order),
    // then one tool result per call in the same order
    loopMessages.push({
      role: 'assistant' as const,
      content: null,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      }))
    })
    for (const call of result.toolCalls) {
      const pr = parallelResults.find((r) => r.call.id === call.id)
      const er = errorResults.find((e) => e.id === call.id)
      loopMessages.push({
        role: 'tool' as const,
        tool_call_id: call.id,
        content: pr ? pr.result : (er ? er.error : '')
      })
    }
  }

  // Depth cap reached — stream a final answer from the leader using its configured provider
  const finalResult = await callLeaderStreaming(
    leaderProvider,
    leaderCredential,
    resolvedLeaderModel,
    window,
    [
      ...loopMessages,
      {
        role: 'user' as const,
        content: 'You have reached the maximum delegation depth. Please provide your final answer now based on all gathered information.'
      }
    ],
    opts.conversationId,
    generationOptions
  )
  window?.webContents.send('chat:stream-response', null)
  return { finalContent: finalResult, teamActivity: teamActivitySteps }
}
