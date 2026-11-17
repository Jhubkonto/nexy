export type ProviderName = 'openai' | 'anthropic' | 'azure' | 'gemini' | 'mistral' | 'groq' | 'xai' | 'openrouter' | 'deepseek'

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type MessageContent = string | MessageContentPart[]

export interface ToolCallMessage {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ProviderMessage =
  | { role: 'system' | 'user'; content: MessageContent }
  | { role: 'assistant'; content: MessageContent | null; tool_calls?: ToolCallMessage[]; reasoning_content?: string }
  | { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }
