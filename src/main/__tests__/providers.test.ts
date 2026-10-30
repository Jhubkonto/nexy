import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProviderMessage } from '../providers'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockDb, ipcHandlers, mockIpcMain, mockSafeStorage, mockHttpsRequest, mockBrowserWindow, mockBroadcastToMobile } = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const store = new Map<string, string>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        // Handle INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
        if (sql.includes('INSERT OR REPLACE INTO settings') && sql.includes('VALUES (?, ?)')) {
          store.set(args[0] as string, args[1] as string)
        }
        // Handle INSERT with hardcoded key: VALUES ('key', ?)
        const hardcodedInsert = sql.match(/VALUES\s*\('([^']+)',\s*\?\)/)
        if (sql.includes('INSERT OR REPLACE INTO settings') && hardcodedInsert) {
          store.set(hardcodedInsert[1], args[0] as string)
        }
        // Handle DELETE
        if (sql.includes('DELETE FROM settings')) {
          store.delete(args[0] as string)
          if (args[1]) store.delete(args[1] as string)
        }
        return { changes: 1 }
      }),
      get: vi.fn((...args: unknown[]): { value: string } | undefined => {
        // Parameterized: WHERE key = ?
        if (sql.includes('WHERE key = ?') && args[0]) {
          const val = store.get(args[0] as string)
          return val !== undefined ? { value: val } : undefined
        }
        // Hardcoded key: WHERE key = 'xyz'
        const hardcodedGet = sql.match(/WHERE key = '([^']+)'/)
        if (hardcodedGet) {
          const val = store.get(hardcodedGet[1])
          return val !== undefined ? { value: val } : undefined
        }
        return undefined
      }),
      all: vi.fn(() => [])
    })),
    _store: store
  }

  return {
    mockDb,
    ipcHandlers,
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler)
      }),
      removeHandler: vi.fn()
    },
    mockSafeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((text: string) => Buffer.from(`enc:${text}`)),
      decryptString: vi.fn((buf: Buffer) => buf.toString().replace('enc:', ''))
    },
    mockHttpsRequest: vi.fn(),
    mockBrowserWindow: {
      getAllWindows: vi.fn(() => [] as Array<{ isDestroyed: () => boolean; webContents: { send: (...args: unknown[]) => void } }>)
    },
    mockBroadcastToMobile: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  safeStorage: mockSafeStorage,
  BrowserWindow: mockBrowserWindow
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: mockBroadcastToMobile
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handle(channel, handler)
  }
}))

// Mock https module to avoid real network calls in test-key tests
vi.mock('https', () => ({
  default: {
    request: mockHttpsRequest
  }
}))

// ── Test helpers ───────────────────────────────────────────────────────────────

async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const event = {}
  return handler(event, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Providers — IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    ipcHandlers.clear()
    mockDb._store.clear()

    const mod = await import('../providers')
    mod.activeStreamingRequests.clear()
    mod.registerProviderHandlers()
  })

  describe('provider:set-key', () => {
    it('prov-m-1: encrypts and stores key', async () => {
      await invokeHandler('provider:set-key', 'openai', 'sk-test-key-123')

      // Should have stored encrypted key and encryption flag
      expect(mockDb._store.get('byok_openai_key')).toBeDefined()
      expect(mockDb._store.get('byok_openai_key_encrypted')).toBe('true')
    })

    it('stores plaintext when encryption unavailable', async () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValueOnce(false)
      await invokeHandler('provider:set-key', 'openai', 'sk-plain-key')

      expect(mockDb._store.get('byok_openai_key')).toBe('sk-plain-key')
      expect(mockDb._store.get('byok_openai_key_encrypted')).toBe('false')
    })
  })

  describe('provider:remove-key', () => {
    it('prov-m-2: deletes key from DB', async () => {
      // Store a key first
      mockDb._store.set('byok_openai_key', 'some-value')
      mockDb._store.set('byok_openai_key_encrypted', 'true')

      const result = await invokeHandler('provider:remove-key', 'openai')
      expect(result).toBe(true)
    })
  })

  describe('provider:has-key', () => {
    it('prov-m-3: returns true when key exists', async () => {
      mockDb._store.set('byok_openai_key', 'some-encrypted-value')
      const result = await invokeHandler('provider:has-key', 'openai')
      expect(result).toBe(true)
    })

    it('prov-m-4: returns false when no key', async () => {
      const result = await invokeHandler('provider:has-key', 'anthropic')
      expect(result).toBe(false)
    })
  })

  describe('provider:list', () => {
    it('prov-m-8: returns all configured providers', async () => {
      // Store an OpenAI key
      mockDb._store.set('byok_openai_key', 'some-value')

      const result = await invokeHandler('provider:list')
      expect(result.map((p: { name: string }) => p.name)).toEqual([
        'openai',
        'anthropic',
        'azure',
        'gemini',
        'mistral',
        'groq',
        'xai',
        'openrouter',
      ])

      const openai = result.find((p: { name: string }) => p.name === 'openai')
      expect(openai.configured).toBe(true)

      const anthropic = result.find((p: { name: string }) => p.name === 'anthropic')
      expect(anthropic.configured).toBe(false)

      const azure = result.find((p: { name: string }) => p.name === 'azure')
      expect(azure.configured).toBe(false)
    })
  })

  describe('provider:key-handoff-confirm', () => {
    it('sends the key to Android and notifies desktop windows once a human approves', async () => {
      mockDb._store.set('byok_anthropic_key', 'sk-ant-secret')
      const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockBrowserWindow.getAllWindows.mockReturnValueOnce([win])

      const result = await invokeHandler('provider:key-handoff-confirm', 'anthropic')

      expect(result).toBe(true)
      expect(mockBroadcastToMobile).toHaveBeenCalledWith({
        event: 'provider:key-handoff-value',
        data: { provider: 'anthropic', value: 'sk-ant-secret' },
      })
      expect(win.webContents.send).toHaveBeenCalledWith('provider:key-handoff-sent', { provider: 'anthropic' })
    })

    it('rejects when no key is configured for the provider, without transmitting anything', async () => {
      await expect(invokeHandler('provider:key-handoff-confirm', 'anthropic')).rejects.toThrow()
      expect(mockBroadcastToMobile).not.toHaveBeenCalled()
    })
  })

  describe('provider:get/set-azure-endpoint', () => {
    it('set-azure-endpoint stores the value', async () => {
      const result = await invokeHandler('provider:set-azure-endpoint', 'https://myresource.openai.azure.com')
      expect(result).toBe(true)
      expect(mockDb._store.get('byok_azure_endpoint')).toBe('https://myresource.openai.azure.com')
    })

    it('get-azure-endpoint retrieves stored value', async () => {
      mockDb._store.set('byok_azure_endpoint', 'https://myresource.openai.azure.com')
      const ep = await invokeHandler('provider:get-azure-endpoint')
      expect(ep).toBe('https://myresource.openai.azure.com')
    })
  })

  describe('sendOpenAIMessage', () => {
    it('serializes assistant tool calls and tool results', async () => {
      let requestBody = ''
      mockHttpsRequest.mockImplementationOnce((options: unknown, callback: (res: EventEmitter) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          write: (chunk: string) => void
          end: () => void
        }
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number
          headers?: Record<string, string>
        }

        res.statusCode = 200
        res.headers = { 'content-type': 'text/event-stream' }
        req.write = (chunk: string) => {
          requestBody += chunk
        }
        req.end = () => {
          callback(res)
          res.emit('data', 'data: {"choices":[{"delta":{"content":"tool ok"}}]}\n\n')
          res.emit('data', 'data: [DONE]\n\n')
          res.emit('end')
        }

        return req
      })

      const messages = [
        { role: 'system' as const, content: 'You are helpful.' },
        {
          role: 'assistant' as const,
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'delegate_to_agent', arguments: '{"agent_id":"agent-1"}' }
            }
          ]
        },
        { role: 'tool' as const, tool_call_id: 'call-1', content: 'Specialist result' },
        { role: 'user' as const, content: 'Continue' }
      ] satisfies ProviderMessage[]

      const { sendOpenAIMessage } = await import('../providers')
      const streamed: string[] = []
      const result = await sendOpenAIMessage('conv-openai', 'sk-test', 'gpt-4o', messages, (chunk) => streamed.push(chunk))

      expect(result).toBe('tool ok')
      expect(streamed).toEqual(['tool ok'])
      expect(JSON.parse(requestBody)).toMatchObject({
        model: 'gpt-4o',
        messages
      })
    })

    it('requests usage in the stream and reports it via onUsage', async () => {
      let requestBody = ''
      mockHttpsRequest.mockImplementationOnce((options: unknown, callback: (res: EventEmitter) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          write: (chunk: string) => void
          end: () => void
        }
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number
          headers?: Record<string, string>
        }

        res.statusCode = 200
        res.headers = { 'content-type': 'text/event-stream' }
        req.write = (chunk: string) => {
          requestBody += chunk
        }
        req.end = () => {
          callback(res)
          res.emit('data', 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')
          res.emit('data', 'data: {"choices":[],"usage":{"prompt_tokens":1203,"completion_tokens":42,"total_tokens":1245}}\n\n')
          res.emit('data', 'data: [DONE]\n\n')
          res.emit('end')
        }

        return req
      })

      const messages = [{ role: 'user' as const, content: 'who are you?' }] satisfies ProviderMessage[]

      const { sendOpenAIMessage } = await import('../providers')
      const usageEvents: { inputTokens: number; outputTokens: number }[] = []
      const result = await sendOpenAIMessage('conv-usage', 'sk-test', 'gpt-4o', messages, () => {}, {
        onUsage: (usage) => usageEvents.push(usage),
      })

      expect(result).toBe('hi')
      expect(usageEvents).toEqual([{ inputTokens: 1203, outputTokens: 42 }])
      expect(JSON.parse(requestBody)).toMatchObject({ stream_options: { include_usage: true } })
    })
  })

  describe('streaming tool rounds', () => {
    it('streams OpenAI text while buffering fragmented tool-call arguments', async () => {
      let requestBody = ''
      mockHttpsRequest.mockImplementationOnce((options: unknown, callback: (res: EventEmitter) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          write: (chunk: string) => void
          end: () => void
        }
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number
          headers?: Record<string, string>
        }
        res.statusCode = 200
        res.headers = { 'content-type': 'text/event-stream' }
        req.write = (chunk: string) => { requestBody += chunk }
        req.end = () => {
          callback(res)
          res.emit('data', 'data: {"model":"gpt-test","choices":[{"delta":{"content":"I will "}}]}\n\n')
          res.emit('data', 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"server-1__click","arguments":"{\\"target\\":"}}]}}]}\n\n')
          res.emit('data', 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"submit\\"}"}}]}}]}\n\n')
          res.emit('data', 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n')
          res.emit('data', 'data: [DONE]\n\n')
          res.emit('end')
        }
        return req
      })

      const mod = await import('../providers')
      const streamed: string[] = []
      const result = await mod.sendOpenAIWithToolsStream(
        'sk-test',
        'gpt-test',
        [{ role: 'user', content: 'click submit' }],
        [{
          type: 'function',
          function: { name: 'server-1__click', description: 'Click', parameters: { type: 'object' } },
        }],
        'auto',
        (chunk) => streamed.push(chunk),
        { conversationId: 'conv-stream' },
      )

      expect(streamed).toEqual(['I will '])
      expect(result).toMatchObject({
        content: 'I will ',
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: { target: 'submit' } }],
        model: 'gpt-test',
      })
      expect(JSON.parse(requestBody)).toMatchObject({ stream: true, tool_choice: 'auto' })
    })

    it('streams Anthropic text while buffering input_json_delta fragments', async () => {
      mockHttpsRequest.mockImplementationOnce((options: unknown, callback: (res: EventEmitter) => void) => {
        const req = new EventEmitter() as EventEmitter & { write: (chunk: string) => void; end: () => void }
        const res = new EventEmitter() as EventEmitter & { statusCode?: number; headers?: Record<string, string> }
        res.statusCode = 200
        res.headers = { 'content-type': 'text/event-stream' }
        req.write = () => {}
        req.end = () => {
          callback(res)
          res.emit('data', 'data: {"type":"message_start","message":{"model":"claude-test","usage":{"input_tokens":10}}}\n\n')
          res.emit('data', 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n')
          res.emit('data', 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I will "}}\n\n')
          res.emit('data', 'data: {"type":"content_block_stop","index":0}\n\n')
          res.emit('data', 'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-ant","name":"server-1__click","input":{}}}\n\n')
          res.emit('data', 'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"target\\":"}}\n\n')
          res.emit('data', 'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"submit\\"}"}}\n\n')
          res.emit('data', 'data: {"type":"content_block_stop","index":1}\n\n')
          res.emit('data', 'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\n')
          res.emit('data', 'data: {"type":"message_stop"}\n\n')
          res.emit('end')
        }
        return req
      })

      const mod = await import('../providers')
      const streamed: string[] = []
      const result = await mod.sendAnthropicWithToolsStream(
        'sk-ant-test',
        'claude-test',
        [{ role: 'user', content: 'click submit' }],
        [{
          type: 'function',
          function: { name: 'server-1__click', description: 'Click', parameters: { type: 'object' } },
        }],
        'auto',
        (chunk) => streamed.push(chunk),
        { conversationId: 'conv-anthropic-stream' },
      )

      expect(streamed).toEqual(['I will '])
      expect(result).toMatchObject({
        content: 'I will ',
        toolCalls: [{ id: 'call-ant', name: 'server-1__click', arguments: { target: 'submit' } }],
        model: 'claude-test',
      })
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    })
  })

  describe('abortActiveStream', () => {
    it('keeps other conversation streams active when aborting by conversation id', async () => {
      const { abortActiveStream, activeStreamingRequests } = await import('../providers')
      const req1 = { destroy: vi.fn() } as unknown as { destroy: ReturnType<typeof vi.fn> }
      const req2 = { destroy: vi.fn() } as unknown as { destroy: ReturnType<typeof vi.fn> }

      activeStreamingRequests.set('conv-1', req1 as never)
      activeStreamingRequests.set('conv-2', req2 as never)

      abortActiveStream('conv-1')

      expect(req1.destroy).toHaveBeenCalledOnce()
      expect(req2.destroy).not.toHaveBeenCalled()
      expect(activeStreamingRequests.size).toBe(1)
      expect(activeStreamingRequests.has('conv-2')).toBe(true)
    })

    it('fans a conversation stop out to delegated specialist stream ids', async () => {
      const { abortActiveStream, activeStreamingRequests } = await import('../providers')
      const root = { destroy: vi.fn() }
      const child = { destroy: vi.fn() }
      const unrelated = { destroy: vi.fn() }
      activeStreamingRequests.set('conv-1', root as never)
      activeStreamingRequests.set('conv-1:step-a', child as never)
      activeStreamingRequests.set('conv-10:step-b', unrelated as never)

      abortActiveStream('conv-1')

      expect(root.destroy).toHaveBeenCalledOnce()
      expect(child.destroy).toHaveBeenCalledOnce()
      expect(unrelated.destroy).not.toHaveBeenCalled()
    })

    it('aborts all active streams when no conversation id is provided', async () => {
      const { abortActiveStream, activeStreamingRequests } = await import('../providers')
      const req1 = { destroy: vi.fn() } as unknown as { destroy: ReturnType<typeof vi.fn> }
      const req2 = { destroy: vi.fn() } as unknown as { destroy: ReturnType<typeof vi.fn> }

      activeStreamingRequests.set('conv-1', req1 as never)
      activeStreamingRequests.set('conv-2', req2 as never)

      abortActiveStream()

      expect(req1.destroy).toHaveBeenCalledOnce()
      expect(req2.destroy).toHaveBeenCalledOnce()
      expect(activeStreamingRequests.size).toBe(0)
    })
  })
})

describe('provider routing', () => {
  beforeEach(() => {
    mockDb._store.clear()
  })

  it('routes bare Anthropic model ids to Anthropic', async () => {
    const { getProviderForAgent } = await import('../providers')

    expect(getProviderForAgent('claude-haiku-4.5')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4.5',
    })
  })

  it('routes vendor-prefixed OpenRouter ids to OpenRouter without cache membership', async () => {
    const { getProviderForAgent } = await import('../providers')

    expect(getProviderForAgent('anthropic/claude-haiku-4.5')).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
    })
  })

  it('normalizes tilde-prefixed OpenRouter ids before routing', async () => {
    const { getProviderForAgent } = await import('../providers')

    expect(getProviderForAgent('~anthropic/claude-haiku-4.5')).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
    })
  })
})

describe('Anthropic tool helpers', () => {
  it('extracts the first system message into the system field', async () => {
    const { toAnthropicMessages } = await import('../providers')
    const result = toAnthropicMessages([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' }
    ])

    expect(result.system).toBe('System prompt')
    expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('converts a user image message to an Anthropic image block', async () => {
    const { toAnthropicMessages } = await import('../providers')
    const result = toAnthropicMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } }
        ]
      }
    ] satisfies ProviderMessage[])

    expect(result.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } }
        ]
      }
    ])
  })

  it('converts assistant tool calls into tool_use blocks and preserves text', async () => {
    const { toAnthropicMessages } = await import('../providers')
    const result = toAnthropicMessages([
      {
        role: 'assistant',
        content: 'Working on it',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'browser__click', arguments: '{"selector":"#go"}' }
          }
        ]
      }
    ] satisfies ProviderMessage[])

    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Working on it' },
          { type: 'tool_use', id: 'call-1', name: 'browser__click', input: { selector: '#go' } }
        ]
      }
    ])
  })

  it('groups consecutive tool messages into a single user message', async () => {
    const { toAnthropicMessages } = await import('../providers')
    const result = toAnthropicMessages([
      { role: 'tool', tool_call_id: 'call-1', content: 'first result' },
      { role: 'tool', tool_call_id: 'call-2', content: 'second result' }
    ] satisfies ProviderMessage[])

    expect(result.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'first result' }] },
          { type: 'tool_result', tool_use_id: 'call-2', content: [{ type: 'text', text: 'second result' }] }
        ]
      }
    ])
  })

  it('embeds images via tool message images field (native format)', async () => {
    const { toAnthropicMessages } = await import('../providers')
    const result = toAnthropicMessages([
      { role: 'tool', tool_call_id: 'call-1', content: 'first step output', images: [{ dataUrl: 'data:image/png;base64,img1' }] },
      { role: 'tool', tool_call_id: 'call-2', content: 'second step output', images: [{ dataUrl: 'data:image/png;base64,img2' }] }
    ] satisfies ProviderMessage[])

    expect(result.messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: [
              { type: 'text', text: 'first step output' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img1' } }
            ]
          },
          {
            type: 'tool_result',
            tool_use_id: 'call-2',
            content: [
              { type: 'text', text: 'second step output' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img2' } }
            ]
          }
        ]
      }
    ])
  })

  it('embeds screenshot follow-up images inside the last tool result block (legacy sentinel fallback)', async () => {
    const { toAnthropicMessages } = await import('../providers')
    const result = toAnthropicMessages([
      { role: 'tool', tool_call_id: 'call-1', content: 'first step output' },
      { role: 'tool', tool_call_id: 'call-2', content: 'second step output' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '[Browser screenshots from current step]' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,stepimg' } }
        ]
      }
    ] satisfies ProviderMessage[])

    expect(result.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'first step output' }] },
          {
            type: 'tool_result',
            tool_use_id: 'call-2',
            content: [
              { type: 'text', text: 'second step output' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'stepimg' } }
            ]
          }
        ]
      }
    ])
  })

  it('does not merge non-screenshot user messages after tool results', async () => {
    const { toAnthropicMessages } = await import('../providers')
    const result = toAnthropicMessages([
      { role: 'tool', tool_call_id: 'call-1', content: 'step output' },
      { role: 'user', content: 'A normal follow-up' }
    ] satisfies ProviderMessage[])

    expect(result.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'step output' }] }
        ]
      },
      { role: 'user', content: 'A normal follow-up' }
    ])
  })

  it('converts tool definitions and returns a name map', async () => {
    const { toAnthropicTools } = await import('../providers')
    const parameters = { type: 'object', properties: { q: { type: 'string' } } }
    const result = toAnthropicTools([
      {
        type: 'function',
        function: { name: 'server.one', description: 'First tool', parameters }
      },
      {
        type: 'function',
        function: { name: 'server?one', description: 'Second tool', parameters: { type: 'object', properties: {} } }
      }
    ])

    expect(result.tools).toEqual([
      { name: 'server_one', description: 'First tool', input_schema: parameters },
      { name: 'server_one_2', description: 'Second tool', input_schema: { type: 'object', properties: {} } }
    ])
    expect(result.nameMap.get('server_one')).toBe('server.one')
    expect(result.nameMap.get('server_one_2')).toBe('server?one')
  })

  it('truncates long normalized tool names to 64 characters', async () => {
    const { toAnthropicTools } = await import('../providers')
    const longName = `tool-${'x'.repeat(80)}`

    const result = toAnthropicTools([
      {
        type: 'function',
        function: {
          name: longName,
          description: 'Long tool',
          parameters: { type: 'object', properties: {} }
        }
      }
    ])

    expect(result.tools[0].name).toHaveLength(64)
    expect(result.nameMap.get(result.tools[0].name)).toBe(longName)
  })

  it('toOpenAICompatibleMessages: passes through messages without tool images unchanged', async () => {
    const { toOpenAICompatibleMessages } = await import('../providers')
    const messages: ProviderMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'tool', tool_call_id: 'c1', content: 'no images here' }
    ]
    const result = toOpenAICompatibleMessages(messages)
    expect(result).toEqual(messages)
  })

  it('toOpenAICompatibleMessages: strips images from tool message and emits labeled synthetic user message', async () => {
    const { toOpenAICompatibleMessages } = await import('../providers')
    const messages: ProviderMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'tool', tool_call_id: 'c1', content: 'result1', images: [{ dataUrl: 'data:image/png;base64,aaa' }] }
    ]
    const result = toOpenAICompatibleMessages(messages)
    expect(result).toHaveLength(3)
    expect(result[1]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'result1' })
    expect(result[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[Screenshots from tool: c1]' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } }
      ]
    })
  })

  it('toOpenAICompatibleMessages: groups images per tool in synthetic user message', async () => {
    const { toOpenAICompatibleMessages } = await import('../providers')
    const messages: ProviderMessage[] = [
      { role: 'tool', tool_call_id: 'c1', content: 'r1', images: [{ dataUrl: 'data:image/png;base64,img1' }] },
      { role: 'tool', tool_call_id: 'c2', content: 'r2', images: [{ dataUrl: 'data:image/png;base64,img2a' }, { dataUrl: 'data:image/png;base64,img2b' }] }
    ]
    const result = toOpenAICompatibleMessages(messages)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'r1' })
    expect(result[1]).toEqual({ role: 'tool', tool_call_id: 'c2', content: 'r2' })
    expect(result[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[Screenshots from tool: c1]' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img1' } },
        { type: 'text', text: '[Screenshots from tool: c2]' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img2a' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img2b' } }
      ]
    })
  })

  it('toOpenAICompatibleMessages: tool with no images emits no synthetic message', async () => {
    const { toOpenAICompatibleMessages } = await import('../providers')
    const messages: ProviderMessage[] = [
      { role: 'tool', tool_call_id: 'c1', content: 'r1' },
      { role: 'tool', tool_call_id: 'c2', content: 'r2', images: [{ dataUrl: 'data:image/png;base64,img2' }] }
    ]
    const result = toOpenAICompatibleMessages(messages)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'r1' })
    expect(result[1]).toEqual({ role: 'tool', tool_call_id: 'c2', content: 'r2' })
    const syntheticMsg = result[2] as { role: string; content: { type: string; text?: string }[] }
    // Only c2 label should appear, not c1
    expect(syntheticMsg.content.some(p => p.type === 'text' && p.text === '[Screenshots from tool: c1]')).toBe(false)
    expect(syntheticMsg.content.some(p => p.type === 'text' && p.text === '[Screenshots from tool: c2]')).toBe(true)
  })
})
