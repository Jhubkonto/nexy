import { useMemo, useState } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { useAppStore } from '../../store/app-store'
import type { Conversation } from '../../store/types'
import { DeleteConversationDialog } from '../DeleteConversationDialog'
import { RenameConversationButton, RenameConversationDialog } from '../RenameConversationDialog'
import { formatRelativeTime } from '../../../shared/utils'
import { isPinned, groupByDate, withLivePinState } from './shared'
import { PaneEmptyState } from './pane-primitives'
import { PaginationFooter } from '../ui/PaginationFooter'
import { useConversationPagination } from '../../hooks/useConversationPagination'
import { useDebouncedSearchQuery } from '../../hooks/useDebouncedSearchQuery'

export function AgentHistoryPane() {
  const cachedConversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const historyAgentId = useAppStore((s) => s.historyAgentId)
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const renameConversation = useAppStore((s) => s.renameConversation)
  const newChat = useAppStore((s) => s.newChat)
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)
  const completedConversationIds = useAppStore((s) => s.completedConversationIds)
  const markConversationComplete = useAppStore((s) => s.markConversationComplete)
  const markConversationIncomplete = useAppStore((s) => s.markConversationIncomplete)
  const setConversationPinned = useAppStore((s) => s.setConversationPinned)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedSearchQuery(query)
  const pagination = useConversationPagination(
    { type: 'agent', id: historyAgentId ?? '' },
    debouncedQuery,
  )
  const conversations = useMemo(() => {
    const source = pagination.hasLoaded || debouncedQuery
      ? pagination.items
      : cachedConversations.filter((conversation) => conversation.agent_id === historyAgentId)
    return withLivePinState(source, cachedConversations)
  }, [cachedConversations, debouncedQuery, historyAgentId, pagination.hasLoaded, pagination.items])
  const [pendingDeleteConv, setPendingDeleteConv] = useState<{ id: string; title: string } | null>(null)
  const [pendingRenameConv, setPendingRenameConv] = useState<{ id: string; title: string } | null>(null)

  const agent = historyAgentId ? agents.find((a) => a.id === historyAgentId) : null

  const filtered = conversations

  const pinned = filtered.filter(isPinned)
  const unpinned = filtered.filter((c) => !isPinned(c))
  const groups = groupByDate(unpinned)

  const renderConv = (conv: Conversation) => {
    const isActive = currentConversationId === conv.id
    const project = conv.project_id ? projects.find((p) => p.id === conv.project_id) : null
    const isUnread = unreadConversationIds.includes(conv.id)
    // completedConversationIds is only seeded from the global conversation load, so an agent-scoped
    // conversation that arrived via pagination wouldn't be in it — fall back to the conversation's
    // own completed_at (the source of truth the all-chats list and chat header use).
    const isCompleted = conv.completed_at != null || completedConversationIds.includes(conv.id)
    return (
      <div
        key={conv.id}
        onClick={() => selectConversation(conv.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`group relative flex items-start gap-2 px-3 py-2 rounded-nexy-sm border cursor-pointer transition-colors ${
          isActive
            ? 'border-nexy-accent bg-nexy-raised shadow-nexy'
            : 'border-transparent hover:border-nexy-border-soft hover:bg-nexy-recessed'
        }`}
      >
        {isPinned(conv) && <NexyIcon name="pin" className="w-3 h-3 text-nexy-muted shrink-0 mt-0.5" />}
        {isCompleted ? (
          <span title="Complete"><NexyIcon name="checked-box" className="w-4 h-4 text-nexy-success shrink-0" /></span>
        ) : isUnread ? (
          <span className="nexy-notification-dot w-2 h-2 bg-blue-500 animate-pulse shrink-0 mt-1.5" />
        ) : null}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{conv.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
              {project ? project.name : 'No project'}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {formatRelativeTime(conv.updated_at)}
            </span>
          </div>
        </div>
        <div className="pointer-events-none absolute right-2 top-1.5 z-10 flex items-center gap-0.5 rounded-nexy-sm border border-nexy-border-soft bg-nexy-raised p-0.5 opacity-0 shadow-nexy transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <RenameConversationButton onClick={() => setPendingRenameConv({ id: conv.id, title: conv.title })} />
          <button
            onClick={(e) => { e.stopPropagation(); void setConversationPinned(conv.id, !isPinned(conv)) }}
            className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
              isPinned(conv) ? 'text-nexy-accent hover:text-gray-400' : 'text-gray-400 hover:text-nexy-accent'
            }`}
            title={isPinned(conv) ? 'Unpin' : 'Pin'}
            aria-label={isPinned(conv) ? 'Unpin conversation' : 'Pin conversation'}
          >
            <NexyIcon name={isPinned(conv) ? 'unpin' : 'pin'} className="w-3 h-3" />
          </button>
          {isCompleted ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void markConversationIncomplete(conv.id).then(() =>
                  pagination.updateItem(conv.id, (c) => ({ ...c, completed_at: null }))
                )
              }}
              className="p-1 rounded text-emerald-500 hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Mark incomplete"
              aria-label="Mark conversation incomplete"
            >
              <NexyIcon name="busy" className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void markConversationComplete(conv.id).then(() =>
                  pagination.updateItem(conv.id, (c) => ({ ...c, completed_at: Date.now() }))
                )
              }}
              className="p-1 rounded text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              title="Mark complete"
              aria-label="Mark conversation complete"
            >
              <NexyIcon name="check" className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setPendingDeleteConv({ id: conv.id, title: conv.title }) }}
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
            title="Delete"
            aria-label="Delete conversation"
          >
            <NexyIcon name="delete" className="w-3 h-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-gray-100 dark:border-gray-800">
        <div className="flex-1 flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-0.5">
          <NexyIcon name="search" className="w-3.5 h-3.5 text-nexy-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 text-xs bg-transparent focus:outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
            aria-label="Search agent chats"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <NexyIcon name="close" className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => newChat({ agentId: historyAgentId ?? undefined })}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="New chat with this agent"
        >
          <NexyIcon name="add" className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-4">
        {filtered.length === 0 && (
          <PaneEmptyState>
            {query ? 'No matching conversations' : `No chats with ${agent?.name ?? 'this agent'} yet`}
          </PaneEmptyState>
        )}

        {pinned.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-1">
              Pinned
            </p>
            {pinned.map(renderConv)}
          </div>
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-1">
              {label}
            </p>
            {items.map(renderConv)}
          </div>
        ))}
        <PaginationFooter
          loadedCount={conversations.length}
          totalCount={pagination.totalCount}
          hasMore={pagination.hasMore}
          isLoading={pagination.isLoading}
          error={pagination.error}
          onLoadMore={pagination.loadMore}
          onRetry={pagination.refresh}
        />
      </div>

      {pendingDeleteConv && (
        <DeleteConversationDialog
          conversationTitle={pendingDeleteConv.title}
          onConfirm={() => {
            void deleteConversation(pendingDeleteConv.id).then(pagination.refresh)
            setPendingDeleteConv(null)
          }}
          onCancel={() => setPendingDeleteConv(null)}
        />
      )}
      {pendingRenameConv && (
        <RenameConversationDialog
          conversationTitle={pendingRenameConv.title}
          onConfirm={async (title) => {
            const saved = await renameConversation(pendingRenameConv.id, title)
            if (saved) pagination.updateItem(pendingRenameConv.id, (item) => ({ ...item, title }))
            return saved
          }}
          onCancel={() => setPendingRenameConv(null)}
        />
      )}
    </div>
  )
}
