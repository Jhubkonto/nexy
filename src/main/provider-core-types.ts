export type ProviderName = 'openai' | 'anthropic' | 'azure' | 'gemini' | 'mistral' | 'groq' | 'xai' | 'openrouter' | 'deepseek'

export type {
  ContinuationContentPart as MessageContentPart,
  ContinuationContent as MessageContent,
  ContinuationToolCall as ToolCallMessage,
  ContinuationMessage as ProviderMessage,
} from '../shared/conversation-continuity'
