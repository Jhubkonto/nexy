import { describe, expect, it, vi } from 'vitest'
import { parseOutputTokenSetting } from '../../shared/output-budget'
import { OutputBudgetRecovery, resolveOutputBudget } from '../output-budget'
import type { ProviderMessage } from '../provider-core-types'

vi.mock('../debug-mode', () => ({ debugLog: vi.fn() }))

describe('output token settings', () => {
  it.each([undefined, null, '', 'auto', 'invalid', '123junk', '1.5', -1, 0, Infinity, NaN])('defaults %s to Automatic', (setting) => {
    expect(parseOutputTokenSetting(setting)).toBe('auto')
  })
  it.each([1, 4096, 65536, 393216])('preserves the manual setting %s', (setting) => {
    expect(parseOutputTokenSetting(String(setting))).toBe(setting)
    expect(parseOutputTokenSetting(setting)).toBe(setting)
  })
})

describe('model output budgets', () => {
  it.each([
    [undefined, 65_536], ['low', 65_536], ['medium', 65_536], ['high', 65_536], ['max', 131_072], ['disabled', 8_192],
  ])('uses DeepSeek defaults for effort %s', (thinkingEffort, tokens) => {
    expect(resolveOutputBudget({ provider: 'deepseek', model: 'deepseek-flash', thinkingEffort })).toEqual({
      mode: 'automatic', source: 'default', initialTokens: tokens, retryTokens: tokens * 2, modelCeiling: 393_216, contextWindow: 1_000_000,
    })
  })
  it.each(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'])('recognizes the documented model/alias %s', (model) => {
    expect(resolveOutputBudget({ provider: 'deepseek', model, setting: 'auto' }).initialTokens).toBe(65_536)
  })
  it('preserves manual limits above the former universal ceiling and never increases them', () => {
    expect(resolveOutputBudget({ provider: 'deepseek', model: 'deepseek-flash', setting: 100_000 })).toMatchObject({
      mode: 'manual', source: 'manual-setting', initialTokens: 100_000, retryTokens: 100_000,
    })
  })
  it('caps a manual budget at the documented output ceiling', () => {
    expect(resolveOutputBudget({ provider: 'deepseek', model: 'deepseek-flash', setting: 999_999 }).initialTokens).toBe(393_216)
  })
  it('uses conservative defaults for unknown models and models at other providers', () => {
    for (const [provider, model] of [['deepseek', 'future-model'], ['openai', 'deepseek-flash'], ['openrouter', 'deepseek/deepseek-v4-pro']]) {
      expect(resolveOutputBudget({ provider, model })).toMatchObject({ initialTokens: 4096, retryTokens: 8192, modelCeiling: 16384 })
    }
  })
  it('only accepts matching provider metadata and respects context and output ceilings', () => {
    const catalog = [
      { id: 'same-name', name: 'Other', vendor: 'OpenAI', provider: 'openai', capabilities: [], contextWindow: 1_000_000, maxOutputTokens: 400_000 },
      { id: 'same-name', name: 'Actual', vendor: 'Actual', provider: 'custom', capabilities: [], contextWindow: 8192, maxOutputTokens: 5000 },
    ]
    expect(resolveOutputBudget({ provider: 'custom', model: 'same-name', catalog })).toMatchObject({
      initialTokens: 4096, retryTokens: 5000, modelCeiling: 5000, contextWindow: 8192,
    })
    expect(resolveOutputBudget({ provider: 'other', model: 'same-name', catalog })).toMatchObject({ contextWindow: 32768, modelCeiling: 16384 })
    expect(resolveOutputBudget({ provider: 'custom', model: 'same-name', setting: 99999, catalog: [{ ...catalog[1], maxOutputTokens: 99999 }] }).initialTokens).toBe(6859)
  })
  it('caps the output reserve at available context after retaining the mandatory input', () => {
    const budget = resolveOutputBudget({ provider: 'deepseek', model: 'deepseek-flash', minimumInputTokens: 850_000, setting: 100_000 })
    expect(budget).toMatchObject({ mode: 'manual', initialTokens: 49_488, retryTokens: 49_488 })
    expect(() => resolveOutputBudget({ provider: 'deepseek', model: 'deepseek-flash', minimumInputTokens: 900_000 })).toThrow('exceed the model context budget')
  })
})

const lengthError = () => Object.assign(new Error('cutoff'), { finishReason: 'length', rejectedToolCallCount: 1 })
const task: ProviderMessage = { role: 'user', content: 'Keep this task' }

function recovery(overrides: Partial<ConstructorParameters<typeof OutputBudgetRecovery>[0]> = {}) {
  const options = {
    budget: resolveOutputBudget({ provider: 'deepseek', model: 'deepseek-flash', thinkingEffort: 'disabled' }),
    provider: 'deepseek', model: 'deepseek-flash', hasVisibleText: () => false,
    assertActive: vi.fn(), onRetry: vi.fn(), ...overrides,
  }
  return { controller: new OutputBudgetRecovery(options), ...options }
}

describe('turn output budget recovery', () => {
  it('retries exactly once and retains the increased budget for subsequent requests', async () => {
    const { controller, onRetry } = recovery()
    const send = vi.fn().mockRejectedValueOnce(lengthError()).mockResolvedValue('answer')
    await expect(controller.run([task], [], send)).resolves.toBe('answer')
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(16384)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0])
    expect(controller.tokens).toBe(16384)
    const final = vi.fn().mockRejectedValue(lengthError())
    await expect(controller.run([task], [], final)).rejects.toMatchObject({ finishReason: 'length', message: expect.stringContaining('exhausted') })
    expect(final).toHaveBeenCalledTimes(1)
  })
  it.each(['manual', 'visible', 'ceiling'])('does not retry when blocked by %s', async (blocked) => {
    const budget = resolveOutputBudget({ provider: 'deepseek', model: 'deepseek-flash', setting: blocked === 'manual' ? 4096 : 'auto' })
    if (blocked === 'ceiling') budget.retryTokens = budget.initialTokens
    const { controller, onRetry } = recovery({ budget, hasVisibleText: () => blocked === 'visible' })
    const send = vi.fn().mockRejectedValue(lengthError())
    await expect(controller.run([task], [], send)).rejects.toMatchObject({ finishReason: 'length' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })
  it('rechecks cancellation before retrying', async () => {
    let cancelled = false
    const { controller, onRetry } = recovery({ assertActive: () => { if (cancelled) throw new Error('cancelled') } })
    const send = vi.fn().mockImplementation(async () => { cancelled = true; throw lengthError() })
    await expect(controller.run([task], [], send)).rejects.toThrow('cancelled')
    expect(send).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })
  it('does not retry untyped or unrelated errors', async () => {
    const { controller } = recovery()
    const error = new Error('length in plain text is not a typed finish reason')
    const send = vi.fn().mockRejectedValue(error)
    await expect(controller.run([task], [], send)).rejects.toBe(error)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('compacts complete older exchanges for the larger reserve and retains the task and latest tools', async () => {
    const budget = { ...resolveOutputBudget({ provider: 'custom', model: 'custom' }), contextWindow: 24000, initialTokens: 4096, retryTokens: 8192 }
    const { controller } = recovery({ budget })
    const messages: ProviderMessage[] = [
      { role: 'system', content: 'Instructions' }, { role: 'user', content: 'Old task' },
      { role: 'assistant', content: 'x'.repeat(40000) }, task,
      { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'read', content: 'y'.repeat(22000) },
    ]
    const send = vi.fn().mockRejectedValueOnce(lengthError()).mockResolvedValue('done')
    await controller.run(messages, [], send, undefined, task)
    const retry = send.mock.calls[1][0] as ProviderMessage[]
    expect(retry).toContain(task)
    expect(retry.filter((m) => m.role === 'tool')).toHaveLength(1)
    expect(retry.some((m) => m.role === 'assistant' && m.tool_calls?.[0]?.id === 'read')).toBe(true)
    expect(retry.some((m) => m.content === 'x'.repeat(40000))).toBe(false)
  })
  it('reports insufficient context without retrying or dropping the task', async () => {
    const { controller, onRetry } = recovery({ budget: { ...resolveOutputBudget({ provider: 'custom', model: 'custom' }), contextWindow: 12000, initialTokens: 4096, retryTokens: 8192 } })
    const send = vi.fn().mockRejectedValue(lengthError())
    await expect(controller.run([{ role: 'user', content: 'x'.repeat(16000) }], [], send)).rejects.toThrow('cannot fit the context window')
    expect(send).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })
})
