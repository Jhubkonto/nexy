import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsTab } from '../../renderer/components/agent-panel/SettingsTab'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import type { AgentConfig } from '../../shared/types'

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    icon: '🤖',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [],
    contextFiles: [],
    mcpServers: [],
    agenticMode: false,
    tools: {
      fileEdit: { enabled: true, approval: 'auto', instructions: '' },
      terminal: { enabled: false, approval: 'always-ask', instructions: '' },
      webFetch: { enabled: true, approval: 'auto', instructions: '' },
    },
    responseFormat: 'default',
    ...overrides,
  }
}

function defaultProps(config: AgentConfig, onUpdateField = vi.fn()) {
  return {
    config,
    onUpdateField,
    newGlob: '',
    onSetNewGlob: vi.fn(),
    onAddIgnoredGlob: vi.fn(),
    onRemoveIgnoredGlob: vi.fn(),
    newCmdName: '',
    newCmdDesc: '',
    newCmdPrompt: '',
    onSetNewCmdName: vi.fn(),
    onSetNewCmdDesc: vi.fn(),
    onSetNewCmdPrompt: vi.fn(),
    onAddCustomCommand: vi.fn(),
    onRemoveCustomCommand: vi.fn(),
    onAddDirectories: vi.fn(),
    onAddFiles: vi.fn(),
    onRemoveContextDir: vi.fn(),
    onRemoveContextFile: vi.fn(),
    onPickRootDirectory: vi.fn(),
    onOpenCliSettings: vi.fn(),
    autoApproveDisabled: false,
  }
}

const user = userEvent.setup()

describe('SettingsTab — Danger Zone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the Danger Zone section', () => {
    render(<SettingsTab {...defaultProps(makeConfig())} />)
    expect(screen.getByText('Danger Zone')).toBeInTheDocument()
  })

  it('renders the auto-approve toggle', () => {
    render(<SettingsTab {...defaultProps(makeConfig())} />)
    expect(screen.getByRole('switch', { name: /auto-approve all actions/i })).toBeInTheDocument()
  })

  it('toggle is unchecked when fullAutoApprove is false', () => {
    render(<SettingsTab {...defaultProps(makeConfig({ fullAutoApprove: false }))} />)
    const toggle = screen.getByRole('switch', { name: /auto-approve all actions/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('toggle is checked when fullAutoApprove is true', () => {
    render(<SettingsTab {...defaultProps(makeConfig({ fullAutoApprove: true }))} />)
    const toggle = screen.getByRole('switch', { name: /auto-approve all actions/i })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('clicking toggle-on opens the confirmation modal', async () => {
    render(<SettingsTab {...defaultProps(makeConfig({ fullAutoApprove: false }))} />)
    const toggle = screen.getByRole('switch', { name: /auto-approve all actions/i })
    await user.click(toggle)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Enable auto-approve\?/i)).toBeInTheDocument()
  })

  it('cancelling the modal does not call onUpdateField', async () => {
    const onUpdateField = vi.fn()
    render(<SettingsTab {...defaultProps(makeConfig({ fullAutoApprove: false }), onUpdateField)} />)
    const toggle = screen.getByRole('switch', { name: /auto-approve all actions/i })
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onUpdateField).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('confirming the modal calls onUpdateField with fullAutoApprove: true', async () => {
    const onUpdateField = vi.fn()
    render(<SettingsTab {...defaultProps(makeConfig({ fullAutoApprove: false }), onUpdateField)} />)
    const toggle = screen.getByRole('switch', { name: /auto-approve all actions/i })
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: /enable auto-approve/i }))
    expect(onUpdateField).toHaveBeenCalledWith('fullAutoApprove', true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('toggling off directly calls onUpdateField with fullAutoApprove: false (no modal)', async () => {
    const onUpdateField = vi.fn()
    render(<SettingsTab {...defaultProps(makeConfig({ fullAutoApprove: true }), onUpdateField)} />)
    const toggle = screen.getByRole('switch', { name: /auto-approve all actions/i })
    await user.click(toggle)
    expect(onUpdateField).toHaveBeenCalledWith('fullAutoApprove', false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('disables the toggle and shows a scheduled task warning when blocked', async () => {
    const onUpdateField = vi.fn()
    render(<SettingsTab {...defaultProps(makeConfig({ fullAutoApprove: false }), onUpdateField)} autoApproveDisabled />)
    const toggle = screen.getByRole('switch', { name: /auto-approve all actions/i })

    expect(toggle).toBeDisabled()
    expect(screen.getByText(/not available for agents used in scheduled tasks/i)).toBeInTheDocument()
    await user.click(toggle)
    expect(onUpdateField).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('SettingsTab — Hermes profile picker', () => {
  let api: MockApi

  beforeEach(() => {
    vi.clearAllMocks()
    api = setupMockApi()
  })

  it('relabels the Hermes backend option as ACP (no legacy -z copy)', () => {
    render(<SettingsTab {...defaultProps(makeConfig())} />)
    expect(screen.getByRole('option', { name: /Hermes Agent \(ACP\)/i })).toBeInTheDocument()
    expect(screen.queryByText(/hermes -z/i)).not.toBeInTheDocument()
  })

  it('renders a dropdown of enumerated profiles when the backend is hermes-cli', async () => {
    api.listHermesProfiles.mockResolvedValue([
      { name: 'default', isDefault: true },
      { name: 'localllm-iso', isDefault: false, model: 'qwen2.5', description: 'Isolated local' },
    ])
    render(<SettingsTab {...defaultProps(makeConfig({ backend: 'hermes-cli' }))} />)
    const profilePicker = await screen.findByRole('button', { name: /default \(normal Hermes profile\)/i })
    await user.click(profilePicker)
    expect(screen.getByRole('option', { name: /localllm-iso.*qwen2\.5.*Isolated local/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /default \(normal Hermes profile\)/i })).toBeInTheDocument()
  })

  it('selecting a profile stores its name via onUpdateField', async () => {
    const onUpdateField = vi.fn()
    api.listHermesProfiles.mockResolvedValue([
      { name: 'default', isDefault: true },
      { name: 'localllm', isDefault: false },
    ])
    render(<SettingsTab {...defaultProps(makeConfig({ backend: 'hermes-cli' }), onUpdateField)} />)
    const profilePicker = await screen.findByRole('button', { name: /default \(normal Hermes profile\)/i })
    await user.click(profilePicker)
    await user.click(screen.getByRole('option', { name: /localllm/i }))
    expect(onUpdateField).toHaveBeenCalledWith('hermesProfile', 'localllm')
  })

  it('falls back to a free-text input when no profiles are available', async () => {
    api.listHermesProfiles.mockResolvedValue([])
    render(<SettingsTab {...defaultProps(makeConfig({ backend: 'hermes-cli' }))} />)
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/uses the normal Hermes profile/i)).toBeInTheDocument(),
    )
  })

  it('shows an unknown-profile warning option when the stored profile is not in the list', async () => {
    api.listHermesProfiles.mockResolvedValue([{ name: 'default', isDefault: true }])
    render(<SettingsTab {...defaultProps(makeConfig({ backend: 'hermes-cli', hermesProfile: 'ghost' }))} />)
    const profilePicker = await screen.findByRole('button', { name: /ghost.*unknown profile.*fall back to default/i })
    await user.click(profilePicker)
    expect(screen.getByRole('option', { name: /ghost.*unknown profile.*fall back to default/i })).toBeInTheDocument()
  })

  it('surfaces the profile-inheritance disclosure', async () => {
    api.listHermesProfiles.mockResolvedValue([{ name: 'default', isDefault: true }])
    render(<SettingsTab {...defaultProps(makeConfig({ backend: 'hermes-cli' }))} />)
    await waitFor(() =>
      expect(screen.getByText(/its memory, skills, and SOUL\.md carry into every session/i)).toBeInTheDocument(),
    )
  })

  it('shows a not-ACP-ready warning when readiness probe fails', async () => {
    api.listHermesProfiles.mockResolvedValue([{ name: 'default', isDefault: true }])
    api.getHermesAcpReadiness.mockResolvedValue({ ready: false, detail: 'no provider credentials' })
    render(<SettingsTab {...defaultProps(makeConfig({ backend: 'hermes-cli' }))} />)
    await waitFor(() =>
      expect(screen.getByText(/not ACP-ready.*no provider credentials/i)).toBeInTheDocument(),
    )
  })

  it('explains where named profiles must exist when discovery finds only default', async () => {
    api.getHermesProfileDiscovery.mockResolvedValue({
      profiles: [{ name: 'default', isDefault: true }],
      root: 'C:\\Users\\tester\\AppData\\Local\\hermes',
      rootSource: 'platform-default',
      profilesDirectory: 'C:\\Users\\tester\\AppData\\Local\\hermes\\profiles',
      profilesDirectoryExists: false,
      namedProfileCount: 0,
      ignoredEntries: [],
    })
    render(<SettingsTab {...defaultProps(makeConfig({ backend: 'hermes-cli' }))} />)
    await waitFor(() =>
      expect(screen.getByText(/found only the default profile/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/AppData\\Local\\hermes\\profiles/i)).toBeInTheDocument()
  })
})
