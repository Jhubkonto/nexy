/* eslint-disable react-hooks/exhaustive-deps -- chat/actions are aggregate hook objects; individual members are stable. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, ChevronDown, ChevronRight, Download, ListChecks, Loader2, Lock, MoreHorizontal, Pin, PinOff, Sparkles, Star, Upload, Users, X, Zap } from 'lucide-react'
import { getModelLabel, modelIdSupportsTools } from '../../shared/models'
import { isApiError, type AgentConfig, type ArtifactPromotionRequest, type AvailableModelEntry, type AvailableModelGroup, type CliBackend, type CliModeOverride, type CodexExecutionModeOverride, type ConversationExportPackFormat, type AutomatedWorkflowRunDetail, type AutomatedWorkflowRunStep, type HermesProfileInfo, type WikiCandidate } from '../../shared/types'
import type { ComposerKeyEvent, ContextRef, ToastType } from '../hooks/chat-types'
import { useAtMenu } from '../hooks/useAtMenu'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { useChat } from '../hooks/useChat'
import { useChatWindowActions } from '../hooks/useChatWindowActions'
import { useFileInput } from '../hooks/useFileInput'
import { useSlashMenu } from '../hooks/useSlashMenu'
import { useRateLimitTimer } from '../hooks/useRateLimitTimer'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { usePushToTalkShortcut } from '../hooks/usePushToTalkShortcut'
import { appendTranscriptToDraft } from '../lib/composer-draft'
import { useAppStore } from '../store/app-store'
import { CONTEXT_INSPECTOR_MAX_TOKENS, estimateRefTokens, estimateTokens } from '../lib/context-token-estimate'
import type { ContextInspectorSnapshot, ProjectConfig } from '../../shared/types'
import type { MarkdownViewMode } from '../store/types'
import { ChatComposer } from './chat/ChatComposer'
import { ChatMessages } from './chat/ChatMessages'
import { ModelPicker } from './chat/ModelPicker'
import { VoiceDock } from './chat/VoiceDock'
import { DropdownPanel } from './DropdownPanel'
import { NexyIcon } from './ui/icons'
import { PromptLibraryModal } from './PromptLibraryModal'
import { SaveToWikiModal } from './SaveToWikiModal'
import { WikiExtractionModal } from './WikiExtractionModal'
import { ConfirmDialog } from './ui/ConfirmDialog'
import type { ChatMessage } from '../hooks/chat-types'

const FALLBACK_CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

const FALLBACK_CODEX_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
]

const FALLBACK_HERMES_MODELS = [
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Anthropic)' },
  { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8 (Anthropic)' },
  { id: 'openrouter/auto', label: 'Auto (OpenRouter)' },
]

const PROMOTABLE_ARTIFACT_KINDS: ArtifactPromotionRequest['kind'][] = ['document', 'prompt', 'plan', 'code', 'other']
const conversationDraftCache = new Map<string, string>()

function deriveArtifactPromotionTitle(messageContent: string, conversationTitle?: string | null): string {
  const heading = messageContent.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m)?.[1]?.trim()
  return heading || conversationTitle?.trim() || 'New Artifact'
}

function defaultArtifactFilePath(kind: ArtifactPromotionRequest['kind']): string {
  switch (kind) {
    case 'prompt':
      return 'prompt.md'
    case 'plan':
      return 'output.md'
    case 'code':
      return 'output.ts'
    case 'other':
      return 'output.txt'
    case 'document':
    default:
      return 'output.md'
  }
}

export function ChatWindow() {
  const conversationId = useAppStore((state) => state.currentConversationId)
  const activeAgentId = useAppStore((state) => state.activeAgentId)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const projects = useAppStore((state) => state.projects)
  const agents = useAppStore((state) => state.agents)
  const conversations = useAppStore((state) => state.conversations)
  const authenticated = useAppStore((state) => state.authState.authenticated)
  const authMode = useAppStore((state) => state.authState.mode)
  const cliInstalled = useAppStore((state) => state.authState.cliInstalled)
  const installedClis = useAppStore((state) => state.authState.clis ?? { claude: state.authState.cliInstalled, codex: false })
  const isReady = authenticated || cliInstalled
  const theme = useAppStore((state) => state.theme)
  const markdownViewMode = useAppStore((state) => state.markdownViewMode)
  const setMarkdownViewMode = useAppStore((state) => state.setMarkdownViewMode)
  const composerMarkdownViewMode = useAppStore((state) => state.composerMarkdownViewMode)
  const setComposerMarkdownViewMode = useAppStore((state) => state.setComposerMarkdownViewMode)
  const skills = useAppStore((state) => state.skills)
  const conversationCreated = useAppStore((state) => state.conversationCreated)
  const loadConversations = useAppStore((state) => state.loadConversations)
  const loadAgents = useAppStore((state) => state.loadAgents)
  const newChat = useAppStore((state) => state.newChat)
  const openSectionPane = useAppStore((state) => state.openSectionPane)
  const setShowMcpPanel = useAppStore((state) => state.setShowMcpPanel)
  const openArtifactPanel = useAppStore((state) => state.openArtifactPanel)
  const openEditProject = useAppStore((state) => state.openEditProject)
  const selectConversation = useAppStore((state) => state.selectConversation)
  const setTheme = useAppStore((state) => state.setTheme)
  const logout = useAppStore((state) => state.logout)
  const addToast = useAppStore((state) => state.addToast) as (
    message: string,
    type?: ToastType,
    action?: { label: string; onClick: () => void }
  ) => void
  const markConversationUnread = useAppStore((state) => state.markConversationUnread)
  const catalogModels = useAppStore((state) => state.catalogModels)
  const markConversationRead = useAppStore((state) => state.markConversationRead)
  const generatingConversationIds = useAppStore((state) => state.generatingConversationIds)
  const generatingStartTimes = useAppStore((state) => state.generatingStartTimes)
  const markConversationGenerating = useAppStore((state) => state.markConversationGenerating)
  const markConversationDoneGenerating = useAppStore((state) => state.markConversationDoneGenerating)
  const markConversationPending = useAppStore((state) => state.markConversationPending)
  const clearConversationPending = useAppStore((state) => state.clearConversationPending)
  const defaultModelSetting = useAppStore((state) => state.globalDefaultModel)
  const saveAgent = useAppStore((state) => state.saveAgent)
  const [isPinning, setIsPinning] = useState(false)
  const [deleteAfterTarget, setDeleteAfterTarget] = useState<{
    conversationId: string
    message: ChatMessage
  } | null>(null)
  const [isDeletingAfter, setIsDeletingAfter] = useState(false)

  const availableGroups = useAppStore((state) => state.availableModelGroups)
  const availableModelsLoaded = useAppStore((state) => state.availableModelsLoaded)
  const [profileAvailableGroups, setProfileAvailableGroups] = useState<AvailableModelGroup[] | null>(null)
  const [hermesProfiles, setHermesProfiles] = useState<HermesProfileInfo[]>([])
  const [globalHermesProfile, setGlobalHermesProfile] = useState('')
  const pendingComposerPrefill = useAppStore((state) => state.pendingComposerPrefill)
  const setPendingComposerPrefill = useAppStore((state) => state.setPendingComposerPrefill)
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const [pendingThinkingEffortOverride, setPendingThinkingEffortOverride] = useState<
    'low' | 'medium' | 'high' | 'max' | 'disabled' | null
  >(null)
  const [pendingFullAutoApproveOverride, setPendingFullAutoApproveOverride] = useState<boolean | null>(null)
  const [pendingAgenticModeOverride, setPendingAgenticModeOverride] = useState<boolean | null>(null)
  const [pendingTerminalSandboxOverride, setPendingTerminalSandboxOverride] = useState<boolean | null>(null)
  const [pendingCliModeOverride, setPendingCliModeOverride] = useState<CliModeOverride | null>(null)
  const [pendingCodexExecutionModeOverride, setPendingCodexExecutionModeOverride] = useState<CodexExecutionModeOverride | null>(null)
  const [pendingModelDirty, setPendingModelDirty] = useState(false)
  const [pendingModeFields, setPendingModeFields] = useState<Set<string>>(() => new Set())
  const previousModeConversationIdRef = useRef<string | null>(conversationId)
  const [input, setInput] = useState('')
  const inputValueRef = useRef(input)
  inputValueRef.current = input
  const draftOwnerRef = useRef<string | null>(conversationId)

  useEffect(() => {
    const previousOwner = draftOwnerRef.current
    if (previousOwner && previousOwner !== conversationId) {
      conversationDraftCache.set(previousOwner, inputValueRef.current)
    }
    draftOwnerRef.current = conversationId
    setInput(conversationId ? conversationDraftCache.get(conversationId) ?? '' : '')
  }, [conversationId])

  useEffect(() => {
    if (!pendingComposerPrefill) return
    setInput(pendingComposerPrefill)
    setPendingComposerPrefill(null)
  }, [pendingComposerPrefill, setPendingComposerPrefill])
  const [showContextInspector, setShowContextInspector] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [projectRootDir, setProjectRootDir] = useState<string | null>(null)
  const [projectWorkflowMode, setProjectWorkflowMode] = useState<ProjectConfig['workflowMode'] | null>(null)
  const [projectDefaultThinkingEffort, setProjectDefaultThinkingEffort] = useState<ProjectConfig['defaultThinkingEffort']>(null)
  const [activeWorkflowRun, setActiveWorkflowRun] = useState<AutomatedWorkflowRunDetail | null>(null)
  const [dismissedWorkflowStepId, setDismissedWorkflowStepId] = useState<string | null>(null)
  const [clipboardRef, setClipboardRef] = useState<ContextRef | null>(null)
  const [promptInstructionRef, setPromptInstructionRef] = useState<ContextRef | null>(null)
  const [wikiMessageIds, setWikiMessageIds] = useState<Set<string>>(new Set())
  const [wikiModalMessage, setWikiModalMessage] = useState<{ id: string; content: string } | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [menuRatingOpen, setMenuRatingOpen] = useState(false)
  const [menuExportOpen, setMenuExportOpen] = useState(false)
  const [menuContinueOpen, setMenuContinueOpen] = useState(false)
  const [continueModel, setContinueModel] = useState<string>('default')
  const [continueAgentId, setContinueAgentId] = useState<string | null>(null)
  const [continueProjectId, setContinueProjectId] = useState<string | null>(null)
  const [continueCutoffTimestamp, setContinueCutoffTimestamp] = useState<number | null>(null)
  const [continueCliModels, setContinueCliModels] = useState<{ id: string; label: string }[]>([])
  const [isForking, setIsForking] = useState(false)
  const [extractionCandidates, setExtractionCandidates] = useState<WikiCandidate[] | null>(null)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [promptLibraryDraftOverride, setPromptLibraryDraftOverride] = useState<string | null>(null)
  const [artifactPromotion, setArtifactPromotion] = useState<{
    messageId: string
    content: string
    title: string
    kind: ArtifactPromotionRequest['kind']
    scopeType: 'global' | 'project'
    projectId: string
    filePath: string
    saving: boolean
  } | null>(null)
  const completedConversationIds = useAppStore((state) => state.completedConversationIds)
  const markConversationCompleteFn = useAppStore((state) => state.markConversationComplete)
  const markConversationIncompleteFn = useAppStore((state) => state.markConversationIncomplete)
  const conversationRatings = useAppStore((state) => state.conversationRatings)
  const submitConversationRatingFn = useAppStore((state) => state.submitConversationRating)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** Set by the composer to focus whichever surface (textarea or rich-text editor) is active. */
  const composerFocusRef = useRef<(() => void) | null>(null)
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      const focusActiveSurface = composerFocusRef.current
      if (focusActiveSurface) focusActiveSurface()
      else inputRef.current?.focus()
    })
  }, [])
  const handleVoiceText = useCallback((text: string) => {
    setInput((current) => appendTranscriptToDraft(current, text))
    focusComposer()
  }, [focusComposer])
  const handleVoiceError = useCallback((message: string) => addToast(message, 'error'), [addToast])
  const {
    voiceState,
    voiceDurationMs,
    voiceLevel,
    voiceError,
    startVoice,
    stopVoice,
    toggleVoice,
    cancelVoice,
  } = useVoiceInput(
    handleVoiceText,
    handleVoiceError,
    conversationId ?? `new:${activeProjectId ?? 'standalone'}`,
  )

  const [voiceDockEnabled, setVoiceDockEnabled] = useState(() => {
    // Force docked mode on every fresh app launch — floating position can land
    // off-screen after a restart. sessionStorage resets when the app quits but
    // survives reloads/tray hide, so this only fires once per launch.
    if (!sessionStorage.getItem('nexy.voiceDock.freshLaunchHandled')) {
      sessionStorage.setItem('nexy.voiceDock.freshLaunchHandled', 'true')
      return false
    }
    return localStorage.getItem('nexy.voiceDock.enabled') === 'true'
  })
  const setVoiceDock = useCallback((enabled: boolean) => {
    setVoiceDockEnabled(enabled)
    localStorage.setItem('nexy.voiceDock.enabled', String(enabled))
  }, [])

  useEffect(() => {
    const syncVoiceDockSetting = () => {
      setVoiceDockEnabled(localStorage.getItem('nexy.voiceDock.enabled') === 'true')
    }
    window.addEventListener('nexy.voiceDock.settingsChanged', syncVoiceDockSetting)
    return () => window.removeEventListener('nexy.voiceDock.settingsChanged', syncVoiceDockSetting)
  }, [])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pendingSourceMessageIdRef = useRef<string | null>(null)
  const prevGeneratingRef = useRef(false)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const ensureConversationForCapability = useCallback(async () => {
    const created = await window.api.createConversation(activeAgentId ?? undefined, activeProjectId ?? undefined)
    if (!('error' in created)) {
      // Materializing a new chat changes the draft owner from null to the new
      // conversation. Preserve the unsaved new-chat draft so the owner-change
      // effect restores it instead of loading an empty draft for that chat.
      conversationDraftCache.set(created.id, inputValueRef.current)
      await conversationCreated(created.id)
      return created.id
    }
    addToast(String(created.error), 'error')
    return null
  }, [activeAgentId, activeProjectId, conversationCreated, addToast])

  useEffect(() => {
    const handleFocusRequest = () => focusComposer()
    window.addEventListener('nexy:focus-chat-composer', handleFocusRequest)
    return () => window.removeEventListener('nexy:focus-chat-composer', handleFocusRequest)
  }, [focusComposer])

  useEffect(() => {
    const navigateToMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId: string; messageId?: string }>).detail
      if (!detail?.messageId) return
      pendingSourceMessageIdRef.current = detail.messageId
    }
    window.addEventListener('nexy:navigate-chat-message', navigateToMessage)
    return () => window.removeEventListener('nexy:navigate-chat-message', navigateToMessage)
  }, [])

  const inputHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const historyDraftRef = useRef('')
  const rateLimitSetterRef = useRef<(seconds: number) => void>(() => {})
  const lastClipboardSigRef = useRef('')

  const currentConversation = conversationId
    ? (conversations.find((conversation) => conversation.id === conversationId) ?? null)
    : null
  const isNewChat = !currentConversation
  const conversationModel = currentConversation?.model ?? null
  const chatProjectId = isNewChat ? activeProjectId : (currentConversation?.project_id ?? null)
  const chatProject = chatProjectId
    ? (projects.find((project) => project.id === chatProjectId) ?? null)
    : null
  const chatAgentId = isNewChat ? activeAgentId : (currentConversation?.agent_id ?? null)
  const chatAgent = chatAgentId ? (agents.find((agent) => agent.id === chatAgentId) ?? null) : null
  const projectDefaultModel = chatProject?.default_model ?? null
  const projectDefaultHermesProfile = chatProject?.project_hermes_profile ?? null
  const displayedThinkingEffort = pendingModeFields.has('thinkingEffortOverride')
    ? pendingThinkingEffortOverride
    : (currentConversation?.thinking_effort_override ?? projectDefaultThinkingEffort)

  // An agent requires tool-capable models when it has MCP servers assigned.
  const agentNeedsTools = !!(chatAgent && (chatAgent.mcpServers?.length ?? 0) > 0)

  const nonDefault = (v: string | null | undefined): string | null =>
    v && v !== 'default' ? v : null
  const chatAgentBackend = chatAgent?.backend
  const chatAgentCliModel = nonDefault(chatAgent?.cliModel ?? null)
  const targetHermesProfile = chatAgentBackend === 'hermes-cli' && typeof chatAgent?.hermesProfile === 'string'
    ? chatAgent.hermesProfile
    : currentConversation?.model
      ? currentConversation.conversation_hermes_profile ?? null
      : projectDefaultModel
        ? projectDefaultHermesProfile
        : globalHermesProfile || null
  const hermesProfile = targetHermesProfile || undefined
  useEffect(() => {
    void window.api.getSetting('global_default_hermes_profile').then((value) => setGlobalHermesProfile(value ?? '')).catch(() => {})
    void window.api.getHermesProfileDiscovery().then((result) => setHermesProfiles(result.profiles ?? [])).catch(() => setHermesProfiles([]))
  }, [])
  useEffect(() => {
    if (!hermesProfile) {
      setProfileAvailableGroups(null)
      return
    }
    let cancelled = false
    window.api.listAvailableModels(hermesProfile)
      .then((groups) => {
        if (!cancelled) setProfileAvailableGroups(groups)
      })
      .catch(() => {
        if (!cancelled) setProfileAvailableGroups(null)
      })
    return () => {
      cancelled = true
    }
  }, [hermesProfile])
  const chatAvailableGroups = profileAvailableGroups ?? availableGroups
  const isAvailableModel = (model: string | null | undefined): model is string =>
    !!nonDefault(model) && (
      !availableModelsLoaded ||
      chatAvailableGroups.some((group) => group.models.some((entry) => entry.id === model))
    )

  const lockModelToAgentBackend =
    chatAgentBackend === 'claude-cli' || chatAgentBackend === 'codex-cli' || chatAgentBackend === 'hermes-cli'
  const conversationCliModelForAgentBackend =
    lockModelToAgentBackend && !pendingModelDirty && nonDefault(conversationModel) && chatAvailableGroups.some((group) =>
      group.sourceKey === chatAgentBackend &&
      group.models.some((model) => model.id === nonDefault(conversationModel)),
    )
      ? nonDefault(conversationModel)
      : null
  const pendingCliModelForAgentBackend =
    lockModelToAgentBackend && pendingModelDirty && nonDefault(pendingModel) && chatAvailableGroups.some((group) =>
      group.sourceKey === chatAgentBackend && group.models.some((model) => model.id === pendingModel),
    )
      ? pendingModel
      : null

  let effectiveModel: string
  let modelSourceLabel: string | undefined
  if (chatAgentBackend === 'claude-cli' || chatAgentBackend === 'codex-cli' || chatAgentBackend === 'hermes-cli') {
    // Forced CLI agents only honor per-conversation model choices within that backend.
    effectiveModel = pendingCliModelForAgentBackend ?? conversationCliModelForAgentBackend ?? chatAgentCliModel ?? 'default'
  } else if (nonDefault(pendingModel)) {
    effectiveModel = pendingModel!
  } else if (!pendingModelDirty && isAvailableModel(conversationModel)) {
    effectiveModel = conversationModel!
    // Recover provenance: check which source originally provided this model
    if (isAvailableModel(projectDefaultModel) && projectDefaultModel === conversationModel) {
      modelSourceLabel = 'Project default'
    } else if (nonDefault(defaultModelSetting) && defaultModelSetting === conversationModel) {
      modelSourceLabel = 'global'
    }
  } else if (isAvailableModel(projectDefaultModel)) {
    effectiveModel = projectDefaultModel!
    modelSourceLabel = 'Project default'
  } else if (nonDefault(defaultModelSetting)) {
    effectiveModel = defaultModelSetting!
    modelSourceLabel = 'global'
  } else {
    effectiveModel = 'default'
  }
  const isHermesTarget = chatAgentBackend === 'hermes-cli' || chatAvailableGroups.some((group) => group.sourceKey === 'hermes-cli' && group.models.some((model) => model.id === effectiveModel))

  // If the agent requires tool calling, auto-fallback to 'default' (GPT-4o)
  // when the resolved model is not known to support tools. This prevents
  // silently sending a chat-only model into the MCP tool loop.
  if (agentNeedsTools && !modelIdSupportsTools(effectiveModel, catalogModels)) {
    effectiveModel = 'default'
    modelSourceLabel = undefined
  }

  const effectiveModelLabel = getModelLabel(effectiveModel, catalogModels)
  const continueAgent = continueAgentId ? (agents.find((agent) => agent.id === continueAgentId) ?? null) : null
  const continueBackend = continueAgent?.backend ?? null
  const continueAgentNeedsTools = !!(continueAgent && (continueAgent.mcpServers?.length ?? 0) > 0)
  const continueIsCli =
    continueBackend === 'claude-cli' || continueBackend === 'codex-cli' || continueBackend === 'hermes-cli'
  // Reuse the same grouped model source the composer's ModelPicker consumes so the fork
  // dialog lists models in the identical order (and same available set) as the in-chat
  // dropdown — instead of the flat, catalog-ordered list the native <select> used before.
  const continueGroups = useMemo<AvailableModelGroup[]>(() => {
    if (continueIsCli) {
      const sourceLabel =
        continueBackend === 'codex-cli' ? 'Codex CLI' : continueBackend === 'hermes-cli' ? 'Hermes Agent' : 'Claude CLI'
      if (continueCliModels.length === 0) return []
      return [{
        sourceKey: continueBackend!,
        sourceLabel,
        sourceType: 'cli',
        models: continueCliModels.map((model) => ({ id: model.id, label: model.label })),
      }]
    }
    // With no CLI-locked agent this is the composer's exact grouped source, including
    // provider and installed-CLI sections in the same order as the bottom model picker.
    if (!continueAgentNeedsTools) return availableGroups
    // A tool-using agent can't fork onto a chat-only model, so hide those (mirrors the
    // requiresTools filtering the flat list applied via getAvailableModelIds). CLI
    // groups remain available because their agent runtimes provide their own tools.
    return availableGroups
      .map((group) => ({
        ...group,
        models: group.sourceType === 'provider'
          ? group.models.filter((model) => modelIdSupportsTools(model.id, catalogModels))
          : group.models,
      }))
      .filter((group) => group.models.length > 0)
  }, [availableGroups, catalogModels, continueAgentNeedsTools, continueBackend, continueCliModels, continueIsCli])
  const continueModelOptions = useMemo(() => {
    const fromGroups = continueGroups.flatMap((group) => group.models.map((model) => ({ id: model.id, label: model.label })))
    return continueIsCli ? fromGroups : [{ id: 'default', label: 'Global default' }, ...fromGroups]
  }, [continueGroups, continueIsCli])

  const hasByok = availableGroups.some((g) => g.sourceType === 'provider')

  // Determines the chip shown in the context bar AND which CLI backend (if any) answers this
  // chat. `backend` is the machine-readable half — consumed by the provider slash-command list
  // and the ChatModePicker's mode section, so both follow the same precedence as the visual chip:
  // agent-forced backend → auth-mode-none CLI fallback → BYOK provider match → CLI model match.
  const backendChip = useMemo(() => {
    const byokGroup = availableGroups.find((g) => {
      if (g.sourceType !== 'provider') return false
      if (effectiveModel === 'default') return true
      return g.models.some((m) => m.id === effectiveModel)
    })
    const cliGroup = availableGroups.find(
      (g) => g.sourceType === 'cli' && g.models.some((m) => m.id === effectiveModel),
    )
    const providerColorMap: Record<string, string> = {
      openrouter: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300',
      anthropic: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700 text-orange-700 dark:text-orange-300',
      azure: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300',
    }

    const cliChip: Record<string, { label: string; cls: string; backend: CliBackend | null }> = {
      'codex-cli': { label: 'Codex CLI', cls: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300', backend: 'codex-cli' },
      'claude-cli': { label: 'Claude CLI', cls: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300', backend: 'claude-cli' },
      'hermes-cli': { label: 'Hermes Agent', cls: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300', backend: 'hermes-cli' },
    }

    const agentBackend = chatAgent?.backend
    if (agentBackend && cliChip[agentBackend] && cliInstalled) {
      return cliChip[agentBackend]
    }
    if (!agentBackend && authMode === 'none' && cliInstalled && !hasByok) {
      if (installedClis.claude) return cliChip['claude-cli']
      if (installedClis.codex) return cliChip['codex-cli']
      return cliChip['hermes-cli']
    }
    if (byokGroup) {
      const cls = providerColorMap[byokGroup.sourceKey] ?? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300'
      return { label: byokGroup.sourceLabel, cls, backend: null }
    }
    if (cliGroup && cliChip[cliGroup.sourceKey]) {
      return cliChip[cliGroup.sourceKey]
    }
    return { label: 'No provider', cls: 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400', backend: null }
  }, [chatAgent?.backend, authMode, cliInstalled, installedClis.claude, installedClis.codex, effectiveModel, availableGroups, hasByok])

  const activeCliBackend: CliBackend | null = backendChip.backend

  const chat = useChat({
    conversationId,
    activeAgentId: chatAgentId,
    activeProjectId: chatProjectId,
    effectiveModel,
    catalogModels,
    addToast,
    loadConversations,
    conversationCreated,
    rateLimitSetterRef,
    markConversationGenerating,
    markConversationDoneGenerating,
    isConversationGenerating: conversationId ? generatingConversationIds.includes(conversationId) : false,
    conversationGenerationStartedAt: conversationId ? (generatingStartTimes[conversationId] ?? null) : null,
  })
  usePushToTalkShortcut({
    enabled: !chat.isGenerating,
    state: voiceState,
    start: startVoice,
    stop: stopVoice,
    cancel: cancelVoice,
  })
  const fileInput = useFileInput(conversationId)
  const slashMenu = useSlashMenu()
  const atMenu = useAtMenu({ input, setInput, projectId: chatProjectId, projectRootDir })
  const mergedContextRefs = useMemo(() => {
    const refs = [...atMenu.contextRefs]
    if (clipboardRef) refs.push(clipboardRef)
    if (promptInstructionRef) refs.push(promptInstructionRef)
    return refs
  }, [atMenu.contextRefs, clipboardRef, promptInstructionRef])
  const { rateLimitRemainingSec, setRateLimitRemainingSec } = useRateLimitTimer()
  rateLimitSetterRef.current = setRateLimitRemainingSec

  const actions = useChatWindowActions({
    conversationId,
    chatAgentId,
    chatProjectId,
    activeAgent: chatAgent,
    activeCliBackend,
    effectiveModel,
    effectiveModelLabel,
    conversationModel,
    catalogModels,
    globalDefaultModel: defaultModelSetting ?? null,
    theme,
    input,
    setInput,
    messages: chat.messages,
    setMessages: chat.setMessages,
    isGenerating: chat.isGenerating,
    rateLimitRemainingSec: rateLimitRemainingSec,
    pendingAttachments: fileInput.pendingAttachments,
    pendingImages: fileInput.pendingImages,
    setPendingAttachments: fileInput.setPendingAttachments,
    setPendingImages: fileInput.setPendingImages,
    contextRefs: mergedContextRefs,
    resolveContextBlock: atMenu.resolveContextBlock,
    showSlashMenu: slashMenu.showSlashMenu,
    closeSlashMenu: slashMenu.closeSlashMenu,
    openSlashMenu: slashMenu.openSlashMenu,
    filteredSlashCommands: slashMenu.filteredSlashCommands,
    selectedSlashIndex: slashMenu.selectedSlashIndex,
    setSelectedSlashIndex: slashMenu.setSelectedSlashIndex,
    showAtMenu: atMenu.showAtMenu,
    closeAtMenu: atMenu.closeAtMenu,
    openAtMenu: atMenu.openAtMenu,
    filteredAtOptions: atMenu.filteredAtOptions,
    selectedAtIndex: atMenu.selectedAtIndex,
    setSelectedAtIndex: atMenu.setSelectedAtIndex,
    inputRef,
    inputHistoryRef,
    historyIndexRef,
    historyDraftRef,
    activeConversationRef: chat.activeConversationRef,
    streamingConversationRef: chat.streamingConversationRef,
    justCreatedConversationRef: chat.justCreatedConversationRef,
    pendingEditedResendRef: chat.pendingEditedResendRef,
    editCutoffTimestampRef: chat.editCutoffTimestampRef,
    lastUndoneUserMessageRef: chat.lastUndoneUserMessageRef,
    streamModelRef: chat.streamModelRef,
    streamingContentRef: chat.streamingContentRef,
    conversationCreated,
    markConversationGenerating,
    markConversationDoneGenerating,
    markConversationPending,
    clearConversationPending,
    setIsGenerating: chat.setIsGenerating,
    setGenerationStartedAt: chat.setGenerationStartedAt,
    setStreamingContent: chat.setStreamingContent,
    resetQueue: chat.resetQueue,
    clearStoppedGeneration: chat.clearStoppedGeneration,
    setLoadingFailed: chat.setLoadingFailed,
    setLiveTeamActivity: chat.setLiveTeamActivity,
    addToast,
    pushSystemMessage: chat.pushSystemMessage,
    buildConversationMarkdown: chat.buildConversationMarkdown,
    newChat,
    logout,
    setTheme,
    loadAgents,
    loadConversations,
    markConversationComplete: markConversationCompleteFn,
    markConversationIncomplete: markConversationIncompleteFn,
    onAfterSend: () => {
      setClipboardRef(null)
      setPromptInstructionRef(null)
    },
    onEditStateConsumed: chat.clearEditState,
  })

  const handleOpenArtifactPromotion = useCallback((messageId: string, content: string) => {
    setArtifactPromotion({
      messageId,
      content,
      title: deriveArtifactPromotionTitle(content, currentConversation?.title),
      kind: 'document',
      scopeType: chatProjectId && chatProjectId !== '__none__' ? 'project' : 'global',
      projectId: chatProjectId && chatProjectId !== '__none__' ? chatProjectId : '',
      filePath: defaultArtifactFilePath('document'),
      saving: false,
    })
  }, [chatProjectId, currentConversation?.title])

  const handleConfirmArtifactPromotion = useCallback(async () => {
    if (!conversationId || !artifactPromotion) return
    const scope = artifactPromotion.scopeType === 'project'
      ? { type: 'project' as const, projectId: artifactPromotion.projectId }
      : { type: 'global' as const }
    setArtifactPromotion((current) => current ? { ...current, saving: true } : current)
    try {
      const result = await window.api.artifactPromoteMessage({
        conversationId,
        messageId: artifactPromotion.messageId,
        title: artifactPromotion.title.trim(),
        kind: artifactPromotion.kind,
        scope,
        filePath: artifactPromotion.filePath.trim(),
      })
      setArtifactPromotion(null)
      addToast('Artifact saved', 'success', {
        label: 'View artifact',
        onClick: () => {
          openSectionPane('artifacts')
          openArtifactPanel(result.artifactId)
        },
      })
    } catch (error) {
      setArtifactPromotion((current) => current ? { ...current, saving: false } : current)
      addToast(error instanceof Error ? error.message : 'Failed to save artifact', 'error')
    }
  }, [addToast, artifactPromotion, conversationId, openArtifactPanel, openSectionPane])

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    if (!chatProjectId || chatProjectId === '__none__') {
      setProjectRootDir(null)
      setProjectWorkflowMode(null)
      setProjectDefaultThinkingEffort(null)
      return
    }

    let cancelled = false
    window.api
      .getProjectConfig(chatProjectId)
      .then((config: unknown) => {
        if (cancelled) return
        const rootDir =
          config && typeof config === 'object' && 'rootDirectory' in config && typeof (config as Record<string, unknown>).rootDirectory === 'string'
            ? ((config as Record<string, unknown>).rootDirectory as string)
            : null
        setProjectRootDir(rootDir || null)
        const workflowMode =
          config && typeof config === 'object' && 'workflowMode' in config
            ? ((config as Record<string, unknown>).workflowMode as ProjectConfig['workflowMode'])
            : null
        setProjectWorkflowMode(workflowMode ?? null)
        const thinkingEffort =
          config && typeof config === 'object' && 'defaultThinkingEffort' in config
            ? ((config as Record<string, unknown>).defaultThinkingEffort as ProjectConfig['defaultThinkingEffort'])
            : null
        setProjectDefaultThinkingEffort(thinkingEffort ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setProjectRootDir(null)
        setProjectWorkflowMode(null)
        setProjectDefaultThinkingEffort(null)
      })
    return () => { cancelled = true }
  }, [chatProjectId])

  const loadActiveWorkflowRun = useCallback((projectId: string) => {
    window.api.listAutomatedWorkflowRuns(projectId).then(async (list) => {
      if (isApiError(list)) { setActiveWorkflowRun(null); return }
      const active = list.find((run) => run.status !== 'done' && run.status !== 'cancelled')
      if (!active) { setActiveWorkflowRun(null); return }
      const detail = await window.api.getAutomatedWorkflowRun(active.id)
      setActiveWorkflowRun(detail && !isApiError(detail) ? detail : null)
    }).catch(() => setActiveWorkflowRun(null))
  }, [])

  // Automated Workflow is a fully independent, top-level feature (not gated on the project's
  // workflowMode setting) — a run started in any project mode must still surface here, otherwise
  // it executes with silent, invisible progress.
  useEffect(() => {
    setDismissedWorkflowStepId(null)
    if (!chatProjectId || chatProjectId === '__none__') {
      setActiveWorkflowRun(null)
      return
    }
    loadActiveWorkflowRun(chatProjectId)
  }, [chatProjectId, loadActiveWorkflowRun])

  useEffect(() => {
    const off = window.api.onAutomatedWorkflowRunsChanged(({ projectId: changedProjectId }) => {
      if (changedProjectId === chatProjectId) {
        loadActiveWorkflowRun(changedProjectId)
      }
    })
    return off
  }, [chatProjectId, loadActiveWorkflowRun])

  // Steps auto-advance now, so "current" means "needs a human's attention" — running (informational
  // only), awaiting_confirmation (needs approval), or failed (needs retry/skip) — rather than
  // "the next one a human would manually start".
  const currentWorkflowStep = useMemo<AutomatedWorkflowRunStep | null>(() => {
    if (!activeWorkflowRun) return null
    return activeWorkflowRun.steps.find((s) => s.status === 'running' || s.status === 'awaiting_confirmation' || s.status === 'failed') ?? null
  }, [activeWorkflowRun])

  const [bannerActionBusy, setBannerActionBusy] = useState(false)

  const handleApproveFromBanner = useCallback(async (step: AutomatedWorkflowRunStep) => {
    if (!activeWorkflowRun) return
    setBannerActionBusy(true)
    try {
      await window.api.confirmAutomatedWorkflowStep(activeWorkflowRun.id, step.dbId)
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to approve step', 'error')
    } finally {
      setBannerActionBusy(false)
    }
  }, [activeWorkflowRun, addToast])

  const handleRetryFromBanner = useCallback(async (step: AutomatedWorkflowRunStep) => {
    if (!activeWorkflowRun) return
    setBannerActionBusy(true)
    try {
      await window.api.retryAutomatedWorkflowStep(activeWorkflowRun.id, step.dbId)
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to retry step', 'error')
    } finally {
      setBannerActionBusy(false)
    }
  }, [activeWorkflowRun, addToast])

  const handleSkipFromBanner = useCallback(async (step: AutomatedWorkflowRunStep) => {
    if (!activeWorkflowRun) return
    setBannerActionBusy(true)
    try {
      await window.api.skipAutomatedWorkflowStep(activeWorkflowRun.id, step.dbId)
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to skip step', 'error')
    } finally {
      setBannerActionBusy(false)
    }
  }, [activeWorkflowRun, addToast])

  useEffect(() => {
    if (!chatProjectId || chatProjectId === '__none__') {
      setWikiMessageIds(new Set())
      return
    }

    window.api
      .listWikiEntries(chatProjectId)
      .then((entries) => {
        setWikiMessageIds(new Set(entries
          .filter((entry) => entry.source_message_id != null)
          .map((entry) => entry.source_message_id as string)))
      })
      .catch(() => {})
  }, [chatProjectId])

  useEffect(() => {
    const previousConversationId = previousModeConversationIdRef.current
    previousModeConversationIdRef.current = conversationId

    // Preserve optimistic settings during the new-chat null -> generated-id transition. The
    // first list refresh can race ahead of chat:send-message creating its row, which previously
    // made the picker flash back to Default for the in-flight turn. Real navigation still clears.
    if (previousConversationId !== null || conversationId === null) {
      setPendingModel(null)
      setPendingThinkingEffortOverride(null)
      setPendingFullAutoApproveOverride(null)
      setPendingAgenticModeOverride(null)
      setPendingTerminalSandboxOverride(null)
      setPendingCliModeOverride(null)
      setPendingCodexExecutionModeOverride(null)
      setPendingModelDirty(false)
      setPendingModeFields(new Set())
    }
  }, [conversationId])

  // Keep the optimistic picker value until the refreshed conversation row confirms that exact
  // write. A stale list refresh (including the one triggered by Send) must not roll controls back.
  useEffect(() => {
    if (!currentConversation) return
    if (pendingModelDirty && (currentConversation.model ?? null) === pendingModel) {
      setPendingModelDirty(false)
      setPendingModel(null)
    }
    if (pendingModeFields.size === 0) return
    const confirmed = new Set<string>()
    if (pendingModeFields.has('thinkingEffortOverride') && (currentConversation.thinking_effort_override ?? null) === pendingThinkingEffortOverride) confirmed.add('thinkingEffortOverride')
    const storedAutoApprove = currentConversation.full_auto_approve_override === 1 ? true : currentConversation.full_auto_approve_override === 0 ? false : null
    if (pendingModeFields.has('fullAutoApproveOverride') && storedAutoApprove === pendingFullAutoApproveOverride) confirmed.add('fullAutoApproveOverride')
    const storedAgentic = currentConversation.agentic_mode_override === 1 ? true : currentConversation.agentic_mode_override === 0 ? false : null
    if (pendingModeFields.has('agenticModeOverride') && storedAgentic === pendingAgenticModeOverride) confirmed.add('agenticModeOverride')
    const storedSandbox = currentConversation.terminal_sandbox_override === 1 ? true : currentConversation.terminal_sandbox_override === 0 ? false : null
    if (pendingModeFields.has('terminalSandboxOverride') && storedSandbox === pendingTerminalSandboxOverride) confirmed.add('terminalSandboxOverride')
    if (pendingModeFields.has('cliModeOverride') && (currentConversation.cli_mode_override ?? null) === pendingCliModeOverride) confirmed.add('cliModeOverride')
    if (pendingModeFields.has('codexExecutionModeOverride') && (currentConversation.codex_execution_mode_override ?? null) === pendingCodexExecutionModeOverride) confirmed.add('codexExecutionModeOverride')
    if (confirmed.size > 0) {
      setPendingModeFields((current) => new Set([...current].filter((key) => !confirmed.has(key))))
    }
  }, [
    currentConversation,
    pendingModel,
    pendingModelDirty,
    pendingModeFields,
    pendingThinkingEffortOverride,
    pendingFullAutoApproveOverride,
    pendingAgenticModeOverride,
    pendingTerminalSandboxOverride,
    pendingCliModeOverride,
    pendingCodexExecutionModeOverride,
  ])

  // `cli_mode_override` is one shared DB column for both Claude Code mode and Codex sandbox
  // level — a value set for one backend (e.g. "bypassPermissions") is meaningless for the
  // other and would otherwise resurface as a highlighted option if the chat switches back.
  // Clear it whenever it no longer belongs to the newly active backend's own option set.
  useEffect(() => {
    // During a conversation/model refresh the provider chip can briefly be unresolved. That is
    // not a backend switch and must never be allowed to erase a persisted Claude permission mode.
    // Explicit mode changes are persisted independently by the mode handler and are protected by
    // the pending-mode display until the refreshed row confirms them.
    if (!activeCliBackend) return
    const validValues: Record<string, (string | null)[]> = {
      'claude-cli': [null, 'plan', 'acceptEdits', 'bypassPermissions'],
      'codex-cli': [null, 'read-only', 'workspace-write', 'danger-full-access'],
    }
    const allowed = validValues[activeCliBackend]
    const current = currentConversation
      ? ((currentConversation.cli_mode_override as CliModeOverride | null | undefined) ?? null)
      : pendingCliModeOverride
    if (allowed && current !== null && !allowed.includes(current)) {
      void handleSetConversationMode({ cliModeOverride: null })
    }
  }, [activeCliBackend, conversationId])

  useEffect(() => {
    const unsubscribe = window.api.onAutoClipboardFocus(async () => {
      const setting = await window.api.getSetting('autoClipboard').catch(() => null)
      if (setting !== 'true') return

      const result = await window.api.readClipboardContent().catch(() => null)
      if (!result || isApiError(result)) return
      if (result.type !== 'text') return

      const sig = result.text.slice(0, 64)
      if (sig === lastClipboardSigRef.current) return
      lastClipboardSigRef.current = sig

      if (result.text.length > 4000) return
      setClipboardRef({ key: 'clipboard', token: '@clipboard', value: result.text })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.onWikiInjected(({ count }) => {
      const label = count === 1 ? 'wiki entry' : 'wiki entries'
      chat.setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'system' as const,
          content: `📖 ${count} project ${label} auto-injected into this conversation.`,
          timestamp: Date.now(),
        },
      ])
    })
    return unsubscribe
  }, [chat.setMessages])

  const inspectorSnapshotStateRef = useRef({
    conversationId,
    effectiveModel,
    chatAgent,
    mergedContextRefs,
    pendingAttachments: fileInput.pendingAttachments,
    pendingImages: fileInput.pendingImages,
    historyMessages: chat.messages,
    input,
  })
  inspectorSnapshotStateRef.current = {
    conversationId,
    effectiveModel,
    chatAgent,
    mergedContextRefs,
    pendingAttachments: fileInput.pendingAttachments,
    pendingImages: fileInput.pendingImages,
    historyMessages: chat.messages,
    input,
  }

  useEffect(() => {
    if (typeof window.api.onRequestInspectorSnapshot !== 'function') return
    const unsubscribe = window.api.onRequestInspectorSnapshot(({ requestId, conversationId: requestedConversationId }) => {
      const state = inspectorSnapshotStateRef.current
      if (requestedConversationId && state.conversationId !== requestedConversationId) {
        window.api.replyInspectorSnapshot(requestId, null)
        return
      }
      const systemPrompt = state.chatAgent?.systemPrompt ?? ''
      const systemPromptTokens = estimateTokens(systemPrompt.length)
      const contextRefs = state.mergedContextRefs.map((ref) => ({
        token: ref.token,
        key: ref.key,
        estimatedTokens: estimateRefTokens(ref),
      }))
      const attachments = state.pendingAttachments.map((att) => ({
        name: att.name,
        size: att.size,
        estimatedTokens: estimateTokens(att.size),
      }))
      const historyMessages = state.historyMessages.filter((message) => message.role !== 'system')
      const currentInputTokens = estimateTokens(state.input.length)
      const refTokens = contextRefs.reduce((sum, r) => sum + r.estimatedTokens, 0)
      const attachTokens = attachments.reduce((sum, a) => sum + a.estimatedTokens, 0)
      const historyTokens = historyMessages.length * 200
      const snapshot: ContextInspectorSnapshot = {
        conversationId: state.conversationId,
        model: state.effectiveModel,
        systemPrompt,
        systemPromptTokens,
        contextRefs,
        attachments,
        imageCount: state.pendingImages.length,
        historyMessageCount: historyMessages.length,
        currentInputTokens,
        totalTokens: systemPromptTokens + refTokens + attachTokens + historyTokens + currentInputTokens,
        maxTokens: CONTEXT_INSPECTOR_MAX_TOKENS,
      }
      window.api.replyInspectorSnapshot(requestId, snapshot)
    })
    return unsubscribe
  }, [])

  const pendingArtifactAttach = useAppStore((state) => state.pendingArtifactAttach)
  const clearPendingArtifactAttach = useAppStore((state) => state.clearPendingArtifactAttach)
  useEffect(() => {
    if (!pendingArtifactAttach || !conversationId) return
    const { artifactId, versionId } = pendingArtifactAttach
    clearPendingArtifactAttach()
    void chat.attachArtifact(artifactId, versionId)
  }, [pendingArtifactAttach, conversationId, clearPendingArtifactAttach, chat.attachArtifact])

  const {
    scrollContainerRef,
    contentContainerRef,
    isUserScrolledUp,
    hasUnreadBelow,
    scrollToBottom,
    handleScrollContainerScroll,
    suppressAutoFollow,
  } = useAutoScroll({
    isGenerating: chat.isGenerating,
    contentSignal: `${chat.messages.length}:${chat.streamingContent.length}:${chat.liveTeamActivity.length}`,
    resetKey: conversationId,
    isContentInitializing: chat.isLoadingMessages,
    onNewContentWhileScrolledUp: () => {
      if (conversationId) markConversationUnread(conversationId)
    },
    onAtBottomChange: (atBottom) => {
      if (atBottom && conversationId) markConversationRead(conversationId)
    },
  })

  useEffect(() => {
    const targetId = pendingSourceMessageIdRef.current
    if (!targetId || chat.messages.every((message) => message.id !== targetId)) return
    pendingSourceMessageIdRef.current = null
    requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'))
        .find((element) => element.dataset.messageId === targetId)
      if (!target) return
      suppressAutoFollow()
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target.focus({ preventScroll: true })
    })
  }, [chat.messages, suppressAutoFollow])

  // Suppresses the generation auto-follow effects for a short window so a manual
  // "scroll to request" jump isn't immediately dragged back to the bottom.
  const handleNavigateToRequest = useCallback(() => {
    suppressAutoFollow()
  }, [suppressAutoFollow])

  // Completion notification — only for successful responses (not stopped/errored)
  useEffect(() => {
    if (prevGeneratingRef.current && !chat.isGenerating && isUserScrolledUp) {
      const lastMsg = chat.messages[chat.messages.length - 1]
      if (lastMsg && !lastMsg.isError && !lastMsg.isStopped) {
        addToast('Response complete ✓', 'success')
      }
    }
    prevGeneratingRef.current = chat.isGenerating
  }, [chat.isGenerating, chat.messages, isUserScrolledUp, addToast])

  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      addToast('Copied to clipboard', 'success')
    } catch {
      addToast('Failed to copy message', 'error')
    }
  }, [addToast])

  const handleSaveToWiki = useCallback((messageId: string, content: string) => {
    setWikiModalMessage({ id: messageId, content })
  }, [])

  const handleExtractLearnings = useCallback(async () => {
    if (!conversationId || !chatProjectId || chatProjectId === '__none__') return
    setIsExtracting(true)
    try {
      const result = await window.api.extractWikiLearnings(conversationId, chatProjectId)
      if (result.candidates.length === 0) {
        addToast('No notable learnings found in this conversation', 'info')
      } else {
        setExtractionCandidates(result.candidates)
      }
    } catch {
      addToast('Failed to extract learnings', 'error')
    } finally {
      setIsExtracting(false)
    }
  }, [addToast, chatProjectId, conversationId])

  const handleExportConversation = useCallback(async (format: ConversationExportPackFormat) => {
    if (!conversationId) return
    setIsExporting(true)
    setMenuExportOpen(false)
    try {
      const pack = await window.api.exportConversationPack(conversationId, { format })
      const savedPath = await window.api.saveTextFile(pack.file_name, pack.content)
      if (savedPath) {
        addToast('Conversation exported', 'success')
      }
    } catch {
      addToast('Failed to export conversation', 'error')
    } finally {
      setIsExporting(false)
    }
  }, [addToast, conversationId])

  const handleImportIntoConversation = useCallback(async () => {
    if (!conversationId) return
    setIsImporting(true)
    try {
      const result = await window.api.importConversationJson(conversationId)
      if (result) {
        await loadConversations()
        addToast(`Imported ${result.message_count} messages`, 'success')
      }
    } catch {
      addToast('Failed to import conversation', 'error')
    } finally {
      setIsImporting(false)
    }
  }, [addToast, conversationId, loadConversations])

  const handleOpenContinueWith = useCallback(() => {
    setContinueModel(effectiveModel === 'default' ? 'default' : effectiveModel)
    setContinueAgentId(chatAgentId)
    setContinueProjectId(chatProjectId)
    setContinueCutoffTimestamp(null)
    setMenuExportOpen(false)
    setMenuContinueOpen(true)
  }, [chatAgentId, chatProjectId, effectiveModel])

  const handleOpenForkFromHere = useCallback((message: ChatMessage) => {
    if (!conversationId || message.timestamp <= 0) return
    setContinueModel(effectiveModel === 'default' ? 'default' : effectiveModel)
    setContinueAgentId(chatAgentId)
    setContinueProjectId(chatProjectId)
    setContinueCutoffTimestamp(message.timestamp)
    setMenuExportOpen(false)
    setMenuRatingOpen(false)
    setShowActionsMenu(true)
    setMenuContinueOpen(true)
  }, [chatAgentId, chatProjectId, conversationId, effectiveModel])

  const handleContinueWith = useCallback(async () => {
    if (!conversationId) return
    setIsForking(true)
    try {
      const result = await window.api.forkConversation(conversationId, {
        model: continueModel,
        agentId: continueAgentId,
        projectId: continueProjectId,
        cutoffTimestamp: continueCutoffTimestamp,
      })
      await loadConversations()
      selectConversation(result.conversation.id)
      setMenuContinueOpen(false)
      setShowActionsMenu(false)
      const details = [
        result.rewritten_message_count > 0 ? `${result.rewritten_message_count} converted for compatibility` : null,
        result.compressed_message_count > 0 ? `${result.compressed_message_count} compressed for context` : null,
        result.omitted_message_count > 0 ? `${result.omitted_message_count} execution trace${result.omitted_message_count === 1 ? '' : 's'} omitted` : null,
      ].filter(Boolean)
      addToast(
        details.length > 0
          ? `${continueCutoffTimestamp !== null ? 'Forked from here' : 'Forked'} ${result.message_count} messages (${details.join(', ')})`
          : `${continueCutoffTimestamp !== null ? 'Forked from here' : 'Forked'} ${result.message_count} messages`,
        'success',
      )
    } catch {
      addToast('Failed to continue conversation', 'error')
    } finally {
      setIsForking(false)
    }
  }, [addToast, continueAgentId, continueCutoffTimestamp, continueModel, continueProjectId, conversationId, loadConversations, selectConversation])

  useEffect(() => {
    if (!menuContinueOpen) return
    if (continueBackend !== 'claude-cli' && continueBackend !== 'codex-cli' && continueBackend !== 'hermes-cli') {
      setContinueCliModels([])
      return
    }

    const backend = continueBackend
    const fallbackModels = backend === 'codex-cli' ? FALLBACK_CODEX_MODELS : backend === 'hermes-cli' ? FALLBACK_HERMES_MODELS : FALLBACK_CLAUDE_MODELS
    // Hermes model lists are per-profile — scope the lookup to the agent's profile so a
    // localllm-scoped agent shows its own config's model, not the default profile's.
    const hermesProfile = backend === 'hermes-cli' ? continueAgent?.hermesProfile : undefined
    let cancelled = false
    setContinueCliModels(fallbackModels)
    window.api.getCliModels(backend, hermesProfile)
      .then((models) => {
        if (!cancelled) setContinueCliModels(models.length > 0 ? models : fallbackModels)
      })
      .catch(() => {
        if (!cancelled) setContinueCliModels(fallbackModels)
      })
    return () => {
      cancelled = true
    }
  }, [continueAgent?.hermesProfile, continueBackend, menuContinueOpen])

  useEffect(() => {
    if (!menuContinueOpen) return
    if (continueBackend === 'claude-cli' || continueBackend === 'codex-cli' || continueBackend === 'hermes-cli') {
      if (continueModelOptions.length === 0) return
      const preferred = continueAgent?.cliModel && continueModelOptions.some((model) => model.id === continueAgent.cliModel)
        ? continueAgent.cliModel
        : continueModelOptions[0].id
      if (!continueModelOptions.some((model) => model.id === continueModel)) {
        setContinueModel(preferred)
      }
      return
    }
    if (continueModelOptions.length > 0 && !continueModelOptions.some((model) => model.id === continueModel)) {
      setContinueModel(continueModelOptions[0].id)
    }
  }, [continueAgent?.cliModel, continueBackend, continueModel, continueModelOptions, menuContinueOpen])

  const handlePasteClipboard = useCallback(async () => {
    const result = await window.api.readClipboardContent()
    if (!result) {
      addToast('No content found in clipboard', 'info')
      return
    }
    if (isApiError(result)) {
      addToast('Failed to read clipboard', 'error')
      return
    }
    if (result.type === 'image') {
      fileInput.setPendingImages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: 'Clipboard image', dataUrl: result.dataUrl },
      ])
    } else {
      if (result.text.length > 4000) {
        addToast('Clipboard text truncated to 4000 characters', 'info')
      }
      setClipboardRef({ key: 'clipboard', token: '@clipboard', value: result.text })
    }
  }, [addToast, fileInput])

  const handleToggleImageMode = useCallback(async (id: string) => {
    const image = fileInput.pendingImages.find((img) => img.id === id)
    if (!image) return

    if (image.mode === 'text') {
      fileInput.setPendingImages((prev) =>
        prev.map((img) => img.id === id ? { ...img, mode: undefined, ocrText: undefined, ocrPending: false } : img)
      )
      return
    }

    fileInput.setPendingImages((prev) =>
      prev.map((img) => img.id === id ? { ...img, ocrPending: true } : img)
    )

    const result = await window.api.ocrImage(image.dataUrl)
    if ('error' in result) {
      addToast(`OCR failed: ${result.error}`, 'error')
      fileInput.setPendingImages((prev) =>
        prev.map((img) => img.id === id ? { ...img, ocrPending: false } : img)
      )
      return
    }

    if (!result.text.trim()) {
      addToast('No text detected in image', 'info')
      fileInput.setPendingImages((prev) =>
        prev.map((img) => img.id === id ? { ...img, ocrPending: false } : img)
      )
      return
    }

    fileInput.setPendingImages((prev) =>
      prev.map((img) =>
        img.id === id ? { ...img, mode: 'text', ocrText: result.text, ocrPending: false } : img
      )
    )
  }, [addToast, fileInput])

  const handleTogglePin = useCallback(async () => {
    if (!conversationId || isPinning) return
    const newPinned = !(currentConversation?.pinned === 1)
    setIsPinning(true)
    try {
      await window.api.setConversationPinned(conversationId, newPinned)
      await loadConversations()
    } catch {
      addToast('Failed to update pin', 'error')
    } finally {
      setIsPinning(false)
    }
  }, [conversationId, isPinning, currentConversation?.pinned, loadConversations, addToast])

  const handleEditMessage = useCallback(
    (index: number) => actions.handleEdit(index, chat.handleEdit),
    [actions.handleEdit, chat.handleEdit],
  )

  const handleCancelEdit = useCallback(() => {
    chat.cancelEdit()
    setInput('')
  }, [chat.cancelEdit, setInput])

  const handleSelectAvailableModel = useCallback(
    (group: AvailableModelGroup, model: AvailableModelEntry) => {
      setPendingModel(model.id)
      setPendingModelDirty(true)
      if (lockModelToAgentBackend) {
        // For CLI-backed agents, only allow picking within the same backend.
        // Store as a per-conversation override — does not mutate the agent config.
        if (group.sourceKey !== chatAgentBackend) return
        if (conversationId) {
          if (group.sourceKey === 'hermes-cli') {
            void actions.handleSetCliBackendAndModel('hermes-cli', model.id, targetHermesProfile ?? null)
          } else {
            void actions.handleSetConversationModel(model.id)
          }
        }
        return
      }
      if (group.sourceType === 'cli') {
        void actions.handleSetCliBackendAndModel(group.sourceKey as CliBackend, model.id, group.sourceKey === 'hermes-cli' ? (targetHermesProfile ?? null) : null)
        // Also update the UI immediately when there is no conversation yet;
        // the backend is staged for the first send inside useChatWindowActions.
      } else {
        if (conversationId) {
          void actions.handleSetConversationModel(model.id, group.sourceKey === 'hermes-cli' ? (targetHermesProfile ?? null) : null)
        }
      }
    },
    [actions, chatAgentBackend, conversationId, lockModelToAgentBackend],
  )

  const handlePickModel = useCallback(() => {
    modelPickerRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (event: ComposerKeyEvent) => {
      void actions.handleKeyDown(event, actions.handleSend)
    },
    [actions],
  )

  const handleInsertPrompt = useCallback((content: string) => {
    setInput((current) => current.trim() ? `${current.trimEnd()}\n\n${content}` : content)
    focusComposer()
  }, [focusComposer])

  const handleRunPrompt = useCallback(async (content: string) => {
    setInput(content)
    await actions.handleSend(content)
  }, [actions])

  const handleAttachPromptInstruction = useCallback((content: string, title: string) => {
    const label = title.trim() || 'Prompt'
    setPromptInstructionRef({
      key: 'prompt-instruction',
      token: `@prompt:${label.slice(0, 32)}`,
      value: content,
    })
    addToast('Prompt attached as temporary instructions', 'success')
  }, [addToast])

  const workflowModeInfo = projectWorkflowMode === 'orchestrated'
    ? { label: 'Orchestrated', Icon: Users, title: 'This project delegates tasks across the team automatically.' }
    : projectWorkflowMode === 'automated-delegation'
      ? { label: 'Automated', Icon: ListChecks, title: 'This project uses an automated delegation workflow — see the Workflow tab in project settings.' }
      : null

  const contextBar = (
    <div className="border-b border-gray-200 dark:border-gray-700/80 bg-gray-50 dark:bg-gray-800/50">
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 min-h-9"
      aria-label="Chat context"
    >
      <span
        className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 select-none whitespace-nowrap"
        style={{ lineHeight: '20px' }}
        aria-label="Project context"
      >
        {chatProject ? (
          <>
            <span className={`w-2 h-2 rounded-full bg-${chatProject.color}-400`} aria-hidden="true" />
            {chatProject.name}
          </>
        ) : (
          'No project'
        )}
      </span>

      {chatProject && workflowModeInfo && (
        <span
          className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 select-none whitespace-nowrap"
          style={{ lineHeight: '20px' }}
          title={workflowModeInfo.title}
          aria-label={`Workflow mode: ${workflowModeInfo.label}`}
        >
          <workflowModeInfo.Icon className="w-3 h-3" aria-hidden="true" />
          {workflowModeInfo.label}
        </span>
      )}

      <span
        className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 select-none whitespace-nowrap"
        style={{ lineHeight: '20px' }}
        aria-label="Agent context"
      >
        {chatAgent ? (
          <>
            <span aria-hidden="true">{chatAgent.icon}</span>
            {chatAgent.name}
          </>
        ) : (
          'No agent'
        )}
      </span>

      <span
        className={`inline-flex items-center px-2 rounded-full text-xs font-medium border select-none whitespace-nowrap ${backendChip.cls}`}
        style={{ lineHeight: '20px' }}
        title="Active backend for this conversation"
      >
        {backendChip.label}
      </span>
      {lockModelToAgentBackend && (
        <span
          className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 select-none whitespace-nowrap"
          style={{ lineHeight: '20px' }}
          title={`This chat is locked to ${backendChip.label} by the selected agent's Chat Backend setting.`}
          aria-label={`Chat backend locked by agent settings to ${backendChip.label}`}
        >
          <Lock className="w-3 h-3" aria-hidden="true" />
          Agent locked
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {projectRootDir && (
          <span
            className="inline-flex items-center gap-1 px-2 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 whitespace-nowrap"
            style={{ lineHeight: '20px' }}
            title={`File structure context active: ${projectRootDir}`}
            aria-label={`File structure context active: ${projectRootDir}`}
          >
            📁
          </span>
        )}
        <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-white/80 p-0.5 dark:border-gray-600 dark:bg-gray-800/80" role="radiogroup" aria-label="Markdown view">
          {([['rendered', 'Rendered'], ['raw', 'Raw']] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={markdownViewMode === mode}
              onClick={() => setMarkdownViewMode(mode as MarkdownViewMode)}
              className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${markdownViewMode === mode
                ? 'bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-white'
                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}`}
              title={`${label} Markdown`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
    </div>
  )

  const handleSetConversationMode = useCallback(async (mode: { thinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null; fullAutoApproveOverride?: boolean | null; agenticModeOverride?: boolean | null; terminalSandboxOverride?: boolean | null; cliModeOverride?: CliModeOverride | null; codexExecutionModeOverride?: CodexExecutionModeOverride | null }) => {
    setPendingModeFields((current) => {
      const next = new Set(current)
      Object.keys(mode).forEach((key) => next.add(key))
      return next
    })
    if (mode.thinkingEffortOverride !== undefined) setPendingThinkingEffortOverride(mode.thinkingEffortOverride)
    if (mode.fullAutoApproveOverride !== undefined) setPendingFullAutoApproveOverride(mode.fullAutoApproveOverride)
    if (mode.agenticModeOverride !== undefined) setPendingAgenticModeOverride(mode.agenticModeOverride)
    if (mode.terminalSandboxOverride !== undefined) setPendingTerminalSandboxOverride(mode.terminalSandboxOverride)
    if (mode.cliModeOverride !== undefined) setPendingCliModeOverride(mode.cliModeOverride)
    if (mode.codexExecutionModeOverride !== undefined) setPendingCodexExecutionModeOverride(mode.codexExecutionModeOverride)
    await actions.handleSetConversationMode(mode)
  }, [actions])

  const composer = (
    <ChatComposer
      input={input}
      inputRef={inputRef}
      composerFocusRef={composerFocusRef}
      messages={chat.messages}
      activeAgent={chatAgent as AgentConfig | null}
      authenticated={isReady}
      isOnline={isOnline}
      isGenerating={chat.isGenerating}
      isRunningCommand={actions.isExecutingSlashCommand}
      rateLimitRemainingSec={rateLimitRemainingSec}
      conversationId={conversationId}
      effectiveModel={effectiveModel}
      capabilitySkills={skills}
      capabilityProjectId={chatProjectId}
      capabilityProjectName={chatProject?.name}
      capabilityAgentId={chatAgentId}
      capabilityAgentName={chatAgent?.name}
      onEnsureConversationForCapability={ensureConversationForCapability}
      onOpenMcp={() => setShowMcpPanel(true)}
      onOpenSkills={() => openSectionPane('skills')}
      onOpenProjectCapabilities={() => { if (chatProjectId && chatProjectId !== '__none__') openEditProject(chatProjectId, 'capabilities') }}
      modelSourceLabel={modelSourceLabel}
      pendingAttachments={fileInput.pendingAttachments}
      pendingImages={fileInput.pendingImages}
      showContextInspector={showContextInspector}
      contextRefs={mergedContextRefs}
      showSlashMenu={slashMenu.showSlashMenu}
      slashFilter={slashMenu.slashFilter}
      selectedSlashIndex={slashMenu.selectedSlashIndex}
      slashCommands={actions.visibleSlashCommands}
      showAtMenu={atMenu.showAtMenu}
      atFilter={atMenu.atFilter}
      selectedAtIndex={atMenu.selectedAtIndex}
      atOptions={actions.visibleAtOptions}
      modelPickerRef={modelPickerRef}
      onInputChange={(event) => actions.handleInputChange(event.target.value)}
      onInputValueChange={actions.handleInputChange}
      onKeyDown={handleKeyDown}
      onPaste={fileInput.handlePaste}
      onAttachFiles={fileInput.handleFilePick}
      onAttachFolder={fileInput.handleFolderPick}
      onPasteClipboardImage={handlePasteClipboard}
      onOpenPromptLibrary={() => {
        setPromptLibraryDraftOverride(null)
        setShowPromptLibrary(true)
      }}
      onAttachArtifact={conversationId ? () => openSectionPane('artifacts') : undefined}
      voiceState={voiceState}
      onToggleVoice={toggleVoice}
      onCancelVoice={cancelVoice}
      voiceDocked={!voiceDockEnabled}
      onFloatVoice={() => setVoiceDock(true)}
      onToggleContextInspector={() => setShowContextInspector((value) => !value)}
      onCloseContextInspector={() => setShowContextInspector(false)}
      onRemoveAttachment={fileInput.removeAttachment}
      onRemoveImage={fileInput.removeImage}
      onToggleImageMode={handleToggleImageMode}
      onRemoveContextToken={(token) => {
        if (token === '@clipboard') {
          setClipboardRef(null)
        } else if (token.startsWith('@prompt:')) {
          setPromptInstructionRef(null)
        } else {
          atMenu.removeContextToken(token)
        }
      }}
      onSelectSlashCommand={actions.handleSelectSlashCommand}
      onSelectAtOption={actions.handleSelectAtOption}
      onCloseSlashMenu={slashMenu.closeSlashMenu}
      onCloseAtMenu={atMenu.closeAtMenu}
      onSetConversationModel={actions.handleSetConversationModel}
      onSetPendingModel={(model) => {
        setPendingModel(model)
        setPendingModelDirty(true)
      }}
      conversationThinkingEffortOverride={displayedThinkingEffort}
      conversationFullAutoApproveOverride={
        pendingModeFields.has('fullAutoApproveOverride') || !currentConversation
          ? pendingFullAutoApproveOverride
          : currentConversation
          ? currentConversation.full_auto_approve_override === 1 ? true
            : currentConversation.full_auto_approve_override === 0 ? false
            : null
          : null
      }
      conversationAgenticModeOverride={
        pendingModeFields.has('agenticModeOverride') || !currentConversation
          ? pendingAgenticModeOverride
          : currentConversation
          ? currentConversation.agentic_mode_override === 1 ? true
            : currentConversation.agentic_mode_override === 0 ? false
            : null
          : null
      }
      conversationTerminalSandboxOverride={
        pendingModeFields.has('terminalSandboxOverride') || !currentConversation
          ? pendingTerminalSandboxOverride
          : currentConversation
          ? currentConversation.terminal_sandbox_override === 1 ? true
            : currentConversation.terminal_sandbox_override === 0 ? false
            : null
          : null
      }
      activeCliBackend={activeCliBackend}
      conversationCliModeOverride={
        pendingModeFields.has('cliModeOverride') || !currentConversation
          ? pendingCliModeOverride
          : currentConversation
          ? ((currentConversation.cli_mode_override as CliModeOverride | null | undefined) ?? null)
          : null
      }
      conversationCodexExecutionModeOverride={
        pendingModeFields.has('codexExecutionModeOverride') || !currentConversation
          ? pendingCodexExecutionModeOverride
          : currentConversation
          ? ((currentConversation.codex_execution_mode_override as CodexExecutionModeOverride | null | undefined) ?? null)
          : null
      }
      onSetConversationMode={handleSetConversationMode}
      availableGroups={chatAvailableGroups}
      onSelectAvailableModel={handleSelectAvailableModel}
      showHermesProfile={isHermesTarget}
      hermesProfile={targetHermesProfile}
      hermesProfiles={hermesProfiles}
      onSetHermesProfile={(profile) => {
        if (conversationId && effectiveModel !== 'default') {
          void actions.handleSetCliBackendAndModel('hermes-cli', effectiveModel, profile || null)
        }
      }}
      isEditingMessage={chat.isEditingMessage}
      composerMarkdownViewMode={composerMarkdownViewMode}
      onComposerMarkdownViewModeChange={setComposerMarkdownViewMode}
      onCancelEdit={handleCancelEdit}
      onStop={actions.handleStop}
      onSend={actions.handleSend}
      cliLockedModels={
        lockModelToAgentBackend
          ? (chatAvailableGroups.find((g) => g.sourceKey === chatAgentBackend)?.models ?? [])
          : undefined
      }
      onSelectCliModel={
        lockModelToAgentBackend
          ? (modelId) => {
              setPendingModel(modelId)
              setPendingModelDirty(true)
              if (conversationId) void actions.handleSetConversationModel(modelId, targetHermesProfile ?? null)
            }
          : undefined
      }
      lockModelToAgentBackend={lockModelToAgentBackend}
    />
  )
  const voiceDock = voiceDockEnabled ? (
    <VoiceDock
      state={voiceState}
      durationMs={voiceDurationMs}
      level={voiceLevel}
      error={voiceError}
      disabled={chat.isGenerating}
      onStart={startVoice}
      onStop={stopVoice}
      onCancel={cancelVoice}
      onDock={() => setVoiceDock(false)}
    />
  ) : null

  const promptLibraryModal = showPromptLibrary ? (
    <PromptLibraryModal
      projectId={chatProjectId && chatProjectId !== '__none__' ? chatProjectId : null}
      projectName={chatProject?.name ?? null}
      draftContent={promptLibraryDraftOverride ?? input}
      initialMode={promptLibraryDraftOverride !== null ? 'save' : 'use'}
      onInsert={handleInsertPrompt}
      onRun={handleRunPrompt}
      onAttachInstruction={handleAttachPromptInstruction}
      onClose={() => {
        setShowPromptLibrary(false)
        setPromptLibraryDraftOverride(null)
      }}
    />
  ) : null


  const autoApproveBanner = chatAgent?.fullAutoApprove ? (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs" role="alert" aria-live="polite" aria-label="Auto-approve warning">
      <Zap className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="flex-1">Auto-approve is ON — all actions execute immediately</span>
      <button
        onClick={() => saveAgent({ ...chatAgent, fullAutoApprove: false })}
        className="underline hover:no-underline font-medium"
      >
        Disable
      </button>
    </div>
  ) : null

  const workflowStepBanner = activeWorkflowRun && currentWorkflowStep && currentWorkflowStep.id !== dismissedWorkflowStepId ? (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-300 text-xs" role="status" aria-label="Automated workflow step">
      {currentWorkflowStep.status === 'running'
        ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
        : <ListChecks className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span className="flex-1 truncate">
        <strong>{activeWorkflowRun.title}</strong> — Step {currentWorkflowStep.stepIndex + 1} of {activeWorkflowRun.steps.length}: {currentWorkflowStep.title}
        {currentWorkflowStep.status === 'running' && ' — running…'}
        {currentWorkflowStep.status === 'awaiting_confirmation' && (activeWorkflowRun.confirmationMode === 'gated' ? ' — ready for your review' : ' — advancing automatically…')}
        {currentWorkflowStep.status === 'failed' && ` — failed${currentWorkflowStep.error ? `: ${currentWorkflowStep.error}` : ''}`}
      </span>
      {currentWorkflowStep.status === 'awaiting_confirmation' && activeWorkflowRun.confirmationMode === 'gated' && (
        <button
          disabled={bannerActionBusy}
          onClick={() => { void handleApproveFromBanner(currentWorkflowStep) }}
          className="underline hover:no-underline font-medium shrink-0 disabled:opacity-50"
        >
          Approve
        </button>
      )}
      {currentWorkflowStep.status === 'failed' && (
        <>
          <button
            disabled={bannerActionBusy}
            onClick={() => { void handleRetryFromBanner(currentWorkflowStep) }}
            className="underline hover:no-underline font-medium shrink-0 disabled:opacity-50"
          >
            Retry
          </button>
          <button
            disabled={bannerActionBusy}
            onClick={() => { void handleSkipFromBanner(currentWorkflowStep) }}
            className="underline hover:no-underline shrink-0 disabled:opacity-50"
          >
            Skip
          </button>
        </>
      )}
      <button
        onClick={() => { if (chatProjectId && chatProjectId !== '__none__') openEditProject(chatProjectId, 'workflow') }}
        className="underline hover:no-underline shrink-0"
      >
        View workflow
      </button>
      <button
        onClick={() => setDismissedWorkflowStepId(currentWorkflowStep.id)}
        aria-label="Dismiss workflow step banner"
        className="shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  ) : null

  if (!conversationId && chat.messages.length === 0) {
    return (
      <div
        className={`relative flex-1 flex flex-col min-h-0 ${fileInput.isDragging ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/5' : ''}`}
        onDragEnter={fileInput.handleDragEnter}
        onDragOver={fileInput.handleDragOver}
        onDragLeave={fileInput.handleDragLeave}
        onDrop={fileInput.handleDrop}
      >
        {contextBar}
        {autoApproveBanner}
        {workflowStepBanner}
        {voiceDock}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-medium text-gray-700 dark:text-gray-200 mb-2">
              {chatAgent ? `${chatAgent.icon} ${chatAgent.name}` : 'Nexy'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {chatAgent ? `Start a conversation with ${chatAgent.name}` : (cliInstalled || hasByok) ? 'Chat directly or select an agent' : 'Add an API key in Settings to start chatting'}
            </p>
            {authMode === 'none' && !cliInstalled && (
              <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                No provider configured. Add an API key in Settings.
              </div>
            )}
            {authMode === 'none' && cliInstalled && !hasByok && (() => {
              const installedCount = [installedClis.claude, installedClis.codex, installedClis.hermes].filter(Boolean).length
              const both = installedCount > 1
              const label = both
                ? 'CLI tools ready — start typing'
                : installedClis.codex
                  ? 'Codex CLI is installed — just start typing to chat'
                  : installedClis.hermes
                    ? 'Hermes Agent is installed — just start typing to chat'
                    : 'Claude CLI is installed — just start typing to chat'
              const cls = both
                ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                : installedClis.codex
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : installedClis.hermes
                    ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                    : 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
              return (
                <div className="mb-4">
                  <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{label}</div>
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                    Optionally select an agent from the sidebar to use a custom system prompt or settings.
                  </p>
                </div>
              )
            })()}
            {fileInput.isDragging && <p className="text-sm text-blue-500 animate-pulse">Drop files to attach</p>}
          </div>
        </div>
        {composer}
        {promptLibraryModal}
      </div>
    )
  }

  return (
    <div
      className={`relative flex-1 flex flex-col min-h-0 ${fileInput.isDragging ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/5' : ''}`}
      onDragEnter={fileInput.handleDragEnter}
      onDragOver={fileInput.handleDragOver}
      onDragLeave={fileInput.handleDragLeave}
      onDrop={fileInput.handleDrop}
      role="region"
      aria-label="Chat conversation"
    >
      {contextBar}
      {autoApproveBanner}
      {workflowStepBanner}
      {voiceDock}

      <div className="relative flex flex-col flex-1 min-h-0">
        {conversationId && !chat.isGenerating && (completedConversationIds.includes(conversationId) || conversationRatings[conversationId] != null) && (
          <div className="absolute left-4 top-4 z-10 flex items-center gap-1.5">
            {completedConversationIds.includes(conversationId) && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50/95 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium shadow-sm">
                <NexyIcon name="checked-box" className="w-3.5 h-3.5" />
                Completed
              </span>
            )}
            {conversationRatings[conversationId] != null && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50/95 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[11px] font-medium shadow-sm">
                <Star className="w-3 h-3 fill-current" />
                {conversationRatings[conversationId]}/5
              </span>
            )}
          </div>
        )}
        {(conversationId || chat.messages.length > 0) && !chat.isGenerating && (
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            <DropdownPanel
              open={showActionsMenu}
              onClose={() => {
                setShowActionsMenu(false)
                setMenuExportOpen(false)
                setMenuContinueOpen(false)
                setMenuRatingOpen(false)
              }}
              align="right"
              width="w-64"
              trigger={
                <button
                  type="button"
                  onClick={() => setShowActionsMenu((v) => !v)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 text-gray-600 dark:text-gray-300 opacity-70 shadow-sm hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-[background-color,opacity]"
                  aria-label="More options"
                  title="More options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              }
            >
              <div className="p-1">
                {chatProjectId && chatProjectId !== '__none__' && (
                  <button
                    type="button"
                    onClick={() => { void handleExtractLearnings(); setShowActionsMenu(false) }}
                    disabled={isExtracting}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isExtracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Extract learnings
                  </button>
                )}

                {conversationId && !completedConversationIds.includes(conversationId) && chat.messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { void markConversationCompleteFn(conversationId); setShowActionsMenu(false) }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Mark complete
                  </button>
                )}

                {conversationId && chat.messages.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setMenuExportOpen(false); setMenuContinueOpen(false); setMenuRatingOpen((v) => !v) }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <Star className="w-3.5 h-3.5" />
                      <span className="flex-1">
                        {conversationRatings[conversationId] != null ? `Rated ${conversationRatings[conversationId]}/5` : 'Rate conversation'}
                      </span>
                      {menuRatingOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    {menuRatingOpen && (
                      <div className="flex items-center gap-1 px-2 py-1.5 ml-5 mb-1" role="radiogroup" aria-label="Rate this conversation">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            role="radio"
                            aria-checked={conversationRatings[conversationId] === star}
                            aria-label={`${star} star${star === 1 ? '' : 's'}`}
                            onClick={() => {
                              void submitConversationRatingFn(conversationId, star)
                              setMenuRatingOpen(false)
                              setShowActionsMenu(false)
                            }}
                            className="p-0.5 text-amber-500 hover:scale-110 transition-transform"
                          >
                            <Star
                              className={`w-4 h-4 ${conversationRatings[conversationId] != null && star <= conversationRatings[conversationId] ? 'fill-current' : ''}`}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => { setMenuContinueOpen(false); setMenuRatingOpen(false); setMenuExportOpen((v) => !v) }}
                  disabled={isExporting || !conversationId || chat.messages.length === 0}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span className="flex-1">Export</span>
                  {menuExportOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {menuExportOpen && (
                  <div className="ml-5 mb-1">
                    <button
                      type="button"
                      onClick={() => { void handleExportConversation('json'); setShowActionsMenu(false) }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      JSON archive
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleExportConversation('markdown'); setShowActionsMenu(false) }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Markdown transcript
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleExportConversation('context-bundle'); setShowActionsMenu(false) }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Compact context bundle
                    </button>
                  </div>
                )}

                {conversationId && chat.messages.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuExportOpen(false)
                        setMenuRatingOpen(false)
                        if (menuContinueOpen) setMenuContinueOpen(false)
                        else handleOpenContinueWith()
                      }}
                      disabled={isForking}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isForking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span className="flex-1">{continueCutoffTimestamp !== null ? 'Fork from here' : 'Continue with'}</span>
                      {menuContinueOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    {menuContinueOpen && (
                      <div className="mx-1 mb-2 mt-1 rounded-md border border-gray-100 dark:border-gray-700 p-2">
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                          {continueCutoffTimestamp !== null
                            ? 'Fork the conversation up to this message into a new project or model.'
                            : 'Fork this chat into a new conversation.'}
                        </div>
                        <label className="block mb-2">
                          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Model</span>
                          <ModelPicker
                            value={continueModel}
                            availableGroups={continueGroups}
                            catalogModels={catalogModels}
                            globalDefaultModel={defaultModelSetting ?? undefined}
                            includeDefault={!continueIsCli}
                            emptyLabel="No models available"
                            buttonClassName="flex w-full items-center justify-between gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            menuClassName="left-0"
                            onSelectDefault={() => setContinueModel('default')}
                            onSelectAvailableModel={(_group, model) => setContinueModel(model.id)}
                          />
                          {continueBackend === 'claude-cli' && (
                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Showing Claude CLI models only.</div>
                          )}
                          {continueBackend === 'codex-cli' && (
                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Showing Codex CLI models only.</div>
                          )}
                          {continueBackend === 'hermes-cli' && (
                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Showing Hermes Agent models only.</div>
                          )}
                        </label>
                        <label className="block mb-2">
                          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Agent</span>
                          <select
                            value={continueAgentId ?? '__none__'}
                            onChange={(event) => setContinueAgentId(event.target.value === '__none__' ? null : event.target.value)}
                            className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
                          >
                            <option value="__none__">No agent</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.icon} {agent.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block mb-2">
                          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Project</span>
                          <select
                            value={continueProjectId ?? '__none__'}
                            onChange={(event) => setContinueProjectId(event.target.value === '__none__' ? null : event.target.value)}
                            className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
                          >
                            <option value="__none__">No project</option>
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>{project.name}</option>
                            ))}
                          </select>
                        </label>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setMenuContinueOpen(false)}
                            className="rounded-md px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleContinueWith()}
                            disabled={isForking}
                            className="rounded-md bg-gray-900 dark:bg-gray-100 px-2 py-1 text-xs font-medium text-white dark:text-gray-900 disabled:opacity-60"
                          >
                            {isForking ? 'Forking...' : continueCutoffTimestamp !== null ? 'Fork from here' : 'Create fork'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {conversationId && (
                  <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                )}

                {conversationId && (
                  <button
                    type="button"
                    onClick={() => { void handleImportIntoConversation(); setShowActionsMenu(false) }}
                    disabled={isImporting}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Import
                  </button>
                )}

                {conversationId && (
                  <button
                    type="button"
                    onClick={() => { void handleTogglePin(); setShowActionsMenu(false) }}
                    disabled={isPinning}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-60 ${
                      currentConversation?.pinned === 1
                        ? 'text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    aria-label={currentConversation?.pinned === 1 ? 'Unpin conversation' : 'Pin conversation'}
                  >
                    {isPinning
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : currentConversation?.pinned === 1
                        ? <PinOff className="w-3.5 h-3.5" />
                        : <Pin className="w-3.5 h-3.5" />
                    }
                    {currentConversation?.pinned === 1 ? 'Unpin' : 'Pin'}
                  </button>
                )}
              </div>
            </DropdownPanel>
          </div>
        )}
        <ChatMessages
          messages={chat.messages}
          isLoadingMessages={chat.isLoadingMessages}
          isGenerating={chat.isGenerating}
          liveTeamActivity={chat.liveTeamActivity}
          streamingContent={chat.displayedContent}
          isDraining={chat.isDraining}
          generationStartedAt={chat.generationStartedAt}
          loadingFailed={chat.loadingFailed}
          messagesEndRef={messagesEndRef}
          scrollContainerRef={scrollContainerRef}
          contentContainerRef={contentContainerRef}
          onScroll={handleScrollContainerScroll}
          onNavigateToRequest={handleNavigateToRequest}
          onCopy={handleCopy}
          onSaveAsPrompt={(content) => {
            setPromptLibraryDraftOverride(content)
            setShowPromptLibrary(true)
          }}
          onSaveToWiki={chatProjectId && chatProjectId !== '__none__' ? handleSaveToWiki : undefined}
          onPromoteArtifact={handleOpenArtifactPromotion}
          wikiMessageIds={wikiMessageIds}
          onRegenerate={chat.handleRegenerate}
          onEdit={handleEditMessage}
          onDeleteAfter={conversationId ? (message) => setDeleteAfterTarget({ conversationId, message }) : undefined}
          onForkFromHere={conversationId ? handleOpenForkFromHere : undefined}
          onRetry={actions.handleRetry}
          onSignIn={() => addToast('No provider configured. Add an API key in Settings.', 'info')}
          onPickModel={handlePickModel}
          onUseImageAsContext={(dataUrl) => {
            fileInput.setPendingImages((prev) => [
              ...prev,
              { id: crypto.randomUUID(), dataUrl, name: 'browser-screenshot.png' }
            ])
          }}
          liveTurnState={chat.liveTurnState}
          markdownViewMode={markdownViewMode}
        />
        {isUserScrolledUp && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <button
              onClick={() => scrollToBottom('auto')}
              className={`pointer-events-auto flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-colors ${
                hasUnreadBelow
                  ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-400'
                  : 'bg-gray-800/70 dark:bg-gray-200/70 text-white dark:text-gray-800 hover:bg-gray-800 dark:hover:bg-gray-200'
              }`}
              aria-label="Scroll to bottom"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        )}
        {deleteAfterTarget && (
          <ConfirmDialog
            title="Delete from here?"
            confirmLabel="Delete"
            busy={isDeletingAfter}
            onCancel={() => setDeleteAfterTarget(null)}
            onConfirm={() => {
              const { conversationId: targetConversationId, message } = deleteAfterTarget
              const cutoff = message.timestamp
              setIsDeletingAfter(true)
              void window.api.deleteMessagesAfter(targetConversationId, cutoff)
                .then((result) => {
                  if (isApiError(result)) throw new Error(result.error)
                  if (conversationId === targetConversationId) {
                    chat.setMessages((current) => current.filter((currentMessage) => currentMessage.timestamp < cutoff))
                  }
                  setDeleteAfterTarget(null)
                })
                .catch(() => addToast('Failed to delete messages', 'error'))
                .finally(() => setIsDeletingAfter(false))
            }}
          >
            This message and all messages after it will be removed from the conversation.
          </ConfirmDialog>
        )}
        {wikiModalMessage && conversationId && chatProjectId && chatProjectId !== '__none__' && (
          <SaveToWikiModal
            projectId={chatProjectId}
            conversationId={conversationId}
            messageId={wikiModalMessage.id}
            initialContent={wikiModalMessage.content}
            onSaved={(entry) => {
              setWikiMessageIds((prev) => new Set([...prev, entry.source_message_id].filter(Boolean) as string[]))
              addToast('Saved to project wiki', 'success')
            }}
            onClose={() => setWikiModalMessage(null)}
          />
        )}
        {extractionCandidates && conversationId && chatProjectId && chatProjectId !== '__none__' && (
          <WikiExtractionModal
            projectId={chatProjectId}
            conversationId={conversationId}
            candidates={extractionCandidates}
            onClose={() => setExtractionCandidates(null)}
            onAllDone={(savedCount) => {
              addToast(`${savedCount} wiki ${savedCount === 1 ? 'entry' : 'entries'} saved`, 'success')
              setExtractionCandidates(null)
            }}
          />
        )}
        {artifactPromotion && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Save As Artifact</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Create a saved, versioned artifact from this assistant response.</p>
                </div>
                <button
                  type="button"
                  onClick={() => artifactPromotion.saving ? undefined : setArtifactPromotion(null)}
                  className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Title</span>
                  <input
                    type="text"
                    value={artifactPromotion.title}
                    onChange={(event) => setArtifactPromotion((current) => current ? { ...current, title: event.target.value } : current)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Kind</span>
                    <select
                      value={artifactPromotion.kind}
                      onChange={(event) => {
                        const kind = event.target.value as ArtifactPromotionRequest['kind']
                        setArtifactPromotion((current) => current ? { ...current, kind, filePath: defaultArtifactFilePath(kind) } : current)
                      }}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    >
                      {PROMOTABLE_ARTIFACT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Scope</span>
                    <select
                      value={artifactPromotion.scopeType}
                      onChange={(event) => setArtifactPromotion((current) => current ? { ...current, scopeType: event.target.value as 'global' | 'project' } : current)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    >
                      <option value="global">Global</option>
                      <option value="project" disabled={!chatProjectId || chatProjectId === '__none__'}>This project</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">File path</span>
                  <input
                    type="text"
                    value={artifactPromotion.filePath}
                    onChange={(event) => setArtifactPromotion((current) => current ? { ...current, filePath: event.target.value } : current)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  />
                </label>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setArtifactPromotion(null)}
                  disabled={artifactPromotion.saving}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void handleConfirmArtifactPromotion() }}
                  disabled={artifactPromotion.saving || !artifactPromotion.filePath.trim()}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {artifactPromotion.saving ? 'Saving…' : 'Save artifact'}
                </button>
              </div>
            </div>
          </div>
        )}
        {promptLibraryModal}
      </div>


      {fileInput.isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 pointer-events-none z-10">
          <div className="text-lg font-medium text-blue-500 bg-white dark:bg-gray-800 px-6 py-3 rounded-xl shadow-lg">Drop files to attach</div>
        </div>
      )}
      {rateLimitRemainingSec > 0 && (
        <div className="px-4 pb-2">
          <div className="max-w-3xl mx-auto text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Rate limited — you can send again in {rateLimitRemainingSec}s.
          </div>
        </div>
      )}
      {composer}
    </div>
  )
}
