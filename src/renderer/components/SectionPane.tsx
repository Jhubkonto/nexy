import { useRef, useState, useCallback } from 'react'
import { X, ArrowLeft } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { ResizeHandle } from './ResizeHandle'
import { CHAT_HISTORY_PANE_MIN, PANE_MIN, PANE_MAX } from './section-pane/shared'
import { ProjectsPane } from './section-pane/ProjectsPane'
import { AgentsPane } from './section-pane/AgentsPane'
import { AgentHistoryPane } from './section-pane/AgentHistoryPane'
import { ChatsPane } from './section-pane/ChatsPane'
import { PinnedChatsPane } from './section-pane/PinnedChatsPane'
import { ProjectHistoryPane } from './section-pane/ProjectHistoryPane'
import { SkillsPane } from './section-pane/SkillsPane'
import { ScheduledPane } from './section-pane/ScheduledPane'
import { AutomatedWorkflowsPane } from './section-pane/AutomatedWorkflowsPane'
import { ArtifactsPane } from './section-pane/ArtifactsPane'
import { RatingsPane } from './section-pane/RatingsPane'
import { WorkHistoryPane } from './section-pane/WorkHistoryPane'

type SectionType = 'projects' | 'agents' | 'chats' | 'pinned' | 'skills' | 'scheduled' | 'workflows' | 'artifacts' | 'ratings' | 'work-history'

const SECTION_LABELS: Record<SectionType, string> = {
  projects: 'Projects',
  agents: 'Agents',
  chats: 'All Chats',
  pinned: 'Pinned Chats',
  skills: 'Skills',
  scheduled: 'Schedules',
  workflows: 'Automated Workflows',
  artifacts: 'Artifacts',
  ratings: 'Ratings',
  'work-history': 'Work history',
}

interface SectionPaneProps {
  section: SectionType
}

export function SectionPane({ section }: SectionPaneProps) {
  const setSectionPane = useAppStore((s) => s.setSectionPane)
  const setHistoryProjectId = useAppStore((s) => s.setHistoryProjectId)
  const historyProjectId = useAppStore((s) => s.historyProjectId)
  const historyAgentId = useAppStore((s) => s.historyAgentId)
  const setHistoryAgentId = useAppStore((s) => s.setHistoryAgentId)
  const projects = useAppStore((s) => s.projects)
  const agents = useAppStore((s) => s.agents)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const minWidth = section === 'chats' || (section === 'projects' && historyProjectId !== null)
    ? CHAT_HISTORY_PANE_MIN
    : PANE_MIN

  const getMaxSize = useCallback(() => Math.min(PANE_MAX, Math.floor(window.innerWidth * 0.32)), [])

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(minWidth, Math.min(getMaxSize(), size)))
  }, [getMaxSize, minWidth])

  const showingProjectHistory = section === 'projects' && historyProjectId !== null
  const historyProjectName = historyProjectId === '__none__'
    ? 'No project'
    : projects.find((p) => p.id === historyProjectId)?.name ?? 'Project'

  const showingAgentHistory = section === 'agents' && historyAgentId !== null
  const historyAgent = historyAgentId ? agents.find((a) => a.id === historyAgentId) : null
  const historyAgentName = historyAgent ? `${historyAgent.icon} ${historyAgent.name}` : 'Agent'

  const headerTitle = showingProjectHistory
    ? historyProjectName
    : showingAgentHistory
      ? historyAgentName
      : SECTION_LABELS[section]

  return (
    <div
      ref={containerRef}
      style={{ width }}
      className="relative flex flex-col min-h-0 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700"
      aria-label={`${SECTION_LABELS[section]} panel`}
    >
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {showingProjectHistory && (
            <button
              onClick={() => setHistoryProjectId(null)}
              className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
              aria-label="Back to projects"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          {showingAgentHistory && (
            <button
              onClick={() => setHistoryAgentId(null)}
              className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
              aria-label="Back to agents"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
            {headerTitle}
          </h2>
        </div>
        <button
          onClick={() => setSectionPane(section)}
          className="p-0.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={`Close ${SECTION_LABELS[section]} panel`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {section === 'projects' && !showingProjectHistory && <ProjectsPane />}
        {section === 'projects' && showingProjectHistory && <ProjectHistoryPane />}
        {section === 'agents' && !showingAgentHistory && <AgentsPane />}
        {section === 'agents' && showingAgentHistory && <AgentHistoryPane />}
        {section === 'chats' && <ChatsPane />}
        {section === 'pinned' && <PinnedChatsPane />}
        {section === 'skills' && <SkillsPane />}
        {section === 'scheduled' && <ScheduledPane />}
        {section === 'workflows' && <AutomatedWorkflowsPane />}
        {section === 'artifacts' && <ArtifactsPane />}
        {section === 'ratings' && <RatingsPane />}
        {section === 'work-history' && <WorkHistoryPane />}
      </div>

      <ResizeHandle
        direction="horizontal"
        containerRef={containerRef as React.RefObject<HTMLElement>}
        onSetSize={handleSetSize}
        align="end"
        minSize={minWidth}
        maxSize={getMaxSize}
      />
    </div>
  )
}
