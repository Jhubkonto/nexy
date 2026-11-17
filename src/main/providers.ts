import { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { httpsRequestUrl as httpsRequest } from './http-client'
import { broadcastToMobile } from './ws-server'
import {
  storeApiKey,
  removeApiKey,
  retrieveApiKey,
  getProviderCredential,
  fetchAndCacheOpenRouterModels,
  fetchAndCacheOpenAIModels,
  fetchAndCacheGeminiModels,
  fetchAndCacheDeepSeekModels,
  fetchAndCacheAzureModels,
  getCachedProviderModels,
  getAzureEndpoint,
  setAzureEndpoint,
} from './provider-secrets'
import { fetchAndCacheAnthropicModels } from './anthropic-models'
import { debugLog } from './debug-mode'
import { PROVIDERS, getProviderForAgent, getProviderModelIds, isProviderConfigured, DEFAULT_PROVIDER_MODEL } from './provider-registry'
import { abortActiveStream, activeStreamingRequests } from './provider-stream-state'

// ---- public types (re-exported from core-types for consumers that import from 'providers') ----
export type {
  ProviderName,
  MessageContentPart,
  MessageContent,
  ToolCallMessage,
  ProviderMessage,
} from './provider-core-types'

export const NO_PROVIDER_CONFIGURED_MESSAGE = 'No provider configured. Add an API key in Settings.'

// ---- re-exports ----
export {
  DEFAULT_PROVIDER_MODEL,
  PROVIDERS,
  getProviderForAgent,
  getProviderModelIds,
  isProviderConfigured,
  abortActiveStream,
  activeStreamingRequests,
  retrieveApiKey,
  getProviderCredential,
  getAzureEndpoint,
  setAzureEndpoint,
  fetchAndCacheOpenRouterModels,
  fetchAndCacheOpenAIModels,
  fetchAndCacheGeminiModels,
  fetchAndCacheDeepSeekModels,
  fetchAndCacheAzureModels,
  getCachedProviderModels,
}
export { getOpenRouterModels } from './provider-secrets'
export type { ProviderCredentialInput, ProviderCredentialRef } from './credential-vault'
export type { CredentialAccessScope } from './credential-vault'
export type { ProviderConfig } from './provider-registry'
export { toAnthropicMessages, toOpenAICompatibleMessages } from './provider-messages'
export { toAnthropicTools } from './providers/anthropic-provider'
export {
  sendOpenAIMessage,
  sendOpenAINonStreaming,
  sendOpenAIWithTools,
  sendOpenAIWithToolsResilient,
  sendOpenAIWithToolsStream,
  sendAzureMessage,
  sendAzureNonStreaming,
  sendAzureWithTools,
  sendAzureWithToolsStream,
} from './providers/openai-provider'
export {
  sendAnthropicMessage,
  sendAnthropicMessagesStream,
  sendAnthropicWithTools,
  sendAnthropicWithToolsStream,
} from './providers/anthropic-provider'
export { sendProviderWithTools, sendProviderNonStreaming } from './provider-tools'

import type { ProviderName, ProviderMessage } from './provider-core-types'
import type { ProviderCredentialInput } from './credential-vault'
import { sendOpenAIMessage, sendAzureMessage } from './providers/openai-provider'
import { sendAnthropicMessage } from './providers/anthropic-provider'

export function getApiKey(provider: ProviderName): string | null {
  return retrieveApiKey(provider)
}

/**
 * Simple streaming dispatch shared by callers that just need "stream one turn
 * from whatever provider this model maps to": openai → anthropic →
 * OpenAI-compatible baseUrl → Azure. The richer chat path (tool loops,
 * thinking-effort gating) stays in chat-provider-dispatch.ts.
 */
export function streamProviderMessage(
  provider: ProviderName,
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  requestId: string,
  onChunk: (chunk: string) => void,
  generationOptions: { temperature: number; maxTokens: number },
): Promise<string> {
  if (provider === 'openai') {
    return sendOpenAIMessage(requestId, apiKey, model, messages, onChunk, generationOptions)
  }
  if (provider === 'anthropic') {
    const sys = messages.find((m) => m.role === 'system')
    const systemPrompt = sys && typeof sys.content === 'string' ? sys.content : undefined
    return sendAnthropicMessage(requestId, apiKey, model, messages.filter((m) => m.role !== 'system'), systemPrompt, onChunk, generationOptions)
  }
  const providerCfg = PROVIDERS.find((p) => p.name === provider)
  if (providerCfg?.baseUrl) {
    return sendOpenAIMessage(requestId, apiKey, model, messages, onChunk, generationOptions, providerCfg.baseUrl)
  }
  const endpoint = getAzureEndpoint()
  if (!endpoint) {
    throw new Error('Azure endpoint not configured')
  }
  return sendAzureMessage(requestId, apiKey, endpoint, model, messages, onChunk, generationOptions)
}

// ---- IPC handlers ----
export function registerProviderHandlers(): void {
  safeHandle('provider:list', () => {
    return PROVIDERS.map((p) => ({
      ...p,
      configured: !!retrieveApiKey(p.name)
    }))
  })

  safeHandle('provider:set-key', async (_event, provider: string, key: string) => {
    storeApiKey(provider, key)
    if (provider === 'openrouter') {
      await fetchAndCacheOpenRouterModels(key)
    } else if (provider === 'anthropic') {
      await fetchAndCacheAnthropicModels(key)
    } else if (provider === 'openai') {
      await fetchAndCacheOpenAIModels(key)
    } else if (provider === 'gemini') {
      await fetchAndCacheGeminiModels(key)
    } else if (provider === 'deepseek') {
      await fetchAndCacheDeepSeekModels(key)
    } else if (provider === 'azure') {
      const endpoint = getAzureEndpoint()
      if (endpoint) await fetchAndCacheAzureModels(key, endpoint)
    }
    return true
  })

  safeHandle('provider:remove-key', (_event, provider: string) => {
    removeApiKey(provider)
    return true
  })

  safeHandle('provider:has-key', (_event, provider: string) => {
    return !!retrieveApiKey(provider)
  })

  safeHandle('provider:test-key', async (_event, provider: string, key: string, endpoint?: string) => {
    return testProviderKey(provider, key, endpoint)
  })

  safeHandle('provider:get-azure-endpoint', () => {
    return getAzureEndpoint()
  })

  safeHandle('provider:set-azure-endpoint', (_event, endpoint: string) => {
    setAzureEndpoint(endpoint)
    // Endpoint is required to list Azure deployments; refresh the cache now that we have it.
    const key = retrieveApiKey('azure')
    if (key && endpoint) fetchAndCacheAzureModels(key, endpoint).catch(() => {})
    return true
  })

  // Human-approved leg of the Android key-handoff flow: only reachable via an explicit
  // "Send Key" click in ProvidersTab.tsx, in response to the Android-initiated
  // 'provider:key-handoff-request' WS event handled in ws-handlers.ts. The key value is
  // never sent automatically — this is the sole point where it's actually transmitted.
  safeHandle('provider:key-handoff-confirm', (_event, provider: string) => {
    const key = retrieveApiKey(provider as ProviderName)
    if (!key) {
      throw new Error(`No ${provider} API key is configured on this desktop.`)
    }
    broadcastToMobile({ event: 'provider:key-handoff-value', data: { provider, value: key } })
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('provider:key-handoff-sent', { provider })
    })
    return true
  })
}

export async function testProviderKey(provider: string, key: string, endpoint?: string): Promise<{ valid: boolean; error?: string }> {
  try {
      if (provider === 'openai') {
        const result = await httpsRequest(
          'https://api.openai.com/v1/models',
          { method: 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Length': '0' } },
          ''
        )
        if (result.status === 200) {
          fetchAndCacheOpenAIModels(key).catch((err: Error) =>
            debugLog('provider', `openai model-catalog refresh failed: ${err.message}`))
        }
        return { valid: result.status === 200 }
      } else if (provider === 'anthropic') {
        const result = await httpsRequest(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01'
            }
          },
          JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }]
          })
        )
        const valid = result.status !== 401
        if (valid) {
          fetchAndCacheAnthropicModels(key).catch((err: Error) => {
            debugLog('provider', `anthropic model-catalog refresh failed: ${err.message}`)
          })
        }
        return { valid }
      } else if (provider === 'azure') {
        if (!endpoint) return { valid: false, error: 'Azure endpoint is required' }
        const testUrl = `${endpoint.replace(/\/$/, '')}/openai/models?api-version=2024-02-01`
        const result = await httpsRequest(
          testUrl,
          { method: 'GET', headers: { 'api-key': key, 'Content-Length': '0' } },
          ''
        )
        if (result.status === 200) {
          fetchAndCacheAzureModels(key, endpoint).catch((err: Error) =>
            debugLog('provider', `azure model-catalog refresh failed: ${err.message}`))
        }
        return { valid: result.status === 200 }
      }
      const providerCfg = PROVIDERS.find((p) => p.name === provider)
      if (providerCfg?.baseUrl) {
        const result = await httpsRequest(
          `${providerCfg.baseUrl}/models`,
          { method: 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Length': '0' } },
          ''
        )
        if (result.status === 200) {
          if (provider === 'openrouter') {
            await fetchAndCacheOpenRouterModels(key)
          } else if (provider === 'gemini') {
            fetchAndCacheGeminiModels(key).catch((err: Error) =>
              debugLog('provider', `gemini model-catalog refresh failed: ${err.message}`))
          } else if (provider === 'deepseek') {
            await fetchAndCacheDeepSeekModels(key)
          }
        }
        return { valid: result.status === 200 }
      }
      return { valid: false, error: 'Unknown provider' }
    } catch (error) {
      return { valid: false, error: (error as Error).message }
    }
}
