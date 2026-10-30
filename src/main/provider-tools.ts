import type { ProviderNonStreamResult, ToolChoice, ToolDefinition } from './provider-types'
import type { ProviderName } from './provider-core-types'
import type { ProviderMessage } from './provider-core-types'
import type { ProviderCredentialInput } from './credential-vault'
import { getAzureEndpoint } from './provider-secrets'
import { PROVIDERS } from './provider-registry'
import { sendAnthropicWithTools } from './providers/anthropic-provider'
import {
  sendOpenAIWithTools,
  sendOpenAINonStreaming,
  sendAzureNonStreaming,
  sendAzureWithTools,
} from './providers/openai-provider'

const OPENAI_COMPATIBLE_PROVIDERS: ProviderName[] = ['openrouter', 'groq', 'mistral', 'gemini', 'xai']

export const NO_PROVIDER_CONFIGURED_MESSAGE = 'No provider configured. Add an API key in Settings.'

/**
 * Provider-agnostic non-streaming completion with tool calling support.
 * Routes to the appropriate backend based on provider.
 */
export async function sendProviderWithTools(
  provider: ProviderName,
  apiKey: ProviderCredentialInput | null,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  if (!apiKey) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }
  if (provider === 'anthropic') {
    return sendAnthropicWithTools(apiKey, model, messages, tools, toolChoice, options)
  }
  if (provider === 'openai') {
    return sendOpenAIWithTools(apiKey, model, messages, tools, toolChoice, options)
  }
  if (provider === 'azure') {
    const endpoint = getAzureEndpoint()
    if (!endpoint) {
      throw new Error('Azure endpoint not configured')
    }
    return sendAzureWithTools(apiKey, endpoint, model, messages, tools, toolChoice, options)
  }
  if (OPENAI_COMPATIBLE_PROVIDERS.includes(provider)) {
    const baseUrl = PROVIDERS.find((p) => p.name === provider)?.baseUrl
    return sendOpenAIWithTools(apiKey, model, messages, tools, toolChoice, options, baseUrl)
  }
  throw new Error(
    `Provider "${provider}" does not support tool-calling requests yet. Use OpenAI, Anthropic, Azure, or an OpenAI-compatible provider.`
  )
}

/**
 * Provider-agnostic non-streaming completion. Routes to the correct backend based on provider.
 */
export async function sendProviderNonStreaming(
  provider: ProviderName,
  apiKey: ProviderCredentialInput | null,
  model: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number; conversationId?: string } = {}
): Promise<ProviderNonStreamResult> {
  if (!apiKey) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }
  if (provider === 'anthropic') {
    return sendAnthropicWithTools(apiKey, model, messages, [], 'none', options)
  }
  if (provider === 'openai') {
    return sendOpenAINonStreaming(apiKey, model, messages, options)
  }
  if (provider === 'azure') {
    const endpoint = getAzureEndpoint()
    if (!endpoint) {
      throw new Error('Azure endpoint not configured')
    }
    return sendAzureNonStreaming(apiKey, endpoint, model, messages, options)
  }
  if (OPENAI_COMPATIBLE_PROVIDERS.includes(provider)) {
    const baseUrl = PROVIDERS.find((entry) => entry.name === provider)?.baseUrl
    return sendOpenAINonStreaming(apiKey, model, messages, options, baseUrl)
  }
  throw new Error(`Provider "${provider}" does not support non-streaming requests.`)
}
