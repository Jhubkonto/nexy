import { Loader2, X, Zap } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { AgentConfig } from '../../shared/types'
import type { Conversation, Project } from '../store/types'
import { ModalShell } from './ui/primitives'

export function activityContext(activity: {
  conversationId?: string
  conversationTitle?: string
  projectId?: string
  projectName?: string
  agentId?: string
  agentName?: string
  model?: string
  detail?: string
}, sources?: {
  conversations: Conversation[]
  projects: Project[]
  agents: AgentConfig[]
}): Array<{ label: string; value: string }> {
  const conversation = activity.conversationId
    ? sources?.conversations.find((item) => item.id === activity.conversationId)
    : undefined
  const projectId = activity.projectId ?? conversation?.project_id ?? undefined
  const agentId = activity.agentId ?? conversation?.agent_id ?? undefined
  const chatTitle = activity.conversationTitle ?? conversation?.title
  const projectName = activity.projectName ??
    sources?.projects.find((item) => item.id === projectId)?.name
  const agentName = activity.agentName ??
    sources?.agents.find((item) => item.id === agentId)?.name
  const model = activity.model ?? conversation?.model ?? undefined
  const context = [
    chatTitle ? { label: 'Chat', value: chatTitle } : null,
    projectName ? { label: 'Project', value: projectName } : null,
    agentName ? { label: 'Agent', value: agentName } : null,
    model && !agentName ? { label: 'Model', value: model } : null,
  ].filter((item): item is { label: string; value: string } => item !== null)
  if (activity.detail && !context.some((item) => item.value === activity.detail)) {
    context.push({ label: 'Details', value: activity.detail })
  }
  return context
}

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export function ActivityFeedModal() {
  const activities = useAppStore((s) => s.backgroundActivities)
  const openBackgroundActivity = useAppStore((s) => s.openBackgroundActivity)
  const setShowActivityFeed = useAppStore((s) => s.setShowActivityFeed)
  const removeBackgroundActivity = useAppStore((s) => s.removeBackgroundActivity)
  const conversations = useAppStore((s) => s.conversations)
  const projects = useAppStore((s) => s.projects)
  const agents = useAppStore((s) => s.agents)

  const dismiss = (id: string) => {
    removeBackgroundActivity(id)
    void window.api.dismissActivity(id)
  }

  const sorted = [...activities].sort((a, b) => b.startedAt - a.startedAt)

  return (
    <ModalShell
      title="Activity"
      description="Ongoing work across this app and connected devices"
      icon={<Zap className="w-4 h-4 text-blue-500" />}
      maxWidth="max-w-md"
      height="max-h-[70vh]"
      bodyClassName="flex-1 min-h-0 overflow-y-auto p-2"
      onClose={() => setShowActivityFeed(false)}
    >
      {sorted.length === 0 ? (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-8">Nothing in progress right now.</p>
      ) : (
        <div className="space-y-0.5">
          {sorted.map((activity) => {
            const context = activityContext(activity, { conversations, projects, agents })
            return (
              <div
                key={activity.id}
                className="group w-full flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <button
                  type="button"
                  onClick={() => {
                    openBackgroundActivity(activity)
                    setShowActivityFeed(false)
                  }}
                  className="flex-1 min-w-0 flex items-start gap-3 text-left"
                >
                  <Loader2 className={`w-4 h-4 mt-0.5 text-blue-500 shrink-0 ${activity.label !== 'Background task status unknown' ? 'animate-spin' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{activity.label}</p>
                    {context.map((item) => (
                      <p key={item.label} className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        <span className="text-gray-400 dark:text-gray-500">{item.label}:</span>{' '}
                        {item.value}
                      </p>
                    ))}
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 mt-0.5">{timeAgo(activity.startedAt)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(activity.id)}
                  title="Dismiss"
                  aria-label="Dismiss"
                  className="shrink-0 p-1 rounded text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-300 transition-opacity"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </ModalShell>
  )
}
