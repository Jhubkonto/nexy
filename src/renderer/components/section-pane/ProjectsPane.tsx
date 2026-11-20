import { useEffect, useDeferredValue, useMemo, useState } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { useAppStore } from '../../store/app-store'
import type { ProjectAgent } from '../../store/types'
import { DeleteProjectDialog } from '../DeleteProjectDialog'
import { PROJECT_COLOR_MAP, AgentAvatarStack, projectColorHex } from './shared'
import { PaneEmptyState } from './pane-primitives'

export function ProjectsPane() {
  const projects = useAppStore((s) => s.projects)
  const conversations = useAppStore((s) => s.conversations)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const pendingSettingsProjectId = useAppStore((s) => s.pendingSettingsProjectId)
  const selectProject = useAppStore((s) => s.selectProject)
  const renameProject = useAppStore((s) => s.renameProject)
  const deleteProject = useAppStore((s) => s.deleteProject)
  const loadProjectAgents = useAppStore((s) => s.loadProjectAgents)
  const loadProjectConfig = useAppStore((s) => s.loadProjectConfig)
  const clearPendingSettingsProject = useAppStore((s) => s.clearPendingSettingsProject)
  const setShowNewProjectForm = useAppStore((s) => s.setShowNewProjectForm)
  const setShowProjectGenerator = useAppStore((s) => s.setShowProjectGenerator)
  const openEditProject = useAppStore((s) => s.openEditProject)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const setProjectPrimaryAgent = useAppStore((s) => s.setProjectPrimaryAgent)
  const agents = useAppStore((s) => s.agents)
  const addToast = useAppStore((s) => s.addToast)

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null)
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    projects.forEach((p) => {
      loadProjectAgents(p.id)
      loadProjectConfig(p.id)
    })
  }, [projects, loadProjectAgents, loadProjectConfig])

  useEffect(() => {
    if (!pendingSettingsProjectId) return
    openEditProject(pendingSettingsProjectId)
    clearPendingSettingsProject()
  }, [pendingSettingsProjectId, openEditProject, clearPendingSettingsProject])

  const chatCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of conversations) {
      if (c.project_id) map.set(c.project_id, (map.get(c.project_id) ?? 0) + 1)
    }
    return map
  }, [conversations])

  const handleRename = async (id: string) => {
    const name = renameTitle.trim()
    if (name) await renameProject(id, name)
    setRenamingId(null)
  }

  const filtered = useMemo(
    () => deferredQuery ? projects.filter((p) => p.name.toLowerCase().includes(deferredQuery.toLowerCase())) : projects,
    [projects, deferredQuery]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex h-9 items-center justify-between border-b border-nexy-border px-4">
        <span className="nexy-font-status text-nexy-muted">
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowProjectGenerator(true)}
            className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            aria-label="Generate project with AI"
          >
            <NexyIcon name="spark" className="w-3.5 h-3.5" />
            Generate
          </button>
          <button
            onClick={() => setShowNewProjectForm(true)}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Create new project"
          >
            <NexyIcon name="add" className="w-3.5 h-3.5" />
            New
          </button>
        </div>
      </div>

      <div className="border-b border-nexy-border px-3 py-2">
        <div className="relative">
          <NexyIcon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects..."
            className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-1.5 pl-8 pr-7 text-xs text-nexy-text outline-none transition-colors placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Clear search"
            >
              <NexyIcon name="close" className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-0.5">
        {filtered.map((project) => {
          const colors = PROJECT_COLOR_MAP[project.color] ?? PROJECT_COLOR_MAP.blue
          const isActive = activeProjectId === project.id
          const count = chatCountMap.get(project.id) ?? 0
          const isRenaming = renamingId === project.id
          const members: ProjectAgent[] = projectAgents[project.id] ?? []
          const isDragTarget = dragOverProjectId === project.id

          return (
            <div
              key={project.id}
              title={project.name}
              data-project-id={project.id}
              className={`group relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-nexy-sm border transition-colors ${
                isActive
                  ? `${colors.bg} ring-1 ${colors.ring} border-transparent`
                  : isDragTarget
                    ? 'border-nexy-activity bg-nexy-recessed'
                    : 'border-transparent hover:border-nexy-border hover:bg-nexy-recessed'
              }`}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('agent-id') || e.dataTransfer.types.includes('sidebar-agent-id')) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  setDragOverProjectId(project.id)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverProjectId(null)
                }
              }}
              onDrop={async (e) => {
                const agentId = e.dataTransfer.getData('agent-id') || e.dataTransfer.getData('sidebar-agent-id')
                if (!agentId) return
                e.preventDefault()
                setDragOverProjectId(null)
                const agent = agents.find((a) => a.id === agentId)
                const alreadyMember = (projectAgents[project.id] ?? []).some((m) => m.agentId === agentId)
                if (alreadyMember) {
                  if (agent) addToast(`${agent.name} is already in ${project.name}`, 'info')
                  return
                }
                const currentMembers = projectAgents[project.id] ?? []
                await addAgentToProject(project.id, agentId)
                if (currentMembers.length === 0 && agent) {
                  await setProjectPrimaryAgent(project.id, agentId)
                }
                if (agent) addToast(`🤖 ${agent.name} added to ${project.name}`, 'success')
              }}
              onClick={() => !isRenaming && selectProject(project.id)}
            >
              <div className={`w-1 self-stretch shrink-0 ${colors.dot}`} style={{ backgroundColor: projectColorHex(project.color) }} />

              <NexyIcon name="project" className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-nexy-text' : 'text-nexy-muted'}`} />

              <div className="flex-1 min-w-0 py-2">
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameTitle}
                    onChange={(e) => setRenameTitle(e.target.value)}
                    onBlur={() => handleRename(project.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(project.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded-nexy-sm border border-nexy-accent bg-nexy-raised px-1 py-0.5 text-xs text-nexy-text focus:outline-none"
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{project.name}</p>
                  </div>
                )}
                <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                  {members.length === 0 ? 'No agents' : `${members.length} agent${members.length !== 1 ? 's' : ''}`}
                  {' · '}
                  {count === 0 ? 'No chats' : `${count} chat${count !== 1 ? 's' : ''}`}
                </p>
              </div>

              <AgentAvatarStack members={members} />

              <div className="invisible group-hover:visible flex items-center gap-0.5 pr-2 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openEditProject(project.id)
                  }}
                  className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                  title="Project settings"
                  aria-label="Edit project settings"
                >
                  <NexyIcon name="settings" className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDeleteProject({ id: project.id, name: project.name }) }}
                  className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  title="Delete project"
                  aria-label="Delete project"
                >
                  <NexyIcon name="delete" className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && deferredQuery ? (
          <PaneEmptyState>
            No projects match "{deferredQuery}"
          </PaneEmptyState>
        ) : projects.length === 0 && (
          <PaneEmptyState>
            No projects yet — create one to organise your chats
          </PaneEmptyState>
        )}
      </div>

      {pendingDeleteProject && (
        <DeleteProjectDialog
          projectName={pendingDeleteProject.name}
          onConfirm={async (deleteChats) => {
            await deleteProject(pendingDeleteProject.id, deleteChats)
            setPendingDeleteProject(null)
          }}
          onCancel={() => setPendingDeleteProject(null)}
        />
      )}
    </div>
  )
}
