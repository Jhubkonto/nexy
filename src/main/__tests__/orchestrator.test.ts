import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendProviderWithTools: vi.fn(),
  windowSend: vi.fn(),
  broadcastToMobile: vi.fn(),
  getAgentConfig: vi.fn(() => ({ systemPrompt: 'You are an agent.' })),
  streamProviderMessage: vi.fn(),
}))

vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured. Add an API key in Settings.',
  getProviderForAgent: vi.fn((model?: string) => ({ provider: 'openai', model: model ?? 'gpt-5-mini' })),
  getApiKey: vi.fn(() => 'test-key'),
  getProviderCredential: vi.fn(() => 'test-key'),
  getAzureEndpoint: vi.fn(() => null),
  sendProviderWithTools: mocks.sendProviderWithTools,
  streamProviderMessage: mocks.streamProviderMessage,
}))

vi.mock('../agents', () => ({ getAgentConfig: mocks.getAgentConfig }))
vi.mock('../ws-server', () => ({ broadcastToMobile: mocks.broadcastToMobile }))
vi.mock('crypto', () => ({ randomUUID: vi.fn(() => 'step-uuid') }))

import { runOrchestration, type OrchestratorOptions } from '../orchestrator'

function makeOpts(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    projectId: 'proj-1',
    projectName: 'Test Project',
    leaderAgentId: 'leader-id',
    teamAgents: [{ agentId: 'leader-id', agentName: 'Leader', agentIcon: '👑', isPrimary: true, sortOrder: 0 }],
    conversationId: 'conv-1',
    window: { webContents: { send: mocks.windowSend } } as unknown as Electron.BrowserWindow,
    selectedModel: 'gpt-4o',
    generationOptions: { temperature: 0.7, maxTokens: 4096 },
    ...overrides,
  }
}

describe('orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the leader response when no delegation is requested', async () => {
    mocks.sendProviderWithTools.mockResolvedValue({ content: 'Leader answer', toolCalls: [] })

    const result = await runOrchestration(makeOpts(), 'Hi', [])

    expect(result.finalContent).toBe('Leader answer')
    expect(result.teamActivity).toEqual([])
  })

  it('uses the default provider model when none is selected', async () => {
    mocks.sendProviderWithTools.mockResolvedValue({ content: 'Default model answer', toolCalls: [] })

    await runOrchestration(makeOpts({ selectedModel: undefined }), 'Hi', [])

    expect(mocks.sendProviderWithTools).toHaveBeenCalled()
  })

  it('broadcasts team activity to mobile when delegating', async () => {
    const history = vi.fn()
    mocks.streamProviderMessage.mockResolvedValueOnce('Specialist result')
    mocks.sendProviderWithTools
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'delegate_to_agent', arguments: { agent_id: 'builder-id', task: 'Review plan' } }],
      })
      .mockResolvedValueOnce({ content: 'Final answer', toolCalls: [] })

    await runOrchestration(
      makeOpts({
        onHistory: history,
        teamAgents: [
          { agentId: 'leader-id', agentName: 'Leader', agentIcon: 'L', isPrimary: true, sortOrder: 0 },
          { agentId: 'builder-id', agentName: 'Builder', agentIcon: 'B', isPrimary: false, sortOrder: 1 },
        ],
      }),
      'Hi',
      [{ role: 'user', content: 'Prior decision: preserve the API.' }, { role: 'assistant', content: 'Agreed.' }],
    )

    expect(mocks.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:team-activity',
      data: expect.objectContaining({
        conversationId: 'conv-1',
        stepId: 'step-uuid',
        agentName: 'Builder',
        status: 'delegating',
      }),
    })
    expect(mocks.sendProviderWithTools.mock.calls[0][3]).toEqual(expect.arrayContaining([
      { role: 'user', content: 'Prior decision: preserve the API.' },
    ]))
    expect(history.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call-1', content: 'Specialist result' }),
      { role: 'assistant', content: 'Final answer' },
    ]))
    expect(mocks.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:team-activity',
      data: expect.objectContaining({
        conversationId: 'conv-1',
        stepId: 'step-uuid',
        agentName: 'Builder',
        status: 'done',
      }),
    })
  })

  it('fails a delegated step that emits a textual tool call', async () => {
    const markup = '<tool><name>bash</name></tool>\n<bash><command>ls</command></bash>'
    mocks.streamProviderMessage.mockImplementationOnce(async (_p, _c, _m, _messages, _id, onChunk) => {
      onChunk(markup.slice(0, 15))
      onChunk(markup.slice(15))
      return markup
    })
    mocks.sendProviderWithTools
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'call-1', name: 'delegate_to_agent', arguments: { agent_id: 'builder-id', task: 'Inspect files' } }] })
      .mockResolvedValueOnce({ content: 'Unable to inspect files.', toolCalls: [] })

    const result = await runOrchestration(makeOpts({ teamAgents: [
      { agentId: 'leader-id', agentName: 'Leader', agentIcon: 'L', isPrimary: true, sortOrder: 0 },
      { agentId: 'builder-id', agentName: 'Builder', agentIcon: 'B', isPrimary: false, sortOrder: 1 },
    ] }), 'Inspect files', [])

    expect(result.teamActivity[0].status).toBe('error')
    expect(result.teamActivity[0].result).toContain('No tool call was executed')
    expect(mocks.windowSend).not.toHaveBeenCalledWith('chat:team-step-stream', expect.anything())
    expect(mocks.sendProviderWithTools.mock.calls[1][3].at(-1).content).toContain('No tool call was executed')
  })
})
