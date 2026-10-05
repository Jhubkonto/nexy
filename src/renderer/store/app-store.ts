import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  createAgentSlice,
  type AgentSlice
} from './slices/agentSlice'
import {
  createAuthSlice,
  type AuthSlice
} from './slices/authSlice'
import {
  createBackgroundActivitySlice,
  type BackgroundActivitySlice
} from './slices/backgroundActivitySlice'
import {
  createConversationSlice,
  type ConversationSlice
} from './slices/conversationSlice'
import {
  createProjectSlice,
  type ProjectSlice
} from './slices/projectSlice'
import {
  createSkillSlice,
  type SkillSlice
} from './slices/skillSlice'
import {
  createUiSlice,
  type UiSlice
} from './slices/uiSlice'
import {
  createSchedulerSlice,
  type SchedulerSlice
} from './slices/schedulerSlice'
import { isApiError } from '../../shared/types'

export type {
  ActiveSectionPane,
  AuthState,
  BackgroundActivity,
  BackgroundActivityKind,
  Conversation,
  DeleteAgentImpact,
  Milestone,
  Project,
  ProjectAgent,
  ProjectConfig,
  ProjectOrchestrationConfig,
  ProjectSettingsTab,
  ProjectVariable,
  ScopeRule,
  SkillConfig,
  Theme,
  UiStyle,
  MarkdownViewMode,
  ComposerMarkdownViewMode,
  Toast,
  ToolApprovalRequest
} from './types'
export { DEFAULT_PROJECT_CONFIG } from './types'

export type AppState =
  & AuthSlice
  & BackgroundActivitySlice
  & ConversationSlice
  & ProjectSlice
  & SkillSlice
  & AgentSlice
  & SchedulerSlice
  & UiSlice
  & {
    hydrate: () => Promise<void>
  }

export const useAppStore = create<AppState>()(
  immer((set, get, store) => ({
    ...createAuthSlice(set, get, store),
    ...createBackgroundActivitySlice(set, get, store),
    ...createConversationSlice(set, get, store),
    ...createProjectSlice(set, get, store),
    ...createSkillSlice(set, get, store),
    ...createAgentSlice(set, get, store),
    ...createSchedulerSlice(set, get, store),
    ...createUiSlice(set, get, store),

    hydrate: async () => {
      try {
        const [savedTheme, savedUiStyle, savedMarkdownViewMode, savedComposerMarkdownViewMode] = await Promise.all([
          window.api.getTheme(),
          window.api.getSetting('ui_style').catch(() => null),
          window.api.getSetting('markdown_view_mode').catch(() => null),
          window.api.getSetting('composer_markdown_view_mode').catch(() => null),
        ])
        const t = savedTheme === 'light' ? 'light' : 'dark'
        get().setTheme(t)
        get().setUiStyle(savedUiStyle === '8bit' ? '8bit' : 'classic', false)
        get().setMarkdownViewMode(savedMarkdownViewMode === 'raw' ? 'raw' : 'rendered')
        get().setComposerMarkdownViewMode(savedComposerMarkdownViewMode === 'rendered' ? 'rendered' : 'raw')
      } catch {
        get().setUiStyle('classic', false)
      }

      const [, onboardingVal] = await Promise.all([
        get().checkAuth(),
        window.api.getSetting('onboarding_complete').catch(() => null),
      ])

      if (onboardingVal !== 'true') {
        const { cliInstalled, authenticated } = get().authState
        if (cliInstalled || authenticated) {
          // Provider already available — silently mark onboarding complete
          try {
            await window.api.setSetting('onboarding_complete', 'true')
          } catch {
            // Persistence failed; don't block the user
          }
        } else {
          // Nothing configured — guide the user through setup
          set((s) => { s.showOnboarding = true })
        }
      }

      await Promise.all([
        get().loadConversations(),
        get().loadAgents(),
        get().loadProjects(),
        get().loadSkills(),
        get().refreshAvailableModels(),
        window.api.schedulerList().then((result) => {
          if (!isApiError(result)) get().setSchedulerTasks(result)
        }).catch(() => {}),
        window.api
          .listModelCatalog()
          .then((models) => {
            if (models.length > 0) {
              set((s) => {
                s.catalogModels = models
              })
            }
          })
          .catch(() => {}),
        window.api
          .getSetting('default_model')
          .then((val) => {
            if (typeof val === 'string' && val) {
              get().setGlobalDefaultModel(val)
            }
          })
          .catch(() => {}),
        window.api
          .getSetting('debug_logging')
          .then((val) => {
            set((s) => {
              s.debugLogging = val === 'true'
            })
          })
          .catch(() => {}),
        window.api
          .getSetting('android_debug_log')
          .then((val) => {
            set((s) => {
              s.androidDebugLog = val === 'true'
            })
          })
          .catch(() => {})
      ])
    }
  }))
)
