import type { CatalogModel } from '../shared/types'
import { parseOutputTokenSetting, type OutputTokenSetting } from '../shared/output-budget'
import type { ProviderMessage } from './provider-core-types'
import type { ToolDefinition } from './provider-types'
import { debugLog } from './debug-mode'
import { fallbackContextWindow } from './context-compression'
import { estimateToolRequestTokens, toolLoopInputBudget, trimToolLoopContext } from './tool-loop-context'

export interface ResolvedOutputBudget {
  mode: 'automatic' | 'manual'
  source: 'default' | 'automatic-setting' | 'manual-setting'
  initialTokens: number
  retryTokens: number
  modelCeiling: number
  contextWindow: number
}

const DEEPSEEK_MODELS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'])

export function resolveOutputBudget(options: {
  provider: string
  model: string
  setting?: OutputTokenSetting
  thinkingEffort?: string
  catalog?: CatalogModel[]
  /** System instructions, current user task, and tool schemas that compaction must retain. */
  minimumInputTokens?: number
}): ResolvedOutputBudget {
  const { provider, model, thinkingEffort } = options
  const setting = parseOutputTokenSetting(options.setting)
  // A same-named model at another provider must not supply this endpoint's limits.
  const entry = options.catalog?.find((m) => m.id === model && (m.provider === provider ||
    (!m.provider && m.vendor.toLowerCase() === provider)))
  const deepseek = provider === 'deepseek' && DEEPSEEK_MODELS.has(model)
  // DeepSeek defaults and ceiling: https://api-docs.deepseek.com/api/create-chat-completion/
  const documentedCeiling = deepseek ? 393_216 : undefined
  const positive = (value: number | undefined) => value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined
  const modelCeiling = Math.min(positive(entry?.maxOutputTokens) ?? documentedCeiling ?? 16_384, documentedCeiling ?? Infinity)
  const contextWindow = positive(entry?.contextWindow) ?? (deepseek ? 1_000_000 : model.toLowerCase().includes('deepseek') ? 32_768 : fallbackContextWindow(model)) ?? 32_768
  const availableContext = Math.floor(contextWindow * 0.9) - 512 - Math.max(1, Math.ceil(options.minimumInputTokens ?? 1))
  if (availableContext < 1) throw new Error('The current task and system instructions exceed the model context budget. Shorten the message or use a model with a larger context window.')
  const ceiling = Math.min(modelCeiling, availableContext)
  const automatic = deepseek ? thinkingEffort === 'disabled' ? 8_192 : thinkingEffort === 'max' ? 131_072 : 65_536 : 4_096
  const initialTokens = Math.min(setting === 'auto' ? automatic : setting, ceiling)
  return {
    mode: setting === 'auto' ? 'automatic' : 'manual',
    source: setting === 'auto' ? options.setting === undefined ? 'default' : 'automatic-setting' : 'manual-setting',
    initialTokens,
    retryTokens: setting === 'auto' ? Math.min(initialTokens * 2, ceiling) : initialTokens,
    modelCeiling,
    contextWindow,
  }
}

export function providerFinishReason(error: unknown): string | undefined {
  return error instanceof Error ? (error as Error & { finishReason?: string }).finishReason : undefined
}

/** One instance per chat turn, shared by ordinary rounds and both finalisation paths. */
export class OutputBudgetRecovery {
  private recovered = false
  private completedTools = 0
  private attemptedBudgets: number[] = []
  tokens: number

  constructor(private readonly options: {
    budget: ResolvedOutputBudget
    provider: string
    model: string
    hasVisibleText: () => boolean
    assertActive: () => void
    onRetry: (tokens: number) => void
  }) {
    this.tokens = options.budget.initialTokens
  }

  recordToolCompletion(): void { this.completedTools++ }

  async run<T>(
    messages: ProviderMessage[], tools: ToolDefinition[],
    send: (messages: ProviderMessage[]) => Promise<T>,
    onMessages?: (messages: ProviderMessage[]) => void,
    currentTask?: ProviderMessage,
  ): Promise<T> {
    const task = currentTask ?? [...messages].reverse().find((m) => m.role === 'user')
    const prepare = (tokens: number) => trimToolLoopContext(messages, tools,
      toolLoopInputBudget({ contextWindow: this.options.budget.contextWindow, maxOutputTokens: tokens }), task)
    let prepared = prepare(this.tokens)
    for (;;) {
      this.options.assertActive()
      onMessages?.(prepared)
      this.attemptedBudgets.push(this.tokens)
      this.log('request', prepared, tools)
      try {
        const result = await send(prepared)
        this.log(this.recovered ? 'success-after-recovery' : 'success', prepared, tools)
        return result
      } catch (error) {
        const reason = providerFinishReason(error)
        this.log('failure', prepared, tools, reason)
        if (reason !== 'length') throw error
        this.options.assertActive()
        let blocked: string | undefined
        if (this.options.hasVisibleText()) blocked = 'Answer text is already visible; it was retained without retrying.'
        else if (this.options.budget.mode === 'manual') blocked = 'The manual output limit is a hard limit; Automatic recovery is disabled.'
        else if (this.recovered) blocked = 'The one Automatic budget recovery for this turn has been exhausted.'
        else if (this.options.budget.retryTokens <= this.tokens) blocked = 'The model output or context ceiling prevents a larger budget.'
        if (!blocked) {
          try { prepared = prepare(this.options.budget.retryTokens) } catch {
            blocked = 'The current task and system instructions cannot fit the context window with a larger output reserve.'
          }
        }
        if (blocked) {
          this.log('recovery-blocked', prepared, tools, reason)
          const rejected = (error as Error & { rejectedToolCallCount?: number }).rejectedToolCallCount ?? 0
          throw Object.assign(new Error(`The model reached its output token limit (${this.tokens} tokens). ${blocked} Completed tools earlier in this turn: ${this.completedTools}. Tool calls rejected in the failed response: ${rejected}; none were executed.`, { cause: error }), {
            finishReason: reason, rejectedToolCallCount: rejected,
          })
        }
        this.recovered = true
        this.tokens = this.options.budget.retryTokens
        this.options.assertActive()
        this.options.onRetry(this.tokens)
        this.log('retry', prepared, tools, reason)
      }
    }
  }

  private log(outcome: string, messages: ProviderMessage[], tools: ToolDefinition[], finishReason?: string): void {
    debugLog('output-budget', JSON.stringify({
      provider: this.options.provider, model: this.options.model, mode: this.options.budget.mode,
      source: this.options.budget.source, budget: this.tokens, attemptedBudgets: this.attemptedBudgets,
      estimatedInputTokens: estimateToolRequestTokens(messages, tools), finishReason,
      outcome, completedTools: this.completedTools,
    }))
  }
}
