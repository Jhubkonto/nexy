import { useState, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import type { Conversation } from '../../store/types'
import { DeleteConversationDialog } from '../DeleteConversationDialog'
import { RenameConversationButton, RenameConversationDialog } from '../RenameConversationDialog'
import { formatRelativeTime } from '../../../shared/utils'
import { isPinned, groupByDate, PROJECT_COLOR_MAP, projectColorHex, withLivePinState } from './shared'
import { PaneEmptyState } from './pane-primitives'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { PaginationFooter } from '../ui/PaginationFooter'
import { useConversationPagination } from '../../hooks/useConversationPagination'
import { useDebouncedSearchQuery } from '../../hooks/useDebouncedSearchQuery'

export function ChatsPane({ pinnedOnly = false }: { pinnedOnly?: boolean } = {}) {
  const cachedConversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const projects = useAppStore((s) => s.projects)
  const agents = useAppStore((s) => s.agents)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const renameConversation = useAppStore((s) => s.renameConversation)
  const newChat = useAppStore((s) => s.newChat)
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)
  const generatingConversationIds = useAppStore((s) => s.generatingConversationIds)
  const pendingConversationIds = useAppStore((s) => s.pendingConversationIds)
  const completedConversationIds = useAppStore((s) => s.completedConversationIds)
  const markConversationComplete = useAppStore((s) => s.markConversationComplete)
  const markConversationIncomplete = useAppStore((s) => s.markConversationIncomplete)
  const setConversationPinned = useAppStore((s) => s.setConversationPinned)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedSearchQuery(query)
  const pagination = useConversationPagination({ type: pinnedOnly ? 'pinned' : 'all' }, debouncedQuery)
  const conversations = useMemo(() => {
    const source = !pagination.hasLoaded && !debouncedQuery
      ? (pinnedOnly ? cachedConversations.filter(isPinned) : cachedConversations.slice(0, 30))
      : pagination.items
    return withLivePinState(source, cachedConversations)
  }, [cachedConversations, debouncedQuery, pagination.hasLoaded, pagination.items, pinnedOnly])
  const [pendingDeleteConv, setPendingDeleteConv] = useState<{ id: string; title: string } | null>(null)
  const [pendingRenameConv, setPendingRenameConv] = useState<{ id: string; title: string } | null>(null)

  const filtered = conversations

  const pinned = useMemo(() => filtered.filter(isPinned), [filtered])
  const unpinned = useMemo(() => filtered.filter((c) => !isPinned(c)), [filtered])
  const groups = useMemo(() => groupByDate(unpinned), [unpinned])

  const renderConv = (conv: Conversation) => {
    const isActive = currentConversationId === conv.id
    const project = conv.project_id ? projects.find((p) => p.id === conv.project_id) : null
    const agent = conv.agent_id ? agents.find((a) => a.id === conv.agent_id) : null
    const isUnread = unreadConversationIds.includes(conv.id)
    const isGenerating = generatingConversationIds.includes(conv.id)
    const isCompleted = completedConversationIds.includes(conv.id)
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
                onClick={(e) => { e.stopPropagation(); void markConversationIncomplete(conv.id) }}
                className="p-1 rounded-nexy-sm text-nexy-success hover:text-nexy-muted hover:bg-nexy-recessed"
                title="Mark incomplete"
                aria-label="Mark conversation incomplete"
              >
                <span className="block h-3 w-3 border-2 border-current" />
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); void markConversationComplete(conv.id) }}
                className="p-1 rounded-nexy-sm text-nexy-muted hover:text-nexy-success hover:bg-nexy-recessed"
                title="Mark complete"
                aria-label="Mark conversation complete"
              >
                <NexyIcon name="check" className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setPendingDeleteConv({ id: conv.id, title: conv.title }) }}
              className="p-1 rounded-nexy-sm text-nexy-muted hover:text-nexy-error hover:bg-nexy-recessed"
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
      <div className="flex items-center gap-2 px-3 h-9 border-b-2 border-nexy-border bg-nexy-surface">
        <div className="flex-1 flex items-center gap-1.5 bg-nexy-recessed border border-nexy-border rounded-nexy-sm px-2 py-0.5">
          <NexyIcon name="search" className="w-3.5 h-3.5 text-nexy-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={pinnedOnly ? 'Search pinned chats…' : 'Search chats…'}
            className="flex-1 text-xs bg-transparent focus:outline-none text-nexy-text placeholder:text-nexy-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-nexy-muted hover:text-nexy-text">
              <NexyIcon name="close" className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => newChat()}
          className="flex items-center gap-1 text-xs font-bold text-nexy-muted hover:text-nexy-text px-2 py-1 rounded-nexy-sm border border-transparent hover:border-nexy-border hover:bg-nexy-recessed transition-colors shrink-0"
          aria-label="New chat"
        >
          <NexyIcon name="add" className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-4">
        {filtered.length === 0 && (pinnedOnly || pendingConversationIds.length === 0) && (
          <PaneEmptyState>
            {debouncedQuery
              ? `No matching ${pinnedOnly ? 'pinned chats' : 'conversations'}`
              : pinnedOnly ? 'No pinned chats yet' : 'No conversations yet'}
          </PaneEmptyState>
        )}

        {!pinnedOnly && pendingConversationIds.length > 0 && !debouncedQuery && (
          <div>
            {pendingConversationIds
              .filter((id) => !conversations.some((c) => c.id === id))
              .map((id) => (
                <div
                  key={id}
                  onClick={() => selectConversation(id)}
                  aria-current={currentConversationId === id ? 'page' : undefined}
                  className={`group flex items-start gap-2 px-3 py-2 rounded-nexy-sm border cursor-pointer transition-colors ${
                    currentConversationId === id
                      ? 'border-nexy-accent bg-nexy-raised shadow-nexy'
                      : 'border-transparent hover:border-nexy-border-soft hover:bg-nexy-recessed'
                  }`}
                >
                  <span title="Sending…"><Loader2 className="w-3.5 h-3.5 text-nexy-activity animate-spin shrink-0 mt-0.5" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-nexy-text truncate">New chat</p>
                    <p className="text-[10px] text-nexy-muted mt-0.5">Sending…</p>
                  </div>
                </div>
              ))}
          </div>
        )}

        {pinned.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-1">
              {pinnedOnly ? 'Pinned Chats' : 'Pinned'}
            </p>
            {pinned.map(renderConv)}
          </div>
        )}

        {!pinnedOnly && groups.map(({ label, items }) => (
          <div key={label}>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-1">
              {label}
            </p>
            {items.map(renderConv)}
          </div>
        ))}
        <PaginationFooter
          loadedCount={pagination.items.length}
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
