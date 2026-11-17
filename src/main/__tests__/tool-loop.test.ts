import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCallMcpTool, mockServers, mockDbRun, mockDbPrepare } = vi.hoisted(() => {
  const run = vi.fn()
  return {
    mockCallMcpTool: vi.fn(),
    mockServers: new Map<string, { config: { name: string } }>(),
    mockDbRun: run,
    mockDbPrepare: vi.fn().mockReturnValue({ run }),
  }
})

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../database', () => ({ getDatabase: vi.fn().mockReturnValue({ prepare: mockDbPrepare }) }))
vi.mock('../mcp', () => ({
  callMcpTool: mockCallMcpTool,
  servers: mockServers
}))

import { MCP_MAX_ITERATIONS, MCP_REQUIRED_ITERATIONS, MAX_TOOL_RESULT_CHARS, MAX_LOOP_CONTEXT_CHARS, runProviderMcpToolLoop } from '../tool-loop'
import type { ModelToolCaller, ModelToolStreamCaller } from '../tool-loop'
import type { ProviderMessage } from '../providers'
import type { ToolDefinition } from '../provider-types'

function makeWebContents() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false)
  } as unknown as Electron.WebContents
}

const toolDefs: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'server-1__click',
      description: 'Click something',
      parameters: { type: 'object', properties: {} }
    }
  }
]

const toolDefsWithSnapshot: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'server-1__browser_navigate',
      description: 'Navigate to URL',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'server-1__browser_snapshot',
      description: 'Capture accessibility snapshot',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'server-1__browser_fill_form',
      description: 'Fill form fields',
      parameters: { type: 'object', properties: {} }
    }
  }
]

const toolMap = new Map<string, { serverId: string; toolName: string }>([
  ['server-1__click', { serverId: 'server-1', toolName: 'click' }]
])

const toolMapWithSnapshot = new Map<string, { serverId: string; toolName: string }>([
  ['server-1__browser_navigate', { serverId: 'server-1', toolName: 'browser_navigate' }],
  ['server-1__browser_snapshot', { serverId: 'server-1', toolName: 'browser_snapshot' }],
  ['server-1__browser_fill_form', { serverId: 'server-1', toolName: 'browser_fill_form' }]
])

describe('runProviderMcpToolLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockServers.clear()
    mockServers.set('server-1', { config: { name: 'Browser Server' } })
    mockCallMcpTool.mockResolvedValue({ success: true, result: 'clicked' })
  })

  it('carries reasoning from an assistant tool call into the next round', async () => {
    const rounds: ProviderMessage[][] = []
    const caller: ModelToolCaller = vi.fn(async (messages) => {
      rounds.push([...messages])
      return rounds.length === 1
        ? { content: null, reasoningContent: 'tool reasoning', toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: {} }] }
        : { content: 'done', toolCalls: [] }
    })
    await runProviderMcpToolLoop(caller, [{ role: 'user', content: 'hello' }], toolDefs, toolMap, 'agent-1', null, makeWebContents(), vi.fn())
    expect(rounds[1]).toContainEqual(expect.objectContaining({ role: 'assistant', reasoning_content: 'tool reasoning' }))
  })

  it('stops when no tool calls in first response', async () => {
    const caller: ModelToolCaller = vi.fn().mockResolvedValue({ content: 'final answer', toolCalls: [] })
    const onChunk = vi.fn()

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'hello' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      onChunk
    )

    expect(result).toBe('final answer')
    expect(onChunk).toHaveBeenCalledWith('final answer')
    expect(caller).toHaveBeenCalledWith(
      expect.any(Array),
      toolDefs,
      'auto'
    )
  })

  it('calls with required for the first required iterations then auto', async () => {
    const choices: Array<'auto' | 'required' | 'none'> = []
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      choices.push(toolChoice)
      if (choices.length <= MCP_REQUIRED_ITERATIONS + 1) {
        return {
          content: null,
          toolCalls: [{ id: `call-${choices.length}`, name: 'server-1__click', arguments: {} }]
        }
      }
      return { content: 'done', toolCalls: [] }
    })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'hello' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn()
    )

    expect(choices.slice(0, MCP_REQUIRED_ITERATIONS)).toEqual(Array(MCP_REQUIRED_ITERATIONS).fill('required'))
    expect(choices[MCP_REQUIRED_ITERATIONS]).toBe('auto')
  })

  it('appends tool results and continues the loop', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: { target: 'submit' } }]
      })
      .mockImplementationOnce(async (messages) => {
        expect(messages).toContainEqual({
          role: 'tool',
          tool_call_id: 'call-1',
          content: 'clicked'
        })
        return { content: 'finished', toolCalls: [] }
      })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click submit' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn()
    )

    expect(result).toBe('finished')
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      'server-1',
      'click',
      { target: 'submit' },
      'agent-1',
      expect.any(Object),
      undefined,
      undefined,
      undefined
    )
  })

  it('attaches images to the tool message when a step produces images', async () => {
    mockCallMcpTool.mockResolvedValueOnce({
      success: true,
      result: 'captured',
      images: [{ dataUrl: 'data:image/png;base64,abc' }]
    })

    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: {} }]
      })
      .mockImplementationOnce(async (messages) => {
        const toolMsg = messages.find(
          (m: ProviderMessage): m is ProviderMessage & { role: 'tool'; images?: { dataUrl: string }[] } =>
            m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === 'call-1'
        )
        expect(toolMsg).toBeDefined()
        expect(toolMsg?.images).toEqual([{ dataUrl: 'data:image/png;base64,abc' }])
        // No synthetic user message should be present
        const syntheticMsg = messages.find(
          (m: ProviderMessage) => m.role === 'user' &&
            Array.isArray(m.content) &&
            (m.content as { type: string; text?: string }[])[0]?.text === '[Browser screenshots from current step]'
        )
        expect(syntheticMsg).toBeUndefined()
        return { content: 'done', toolCalls: [] }
      })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'take screenshot' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn()
    )
  })

  it('handles unknown tool gracefully', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'missing__tool', arguments: { foo: 'bar' } }]
      })
      .mockImplementationOnce(async (messages) => {
        expect(messages).toContainEqual({
          role: 'tool',
          tool_call_id: 'call-1',
          content: 'Error: Unknown tool "missing__tool"'
        })
        return { content: 'recovered', toolCalls: [] }
      })

    const webContents = makeWebContents()
    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'use missing tool' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      webContents,
      vi.fn()
    )

    expect(result).toBe('recovered')
    expect(webContents.send).toHaveBeenCalledWith('chat:tool-call-event', expect.objectContaining({
      toolName: 'tool',
      success: false,
      result: 'Error: Unknown tool "missing__tool"'
    }))
  })

  it('forwards the conversationId passed in into the emitted chat:tool-call-event payload', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: { target: 'submit' } }]
      })
      .mockResolvedValueOnce({ content: 'finished', toolCalls: [] })

    const webContents = makeWebContents()
    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click submit' }],
      toolDefs,
      toolMap,
      'agent-1',
      'conversation-42',
      webContents,
      vi.fn()
    )

    expect(webContents.send).toHaveBeenCalledWith('chat:tool-call-event', expect.objectContaining({
      conversationId: 'conversation-42'
    }))
    expect(mockDbPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO conversation_tool_calls'))
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      'conversation-42',
      'click',
      'Browser Server',
      1,
      expect.any(Number),
    )
  })

  it('does not insert a conversation_tool_calls row when conversationId is null', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: { target: 'submit' } }]
      })
      .mockResolvedValueOnce({ content: 'finished', toolCalls: [] })

    const webContents = makeWebContents()
    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click submit' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      webContents,
      vi.fn()
    )

    expect(mockDbRun).not.toHaveBeenCalled()
  })

  it('uses the optional tool-finished callback instead of direct UI emission', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: { target: 'submit' } }]
      })
      .mockResolvedValueOnce({ content: 'finished', toolCalls: [] })

    const webContents = makeWebContents()
    const onToolFinished = vi.fn()
    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click submit' }],
      toolDefs,
      toolMap,
      'agent-1',
      'conversation-42',
      webContents,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onToolFinished,
    )

    expect(onToolFinished).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-42',
      toolName: 'click',
      serverName: 'Browser Server',
      args: { target: 'submit' },
      result: 'clicked',
      success: true,
    }))
    expect(webContents.send).not.toHaveBeenCalledWith('chat:tool-call-event', expect.anything())
  })

  it('emits conversationId: null when called from a non-chat caller', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: { target: 'submit' } }]
      })
      .mockResolvedValueOnce({ content: 'finished', toolCalls: [] })

    const webContents = makeWebContents()
    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click submit' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      webContents,
      vi.fn()
    )

    expect(webContents.send).toHaveBeenCalledWith('chat:tool-call-event', expect.objectContaining({
      conversationId: null
    }))
  })

  it('caps at max iterations and requests a final answer without tools', async () => {
    const caller: ModelToolCaller = vi.fn(async (_messages, tools, toolChoice) => {
      if (toolChoice === 'none') {
        expect(tools).toBeUndefined()
        return { content: 'fallback final', toolCalls: [] }
      }
      return {
        content: null,
        toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }]
      }
    })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'loop forever' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn()
    )

    expect(result).toBe('fallback final')
    expect(caller).toHaveBeenCalledTimes(MCP_MAX_ITERATIONS + 1)
    expect(caller).toHaveBeenLastCalledWith(expect.any(Array), undefined, 'none')
  })

  it('prepends the directive to an existing system prompt', async () => {
    const caller: ModelToolCaller = vi.fn(async (messages) => {
      expect(messages[0]).toMatchObject({
        role: 'system',
        content: expect.stringContaining('Original system')
      })
      expect((messages[0] as ProviderMessage).content).toEqual(expect.stringContaining('You have browser automation tools available: click.'))
      return { content: 'ok', toolCalls: [] }
    })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'system', content: 'Original system' }, { role: 'user', content: 'hello' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn()
    )
  })

  it('recovers when model returns planning text after a pure inspection step', async () => {
    const choices: Array<'auto' | 'required' | 'none'> = []

    mockCallMcpTool
      .mockResolvedValueOnce({ success: true, result: 'navigated' })      // browser_navigate
      .mockResolvedValueOnce({ success: true, result: 'accessibility tree' }) // browser_snapshot
      .mockResolvedValueOnce({ success: true, result: 'form filled' })     // browser_fill_form

    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      choices.push(toolChoice)
      switch (choices.length) {
        case 1: return { content: null, toolCalls: [{ id: 'c1', name: 'server-1__browser_navigate', arguments: {} }] }
        case 2: return { content: null, toolCalls: [{ id: 'c2', name: 'server-1__browser_snapshot', arguments: {} }] }
        case 3:
          // Planning text after the inspection step — should NOT exit; recovery should fire
          return { content: 'I can see the form. Now let me fill it out.', toolCalls: [] }
        case 4:
          // Recovery forced 'required' — model must call a tool
          expect(toolChoice).toBe('required')
          return { content: null, toolCalls: [{ id: 'c3', name: 'server-1__browser_fill_form', arguments: {} }] }
        default:
          return { content: 'Done!', toolCalls: [] }
      }
    })

    const onChunk = vi.fn()
    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'fill the form at https://example.com' }],
      toolDefsWithSnapshot,
      toolMapWithSnapshot,
      'agent-1',
      null,
      makeWebContents(),
      onChunk
    )

    // The planning text should NOT be the final result
    expect(result).toBe('Done!')
    expect(onChunk).toHaveBeenCalledWith('Done!')
    // Recovery iteration must have used 'required'
    expect(choices[3]).toBe('required')
    // browser_fill_form must have been called
    expect(mockCallMcpTool).toHaveBeenCalledWith('server-1', 'browser_fill_form', expect.any(Object), expect.any(String), expect.any(Object), undefined, undefined, undefined)
  })

  it('recovers when the first response narrates an action instead of calling a tool', async () => {
    const choices: Array<'auto' | 'required' | 'none'> = []
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      choices.push(toolChoice)
      if (choices.length === 1) return { content: 'I will read the file now.', toolCalls: [] }
      if (choices.length === 2) return { content: null, toolCalls: [{ id: 'c1', name: 'server-1__click', arguments: {} }] }
      return { content: 'Done.', toolCalls: [] }
    })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'read the file' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn(),
    )

    expect(result).toBe('Done.')
    expect(choices).toEqual(['auto', 'required', 'auto'])
    expect(mockCallMcpTool).toHaveBeenCalledOnce()
  })

  it('shows a BYOK tool as in progress before a slow MCP call finishes', async () => {
    const events: string[] = []
    const onToolStarted = vi.fn(() => events.push('started'))
    const onToolFinished = vi.fn(() => events.push('finished'))
    mockCallMcpTool.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return { success: true, result: 'clicked' }
    })
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({ content: 'I am about to click it.', toolCalls: [{ id: 'c1', name: 'server-1__click', arguments: {} }] })
      .mockResolvedValueOnce({ content: 'Done.', toolCalls: [] })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click it' }],
      toolDefs,
      toolMap,
      'agent-1',
      'conversation-1',
      makeWebContents(),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onToolFinished,
      undefined,
      undefined,
      undefined,
      undefined,
      onToolStarted,
    )

    expect(onToolStarted).toHaveBeenCalledWith(expect.objectContaining({
      id: 'c1',
      toolName: 'click',
      serverName: 'Browser Server',
      args: {},
    }))
    expect(events).toEqual(['started', 'finished'])
  })

  it('recovers from an empty response after an inspection tool instead of ending silently', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: 'c1', name: 'server-1__browser_snapshot', arguments: {} }] })
      .mockResolvedValueOnce({ content: '', toolCalls: [] })
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: 'c2', name: 'server-1__browser_fill_form', arguments: {} }] })
      .mockResolvedValueOnce({ content: 'Finished.', toolCalls: [] })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'inspect and fill the form' }],
      toolDefsWithSnapshot,
      toolMapWithSnapshot,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn(),
    )

    expect(result).toBe('Finished.')
    expect(caller).toHaveBeenCalledTimes(4)
    expect(mockCallMcpTool).toHaveBeenCalledTimes(2)
  })

  it('feeds thrown MCP tool failures back to the model and continues the turn', async () => {
    mockCallMcpTool.mockRejectedValueOnce(new Error('browser disconnected'))
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: 'c1', name: 'server-1__click', arguments: {} }] })
      .mockImplementationOnce(async (messages) => {
        expect(messages).toContainEqual(expect.objectContaining({
          role: 'tool',
          tool_call_id: 'c1',
          content: expect.stringContaining('browser disconnected'),
        }))
        return { content: 'I recovered and finished.', toolCalls: [] }
      })

    await expect(runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click it' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn(),
    )).resolves.toBe('I recovered and finished.')
  })

  it('does NOT recover when previous step had action (non-inspection) tools', async () => {
    mockCallMcpTool.mockResolvedValue({ success: true, result: 'clicked' })

    const choices: Array<'auto' | 'required' | 'none'> = []
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      choices.push(toolChoice)
      if (choices.length === 1) {
        return { content: null, toolCalls: [{ id: 'c1', name: 'server-1__click', arguments: {} }] }
      }
      // Model returns summary text after a click (action tool) — should exit cleanly
      return { content: 'Task complete.', toolCalls: [] }
    })

    const onChunk = vi.fn()
    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click the button' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      onChunk
    )

    expect(result).toBe('Task complete.')
    expect(onChunk).toHaveBeenCalledWith('Task complete.')
    // Only 2 calls — no recovery iteration
    expect(caller).toHaveBeenCalledTimes(2)
  })

  it('only recovers once — does not loop on repeated planning text', async () => {
    mockCallMcpTool.mockResolvedValue({ success: true, result: 'snapshot data' })

    const choices: Array<'auto' | 'required' | 'none'> = []
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      choices.push(toolChoice)
      if (choices.length === 1) {
        return { content: null, toolCalls: [{ id: 'c1', name: 'server-1__browser_snapshot', arguments: {} }] }
      }
      // Both the planning response and the recovery iteration return text
      return { content: 'Still planning...', toolCalls: [] }
    })

    const onChunk = vi.fn()
    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'inspect the page' }],
      toolDefsWithSnapshot,
      toolMapWithSnapshot,
      'agent-1',
      null,
      makeWebContents(),
      onChunk
    )

    // After one recovery attempt the loop exits with the second planning text
    expect(result).toBe('Still planning...')
    // Exactly 3 calls: snapshot call, planning text (recovery triggered), recovery forced call (also text → exit)
    expect(caller).toHaveBeenCalledTimes(3)
    expect(choices[2]).toBe('required')
  })

  it('truncates large tool results for model context but sends full result to renderer', async () => {
    const largeResult = 'x'.repeat(MAX_TOOL_RESULT_CHARS + 5000)
    mockCallMcpTool.mockResolvedValueOnce({ success: true, result: largeResult })

    const webContents = makeWebContents()
    let modelFacingContent = ''

    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'c1', name: 'server-1__click', arguments: {} }]
      })
      .mockImplementationOnce(async (messages) => {
        const toolMsg = messages.find(
          (m: ProviderMessage) => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === 'c1'
        ) as { content: string } | undefined
        modelFacingContent = toolMsg?.content ?? ''
        return { content: 'done', toolCalls: [] }
      })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'do something' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      webContents,
      vi.fn()
    )

    // Model receives truncated content
    expect(modelFacingContent.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + 100) // +100 for the appended note
    expect(modelFacingContent).toContain('...[output truncated')

    // Renderer receives the full result
    const rendererCall = (webContents.send as ReturnType<typeof vi.fn>).mock.calls.find(
      ([channel]) => channel === 'chat:tool-call-event'
    )
    expect(rendererCall).toBeDefined()
    expect(rendererCall![1].result).toBe(largeResult)
  })
  it('stops calling tools once accumulated context exceeds the budget and forces a final answer', async () => {
    // Each tool result is right at MAX_TOOL_RESULT_CHARS, so a handful of rounds pushes the
    // conversation over MAX_LOOP_CONTEXT_CHARS well before MCP_MAX_ITERATIONS is reached.
    mockCallMcpTool.mockResolvedValue({ success: true, result: 'x'.repeat(MAX_TOOL_RESULT_CHARS) })

    let toolCallCount = 0
    const caller: ModelToolCaller = vi.fn(async (_messages, tools, toolChoice) => {
      if (toolChoice === 'none') {
        expect(tools).toBeUndefined()
        return { content: 'final answer with what I have', toolCalls: [] }
      }
      toolCallCount++
      return { content: null, toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }] }
    })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'gather a lot of context' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn()
    )

    expect(result).toBe('final answer with what I have')
    // Should stop well short of MCP_MAX_ITERATIONS once the budget is exceeded
    expect(toolCallCount).toBeLessThan(MCP_MAX_ITERATIONS)
    expect(caller).toHaveBeenLastCalledWith(expect.any(Array), undefined, 'none')
  })

  it('trims the oldest tool exchanges before the forced final call once over budget', async () => {
    mockCallMcpTool.mockResolvedValue({ success: true, result: 'x'.repeat(MAX_TOOL_RESULT_CHARS) })

    let finalMessages: unknown[] = []
    const caller: ModelToolCaller = vi.fn(async (messages, _tools, toolChoice) => {
      if (toolChoice === 'none') {
        finalMessages = messages
        return { content: 'final answer', toolCalls: [] }
      }
      return { content: null, toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }] }
    })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'system', content: 'system prompt' }, { role: 'user', content: 'gather a lot of context' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn()
    )

    const totalChars = (finalMessages as { content?: unknown }[]).reduce(
      (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0),
      0
    )
    expect(totalChars).toBeLessThan(MAX_LOOP_CONTEXT_CHARS * 1.5)
    // Leading system+user messages are preserved
    expect(finalMessages[0]).toMatchObject({ role: 'system' })
    expect(finalMessages[1]).toMatchObject({ role: 'user', content: 'gather a lot of context' })
  })

  it('streams and preserves interstitial assistant text emitted alongside a tool call', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: 'Let me click that button.',
        toolCalls: [{ id: 'c1', name: 'server-1__click', arguments: {} }]
      })
      .mockImplementationOnce(async (messages) => {
        // The interstitial text must be preserved as the assistant message content (not null)
        // so the model retains continuity across rounds.
        const assistantMsg = messages.find(
          (m: ProviderMessage) => m.role === 'assistant' && 'tool_calls' in m
        ) as { content?: unknown } | undefined
        expect(assistantMsg?.content).toBe('Let me click that button.')
        return { content: 'All done.', toolCalls: [] }
      })

    const onChunk = vi.fn()
    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click it' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      onChunk
    )

    // The narration is streamed to the user and included in the persisted full response.
    expect(onChunk).toHaveBeenCalledWith('Let me click that button.')
    expect(result).toContain('Let me click that button.')
    expect(result).toContain('All done.')
  })

  it('streams structured tool-round text without duplicating the returned content', async () => {
    let round = 0
    const caller: ModelToolCaller = vi.fn(async () => {
      throw new Error('non-streaming tool caller should not be used')
    })
    const streamCaller: ModelToolStreamCaller = vi.fn(async (_messages, _tools, _choice, onChunk) => {
      round++
      if (round === 1) {
        onChunk('I will ')
        onChunk('click it now.')
        return {
          content: 'I will click it now.',
          toolCalls: [{ id: 'stream-call-1', name: 'server-1__click', arguments: { target: 'submit' } }],
        }
      }
      onChunk('Done.')
      return { content: 'Done.', toolCalls: [] }
    })

    const onChunk = vi.fn()
    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click it' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      onChunk,
      undefined, // onModel
      undefined, // agenticMode
      undefined, // inlineHandlers
      undefined, // toolDirective
      undefined, // onActivity
      undefined, // autoApproveTools
      undefined, // toolPolicy
      undefined, // onToolFinished
      undefined, // fullAutoApprove
      undefined, // forceFirstToolChoice
      undefined, // onUsage
      undefined, // finalStreamCaller
      undefined, // onToolStarted
      streamCaller,
    )

    expect(result).toBe('I will click it now.Done.')
    expect(onChunk.mock.calls.map(([chunk]) => chunk)).toEqual(['I will ', 'click it now.', 'Done.'])
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      'server-1',
      'click',
      { target: 'submit' },
      'agent-1',
      expect.any(Object),
      undefined,
      undefined,
      undefined,
    )
  })

  it('feeds a parse error back instead of running a tool with malformed arguments', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{
          id: 'c1',
          name: 'server-1__click',
          arguments: {},
          argsError: 'could not parse arguments as JSON: {bad'
        }]
      })
      .mockImplementationOnce(async (messages) => {
        const toolMsg = messages.find(
          (m: ProviderMessage) => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === 'c1'
        ) as { content: string } | undefined
        expect(toolMsg?.content).toContain('could not parse arguments as JSON')
        return { content: 'recovered', toolCalls: [] }
      })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'do it' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn()
    )

    expect(result).toBe('recovered')
    // The tool itself must NOT be invoked with the empty fallback arguments.
    expect(mockCallMcpTool).not.toHaveBeenCalled()
  })

  it('forwards provider usage from each round via onUsage', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'c1', name: 'server-1__click', arguments: {} }],
        usage: { inputTokens: 10, outputTokens: 5 }
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 8 }
      })

    const onUsage = vi.fn()
    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      vi.fn(),
      undefined, // onModel
      undefined, // agenticMode
      undefined, // inlineHandlers
      undefined, // toolDirective
      undefined, // onActivity
      undefined, // autoApproveTools
      undefined, // toolPolicy
      undefined, // onToolFinished
      undefined, // fullAutoApprove
      undefined, // forceFirstToolChoice
      onUsage,
    )

    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5 })
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 20, outputTokens: 8 })
  })

  async function runWithFinalStream(
    caller: ModelToolCaller,
    onChunk: (chunk: string) => void,
    finalStreamCaller: (messages: ProviderMessage[], onChunk: (chunk: string) => void) => Promise<void>,
  ) {
    return runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'loop' }],
      toolDefs,
      toolMap,
      'agent-1',
      null,
      makeWebContents(),
      onChunk,
      undefined, // onModel
      undefined, // agenticMode
      undefined, // inlineHandlers
      undefined, // toolDirective
      undefined, // onActivity
      undefined, // autoApproveTools
      undefined, // toolPolicy
      undefined, // onToolFinished
      undefined, // fullAutoApprove
      undefined, // forceFirstToolChoice
      undefined, // onUsage
      finalStreamCaller,
    )
  }

  it('streams the forced final answer through finalStreamCaller instead of the non-streaming caller', async () => {
    // Every tool round returns a tool call so the loop reaches the forced final answer.
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      if (toolChoice === 'none') throw new Error('non-streaming final caller should not be used')
      return { content: null, toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }] }
    })

    const onChunk = vi.fn()
    const finalStreamCaller = vi.fn(async (_messages: ProviderMessage[], chunk: (c: string) => void) => {
      chunk('streamed ')
      chunk('final answer')
    })

    const result = await runWithFinalStream(caller, onChunk, finalStreamCaller)

    expect(finalStreamCaller).toHaveBeenCalledTimes(1)
    expect(result).toContain('streamed final answer')
    expect(onChunk).toHaveBeenCalledWith('streamed ')
    expect(onChunk).toHaveBeenCalledWith('final answer')
    // The non-streaming forced-'none' call must NOT have been made.
    expect(caller).not.toHaveBeenCalledWith(expect.any(Array), undefined, 'none')
  })

  it('falls back to the non-streaming final caller when finalStreamCaller fails before emitting', async () => {
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      if (toolChoice === 'none') return { content: 'fallback final', toolCalls: [] }
      return { content: null, toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }] }
    })

    const onChunk = vi.fn()
    // Throws without emitting any chunk — the loop should fall back to caller(..., 'none').
    const finalStreamCaller = vi.fn(async () => { throw new Error('endpoint rejected stream') })

    const result = await runWithFinalStream(caller, onChunk, finalStreamCaller)

    expect(finalStreamCaller).toHaveBeenCalledTimes(1)
    expect(result).toBe('fallback final')
    expect(onChunk).toHaveBeenCalledWith('fallback final')
    expect(caller).toHaveBeenLastCalledWith(expect.any(Array), undefined, 'none')
  })

  it('fixed BYOK bug: surfaces the specific empty-response diagnosis instead of the generic fallback', async () => {
    // Mirrors the real production path: streamChatCompletions detects finish_reason:'stop' with
    // empty content and throws a specific, actionable error. Nothing has streamed yet, so the loop
    // falls through to the non-streaming caller — which (like sendOpenAIWithTools in production,
    // post-fix) also detects the empty/truncated response and throws the same kind of specific
    // error instead of silently returning content: null. The loop must now surface that specific
    // diagnosis rather than the generic, unhelpful "no final response" placeholder.
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      if (toolChoice === 'none') {
        throw new Error(
          'The model returned an empty response. The conversation may be too long for this model — try starting a new conversation.'
        )
      }
      return { content: null, toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }] }
    })

    const onChunk = vi.fn()
    const finalStreamCaller = vi.fn(async () => {
      throw new Error(
        'The model returned an empty response. The conversation may be too long for this model — try starting a new conversation.'
      )
    })

    const result = await runWithFinalStream(caller, onChunk, finalStreamCaller)

    // FIXED: the specific truncation diagnosis now reaches the user instead of the generic placeholder.
    expect(result).toBe(
      'The model returned an empty response. The conversation may be too long for this model — try starting a new conversation.'
    )
    expect(caller).toHaveBeenLastCalledWith(expect.any(Array), undefined, 'none')
  })

  it('still falls back to the generic placeholder for non-diagnostic errors on the final call', async () => {
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      if (toolChoice === 'none') throw new Error('socket hang up')
      return { content: null, toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }] }
    })

    const onChunk = vi.fn()
    const finalStreamCaller = vi.fn(async () => { throw new Error('endpoint rejected stream') })

    const result = await runWithFinalStream(caller, onChunk, finalStreamCaller)

    expect(result).toBe('I completed some tool actions, but the provider stopped before providing a final response.')
  })

  it('keeps partial text when finalStreamCaller fails after emitting', async () => {
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      if (toolChoice === 'none') throw new Error('non-streaming final caller should not be used after partial stream')
      return { content: null, toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }] }
    })

    const onChunk = vi.fn()
    const finalStreamCaller = vi.fn(async (_messages: ProviderMessage[], chunk: (c: string) => void) => {
      chunk('partial answer')
      throw new Error('connection dropped mid-stream')
    })

    await expect(runWithFinalStream(caller, onChunk, finalStreamCaller)).resolves.toBe('partial answer')
    expect(onChunk).toHaveBeenCalledWith('partial answer')
    // No fallback: the non-streaming forced-'none' call must not run (would duplicate the text).
    expect(caller).not.toHaveBeenCalledWith(expect.any(Array), undefined, 'none')
  })
})

function randomId() {
  return Math.random().toString(36).slice(2)
}
