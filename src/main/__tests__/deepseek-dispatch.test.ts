import { describe, expect, it, vi } from 'vitest'

const { send, recognize } = vi.hoisted(() => ({ send: vi.fn(), recognize: vi.fn() }))
vi.mock('../providers', () => ({
  PROVIDERS: [{ name: 'deepseek', baseUrl: 'https://api.deepseek.com' }],
  sendOpenAIMessage: send,
  toOpenAICompatibleMessages: (messages: unknown) => messages,
}))
vi.mock('../provider-registry', () => ({ OPENAI_COMPATIBLE_PROVIDERS: ['deepseek'] }))
vi.mock('../ocr', () => ({ recognizeText: recognize }))
vi.mock('../model-catalog', () => ({ getCachedCatalog: () => [] }))
vi.mock('../token-counting', () => ({ countProviderInputTokens: vi.fn() }))
vi.mock('../tool-loop', () => ({ runProviderMcpToolLoop: vi.fn() }))

import { dispatchToProvider } from '../chat-provider-dispatch'

describe('DeepSeek dispatch', () => {
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
