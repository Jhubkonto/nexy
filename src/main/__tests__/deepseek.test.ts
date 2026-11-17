import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveVisionSupported } from '../../shared/models'

vi.mock('../ocr', () => ({ recognizeText: vi.fn() }))
import { recognizeText } from '../ocr'
import { describeImagesAsText } from '../image-fallback'

describe('DeepSeek image handling', () => {
  beforeEach(() => vi.resetAllMocks())

  it('recognizes only documented Flash aliases as vision capable', () => {
    expect(resolveVisionSupported('deepseek', 'deepseek-flash')).toBe(true)
    expect(resolveVisionSupported('deepseek', 'deepseek-v4-flash')).toBe(true)
    expect(resolveVisionSupported('deepseek', 'deepseek-v4-pro')).toBe(false)
    expect(resolveVisionSupported('deepseek', 'future-model')).toBe(false)
  })

  it('replaces images with OCR text and handles empty and failed recognition', async () => {
    vi.mocked(recognizeText).mockResolvedValueOnce('hello').mockResolvedValueOnce('').mockRejectedValueOnce(new Error('failed'))
    const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,abc' } }
    const result = await describeImagesAsText([
      { role: 'user', content: [{ type: 'text', text: 'Look' }, image, image, image] },
      { role: 'tool', tool_call_id: '1', content: 'done' },
    ])
    expect(result).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'text', text: '[Image attached — OCR text: hello]' }, { type: 'text', text: '[Image attached — no text detected]' }, { type: 'text', text: '[Image attached — OCR unavailable]' }] },
      { role: 'tool', tool_call_id: '1', content: 'done' },
    ])
  })
})
