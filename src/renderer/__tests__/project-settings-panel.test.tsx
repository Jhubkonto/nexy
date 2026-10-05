import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectSettingsPanel } from '../components/ProjectSettingsPanel'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import { setupMockApi } from '../../test/mocks/api'
import type { ProjectConfig } from '../store/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

const BASE_CONFIG: ProjectConfig = {
  instructions: 'Do stuff',
  rootDirectory: '/tmp/project',
  sources: [],
  repositories: [],
  codingWorkspace: false,
  workspaceInfo: null,
  variables: [],
  instructionMode: 'prepend',
  instructionsEnabled: true,
  workflowMode: 'single-agent',
  orchestrationEnabled: false,
  maxDelegationDepth: 5,
  showTeamActivity: true,
  inScope: [],
  outOfScope: [],
  milestones: [],
  strategyRetrievalEnabled: false,
  terminalSandboxBypass: false,
  defaultThinkingEffort: null,
  capabilityProfile: { version: 1, skillIds: [], mcp: [] },
}

const PROJECT = { id: 'proj-1', name: 'My Project', color: 'blue', created_at: 0, default_model: null }

let mockStore: ReturnType<typeof createMockAppStore>
let user: ReturnType<typeof userEvent.setup>

beforeEach(() => {
  user = userEvent.setup()
  vi.clearAllMocks()
  setupMockApi()
  mockStore = createMockAppStore({
    projects: [PROJECT],
    projectConfigs: { 'proj-1': BASE_CONFIG },
    activeProjectId: 'proj-1',
    agents: [],
    agentsLoading: false,
    conversations: [],
    currentConversationId: null,
    activeAgentId: null,
  })
  setupStoreMock(useAppStore, mockStore)
})

// ── Tab navigation ─────────────────────────────────────────────────────────────

describe('ProjectSettingsPanel — tabs', () => {
  it('k-1: renders all three tabs', () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /scope/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /milestones/i })).toBeInTheDocument()
  })

  it('k-1b: offers project-scoped capabilities as an editable tab on a saved project', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    const tab = screen.getByRole('tab', { name: /capabilities/i })
    expect(tab).toBeInTheDocument()

    await user.click(tab)
    expect(await screen.findByText(/Set the tools every chat may use in this project/)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Code Changes' })).not.toBeInTheDocument()
  })

  it('k-2: General tab is active by default', () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument()
  })

  it('allows an existing project color to be changed', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Color blue' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Color purple' }))

    expect(mockStore.updateProjectColor).toHaveBeenCalledWith('proj-1', 'My Project', 'purple')
    expect(screen.getByRole('button', { name: 'Color purple' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('k-3: initialTab prop selects the correct tab on mount', () => {
    render(<ProjectSettingsPanel projectId="proj-1" initialTab="scope" onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /scope/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('k-4: clicking Scope tab shows In Scope and Out of Scope sections', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    expect(screen.getByText(/in scope/i)).toBeInTheDocument()
    expect(screen.getByText(/out of scope/i)).toBeInTheDocument()
  })

  it('k-5: clicking Milestones tab shows milestones content', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    expect(screen.getByRole('button', { name: /add milestone/i })).toBeInTheDocument()
  })

  it('k-7: toggling "Surface similar past strategies" persists the change', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    const toggle = screen.getByRole('switch', { name: /enable similar past strategies/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/compares it with conversations you rated in this project/i)).toBeInTheDocument()
    expect(screen.getByText(/not the old conversation or its full answer/i)).toBeInTheDocument()

    await user.click(toggle)

    expect(mockStore.updateProjectConfig).toHaveBeenLastCalledWith(
      'proj-1',
      expect.objectContaining({ strategyRetrievalEnabled: true }),
    )
  })

  it('lets a project choose its default from currently available models', async () => {
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: { 'proj-1': BASE_CONFIG },
      availableModelGroups: [{
        sourceKey: 'openai',
        sourceLabel: 'OpenAI',
        sourceType: 'provider',
        models: [{ id: 'gpt-5-mini', label: 'GPT-5 mini' }],
      }],
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /conversation model/i }))
    await user.click(await screen.findByRole('button', { name: /gpt-5 mini/i }))

    expect(mockStore.setProjectDefaultModel).toHaveBeenCalledWith('proj-1', 'gpt-5-mini', undefined)
  })

  it('persists the project default thinking effort', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)

    await user.selectOptions(screen.getByRole('combobox', { name: /default thinking effort/i }), 'high')

    await vi.waitFor(() => expect(mockStore.updateProjectConfig).toHaveBeenLastCalledWith(
      'proj-1',
      expect.objectContaining({ defaultThinkingEffort: 'high' }),
    ))
  })
})

describe('ProjectSettingsPanel — coding workspace metadata', () => {
  it('removes a discovered repository from Nexy and refreshes the project config', async () => {
    const api = setupMockApi()
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          sources: [{
            id: 'source-1', projectId: 'proj-1', label: 'Workspace', kind: 'workspace-root',
            localPath: '/tmp/project', enabled: true, isPrimary: true, createdAt: 1, updatedAt: 1,
          }],
          repositories: [{
            id: 'repo-old', projectId: 'proj-1', sourceId: 'source-1', label: 'old-repo',
            relativePath: 'old-repo', branch: null, dirty: null, enabled: true, available: false,
            createdAt: 1, updatedAt: 1,
          }],
        },
      },
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ProjectSettingsPanel projectId="proj-1" initialTab="general" onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Remove old-repo repository from project' }))

    expect(api.removeProjectRepository).toHaveBeenCalledWith('proj-1', 'repo-old')
    expect(mockStore.loadProjectConfig).toHaveBeenCalledWith('proj-1')
  })

  it('shows repo metadata and coding workspace toggle when a codebase is detected', async () => {
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          workspaceInfo: {
            rootDirectory: '/tmp/project',
            exists: true,
            isLikelyCodingWorkspace: true,
            codingMarkers: ['package.json', 'src'],
            isGitRepo: true,
            repoRoot: '/tmp/project',
            branch: 'main',
            dirty: true,
            scannedAt: 1000,
          },
        },
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ProjectSettingsPanel projectId="proj-1" initialTab="general" onClose={vi.fn()} />)

    expect(screen.getByText(/git repo · main · dirty/i)).toBeInTheDocument()
    expect(screen.getByText(/coding markers: package\.json, src/i)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /enable software workspace mode/i })).toBeInTheDocument()
  })
})

describe('ProjectSettingsPanel — automated workflow mode', () => {
  it('shows automated workflow controls and starts generation in automated mode', async () => {
    const api = setupMockApi()
    mockStore = createMockAppStore({
      authState: { authenticated: true, mode: 'byok', user: null, cliInstalled: false, clis: { claude: false, codex: false } },
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          workflowMode: 'automated-delegation',
        },
      },
      projectAgents: {
        'proj-1': [
          { agentId: 'agent-1', agentName: 'Planner', agentIcon: '🧠', isPrimary: true, sortOrder: 0 },
        ],
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ProjectSettingsPanel projectId="proj-1" initialTab="team" onClose={vi.fn()} />)

    expect(screen.getByText(/generate a delegation plan/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open workflow tab/i }))

    expect(screen.getByText('Automated Workflow')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /start a new workflow/i }))
    await user.type(screen.getByPlaceholderText(/describe the goal/i), 'Plan a release')
    await user.click(screen.getByRole('button', { name: /generate workflow/i }))

    expect(api.automatedWorkflowGeneratorChat).toHaveBeenCalledWith('proj-1', [
      { role: 'user', content: 'Plan a release' },
    ], undefined)
  })

  it('renders generated workflow steps and starts the workflow run', async () => {
    const api = setupMockApi()
    let onSpecReady!: (spec: import('../../shared/types').AutomatedWorkflowSpec) => void
    api.onAutomatedWorkflowGeneratorSpecReady.mockImplementation((callback) => {
      onSpecReady = callback
      return () => {}
    })
    api.saveAutomatedWorkflowRunFromSpec.mockImplementation(async (
      projectId: string,
      spec: import('../../shared/types').AutomatedWorkflowSpec,
    ) => ({
      id: 'run-1',
      projectId,
      title: spec.title,
      goalSummary: spec.goalSummary,
      model: null,
      status: 'pending' as const,
      confirmationMode: 'gated' as const,
      currentStepId: null,
      lastError: null,
      assumptions: spec.assumptions,
      stepCounts: { total: spec.steps.length, pending: spec.steps.length, running: 0, awaitingConfirmation: 0, done: 0, failed: 0, skipped: 0 },
      createdAt: 1,
      updatedAt: 1,
      steps: spec.steps.map((step, index) => ({
        ...step,
        dbId: `db-${step.id}`,
        runId: 'run-1',
        stepIndex: index,
        status: 'pending' as const,
        attempt: 0,
        output: '',
        error: null,
        conversationId: null,
        startedAt: null,
        completedAt: null,
      })),
    }))

    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          workflowMode: 'automated-delegation',
        },
      },
      projectAgents: {
        'proj-1': [
          { agentId: 'agent-1', agentName: 'Planner', agentIcon: '🧠', isPrimary: true, sortOrder: 0 },
        ],
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ProjectSettingsPanel projectId="proj-1" initialTab="workflow" onClose={vi.fn()} />)

    // The generator's spec-ready listener only exists while its modal is open.
    await user.click(screen.getByRole('button', { name: /start a new workflow/i }))

    onSpecReady({
      title: 'Release workflow',
      goalSummary: 'Ship safely',
      assumptions: [],
      steps: [
        {
          id: 'step-1',
          title: 'Investigate',
          summary: 'Map risks',
          agentId: 'agent-1',
          agentName: 'Planner',
          prompt: 'Review the code and list risks.',
          expectedOutput: 'Risk list',
        },
      ],
    })

    // "Use this plan" commits the generated (already-saved) run and closes the modal.
    await user.click(await screen.findByRole('button', { name: /use this plan/i }))

    expect(await screen.findByText(/release workflow/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /start workflow/i }))

    expect(api.startAutomatedWorkflowRun).toHaveBeenCalledWith('run-1')
  })

  it('shows backend availability warning when automated mode has no configured backend', async () => {
    mockStore = createMockAppStore({
      authState: { authenticated: false, mode: 'none', user: null, cliInstalled: false, clis: { claude: false, codex: false } },
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          workflowMode: 'automated-delegation',
        },
      },
      projectAgents: {
        'proj-1': [
          { agentId: 'agent-1', agentName: 'Planner', agentIcon: '🧠', isPrimary: true, sortOrder: 0 },
        ],
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ProjectSettingsPanel projectId="proj-1" initialTab="workflow" onClose={vi.fn()} />)

    expect(screen.getByText(/no provider or supported cli backend is configured/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /start a new workflow/i }))

    expect(screen.getByRole('button', { name: /generate workflow/i })).toBeDisabled()
  })
})

// ── Scope tab ──────────────────────────────────────────────────────────────────

describe('ProjectSettingsPanel — scope rules (K.4)', () => {
  it('k-6: Scope tab shows empty-state message when no in-scope rules exist', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    expect(screen.getByText(/no in-scope rules/i)).toBeInTheDocument()
    expect(screen.getByText(/no out-of-scope rules/i)).toBeInTheDocument()
  })

  it('k-7: clicking Add in Scope adds a new rule input', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    const addBtn = screen.getByRole('button', { name: /add in-scope rule/i })
    await user.click(addBtn)
    expect(screen.getByLabelText(/scope rule description/i)).toBeInTheDocument()
  })

  it('k-8: clicking Add out-of-scope adds a new rule input', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    const addBtn = screen.getByRole('button', { name: /add out-of-scope rule/i })
    await user.click(addBtn)
    expect(screen.getByLabelText(/out-of-scope rule description/i)).toBeInTheDocument()
  })

  it('k-9: in-scope rule can be removed', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    await user.click(screen.getByRole('button', { name: /add in-scope rule/i }))
    const removeBtn = screen.getByRole('button', { name: /remove in-scope rule/i })
    await user.click(removeBtn)
    expect(screen.queryByLabelText(/scope rule description/i)).not.toBeInTheDocument()
  })

  it('k-10: existing in-scope rules from config are rendered', () => {
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          inScope: [{ id: 'r1', description: 'Only src/', pathGlob: 'src/**' }],
        }
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ProjectSettingsPanel projectId="proj-1" initialTab="scope" onClose={vi.fn()} />)
    const input = screen.getByDisplayValue('Only src/')
    expect(input).toBeInTheDocument()
    const globInput = screen.getByDisplayValue('src/**')
    expect(globInput).toBeInTheDocument()
  })
})

// ── Milestones tab ─────────────────────────────────────────────────────────────

describe('ProjectSettingsPanel — milestones (K.4)', () => {
  it('k-11: shows empty state when no milestones', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    expect(screen.getByText(/no milestones yet/i)).toBeInTheDocument()
  })

  it('k-12: Add milestone button adds a new milestone card', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    expect(screen.getByLabelText(/milestone title/i)).toBeInTheDocument()
  })

  it('k-13: new milestone has Set active button', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    expect(screen.getByRole('button', { name: /set.*as active/i })).toBeInTheDocument()
  })

  it('k-14: setting a milestone active shows Mark complete button', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    const setActiveBtn = screen.getByRole('button', { name: /set.*as active/i })
    await user.click(setActiveBtn)
    expect(screen.getByRole('button', { name: /mark.*as complete/i })).toBeInTheDocument()
  })

  it('k-15: active milestone shows 🎯 indicator in Milestones tab label', async () => {
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          milestones: [{ id: 'm1', title: 'Ship v1', status: 'active' }],
        }
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    expect(screen.getByText(/milestones 🎯/i)).toBeInTheDocument()
  })

  it('k-16: marking active milestone complete shows Reopen button', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    await user.click(screen.getByRole('button', { name: /set.*as active/i }))
    await user.click(screen.getByRole('button', { name: /mark.*as complete/i }))
    expect(screen.getByRole('button', { name: /reopen/i })).toBeInTheDocument()
  })

  it('k-17: removing a milestone removes it from the list', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    expect(screen.getByLabelText(/milestone title/i)).toBeInTheDocument()
    const removeBtn = screen.getByRole('button', { name: /remove milestone/i })
    await user.click(removeBtn)
    expect(screen.queryByLabelText(/milestone title/i)).not.toBeInTheDocument()
  })

  it('k-18: existing milestone from config is rendered on Milestones tab', () => {
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          milestones: [
            { id: 'm1', title: 'Launch MVP', description: 'First public release', status: 'upcoming' },
          ],
        }
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ProjectSettingsPanel projectId="proj-1" initialTab="milestones" onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Launch MVP')).toBeInTheDocument()
    expect(screen.getByDisplayValue('First public release')).toBeInTheDocument()
  })
})

// ── Draft mode ────────────────────────────────────────────────────────────────

describe('ProjectSettingsPanel — draft mode with new fields', () => {
  it('k-19: draft mode renders Create project and Cancel buttons regardless of active tab', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <ProjectSettingsPanel
        draft
        onClose={onClose}
        onConfirm={onConfirm}
        initialTab="milestones"
      />
    )
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('k-19b: draft mode hides the capabilities tab, which has no project id to write to', () => {
    render(<ProjectSettingsPanel draft onClose={vi.fn()} onConfirm={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.queryByRole('tab', { name: /capabilities/i })).not.toBeInTheDocument()
  })

  it('k-20: onConfirm in draft mode includes inScope/outOfScope/milestones', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <ProjectSettingsPanel
        draft
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    )
    const nameInput = screen.getByLabelText(/project name/i)
    await user.type(nameInput, 'My New Project')

    // Switch to Scope tab and add an in-scope rule
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    await user.click(screen.getByRole('button', { name: /add in-scope rule/i }))
    const ruleInput = screen.getByLabelText(/scope rule description/i)
    await user.type(ruleInput, 'TypeScript only')

    // Switch back and create
    await user.click(screen.getByRole('tab', { name: /general/i }))
    fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    expect(onConfirm).toHaveBeenCalledWith(
      'My New Project',
      expect.any(String),
      expect.objectContaining({
        inScope: expect.arrayContaining([expect.objectContaining({ description: 'TypeScript only' })]),
        outOfScope: [],
        milestones: [],
      }),
      expect.objectContaining({ agentIds: [], primaryAgentId: null })
    )
  })
})


