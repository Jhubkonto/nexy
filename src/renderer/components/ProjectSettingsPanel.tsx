import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../store/app-store'
import type { Milestone, ProjectConfig, ScopeRule } from '../store/types'
import type { HermesProfileInfo } from '../../shared/types'
import { DEFAULT_PROJECT_CONFIG } from '../store/types'
import { GeneralTab } from './project-settings/GeneralTab'
import { ScopeTab } from './project-settings/ScopeTab'
import { MilestonesTab } from './project-settings/MilestonesTab'
import { TeamTab } from './project-settings/TeamTab'
import { AutomatedWorkflowTab } from './project-settings/AutomatedWorkflowTab'
import { DraftTeamPicker } from './project-settings/DraftTeamPicker'
import { WikiTab } from './project-settings/WikiTab'
import { CapabilitiesTab } from './project-settings/CapabilitiesTab'
import { ProjectArtifactsTab } from './project-settings/ProjectArtifactsTab'
import { SaveStatus, type SaveState } from './ui/primitives'

type TabId = 'general' | 'scope' | 'milestones' | 'team' | 'workflow' | 'wiki' | 'artifacts' | 'capabilities'

interface EditProps {
  projectId: string
  draft?: false
  onClose: () => void
  onConfirm?: never
  initialTab?: TabId
  onMount?: () => void
  flashTeam?: boolean
}

export interface DraftTeamSelection {
  agentIds: string[]
  primaryAgentId: string | null
}

interface DraftProps {
  projectId?: null
  draft: true
  onClose: () => void
  onConfirm: (name: string, color: string, config: Partial<ProjectConfig>, team: DraftTeamSelection) => Promise<void>
  initialTab?: TabId
}

type Props = EditProps | DraftProps

const VAR_KEY_REGEX = /^[A-Z0-9_]+$/

export function ProjectSettingsPanel(props: Props) {
  const { onClose } = props
  const isDraft = props.draft === true

  const projects = useAppStore((s) => s.projects)
  const projectConfigs = useAppStore((s) => s.projectConfigs)
  const renameProject = useAppStore((s) => s.renameProject)
  const updateProjectColor = useAppStore((s) => s.updateProjectColor)
  const updateProjectConfig = useAppStore((s) => s.updateProjectConfig)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const loadProjectAgents = useAppStore((s) => s.loadProjectAgents)
  const agents = useAppStore((s) => s.agents)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const removeAgentFromProject = useAppStore((s) => s.removeAgentFromProject)
  const setProjectPrimaryAgent = useAppStore((s) => s.setProjectPrimaryAgent)
  const setProjectDefaultModel = useAppStore((s) => s.setProjectDefaultModel)
  const reorderProjectAgents = useAppStore((s) => s.reorderProjectAgents)
  const updateProjectOrchestration = useAppStore((s) => s.updateProjectOrchestration)
  const loadProjectConfig = useAppStore((s) => s.loadProjectConfig)
  const addToast = useAppStore((s) => s.addToast)
  const selectProject = useAppStore((s) => s.selectProject)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const availableModelGroups = useAppStore((s) => s.availableModelGroups)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const [hermesProfiles, setHermesProfiles] = useState<HermesProfileInfo[]>([])

  const projectId = isDraft ? null : (props as EditProps).projectId
  const project = projectId ? projects.find((p) => p.id === projectId) : null
  const cfg = projectId ? projectConfigs[projectId] : null

  const onMount = 'onMount' in props ? props.onMount : undefined
  const [activeTab, setActiveTab] = useState<TabId>(props.initialTab ?? 'general')
  const [name, setName] = useState(project?.name ?? '')
  const [color, setColor] = useState(project?.color ?? 'blue')
  const [instructions, setInstructions] = useState(cfg?.instructions ?? '')
  const [rootDirectory, setRootDirectory] = useState(cfg?.rootDirectory ?? '')
  const [codingWorkspace, setCodingWorkspace] = useState(cfg?.codingWorkspace ?? false)
  const [strategyRetrievalEnabled, setStrategyRetrievalEnabled] = useState(cfg?.strategyRetrievalEnabled ?? false)
  const [terminalSandboxBypass, setTerminalSandboxBypass] = useState(cfg?.terminalSandboxBypass ?? false)
  const [inspectedWorkspaceInfo, setInspectedWorkspaceInfo] = useState<ProjectConfig['workspaceInfo']>(cfg?.workspaceInfo ?? null)
  const [instructionMode, setInstructionMode] = useState<ProjectConfig['instructionMode']>(cfg?.instructionMode ?? 'prepend')
  const [instructionsEnabled, setInstructionsEnabled] = useState(cfg?.instructionsEnabled ?? true)
  const [variables, setVariables] = useState<Array<{ key: string; value: string }>>(cfg?.variables ?? [])
  const [varErrors, setVarErrors] = useState<Record<number, string>>({})
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inScope, setInScope] = useState<ScopeRule[]>(cfg?.inScope ?? [])
  const [outOfScope, setOutOfScope] = useState<ScopeRule[]>(cfg?.outOfScope ?? [])
  const [milestones, setMilestones] = useState<Milestone[]>(cfg?.milestones ?? [])
  const [draftAgentIds, setDraftAgentIds] = useState<string[]>([])
  const [draftPrimaryAgentId, setDraftPrimaryAgentId] = useState<string | null>(null)
  const projectHermesProfile = project?.project_hermes_profile ?? ''

  useEffect(() => {
    if (isDraft) return
    void window.api.getHermesProfileDiscovery()
      .then((result) => setHermesProfiles(result.profiles ?? []))
      .catch(() => setHermesProfiles([]))
  }, [isDraft, projectId])
  const [agentPickerQuery, setAgentPickerQuery] = useState('')
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [teamDraggingId, setTeamDraggingId] = useState<string | null>(null)

  const flashTeam = !isDraft && 'flashTeam' in props ? props.flashTeam : false
  const [teamFlashOn, setTeamFlashOn] = useState(false)

  useEffect(() => {
    if (!flashTeam) return
    setTeamFlashOn(true)
    let on = true
    const interval = setInterval(() => {
      on = !on
      setTeamFlashOn(on)
    }, 350)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      setTeamFlashOn(false)
    }, 2800)
    return () => { clearInterval(interval); clearTimeout(timeout) }
  }, [flashTeam])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const saveStateResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    onMount?.()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isDraft || !cfg) return
    setName(project?.name ?? '')
    setColor(project?.color ?? 'blue')
    setInstructions(cfg.instructions)
    setRootDirectory(cfg.rootDirectory)
    setCodingWorkspace(cfg.codingWorkspace)
    setInspectedWorkspaceInfo(cfg.workspaceInfo)
    setInstructionMode(cfg.instructionMode)
    setInstructionsEnabled(cfg.instructionsEnabled)
    setVariables(cfg.variables)
    setInScope(cfg.inScope ?? [])
    setOutOfScope(cfg.outOfScope ?? [])
    setMilestones(cfg.milestones ?? [])
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isDraft && projectId) loadProjectAgents(projectId)
  }, [projectId, isDraft, loadProjectAgents])

  useEffect(() => {
    if (!isDraft && projectId) void loadProjectConfig(projectId)
  }, [projectId, isDraft, loadProjectConfig])

  useEffect(() => {
    if (!rootDirectory.trim()) {
      setInspectedWorkspaceInfo(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.inspectProjectWorkspace(rootDirectory.trim()).then((result) => {
        if (!cancelled) {
          setInspectedWorkspaceInfo(result)
        }
      }).catch(() => {
        if (!cancelled) setInspectedWorkspaceInfo(null)
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [rootDirectory])

  const debounceSave = useCallback((partial: Partial<ProjectConfig>) => {
    if (isDraft || !projectId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (saveStateResetTimer.current) clearTimeout(saveStateResetTimer.current)
    setSaveState('saving')
    saveTimer.current = setTimeout(() => {
      void updateProjectConfig(projectId, partial).finally(() => {
        setSaveState('saved')
        saveStateResetTimer.current = setTimeout(() => setSaveState('idle'), 2000)
      })
    }, 500)
  }, [isDraft, projectId, updateProjectConfig])

  const immediateSave = useCallback((partial: Partial<ProjectConfig>) => {
    if (isDraft || !projectId) return
    if (saveStateResetTimer.current) clearTimeout(saveStateResetTimer.current)
    setSaveState('saving')
    void updateProjectConfig(projectId, partial).finally(() => {
      setSaveState('saved')
      saveStateResetTimer.current = setTimeout(() => setSaveState('idle'), 2000)
    })
  }, [isDraft, projectId, updateProjectConfig])

  // ── General tab handlers ──────────────────────────────────────────────────

  const handleNameBlur = async () => {
    if (isDraft || !projectId) return
    const trimmed = name.trim()
    if (trimmed && trimmed !== project?.name) {
      await renameProject(projectId, trimmed)
    }
  }

  const handleColorChange = (nextColor: string) => {
    setColor(nextColor)
    if (!isDraft && projectId && project) {
      if (saveStateResetTimer.current) clearTimeout(saveStateResetTimer.current)
      setSaveState('saving')
      void updateProjectColor(projectId, project.name, nextColor).finally(() => {
        setSaveState('saved')
        saveStateResetTimer.current = setTimeout(() => setSaveState('idle'), 2000)
      })
    }
  }

  const handleInstructionsChange = (val: string) => {
    setInstructions(val)
    debounceSave({ instructions: val })
  }

  const handleRootDirChange = (val: string) => {
    setRootDirectory(val)
    debounceSave({ rootDirectory: val })
  }

  const handleModeChange = (mode: ProjectConfig['instructionMode']) => {
    setInstructionMode(mode)
    setShowModeDropdown(false)
    immediateSave({ instructionMode: mode })
  }

  const handleEnabledToggle = () => {
    const next = !instructionsEnabled
    setInstructionsEnabled(next)
    immediateSave({ instructionsEnabled: next })
  }

  const handleBrowseDir = async () => {
    const result = await window.api.openDirectoryDialog()
    if (result && result.length > 0) {
      setRootDirectory(result[0])
      immediateSave({ rootDirectory: result[0] })
    }
  }

  const handleAddSource = async () => {
    if (!projectId) return
    const result = await window.api.openDirectoryDialog()
    if (!result?.[0]) return
    setSaveState('saving')
    try {
      await window.api.addProjectSource(projectId, { localPath: result[0] })
      await loadProjectConfig(projectId)
      setSaveState('saved')
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not add source', 'error')
      setSaveState('idle')
    }
  }

  const handleRemoveSource = async (sourceId: string) => {
    if (!projectId) return
    await window.api.removeProjectSource(projectId, sourceId)
    await loadProjectConfig(projectId)
  }

  const handleRemoveRepository = async (repositoryId: string) => {
    if (!projectId) return
    setSaveState('saving')
    try {
      await window.api.removeProjectRepository(projectId, repositoryId)
      await loadProjectConfig(projectId)
      setSaveState('saved')
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not remove repository', 'error')
      setSaveState('idle')
    }
  }

  const handleRescanSources = async () => {
    if (!projectId) return
    setSaveState('saving')
    try {
      await window.api.rescanProjectSources(projectId)
      await loadProjectConfig(projectId)
      setSaveState('saved')
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not scan repositories', 'error')
      setSaveState('idle')
    }
  }

  const handleCodingWorkspaceToggle = () => {
    const next = !codingWorkspace
    setCodingWorkspace(next)
    immediateSave({ codingWorkspace: next })
  }

  const handleStrategyRetrievalToggle = () => {
    const next = !strategyRetrievalEnabled
    setStrategyRetrievalEnabled(next)
    immediateSave({ strategyRetrievalEnabled: next })
  }

  const handleTerminalSandboxBypassToggle = () => {
    const next = !terminalSandboxBypass
    setTerminalSandboxBypass(next)
    immediateSave({ terminalSandboxBypass: next })
  }

  const handleAddVariable = () => {
    const next = [...variables, { key: '', value: '' }]
    setVariables(next)
    immediateSave({ variables: next })
  }

  const handleRemoveVariable = (idx: number) => {
    const next = variables.filter((_, i) => i !== idx)
    setVariables(next)
    setVarErrors((prev) => { const e = { ...prev }; delete e[idx]; return e })
    immediateSave({ variables: next })
  }

  const handleVarChange = (idx: number, field: 'key' | 'value', val: string) => {
    const next = variables.map((v, i) => i === idx ? { ...v, [field]: val } : v)
    setVariables(next)
    if (field === 'key') {
      const trimmed = val.trim()
      if (trimmed && !VAR_KEY_REGEX.test(trimmed)) {
        setVarErrors((prev) => ({ ...prev, [idx]: 'Key must be uppercase letters, digits, and underscores only' }))
      } else {
        setVarErrors((prev) => { const e = { ...prev }; delete e[idx]; return e })
        debounceSave({ variables: next })
      }
    } else {
      debounceSave({ variables: next })
    }
  }

  // ── Scope handlers ────────────────────────────────────────────────────────

  const mkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

  const handleAddScopeRule = (type: 'inScope' | 'outOfScope') => {
    const newRule: ScopeRule = { id: mkId(), description: '' }
    if (type === 'inScope') {
      const next = [...inScope, newRule]
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = [...outOfScope, newRule]
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  const handleRemoveScopeRule = (type: 'inScope' | 'outOfScope', id: string) => {
    if (type === 'inScope') {
      const next = inScope.filter((r) => r.id !== id)
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = outOfScope.filter((r) => r.id !== id)
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  const handleScopeRuleChange = (type: 'inScope' | 'outOfScope', id: string, field: 'description' | 'pathGlob', val: string) => {
    const update = (rules: ScopeRule[]) => rules.map((r) => r.id === id ? { ...r, [field]: val || undefined } : r)
    if (type === 'inScope') {
      const next = update(inScope)
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = update(outOfScope)
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  // ── Milestone handlers ────────────────────────────────────────────────────

  const handleAddMilestone = () => {
    const newMilestone: Milestone = { id: mkId(), title: '', status: 'upcoming' }
    const next = [...milestones, newMilestone]
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleRemoveMilestone = (id: string) => {
    const next = milestones.filter((m) => m.id !== id)
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleMilestoneChange = (id: string, field: 'title' | 'description', val: string) => {
    const next = milestones.map((m) => m.id === id ? { ...m, [field]: val } : m)
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleMilestoneStatus = (id: string, status: Milestone['status']) => {
    let next = milestones.map((m) => {
      if (m.id !== id) return m
      return { ...m, status, completedAt: status === 'completed' ? Date.now() : undefined }
    })
    if (status === 'active') {
      next = next.map((m) => m.id === id ? m : m.status === 'active' ? { ...m, status: 'upcoming' as const } : m)
    }
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  // ── Team handlers ─────────────────────────────────────────────────────────

  const handleAddAgent = async (agentId: string) => {
    if (!projectId) return
    const currentMembers = projectAgents[projectId] ?? []
    const agent = agents.find((a) => a.id === agentId)
    await addAgentToProject(projectId, agentId)
    if (currentMembers.length === 0) await setProjectPrimaryAgent(projectId, agentId)
    if (agent) addToast(`🤖 ${agent.name} added to project`, 'success')
  }

  const handleOpenWorkflowConversation = (conversationId: string) => {
    if (!projectId) return
    selectProject(projectId)
    selectConversation(conversationId)
    onClose()
  }

  // ── Draft team handlers ───────────────────────────────────────────────────

  const handleToggleDraftAgent = (agentId: string) => {
    setDraftAgentIds((prev) => {
      if (prev.includes(agentId)) {
        const next = prev.filter((id) => id !== agentId)
        if (draftPrimaryAgentId === agentId) setDraftPrimaryAgentId(next[0] ?? null)
        return next
      }
      const next = [...prev, agentId]
      if (draftPrimaryAgentId === null) setDraftPrimaryAgentId(agentId)
      return next
    })
  }

  // ── Draft confirm ─────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!isDraft) return
    const trimmedName = name.trim()
    if (!trimmedName) return
    setIsSubmitting(true)
    try {
      await (props as DraftProps).onConfirm(trimmedName, color, {
        instructions,
        rootDirectory,
        codingWorkspace,
        instructionMode,
        instructionsEnabled,
        variables,
        inScope,
        outOfScope,
        milestones,
      }, { agentIds: draftAgentIds, primaryAgentId: draftPrimaryAgentId })
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasVarErrors = Object.keys(varErrors).length > 0
  const activeMilestone = milestones.find((m) => m.status === 'active')
  const upcomingMilestones = milestones.filter((m) => m.status === 'upcoming')
  const completedMilestones = milestones.filter((m) => m.status === 'completed')
  const members = projectId ? (projectAgents[projectId] ?? []) : []
  const projectConfig = (projectId ? projectConfigs[projectId] : null) ?? DEFAULT_PROJECT_CONFIG

  return (
    <div className="h-full flex flex-col bg-nexy-surface rounded-none border-t-2 border-nexy-border">

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-0 flex-wrap border-b-2 border-nexy-border bg-nexy-raised" role="tablist">
        {(['general', 'scope', 'milestones', 'team', ...(!isDraft ? ['workflow', 'capabilities', 'wiki', 'artifacts'] : [])] as TabId[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`nexy-status-label text-[10px] px-2 pb-2 border-b-4 font-medium transition-colors ${
              activeTab === tab
                ? 'border-nexy-accent text-nexy-text bg-nexy-recessed'
                : tab === 'team' && teamFlashOn
                  ? 'border-nexy-accent text-nexy-accent'
                  : 'border-transparent text-nexy-muted hover:text-nexy-text hover:border-nexy-border'
            }`}
          >
            {tab === 'general'
              ? 'General'
              : tab === 'scope'
                ? 'Scope'
                : tab === 'team'
                  ? 'Team'
                  : tab === 'workflow'
                    ? 'Workflow'
                    : tab === 'capabilities'
                      ? 'Capabilities'
                  : tab === 'wiki'
                    ? 'Wiki'
                    : tab === 'artifacts'
                      ? 'Artifacts'
                      : `Milestones${activeMilestone ? ' 🎯' : ''}`}
          </button>
        ))}
        {!isDraft && ['general', 'scope', 'milestones'].includes(activeTab) && (
          <span className="ml-auto pb-2"><SaveStatus state={saveState} /></span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2 space-y-4 [scrollbar-gutter:stable]">

        {activeTab === 'general' && (
          <GeneralTab
            isDraft={isDraft}
            name={name}
            color={color}
            rootDirectory={rootDirectory}
            sources={projectConfig.sources}
            repositories={projectConfig.repositories}
            codingWorkspace={codingWorkspace}
            strategyRetrievalEnabled={strategyRetrievalEnabled}
            terminalSandboxBypass={terminalSandboxBypass}
            workspaceInfo={inspectedWorkspaceInfo ?? projectConfig.workspaceInfo}
            instructions={instructions}
            instructionMode={instructionMode}
            instructionsEnabled={instructionsEnabled}
            variables={variables}
            varErrors={varErrors}
            showModeDropdown={showModeDropdown}
            hasVarErrors={hasVarErrors}
            defaultModel={project?.default_model ?? null}
            projectHermesProfile={projectHermesProfile}
            hermesProfiles={hermesProfiles}
            defaultThinkingEffort={projectConfig.defaultThinkingEffort ?? null}
            availableModelGroups={availableModelGroups}
            catalogModels={catalogModels}
            globalDefaultModel={globalDefaultModel ?? null}
            onSetName={setName}
            onSetColor={handleColorChange}
            onNameBlur={handleNameBlur}
            onConfirm={isDraft ? handleConfirm : undefined}
            onInstructionsChange={handleInstructionsChange}
            onRootDirChange={handleRootDirChange}
            onModeChange={handleModeChange}
            onEnabledToggle={handleEnabledToggle}
            onBrowseDir={handleBrowseDir}
            onAddSource={handleAddSource}
            onRemoveSource={handleRemoveSource}
            onRemoveRepository={handleRemoveRepository}
            onRescanSources={handleRescanSources}
            onCodingWorkspaceToggle={handleCodingWorkspaceToggle}
            onStrategyRetrievalToggle={handleStrategyRetrievalToggle}
            onTerminalSandboxBypassToggle={handleTerminalSandboxBypassToggle}
            onSetShowModeDropdown={setShowModeDropdown}
            onAddVariable={handleAddVariable}
            onRemoveVariable={handleRemoveVariable}
            onVarChange={handleVarChange}
            onDefaultModelChange={(model) => {
              if (projectId) {
                const isHermesModel = availableModelGroups.some((group) => group.sourceKey === 'hermes-cli' && group.models.some((entry) => entry.id === model))
                void setProjectDefaultModel(projectId, model, isHermesModel ? projectHermesProfile : undefined)
              }
            }}
            onProjectHermesProfileChange={(profile) => {
              if (projectId) void setProjectDefaultModel(projectId, project?.default_model ?? null, profile)
            }}
            onDefaultThinkingEffortChange={(value) => debounceSave({ defaultThinkingEffort: value })}
          />
        )}

        {activeTab === 'scope' && (
          <ScopeTab
            inScope={inScope}
            outOfScope={outOfScope}
            onAddScopeRule={handleAddScopeRule}
            onRemoveScopeRule={handleRemoveScopeRule}
            onScopeRuleChange={handleScopeRuleChange}
          />
        )}

        {activeTab === 'milestones' && (
          <MilestonesTab
            milestones={milestones}
            activeMilestone={activeMilestone}
            upcomingMilestones={upcomingMilestones}
            completedMilestones={completedMilestones}
            onAddMilestone={handleAddMilestone}
            onRemoveMilestone={handleRemoveMilestone}
            onMilestoneChange={handleMilestoneChange}
            onMilestoneStatus={handleMilestoneStatus}
          />
        )}

        {activeTab === 'wiki' && !isDraft && projectId && (
          <WikiTab projectId={projectId} />
        )}

        {activeTab === 'artifacts' && !isDraft && projectId && (
          <ProjectArtifactsTab projectId={projectId} />
        )}

        {activeTab === 'team' && isDraft && (
          <DraftTeamPicker
            agents={agents}
            selectedAgentIds={draftAgentIds}
            primaryAgentId={draftPrimaryAgentId}
            onToggleAgent={handleToggleDraftAgent}
            onSetPrimaryAgent={setDraftPrimaryAgentId}
          />
        )}

        {activeTab === 'team' && !isDraft && projectId && (
          <TeamTab
            agents={agents}
            members={members}
            projectConfig={projectConfig}
            agentPickerQuery={agentPickerQuery}
            showAgentPicker={showAgentPicker}
            teamDraggingId={teamDraggingId}
            onSetAgentPickerQuery={setAgentPickerQuery}
            onSetShowAgentPicker={setShowAgentPicker}
            onSetTeamDraggingId={setTeamDraggingId}
            onAddAgent={handleAddAgent}
            onRemoveAgent={(agentId) => removeAgentFromProject(projectId, agentId)}
            onSetPrimaryAgent={(agentId) => setProjectPrimaryAgent(projectId, agentId)}
            onReorderAgents={(orderedIds) => reorderProjectAgents(projectId, orderedIds)}
            onUpdateOrchestration={(partial) => updateProjectOrchestration(projectId, partial)}
            onGoToWorkflowTab={() => setActiveTab('workflow')}
          />
        )}

        {activeTab === 'capabilities' && !isDraft && projectId && (
          <CapabilitiesTab projectId={projectId} />
        )}

        {activeTab === 'workflow' && !isDraft && projectId && (
          <AutomatedWorkflowTab
            projectId={projectId}
            members={members}
            projectConfig={projectConfig}
            onOpenConversation={handleOpenWorkflowConversation}
            onToast={addToast}
          />
        )}

      </div>

      {/* Draft mode: Create / Cancel buttons */}
      {isDraft && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t-2 border-nexy-border bg-nexy-raised">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-nexy-sm border-2 border-nexy-border text-nexy-text hover:bg-nexy-recessed transition-colors shadow-nexy"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!name.trim() || hasVarErrors || isSubmitting}
            className="text-xs px-4 py-1.5 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent text-nexy-on-accent hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-nexy"
            aria-label="Create project"
          >
            {isSubmitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      )}
    </div>
  )
}
