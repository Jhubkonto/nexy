import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { useAppStore } from '../../store/app-store'
import type { AgentConfig } from '../../../shared/types'
import { useClickOutside } from '../../hooks/useClickOutside'
import { PaneSkeleton, PaneEmptyState } from './pane-primitives'

export function AgentsPane() {
  const agents = useAppStore((s) => s.agents)
  const agentsLoading = useAppStore((s) => s.agentsLoading)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const setHistoryAgentId = useAppStore((s) => s.setHistoryAgentId)
  const openEditAgent = useAppStore((s) => s.openEditAgent)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const importAgent = useAppStore((s) => s.importAgent)
  const deleteAgent = useAppStore((s) => s.deleteAgent)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const projects = useAppStore((s) => s.projects)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const addToast = useAppStore((s) => s.addToast)
  const setShowAgentGenerator = useAppStore((s) => s.setShowAgentGenerator)

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [addToProjectAgentId, setAddToProjectAgentId] = useState<string | null>(null)
  const addToProjectPopoverRef = useRef<HTMLDivElement>(null)

  useClickOutside(addToProjectPopoverRef, () => setAddToProjectAgentId(null), addToProjectAgentId !== null)

  const handleAddToProject = async (projectId: string, agent: AgentConfig) => {
    await addAgentToProject(projectId, agent.id)
    const projectName = projects.find((p) => p.id === projectId)?.name ?? 'project'
    addToast(`🤖 ${agent.name} added to ${projectName}`, 'success')
    setAddToProjectAgentId(null)
  }

  const filtered = useMemo(
    () => deferredQuery ? agents.filter((a) => a.name.toLowerCase().includes(deferredQuery.toLowerCase())) : agents,
    [agents, deferredQuery]
  )

  if (agentsLoading) {
    return (
      <PaneSkeleton rows={4} rowHeight="h-9" />
    )
  }

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="flex h-9 items-center justify-between border-b border-nexy-border px-4">
        <span className="nexy-font-status text-nexy-muted">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={importAgent}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Import agent"
          >
            <NexyIcon name="upload" className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={() => setShowAgentGenerator(true)}
            className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            aria-label="Generate agent with AI"
          >
            <NexyIcon name="spark" className="w-3.5 h-3.5" />
            Generate
          </button>
          <button
            onClick={openCreateAgent}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Create new agent"
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
            placeholder="Search agents..."
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
        {!query && (
        <div
          onClick={() => selectAgent(null)}
          className={`flex cursor-pointer items-center gap-2 rounded-nexy-sm border px-2 py-2 transition-colors ${
            activeAgentId === null
              ? 'border-nexy-accent bg-nexy-recessed'
              : 'border-transparent hover:border-nexy-border hover:bg-nexy-recessed'
          }`}
        >
          <NexyIcon name="chat" className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">No Agent</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Direct chat</p>
          </div>
        </div>
        )}

        {filtered.length === 0 && deferredQuery ? (
          <PaneEmptyState>
            No agents match "{deferredQuery}"
          </PaneEmptyState>
        ) : agents.length === 0 ? (
          <PaneEmptyState>
            No agents configured — create one to get started
          </PaneEmptyState>
        ) : filtered.map((agent: AgentConfig) => {
          const isActive = activeAgentId === agent.id
          const isPopoverOpen = addToProjectAgentId === agent.id
          return (
            <div key={agent.id} className="relative">
              <div
                data-agent-id={agent.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('agent-id', agent.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => setHistoryAgentId(agent.id)}
                className={`group flex cursor-grab items-center gap-2 rounded-nexy-sm border px-2 py-2 transition-colors active:cursor-grabbing ${
                  isActive
                    ? 'border-nexy-accent bg-nexy-recessed'
                    : 'border-transparent hover:border-nexy-border hover:bg-nexy-recessed'
                }`}
                title={agent.name}
              >
                <span title="Drag onto a project to add this agent to its team" className="text-base leading-none shrink-0">{agent.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{agent.name}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                    uses your model setting
                  </p>
                </div>
                <div className={`flex items-center gap-0.5 shrink-0 ${isPopoverOpen ? 'visible' : 'invisible group-hover:visible'}`}>
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditAgent(agent.id) }}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Edit agent"
                    aria-label={`Edit ${agent.name}`}
                  >
                    <NexyIcon name="settings" className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setAddToProjectAgentId(isPopoverOpen ? null : agent.id)
                    }}
                    className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    title="Add to project"
                    aria-label={`Add ${agent.name} to project`}
                  >
                    <NexyIcon name="project" className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteAgent(agent.id) }}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Delete agent"
                    aria-label={`Delete ${agent.name}`}
                  >
                    <NexyIcon name="delete" className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {isPopoverOpen && (
                <div
                  ref={addToProjectPopoverRef}
                  className="nexy-hard-shadow absolute right-0 top-full z-20 mt-1 w-48 rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                    Add to project
                  </p>
                  {projects.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400 italic">No projects yet</p>
                  ) : projects.map((project) => {
                    const alreadyMember = (projectAgents[project.id] ?? []).some((m) => m.agentId === agent.id)
                    return (
                      <div key={project.id} title={project.name}>
                        <button
                          type="button"
                          disabled={alreadyMember}
                          onClick={() => { if (!alreadyMember) handleAddToProject(project.id, agent) }}
                          className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                            alreadyMember
                              ? 'text-gray-300 dark:text-gray-600 cursor-default'
                              : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                          aria-label={alreadyMember ? `${agent.name} already in ${project.name}` : `Add ${agent.name} to ${project.name}`}
                        >
                          {alreadyMember && <NexyIcon name="check" className="w-3 h-3 text-nexy-success shrink-0" />}
                          <span className="truncate">{project.name}</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    </>
  )
}

