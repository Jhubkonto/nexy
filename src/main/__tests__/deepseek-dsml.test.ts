import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDsmlToolCalls } from '../../shared/unexecuted-tool-markup'
import type { ToolChoice, ToolDefinition } from '../provider-types'
import type { ProviderMessage } from '../provider-core-types'

const { request, callTool, bodies } = vi.hoisted(() => ({
  request: vi.fn(), callTool: vi.fn(), bodies: [] as string[],
}))
vi.mock('https', () => ({ default: { request } }))
vi.mock('../debug-mode', () => ({ debugLog: vi.fn() }))
vi.mock('../credential-vault', () => ({ resolveProviderCredentialInput: (key: string) => key }))
vi.mock('../emergency-stop', () => ({ assertConversationStartsAllowed: vi.fn() }))
vi.mock('../database', () => ({ getDatabase: () => ({ prepare: () => ({ run: vi.fn() }) }) }))
vi.mock('../mcp', () => ({ callMcpTool: callTool, servers: new Map() }))
vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))

import { sendOpenAIWithTools, sendOpenAIWithToolsStream } from '../providers/openai-provider'
import { runProviderMcpToolLoop, type ModelToolStreamCaller } from '../tool-loop'

const baseUrl = 'https://api.deepseek.com'
const tools: ToolDefinition[] = [{
  type: 'function', function: { name: 'read_project_file', description: 'Read', parameters: { type: 'object' } },
}]
const parameter = (name: string, value: string, string = 'true') =>
  `<｜DSML｜ parameter name="${name}" string="${string}">${value}</｜DSML｜ parameter>`
const invoke = (params = '', name = 'read_project_file') => `<｜DSML｜ invoke name="${name}">${params}</｜DSML｜ invoke>`
const block = (calls = invoke(parameter('path', 'src/shared/models.ts'))) => `<｜DSML｜ calls>${calls}</｜DSML｜ calls>`

/** Use the real HTTP/SSE parsers with an in-memory transport. */
function respond(content: string, stream = false, nativeCalls: unknown[] = [], finishReason: string | null = 'stop') {
  request.mockImplementationOnce((_options: unknown, callback: (res: EventEmitter) => void) => {
    const req = Object.assign(new EventEmitter(), {
      write: (body: string) => { bodies.push(body) }, end: () => {}, setTimeout: vi.fn(), destroy: vi.fn(),
    })
    const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': stream ? 'text/event-stream' : 'application/json' } })
    req.end = () => {
      callback(res)
      if (stream) {
        // Split protocol tags at every character, including Unicode delimiters.
        for (const ch of content) res.emit('data', `data: ${JSON.stringify({ model: 'deepseek-flash', choices: [{ delta: { content: ch } }] })}\n\n`)
        if (nativeCalls.length) res.emit('data', `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: nativeCalls } }] })}\n\n`)
        res.emit('data', `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'reasoning' }, finish_reason: finishReason }], usage: { prompt_tokens: 12, completion_tokens: 7, prompt_cache_hit_tokens: 4 } })}\n\n`)
        res.emit('data', 'data: [DONE]\n\n')
      } else {
        res.emit('data', JSON.stringify({ model: 'deepseek-flash', choices: [{ message: { content, reasoning_content: 'reasoning', tool_calls: nativeCalls }, finish_reason: finishReason }], usage: { prompt_tokens: 12, completion_tokens: 7, prompt_cache_hit_tokens: 4 } }))
      }
      res.emit('end')
    }
    return req
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  request.mockReset()
  bodies.length = 0
  callTool.mockResolvedValue({ success: true, result: 'file contents' })
})

describe('DSML decoding', () => {
  it.each([
    ['current', block()],
    ['double delimiters', block().replaceAll('｜', '｜｜')],
    ['ASCII delimiters', block().replaceAll('｜', '|')],
    ['legacy', block().replaceAll(' calls>', 'tool_calls>').replaceAll(' invoke', 'invoke').replaceAll(' parameter', 'parameter')],
  ])('decodes the %s format', (_format, text) => {
    expect(parseDsmlToolCalls(text)).toEqual({ content: null, toolCalls: [{ name: 'read_project_file', arguments: { path: 'src/shared/models.ts' } }] })
  })

  it('preserves raw strings, JSON types, call order and narration', () => {
    const raw = '  C:\\folder\\file\n<b>&amp;</b> "quoted"  '
    const params = parameter('raw', raw) + parameter('count', '0', 'false') + parameter('flag', 'false', 'false') + parameter('items', '[1,"two"]', 'false') + parameter('object', '{"nested":null}', 'false')
    expect(parseDsmlToolCalls(`Checking.\n${block(invoke(params) + invoke())}`)).toEqual({
      content: 'Checking.\n', toolCalls: [
        { name: 'read_project_file', arguments: { raw, count: 0, flag: false, items: [1, 'two'], object: { nested: null } } },
        { name: 'read_project_file', arguments: {} },
      ],
    })
  })

  it.each([
    ['truncated envelope', block().slice(0, -1)],
    ['later truncated call', block().replace('</｜DSML｜ calls>', invoke().slice(0, -1))],
    ['invalid JSON', block(invoke(parameter('count', 'NaN', 'false')))],
    ['trailing comma', block(invoke(parameter('data', '{"a":1,}', 'false')))],
    ['duplicate parameter', block(invoke(parameter('path', 'a') + parameter('path', 'b')))],
    ['missing string attribute', block().replace(' string="true"', '')],
    ['invalid string attribute', block().replace('string="true"', 'string="yes"')],
    ['unexpected attribute', block().replace('name="read_project_file"', 'name="read_project_file" extra="x"')],
    ['unexpected text', block().replace('</｜DSML｜ invoke>', 'surprise</｜DSML｜ invoke>')],
    ['nested delimiters', block(invoke(parameter('path', block())))],
    ['empty batch', block('')],
    ['trailing prose', `${block()}\nThis is an example.`],
    ['fenced code', `\`\`\`xml\n${block()}\n\`\`\``],
    ['inline code', `\`${block()}\``],
    ['block quote', `> ${block()}`],
    ['indented code', `    ${block()}`],
    ['HTML example', `<pre>${block()}</pre>`],
  ])('rejects %s without recovering any calls', (_case, text) => {
    expect(parseDsmlToolCalls(text)).toBeNull()
  })

  it('treats prototype property names as own data properties', () => {
    const parsed = parseDsmlToolCalls(block(invoke(parameter('__proto__', '{"polluted":true}', 'false'))))!
    expect(Object.getPrototypeOf(parsed.toolCalls[0].arguments)).toBe(Object.prototype)
    expect(Object.hasOwn(parsed.toolCalls[0].arguments, '__proto__')).toBe(true)
    expect({}).not.toHaveProperty('polluted')
  })
})

describe('DeepSeek provider normalization', () => {
  it.each([true, false])('rejects a whitespace-only answer with reasoning (SSE %s)', async (sse) => {
    respond('\n\n', sse)
    await expect(sendOpenAIWithToolsStream('key', 'deepseek-flash', [], tools, 'auto', vi.fn(), {}, baseUrl))
      .rejects.toMatchObject({ name: 'EmptyProviderResponseError', finishReason: 'stop', reasoningContent: 'reasoning' })
  })

  it.each(['length', 'insufficient_system_resource', 'aborted', 'content_filter'])('rejects %s before native or recovered calls can execute', async (reason) => {
    for (const sse of [false, true]) {
      for (const native of [false, true]) {
        respond(native ? 'Working. ' : block(), sse, native ? [{ index: 0, id: 'native', function: { name: 'read_project_file', arguments: '{}' } }] : [], reason)
        await expect(sendOpenAIWithToolsStream('key', 'deepseek-flash', [], tools, 'auto', vi.fn(), {}, baseUrl))
          .rejects.toMatchObject({ finishReason: reason })
      }
    }
    expect(callTool).not.toHaveBeenCalled()
  })

  it('rejects a stream that ends without a finish reason even with valid-looking calls', async () => {
    respond('', true, [{ index: 0, id: 'native', function: { name: 'read_project_file', arguments: '{}' } }], null)
    await expect(sendOpenAIWithToolsStream('key', 'deepseek-flash', [], tools, 'auto', vi.fn(), {}, baseUrl))
      .rejects.toThrow('without a completion finish reason')
  })

  it('recovers a non-streaming call with a unique ID and preserves provider metadata', async () => {
    respond(block(invoke() + invoke()))
    const result = await sendOpenAIWithTools('key', 'deepseek-flash', [], tools, 'auto', {}, baseUrl)
    expect(result.content).toBeNull()
    expect(result.toolCalls).toHaveLength(2)
    expect(new Set(result.toolCalls.map((call) => call.id)).size).toBe(2)
    expect(result.toolCalls[0]).toMatchObject({ id: expect.stringMatching(/^call_dsml_/), name: 'read_project_file', arguments: {} })
    expect(result).toMatchObject({ reasoningContent: 'reasoning', model: 'deepseek-flash', usage: { inputTokens: 12, outputTokens: 7, cachedInputTokens: 4 } })
  })

  it.each([true, false])('recovers a streaming request when SSE is %s without displaying DSML', async (sse) => {
    respond(`Checking. ${block()}`, sse)
    const chunk = vi.fn()
    const usage = vi.fn()
    const result = await sendOpenAIWithToolsStream('key', 'deepseek-flash', [], tools, 'required', chunk, { onUsage: usage }, baseUrl)
    expect(result).toMatchObject({ content: 'Checking. ', toolCalls: [{ name: 'read_project_file', arguments: { path: 'src/shared/models.ts' } }] })
    expect(chunk.mock.calls.flat().join('')).toBe('Checking. ')
    expect(usage).toHaveBeenCalledWith({ inputTokens: 12, outputTokens: 7, cachedInputTokens: 4 })
  })

  it.each([
    ['other provider', 'https://example.com', 'auto', tools, block()],
    ['tools disabled', baseUrl, 'none', tools, block()],
    ['no tools', baseUrl, 'auto', [], block()],
    ['unknown tool in batch', baseUrl, 'auto', tools, block(invoke() + invoke('', 'unknown'))],
    ['incomplete block', baseUrl, 'auto', tools, block().slice(0, -1)],
  ] as const)('does not normalize %s', async (_case, url, choice, definitions, text) => {
    respond(text)
    const result = await sendOpenAIWithTools('key', 'model', [], [...definitions], choice as ToolChoice, {}, url)
    expect(result.toolCalls).toEqual([])
    expect(result.content).toBe(text)
  })

  it('prefers native calls without adding duplicate recovered calls', async () => {
    respond(block(), true, [{ index: 0, id: 'native', function: { name: 'read_project_file', arguments: '{}' } }])
    const chunk = vi.fn()
    const result = await sendOpenAIWithToolsStream('key', 'deepseek-flash', [], tools, 'auto', chunk, {}, baseUrl)
    expect(result.toolCalls).toEqual([{ id: 'native', name: 'read_project_file', arguments: {} }])
    expect(chunk).not.toHaveBeenCalled()
  })

  it.each([true, false])('never recovers calls on a final-answer stream (SSE %s)', async (sse) => {
    respond(block(), sse)
    const chunk = vi.fn()
    const result = await sendOpenAIWithToolsStream('key', 'deepseek-flash', [], tools, 'none', chunk, {}, baseUrl)
    expect(result.toolCalls).toEqual([])
    expect(chunk).not.toHaveBeenCalled()
  })

  it('preserves ordinary HTML output', async () => {
    respond('Use <b>bold</b>.', true)
    const chunk = vi.fn()
    const result = await sendOpenAIWithToolsStream('key', 'deepseek-flash', [], tools, 'auto', chunk, {}, baseUrl)
    expect(result.content).toBe('Use <b>bold</b>.')
    expect(chunk.mock.calls.flat().join('')).toBe(result.content)
  })
})

describe('recovered calls in the normal tool loop', () => {
  it.each([false, true])('continues after a blank answer without repeating completed tools (streaming %s)', async (streaming) => {
    respond(block(), streaming)
    respond('\n\n', streaming)
    respond('The model selector can include Hermes profiles.', streaming)
    const caller = (messages: ProviderMessage[], definitions: ToolDefinition[] | undefined, choice: ToolChoice) =>
      sendOpenAIWithTools('key', 'deepseek-flash', messages, definitions ?? [], choice, {}, baseUrl)
    const stream: ModelToolStreamCaller = (messages, definitions, choice, chunk) =>
      sendOpenAIWithToolsStream('key', 'deepseek-flash', messages, definitions ?? [], choice, chunk, {}, baseUrl)
    const chunk = vi.fn()
    const result = await runProviderMcpToolLoop(caller, [{ role: 'user', content: 'Investigate Hermes profiles' }], tools,
      new Map([['read_project_file', { serverId: 'project', toolName: 'read_project_file' }]]),
      'agent', null, undefined, chunk, undefined, false, undefined, undefined, undefined,
      false, undefined, undefined, false, undefined, undefined, undefined, undefined, streaming ? stream : undefined)
    expect(result.trim()).toBe('The model selector can include Hermes profiles.')
    expect(chunk.mock.calls.flat().join('')).toBe(result)
    expect(callTool).toHaveBeenCalledTimes(1)
    const retry = JSON.parse(bodies[2])
    expect(retry.tool_choice).toBe('auto')
    expect(retry.messages.filter((m: ProviderMessage) => m.role === 'assistant')).toHaveLength(2)
    expect(retry.messages.at(-2)).toMatchObject({ role: 'assistant', content: null, reasoning_content: 'reasoning' })
    expect(retry.messages.some((m: ProviderMessage) => m.role === 'tool')).toBe(true)
  })

  it.each([false, true])('executes once and replays structured history (streaming %s)', async (streaming) => {
    respond(block(), streaming)
    respond('Found the file.', streaming)
    const caller = (messages: ProviderMessage[], definitions: ToolDefinition[] | undefined, choice: ToolChoice) =>
      sendOpenAIWithTools('key', 'deepseek-flash', messages, definitions ?? [], choice, {}, baseUrl)
    const stream: ModelToolStreamCaller = (messages, definitions, choice, chunk) =>
      sendOpenAIWithToolsStream('key', 'deepseek-flash', messages, definitions ?? [], choice, chunk, {}, baseUrl)
    const chunk = vi.fn()
    const result = await runProviderMcpToolLoop(
      caller, [{ role: 'user', content: 'Read the model catalog' }], tools,
      new Map([['read_project_file', { serverId: 'project', toolName: 'read_project_file' }]]),
      'agent', null, undefined, chunk, undefined, false, undefined, undefined, undefined,
      false, undefined, undefined, false, undefined, undefined, undefined, undefined,
      streaming ? stream : undefined,
    )
    expect(result).toBe('Found the file.')
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledWith('project', 'read_project_file', { path: 'src/shared/models.ts' }, 'agent', undefined, false, false, false)
    const history = JSON.parse(bodies[1]).messages
    const assistant = history.find((msg: ProviderMessage) => msg.role === 'assistant')
    expect(assistant).toMatchObject({ content: null, reasoning_content: 'reasoning', tool_calls: [{ id: expect.stringMatching(/^call_dsml_/), function: { name: 'read_project_file', arguments: '{"path":"src/shared/models.ts"}' } }] })
    expect(history).toContainEqual({ role: 'tool', tool_call_id: assistant.tool_calls[0].id, content: 'file contents' })
    expect(JSON.stringify(history)).not.toContain('DSML')
    expect(chunk.mock.calls.flat().join('')).toBe('Found the file.')
  })

  it('applies the scheduled task policy to recovered calls', async () => {
    respond(block())
    respond('Tool denied.')
    const caller = (messages: ProviderMessage[], definitions: ToolDefinition[] | undefined, choice: ToolChoice) =>
      sendOpenAIWithTools('key', 'deepseek-flash', messages, definitions ?? [], choice, {}, baseUrl)
    await runProviderMcpToolLoop(caller, [], tools,
      new Map([['read_project_file', { serverId: 'project', toolName: 'read_project_file' }]]),
      'agent', null, undefined, vi.fn(), undefined, false, undefined, undefined, undefined,
      false, { preApproved: [], alwaysAsk: [], neverAllow: ['read_project_file'] },
    )
    expect(callTool).not.toHaveBeenCalled()
    expect(bodies[1]).toContain('neverAllow')
  })
})
