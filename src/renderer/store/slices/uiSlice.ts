import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import type {
  ActiveSectionPane,
  BuildNotification,
  SectionBadgeKey,
  Theme,
  UiStyle,
  MarkdownViewMode,
  ComposerMarkdownViewMode,
  Toast,
  ToolApprovalRequest
} from '../types'
import type { AvailableModelGroup, CatalogModel } from '../../../shared/types'

export interface UiSlice {
  theme: Theme
  uiStyle: UiStyle
  showSidebar: boolean
  showMcpPanel: boolean
  showSettings: boolean
  showActivityFeed: boolean
  showOnboarding: boolean
  pendingArtifactGeneration: { title: string; kind: string; startedAt: number } | null
  pendingArtifactAttach: { artifactId: string; versionId?: string } | null
  /** Text to drop into the composer of whichever conversation mounts next — used by entry
   * points outside the chat window (e.g. the project row's code-change button) that want to
   * prefill a slash command in a freshly-opened chat rather than sending anything themselves. */
  pendingComposerPrefill: string | null
  setPendingComposerPrefill: (text: string | null) => void
  updateAvailable: { version: string } | null
  updateDownloaded: boolean
  activeSectionPane: ActiveSectionPane
  toasts: Toast[]
  toolApprovalRequests: ToolApprovalRequest[]
  unreadConversationIds: string[]
  syncedUnreadConversationIds: string[]
  generatingConversationIds: string[]
  generatingStartTimes: Record<string, number>
  pendingConversationIds: string[]
  catalogModels: CatalogModel[]
  availableModelGroups: AvailableModelGroup[]
  availableModelsLoaded: boolean
  globalDefaultModel: string
  debugLogging: boolean
  androidDebugLog: boolean
  markdownViewMode: MarkdownViewMode
  composerMarkdownViewMode: ComposerMarkdownViewMode
  setTheme: (theme: Theme) => void
  setUiStyle: (style: UiStyle, persist?: boolean) => void
  setDebugLogging: (enabled: boolean) => void
  setAndroidDebugLog: (enabled: boolean) => void
  setMarkdownViewMode: (mode: MarkdownViewMode) => void
  setComposerMarkdownViewMode: (mode: ComposerMarkdownViewMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleAgentPanel: () => void
  setShowMcpPanel: (show: boolean) => void
  setShowSettings: (show: boolean) => void
  setShowActivityFeed: (show: boolean) => void
  setPendingArtifactGeneration: (v: { title: string; kind: string; startedAt: number } | null) => void
  requestArtifactAttach: (artifactId: string, versionId?: string) => void
  clearPendingArtifactAttach: () => void
  settingsInitialTab: string | null
  setSettingsInitialTab: (tab: string | null) => void
  setShowOnboarding: (show: boolean) => void
  setUpdateAvailable: (info: { version: string } | null) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setSectionPane: (section: ActiveSectionPane) => void
  openSectionPane: (section: Exclude<ActiveSectionPane, null>) => void
  addToast: (message: string, type?: Toast['type'], action?: Toast['action']) => void
  dismissToast: (id: string) => void
  setCatalogModels: (models: CatalogModel[]) => void
  refreshAvailableModels: () => Promise<void>
  setGlobalDefaultModel: (model: string) => void
  addToolApprovalRequest: (request: ToolApprovalRequest) => void
  removeToolApprovalRequest: (requestId: string) => void
  respondToToolApproval: (
    requestId: string,
    approved: boolean,
    remember: boolean
  ) => Promise<void>
  markConversationUnread: (id: string) => void
  markConversationRead: (id: string) => void
  syncUnreadConversationIds: (ids: string[]) => void
  markConversationGenerating: (id: string) => void
  markConversationDoneGenerating: (id: string) => void
  markConversationPending: (id: string) => void
  clearConversationPending: (id: string) => void
  viewingArtifactId: string | null
  openArtifactPanel: (id: string) => void
  closeArtifactPanel: () => void
  pendingKeyHandoffProvider: string | null
  setPendingKeyHandoffProvider: (provider: string | null) => void
  /** Counts of newly-generated items per sidebar section, cleared when the user opens that section. */
  sectionNewCounts: Record<SectionBadgeKey, number>
  incrementSectionNewCount: (key: SectionBadgeKey) => void
  clearSectionNewCount: (key: SectionBadgeKey) => void
  /** Finished builds, surfaced as a top-bar notification (the one exception to "notify next to the sidebar section"). */
  buildNotifications: BuildNotification[]
  addBuildNotification: (notification: BuildNotification) => void
  clearBuildNotifications: () => void
}

export const createUiSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  UiSlice
> = (set, get) => ({
  theme: 'dark',
  uiStyle: 'classic',
  showSidebar: true,
  showMcpPanel: false,
  showSettings: false,
  showActivityFeed: false,
  settingsInitialTab: null,
  showOnboarding: false,
  pendingArtifactGeneration: null,
  pendingArtifactAttach: null,
  pendingComposerPrefill: null,
  updateAvailable: null,
  updateDownloaded: false,
  activeSectionPane: null,
  toasts: [],
  toolApprovalRequests: [],
  unreadConversationIds: [],
  syncedUnreadConversationIds: [],
  generatingConversationIds: [],
  generatingStartTimes: {},
  pendingConversationIds: [],
  catalogModels: [],
  availableModelGroups: [],
  availableModelsLoaded: false,
  globalDefaultModel: 'default',
  debugLogging: false,
  androidDebugLog: false,
  markdownViewMode: 'rendered',
  composerMarkdownViewMode: 'raw',
  viewingArtifactId: null,
  pendingKeyHandoffProvider: null,
  sectionNewCounts: { projects: 0, agents: 0, skills: 0, scheduled: 0, workflows: 0 },
  buildNotifications: [],

  openArtifactPanel: (id) => {
    set((s) => {
      s.viewingArtifactId = id
    })
  },

  closeArtifactPanel: () => {
    set((s) => {
      s.viewingArtifactId = null
    })
  },

  setPendingKeyHandoffProvider: (provider) => {
    set((s) => {
      s.pendingKeyHandoffProvider = provider
    })
  },

  setTheme: (theme) => {
    set((s) => {
      s.theme = theme
    })
    document.documentElement.classList.toggle('dark', theme === 'dark')
  },

  setDebugLogging: (enabled) => {
    set((s) => {
      s.debugLogging = enabled
    })
    void window.api.setSetting('debug_logging', String(enabled)).catch(() => {})
    void window.api.setDebugEnabled(enabled).catch(() => {})
  },

  setAndroidDebugLog: (enabled) => {
    set((s) => {
      s.androidDebugLog = enabled
    })
    void window.api.setSetting('android_debug_log', String(enabled)).catch(() => {})
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
    window.api.setTheme(next)
  },

  toggleSidebar: () => {
    set((s) => {
      s.showSidebar = !s.showSidebar
    })
  },

  toggleAgentPanel: () => {
    set((s) => {
      s.showAgentPanel = !s.showAgentPanel
    })
  },

  setShowMcpPanel: (show) => {
    set((s) => {
      s.showMcpPanel = show
    })
  },

  setShowSettings: (show) => {
    set((s) => {
      s.showSettings = show
    })
  },

  setShowActivityFeed: (show) => {
    set((s) => {
      s.showActivityFeed = show
    })
  },

  setPendingArtifactGeneration: (v) => {
    set((s) => {
      s.pendingArtifactGeneration = v
    })
  },

  requestArtifactAttach: (artifactId, versionId) => {
    set((s) => {
      s.pendingArtifactAttach = { artifactId, versionId }
    })
  },

  clearPendingArtifactAttach: () => {
    set((s) => {
      s.pendingArtifactAttach = null
    })
  },

  setPendingComposerPrefill: (text) => {
    set((s) => {
      s.pendingComposerPrefill = text
    })
  },

  setSettingsInitialTab: (tab) => {
    set((s) => {
      s.settingsInitialTab = tab
    })
  },

  setShowOnboarding: (show) => {
    set((s) => {
      s.showOnboarding = show
    })
  },

  setUpdateAvailable: (info) => {
    set((s) => {
      s.updateAvailable = info
    })
  },

  setUpdateDownloaded: (downloaded) => {
    set((s) => {
      s.updateDownloaded = downloaded
    })
  },

  setSectionPane: (section) => {
    set((s) => {
      s.activeSectionPane = s.activeSectionPane === section ? null : section
    })
  },

  openSectionPane: (section) => {
    set((s) => {
      s.activeSectionPane = section
    })
  },

  addToast: (message, type = 'info', action) => {
    const id = crypto.randomUUID()
    set((s) => {
      s.toasts.push({ id, message, type, action })
    })
  },

  dismissToast: (id) => {
    set((s) => {
      s.toasts = s.toasts.filter((t) => t.id !== id)
    })
  },

  setCatalogModels: (models) => {
    set((s) => {
      s.catalogModels = models
    })
  },

  refreshAvailableModels: async () => {
    try {
      const groups = await window.api.listAvailableModels()
      set((s) => {
        s.availableModelGroups = groups
        s.availableModelsLoaded = true
      })
    } catch { /* leave existing value */ }
  },

  setGlobalDefaultModel: (model) => {
    set((s) => {
      s.globalDefaultModel = model
    })
  },

  addToolApprovalRequest: (request) => {
    set((s) => {
      s.toolApprovalRequests.push(request)
    })
  },

  removeToolApprovalRequest: (requestId) => {
    set((s) => {
      s.toolApprovalRequests = s.toolApprovalRequests.filter((r) => r.requestId !== requestId)
    })
  },

  respondToToolApproval: async (requestId, approved, remember) => {
    try {
      await window.api.respondToToolApproval(requestId, approved, remember)
      set((s) => {
        s.toolApprovalRequests = s.toolApprovalRequests.filter(
          (r) => r.requestId !== requestId
        )
      })
    } catch {
      get().addToast('Failed to respond to tool approval', 'error')
    }
  },

  markConversationUnread: (id) => {
    set((s) => {
      if (!s.unreadConversationIds.includes(id)) {
        s.unreadConversationIds.push(id)
      }
    })
  },

  markConversationRead: (id) => {
    set((s) => {
      // Guard mirrors markConversationUnread above — without it this reassigns a brand-new
      // array (even when `id` was never present) on every call. ChatWindow's scroll handler
      // calls this on every scroll event while within SCROLL_BOTTOM_THRESHOLD of the bottom,
      // not just once on crossing it, and ChatsPane subscribes to this array by reference
      // (`useAppStore((s) => s.unreadConversationIds)`) — so a no-op new-reference array was
      // re-rendering the entire sidebar conversation list on every scroll tick for the whole
      // final stretch of scrolling to the bottom, which is exactly the "lag right before
      // reaching the bottom" reported in every chat window with enough content to scroll.
      if (s.unreadConversationIds.includes(id)) {
        s.unreadConversationIds = s.unreadConversationIds.filter((cid) => cid !== id)
      }
      if (s.syncedUnreadConversationIds.includes(id)) {
        s.syncedUnreadConversationIds = s.syncedUnreadConversationIds.filter((cid) => cid !== id)
      }
    })
  },

  setUiStyle: (style, persist = true) => {
    set((s) => {
      s.uiStyle = style
    })
    document.documentElement.dataset.uiStyle = style
    if (persist) {
      void window.api.setSetting('ui_style', style).catch(() => {})
    }
  },

  setMarkdownViewMode: (mode) => {
    set((s) => {
      s.markdownViewMode = mode
    })
    void window.api.setSetting('markdown_view_mode', mode).catch(() => {})
  },

  setComposerMarkdownViewMode: (mode) => {
    set((s) => {
      s.composerMarkdownViewMode = mode
    })
    void window.api.setSetting('composer_markdown_view_mode', mode).catch(() => {})
  },

  syncUnreadConversationIds: (ids) => {
    set((s) => {
      // Keep renderer-only unread state (new content below the user's scroll position)
      // while reconciling the persisted main-process snapshot for background chats.
      const localOnly = s.unreadConversationIds.filter(
        (id) => !s.syncedUnreadConversationIds.includes(id),
      )
      const nextSynced = [...new Set(ids)]
      s.syncedUnreadConversationIds = nextSynced
      s.unreadConversationIds = [...new Set([...localOnly, ...nextSynced])]
    })
  },

  markConversationGenerating: (id) => {
    set((s) => {
      if (!s.generatingConversationIds.includes(id)) {
        s.generatingConversationIds.push(id)
        s.generatingStartTimes[id] = Date.now()
      }
    })
  },

  markConversationDoneGenerating: (id) => {
    set((s) => {
      // Membership guard mirrors markConversationRead: reassigning a new array for an id
      // that isn't present re-renders every by-reference subscriber for nothing.
      if (s.generatingConversationIds.includes(id)) {
        s.generatingConversationIds = s.generatingConversationIds.filter((cid) => cid !== id)
      }
      delete s.generatingStartTimes[id]
    })
  },

  markConversationPending: (id) => {
    set((s) => {
      if (!s.pendingConversationIds.includes(id)) {
        s.pendingConversationIds.push(id)
      }
    })
  },

  clearConversationPending: (id) => {
    set((s) => {
      if (s.pendingConversationIds.includes(id)) {
        s.pendingConversationIds = s.pendingConversationIds.filter((cid) => cid !== id)
      }
    })
  },

  incrementSectionNewCount: (key) => {
    set((s) => {
      s.sectionNewCounts[key] += 1
    })
  },

  clearSectionNewCount: (key) => {
    set((s) => {
      if (s.sectionNewCounts[key] !== 0) {
        s.sectionNewCounts[key] = 0
      }
    })
  },

  addBuildNotification: (notification) => {
    set((s) => {
      s.buildNotifications.push(notification)
    })
  },

  clearBuildNotifications: () => {
    set((s) => {
      if (s.buildNotifications.length !== 0) {
        s.buildNotifications = []
      }
    })
  },
})
