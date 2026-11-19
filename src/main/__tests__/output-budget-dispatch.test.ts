import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderMessage } from '../provider-core-types'
import type { ProviderDispatchOptions } from '../chat-provider-dispatch'
import type { ToolDefinition } from '../provider-types'

const { request, callTool, bodies, debugLog } = vi.hoisted(() => ({
  request: vi.fn(), callTool: vi.fn(), bodies: [] as Record<string, unknown>[], debugLog: vi.fn(),
}))
vi.mock('https', () => ({ default: { request } }))
vi.mock('../debug-mode', () => ({ debugLog }))
vi.mock('../credential-vault', () => ({ resolveProviderCredentialInput: (key: string) => key }))
vi.mock('../emergency-stop', () => ({ assertConversationStartsAllowed: vi.fn() }))
vi.mock('../database', () => ({ getDatabase: () => ({ prepare: () => ({ run: vi.fn() }) }) }))
vi.mock('../mcp', () => ({ callMcpTool: callTool, servers: new Map() }))
vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))
vi.mock('../model-catalog', () => ({ getCachedCatalog: () => [] }))
vi.mock('../token-counting', () => ({ countProviderInputTokens: vi.fn() }))
vi.mock('../provider-registry', () => ({ OPENAI_COMPATIBLE_PROVIDERS: ['deepseek'] }))
vi.mock('../providers', async () => ({
  ...await import('../providers/openai-provider'),
  PROVIDERS: [{ name: 'deepseek', baseUrl: 'https://api.deepseek.com' }],
  toOpenAICompatibleMessages: (messages: ProviderMessage[]) => messages,
}))

import { dispatchToProvider } from '../chat-provider-dispatch'
import { abortActiveStream, createProviderCancellationGuard } from '../provider-stream-state'
import { MCP_MAX_ITERATIONS } from '../tool-loop'

const tools: ToolDefinition[] = [{ type: 'function', function: { name: 'read_project_file', description: 'Read', parameters: { type: 'object' } } }]
const nativeCall = (id: string, path = 'file.ts') => ({ id, type: 'function', function: { name: 'read_project_file', arguments: JSON.stringify({ path }) } })

/** Real dispatch, policy, tool loop, HTTP scaffold, SSE decoder, and finish validation. */
function respond(options: { text?: string; reasoning?: string; calls?: ReturnType<typeof nativeCall>[]; finish?: string; json?: boolean; stop?: boolean }) {
  request.mockImplementationOnce((_options: unknown, callback: (res: EventEmitter) => void) => {
    const req = Object.assign(new EventEmitter(), { write: (body: string) => { bodies.push(JSON.parse(body)) }, end: () => {}, destroy: vi.fn(), setTimeout: vi.fn() })
    const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': options.json ? 'application/json' : 'text/event-stream' } })
    req.end = () => {
      callback(res)
      const finish_reason = options.finish ?? (options.calls?.length ? 'tool_calls' : 'stop')
      const usage = { prompt_tokens: 50, completion_tokens: 20 }
      if (options.json) {
        res.emit('data', Buffer.from(JSON.stringify({ choices: [{ message: { content: options.text ?? null, reasoning_content: options.reasoning, tool_calls: options.calls }, finish_reason }], usage })))
      } else {
        const emit = (data: unknown) => res.emit('data', Buffer.from(`data: ${JSON.stringify(data)}\n\n`))
        if (options.reasoning) emit({ choices: [{ delta: { reasoning_content: options.reasoning } }] })
        if (options.text) emit({ choices: [{ delta: { content: options.text } }] })
        if (options.calls) emit({ choices: [{ delta: { tool_calls: options.calls.map((call, index) => ({ index, ...call })) } }] })
        if (options.stop) abortActiveStream('budget-test')
        emit({ choices: [{ delta: {}, finish_reason }], usage })
        res.emit('data', Buffer.from('data: [DONE]\n\n'))
      }
      res.emit('end')
    }
    return req
  })
}

function options(overrides: Partial<ProviderDispatchOptions> = {}): ProviderDispatchOptions {
  return {
    providerName: 'deepseek', providerModel: 'deepseek-flash', byokKey: 'test-credential',
    chatMessages: [{ role: 'system', content: 'Read only.' }, { role: 'user', content: 'Can Hermes profiles be added to the model dropdown? Report here without making changes.' }],
    toolDefs: tools, toolMap: new Map([['read_project_file', { serverId: 'project', toolName: 'read_project_file' }]]),
    effectiveAgentId: 'agent', agenticMode: false, fullAutoApprove: false,
    wikiInlineHandlers: new Map(), toolDirective: 'Inspect files when needed.',
    generationOptions: { temperature: 0.7, maxTokens: 'auto', thinkingEffort: 'medium' },
    conversationId: 'budget-test', webContents: undefined, sendChunk: vi.fn(), sendActivity: vi.fn(), systemPrompt: 'Read only.',
    onThinkingChunk: vi.fn(), onThinkingEnd: vi.fn(), onProviderHistory: vi.fn(), ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  request.mockReset()
  bodies.length = 0
  callTool.mockResolvedValue({ success: true, result: 'file contents' })
})

describe('output budgeting through real streamed dispatch', () => {
  it('recovers a reasoning-only cutoff after file reads without replaying tools or failed reasoning', async () => {
    respond({ calls: [nativeCall('one', 'one.ts'), nativeCall('two', 'two.ts')], reasoning: 'Completed reasoning' })
    respond({ reasoning: 'Truncated reasoning must not be replayed', calls: [nativeCall('truncated', 'never.ts')], finish: 'length' })
    respond({ calls: [nativeCall('three', 'three.ts')], reasoning: 'Successful retry reasoning' })
    respond({ text: 'Yes. Profiles can be added using the existing profile discovery.' })
    const policy: NonNullable<ProviderDispatchOptions['mcpPolicy']> = { assignedServerIds: ['project'], serverTrust: { project: 'always-ask' } }
    const opts = options({ mcpPolicy: policy })
    await expect(dispatchToProvider(opts)).resolves.toContain('Profiles can be added')
    expect(bodies.map((body) => body.max_tokens)).toEqual([65536, 65536, 131072, 131072])
    expect(bodies[1].messages).toEqual(bodies[2].messages)
    expect(bodies[1].tools).toEqual(bodies[2].tools)
    expect(bodies[1].tool_choice).toBe(bodies[2].tool_choice)
    expect(bodies[1].thinking).toEqual(bodies[2].thinking)
    expect(callTool.mock.calls.map((call) => call[2])).toEqual([{ path: 'one.ts' }, { path: 'two.ts' }, { path: 'three.ts' }])
    expect(callTool).toHaveBeenLastCalledWith('project', 'read_project_file', { path: 'three.ts' }, 'agent', undefined, false, undefined, false, policy)
    const history = vi.mocked(opts.onProviderHistory!).mock.calls[0][0]
    expect(JSON.stringify(history)).not.toContain('Truncated reasoning')
    expect(JSON.stringify(history)).not.toContain('never.ts')
    expect(JSON.stringify(history)).toContain('Successful retry reasoning')
    expect(opts.sendActivity).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('131,072') }))
    const blocks = vi.mocked(opts.onThinkingChunk!).mock.calls.map((call) => call[0])
    expect(blocks).toContain('reasoning-0-retry-1')
    const diagnostics = debugLog.mock.calls.filter((call) => call[0] === 'output-budget').map((call) => JSON.parse(call[1]))
    expect(diagnostics).toContainEqual(expect.objectContaining({ outcome: 'retry', budget: 131072, completedTools: 2, finishReason: 'length' }))
    expect(JSON.stringify(diagnostics)).not.toContain('test-credential')
    expect(JSON.stringify(diagnostics)).not.toContain('Hermes profiles')
  })

  it('reports earlier completed tools separately when the one recovery is exhausted', async () => {
    respond({ calls: [nativeCall('one')] })
    respond({ reasoning: 'cutoff', calls: [nativeCall('rejected')], finish: 'length' })
    respond({ reasoning: 'cutoff again', calls: [nativeCall('rejected-again')], finish: 'length' })
    const result = await dispatchToProvider(options())
    expect(result).toContain('recovery for this turn has been exhausted')
    expect(result).toContain('Completed tools earlier in this turn: 1')
    expect(result).toContain('Tool calls rejected in the failed response: 1; none were executed')
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('preserves partial text and typed cutoff diagnostics without retrying', async () => {
    respond({ text: 'Partial answer.', finish: 'length' })
    const opts = options()
    const result = await dispatchToProvider(opts)
    expect(result).toContain('Partial answer.')
    expect(result).toContain('Answer text is already visible')
    expect(vi.mocked(opts.sendChunk).mock.calls.flat().join('')).toBe(result)
    expect(result.match(/Partial answer\./g)).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('also prevents recovery after narration emitted in an earlier round', async () => {
    respond({ text: 'Checking the profile discovery.', calls: [nativeCall('one')] })
    respond({ reasoning: 'cutoff', finish: 'length' })
    expect(await dispatchToProvider(options())).toContain('Answer text is already visible')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('keeps a saved numeric setting manual and never increases it', async () => {
    respond({ reasoning: 'cutoff', finish: 'length' })
    const opts = options({ generationOptions: { temperature: 0.7, maxTokens: 4096, thinkingEffort: 'medium' } })
    await expect(dispatchToProvider(opts)).rejects.toMatchObject({ finishReason: 'length', message: expect.stringContaining('manual output limit') })
    expect(request).toHaveBeenCalledTimes(1)
    expect(bodies[0].max_tokens).toBe(4096)
    expect(opts.sendActivity).not.toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('Automatic increased') }))
  })

  it('keeps policy enforcement for calls returned by a successful recovery', async () => {
    respond({ reasoning: 'cutoff', finish: 'length' })
    respond({ calls: [nativeCall('retry')] })
    respond({ text: 'The tool was denied.' })
    await dispatchToProvider(options({ toolPolicy: { preApproved: [], alwaysAsk: [], neverAllow: ['read_project_file'] } }))
    expect(callTool).not.toHaveBeenCalled()
    expect(JSON.stringify(bodies[2].messages)).toContain('neverAllow')
  })

  it('checks cancellation before starting another request', async () => {
    respond({ reasoning: 'cutoff', finish: 'length', stop: true })
    await expect(dispatchToProvider(options())).rejects.toThrow('cancelled')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('shares recovery with streamed finalisation and never falls through to another retry', async () => {
    respond({ reasoning: 'cutoff', finish: 'length' })
    for (let i = 0; i < MCP_MAX_ITERATIONS; i++) respond({ calls: [nativeCall(`read-${i}`)] })
    respond({ reasoning: 'final cutoff', finish: 'length' })
    const result = await dispatchToProvider(options())
    expect(result).toContain('recovery for this turn has been exhausted')
    expect(request).toHaveBeenCalledTimes(MCP_MAX_ITERATIONS + 2)
    expect(callTool).toHaveBeenCalledTimes(MCP_MAX_ITERATIONS)
    expect(bodies.at(-1)?.tool_choice).toBe('none')
    expect(bodies.at(-1)?.thinking).toEqual({ type: 'disabled' })
  })

  it('allows the single recovery in streamed finalisation when ordinary rounds did not use it', async () => {
    for (let i = 0; i < MCP_MAX_ITERATIONS; i++) respond({ calls: [nativeCall(`read-${i}`)] })
    respond({ reasoning: 'final cutoff', finish: 'length' })
    respond({ text: 'The inspection is complete.' })
    expect(await dispatchToProvider(options())).toBe('The inspection is complete.')
    expect(bodies.at(-2)?.max_tokens).toBe(65536)
    expect(bodies.at(-1)?.max_tokens).toBe(131072)
    expect(bodies.at(-1)?.thinking).toEqual(bodies.at(-2)?.thinking)
    expect(bodies.at(-1)?.messages).toEqual(bodies.at(-2)?.messages)
  })

  it('applies the same bounded policy to non-streaming finalisation', async () => {
    for (let i = 0; i < MCP_MAX_ITERATIONS; i++) respond({ calls: [nativeCall(`read-${i}`)] })
    // Endpoint rejects streaming finalisation, so the existing fallback uses JSON.
    respond({ finish: 'aborted' })
    respond({ reasoning: 'JSON cutoff', finish: 'length', json: true })
    respond({ text: 'Final JSON answer.', json: true })
    expect(await dispatchToProvider(options())).toBe('Final JSON answer.')
    expect(bodies.slice(-2).map((body) => body.max_tokens)).toEqual([65536, 131072])
    expect(bodies.slice(-2).map((body) => body.stream)).toEqual([false, false])
    expect(callTool).toHaveBeenCalledTimes(MCP_MAX_ITERATIONS)
  })

  it('recovers a direct answer and persists only the successful reasoning', async () => {
    respond({ reasoning: 'failed reasoning', finish: 'length' })
    respond({ reasoning: 'successful reasoning', text: 'Direct answer.' })
    const opts = options({ toolDefs: [] })
    expect(await dispatchToProvider(opts)).toBe('Direct answer.')
    expect(bodies.map((body) => body.max_tokens)).toEqual([65536, 131072])
    expect(opts.onProviderHistory).toHaveBeenCalledWith([{ role: 'assistant', content: 'Direct answer.', reasoning_content: 'successful reasoning' }])
  })

  it('defaults a missing global setting to Automatic', async () => {
    respond({ text: 'Answer.' })
    await dispatchToProvider(options({ generationOptions: { temperature: 0.7 } }))
    expect(bodies[0].max_tokens).toBe(65536)
  })
})

describe('provider cancellation guards', () => {
  it('tracks a conversation stop between requests, including child turns, without cancelling siblings', () => {
    const parent = createProviderCancellationGuard('guard-test')
    const child = createProviderCancellationGuard('guard-test:child')
    const sibling = createProviderCancellationGuard('other-test')
    abortActiveStream('guard-test')
    expect(parent.assertActive).toThrow('cancelled')
    expect(child.assertActive).toThrow('cancelled')
    expect(sibling.assertActive).not.toThrow()
    parent.dispose(); child.dispose(); sibling.dispose()
  })
})
