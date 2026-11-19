import { describe, expect, it } from 'vitest'
import type { ProviderMessage } from '../provider-core-types'
import { estimateToolRequestTokens, toolLoopInputBudget, trimToolLoopContext } from '../tool-loop-context'
import { fallbackContextWindow } from '../context-compression'

function exchange(id: string, size = 2_000): ProviderMessage[] {
  return [
    { role: 'assistant', content: null, reasoning_content: 'reasoning', tool_calls: [
      { id, type: 'function', function: { name: 'read', arguments: '{}' } },
      { id: `${id}-2`, type: 'function', function: { name: 'read', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: id, content: 'x'.repeat(size) },
    { role: 'tool', tool_call_id: `${id}-2`, content: 'y'.repeat(size) },
  ]
}

describe('tool loop context', () => {
  it.each(['deepseek-flash', 'deepseek-v4-pro'])('uses the model context window for %s', (model) => {
    const budget = toolLoopInputBudget({ contextWindow: fallbackContextWindow(model)!, maxOutputTokens: 16_384 })
    expect(budget).toBeGreaterThan(800_000)
    const task: ProviderMessage = { role: 'user', content: 'a'.repeat(119_742) }
    expect(trimToolLoopContext([task], [], budget, task)).toEqual([task])
  })

  it('preserves the latest task and complete parallel tool exchanges', () => {
    const task: ProviderMessage = { role: 'user', content: 'Investigate Hermes profiles' }
    const messages: ProviderMessage[] = [
      { role: 'system', content: 'instructions' },
      { role: 'user', content: 'old task'.repeat(600) }, ...exchange('old'),
      task, ...exchange('recent'), ...exchange('last', 200),
    ]
    const trimmed = trimToolLoopContext(messages, [], 1_500, task)
    expect(trimmed).toContain(task)
    expect(trimmed[0]).toEqual(messages[0])
    expect(estimateToolRequestTokens(trimmed, [])).toBeLessThanOrEqual(1_500)
    const calls = trimmed.flatMap((m) => m.role === 'assistant' ? m.tool_calls ?? [] : [])
    const results = trimmed.filter((m) => m.role === 'tool')
    expect(results.map((m) => m.tool_call_id).sort()).toEqual(calls.map((c) => c.id).sort())
    expect(calls.some((c) => c.id === 'last')).toBe(true)
  })

  it('counts reasoning, arguments, schemas and image input', () => {
    const plain: ProviderMessage[] = [{ role: 'assistant', content: 'done' }]
    const rich: ProviderMessage[] = [{ role: 'assistant', content: 'done', reasoning_content: 'x'.repeat(10_000) }, ...exchange('call')]
    expect(estimateToolRequestTokens(rich, [])).toBeGreaterThan(estimateToolRequestTokens(plain, []) + 3_000)
    const tools = [{ type: 'function' as const, function: { name: 'read', description: 'x'.repeat(4_000), parameters: {} } }]
    expect(estimateToolRequestTokens(plain, tools)).toBeGreaterThan(1_000)
    expect(estimateToolRequestTokens([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }], [])).toBeGreaterThan(1_000)
  })

  it('rejects an impossible budget without truncating the task', () => {
    const task: ProviderMessage = { role: 'user', content: 'x'.repeat(5_000) }
    expect(() => trimToolLoopContext([task], [], 100, task)).toThrow('current task')
    expect(task.content).toHaveLength(5_000)
  })
})
