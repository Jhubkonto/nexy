import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { useAppStore } from '../../store/app-store'
import type { Conversation } from '../../store/types'
import { DeleteConversationDialog } from '../DeleteConversationDialog'
import { RenameConversationButton, RenameConversationDialog } from '../RenameConversationDialog'
import { formatRelativeTime } from '../../../shared/utils'
import { isPinned, groupByDate, PROJECT_COLOR_MAP, projectColorHex, withLivePinState } from './shared'
import { PaneEmptyState } from './pane-primitives'
import { PaginationFooter } from '../ui/PaginationFooter'
import { useConversationPagination } from '../../hooks/useConversationPagination'
import { useDebouncedSearchQuery } from '../../hooks/useDebouncedSearchQuery'

export function ProjectHistoryPane() {
  const cachedConversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const historyProjectId = useAppStore((s) => s.historyProjectId)
  const projects = useAppStore((s) => s.projects)
  const agents = useAppStore((s) => s.agents)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const renameConversation = useAppStore((s) => s.renameConversation)
  const newChat = useAppStore((s) => s.newChat)
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)
  const generatingConversationIds = useAppStore((s) => s.generatingConversationIds)
  const completedConversationIds = useAppStore((s) => s.completedConversationIds)
  const markConversationComplete = useAppStore((s) => s.markConversationComplete)
  const markConversationIncomplete = useAppStore((s) => s.markConversationIncomplete)
  const setConversationPinned = useAppStore((s) => s.setConversationPinned)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedSearchQuery(query)
  // The project page can initially load just before the first send has created its
  // conversation record. Once the common cache observes that active record, use
  // its revision to replace that stale page without requiring navigation away.
  const activeConversationRevision = useMemo(() => {
    const activeConversation = cachedConversations.find((conversation) => conversation.id === currentConversationId)
    const belongsToHistory = historyProjectId === '__none__'
      ? !activeConversation?.project_id
      : activeConversation?.project_id === historyProjectId
    return activeConversation && belongsToHistory
      ? `${activeConversation.id}:${activeConversation.updated_at}`
      : ''
  }, [cachedConversations, currentConversationId, historyProjectId])
  const pagination = useConversationPagination(
    { type: 'project', id: historyProjectId === '__none__' ? null : historyProjectId },
    debouncedQuery,
    activeConversationRevision,
  )
  const conversations = useMemo(() => {
    const source = pagination.hasLoaded || debouncedQuery
      ? pagination.items
      : cachedConversations.filter((conversation) =>
          historyProjectId === '__none__' ? !conversation.project_id : conversation.project_id === historyProjectId
        )
    return withLivePinState(source, cachedConversations)
  }, [cachedConversations, debouncedQuery, historyProjectId, pagination.hasLoaded, pagination.items])
  const [pendingDeleteConv, setPendingDeleteConv] = useState<{ id: string; title: string } | null>(null)
  const [pendingRenameConv, setPendingRenameConv] = useState<{ id: string; title: string } | null>(null)

  const filtered = conversations

  const pinned = filtered.filter(isPinned)
  const unpinned = filtered.filter((c) => !isPinned(c))
  const groups = groupByDate(unpinned)

  const renderConv = (conv: Conversation) => {
    const isActive = currentConversationId === conv.id
    const project = conv.project_id ? projects.find((candidate) => candidate.id === conv.project_id) : null
    const agent = conv.agent_id ? agents.find((a) => a.id === conv.agent_id) : null
    const isUnread = unreadConversationIds.includes(conv.id)
    const isGenerating = generatingConversationIds.includes(conv.id)
    // completedConversationIds is only seeded from the global conversation load, so a
    // project-scoped conversation that arrived via pagination wouldn't be in it — fall back to the
    // conversation's own completed_at (the source of truth the all-chats list and chat header use).
    const isCompleted = conv.completed_at != null || completedConversationIds.includes(conv.id)
    const colors = project ? (PROJECT_COLOR_MAP[project.color] ?? PROJECT_COLOR_MAP.blue) : null
    return (
      <div
        key={conv.id}
        onClick={() => selectConversation(conv.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`group relative flex items-stretch gap-0 rounded-nexy-sm border cursor-pointer transition-colors overflow-hidden ${
          isActive
            ? 'border-nexy-accent bg-nexy-accent/10 shadow-nexy'
            : 'border-transparent hover:border-nexy-border-soft hover:bg-nexy-recessed'
        }`}
      >
        {colors
          ? <div className={`w-1 shrink-0 ${colors.dot}`} style={{ backgroundColor: projectColorHex(project?.color ?? 'blue') }} />
          : <div className="w-1 shrink-0" />
        }
        <div className="flex items-start gap-2 px-3 py-2 flex-1 min-w-0">
          {isPinned(conv) && <NexyIcon name="pin" className="w-3 h-3 text-nexy-muted shrink-0 mt-0.5" />}
          {isGenerating ? (
            <span title="Generating…"><Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0 mt-0.5" /></span>
          ) : isUnread ? (
            <span className="nexy-notification-dot w-2 h-2 bg-nexy-info shrink-0 mt-1.5" />
          ) : isCompleted ? (
            <span title="Complete"><NexyIcon name="checked-box" className="w-4 h-4 text-nexy-success shrink-0" /></span>
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-nexy-text truncate">{conv.title}</p>
            <p className="text-[10px] text-nexy-muted mt-0.5 truncate">
              {[agent && `${agent.icon} ${agent.name}`, project?.name, formatRelativeTime(conv.updated_at)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        <div className="pointer-events-none absolute right-2 top-1.5 z-10 flex items-center gap-0.5 rounded-nexy-sm border border-nexy-border-soft bg-nexy-raised p-0.5 opacity-0 shadow-nexy transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <RenameConversationButton onClick={() => setPendingRenameConv({ id: conv.id, title: conv.title })} />
          <button
            onClick={(e) => { e.stopPropagation(); void setConversationPinned(conv.id, !isPinned(conv)) }}
            className={`p-1 rounded-nexy-sm hover:bg-nexy-recessed ${
              isPinned(conv) ? 'text-nexy-accent hover:text-nexy-muted' : 'text-nexy-muted hover:text-nexy-accent'
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
              className="p-1 rounded-nexy-sm text-nexy-success hover:text-nexy-muted hover:bg-nexy-recessed"
              title="Mark incomplete"
              aria-label="Mark conversation incomplete"
            >
              <span className="block h-3 w-3 border-2 border-current" />
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void markConversationComplete(conv.id).then(() =>
                  pagination.updateItem(conv.id, (c) => ({ ...c, completed_at: Date.now() }))
                )
              }}
              className="p-1 rounded-nexy-sm text-nexy-muted hover:text-nexy-success hover:bg-nexy-recessed"
              title="Mark complete"
              aria-label="Mark conversation complete"
            >
              <NexyIcon name="check" className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setPendingDeleteConv({ id: conv.id, title: conv.title }) }}
            className="p-1 rounded-nexy-sm text-nexy-muted hover:text-nexy-error hover:bg-nexy-recessed shrink-0"
            title="Delete"
            aria-label="Delete conversation"
          >
            <NexyIcon name="delete" className="w-3 h-3" />
          </button>
        </div>
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
            aria-label="Search project chats"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <NexyIcon name="close" className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => newChat({ projectId: historyProjectId === '__none__' ? null : historyProjectId })}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          aria-label="New chat"
        >
          <NexyIcon name="add" className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-4">
        {filtered.length === 0 && (
          <PaneEmptyState>
            {query ? 'No matching conversations' : 'No conversations yet'}
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
