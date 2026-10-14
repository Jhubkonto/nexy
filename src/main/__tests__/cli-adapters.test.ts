import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExec, mockExecFile, mockExecSync, mockSpawnSync, mockSpawn } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExecFile: vi.fn(),
  mockExecSync: vi.fn(),
  mockSpawnSync: vi.fn(),
  mockSpawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  exec: mockExec,
  execFile: mockExecFile,
  execSync: mockExecSync,
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}))

import { ClaudeAdapter } from '../cli-adapters/claude'
import { CodexAdapter } from '../cli-adapters/codex'
import { HermesAdapter } from '../cli-adapters/hermes'
import { clearCliPathCache } from '../cli-adapters/utils'

describe('CLI adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCliPathCache()
    // resolveCliPath calls execSync('where.exe <name>') — return a dummy path by default
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).includes('where') || String(cmd).includes('which')) {
        return String(cmd).includes('hermes') ? 'C:\\hermes.exe\n' : 'C:\\claude.exe\n'
      }
      return ''
    })
  })

  function makeProc() {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: {
        write: ReturnType<typeof vi.fn>
        end: ReturnType<typeof vi.fn>
        destroyed: boolean
      }
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.stdin = { write: vi.fn(), end: vi.fn(), destroyed: false }
    return proc
  }

  it('ClaudeAdapter parses text and emits Claude stream events', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: string[] = []
    const onEvent = vi.fn()
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      systemPrompt: 'system',
      agents: {
        reviewer: { description: 'Reviews plans', prompt: 'Challenge assumptions.' },
      },
    }, (chunk: string) => chunks.push(chunk), onEvent)

    const line1 = JSON.stringify({ type: 'system', subtype: 'init' })
    const line2 = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello world' },
          { type: 'tool_use', id: 'toolu_abc', name: 'Read', input: { file_path: 'src/main.ts' } },
        ],
      },
    })
    const line3 = JSON.stringify({
      type: 'tool_result',
      tool_use_id: 'toolu_abc',
      content: [{ type: 'text', text: 'file contents here...' }],
      is_error: false,
    })
    const line4 = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Hello world',
      total_cost_usd: 0.0123,
      usage: { input_tokens: 1500, output_tokens: 300 },
    })
    proc.stdout.emit('data', Buffer.from(`${line1}\n${line2}\n${line3}\n${line4}\n`))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Hello world')
    expect(chunks).toEqual(['Hello world'])
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'text_end', blockId: 'text-0' })
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'tool_start',
      id: 'toolu_abc',
      name: 'Read',
      input: { file_path: 'src/main.ts' },
    })
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      type: 'tool_end',
      id: 'toolu_abc',
      content: 'file contents here...',
      isError: false,
    })
    expect(onEvent).toHaveBeenNthCalledWith(4, {
      type: 'cost',
      totalCostUsd: 0.0123,
      inputTokens: 1500,
      outputTokens: 300,
    })
    expect(mockSpawn).toHaveBeenCalledWith(
      'C:\\claude.exe',
      [
        '--output-format', 'stream-json', '--print', '--verbose', '--strict-mcp-config',
        '--system-prompt', 'system',
        '--agents', JSON.stringify({ reviewer: { description: 'Reviews plans', prompt: 'Challenge assumptions.' } }),
      ],
      expect.objectContaining({ cwd: 'C:\\workspace' })
    )
    expect(proc.stdin.end).toHaveBeenCalledWith('[User]: hello', 'utf8')
  })

  it('ClaudeAdapter tags text chunks with a new blockId each time a tool call interrupts the response text', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: Array<{ chunk: string; blockId?: string }> = []
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, (chunk: string, blockId?: string) => chunks.push({ chunk, blockId }))

    const leadIn = JSON.stringify({
      type: 'assistant',
      message: { content: [
        { type: 'text', text: "I'll look at the key config files." },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } },
      ] },
    })
    const toolResult = JSON.stringify({ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'contents' }], is_error: false })
    const tailText = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: "Here's the fuller picture." }] },
    })
    proc.stdout.emit('data', Buffer.from(`${leadIn}\n${toolResult}\n${tailText}\n`))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe("I'll look at the key config files.Here's the fuller picture.")
    expect(chunks).toEqual([
      { chunk: "I'll look at the key config files.", blockId: 'text-0' },
      { chunk: "Here's the fuller picture.", blockId: 'text-1' },
    ])
  })

  it('ClaudeAdapter falls back to content_block_delta format', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: string[] = []
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, (chunk: string) => chunks.push(chunk))

    proc.stdout.emit('data', Buffer.from('{"type":"content_block_delta","delta":{"text":"Hello"}}\nnot-json\n'))
    proc.stdout.emit('data', Buffer.from('{"type":"content_block_delta","delta":{"text":" world"}}'))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Hello world')
    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('ClaudeAdapter scopes delta deduplication to each assistant message across a tool boundary', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: Array<{ chunk: string; blockId?: string }> = []
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'plan and implement this' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-plan',
    }, (chunk: string, blockId?: string) => chunks.push({ chunk, blockId }))

    const streamedPlan = JSON.stringify({
      type: 'content_block_delta',
      delta: { text: 'Here is the plan.' },
    })
    const consolidatedPlanAndTool = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Here is the plan.' },
          { type: 'tool_use', id: 'toolu_exit', name: 'ExitPlanMode', input: {} },
        ],
      },
    })
    const toolResult = JSON.stringify({
      type: 'tool_result',
      tool_use_id: 'toolu_exit',
      content: [{ type: 'text', text: 'approved' }],
      is_error: false,
    })
    const batchImplementation = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Implementation complete.' }] },
    })

    proc.stdout.emit('data', Buffer.from(
      `${streamedPlan}\n${consolidatedPlanAndTool}\n${toolResult}\n${batchImplementation}\n`,
    ))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Here is the plan.Implementation complete.')
    expect(chunks).toEqual([
      { chunk: 'Here is the plan.', blockId: 'text-0' },
      { chunk: 'Implementation complete.', blockId: 'text-1' },
    ])
  })

  it('ClaudeAdapter emits tool_end for tool_result blocks embedded in user messages', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const onEvent = vi.fn()
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'use playwright' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {}, onEvent)

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Navigating...' },
          { type: 'tool_use', id: 'toolu_mcp', name: 'mcp__playwright_chromium__browser_navigate', input: { url: 'https://www.google.com' } },
        ],
      },
    })}\n${JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_mcp', content: [{ type: 'text', text: 'Navigated to Google' }], is_error: false },
        ],
      },
    })}\n`))
    proc.emit('close', 0)

    await sendPromise
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'text_end', blockId: 'text-0' })
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'tool_start',
      id: 'toolu_mcp',
      name: 'mcp__playwright_chromium__browser_navigate',
      input: { url: 'https://www.google.com' },
    })
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      type: 'tool_end',
      id: 'toolu_mcp',
      content: 'Navigated to Google',
      isError: false,
    })
  })

  it('ClaudeAdapter closes dangling tool rows when the process exits', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const onEvent = vi.fn()
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'use a tool' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {}, onEvent)

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Searching...' },
          { type: 'tool_use', id: 'toolu_dangling', name: 'ToolSearch', input: { query: 'playwright navigate click' } },
        ],
      },
    })}\n`))
    proc.emit('close', 0)

    await sendPromise
    expect(onEvent).toHaveBeenLastCalledWith({
      type: 'tool_end',
      id: 'toolu_dangling',
      content: '',
      isError: false,
    })
  })

  it('ClaudeAdapter includes stderr in error message', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})

    proc.stderr.emit('data', Buffer.from('Error: not authenticated'))
    proc.emit('close', 1)

    await expect(sendPromise).rejects.toThrow('Error: not authenticated')
  })

  it('ClaudeAdapter passes a versioned menu selection as Claude Code\'s executable alias', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'Opus 5.5',
      conversationId: 'conv-1',
    }, () => {})

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } })}\n`))
    proc.emit('close', 0)
    await sendPromise

    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'opus'])
  })

  it('ClaudeAdapter maps permissionMode to --permission-mode and it wins over skipPermissions', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      permissionMode: 'plan',
      skipPermissions: true,
    }, () => {})

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } })}\n`))
    proc.emit('close', 0)
    await sendPromise

    const args = mockSpawn.mock.calls[0][1] as string[]
    const modeIndex = args.indexOf('--permission-mode')
    expect(modeIndex).toBeGreaterThan(-1)
    expect(args[modeIndex + 1]).toBe('plan')
    // An explicit plan mode must keep the chat read-only even when auto-approve is on.
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('ClaudeAdapter adds the Nexy plan bridge only for Plan-mode completion callbacks', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const requestPlanApproval = vi.fn().mockResolvedValue(true)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'plan it' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-plan',
      permissionMode: 'plan',
      requestPlanApproval,
    }, () => {})

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Plan ready' }] } })}\n`))
    proc.emit('close', 0)
    await sendPromise

    const args = mockSpawn.mock.calls[0][1] as string[]
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(config.mcpServers.nexy_plan).toEqual(expect.objectContaining({
      command: process.execPath,
      args: [expect.stringContaining('plan-mcp-worker.cjs')],
    }))
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__nexy_plan__exit_plan_mode')
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('nexy_plan.exit_plan_mode')
  })

  it('ClaudeAdapter makes bypass mode fully non-interactive and omits the permission hook', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const requestPermission = vi.fn().mockResolvedValue(false)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'edit the file' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-bypass',
      permissionMode: 'bypassPermissions',
      requestPermission,
    }, () => {})

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'done' }] },
    })}\n`))
    proc.emit('close', 0)
    await expect(sendPromise).resolves.toBe('done')

    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).toContain('--permission-mode')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--settings')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('ClaudeAdapter bridges non-interactive PermissionRequest hooks to Nexy', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const requestPermission = vi.fn().mockResolvedValue(true)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'inspect the workspace' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      requestPermission,
    }, () => {})

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled())
    const args = mockSpawn.mock.calls[0][1] as string[]
    const settingsIndex = args.indexOf('--settings')
    expect(settingsIndex).toBeGreaterThan(-1)
    const settings = JSON.parse(args[settingsIndex + 1]) as {
      hooks: { PermissionRequest: Array<{ hooks: Array<{ url: string }> }> }
    }
    const hookUrl = settings.hooks.PermissionRequest[0].hooks[0].url
    const hookResponse = await fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PermissionRequest',
        tool_name: 'PowerShell',
        tool_input: { command: 'Get-ChildItem -Force' },
      }),
    })

    expect(await hookResponse.json()).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    })
    expect(requestPermission).toHaveBeenCalledWith('PowerShell', { command: 'Get-ChildItem -Force' })

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })}\n`))
    proc.emit('close', 0)
    await expect(sendPromise).resolves.toBe('done')
  })

  it('does not wire the nexy_defer bridge unless deferredJobsEnabled is set', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })}\n`))
    proc.emit('close', 0)
    await sendPromise

    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--mcp-config')
    expect(args.join(' ')).not.toContain('nexy_defer')
  })

  it('wires the nexy_defer bridge and its allowed tool when deferredJobsEnabled is set', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      deferredJobsEnabled: true,
    }, () => {})

    // Starting the bridge is a real async loopback-server listen, unlike the synchronous
    // ternaries above — mirrors the vi.waitFor gap used for the permission-hook bridge below.
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled())
    const args = mockSpawn.mock.calls[0][1] as string[]
    const configIndex = args.indexOf('--mcp-config')
    expect(configIndex).toBeGreaterThan(-1)
    const mcpConfig = JSON.parse(args[configIndex + 1]) as { mcpServers: Record<string, unknown> }
    expect(mcpConfig.mcpServers.nexy_defer).toBeTruthy()
    expect(args).toEqual(expect.arrayContaining(['--allowedTools']))
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__nexy_defer__run_and_notify')
    const systemPromptIndex = args.indexOf('--system-prompt')
    expect(args[systemPromptIndex + 1]).toContain('nexy_defer.run_and_notify')

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })}\n`))
    proc.emit('close', 0)
    await expect(sendPromise).resolves.toBe('done')
  })

  it('ClaudeAdapter ignores Codex-family sandbox modes and keeps the skipPermissions fallback', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      permissionMode: 'workspace-write',
      skipPermissions: true,
    }, () => {})

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } })}\n`))
    proc.emit('close', 0)
    await sendPromise

    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--permission-mode')
    expect(args).toContain('--dangerously-skip-permissions')
  })

  it('CodexAdapter keeps auto-approval and sandbox level as independent real settings', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      systemPrompt: 'be helpful',
      permissionMode: 'read-only',
      skipPermissions: true,
    }, () => {})

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'ok' } })}\n`))
    proc.emit('close', 0)
    await sendPromise

    const spawnArgs = (mockSpawn.mock.calls[0][1] as string[]).flat()
    const sandboxIndex = spawnArgs.indexOf('--sandbox')
    expect(sandboxIndex).toBeGreaterThan(-1)
    expect(spawnArgs[sandboxIndex + 1]).toBe('read-only')
    const configIndex = spawnArgs.indexOf('--config')
    expect(configIndex).toBeGreaterThan(-1)
    expect(spawnArgs[configIndex + 1]).toBe('approval_policy="never"')
    // Auto-approval is now a real Codex policy and no longer relies on prompt text.
    const stdinPayload = String(proc.stdin.end.mock.calls[0]?.[0] ?? '')
    expect(stdinPayload).not.toContain('[AUTO-APPROVE]')
  })

  it('CodexAdapter routes Plan mode through app-server with independent approval and sandbox settings', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const chunks: Array<{ text: string; blockId?: string }> = []
    const onEvent = vi.fn()

    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'plan this change' }],
      cwd: 'C:\\workspace',
      model: 'gpt-5.5',
      conversationId: 'conv-plan',
      systemPrompt: 'Be concise',
      executionMode: 'plan',
      permissionMode: 'read-only',
      skipPermissions: true,
      thinkingEffort: 'high',
    }, (text, blockId) => chunks.push({ text, blockId }), onEvent)

    const writes = () => proc.stdin.write.mock.calls.map((call) => JSON.parse(String(call[0]).trim()) as Record<string, unknown>)
    expect(writes()[0]).toEqual(expect.objectContaining({
      id: 1,
      method: 'initialize',
    }))

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      id: 1,
      result: { userAgent: 'codex-test' },
    })}\n`))
    expect(writes()).toContainEqual({ method: 'initialized' })
    expect(writes()).toContainEqual(expect.objectContaining({
      id: 2,
      method: 'thread/start',
      params: expect.objectContaining({
        model: 'gpt-5.5',
        cwd: 'C:\\workspace',
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
      }),
    }))

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      id: 2,
      result: {
        thread: { id: 'thread-1' },
        model: 'gpt-5.5',
      },
    })}\n`))
    expect(writes()).toContainEqual(expect.objectContaining({
      id: 3,
      method: 'turn/start',
      params: expect.objectContaining({
        threadId: 'thread-1',
        collaborationMode: {
          mode: 'plan',
          settings: {
            model: 'gpt-5.5',
            reasoning_effort: 'high',
            developer_instructions: null,
          },
        },
      }),
    }))

    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({ method: 'item/plan/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'plan-1', delta: 'Step one' } }),
      JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'plan', id: 'plan-1', text: 'Step one' } } }),
      JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { last: { inputTokens: 10, outputTokens: 4 } } } }),
      JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } } }),
      '',
    ].join('\n')))

    await expect(sendPromise).resolves.toBe('Step one')
    expect(proc.stdin.end).toHaveBeenCalled()
    expect(chunks).toEqual([{ text: 'Step one', blockId: 'codex-plan-plan-1' }])
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_end', blockId: 'codex-plan-plan-1' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'plan_ready', plan: 'Step one' })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'cost',
      totalCostUsd: 0,
      inputTokens: 10,
      outputTokens: 4,
    })
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
    expect(spawnArgs).toEqual(expect.arrayContaining(['app-server', '--stdio']))
  })

  it('CodexAdapter bridges Plan-mode MCP approval elicitations to Nexy approval', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const requestPermission = vi.fn().mockResolvedValue(true)

    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'use the browser' }],
      cwd: 'C:\\workspace',
      model: 'gpt-5.5',
      conversationId: 'conv-plan-mcp',
      executionMode: 'plan',
      mcpServers: [{
        id: 'server-1',
        key: 'playwright_chromium',
        command: 'npx',
        args: ['-y', '@playwright/mcp'],
      }],
      allowedTools: ['mcp__playwright_chromium__browser_navigate'],
      requestPermission,
    }, () => {})

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: 1, result: { userAgent: 'codex-test' } })}\n`))
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: 2, result: { thread: { id: 'thread-1' }, model: 'gpt-5.5' } })}\n`))
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      id: 4,
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'playwright_chromium',
        mode: 'form',
        message: 'Allow browser navigation?',
        requestedSchema: { type: 'object' },
        meta: { codex_approval_kind: 'mcp_tool_call' },
      },
    })}\n`))

    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledWith(
      'mcp__playwright_chromium',
      expect.objectContaining({ serverName: 'playwright_chromium', message: 'Allow browser navigation?' }),
    ))
    expect(proc.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ id: 4, result: { action: 'accept', content: null } }) + '\n',
      'utf8',
    )

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    })}\n`))
    await expect(sendPromise).resolves.toBe('')
  })

  it('ClaudeAdapter reports availability from execSync', () => {
    mockExecSync.mockReturnValue('C:\\claude.exe\n')
    expect(ClaudeAdapter.isAvailable()).toBe(true)
    clearCliPathCache()
    mockExecSync.mockImplementation(() => { throw new Error('missing') })
    expect(ClaudeAdapter.isAvailable()).toBe(false)
  })

  it('ClaudeAdapter uses stream-json input format and embeds image when images provided', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: string[] = []
    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'what is this?' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      systemPrompt: 'You are helpful',
      images: [{ id: 'img-1', name: 'screenshot.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    }, (chunk: string) => chunks.push(chunk))

    proc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'content_block_delta', delta: { text: 'I see a screenshot.' }
    }) + '\n'))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('I see a screenshot.')

    // Must add --system-prompt before --input-format stream-json when images are present
    expect(mockSpawn).toHaveBeenCalledWith(
      'C:\\claude.exe',
      ['--output-format', 'stream-json', '--print', '--verbose', '--strict-mcp-config', '--system-prompt', 'You are helpful', '--input-format', 'stream-json'],
      expect.objectContaining({ cwd: 'C:\\workspace' })
    )

    // stdin must be valid JSON with image content block embedded in last user message
    const stdinArg = (proc.stdin.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const parsed = JSON.parse(stdinArg) as { type: string; message: { role: string; content: unknown[] } }
    expect(parsed.type).toBe('user')
    expect(parsed.message.content).toHaveLength(2)
    expect((parsed.message.content[0] as { type: string; text: string }).type).toBe('text')
    expect((parsed.message.content[0] as { type: string; text: string }).text).toContain('what is this?')
    const imgBlock = parsed.message.content[1] as { type: string; source: { type: string; media_type: string; data: string } }
    expect(imgBlock.type).toBe('image')
    expect(imgBlock.source.type).toBe('base64')
    expect(imgBlock.source.media_type).toBe('image/png')
    expect(imgBlock.source.data).toBe('iVBORw0KGgo=')
  })

  it('ClaudeAdapter uses plain text input and no --input-format flag for text-only messages', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'content_block_delta', delta: { text: 'hi' } }) + '\n'))
    proc.emit('close', 0)
    await sendPromise

    expect(mockSpawn).toHaveBeenCalledWith(
      'C:\\claude.exe',
      ['--output-format', 'stream-json', '--print', '--verbose', '--strict-mcp-config'],
      expect.any(Object)
    )
    // No --input-format flag in text-only mode
    const spawnArgs = (mockSpawn.mock.calls[0] as unknown[])[1] as string[]
    expect(spawnArgs).not.toContain('--input-format')
  })

  it('ClaudeAdapter passes per-run MCP config and allowed tools', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'open a browser' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      mcpServers: [{
        id: 'server-1',
        key: 'playwright_chromium',
        command: 'npx',
        args: ['-y', '@playwright/mcp'],
      }],
      allowedTools: ['mcp__playwright_chromium__browser_navigate'],
    }, () => {})

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'content_block_delta', delta: { text: 'done' } }) + '\n'))
    proc.emit('close', 0)
    await sendPromise

    const spawnArgs = (mockSpawn.mock.calls[0] as unknown[])[1] as string[]
    const configIndex = spawnArgs.indexOf('--mcp-config')
    expect(configIndex).toBeGreaterThan(-1)
    expect(spawnArgs).toContain('--strict-mcp-config')
    expect(JSON.parse(spawnArgs[configIndex + 1])).toEqual({
      mcpServers: {
        playwright_chromium: {
          command: 'npx',
          args: ['-y', '@playwright/mcp'],
        },
      },
    })
    expect(spawnArgs).toEqual(expect.arrayContaining([
      '--allowedTools',
      'mcp__playwright_chromium__browser_navigate',
    ]))
  })

  it('ClaudeAdapter preserves conversation history in stream-json format', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = ClaudeAdapter.send({} as never, {
      messages: [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'first response' },
        { role: 'user', content: 'follow-up with image' },
      ],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      images: [{ id: 'img-1', name: 'img.png', dataUrl: 'data:image/jpeg;base64,/9j/abc' }],
    }, () => {})

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'content_block_delta', delta: { text: 'done' } }) + '\n'))
    proc.emit('close', 0)
    await sendPromise

    const stdinArg = (proc.stdin.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const lines = stdinArg.split('\n').filter(Boolean)
    expect(lines).toHaveLength(3) // user, assistant, user

    const [userTurn1, assistantTurn, userTurn2] = lines.map((l) => JSON.parse(l) as { type: string; message: { content: unknown[] } })
    expect(userTurn1.type).toBe('user')
    expect(assistantTurn.type).toBe('assistant')
    expect(userTurn2.type).toBe('user')
    // Image only on last user message
    expect(userTurn2.message.content).toHaveLength(2)
    expect(userTurn1.message.content).toHaveLength(1)
    expect(assistantTurn.message.content).toHaveLength(1)
    // media_type inferred from jpeg data URL
    const imgBlock = userTurn2.message.content[1] as { source: { media_type: string } }
    expect(imgBlock.source.media_type).toBe('image/jpeg')
  })

  it('CodexAdapter parses item.completed agent_message output', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: string[] = []
    const onEvent = vi.fn()
    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'test' }],
      cwd: 'C:\\workspace',
      model: 'gpt-4.1',
      conversationId: 'conv-1',
    }, (chunk: string) => chunks.push(chunk), onEvent)

    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Received.' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 11261, output_tokens: 23 } }),
      '',
    ].join('\n')))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Received.')
    expect(chunks).toEqual(['Received.'])
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['exec', '--json', '--ephemeral', '--model', 'gpt-4.1']),
      expect.objectContaining({ cwd: 'C:\\workspace', stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    )
    expect(proc.stdin.end).toHaveBeenCalledWith('test', 'utf8')
    expect(onEvent).toHaveBeenCalledWith({
      type: 'cost',
      totalCostUsd: 0,
      inputTokens: 11261,
      outputTokens: 23,
    })
  })

  it('CodexAdapter settles on turn.completed when inherited stdio prevents close', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const onEvent = vi.fn()
    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'test' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {}, onEvent)

    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({ type: 'item.started', item: { id: 'tool-1', type: 'command_execution', command: 'gradlew test' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'Implemented.' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3 } }),
      '',
    ].join('\n')))

    await expect(sendPromise).resolves.toBe('Implemented.')
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_end',
      id: 'tool-1',
      content: '',
      isError: false,
    })

    // A delayed close must not run cleanup or emit terminal block events a second time.
    proc.emit('close', 0)
    expect(onEvent.mock.calls.filter(([event]) => event.type === 'tool_end')).toHaveLength(1)
  })

  it('CodexAdapter rejects on turn.failed without waiting for close', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'test' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({
      type: 'turn.failed',
      error: { message: 'Verification failed' },
    })}\n`))

    await expect(sendPromise).rejects.toThrow('Codex error: Verification failed')
  })

  it('CodexAdapter reports nested unsupported-model errors without raw JSON fallback', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'what model are you?' }],
      cwd: 'C:\\workspace',
      model: 'gpt-4.1',
      conversationId: 'conv-1',
    }, () => {})

    const nestedMessage = JSON.stringify({
      type: 'error',
      status: 400,
      error: {
        type: 'invalid_request_error',
        message: "The 'gpt-4.1' model is not supported when using Codex with a ChatGPT account.",
      },
    })
    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'error', message: nestedMessage }),
      JSON.stringify({ type: 'turn.failed', error: { message: nestedMessage } }),
      '',
    ].join('\n')))
    proc.emit('close', 1)

    await expect(sendPromise).rejects.toThrow("The 'gpt-4.1' model is not supported when using Codex with a ChatGPT account.")
  })

  it('CodexAdapter passes per-run MCP config and emits tool events', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const onEvent = vi.fn()
    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'open google' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
      mcpServers: [{
        id: 'server-1',
        key: 'playwright_chromium',
        command: 'npx',
        args: ['-y', '@playwright/mcp'],
        env: { BROWSER: 'chromium' },
      }],
      allowedTools: ['mcp__playwright_chromium__browser_navigate'],
    }, () => {}, onEvent)

    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'tool-1',
          type: 'mcp_tool_call',
          name: 'browser_navigate',
          arguments: { url: 'https://www.google.com' },
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'tool-1',
          type: 'mcp_tool_call',
          name: 'browser_navigate',
          output: 'Navigated to Google',
          status: 'completed',
        },
      }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Done.' } }),
      '',
    ].join('\n')))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Done.')

    const spawnArgs = (mockSpawn.mock.calls[0] as unknown[])[1] as string[]
    expect(spawnArgs).toEqual(expect.arrayContaining([
      '-c',
      'mcp_servers.playwright_chromium.command="npx"',
      '-c',
      'mcp_servers.playwright_chromium.args=["-y", "@playwright/mcp"]',
      '-c',
      'mcp_servers.playwright_chromium.env.BROWSER="chromium"',
      '-c',
      'mcp_servers.playwright_chromium.enabled_tools=["browser_navigate"]',
      '-c',
      'mcp_servers.playwright_chromium.default_tools_approval_mode="approve"',
    ]))
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_start',
      id: 'tool-1',
      name: 'browser_navigate',
      input: { url: 'https://www.google.com' },
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_end',
      id: 'tool-1',
      content: 'Navigated to Google',
      isError: false,
    })
  })

  it('CodexAdapter emits transient activity events and reasoning summary as thinking events', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const onEvent = vi.fn()
    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'test' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {}, onEvent)

    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: 'I will inspect the request.' }),
      JSON.stringify({ type: 'response.reasoning_summary_text.done' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Done.' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3 } }),
      '',
    ].join('\n')))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Done.')
    // Lifecycle narration is now a transient activity event — never persisted into a
    // thinking block, unlike real model reasoning below.
    expect(onEvent).toHaveBeenCalledWith({ type: 'activity', label: 'Starting Codex CLI.' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'activity', label: 'Started Codex session.' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'activity', label: 'Started Codex turn.' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'activity', label: 'Codex turn completed.' })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'thinking_chunk',
      blockId: 'codex-reasoning-summary-0',
      chunk: 'I will inspect the request.',
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'thinking_end',
      blockId: 'codex-reasoning-summary-0',
    })
  })

  it('CodexAdapter records failed tool activity via tool_end, without duplicating it as a thinking block', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const onEvent = vi.fn()
    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'use tool' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {}, onEvent)

    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'tool-1',
          type: 'mcp_tool_call',
          name: 'browser_navigate',
          arguments: { url: 'https://example.com' },
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'tool-1',
          type: 'mcp_tool_call',
          name: 'browser_navigate',
          error: 'Permission denied',
          status: 'failed',
        },
      }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Could not navigate.' } }),
      '',
    ].join('\n')))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Could not navigate.')
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_end',
      id: 'tool-1',
      content: 'Permission denied',
      isError: true,
    })
    // Tool-call narration is deliberately not surfaced as a separate activity/thinking
    // event anymore — it would just duplicate the tool_end event and its ToolCallBlock.
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('browser_navigate') }))
  })

  it('CodexAdapter emits tool_start/tool_end for native command_execution and file_change items, not just MCP tool calls', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const onEvent = vi.fn()
    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'create a file' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {}, onEvent)

    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'ls -la' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'cmd-1', type: 'command_execution', command: 'ls -la', aggregated_output: 'file.txt', status: 'completed' },
      }),
      JSON.stringify({
        type: 'item.started',
        item: { id: 'fc-1', type: 'file_change', path: 'src/foo.ts' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'fc-1', type: 'file_change', path: 'src/foo.ts', status: 'completed' },
      }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Done.' } }),
      '',
    ].join('\n')))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Done.')

    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_start',
      id: 'cmd-1',
      name: 'Run Command',
      input: { command: 'ls -la' },
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_end',
      id: 'cmd-1',
      content: 'file.txt',
      isError: false,
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_start',
      id: 'fc-1',
      name: 'Edit File',
      input: { path: 'src/foo.ts' },
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_end',
      id: 'fc-1',
      content: '',
      isError: false,
    })
  })

  it('CodexAdapter inserts a paragraph break between text segments split apart by a tool call', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const chunks: Array<{ text: string; blockId?: string }> = []
    const onEvent = vi.fn()
    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'create a file' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, (text: string, blockId?: string) => chunks.push({ text, blockId }), onEvent)

    proc.stdout.emit('data', Buffer.from([
      JSON.stringify({ type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: "I'll check whether the file exists." } }),
      JSON.stringify({
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'Test-Path file' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'cmd-1', type: 'command_execution', command: 'Test-Path file', aggregated_output: 'False', status: 'completed' },
      }),
      JSON.stringify({ type: 'item.completed', item: { id: 'msg-2', type: 'agent_message', text: 'The file is missing, so I created it.' } }),
      '',
    ].join('\n')))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe(
      "I'll check whether the file exists.\n\nThe file is missing, so I created it.",
    )
    expect(chunks).toEqual([
      { text: "I'll check whether the file exists.", blockId: 'codex-text-msg-1' },
      { text: 'The file is missing, so I created it.', blockId: 'codex-text-msg-2' },
    ])
    expect(onEvent.mock.calls.map(([event]) => event).filter((event) =>
      event.type === 'text_end' || event.type === 'tool_start' || event.type === 'tool_end'
    )).toEqual([
      { type: 'text_end', blockId: 'codex-text-msg-1' },
      { type: 'tool_start', id: 'cmd-1', name: 'Run Command', input: { command: 'Test-Path file' } },
      { type: 'tool_end', id: 'cmd-1', content: 'False', isError: false },
      { type: 'text_end', blockId: 'codex-text-msg-2' },
    ])
  })

  it('CodexAdapter does not re-emit tool_start when the approval flow re-announces the same item.started id', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const onEvent = vi.fn()
    const sendPromise = CodexAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'run a command' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {}, onEvent)

    proc.stdout.emit('data', Buffer.from([
      // Proposed, awaiting approval.
      JSON.stringify({
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'rm -rf build', aggregated_output: null, exit_code: null },
      }),
      // Re-announced once approved — same id, same fields.
      JSON.stringify({
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'rm -rf build', aggregated_output: null, exit_code: null },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'cmd-1', type: 'command_execution', command: 'rm -rf build', aggregated_output: 'removed', status: 'completed', exit_code: 0 },
      }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Done.' } }),
      '',
    ].join('\n')))
    proc.emit('close', 0)

    await expect(sendPromise).resolves.toBe('Done.')

    const toolStartCalls = onEvent.mock.calls.filter(([event]) => event.type === 'tool_start' && event.id === 'cmd-1')
    expect(toolStartCalls).toHaveLength(1)
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool_end',
      id: 'cmd-1',
      content: 'removed',
      isError: false,
    })
  })

  it('HermesAdapter strips ANSI output', async () => {
    mockSpawnSync.mockReturnValue({ stdout: '[31mecho hi[0m', status: 0, error: undefined })

    const chunks: string[] = []
    await expect(HermesAdapter.send({} as never, {
      messages: [{ role: 'assistant', content: 'ignore' }, { role: 'user', content: 'say hi' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, (chunk: string) => {
      chunks.push(chunk)
    })).resolves.toBe('echo hi')

    expect(chunks).toEqual(['echo hi'])
    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.stringContaining('hermes'),
      ['-z', 'say hi', '--ignore-user-config', '--ignore-rules'],
      expect.objectContaining({ cwd: 'C:\\workspace' }),
    )
  })

  it('HermesAdapter passes -m for a non-default model', async () => {
    mockSpawnSync.mockReturnValue({ stdout: 'hi there', status: 0, error: undefined })

    await expect(HermesAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'say hi' }],
      cwd: 'C:\\workspace',
      model: 'anthropic/claude-sonnet-4-6',
      conversationId: 'conv-1',
    }, () => {})).resolves.toBe('hi there')

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.stringContaining('hermes'),
      ['-z', 'say hi', '--ignore-user-config', '--ignore-rules', '-m', 'anthropic/claude-sonnet-4-6'],
      expect.objectContaining({ cwd: 'C:\\workspace' }),
    )
  })

  it('HermesAdapter rejects spawn errors', async () => {
    mockSpawnSync.mockReturnValue({ stdout: '', error: new Error('boom') })

    await expect(HermesAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'say hi' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})).rejects.toThrow('boom')
  })

  it('HermesAdapter rejects on non-zero exit with stderr instead of resolving empty', async () => {
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: 'auth error: no provider configured', status: 1, error: undefined })

    await expect(HermesAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'say hi' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})).rejects.toThrow('auth error: no provider configured')
  })

  it('HermesAdapter rejects when stdout is empty even with a zero exit status', async () => {
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: 'warning: falling back to default model', status: 0, error: undefined })

    await expect(HermesAdapter.send({} as never, {
      messages: [{ role: 'user', content: 'say hi' }],
      cwd: 'C:\\workspace',
      model: 'default',
      conversationId: 'conv-1',
    }, () => {})).rejects.toThrow('warning: falling back to default model')
  })

  describe('skipPermissions flag', () => {
    function makeClaudeOutput(text = 'done') {
      return [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
        JSON.stringify({ type: 'result', subtype: 'success', result: text, total_cost_usd: 0, usage: { input_tokens: 10, output_tokens: 5 } }),
      ].join('\n') + '\n'
    }

    it('ClaudeAdapter includes --dangerously-skip-permissions when skipPermissions is true', async () => {
      const proc = makeProc()
      mockSpawn.mockReturnValue(proc)

      const sendPromise = ClaudeAdapter.send({} as never, {
        messages: [{ role: 'user', content: 'do something' }],
        cwd: 'C:\\workspace',
        model: 'default',
        conversationId: 'conv-1',
        skipPermissions: true,
      }, () => {})

      proc.stdout.emit('data', Buffer.from(makeClaudeOutput()))
      proc.emit('close', 0)
      await sendPromise

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(spawnArgs).toContain('--dangerously-skip-permissions')
    })

    it('ClaudeAdapter omits --dangerously-skip-permissions when skipPermissions is false', async () => {
      const proc = makeProc()
      mockSpawn.mockReturnValue(proc)

      const sendPromise = ClaudeAdapter.send({} as never, {
        messages: [{ role: 'user', content: 'do something' }],
        cwd: 'C:\\workspace',
        model: 'default',
        conversationId: 'conv-1',
        skipPermissions: false,
      }, () => {})

      proc.stdout.emit('data', Buffer.from(makeClaudeOutput()))
      proc.emit('close', 0)
      await sendPromise

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(spawnArgs).not.toContain('--dangerously-skip-permissions')
    })

    it('ClaudeAdapter omits --dangerously-skip-permissions when skipPermissions is absent', async () => {
      const proc = makeProc()
      mockSpawn.mockReturnValue(proc)

      const sendPromise = ClaudeAdapter.send({} as never, {
        messages: [{ role: 'user', content: 'do something' }],
        cwd: 'C:\\workspace',
        model: 'default',
        conversationId: 'conv-1',
      }, () => {})

      proc.stdout.emit('data', Buffer.from(makeClaudeOutput()))
      proc.emit('close', 0)
      await sendPromise

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(spawnArgs).not.toContain('--dangerously-skip-permissions')
    })

    it('CodexAdapter sets the real approval policy when skipPermissions is true', async () => {
      const proc = makeProc()
      mockSpawn.mockReturnValue(proc)

      const sendPromise = CodexAdapter.send({} as never, {
        messages: [{ role: 'user', content: 'do it' }],
        cwd: 'C:\\workspace',
        model: 'default',
        conversationId: 'conv-1',
        skipPermissions: true,
      }, () => {})

      proc.stdout.emit('data', Buffer.from([
        JSON.stringify({ type: 'item.completed', item: { id: 'x', type: 'agent_message', text: 'done' } }),
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
        '',
      ].join('\n')))
      proc.emit('close', 0)
      await sendPromise

      const spawnArgs = (mockSpawn.mock.calls[0][1] as string[]).flat()
      const configIndex = spawnArgs.indexOf('--config')
      expect(configIndex).toBeGreaterThan(-1)
      expect(spawnArgs[configIndex + 1]).toBe('approval_policy="never"')
      const writtenStdin = proc.stdin.end.mock.calls[0][0] as string
      expect(writtenStdin).not.toContain('[AUTO-APPROVE]')
    })

    it('CodexAdapter leaves approval policy unchanged when skipPermissions is false', async () => {
      const proc = makeProc()
      mockSpawn.mockReturnValue(proc)

      const sendPromise = CodexAdapter.send({} as never, {
        messages: [{ role: 'user', content: 'do it' }],
        cwd: 'C:\\workspace',
        model: 'default',
        conversationId: 'conv-1',
        skipPermissions: false,
      }, () => {})

      proc.stdout.emit('data', Buffer.from([
        JSON.stringify({ type: 'item.completed', item: { id: 'x', type: 'agent_message', text: 'done' } }),
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
        '',
      ].join('\n')))
      proc.emit('close', 0)
      await sendPromise

      const spawnArgs = (mockSpawn.mock.calls[0][1] as string[]).flat()
      expect(spawnArgs).not.toContain('approval_policy="never"')
      const writtenStdin = proc.stdin.end.mock.calls[0][0] as string
      expect(writtenStdin).not.toContain('[AUTO-APPROVE]')
    })
  })
})
