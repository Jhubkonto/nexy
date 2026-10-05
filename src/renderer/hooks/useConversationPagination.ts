import { isApiError, type ConversationPageScope } from '../../shared/types'
import type { Conversation } from '../store/types'
import { useCursorPagination } from './useCursorPagination'

/**
 * `freshnessKey` lets a scoped history replace an already-loaded cursor page when
 * the shared conversation cache confirms a change to the chat currently open in
 * that scope. This is important for newly-created chats: their first page request
 * can complete before the send handler has inserted the conversation row.
 */
export function useConversationPagination(scope: ConversationPageScope, query = '', freshnessKey = '') {
  const resetKey = JSON.stringify([scope, query.trim(), freshnessKey])
  return useCursorPagination<Conversation>({
    resetKey,
    loadPage: async (cursor, requestId) => {
      const result = await window.api.listConversationPage({
        requestId,
        scope,
        query: query.trim() || undefined,
        cursor,
        limit: 30,
      })
      if (isApiError(result)) throw new Error(result.error)
      return result
    },
  })
}
