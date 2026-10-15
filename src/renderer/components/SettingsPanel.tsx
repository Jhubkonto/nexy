import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { NexyIcon, type NexyIconName } from './ui/icons/NexyIcon'
import { useAppStore } from '../store/app-store'
import { getAvailableModelIds } from '../../shared/models'
import type { AdbDevice, AndroidBuildCommandName, AndroidFirebaseClientStatus, AndroidSigningConfig, AndroidUpdateManifest, AndroidWorkspaceInfo, BuildCommandName, BuildRecord, BuildStatus, HermesProfileInfo, LocalUpdateFeed, PreflightCheck, PromptLibraryEntry, PromptLibraryInput, PromptLibraryVersion, PublishedEntry, WorkspaceInfo, WsUrlProfile } from '../../shared/types'
import { extractPromptVariables } from '../../shared/prompt-variables'
import { isApiError } from '../../shared/types'
import { ModalShell } from './ui/primitives'
import { GeneralTab } from './settings/GeneralTab'
import { VoiceAudioTab } from './settings/VoiceAudioTab'
import { ProvidersTab } from './settings/ProvidersTab'
import { CredentialsTab } from './settings/CredentialsTab'
import { CliTab } from './settings/CliTab'
import { PromptsTab } from './settings/PromptsTab'
import { MobileTab } from './settings/MobileTab'
import { DeveloperTab } from './settings/DeveloperTab'
import type { ProviderInfo } from './settings/types'
import { useClickOutside } from '../hooks/useClickOutside'

type SettingsCategory = 'general' | 'voice' | 'providers' | 'credentials' | 'cli' | 'mobile' | 'prompts' | 'developer'

const NAV_ITEMS: { id: SettingsCategory; label: string; icon: NexyIconName }[] = [
  { id: 'general',   label: 'General',       icon: 'settings' },
  { id: 'voice',     label: 'Voice & audio', icon: 'microphone' },
  { id: 'providers', label: 'API Providers', icon: 'key' },
  { id: 'credentials', label: 'Credential Manager', icon: 'key' },
  { id: 'cli',       label: 'CLI Tools',     icon: 'prompt' },
  { id: 'prompts',   label: 'Prompts',       icon: 'clipboard' },
  { id: 'mobile',    label: 'Mobile',        icon: 'mobile' },
  { id: 'developer', label: 'Developer',     icon: 'tool' },
]

const EMPTY_PROMPT_DRAFT: PromptLibraryInput = {
  title: '',
  description: '',
  body: '',
  category: 'Custom',
  tags: [],
  scope: 'global',
  project_id: null,
}

function tagsToInput(tags: string[] | undefined): string {
  return (tags ?? []).join(', ')
}

function inputToTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}

export function SettingsPanel() {
  const visible = useAppStore((s) => s.showSettings)
  const theme = useAppStore((s) => s.theme)
  const uiStyle = useAppStore((s) => s.uiStyle)
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const agents = useAppStore((s) => s.agents)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const setUiStyle = useAppStore((s) => s.setUiStyle)
  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setShowMcpPanel = useAppStore((s) => s.setShowMcpPanel)
  const addToast = useAppStore((s) => s.addToast)
  const setGlobalDefaultModel = useAppStore((s) => s.setGlobalDefaultModel)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const availableModelGroups = useAppStore((s) => s.availableModelGroups)
  const refreshAvailableModels = useAppStore((s) => s.refreshAvailableModels)
  const debugLogging = useAppStore((s) => s.debugLogging)
  const setDebugLogging = useAppStore((s) => s.setDebugLogging)
  const androidDebugLog = useAppStore((s) => s.androidDebugLog)
  const setAndroidDebugLog = useAppStore((s) => s.setAndroidDebugLog)

  const authMode = useAppStore((s) => s.authState.mode)
  const installedClis = useAppStore((s) => s.authState.clis ?? { claude: s.authState.cliInstalled, codex: false })
  const checkAuth = useAppStore((s) => s.checkAuth)
  const settingsInitialTab = useAppStore((s) => s.settingsInitialTab)
  const setSettingsInitialTab = useAppStore((s) => s.setSettingsInitialTab)
  const onClose = () => setShowSettings(false)
  const onOpenMcp = () => { setShowSettings(false); setShowMcpPanel(true) }
  const [category, setCategory] = useState<SettingsCategory>(() =>
    authMode === 'byok' ? 'providers' : 'general'
  )

  const [developerInitialSubTab, setDeveloperInitialSubTab] = useState<'desktop' | 'android' | 'console' | null>(null)
  const [developerInitialErrorId, setDeveloperInitialErrorId] = useState<string | null>(null)

  useEffect(() => {
    if (visible && settingsInitialTab) {
      // Background activities that need to land on a specific Developer sub-tab (e.g. an
      // Android build vs a desktop build) encode it as 'developer:android' / 'developer:desktop'.
      const [tab, subTab, errorId] = settingsInitialTab.split(':')
      setCategory(tab as SettingsCategory)
      if (tab === 'developer' && (subTab === 'desktop' || subTab === 'android' || subTab === 'console')) {
        setDeveloperInitialSubTab(subTab)
      }
      if (tab === 'developer' && subTab === 'console' && errorId) setDeveloperInitialErrorId(errorId)
      setSettingsInitialTab(null)
    }
  }, [visible, settingsInitialTab, setSettingsInitialTab])

  const [autoStart, setAutoStart] = useState(false)
  const [runInBackground, setRunInBackground] = useState(false)
  const [autoClipboard, setAutoClipboard] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [azureEndpoint, setAzureEndpoint] = useState('')
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [cliRefreshing, setCliRefreshing] = useState(false)
  const [hermesHome, setHermesHome] = useState('')
  const [hermesHomeError, setHermesHomeError] = useState<string | null>(null)
  const [defaultModel, setDefaultModel] = useState('gpt-5-mini')
  const [globalHermesProfile, setGlobalHermesProfile] = useState('')
  const [hermesProfiles, setHermesProfiles] = useState<HermesProfileInfo[]>([])
  const [defaultModelSearch, setDefaultModelSearch] = useState('')
  const [showDefaultModelMenu, setShowDefaultModelMenu] = useState(false)
  const [defaultModelMenuRect, setDefaultModelMenuRect] = useState<DOMRect | null>(null)
  const defaultModelMenuRef = useRef<HTMLDivElement | null>(null)
  const defaultModelButtonRef = useRef<HTMLButtonElement | null>(null)
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(4096)
  const [whisperCppPath, setWhisperCppPath] = useState('')
  const [whisperModelPath, setWhisperModelPath] = useState('')
  const [whisperInstalling, setWhisperInstalling] = useState(false)
  const [whisperReady, setWhisperReady] = useState(false)

  // Mobile companion state
  const [mobileEnabled, setMobileEnabled] = useState(false)
  const [mobileQr, setMobileQr] = useState<string | null>(null)
  const [mobileClients, setMobileClients] = useState(0)
  const [mobileLoading, setMobileLoading] = useState(false)
  const [mobileLocalIp, setMobileLocalIp] = useState('')
  const [mobilePairingUrl, setMobilePairingUrl] = useState<string | null>(null)
  const [urlProfiles, setUrlProfiles] = useState<WsUrlProfile[]>([])
  const [autoStartEnabled, setAutoStartEnabled] = useState(false)

  // Developer / build orchestrator state
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null)
  const [workspacePathInput, setWorkspacePathInput] = useState('')
  const [buildRecords, setBuildRecords] = useState<BuildRecord[]>([])
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null)
  const [activeBuildCommand, setActiveBuildCommand] = useState<BuildCommandName | null>(null)
  const [buildLogLines, setBuildLogLines] = useState<string[]>([])
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[] | null>(null)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const [lastBuildStatus, setLastBuildStatus] = useState<BuildStatus | null>(null)
  const [launchDevError, setLaunchDevError] = useState<string | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<{ isPackaged: boolean } | null>(null)
  // Local update feed state
  const [feedInfo, setFeedInfo] = useState<LocalUpdateFeed | null>(null)
  const [feedPathInput, setFeedPathInput] = useState('')
  const [publishedEntries, setPublishedEntries] = useState<PublishedEntry[]>([])
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<string | null>(null)

  // Android build state
  const [androidWorkspaceInfo, setAndroidWorkspaceInfo] = useState<AndroidWorkspaceInfo | null>(null)
  const [androidWorkspacePathInput, setAndroidWorkspacePathInput] = useState('')
  const [androidBuildRecords, setAndroidBuildRecords] = useState<BuildRecord[]>([])
  const [activeAndroidBuildId, setActiveAndroidBuildId] = useState<string | null>(null)
  const [activeAndroidCommand, setActiveAndroidCommand] = useState<AndroidBuildCommandName | null>(null)
  const [androidLogLines, setAndroidLogLines] = useState<string[]>([])
  const [androidLastBuildStatus, setAndroidLastBuildStatus] = useState<BuildStatus | null>(null)
  const [signingDraft, setSigningDraft] = useState<AndroidSigningConfig>({ keystorePath: '', keystorePassword: '', keyAlias: '', keyPassword: '' })
  const [signingValidation, setSigningValidation] = useState<PreflightCheck[] | null>(null)
  const [adbDevices, setAdbDevices] = useState<AdbDevice[]>([])
  const [adbRefreshing, setAdbRefreshing] = useState(false)
  const [adbInstalling, setAdbInstalling] = useState(false)
  const [androidPublishResult, setAndroidPublishResult] = useState<string | null>(null)
  const [androidUpdateManifest, setAndroidUpdateManifest] = useState<AndroidUpdateManifest | null>(null)
  const [androidPublishHistory, setAndroidPublishHistory] = useState<AndroidUpdateManifest[]>([])
  const [androidRestoring, setAndroidRestoring] = useState<number | null>(null)
  const [fcmStatus, setFcmStatus] = useState<{ configured: boolean; projectId?: string } | null>(null)
  const [fcmJsonDraft, setFcmJsonDraft] = useState('')
  const [fcmSaving, setFcmSaving] = useState(false)
  const [fcmError, setFcmError] = useState<string | null>(null)
  const [fcmVerification, setFcmVerification] = useState<{ state: 'unknown' | 'checking' | 'verified' | 'failed'; error?: string }>({ state: 'unknown' })
  const [androidFirebaseStatus, setAndroidFirebaseStatus] = useState<AndroidFirebaseClientStatus | null>(null)
  const [androidFirebaseImporting, setAndroidFirebaseImporting] = useState(false)
  const [androidFirebaseError, setAndroidFirebaseError] = useState<string | null>(null)

  // Key handoff consent state — lifted to the store so TitleBar can surface a badge for it
  const pendingKeyHandoffProvider = useAppStore((s) => s.pendingKeyHandoffProvider)
  const setPendingKeyHandoffProvider = useAppStore((s) => s.setPendingKeyHandoffProvider)

  // Prompt library state
  const [prompts, setPrompts] = useState<PromptLibraryEntry[]>([])
  const [promptsLoading, setPromptsLoading] = useState(false)
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [promptDraft, setPromptDraft] = useState<PromptLibraryInput>(EMPTY_PROMPT_DRAFT)
  const [promptTagInput, setPromptTagInput] = useState('')
  const [promptVersions, setPromptVersions] = useState<PromptLibraryVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  const currentConversation = currentConversationId
    ? conversations.find((c) => c.id === currentConversationId) ?? null
    : null
  const activeAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const projectId = currentConversation?.project_id ?? activeProjectId
  const projectDefaultModel = projectId ? (projects.find((p) => p.id === projectId)?.default_model ?? null) : null
  const activeProject = projectId ? projects.find((p) => p.id === projectId) ?? null : null
  const effectiveModel = currentConversation?.model || projectDefaultModel || defaultModel || 'gpt-5-mini'
  const effectiveProvider =
    effectiveModel.startsWith('claude')
      ? 'Anthropic'
      : effectiveModel.startsWith('azure:')
        ? 'Azure OpenAI'
        : 'OpenAI'
  const modelIds = getAvailableModelIds(catalogModels, defaultModel)

  useEffect(() => {
    if (!visible) return
    window.api.getSettings().then((settings: Record<string, string>) => {
      setAutoStart(settings['autoStart'] === 'true')
      setRunInBackground(settings['runInBackground'] === 'true')
      setAutoClipboard(settings['autoClipboard'] === 'true')
      setDefaultModel(settings['default_model'] || 'gpt-5-mini')
      setGlobalHermesProfile(settings['global_default_hermes_profile'] || '')
      setTemperature(Number.parseFloat(settings['temperature'] || '0.7') || 0.7)
      setMaxTokens(Number.parseInt(settings['max_tokens'] || '4096', 10) || 4096)
      setWhisperCppPath(settings['whisper_cpp_path'] || '')
      setWhisperModelPath(settings['whisper_model_path'] || '')
      setHermesHome(settings['hermes_home'] || '')
      setHermesHomeError(null)
      try {
        const parsed = settings['ws_url_profiles'] ? (JSON.parse(settings['ws_url_profiles']) as WsUrlProfile[]) : []
        setUrlProfiles(Array.isArray(parsed) ? parsed : [])
      } catch {
        setUrlProfiles([])
      }
    })
    window.api.listProviders().then(setProviders)
    window.api.getVoiceStatus().then((status) => setWhisperReady(!('error' in status) && status.ready)).catch(() => setWhisperReady(false))
    window.api.getAzureEndpoint().then((ep: string | null) => {
      if (ep) setAzureEndpoint(ep)
    })
  }, [visible])

  useEffect(() => {
    const unsubHandoffRequest = window.api.onProviderKeyHandoffRequest((provider) => {
      setPendingKeyHandoffProvider(provider)
    })
    const unsubHandoffSent = window.api.onProviderKeyHandoffSent((provider) => {
      setPendingKeyHandoffProvider(null)
      addToast(`API key for ${provider} has been sent to your Android device`, 'success')
    })
    return () => {
      unsubHandoffRequest()
      unsubHandoffSent()
    }
  }, [addToast, setPendingKeyHandoffProvider])

  useEffect(() => {
    if (!showDefaultModelMenu) setDefaultModelSearch('')
  }, [showDefaultModelMenu])
  useClickOutside(defaultModelMenuRef, () => setShowDefaultModelMenu(false), showDefaultModelMenu)

  const refreshMobileStatus = useCallback(async () => {
    const status = await window.api.wsStatus()
    setMobileEnabled(status.enabled)
    setMobileQr(status.qrDataUrl ?? null)
    setMobileClients(status.connectedClients)
    setMobileLocalIp(status.localIp)
    setMobilePairingUrl(status.pairingUrl ?? null)
  }, [])

  const loadPrompts = useCallback(async () => {
    setPromptsLoading(true)
    try {
      const entries = await window.api.listPrompts(projectId ?? null)
      setPrompts(entries)
      if (selectedPromptId && !entries.some((entry) => entry.id === selectedPromptId)) {
        setSelectedPromptId(null)
        setPromptDraft({ ...EMPTY_PROMPT_DRAFT, project_id: projectId ?? null })
        setPromptTagInput('')
        setPromptVersions([])
      }
    } catch {
      addToast('Failed to load prompt library', 'error')
    } finally {
      setPromptsLoading(false)
    }
  }, [addToast, projectId, selectedPromptId])

  useEffect(() => {
    if (visible && category === 'prompts') void loadPrompts()
  }, [visible, category, loadPrompts])

  const promptsByCategory = useMemo(() => {
    return prompts.reduce<Record<string, PromptLibraryEntry[]>>((groups, prompt) => {
      const categoryName = prompt.category || 'Custom'
      groups[categoryName] = groups[categoryName] ?? []
      groups[categoryName].push(prompt)
      return groups
    }, {})
  }, [prompts])

  const promptVariables = useMemo(
    () => extractPromptVariables(promptDraft.body),
    [promptDraft.body]
  )

  const handleNewPrompt = () => {
    const nextDraft = {
      ...EMPTY_PROMPT_DRAFT,
      scope: projectId ? 'project' as const : 'global' as const,
      project_id: projectId ?? null,
    }
    setSelectedPromptId(null)
    setPromptDraft(nextDraft)
    setPromptTagInput('')
    setPromptVersions([])
  }

  const handleSelectPrompt = (prompt: PromptLibraryEntry) => {
    setSelectedPromptId(prompt.id)
    setPromptDraft({
      title: prompt.title,
      body: prompt.body,
      description: prompt.description,
      category: prompt.category,
      tags: prompt.tags,
      scope: prompt.scope,
      project_id: prompt.project_id,
    })
    setPromptTagInput(tagsToInput(prompt.tags))
    setVersionsLoading(true)
    window.api.listPromptVersions(prompt.id)
      .then(setPromptVersions)
      .catch(() => {
        setPromptVersions([])
        addToast('Failed to load prompt history', 'error')
      })
      .finally(() => setVersionsLoading(false))
  }

  const handleSavePrompt = async () => {
    const tags = inputToTags(promptTagInput)
    const scope = promptDraft.scope === 'project' ? 'project' : 'global'
    const payload: PromptLibraryInput = {
      ...promptDraft,
      title: String(promptDraft.title ?? '').trim(),
      body: String(promptDraft.body ?? ''),
      description: String(promptDraft.description ?? '').trim(),
      category: String(promptDraft.category ?? 'Custom').trim() || 'Custom',
      tags,
      scope,
      project_id: scope === 'project' ? (projectId ?? promptDraft.project_id ?? null) : null,
    }
    if (!payload.title || !payload.body.trim()) {
      addToast('Prompt title and body are required', 'error')
      return
    }
    if (payload.scope === 'project' && !payload.project_id) {
      addToast('Select a project before saving a project prompt', 'error')
      return
    }
    try {
      const saved = selectedPromptId
        ? await window.api.updatePrompt(selectedPromptId, payload)
        : await window.api.createPrompt(payload)
      setSelectedPromptId(saved.id)
      setPromptDraft({
        title: saved.title,
        body: saved.body,
        description: saved.description,
        category: saved.category,
        tags: saved.tags,
        scope: saved.scope,
        project_id: saved.project_id,
      })
      setPromptTagInput(tagsToInput(saved.tags))
      await loadPrompts()
      setPromptVersions(await window.api.listPromptVersions(saved.id).catch(() => []))
      addToast('Prompt saved', 'success')
    } catch {
      addToast('Failed to save prompt', 'error')
    }
  }

  const handleDeletePrompt = async () => {
    if (!selectedPromptId) return
    try {
      await window.api.deletePrompt(selectedPromptId)
      setSelectedPromptId(null)
      setPromptDraft({ ...EMPTY_PROMPT_DRAFT, project_id: projectId ?? null })
      setPromptTagInput('')
      setPromptVersions([])
      await loadPrompts()
      addToast('Prompt deleted', 'success')
    } catch {
      addToast('Failed to delete prompt', 'error')
    }
  }

  const handleRollbackPrompt = async (version: PromptLibraryVersion) => {
    if (!selectedPromptId) return
    try {
      const restored = await window.api.rollbackPrompt(selectedPromptId, version.version)
      setPromptDraft({
        title: restored.title,
        body: restored.body,
        description: restored.description,
        category: restored.category,
        tags: restored.tags,
        scope: restored.scope,
        project_id: restored.project_id,
      })
      setPromptTagInput(tagsToInput(restored.tags))
      await loadPrompts()
      setPromptVersions(await window.api.listPromptVersions(restored.id).catch(() => []))
      addToast(`Rolled back to v${version.version}`, 'success')
    } catch {
      addToast('Failed to roll back prompt', 'error')
    }
  }

  useEffect(() => {
    if (!visible || category !== 'mobile') return
    void refreshMobileStatus()
    void Promise.all([
      window.api.androidGetFcmConfigStatus().then((status) => {
        setFcmStatus(status)
        setFcmVerification({ state: 'unknown' })
      }),
      window.api.androidGetFirebaseClientStatus().then(setAndroidFirebaseStatus),
    ]).catch(() => {})
    void window.api.wsGetAutoStartEnabled().then(setAutoStartEnabled).catch(() => {})
  }, [visible, category, refreshMobileStatus])

  useEffect(() => {
    return window.api.onMobileClientCount((count) => setMobileClients(count))
  }, [])

  const refreshWorkspaceInfo = useCallback(async () => {
    const info = await window.api.buildGetWorkspaceInfo()
    setWorkspaceInfo(info)
    setWorkspacePathInput(info.path)
  }, [])

  useEffect(() => {
    if (!visible || category !== 'developer') return
    void Promise.all([
      window.api.getRuntimeInfo().then(setRuntimeInfo).catch(() => {}),
      refreshWorkspaceInfo(),
      window.api.buildGetRecords(5).then(setBuildRecords).catch(() => {}),
      window.api.buildGetFeedInfo().then((info) => {
        setFeedInfo(info)
        setFeedPathInput(info?.feedPath ?? '')
      }).catch(() => {}),
      window.api.buildListPublished().then(setPublishedEntries).catch(() => {}),
      window.api.androidGetWorkspaceInfo().then((info) => {
        setAndroidWorkspaceInfo(info)
        setAndroidWorkspacePathInput(info.path)
      }).catch(() => {}),
      window.api.androidGetRecords(10).then(setAndroidBuildRecords).catch(() => {}),
      window.api.androidGetSigningConfig().then((config) => {
        if (config) setSigningDraft(config)
      }).catch(() => {}),
      window.api.androidGetUpdateManifest().then(setAndroidUpdateManifest).catch(() => {}),
      window.api.androidGetPublishHistory().then(setAndroidPublishHistory).catch(() => {}),
    ])
  }, [visible, category, refreshWorkspaceInfo])

  useEffect(() => {
    if (!visible) return
    const offChunk = window.api.onBuildLogChunk(({ buildId, line, replace }) => {
      if (buildId === activeBuildId || activeBuildId === null) {
        setBuildLogLines((prev) => {
          const trimmed = prev.slice(-1999)
          if (replace && trimmed.length > 0) return [...trimmed.slice(0, -1), line]
          return [...trimmed, line]
        })
      }
    })
    const offDone = window.api.onBuildCommandDone(({ buildId, status }) => {
      if (buildId === activeBuildId || activeBuildId === null) {
        setActiveBuildId(null)
        setActiveBuildCommand(null)
        setLastBuildStatus(status)
        window.api.buildGetRecords(5).then(setBuildRecords).catch(() => {})
      }
    })
    const offAndroidChunk = window.api.onAndroidLogChunk(({ buildId, line, replace }) => {
      if (buildId === activeAndroidBuildId || activeAndroidBuildId === null) {
        setAndroidLogLines((prev) => {
          const trimmed = prev.slice(-1999)
          if (replace && trimmed.length > 0) return [...trimmed.slice(0, -1), line]
          return [...trimmed, line]
        })
      }
    })
    const offAndroidDone = window.api.onAndroidCommandDone(({ buildId, status }) => {
      if (buildId === activeAndroidBuildId || activeAndroidBuildId === null) {
        setActiveAndroidBuildId(null)
        setActiveAndroidCommand(null)
        setAndroidLastBuildStatus(status)
        window.api.androidGetRecords(10).then(setAndroidBuildRecords).catch(() => {})
      }
    })
    return () => { offChunk(); offDone(); offAndroidChunk(); offAndroidDone() }
  }, [visible, activeBuildId, activeAndroidBuildId])

  // Self-healing guard: a dropped 'command-done' IPC event (e.g. no live window when the
  // build's process closed) would otherwise leave the live Output panel stuck showing
  // "running" forever even though build_records already recorded the terminal status.
  // Reconcile against whatever the most recent record fetch actually says.
  useEffect(() => {
    if (!activeBuildId) return
    const record = buildRecords.find((r) => r.id === activeBuildId)
    if (record && record.status !== 'running') {
      setActiveBuildId(null)
      setActiveBuildCommand(null)
      setLastBuildStatus(record.status)
    }
  }, [buildRecords, activeBuildId])

  useEffect(() => {
    if (!activeAndroidBuildId) return
    const record = androidBuildRecords.find((r) => r.id === activeAndroidBuildId)
    if (record && record.status !== 'running') {
      setActiveAndroidBuildId(null)
      setActiveAndroidCommand(null)
      setAndroidLastBuildStatus(record.status)
    }
  }, [androidBuildRecords, activeAndroidBuildId])

  // Fallback poll while a build looks active: the reconciliation above only fires once new
  // records actually arrive, and the only other fetch is on settings-open. Without this, a
  // dropped 'command-done' event leaves the record fetch — and therefore the reconciliation —
  // never happening at all, so the Output panel stays stuck on "running" indefinitely.
  useEffect(() => {
    if (!visible || (!activeBuildId && !activeAndroidBuildId)) return
    const interval = window.setInterval(() => {
      if (activeBuildId) void window.api.buildGetRecords(5).then(setBuildRecords).catch(() => {})
      if (activeAndroidBuildId) void window.api.androidGetRecords(10).then(setAndroidBuildRecords).catch(() => {})
    }, 5000)
    return () => window.clearInterval(interval)
  }, [visible, activeBuildId, activeAndroidBuildId])

  const handleMobileToggle = async () => {
    setMobileLoading(true)
    try {
      if (mobileEnabled) {
        await window.api.wsStop()
        setMobileEnabled(false)
        setMobileQr(null)
        setMobileClients(0)
      } else {
        const result = await window.api.wsStart()
        setMobileEnabled(true)
        setMobileQr(result.qrDataUrl ?? null)
        setMobilePairingUrl(result.pairingUrl ?? null)
        setMobileClients(0)
        await refreshMobileStatus()
      }
    } catch {
      addToast('Failed to toggle mobile server', 'error')
    } finally {
      setMobileLoading(false)
    }
  }

  const handleRegenerateToken = async () => {
    setMobileLoading(true)
    try {
      const result = await window.api.wsRegenerateToken()
      setMobileQr(result.qrDataUrl ?? null)
      setMobilePairingUrl(result.pairingUrl ?? null)
      addToast('Pairing code regenerated — existing connections closed', 'success')
    } catch {
      addToast('Failed to regenerate pairing code', 'error')
    } finally {
      setMobileLoading(false)
    }
  }

  const handleSaveUrlProfiles = async (profiles: WsUrlProfile[]) => {
    setUrlProfiles(profiles)
    try {
      await window.api.setSetting('ws_url_profiles', JSON.stringify(profiles))
      await refreshMobileStatus()
    } catch {
      addToast('Failed to save connection profiles', 'error')
    }
  }

  const handleSaveWorkspacePath = async (pathOverride?: string) => {
    const target = (pathOverride ?? workspacePathInput).trim()
    if (!target) return
    setWorkspacePathInput(target)
    const info = await window.api.buildSetWorkspacePath(target)
    setWorkspaceInfo(info)
    addToast('Workspace path saved', 'success')
  }

  const handleRunBuildCommand = async (cmd: BuildCommandName) => {
    if (cmd === 'package' && runtimeInfo?.isPackaged === false) {
      addToast('Close the dev app and run npm run package from an external terminal.', 'info')
      return
    }
    setBuildLogLines([])
    setActiveBuildCommand(cmd)
    const { buildId } = await window.api.buildStartCommand(cmd)
    setActiveBuildId(buildId)
  }

  const handleCancelBuild = async () => {
    if (!activeBuildId) return
    await window.api.buildCancelCommand(activeBuildId)
    setActiveBuildId(null)
    setActiveBuildCommand(null)
    window.api.buildGetRecords(5).then(setBuildRecords).catch(() => {})
  }

  const handleRunPreflight = async () => {
    setPreflightRunning(true)
    try {
      const result = await window.api.buildRunPreflight()
      setPreflightChecks(result.checks)
    } catch {
      addToast('Preflight check failed', 'error')
    } finally {
      setPreflightRunning(false)
    }
  }

  const handleLaunchDev = async () => {
    setLaunchDevError(null)
    const result = await window.api.buildLaunchDev()
    if (!result.launched) setLaunchDevError(result.error ?? 'Failed to launch')
  }

  const handleSaveFeedPath = async (pathOverride?: string) => {
    const trimmed = (pathOverride ?? feedPathInput).trim()
    if (!trimmed) return
    setFeedPathInput(trimmed)
    const info = await window.api.buildSetFeedPath(trimmed)
    setFeedInfo(info)
    addToast('Local update feed path saved', 'success')
  }

  const handlePublishUpdate = async () => {
    setPublishing(true)
    setPublishResult(null)
    try {
      const result = await window.api.buildPublishUpdate()
      if (result.published) {
        setPublishResult(`Published v${result.version ?? '?'} to local feed`)
        const [info, entries] = await Promise.all([
          window.api.buildGetFeedInfo(),
          window.api.buildListPublished(),
        ])
        setFeedInfo(info)
        setPublishedEntries(entries)
      } else {
        setPublishResult(result.error ?? 'Publish failed')
      }
    } catch {
      setPublishResult('Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  const handleRollback = async (version: string) => {
    const result = await window.api.buildRollbackUpdate(version)
    if (!result.launched) addToast(result.error ?? 'Failed to launch installer', 'error')
    else addToast(`Launching v${version} installer…`, 'success')
  }

  const handleSaveAndroidWorkspacePath = async (pathOverride?: string) => {
    const trimmed = (pathOverride ?? androidWorkspacePathInput).trim()
    if (!trimmed) return
    setAndroidWorkspacePathInput(trimmed)
    const info = await window.api.androidSetWorkspacePath(trimmed)
    setAndroidWorkspaceInfo(info)
  }

  const handleRefreshAndroidWorkspace = async () => {
    const info = await window.api.androidGetWorkspaceInfo()
    setAndroidWorkspaceInfo(info)
  }

  const handleAndroidStartCommand = async (cmd: AndroidBuildCommandName) => {
    setAndroidLogLines([])
    setActiveAndroidCommand(cmd)
    const result = await window.api.androidStartCommand(cmd)
    if (isApiError(result)) {
      addToast(result.error, 'error')
      setActiveAndroidCommand(null)
      return
    }
    setActiveAndroidBuildId(result.buildId)
    if (cmd === 'assembleRelease' || cmd === 'bundleRelease') {
      window.api.androidGetSigningConfig().then((config) => {
        if (config) setSigningDraft(config)
      }).catch(() => {})
    }
  }

  const handleAndroidCancelCommand = async () => {
    if (!activeAndroidBuildId) return
    await window.api.androidCancelCommand(activeAndroidBuildId)
    setActiveAndroidBuildId(null)
    setActiveAndroidCommand(null)
  }

  const handleSaveSigningConfig = async () => {
    await window.api.androidSetSigningConfig(signingDraft)
    addToast('Signing config saved', 'success')
  }

  const handleValidateSigningConfig = async () => {
    const result = await window.api.androidValidateSigningConfig()
    setSigningValidation(result.checks)
  }

  const handleRefreshAdbDevices = async () => {
    if (adbRefreshing) return
    setAdbRefreshing(true)
    try {
      const devices = await window.api.androidListAdbDevices()
      setAdbDevices(devices)
    } finally {
      setAdbRefreshing(false)
    }
  }

  useEffect(() => {
    if (!visible) return
    void window.api.getHermesProfileDiscovery().then((result) => setHermesProfiles(result.profiles ?? [])).catch(() => setHermesProfiles([]))
  }, [visible])

  const latestAdbInstallRecord = androidBuildRecords
    .filter((r) =>
      (r.command === 'assembleDebug' || r.command === 'assembleRelease') &&
      r.status === 'success' &&
      r.artifactPaths.some((artifactPath) => artifactPath.toLowerCase().endsWith('.apk'))
    )
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))[0]
  const latestAdbInstallApk = latestAdbInstallRecord?.artifactPaths.find((artifactPath) =>
    artifactPath.toLowerCase().endsWith('.apk')
  )

  const handleAndroidInstallApk = async (serial: string) => {
    if (!latestAdbInstallApk || !latestAdbInstallRecord) {
      addToast('No successful debug or release APK build found', 'error')
      return
    }
    setAdbInstalling(true)
    try {
      const result = await window.api.androidInstallApk(serial, latestAdbInstallApk)
      if (result.success) addToast(`${latestAdbInstallRecord.command} installed successfully`, 'success')
      else addToast(result.error ?? 'Install failed', 'error')
    } finally {
      setAdbInstalling(false)
    }
  }

  const handleAndroidPublishUpdate = async () => {
    setAndroidPublishResult(null)
    const result = await window.api.androidPublishUpdate()
    if (result.published) {
      const successMessage = `Published v${result.manifest?.versionName ?? '?'} (build ${result.manifest?.versionCode ?? '?'}) to feed`
      setAndroidPublishResult(result.warning ? `${successMessage}. Warning: ${result.warning}` : successMessage)
      setAndroidUpdateManifest(result.manifest ?? null)
      window.api.androidGetPublishHistory().then(setAndroidPublishHistory).catch(() => {})
    } else {
      setAndroidPublishResult(`Error: ${result.error ?? 'Unknown error'}`)
    }
  }

  const handleAndroidRestoreVersion = async (versionCode: number) => {
    setAndroidRestoring(versionCode)
    try {
      const result = await window.api.androidRestoreVersion(versionCode)
      if (result.restored) {
        setAndroidUpdateManifest(result.manifest ?? null)
        window.api.androidGetPublishHistory().then(setAndroidPublishHistory).catch(() => {})
      } else {
        console.error('Restore failed:', result.error)
      }
    } finally {
      setAndroidRestoring(null)
    }
  }

  const handleAutoStartToggle = async () => {
    const next = !autoStart
    setAutoStart(next)
    try {
      await window.api.setSetting('autoStart', String(next))
      await window.api.setAutoStart(next)
    } catch {
      setAutoStart(!next)
      addToast('Failed to update auto-start setting', 'error')
    }
  }

  const handleAutoClipboardToggle = async () => {
    const next = !autoClipboard
    setAutoClipboard(next)
    try {
      await window.api.setSetting('autoClipboard', String(next))
    } catch {
      setAutoClipboard(!next)
      addToast('Failed to update auto-clipboard setting', 'error')
    }
  }

  const handleRunInBackgroundToggle = async () => {
    const next = !runInBackground
    setRunInBackground(next)
    try {
      await window.api.setSetting('runInBackground', String(next))
    } catch {
      setRunInBackground(!next)
      addToast('Failed to update background execution setting', 'error')
    }
  }

  const handlePickHermesHome = async () => {
    setHermesHomeError(null)
    try {
      const directories = await window.api.openDirectoryDialog()
      const candidate = directories[0]?.trim()
      if (!candidate) return
      const validation = await window.api.validateHermesHome(candidate)
      if (!validation.valid) {
        const message = validation.reason === 'not-directory'
          ? 'Choose a directory.'
          : 'Choose the Hermes root containing a profiles folder (profiles/<name>).'
        setHermesHomeError(message)
        return
      }
      await window.api.setSetting('hermes_home', validation.path)
      setHermesHome(validation.path)
      addToast('Hermes home saved. New Hermes sessions will use it.', 'success')
    } catch {
      setHermesHomeError('Could not save the Hermes home setting.')
    }
  }

  const handleClearHermesHome = async () => {
    try {
      await window.api.setSetting('hermes_home', '')
      setHermesHome('')
      setHermesHomeError(null)
      addToast('Hermes home override cleared.', 'success')
    } catch {
      setHermesHomeError('Could not clear the Hermes home setting.')
    }
  }

  const handleSaveKey = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return
    try {
      if (editingProvider === 'azure' && azureEndpoint.trim()) {
        await window.api.setAzureEndpoint(azureEndpoint.trim())
      }
      await window.api.setProviderKey(editingProvider, apiKeyInput.trim())
      setEditingProvider(null)
      setApiKeyInput('')
      setTestResult(null)
      window.api.listProviders().then(setProviders)
      void refreshAvailableModels()
      addToast('API key saved', 'success')
    } catch {
      addToast('Failed to save API key', 'error')
    }
  }

  const handleTestKey = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return
    setTesting(true)
    const endpoint = editingProvider === 'azure' ? azureEndpoint.trim() : undefined
    const result = await window.api.testProviderKey(editingProvider, apiKeyInput.trim(), endpoint)
    setTestResult(result)
    setTesting(false)
  }

  const handleRemoveKey = async (provider: string) => {
    try {
      await window.api.removeProviderKey(provider)
      window.api.listProviders().then(setProviders)
      void refreshAvailableModels()
      addToast('API key removed', 'success')
    } catch {
      addToast('Failed to remove API key', 'error')
    }
  }

  const handleConfirmKeyHandoff = async (provider: string | null) => {
    if (!provider) return
    try {
      await window.api.confirmProviderKeyHandoff(provider)
      // Success message will be shown via the onProviderKeyHandoffSent listener
    } catch {
      addToast(`Failed to send key to Android device`, 'error')
      setPendingKeyHandoffProvider(null)
    }
  }

  const handleSaveAdvanced = async () => {
    try {
      const safeTemp = Math.min(2, Math.max(0, temperature))
      const safeMaxTokens = Math.min(16384, Math.max(256, maxTokens))
      await window.api.setSetting('default_model', defaultModel)
      const isHermesModel = availableModelGroups.some((group) => group.sourceKey === 'hermes-cli' && group.models.some((model) => model.id === defaultModel))
      await window.api.setSetting('global_default_hermes_profile', isHermesModel ? globalHermesProfile.trim() : '')
      await window.api.setSetting('temperature', String(safeTemp))
      await window.api.setSetting('max_tokens', String(safeMaxTokens))
      setGlobalDefaultModel(defaultModel)
      addToast('Advanced settings saved', 'success')
    } catch {
      addToast('Failed to save advanced settings', 'error')
    }
  }

  const handleSaveWhisper = async () => {
    try {
      await window.api.setSetting('whisper_cpp_path', whisperCppPath.trim())
      await window.api.setSetting('whisper_model_path', whisperModelPath.trim())
      const status = await window.api.getVoiceStatus()
      const statusError = (status as { error?: string }).error
      const ready = !statusError && status.ready
      setWhisperReady(Boolean(ready))
      addToast(statusError || (ready ? 'Local voice input configured' : 'Paths saved, but one or both files were not found'), ready ? 'success' : 'error')
    } catch {
      addToast('Failed to save voice settings', 'error')
    }
  }

  const handleInstallWhisper = async () => {
    setWhisperInstalling(true)
    try {
      const result = await window.api.installLocalVoice()
      if ('error' in result) {
        addToast(String(result.error), 'error')
        return
      }
      setWhisperCppPath(result.executablePath)
      setWhisperModelPath(result.modelPath)
      setWhisperReady(true)
      addToast('Local Whisper installed and ready', 'success')
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Local Whisper installation failed', 'error')
    } finally {
      setWhisperInstalling(false)
    }
  }

  // suppress unused variable warning — activeAgent is computed for potential future use
  void activeAgent

  if (!visible) return null

  return (
    <ModalShell
      title="Settings"
      ariaLabel="Settings"
      maxWidth="max-w-5xl"
      bodyClassName="flex flex-1 overflow-hidden"
      onClose={onClose}
    >
      {/* Left navigation */}
      <nav className="w-44 shrink-0 border-r-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 py-2 flex flex-col gap-0.5 px-2" aria-label="Settings navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setCategory(item.id)}
            className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-none border text-xs font-medium transition-colors ${
              category === item.id
                ? 'border-nexy-accent bg-nexy-accent/10 text-nexy-accent shadow-nexy'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            aria-current={category === item.id ? 'page' : undefined}
          >
            <NexyIcon name={item.icon} size={14} />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Right content */}
      <div className="nexy-settings-shell flex-1 overflow-y-auto p-5 space-y-4">
        {category === 'general' && (
          <GeneralTab
            theme={theme}
            toggleTheme={toggleTheme}
            uiStyle={uiStyle}
            onSetUiStyle={setUiStyle}
            effectiveModel={effectiveModel}
            effectiveProvider={effectiveProvider}
            autoStart={autoStart}
            runInBackground={runInBackground}
            autoClipboard={autoClipboard}
            defaultModel={defaultModel}
            globalHermesProfile={globalHermesProfile}
            hermesProfiles={hermesProfiles}
            defaultModelSearch={defaultModelSearch}
            showDefaultModelMenu={showDefaultModelMenu}
            defaultModelMenuRect={defaultModelMenuRect}
            availableModelGroups={availableModelGroups}
            modelIds={modelIds}
            temperature={temperature}
            maxTokens={maxTokens}
            catalogModels={catalogModels}
            onToggleAutoStart={() => void handleAutoStartToggle()}
            onToggleRunInBackground={() => void handleRunInBackgroundToggle()}
            onToggleAutoClipboard={() => void handleAutoClipboardToggle()}
            onSetDefaultModel={setDefaultModel}
            onSetGlobalHermesProfile={setGlobalHermesProfile}
            onSetDefaultModelSearch={setDefaultModelSearch}
            onSetShowDefaultModelMenu={setShowDefaultModelMenu}
            onSetDefaultModelMenuRect={setDefaultModelMenuRect}
            onSetTemperature={setTemperature}
            onSetMaxTokens={setMaxTokens}
            onSaveAdvanced={() => void handleSaveAdvanced()}
            onOpenMcp={onOpenMcp}
            defaultModelMenuRef={defaultModelMenuRef}
            defaultModelButtonRef={defaultModelButtonRef}
          />
        )}

        {category === 'voice' && (
          <VoiceAudioTab
            whisperCppPath={whisperCppPath}
            whisperModelPath={whisperModelPath}
            whisperInstalling={whisperInstalling}
            whisperReady={whisperReady}
            onSetWhisperCppPath={setWhisperCppPath}
            onSetWhisperModelPath={setWhisperModelPath}
            onSaveWhisper={() => void handleSaveWhisper()}
            onInstallWhisper={() => void handleInstallWhisper()}
          />
        )}

        {category === 'providers' && (
          <ProvidersTab
            authMode={authMode}
            providers={providers}
            editingProvider={editingProvider}
            apiKeyInput={apiKeyInput}
            azureEndpoint={azureEndpoint}
            testResult={testResult}
            testing={testing}
            onSetEditingProvider={setEditingProvider}
            onSetApiKeyInput={setApiKeyInput}
            onSetAzureEndpoint={setAzureEndpoint}
            onSetTestResult={setTestResult}
            onSaveKey={() => void handleSaveKey()}
            onTestKey={() => void handleTestKey()}
            onRemoveKey={(p) => void handleRemoveKey(p)}
            pendingKeyHandoffProvider={pendingKeyHandoffProvider}
            onRequestKeyHandoff={setPendingKeyHandoffProvider}
            onConfirmKeyHandoff={handleConfirmKeyHandoff}
          />
        )}

        {category === 'credentials' && <CredentialsTab />}

        {category === 'cli' && (
          <CliTab
            installedClis={installedClis}
            cliRefreshing={cliRefreshing}
            hermesHome={hermesHome}
            hermesHomeError={hermesHomeError}
            onPickHermesHome={handlePickHermesHome}
            onClearHermesHome={handleClearHermesHome}
            onRefresh={async () => {
              setCliRefreshing(true)
              await checkAuth()
              setCliRefreshing(false)
              addToast('CLI status refreshed', 'success')
            }}
          />
        )}

        {category === 'prompts' && (
          <PromptsTab
            prompts={prompts}
            promptsLoading={promptsLoading}
            selectedPromptId={selectedPromptId}
            promptDraft={promptDraft}
            promptTagInput={promptTagInput}
            promptVersions={promptVersions}
            versionsLoading={versionsLoading}
            promptsByCategory={promptsByCategory}
            promptVariables={promptVariables}
            projectId={projectId}
            activeProject={activeProject}
            onSetPromptDraft={(updater) => setPromptDraft((d) => updater(d))}
            onSetPromptTagInput={setPromptTagInput}
            onNewPrompt={handleNewPrompt}
            onSelectPrompt={handleSelectPrompt}
            onSavePrompt={() => void handleSavePrompt()}
            onDeletePrompt={() => void handleDeletePrompt()}
            onRollbackPrompt={handleRollbackPrompt}
          />
        )}

        {category === 'mobile' && (
          <MobileTab
            mobileEnabled={mobileEnabled}
            mobileQr={mobileQr}
            mobileClients={mobileClients}
            mobileLoading={mobileLoading}
            mobileLocalIp={mobileLocalIp}
            mobilePairingUrl={mobilePairingUrl}
            urlProfiles={urlProfiles}
            onSaveProfiles={(profiles) => void handleSaveUrlProfiles(profiles)}
            onToggle={() => void handleMobileToggle()}
            onRegenerateToken={() => void handleRegenerateToken()}
            onRefreshStatus={() => void refreshMobileStatus()}
            fcmStatus={fcmStatus}
            fcmVerification={fcmVerification}
            fcmJsonDraft={fcmJsonDraft}
            fcmSaving={fcmSaving}
            onVerifyFcmConfig={() => {
              setFcmVerification({ state: 'checking' })
              setFcmError(null)
              void window.api.androidVerifyFcmConfig()
                .then((result) => {
                  setFcmVerification({ state: result.authenticated ? 'verified' : 'failed', error: result.error })
                  if (!result.authenticated && result.error) setFcmError(result.error)
                })
                .catch((err: unknown) => {
                  const message = err instanceof Error ? err.message : 'Unable to verify Firebase configuration'
                  setFcmVerification({ state: 'failed', error: message })
                  setFcmError(message)
                })
            }}
            onSetFcmJsonDraft={setFcmJsonDraft}
            fcmError={fcmError}
            androidFirebaseStatus={androidFirebaseStatus}
            androidFirebaseImporting={androidFirebaseImporting}
            androidFirebaseError={androidFirebaseError}
            onImportAndroidFirebaseClient={() => {
              setAndroidFirebaseImporting(true)
              setAndroidFirebaseError(null)
              void window.api.androidImportFirebaseClient()
                .then((result) => {
                  if (result.saved && result.status) {
                    setAndroidFirebaseStatus(result.status)
                  } else if (!result.canceled) {
                    setAndroidFirebaseError(result.error ?? 'Unable to import google-services.json')
                  }
                })
                .catch((err: unknown) => {
                  setAndroidFirebaseError(err instanceof Error ? err.message : 'Unable to import google-services.json')
                })
                .finally(() => setAndroidFirebaseImporting(false))
            }}
            onSaveFcmServiceAccount={() => {
              setFcmSaving(true)
              setFcmError(null)
              void window.api.androidSaveFcmServiceAccount(fcmJsonDraft)
                .then((result) => {
                  if (result.saved) {
                    void window.api.androidGetFcmConfigStatus().then((status) => {
                      setFcmStatus(status)
                      setFcmVerification({ state: 'unknown' })
                    })
                    setFcmJsonDraft('')
                  } else {
                    setFcmError(result.error ?? 'Failed to save configuration')
                  }
                })
                .catch((err: unknown) => {
                  setFcmError(err instanceof Error ? err.message : 'Failed to save configuration')
                })
                .finally(() => setFcmSaving(false))
            }}
            autoStartEnabled={autoStartEnabled}
            onToggleAutoStart={() => {
              const next = !autoStartEnabled
              void window.api.wsSetAutoStartEnabled(next)
                .then((result) => {
                  if (typeof result === 'boolean') {
                    setAutoStartEnabled(result)
                  } else {
                    addToast('Failed to update mobile auto-start setting', 'error')
                  }
                })
                .catch(() => addToast('Failed to update mobile auto-start setting', 'error'))
            }}
            androidDebugLog={androidDebugLog}
            onToggleAndroidDebugLog={() => setAndroidDebugLog(!androidDebugLog)}
          />
        )}

        {category === 'developer' && (
          <DeveloperTab
            workspaceInfo={workspaceInfo}
            workspacePathInput={workspacePathInput}
            onSetWorkspacePathInput={setWorkspacePathInput}
            onRefreshWorkspace={() => void refreshWorkspaceInfo()}
            onSaveWorkspacePath={(p?: string) => void handleSaveWorkspacePath(p)}
            buildRecords={buildRecords}
            activeBuildId={activeBuildId}
            activeBuildCommand={activeBuildCommand}
            buildLogLines={buildLogLines}
            lastBuildStatus={lastBuildStatus}
            onRunBuildCommand={(cmd) => void handleRunBuildCommand(cmd)}
            onCancelBuild={() => void handleCancelBuild()}
            preflightChecks={preflightChecks}
            preflightRunning={preflightRunning}
            onRunPreflight={() => void handleRunPreflight()}
            feedInfo={feedInfo}
            feedPathInput={feedPathInput}
            publishedEntries={publishedEntries}
            publishing={publishing}
            publishResult={publishResult}
            onSetFeedPathInput={setFeedPathInput}
            onSaveFeedPath={(p?: string) => void handleSaveFeedPath(p)}
            onPublishUpdate={() => void handlePublishUpdate()}
            onRollback={(v) => void handleRollback(v)}
            launchDevError={launchDevError}
            onLaunchDev={() => void handleLaunchDev()}
            androidWorkspaceInfo={androidWorkspaceInfo}
            androidWorkspacePathInput={androidWorkspacePathInput}
            onSetAndroidWorkspacePathInput={setAndroidWorkspacePathInput}
            onSaveAndroidWorkspacePath={(p?: string) => void handleSaveAndroidWorkspacePath(p)}
            onRefreshAndroidWorkspace={() => void handleRefreshAndroidWorkspace()}
            androidBuildRecords={androidBuildRecords}
            activeAndroidBuildId={activeAndroidBuildId}
            activeAndroidCommand={activeAndroidCommand}
            androidLogLines={androidLogLines}
            androidLastBuildStatus={androidLastBuildStatus}
            onAndroidStartCommand={(cmd) => void handleAndroidStartCommand(cmd)}
            onAndroidCancelCommand={() => void handleAndroidCancelCommand()}
            signingDraft={signingDraft}
            signingValidation={signingValidation}
            onSetSigningDraft={setSigningDraft}
            onSaveSigningConfig={() => void handleSaveSigningConfig()}
            onValidateSigningConfig={() => void handleValidateSigningConfig()}
            adbDevices={adbDevices}
            adbRefreshing={adbRefreshing}
            adbInstalling={adbInstalling}
            latestAdbInstallRecord={latestAdbInstallRecord}
            latestAdbInstallApk={latestAdbInstallApk}
            onRefreshAdbDevices={() => void handleRefreshAdbDevices()}
            onAndroidInstallApk={(serial) => void handleAndroidInstallApk(serial)}
            androidPublishResult={androidPublishResult}
            androidUpdateManifest={androidUpdateManifest}
            androidPublishHistory={androidPublishHistory}
            androidRestoring={androidRestoring}
            onAndroidPublishUpdate={() => void handleAndroidPublishUpdate()}
            onAndroidRestoreVersion={(vc) => void handleAndroidRestoreVersion(vc)}
            debugLogging={debugLogging}
            onToggleDebugLogging={() => setDebugLogging(!debugLogging)}
            desktopPackagingBlocked={runtimeInfo?.isPackaged === false}
            initialDeveloperTab={developerInitialSubTab}
            initialErrorLogId={developerInitialErrorId}
          />
        )}
      </div>
    </ModalShell>
  )
}
