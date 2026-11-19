import { beforeEach, describe, expect, it, vi } from 'vitest'

// openai-provider pulls in the streaming/http layer transitively; stub electron and the HTTP
// transport so sendOpenAIWithTools can be exercised without real network calls.
vi.mock('electron', () => ({ app: { isPackaged: false } }))

const state = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../http-client', () => ({
  httpsRequestUrl: state.request,
  parseSseStream: vi.fn(),
  providerHttpError: (label: string, status: number) => new Error(`${label} ${status}`),
}))

import { sendOpenAIWithTools, sendOpenAIWithToolsResilient } from '../providers/openai-provider'
import type { ProviderMessage } from '../provider-core-types'

beforeEach(() => {
  state.request.mockReset()
})

function jsonResponse(body: Record<string, unknown>) {
  return { status: 200, data: JSON.stringify(body) }
}

describe('DeepSeek tool request compatibility', () => {
  const tools = [{ type: 'function' as const, function: { name: 'lookup', description: 'Look up information', parameters: { type: 'object', properties: {} } } }]

  it('preserves required tool choice by disabling thinking for the recovery request', async () => {
    state.request.mockResolvedValue(jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'lookup', arguments: '{}' } }] } }] }))
    await sendOpenAIWithTools('key', 'deepseek-flash', [{ role: 'user', content: 'test' }], tools, 'required', { thinkingEffort: 'high' }, 'https://api.deepseek.com')
    const body = JSON.parse(state.request.mock.calls[0][2])
    expect(body).toMatchObject({ thinking: { type: 'disabled' }, tool_choice: 'required', tools })
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('quarantines historical assistant markup while preserving user examples and native calls', async () => {
    state.request.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'done' } }] }))
    const markup = '<｜DSML｜tool_calls><｜DSML｜invoke name="lookup"></｜DSML｜invoke></｜DSML｜tool_calls>'
    const messages: ProviderMessage[] = [
      { role: 'user', content: markup },
      { role: 'assistant', content: markup },
      { role: 'assistant', content: null, reasoning_content: 'preserved', tool_calls: [{ id: 't1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'result' },
    ]
    await sendOpenAIWithTools('key', 'deepseek-flash', messages, tools, 'none', {}, 'https://api.deepseek.com')
    const body = JSON.parse(state.request.mock.calls[0][2])
    expect(body.messages[0].content).toBe(markup)
    expect(body.messages[1].content).not.toContain('DSML')
    expect(body.messages[2]).toEqual(messages[2])
    expect(body.tools).toEqual(tools)
    expect(body.tool_choice).toBe('none')
    expect(messages[1].content).toBe(markup)
  })

  it('can replay a non-thinking recovery call on the next thinking request', async () => {
    state.request.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'done' } }] }))
    const messages: ProviderMessage[] = [
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'result' },
    ]
    await sendOpenAIWithTools('key', 'deepseek-flash', messages, tools, 'auto', { thinkingEffort: 'high' }, 'https://api.deepseek.com')
    const body = JSON.parse(state.request.mock.calls[0][2])
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.messages[0].reasoning_content).toBe('')
    expect(messages[0]).not.toHaveProperty('reasoning_content')
  })
})

describe('sendOpenAIWithTools empty-response detection', () => {
  it.each(['length', 'insufficient_system_resource', 'aborted', 'content_filter'])('rejects an interrupted non-streaming batch (%s)', async (reason) => {
    state.request.mockResolvedValueOnce(jsonResponse({ choices: [{
      message: { content: 'I am checking.', tool_calls: [{ id: 't1', function: { name: 'lookup', arguments: '{}' } }] },
      finish_reason: reason,
    }] }))
    await expect(sendOpenAIWithTools('key', 'deepseek-flash', [{ role: 'user', content: 'test' }], [], 'auto', {}, 'https://api.deepseek.com'))
      .rejects.toMatchObject({ finishReason: reason })
  })

  it('reproduces the BYOK bug at the unit level before the fix would have existed: returns content:null silently', async () => {
    // This is what the endpoint actually sent back on the reported OpenRouter session: a forced
    // final answer (tool_choice:'none') that hit the max_tokens cap mid-generation, leaving no
    // visible text. Before the fix, sendOpenAIWithTools had no detection for this at all.
    state.request.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: null }, finish_reason: 'length' }],
    }))

    // Post-fix behavior: this must now throw a specific, actionable error instead of resolving
    // with { content: null }.
    await expect(
      sendOpenAIWithTools('key', 'anthropic/claude-sonnet-4', [{ role: 'user', content: 'hi' }], [], 'none')
    ).rejects.toThrow(/ran out of tokens/)
  })

  it('throws a distinct message (with finishReason attached) for a genuine empty stop vs. a length cutoff', async () => {
    state.request.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    }))

    await expect(
      sendOpenAIWithTools('key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'none')
    ).rejects.toThrow(/empty response/)
  })

  it('does not throw when tool calls are present even if content is empty', async () => {
    state.request.mockResolvedValueOnce(jsonResponse({
      choices: [{
        message: { content: null, tool_calls: [{ id: 't1', function: { name: 'lookup', arguments: '{}' } }] },
        finish_reason: 'tool_calls',
      }],
    }))

    const result = await sendOpenAIWithTools('key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'auto')
    expect(result.content).toBeNull()
    expect(result.toolCalls).toHaveLength(1)
  })

  it('passes through a normal non-empty response unchanged', async () => {
    state.request.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: 'hello there' }, finish_reason: 'stop' }],
    }))

    const result = await sendOpenAIWithTools('key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'none')
    expect(result.content).toBe('hello there')
    expect(result.finishReason).toBe('stop')
  })
})

describe('sendOpenAIWithToolsResilient', () => {
  it.each([4096, 12000, 100000])('leaves recovery to the turn policy without changing max_tokens=%s', async (maxTokens) => {
    state.request.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: null }, finish_reason: 'length' }] }))
    await expect(sendOpenAIWithToolsResilient(
      'key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'none', { maxTokens }
    )).rejects.toMatchObject({ finishReason: 'length' })
    expect(state.request).toHaveBeenCalledTimes(1)
    expect(JSON.parse(state.request.mock.calls[0][2] as string).max_tokens).toBe(maxTokens)
  })

  it('does not retry on a genuine empty stop (not a length cutoff) and rejects', async () => {
    state.request.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }))

    await expect(
      sendOpenAIWithToolsResilient('key', 'some-model', [{ role: 'user', content: 'hi' }], [], 'none')
    ).rejects.toThrow(/empty response/)
    expect(state.request).toHaveBeenCalledTimes(1)
  })
})
