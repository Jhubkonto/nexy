import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CapabilitiesModal } from '../../renderer/components/CapabilitiesModal'
import type { ComponentProps } from 'react'
import type { CapabilityPreflight, CredentialMetadata } from '../../shared/types'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi

const server = {
  id: 'browser',
  name: 'Browser MCP',
  command: 'node',
  args: [],
  env: {},
  enabled: true,
  status: 'connected' as const,
  toolCount: 2,
}

const profile = (trust: 'auto' | 'always-ask' | 'block') => ({
  version: 1 as const,
  skillIds: ['skill-one'],
  mcp: [{ serverId: 'browser', trust }],
})

const skills = [
  { id: 'skill-one', name: 'Test skill', icon: '✨', description: 'A test skill' },
  { id: 'skill-two', name: 'Other skill', icon: '📚', description: 'Research documents' },
] as ComponentProps<typeof CapabilitiesModal>['skills']

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function openModal(props: Partial<ComponentProps<typeof CapabilitiesModal>> = {}) {
  const user = userEvent.setup()
  const result = render(<CapabilitiesModal conversationId="conv-1" skills={skills} {...props} />)
  await user.click(screen.getByRole('button', { name: /^Chat capabilities/ }))
  await screen.findByRole('searchbox', { name: 'Search skills' })
  return { user, ...result }
}

const credential: CredentialMetadata = {
  id: 'credential-1', name: 'Personal credential', kind: 'api-key', provider: null, targetOrigin: null,
  fingerprint: 'abcd', createdAt: 1, updatedAt: 1, lastUsedAt: null, revokedAt: null,
}

describe('CapabilitiesModal', () => {
  beforeEach(() => {
    mockApi = setupMockApi()
    mockApi.listMcpServers = vi.fn().mockResolvedValue([server])

    let chatProfile = profile('auto')
    mockApi.resolveCapabilities = vi.fn().mockImplementation(async () => ({
      conversationId: 'conv-1',
      // The inherited agent restriction is stricter than the chat value. Execution must still
      // use always-ask, but the chat editor should show the value saved in this chat.
      profile: { ...chatProfile, mcp: [{ serverId: 'browser', trust: 'always-ask' }] },
      scopeProfiles: { chat: chatProfile, project: null, agent: profile('always-ask') },
      items: [],
      ready: true,
      desktopOnly: true,
    }))
    mockApi.setConversationCapabilities = vi.fn().mockImplementation(async (_id, nextProfile) => {
      chatProfile = nextProfile
      return nextProfile
    })
  })

  it('keeps the chat-scoped approval value after saving despite stricter inherited policy', async () => {
    const user = userEvent.setup()
    render(
      <CapabilitiesModal
        conversationId="conv-1"
        skills={[{ id: 'skill-one', name: 'Test skill', icon: '✨', description: 'A test skill' } as never]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Chat capabilities' }))
    await user.click(screen.getByRole('tab', { name: 'MCP tools' }))
    const select = await screen.findByLabelText('Approval for Browser MCP')
    expect(select).toHaveValue('auto')

    await user.selectOptions(select, 'block')
    await user.click(screen.getByRole('button', { name: 'Use in this chat' }))

    await waitFor(() => expect(mockApi.setConversationCapabilities).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ skillIds: ['skill-one'], mcp: [{ serverId: 'browser', trust: 'block' }] }),
    ))
    await waitFor(() => expect(screen.getByLabelText('Approval for Browser MCP')).toHaveValue('block'))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Chat capabilities' })).toBeInTheDocument()
  })

  it('grants a general credential only to the active chat', async () => {
    const user = userEvent.setup()
    mockApi.credentialList.mockResolvedValue([{
      id: 'credential-1', name: 'Personal credential', kind: 'api-key', provider: null,
      fingerprint: 'abcd', createdAt: 1, updatedAt: 1, lastUsedAt: null, revokedAt: null,
    }])
    render(
      <CapabilitiesModal
        conversationId="conv-1"
        skills={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Chat capabilities' }))
    await user.click(screen.getByRole('tab', { name: 'Credentials' }))
    await user.selectOptions(await screen.findByLabelText('Credential for this chat'), 'credential-1')
    await user.click(screen.getByRole('button', { name: 'Grant' }))

    await waitFor(() => expect(mockApi.credentialBindingCreate).toHaveBeenCalledWith(expect.objectContaining({
      credentialId: 'credential-1',
      conversationId: 'conv-1',
      capability: 'credential:credential-1',
      approvalMode: 'auto',
    })))
  })

  it('opens a portal dialog, searches both lists, and preserves drafts across tabs', async () => {
    const { user, container } = await openModal()
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Chat capabilities')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(screen.getByRole('button', { name: /Chat capabilities, 2 active/ })).toHaveAttribute('aria-haspopup', 'dialog')
    await user.type(screen.getByRole('searchbox'), 'Research')
    expect(screen.queryByRole('checkbox', { name: /Test skill/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    expect(screen.getByRole('button', { name: /Chat capabilities, 2 active/ })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'MCP tools' }))
    await user.type(screen.getByRole('searchbox'), 'missing')
    expect(screen.getByText('No MCP servers match “missing”.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Skills' }))
    expect(screen.getByRole('searchbox')).toHaveValue('Research')
    expect(screen.getByRole('checkbox', { name: /Other skill/ })).toBeChecked()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'missing')
    expect(screen.getByText('No skills match “missing”.')).toBeInTheDocument()
  })

  it.each(['Close', 'header', 'Escape', 'backdrop'])('confirms unsaved edits on %s, restores focus on cancel, and discards on confirmation', async (path) => {
    const { user } = await openModal()
    const checkbox = screen.getByRole('checkbox', { name: /Other skill/ })
    await user.click(checkbox)
    let expectedFocus: HTMLElement = checkbox
    if (path === 'Escape') await user.keyboard('{Escape}')
    else if (path === 'backdrop') fireEvent.click(screen.getByTestId('modal-backdrop'))
    else {
      expectedFocus = screen.getByRole('button', { name: path === 'header' ? 'Close Chat capabilities' : 'Close' })
      await user.click(expectedFocus)
    }
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Close Discard unsaved changes?' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close Discard unsaved changes?' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument()
    expect(expectedFocus).toHaveFocus()
    expect(checkbox).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Chat capabilities/ })).toHaveFocus()
    expect(mockApi.setConversationCapabilities).not.toHaveBeenCalled()
  })

  it('closes cleanly, restores trigger focus, and starts on Skills when reopened', async () => {
    const { user } = await openModal()
    await user.click(screen.getByRole('tab', { name: 'Readiness' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: /^Chat capabilities/ })
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
  })

  it('confirms scope changes and persists the chosen scope across openings', async () => {
    const { user } = await openModal({ projectId: 'project-1', projectName: 'Project', agentId: 'agent-1' })
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    await user.selectOptions(screen.getByLabelText('Use this setup'), 'project')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Use this setup')).toHaveValue('chat')
    await user.selectOptions(screen.getByLabelText('Use this setup'), 'project')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('checkbox', { name: /Test skill/ })).not.toBeChecked()
    expect(screen.getByText(/Saving here only adds to the project/)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    await user.click(screen.getByRole('button', { name: 'Add to project' }))
    await waitFor(() => expect(mockApi.activateCapabilities).toHaveBeenCalledWith('conv-1', expect.objectContaining({ scope: 'project', targetId: 'project-1', skillIds: ['skill-two'] })))
    await screen.findByText('Saved')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: /^Chat capabilities/ }))
    await waitFor(() => expect(screen.getByLabelText('Use this setup')).toHaveValue('project'))
    await user.selectOptions(screen.getByLabelText('Use this setup'), 'agent')
    expect(screen.getByText('Attach reusable capabilities to this agent’s defaults.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Test skill/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Attach to agent' }))
    await waitFor(() => expect(mockApi.activateCapabilities).toHaveBeenCalledWith('conv-1', expect.objectContaining({ scope: 'agent', targetId: 'agent-1' })))
  })

  it.each(['skills', 'mcp', 'project', 'repair'])('confirms before following the %s management link', async (link) => {
    const callback = vi.fn()
    if (link === 'repair') {
      const result = await mockApi.resolveCapabilities('conv-1')
      mockApi.resolveCapabilities.mockResolvedValue({ ...result, items: [{ kind: 'mcp', id: 'browser', label: 'Browser MCP', status: 'disconnected', detail: 'Reconnect it', provenance: 'agent' }] })
    }
    const { user } = await openModal({ projectId: 'project-1', onOpenSkills: callback, onOpenMcp: callback, onOpenProjectCapabilities: callback })
    if (link === 'project') await user.selectOptions(screen.getByLabelText('Use this setup'), 'project')
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    if (link === 'mcp') await user.click(screen.getByRole('tab', { name: 'MCP tools' }))
    if (link === 'repair') await user.click(screen.getByRole('tab', { name: 'Readiness' }))
    const name = { skills: 'Open Skills', mcp: 'Manage or add MCP capabilities', project: 'Manage project capabilities', repair: 'Fix MCP setup' }[link]
    await user.click(screen.getByRole('button', { name }))
    expect(callback).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(callback).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refreshes MCP status and readiness without overwriting skills or approval edits', async () => {
    const { user } = await openModal()
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    await user.click(screen.getByRole('tab', { name: 'MCP tools' }))
    await user.selectOptions(screen.getByLabelText('Approval for Browser MCP'), 'block')
    mockApi.listMcpServers.mockResolvedValue([{ ...server, status: 'disconnected', toolCount: 0 }])
    const callback = mockApi.onMcpServerStatusChanged.mock.calls[0][0]
    await act(async () => callback({ serverId: 'browser', status: 'disconnected' }))
    expect(await screen.findByText('disconnected · 0 tools')).toBeInTheDocument()
    expect(screen.getByLabelText('Approval for Browser MCP')).toHaveValue('block')
    await user.click(screen.getByRole('tab', { name: 'Skills' }))
    expect(screen.getByRole('checkbox', { name: /Other skill/ })).toBeChecked()
  })

  it.each(['hour', 'today', 'until-removed'] as const)('filters credentials, applies %s duration, removes grants, and preserves drafts', async (duration) => {
    mockApi.credentialList.mockResolvedValue([credential, { ...credential, id: 'provider', name: 'Provider key', provider: 'openai' }, { ...credential, id: 'revoked', name: 'Revoked key', revokedAt: 1 }])
    mockApi.credentialBindingList.mockResolvedValue([
      { id: 'binding-1', credentialId: credential.id, conversationId: 'conv-1', capability: 'credential:credential-1', expiresAt: null },
      { id: 'other-chat', credentialId: credential.id, conversationId: 'conv-2', capability: 'other-chat-grant', expiresAt: null },
    ] as never)
    const { user } = await openModal()
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    await user.click(screen.getByRole('tab', { name: 'Credentials' }))
    expect(screen.getByText(/Grant and Remove apply immediately to this chat/)).toBeInTheDocument()
    expect(screen.queryByText('other-chat-grant')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Provider key' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Revoked key' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Credential for this chat'), 'credential-1')
    await user.selectOptions(screen.getByLabelText('Credential grant duration'), duration)
    const before = Date.now()
    await user.click(screen.getByRole('button', { name: 'Grant' }))
    await waitFor(() => expect(mockApi.credentialBindingCreate).toHaveBeenCalledOnce())
    const expires = mockApi.credentialBindingCreate.mock.calls[0][0].expiresAt
    if (duration === 'until-removed') expect(expires).toBeNull()
    if (duration === 'hour') {
      expect(expires).toBeGreaterThanOrEqual(before + 3600000)
      expect(expires).toBeLessThanOrEqual(Date.now() + 3600000)
    }
    if (duration === 'today') expect(expires).toBe(new Date(new Date().setHours(23, 59, 59, 999)).getTime())
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(mockApi.credentialBindingDelete).toHaveBeenCalledWith('binding-1'))
    await user.click(screen.getByRole('tab', { name: 'Skills' }))
    expect(screen.getByRole('checkbox', { name: /Other skill/ })).toBeChecked()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('blocks editing, scope changes, and all dismissal paths during a save', async () => {
    const pending = deferred<ReturnType<typeof profile>>()
    mockApi.setConversationCapabilities.mockReturnValue(pending.promise)
    const { user } = await openModal({ projectId: 'project-1', onOpenSkills: vi.fn() })
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    await user.click(screen.getByRole('button', { name: 'Use in this chat' }))
    expect(screen.getByRole('checkbox', { name: /Other skill/ })).toBeDisabled()
    expect(screen.getByLabelText('Use this setup')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open Skills' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close Chat capabilities' })).toBeDisabled()
    screen.getByRole('tab', { name: 'Readiness' }).focus()
    await user.tab()
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveFocus()
    await user.keyboard('{Escape}')
    fireEvent.click(screen.getByTestId('modal-backdrop'))
    expect(screen.getByRole('dialog', { name: 'Chat capabilities' })).toBeInTheDocument()
    await act(async () => pending.resolve(profile('auto')))
    await screen.findByText('Saved')
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
  })

  it('blocks saves during initial load and recovers from load failures', async () => {
    const pending = deferred<CapabilityPreflight>()
    mockApi.resolveCapabilities.mockReturnValueOnce(pending.promise)
    const user = userEvent.setup()
    render(<CapabilitiesModal conversationId="conv-1" skills={skills} />)
    await user.click(screen.getByRole('button', { name: 'Chat capabilities' }))
    expect(screen.getByText('Loading capabilities…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use in this chat' })).toBeDisabled()
    await act(async () => pending.reject(new Error('Load failed')))
    expect(screen.getByRole('alert')).toHaveTextContent('Load failed')
    expect(screen.getByRole('button', { name: 'Use in this chat' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('checkbox', { name: /Test skill/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Use in this chat' })).toBeEnabled()
  })

  it('retains drafts after a failed save and allows saving again', async () => {
    mockApi.setConversationCapabilities.mockRejectedValueOnce(new Error('Save failed'))
    const { user } = await openModal()
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    await user.click(screen.getByRole('button', { name: 'Use in this chat' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
    expect(screen.getByRole('checkbox', { name: /Other skill/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Use in this chat' }))
    await screen.findByText('Saved')
    await waitFor(() => expect(screen.getByRole('button', { name: /Chat capabilities, 3 active/ })).toBeInTheDocument())
  })

  it('ignores stale status reads after a scope change and later refresh', async () => {
    const { user } = await openModal({ projectId: 'project-1' })
    const stale = deferred<CapabilityPreflight>()
    mockApi.resolveCapabilities.mockReturnValueOnce(stale.promise)
    const callback = mockApi.onMcpServerStatusChanged.mock.calls[0][0]
    act(() => callback({ serverId: 'browser', status: 'connecting' }))
    await user.selectOptions(screen.getByLabelText('Use this setup'), 'project')
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    const latest = await mockApi.resolveCapabilities('conv-1')
    mockApi.resolveCapabilities.mockResolvedValue({ ...latest, items: [{ kind: 'mcp', id: 'browser', label: 'Latest status', status: 'ready', detail: '', provenance: 'project' }] })
    await act(async () => callback({ serverId: 'browser', status: 'connected' }))
    await act(async () => stale.resolve({ ...latest, items: [] }))
    expect(screen.getByRole('checkbox', { name: /Other skill/ })).toBeChecked()
    await user.click(screen.getByRole('tab', { name: 'Readiness' }))
    expect(screen.getByText('Latest status')).toBeInTheDocument()
    expect(screen.getByText('Source: project')).toBeInTheDocument()
  })

  it('resets on conversation changes and ignores the previous conversation’s pending results', async () => {
    const { user, rerender } = await openModal()
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    const stale = deferred<CapabilityPreflight>()
    mockApi.resolveCapabilities.mockReturnValueOnce(stale.promise)
    const callback = mockApi.onMcpServerStatusChanged.mock.calls[0][0]
    act(() => callback({ serverId: 'browser', status: 'connecting' }))
    rerender(<CapabilitiesModal conversationId="conv-2" skills={skills} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chat capabilities' }))
    expect(await screen.findByRole('checkbox', { name: /Other skill/ })).not.toBeChecked()
    const next = await mockApi.resolveCapabilities('conv-2')
    await act(async () => stale.resolve({ ...next, profile: { version: 1, skillIds: [], mcp: [] } }))
    expect(screen.getByRole('button', { name: /Chat capabilities, 2 active/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
  })

  it('creates a conversation before opening, handles the parent adopting its ID, and reports creation errors', async () => {
    const ensure = vi.fn().mockRejectedValueOnce(new Error('Creation failed')).mockResolvedValue('created-chat')
    const user = userEvent.setup()
    const { rerender } = render(<CapabilitiesModal conversationId={null} skills={skills} onEnsureConversation={ensure} />)
    await user.click(screen.getByRole('button', { name: 'Chat capabilities' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Creation failed')
    await user.click(screen.getByRole('button', { name: 'Chat capabilities' }))
    await screen.findByRole('searchbox')
    expect(mockApi.resolveCapabilities).toHaveBeenCalledWith('created-chat', undefined)
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    rerender(<CapabilitiesModal conversationId="created-chat" skills={skills} onEnsureConversation={ensure} />)
    expect(screen.getByRole('dialog', { name: 'Chat capabilities' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Other skill/ })).toBeChecked()
  })

  it('shows empty states and defaults new MCP selections to Ask every time', async () => {
    mockApi.listMcpServers.mockResolvedValue([])
    const { user } = await openModal()
    await user.click(screen.getByRole('tab', { name: 'MCP tools' }))
    expect(screen.getByText('No MCP servers configured yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Credentials' }))
    expect(screen.getByText('No credentials granted to this chat.')).toBeInTheDocument()
    expect(screen.getByText(/Add a credential in Settings/)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Readiness' }))
    expect(screen.getByText('No saved capabilities to check.')).toBeInTheDocument()
    mockApi.listMcpServers.mockResolvedValue([server])
    const callback = mockApi.onMcpServerStatusChanged.mock.calls[0][0]
    await act(async () => callback({ serverId: 'browser', status: 'connected' }))
    await user.click(screen.getByRole('tab', { name: 'MCP tools' }))
    await user.click(screen.getByRole('checkbox', { name: /Browser MCP/ }))
    await user.click(screen.getByRole('checkbox', { name: /Browser MCP/ }))
    expect(screen.getByLabelText('Approval for Browser MCP')).toHaveValue('always-ask')
    expect(screen.getByText(/servers can't be approved during a headless\/CLI turn/)).toBeInTheDocument()
  })

  it.each([null, 'old-created-chat'])('ignores a conversation creation result (%s) after switching away and back to a new chat', async (result) => {
    const pending = deferred<string | null>()
    const ensure = vi.fn().mockReturnValue(pending.promise)
    const user = userEvent.setup()
    const { rerender } = render(<CapabilitiesModal conversationId={null} skills={skills} onEnsureConversation={ensure} />)
    await user.click(screen.getByRole('button', { name: 'Chat capabilities' }))
    rerender(<CapabilitiesModal conversationId="another-chat" skills={skills} onEnsureConversation={ensure} />)
    rerender(<CapabilitiesModal conversationId={null} skills={skills} onEnsureConversation={ensure} />)
    await act(async () => pending.resolve(result))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockApi.resolveCapabilities).not.toHaveBeenCalled()
  })

  it('refreshes readiness after saving and keeps edits separate from the saved readiness', async () => {
    const { user } = await openModal()
    await user.click(screen.getByRole('checkbox', { name: /Other skill/ }))
    await user.click(screen.getByRole('tab', { name: 'Readiness' }))
    expect(screen.getByText('No saved capabilities to check.')).toBeInTheDocument()
    const next = await mockApi.resolveCapabilities('conv-1')
    mockApi.resolveCapabilities.mockResolvedValue({ ...next, items: [{ kind: 'skill', id: 'skill-two', label: 'Other skill', status: 'ready', detail: 'Ready to use', provenance: 'this-chat' }] })
    await user.click(screen.getByRole('button', { name: 'Use in this chat' }))
    expect(await screen.findByText('Ready to use', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Chat capabilities' })).toBeInTheDocument()
  })
})
