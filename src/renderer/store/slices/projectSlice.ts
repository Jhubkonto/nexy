import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import { isApiError } from '../../../shared/types'
import {
  DEFAULT_PROJECT_CONFIG,
  type Project,
  type ProjectAgent,
  type ProjectConfig,
  type ProjectOrchestrationConfig,
  type ProjectSettingsTab
} from '../types'

export interface ProjectSlice {
  projects: Project[]
  activeProjectId: string | null
  historyProjectId: string | null
  pendingSettingsProjectId: string | null
  projectSettingsInitialTab: ProjectSettingsTab | null
  showNewProjectForm: boolean
  showProjectGenerator: boolean
  setShowProjectGenerator: (show: boolean) => void
  editingProjectId: string | null
  newlyCreatedProjectId: string | null
  projectsLoading: boolean
  projectAgents: Record<string, ProjectAgent[]>
  projectConfigs: Record<string, ProjectConfig>
  loadProjects: () => Promise<void>
  selectProject: (id: string | null) => void
  setActiveProjectId: (id: string | null) => void
  setHistoryProjectId: (id: string | null) => void
  createProject: (name: string, color: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  updateProjectColor: (id: string, name: string, color: string) => Promise<void>
  deleteProject: (id: string, deleteChats?: boolean) => Promise<void>
  setConversationProject: (
    conversationId: string,
    projectId: string | null
  ) => Promise<void>
  setProjectDefaultModel: (id: string, model: string | null, hermesProfile?: string | null) => Promise<void>
  clearPendingSettingsProject: () => void
  setShowNewProjectForm: (show: boolean) => void
  openEditProject: (id: string, initialTab?: ProjectSettingsTab) => void
  closeEditProject: () => void
  clearProjectSettingsInitialTab: () => void
  duplicateProject: (id: string) => Promise<void>
  exportProject: (id: string) => Promise<void>
  loadProjectAgents: (projectId: string) => Promise<void>
  addAgentToProject: (projectId: string, agentId: string) => Promise<void>
  removeAgentFromProject: (projectId: string, agentId: string) => Promise<void>
  setProjectPrimaryAgent: (projectId: string, agentId: string) => Promise<void>
  reorderProjectAgents: (projectId: string, orderedAgentIds: string[]) => Promise<void>
  updateProjectOrchestration: (
    projectId: string,
    config: Partial<Pick<ProjectOrchestrationConfig, 'workflowMode' | 'orchestrationEnabled' | 'maxDelegationDepth' | 'showTeamActivity'>>
  ) => Promise<void>
  updateProjectConfig: (
    projectId: string,
    config: Partial<ProjectConfig>
  ) => Promise<void>
  loadProjectConfig: (projectId: string) => Promise<void>
  clearNewlyCreatedProjectId: () => void
}

export const createProjectSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  ProjectSlice
> = (set, get) => ({
  projects: [],
  activeProjectId: null,
  historyProjectId: null,
  pendingSettingsProjectId: null,
  projectSettingsInitialTab: null,
  showNewProjectForm: false,
  showProjectGenerator: false,
  editingProjectId: null,
  newlyCreatedProjectId: null,
  projectsLoading: false,
  projectAgents: {},
  projectConfigs: {},
  loadProjects: async () => {
    set((s) => {
      s.projectsLoading = true
    })
    try {
      const result = await window.api.listProjects()
      if (isApiError(result)) {
        get().addToast('Failed to load projects', 'error')
      } else {
        set((s) => {
          s.projects = result
        })
      }
    } catch {
      get().addToast('Failed to load projects', 'error')
    } finally {
      set((s) => {
        s.projectsLoading = false
      })
    }
  },

  selectProject: (id) => {
    set((s) => {
      s.activeProjectId = id
      s.historyProjectId = id
      if (id !== null) s.activeSectionPane = 'projects'
    })
    if (!id || id === '__none__') {
      set((s) => {
        s.activeAgentId = null
      })
      return
    }
    const applyPrimary = (agents: ProjectAgent[]) => {
      const primary = agents.find((a) => a.isPrimary) ?? agents[0] ?? null
      set((s) => {
        s.activeAgentId = primary?.agentId ?? null
      })
    }
    const cached = get().projectAgents[id]
    if (cached) {
      applyPrimary(cached)
    } else {
      void get()
        .loadProjectAgents(id)
        .then(() => {
          const state = get()
          if (state.activeProjectId !== id || state.currentConversationId !== null) return
          applyPrimary(state.projectAgents[id] ?? [])
        })
    }
  },

  setActiveProjectId: (id) => {
    set((s) => {
      s.activeProjectId = id
    })
  },

  setHistoryProjectId: (id) => {
    set((s) => {
      s.historyProjectId = id
    })
  },

  createProject: async (name, color) => {
    try {
      const result = await window.api.createProject(name, color)
      if (isApiError(result)) {
        get().addToast('Failed to create project', 'error')
        return
      }
      await get().loadProjects()
      set((s) => {
        s.activeProjectId = result.id
        s.editingProjectId = result.id
        s.newlyCreatedProjectId = result.id
      })
      get().addToast(`Project "${name}" created`, 'success')
      setTimeout(() => {
        get().addToast(`Tip: open the Team tab to add agents to "${name}"`, 'info')
      }, 300)
    } catch {
      get().addToast('Failed to create project', 'error')
    }
  },

  renameProject: async (id, name) => {
    try {
      const result = await window.api.renameProject(id, name)
      if (isApiError(result)) {
        get().addToast('Failed to rename project', 'error')
        return
      }
      await get().loadProjects()
    } catch {
      get().addToast('Failed to rename project', 'error')
    }
  },

  updateProjectColor: async (id, name, color) => {
    try {
      const result = await window.api.updateProjectColor(id, name, color)
      if (isApiError(result)) {
        get().addToast('Failed to update project color', 'error')
        return
      }
      await get().loadProjects()
    } catch {
      get().addToast('Failed to update project color', 'error')
    }
  },

  deleteProject: async (id, deleteChats = false) => {
    try {
      const result = await window.api.deleteProject(id, deleteChats)
      if (isApiError(result)) {
        get().addToast('Failed to delete project', 'error')
        return
      }
      set((s) => {
        if (s.activeProjectId === id) s.activeProjectId = null
        if (s.historyProjectId === id) s.historyProjectId = null
      })
      await Promise.all([get().loadProjects(), get().loadConversations()])
      get().addToast('Project deleted', 'success')
    } catch {
      get().addToast('Failed to delete project', 'error')
    }
  },

  setConversationProject: async (conversationId, projectId) => {
    try {
      const result = await window.api.setConversationProject(
        conversationId,
        projectId
      )
      if (isApiError(result)) {
        get().addToast('Failed to move conversation', 'error')
        return
      }
      await get().loadConversations()
    } catch {
      get().addToast('Failed to move conversation', 'error')
    }
  },

  setProjectDefaultModel: async (id, model, hermesProfile) => {
    try {
      const result = await window.api.setProjectDefaultModel(id, model, hermesProfile)
      if (isApiError(result)) {
        get().addToast('Failed to set project default model', 'error')
        return
      }
      await get().loadProjects()
    } catch {
      get().addToast('Failed to set project default model', 'error')
    }
  },

  clearPendingSettingsProject: () => {
    set((s) => {
      s.pendingSettingsProjectId = null
    })
  },

  setShowNewProjectForm: (show) => {
    set((s) => {
      s.showNewProjectForm = show
    })
  },

  setShowProjectGenerator: (show) => {
    set((s) => {
      s.showProjectGenerator = show
    })
  },

  openEditProject: (id, initialTab) => {
    set((s) => {
      s.editingProjectId = id
      s.projectSettingsInitialTab = initialTab ?? null
    })
  },

  closeEditProject: () => {
    set((s) => {
      s.editingProjectId = null
      s.projectSettingsInitialTab = null
    })
  },

  clearProjectSettingsInitialTab: () => {
    set((s) => {
      s.projectSettingsInitialTab = null
    })
  },

  duplicateProject: async (id) => {
    try {
      const result = await window.api.duplicateProject(id)
      if (!result || isApiError(result)) {
        get().addToast('Failed to duplicate project', 'error')
        return
      }
      await get().loadProjects()
      get().addToast('Project duplicated', 'success')
    } catch {
      get().addToast('Failed to duplicate project', 'error')
    }
  },

  exportProject: async (id) => {
    try {
      const result = await window.api.exportProject(id)
      if (isApiError(result)) {
        get().addToast('Failed to export project', 'error')
        return
      }
      if (result) get().addToast('Project exported', 'success')
    } catch {
      get().addToast('Failed to export project', 'error')
    }
  },

  loadProjectAgents: async (projectId) => {
    try {
      const result = await window.api.listProjectAgents(projectId)
      if (isApiError(result)) {
        get().addToast('Failed to load project agents', 'error')
        return
      }
      set((s) => {
        s.projectAgents[projectId] = result
      })
    } catch {
      get().addToast('Failed to load project agents', 'error')
    }
  },

  addAgentToProject: async (projectId, agentId) => {
    try {
      const result = await window.api.addAgentToProject(projectId, agentId)
      if (isApiError(result)) {
        get().addToast('Failed to add agent to project', 'error')
        return
      }
      const current = get().projectAgents[projectId] ?? []
      if (current.length === 0) {
        await window.api.setProjectPrimaryAgent(projectId, agentId)
      }
      await get().loadProjectAgents(projectId)
    } catch {
      get().addToast('Failed to add agent to project', 'error')
    }
  },

  removeAgentFromProject: async (projectId, agentId) => {
    try {
      const result = await window.api.removeAgentFromProject(projectId, agentId)
      if (isApiError(result)) {
        get().addToast('Failed to remove agent from project', 'error')
        return
      }
      await get().loadProjectAgents(projectId)
    } catch {
      get().addToast('Failed to remove agent from project', 'error')
    }
  },

  setProjectPrimaryAgent: async (projectId, agentId) => {
    try {
      const result = await window.api.setProjectPrimaryAgent(projectId, agentId)
      if (isApiError(result)) {
        get().addToast('Failed to set primary agent', 'error')
        return
      }
      await get().loadProjectAgents(projectId)
    } catch {
      get().addToast('Failed to set primary agent', 'error')
    }
  },

  reorderProjectAgents: async (projectId, orderedAgentIds) => {
    set((s) => {
      const agents = s.projectAgents[projectId]
      if (!agents) return
      const map = new Map(agents.map((a) => [a.agentId, a]))
      s.projectAgents[projectId] = orderedAgentIds
        .map((id, index) => {
          const agent = map.get(id)
          return agent ? { ...agent, sortOrder: index } : null
        })
        .filter(Boolean) as typeof agents
    })
    try {
      await window.api.reorderProjectAgents(projectId, orderedAgentIds)
    } catch {
      await get().loadProjectAgents(projectId)
      get().addToast('Failed to reorder agents', 'error')
    }
  },

  loadProjectConfig: async (projectId) => {
    try {
      const result = await window.api.getProjectConfig(projectId)
      if (!isApiError(result)) {
        set((s) => {
          s.projectConfigs[projectId] = {
            ...DEFAULT_PROJECT_CONFIG,
            ...result
          }
        })
      }
    } catch {
      /* ignore */
    }
  },

  updateProjectConfig: async (projectId, config) => {
    const prev = get().projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG
    set((s) => {
      s.projectConfigs[projectId] = { ...prev, ...config }
    })
    try {
      await window.api.updateProjectConfig(
        projectId,
        config as Record<string, unknown>
      )
      const refreshed = await window.api.getProjectConfig(projectId)
      if (!isApiError(refreshed)) {
        set((s) => {
          s.projectConfigs[projectId] = {
            ...DEFAULT_PROJECT_CONFIG,
            ...refreshed,
          }
        })
      }
    } catch {
      set((s) => {
        s.projectConfigs[projectId] = prev
      })
      get().addToast('Failed to update project settings', 'error')
    }
  },

  updateProjectOrchestration: async (projectId, config) => {
    const prev = get().projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG
    set((s) => {
      const current = s.projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG
      s.projectConfigs[projectId] = { ...current, ...config }
    })
    try {
      await window.api.updateProjectConfig(
        projectId,
        config as Record<string, unknown>
      )
      const refreshed = await window.api.getProjectConfig(projectId)
      if (!isApiError(refreshed)) {
        set((s) => {
          s.projectConfigs[projectId] = {
            ...DEFAULT_PROJECT_CONFIG,
            ...refreshed,
          }
        })
      }
    } catch {
      set((s) => {
        s.projectConfigs[projectId] = prev
      })
      get().addToast('Failed to update orchestration settings', 'error')
    }
  },

  clearNewlyCreatedProjectId: () => {
    set((s) => {
      s.newlyCreatedProjectId = null
    })
  },
})
