import type { ProviderMessage, MessageContentPart } from './provider-core-types'
import { recognizeText } from './ocr'

export async function describeImagesAsText(messages: ProviderMessage[]): Promise<ProviderMessage[]> {
  return Promise.all(messages.map(async (message): Promise<ProviderMessage> => {
    if (message.role === 'tool' || !Array.isArray(message.content)) return message
    const content = await Promise.all(message.content.map(async (part): Promise<MessageContentPart> => {
      if (part.type !== 'image_url') return part
      try {
        const text = await recognizeText(part.image_url.url)
        return { type: 'text', text: text ? `[Image attached — OCR text: ${text}]` : '[Image attached — no text detected]' }
      } catch {
        return { type: 'text', text: '[Image attached — OCR unavailable]' }
      }
    }))
    return { ...message, content }
  }))
}
