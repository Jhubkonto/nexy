import { isApiError, type ConversationCompletionFilter, type ConversationPageScope } from '../../shared/types'
import type { Conversation } from '../store/types'
import { useCursorPagination } from './useCursorPagination'
import { useEffect } from 'react'

/**
 * `freshnessKey` lets a scoped history replace an already-loaded cursor page when
 * the shared conversation cache confirms a change to the chat currently open in
 * that scope. This is important for newly-created chats: their first page request
 * can complete before the send handler has inserted the conversation row.
 */
export function useConversationPagination(
  scope: ConversationPageScope,
  query = '',
  freshnessKey = '',
  completion: ConversationCompletionFilter = 'all',
) {
  const pagination = useCursorPagination<Conversation>({
    resetKey: JSON.stringify([scope, query.trim(), freshnessKey, completion]),
    loadPage: async (cursor, requestId) => {
      const result = await window.api.listConversationPage({
        requestId,
        scope,
        completion,
        query: query.trim() || undefined,
        cursor,
        limit: 30,
      })
      if (isApiError(result)) throw new Error(result.error)
      return result
    },
  })
  const { updateItem, refresh } = pagination
  useEffect(() => window.api.onConversationRenamed((data) => {
    updateItem(data.id, (item) => ({ ...item, title: data.title, updated_at: data.updatedAt }))
  }), [updateItem])
  // Completion can arrive from another desktop/mobile client. Refresh rather than filtering the
  // locally loaded rows so counts and subsequent cursor pages stay authoritative.
  useEffect(() => {
    const completed = window.api.onConversationCompleted((data) => {
      updateItem(data.conversationId, (item) => ({ ...item, completed_at: data.completedAt }))
      refresh()
    })
    const incompleted = window.api.onConversationIncompleted((data) => {
      updateItem(data.conversationId, (item) => ({ ...item, completed_at: null }))
      refresh()
    })
    return () => { completed(); incompleted() }
  }, [refresh, updateItem])
  return pagination
}
