import { describe, expect, it, vi } from 'vitest'

const { send, recognize, sendTools, streamTools, toolLoop } = vi.hoisted(() => ({ send: vi.fn(), recognize: vi.fn(), sendTools: vi.fn(), streamTools: vi.fn(), toolLoop: vi.fn() }))
vi.mock('../providers', () => ({
  PROVIDERS: [{ name: 'deepseek', baseUrl: 'https://api.deepseek.com' }],
  sendOpenAIMessage: send,
  sendOpenAIWithToolsResilient: sendTools,
  sendOpenAIWithToolsStream: streamTools,
  toOpenAICompatibleMessages: (messages: unknown) => messages,
}))
vi.mock('../provider-registry', () => ({ OPENAI_COMPATIBLE_PROVIDERS: ['deepseek'] }))
vi.mock('../ocr', () => ({ recognizeText: recognize }))
vi.mock('../model-catalog', () => ({ getCachedCatalog: () => [] }))
vi.mock('../token-counting', () => ({ countProviderInputTokens: vi.fn() }))
vi.mock('../tool-loop', () => ({ runProviderMcpToolLoop: toolLoop }))

import { dispatchToProvider } from '../chat-provider-dispatch'

describe('DeepSeek dispatch', () => {
  it('keeps tool schemas with choice none on both forced-final paths', async () => {
    const tools = [{ type: 'function' as const, function: { name: 'read_project_file', description: 'Read a file', parameters: { type: 'object', properties: {} } } }]
    streamTools.mockReset().mockResolvedValue({ content: 'done', toolCalls: [] })
    sendTools.mockReset().mockResolvedValue({ content: 'fallback', toolCalls: [] })
    toolLoop.mockImplementationOnce(async (...args: unknown[]) => {
      const caller = args[0] as (messages: unknown[], tools: undefined, choice: string) => Promise<unknown>
      const finalStream = args[19] as (messages: unknown[], chunk: () => void) => Promise<void>
      expect(args[23]).toEqual(expect.objectContaining({ contextWindow: 1_000_000, maxOutputTokens: 100 }))
      await finalStream([], () => {})
      await caller([], undefined, 'none')
      return 'done'
    })
    await dispatchToProvider({
      providerName: 'deepseek', providerModel: 'deepseek-flash', byokKey: 'key',
      chatMessages: [{ role: 'user', content: 'test' }],
      toolDefs: tools, toolMap: new Map(), effectiveAgentId: null, agenticMode: false,
      wikiInlineHandlers: new Map(), toolDirective: '', generationOptions: { temperature: 0.7, maxTokens: 100 },
      conversationId: 'test', webContents: undefined, sendChunk: vi.fn(), sendActivity: vi.fn(), systemPrompt: '',
    })
    expect(streamTools).toHaveBeenCalledWith('key', 'deepseek-flash', [], tools, 'none', expect.any(Function), expect.objectContaining({ thinkingEffort: 'disabled' }), 'https://api.deepseek.com')
    expect(sendTools).toHaveBeenCalledWith('key', 'deepseek-flash', [], tools, 'none', expect.objectContaining({ thinkingEffort: 'disabled' }), 'https://api.deepseek.com')
  })

  it('captures reasoning from turns without tool calls for later replay', async () => {
    send.mockReset().mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[5] as { onThinkingChunk: (id: string, text: string) => void }
      options.onThinkingChunk('reasoning-0', 'Compare ')
      options.onThinkingChunk('reasoning-0', 'the results.')
      return 'Completed.'
    })
    const onProviderHistory = vi.fn()
    await dispatchToProvider({
      providerName: 'deepseek', providerModel: 'deepseek-flash', byokKey: 'key',
      chatMessages: [{ role: 'user', content: 'Explain the results' }],
      toolDefs: [], toolMap: new Map(), effectiveAgentId: null, agenticMode: false,
      wikiInlineHandlers: new Map(), toolDirective: '', generationOptions: { temperature: 0.7, maxTokens: 100 },
      conversationId: 'test', webContents: undefined, sendChunk: vi.fn(), sendActivity: vi.fn(), systemPrompt: '', onProviderHistory,
    })
    expect(onProviderHistory).toHaveBeenCalledWith([{ role: 'assistant', content: 'Completed.', reasoning_content: 'Compare the results.' }])
  })

  it('continues to DeepSeek when OCR fails for a text-only model', async () => {
    send.mockReset().mockResolvedValueOnce('done')
    recognize.mockReset().mockRejectedValueOnce(new Error('OCR timed out'))
    const result = await dispatchToProvider({
      providerName: 'deepseek', providerModel: 'deepseek-v4-pro', byokKey: 'key',
      chatMessages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }],
      toolDefs: [], toolMap: new Map(), effectiveAgentId: null, agenticMode: false,
      wikiInlineHandlers: new Map(), toolDirective: '', generationOptions: { temperature: 0.7, maxTokens: 100 },
      conversationId: 'test', webContents: undefined, sendChunk: vi.fn(), sendActivity: vi.fn(), systemPrompt: '',
    })
    expect(result).toBe('done')
    expect(send.mock.calls[0][3]).toEqual([{ role: 'user', content: [{ type: 'text', text: '[Image attached — OCR unavailable]' }] }])
  })

  it('retries a rejected image with OCR text', async () => {
    send.mockReset().mockRejectedValueOnce(new Error('HTTP 400: image not supported')).mockResolvedValueOnce('done')
    recognize.mockReset().mockResolvedValue('text from image')
    const activity = vi.fn()
    const result = await dispatchToProvider({
      providerName: 'deepseek', providerModel: 'deepseek-flash', byokKey: 'key',
      chatMessages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }],
      toolDefs: [], toolMap: new Map(), effectiveAgentId: null, agenticMode: false,
      wikiInlineHandlers: new Map(), toolDirective: '', generationOptions: { temperature: 0.7, maxTokens: 100 },
      conversationId: 'test', webContents: undefined, sendChunk: vi.fn(), sendActivity: activity, systemPrompt: '',
    })
    expect(result).toBe('done')
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][3]).toEqual([{ role: 'user', content: [{ type: 'text', text: '[Image attached — OCR text: text from image]' }] }])
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('OCR text') }))
  })
})
