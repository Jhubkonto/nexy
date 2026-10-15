import type { StateCreator } from 'zustand'
import { isApiError } from '../../../shared/types'
import { normalizeConversationTitle } from '../../../shared/conversation-title'
import type { AppState } from '../app-store'
import type { Conversation } from '../types'

export interface ConversationSlice {
  conversations: Conversation[]
  currentConversationId: string | null
  conversationsLoading: boolean
  completedConversationIds: string[]
  conversationRatings: Record<string, number>
  loadConversations: () => Promise<void>
  selectConversation: (id: string | null) => void
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<boolean>
  handleConversationRenamed: (id: string, title: string, updatedAt?: number) => void
  conversationCreated: (id: string) => Promise<void>
  newChat: (opts?: { projectId?: string | null; agentId?: string | null }) => void
  markConversationComplete: (id: string) => Promise<void>
  markConversationIncomplete: (id: string) => Promise<void>
  setConversationPinned: (id: string, pinned: boolean) => Promise<void>
  handleConversationCompleted: (conversationId: string) => void
  handleConversationIncompleted: (conversationId: string) => void
  submitConversationRating: (id: string, rating: number, note?: string | null) => Promise<void>
  clearConversationRating: (id: string) => Promise<void>
  handleConversationRated: (conversationId: string, rating: number | null) => void
}

export const createConversationSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  ConversationSlice
> = (set, get) => ({
  conversations: [],
  currentConversationId: null,
  conversationsLoading: false,
  completedConversationIds: [],
  conversationRatings: {},

  loadConversations: async () => {
    set((s) => {
      s.conversationsLoading = true
    })
    try {
      const result = await window.api.listConversations()
      if (isApiError(result)) {
        get().addToast('Failed to load conversations', 'error')
      } else {
        set((s) => {
          s.conversations = result
          s.completedConversationIds = result
            .filter((c) => c.completed_at != null)
            .map((c) => c.id)
          s.conversationRatings = Object.fromEntries(
            result.filter((c) => c.rating != null).map((c) => [c.id, c.rating as number]),
          )
        })
      }
    } catch {
      get().addToast('Failed to load conversations', 'error')
    } finally {
      set((s) => {
        s.conversationsLoading = false
      })
    }
  },

  submitConversationRating: async (id, rating, note) => {
    const previous = get().conversationRatings[id]
    set((s) => {
      s.conversationRatings[id] = rating
    })
    try {
      const result = await window.api.submitConversationRating(id, rating, note)
      if (isApiError(result)) throw new Error(result.error)
    } catch {
      set((s) => {
        if (previous == null) delete s.conversationRatings[id]
        else s.conversationRatings[id] = previous
      })
      get().addToast('Failed to submit rating', 'error')
    }
  },

  clearConversationRating: async (id) => {
    const previous = get().conversationRatings[id]
    set((s) => {
      delete s.conversationRatings[id]
    })
    try {
      const result = await window.api.deleteConversationRating(id)
      if (isApiError(result)) throw new Error(result.error)
    } catch {
      set((s) => {
        if (previous != null) s.conversationRatings[id] = previous
      })
      get().addToast('Failed to clear rating', 'error')
    }
  },

  handleConversationRated: (conversationId, rating) => {
    set((s) => {
      if (rating == null) delete s.conversationRatings[conversationId]
      else s.conversationRatings[conversationId] = rating
    })
  },

  markConversationComplete: async (id) => {
    try {
      await window.api.markConversationComplete(id)
      set((s) => {
        if (!s.completedConversationIds.includes(id)) {
          s.completedConversationIds.push(id)
        }
      })
    } catch {
      get().addToast('Failed to mark conversation complete', 'error')
    }
  },

  markConversationIncomplete: async (id) => {
    try {
      await window.api.markConversationIncomplete(id)
      set((s) => {
        s.completedConversationIds = s.completedConversationIds.filter((cid) => cid !== id)
      })
    } catch {
      get().addToast('Failed to mark conversation incomplete', 'error')
    }
  },

  setConversationPinned: async (id, pinned) => {
    const previous = get().conversations.find((c) => c.id === id)?.pinned
    set((s) => {
      const conv = s.conversations.find((c) => c.id === id)
      if (conv) conv.pinned = pinned ? 1 : 0
    })
    try {
      const result = await window.api.setConversationPinned(id, pinned)
      if (isApiError(result)) throw new Error(result.error)
    } catch {
      set((s) => {
        const conv = s.conversations.find((c) => c.id === id)
        if (conv) conv.pinned = previous
      })
      get().addToast(pinned ? 'Failed to pin conversation' : 'Failed to unpin conversation', 'error')
    }
  },

  renameConversation: async (id, title) => {
    const previous = get().conversations.find((conversation) => conversation.id === id)
    const normalizedTitle = normalizeConversationTitle(title)
    if (!normalizedTitle) {
      get().addToast('Chat title cannot be empty', 'error')
      return false
    }
    set((s) => {
      const conversation = s.conversations.find((item) => item.id === id)
      if (conversation) {
        conversation.title = normalizedTitle
        conversation.updated_at = Date.now()
      }
    })
    try {
      const result = await window.api.renameConversation(id, normalizedTitle)
      if (isApiError(result)) throw new Error(result.error)
      return true
    } catch {
      set((s) => {
        const conversation = s.conversations.find((item) => item.id === id)
        if (conversation && previous) Object.assign(conversation, previous)
      })
      get().addToast('Failed to rename conversation', 'error')
      return false
    }
  },

  handleConversationRenamed: (id, title, updatedAt) => {
    set((s) => {
      const conversation = s.conversations.find((item) => item.id === id)
      if (conversation) {
        conversation.title = title
        if (updatedAt != null) conversation.updated_at = updatedAt
      }
    })
  },

  handleConversationCompleted: (conversationId) => {
    set((s) => {
      if (!s.completedConversationIds.includes(conversationId)) {
        s.completedConversationIds.push(conversationId)
      }
    })
  },

  handleConversationIncompleted: (conversationId) => {
    set((s) => {
      s.completedConversationIds = s.completedConversationIds.filter((id) => id !== conversationId)
    })
  },

  selectConversation: (id) => {
    set((s) => {
      s.currentConversationId = id
    })
  },

  deleteConversation: async (id) => {
    try {
      const result = await window.api.deleteConversation(id)
      if (isApiError(result)) {
        get().addToast('Failed to delete conversation', 'error')
        return
      }
      set((s) => {
        if (s.currentConversationId === id) s.currentConversationId = null
      })
      await get().loadConversations()
    } catch {
      get().addToast('Failed to delete conversation', 'error')
    }
  },

  conversationCreated: async (id) => {
    set((s) => {
      s.currentConversationId = id
    })
    await get().loadConversations()
  },

  newChat: (opts) => {
    const projectId = opts?.projectId ?? null
    const agentId = opts?.agentId ?? null
    let resolvedAgentId = agentId
    if (projectId && !agentId) {
      const agents = get().projectAgents[projectId] ?? []
      const primary = agents.find((a) => a.isPrimary) ?? agents[0] ?? null
      resolvedAgentId = primary?.agentId ?? null
    }
    set((s) => {
      s.currentConversationId = null
      s.activeProjectId = projectId
      s.activeAgentId = resolvedAgentId
    })
  },
})
