import type { ProviderMessage, MessageContentPart } from './provider-core-types'
import { recognizeText } from './ocr'

export type ImageDescriptionCache = { get: (url: string) => string | undefined; set: (url: string, text: string) => void }

export async function describeImagesAsText(messages: ProviderMessage[], cache?: ImageDescriptionCache): Promise<ProviderMessage[]> {
  return Promise.all(messages.map(async (message): Promise<ProviderMessage> => {
    if (message.role === 'tool' || !Array.isArray(message.content)) return message
    const content = await Promise.all(message.content.map(async (part): Promise<MessageContentPart> => {
      if (part.type !== 'image_url') return part
      const saved = cache?.get(part.image_url.url)
      if (saved !== undefined) return { type: 'text', text: saved }
      try {
        const text = await recognizeText(part.image_url.url)
        const description = text ? `[Image attached — OCR text: ${text}]` : '[Image attached — no text detected]'
        cache?.set(part.image_url.url, description)
        return { type: 'text', text: description }
      } catch {
        return { type: 'text', text: '[Image attached — OCR unavailable]' }
      }
    }))
    return { ...message, content }
  }))
}
