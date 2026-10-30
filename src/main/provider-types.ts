export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: Record<string, unknown>
  /**
   * Set when the provider returned a tool call whose raw `arguments` string could not be parsed
   * as JSON (common with smaller OSS models). The tool loop feeds this error back to the model as
   * the tool result so it can self-correct, instead of silently invoking the tool with `{}`.
   */
  argsError?: string
}

export interface ProviderUsage {
  inputTokens: number
  outputTokens: number
}

import type { Citation } from '../shared/citations'

export interface ProviderNonStreamResult {
  content: string | null
  toolCalls: ToolCallResult[]
  finishReason?: string
  model?: string
  usage?: ProviderUsage
  citations?: Citation[]
}

export type ToolChoice = 'auto' | 'required' | 'none'
