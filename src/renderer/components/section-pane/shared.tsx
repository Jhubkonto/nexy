import type { ProjectAgent, Conversation } from '../../store/types'
import { normalizeProjectColor, PROJECT_COLOR_OPTIONS } from '../../../shared/project-colors'
export type { Conversation } from '../../store/types'

export const PANE_MIN = 220
export const CHAT_HISTORY_PANE_MIN = 320
export const PANE_MAX = 500

export const PROJECT_COLOR_MAP: Record<string, { bg: string; dot: string; ring: string }> = {
  blue:   { bg: 'bg-nexy-project-blue-light dark:bg-nexy-project-blue-dark/60',     dot: 'bg-nexy-project-blue',   ring: 'ring-nexy-project-blue' },
  green:  { bg: 'bg-nexy-project-green-light dark:bg-nexy-project-green-dark/60',   dot: 'bg-nexy-project-green',  ring: 'ring-nexy-project-green' },
  red:    { bg: 'bg-nexy-project-red-light dark:bg-nexy-project-red-dark/60',       dot: 'bg-nexy-project-red',    ring: 'ring-nexy-project-red' },
  purple: { bg: 'bg-nexy-project-purple-light dark:bg-nexy-project-purple-dark/60', dot: 'bg-nexy-project-purple', ring: 'ring-nexy-project-purple' },
  orange: { bg: 'bg-nexy-project-orange-light dark:bg-nexy-project-orange-dark/60', dot: 'bg-nexy-project-orange', ring: 'ring-nexy-project-orange' },
  pink:   { bg: 'bg-nexy-project-pink-light dark:bg-nexy-project-pink-dark/60',     dot: 'bg-nexy-project-pink',   ring: 'ring-nexy-project-pink' },
  yellow: { bg: 'bg-nexy-project-yellow-light dark:bg-nexy-project-yellow-dark/60', dot: 'bg-nexy-project-yellow', ring: 'ring-nexy-project-yellow' },
  cyan:   { bg: 'bg-nexy-project-cyan-light dark:bg-nexy-project-cyan-dark/60',     dot: 'bg-nexy-project-cyan',   ring: 'ring-nexy-project-cyan' },
  gray:   { bg: 'bg-nexy-project-gray-light dark:bg-nexy-project-gray-dark/60',     dot: 'bg-nexy-project-gray',   ring: 'ring-nexy-project-gray' },
}
PROJECT_COLOR_MAP.teal = PROJECT_COLOR_MAP.cyan
PROJECT_COLOR_MAP.indigo = PROJECT_COLOR_MAP.purple

export const COLOR_OPTIONS = ['blue', 'green', 'red', 'purple', 'orange', 'pink', 'yellow', 'cyan', 'gray']

export function projectColorHex(color: string): string {
  const normalized = normalizeProjectColor(color)
  if (!normalized) return PROJECT_COLOR_OPTIONS[0].hex
  return PROJECT_COLOR_OPTIONS.find((option) => option.value === normalized)?.hex ?? normalized
}

export const PROJECT_BADGE_COLOR_MAP: Record<string, { bg: string; text: string; border: string; hover: string }> = {
  blue:   { bg: 'bg-nexy-project-blue-light dark:bg-nexy-project-blue-dark/60',     text: 'text-nexy-project-blue-dark dark:text-nexy-project-blue-light',     border: 'border-nexy-project-blue',   hover: 'hover:bg-nexy-project-blue-light/70 dark:hover:bg-nexy-project-blue-dark/80' },
  green:  { bg: 'bg-nexy-project-green-light dark:bg-nexy-project-green-dark/60',   text: 'text-nexy-project-green-dark dark:text-nexy-project-green-light',   border: 'border-nexy-project-green',  hover: 'hover:bg-nexy-project-green-light/70 dark:hover:bg-nexy-project-green-dark/80' },
  red:    { bg: 'bg-nexy-project-red-light dark:bg-nexy-project-red-dark/60',       text: 'text-nexy-project-red-dark dark:text-nexy-project-red-light',       border: 'border-nexy-project-red',    hover: 'hover:bg-nexy-project-red-light/70 dark:hover:bg-nexy-project-red-dark/80' },
  purple: { bg: 'bg-nexy-project-purple-light dark:bg-nexy-project-purple-dark/60', text: 'text-nexy-project-purple-dark dark:text-nexy-project-purple-light', border: 'border-nexy-project-purple', hover: 'hover:bg-nexy-project-purple-light/70 dark:hover:bg-nexy-project-purple-dark/80' },
  orange: { bg: 'bg-nexy-project-orange-light dark:bg-nexy-project-orange-dark/60', text: 'text-nexy-project-orange-dark dark:text-nexy-project-orange-light', border: 'border-nexy-project-orange', hover: 'hover:bg-nexy-project-orange-light/70 dark:hover:bg-nexy-project-orange-dark/80' },
  pink:   { bg: 'bg-nexy-project-pink-light dark:bg-nexy-project-pink-dark/60',     text: 'text-nexy-project-pink-dark dark:text-nexy-project-pink-light',     border: 'border-nexy-project-pink',   hover: 'hover:bg-nexy-project-pink-light/70 dark:hover:bg-nexy-project-pink-dark/80' },
  yellow: { bg: 'bg-nexy-project-yellow-light dark:bg-nexy-project-yellow-dark/60', text: 'text-nexy-project-yellow-dark dark:text-nexy-project-yellow-light', border: 'border-nexy-project-yellow', hover: 'hover:bg-nexy-project-yellow-light/70 dark:hover:bg-nexy-project-yellow-dark/80' },
  cyan:   { bg: 'bg-nexy-project-cyan-light dark:bg-nexy-project-cyan-dark/60',     text: 'text-nexy-project-cyan-dark dark:text-nexy-project-cyan-light',     border: 'border-nexy-project-cyan',   hover: 'hover:bg-nexy-project-cyan-light/70 dark:hover:bg-nexy-project-cyan-dark/80' },
  gray:   { bg: 'bg-nexy-project-gray-light dark:bg-nexy-project-gray-dark/60',     text: 'text-nexy-project-gray-dark dark:text-nexy-project-gray-light',     border: 'border-nexy-project-gray',   hover: 'hover:bg-nexy-project-gray-light/70 dark:hover:bg-nexy-project-gray-dark/80' },
}
PROJECT_BADGE_COLOR_MAP.teal = PROJECT_BADGE_COLOR_MAP.cyan
PROJECT_BADGE_COLOR_MAP.indigo = PROJECT_BADGE_COLOR_MAP.purple

export function AgentAvatarStack({ members }: { members: ProjectAgent[] }) {
  if (members.length === 0) return null
  const visible = members.slice(0, 3)
  const overflow = members.length - visible.length
  return (
    <div className="flex items-center -space-x-1 shrink-0">
      {visible.map((m) => (
        <span
          key={m.agentId}
          className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 border border-white dark:border-gray-800 flex items-center justify-center text-[10px] leading-none"
          title={m.agentName}
        >
          {m.agentIcon}
        </span>
      ))}
      {overflow > 0 && (
        <span className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600 border border-white dark:border-gray-800 flex items-center justify-center text-[9px] font-medium text-gray-500 dark:text-gray-400 leading-none">
          +{overflow}
        </span>
      )}
    </div>
  )
}

export function isPinned(c: Conversation) { return c.pinned === 1 }

/**
 * Paginated history results are snapshots, while pin changes are applied optimistically to the
 * app-wide conversation store. Keep the snapshot's paging/order data, but take the mutable pin
 * flag from the live store so a row cannot keep offering the action it just performed.
 */
export function withLivePinState(
  conversations: Conversation[],
  liveConversations: Conversation[],
): Conversation[] {
  const livePinnedById = new Map(liveConversations.map((conversation) => [conversation.id, conversation.pinned]))
  return conversations.map((conversation) => {
    const livePinned = livePinnedById.get(conversation.id)
    return livePinned == null || livePinned === conversation.pinned
      ? conversation
      : { ...conversation, pinned: livePinned }
  })
}

export function groupByDate(conversations: Conversation[]) {
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 7 * 86400000

  const groups: { label: string; items: Conversation[] }[] = []
  const add = (label: string, items: Conversation[]) => { if (items.length) groups.push({ label, items }) }
  add('Today',     conversations.filter((c) => c.updated_at >= todayStart))
  add('Yesterday', conversations.filter((c) => c.updated_at >= yesterdayStart && c.updated_at < todayStart))
  add('This Week', conversations.filter((c) => c.updated_at >= weekStart && c.updated_at < yesterdayStart))
  add('Older',     conversations.filter((c) => c.updated_at < weekStart))
  return groups
}
