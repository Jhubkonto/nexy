import { useState, useEffect, useCallback, useRef } from 'react'
import { NexyIcon, type NexyIconName } from '../ui/icons/NexyIcon'
import type { ScheduledTask, ScheduledRun } from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { SchedulerTaskForm } from '../scheduler/SchedulerTaskForm'
import { SchedulerTaskDetail } from '../scheduler/SchedulerTaskDetail'
import { PaneSkeleton } from './pane-primitives'

type FilterTab = 'active' | 'paused' | 'all'

function formatNextRun(nextRunAt: number | null): string {
  if (!nextRunAt) return '—'
  const diff = nextRunAt - Date.now()
  if (diff < 0) return 'Overdue'
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `in ${days}d ${hours % 24}h`
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`
  return `in ${minutes}m`
}

function StatusBadge({ status }: { status: ScheduledRun['status'] | 'idle' }) {
  const configs = {
    idle: { label: 'Idle', cls: 'text-nexy-muted', icon: 'scheduled' as NexyIconName },
    pending: { label: 'Pending', cls: 'text-nexy-activity', icon: 'busy' as NexyIconName },
    running: { label: 'Running', cls: 'text-nexy-activity', icon: 'busy' as NexyIconName },
    approval_required: { label: 'Approval needed', cls: 'text-nexy-warning', icon: 'warning' as NexyIconName },
    success: { label: 'Success', cls: 'text-nexy-success', icon: 'check' as NexyIconName },
    failed: { label: 'Failed', cls: 'text-nexy-error', icon: 'error' as NexyIconName },
    skipped: { label: 'Skipped', cls: 'text-nexy-muted', icon: 'scheduled' as NexyIconName },
  }
  const { label, cls, icon } = configs[status] ?? configs.idle
  return (
    <span className={`nexy-font-status flex items-center gap-1 ${cls}`}>
      <NexyIcon name={icon} className="w-3 h-3 shrink-0" />
      {label}
    </span>
  )
}

export function ScheduledPane() {
  const hydratedTasks = useAppStore((s) => s.schedulerTasks)
  const setSchedulerTasks = useAppStore((s) => s.setSchedulerTasks)
  const setShowSchedulerGenerator = useAppStore((s) => s.setShowSchedulerGenerator)
  const schedulerTaskFormRequestId = useAppStore((s) => s.schedulerTaskFormRequestId)
  const [tasks, setTasks] = useState<ScheduledTask[]>(hydratedTasks)
  const [filter, setFilter] = useState<FilterTab>('active')
  const [loading, setLoading] = useState(hydratedTasks.length === 0)
  const [lastRunStatus, setLastRunStatus] = useState<Record<string, ScheduledRun['status']>>({})

  const [showForm, setShowForm] = useState(false)
  const [editTask, setEditTask] = useState<ScheduledTask | null>(null)
  const [detailTask, setDetailTask] = useState<ScheduledTask | null>(null)
  const lastFormRequestId = useRef(schedulerTaskFormRequestId)

  useEffect(() => {
    if (schedulerTaskFormRequestId === lastFormRequestId.current) return
    lastFormRequestId.current = schedulerTaskFormRequestId
    setEditTask(null)
    setDetailTask(null)
    setShowForm(true)
  }, [schedulerTaskFormRequestId])

  const loadTasks = useCallback(async () => {
    try {
      const result = await window.api.schedulerList()
      if (!isApiError(result)) {
        setTasks(result)
        setSchedulerTasks(result)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [setSchedulerTasks])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  // Live updates from the engine
  useEffect(() => {
    const offTask = window.api.onSchedulerTaskUpdated((task) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === task.id)
        if (idx === -1) return [task, ...prev]
        const next = [...prev]
        next[idx] = task
        return next
      })
      if (detailTask?.id === task.id) setDetailTask(task)
    })
    const offDel = window.api.onSchedulerTaskDeleted((taskId) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      if (detailTask?.id === taskId) setDetailTask(null)
    })
    const offRun = window.api.onSchedulerRunUpdated((run) => {
      setLastRunStatus((prev) => ({ ...prev, [run.taskId]: run.status }))
    })
    return () => { offTask(); offDel(); offRun() }
  }, [detailTask])

  const filtered = tasks.filter((t) => {
    if (filter === 'active') return t.enabled
    if (filter === 'paused') return !t.enabled
    return true
  })

  const handleDelete = async (task: ScheduledTask) => {
    if (!confirm(`Delete "${task.name}"?`)) return
    const result = await window.api.schedulerDelete(task.id)
    if (!isApiError(result)) {
      setTasks((prev) => prev.filter((t) => t.id !== task.id))
      if (detailTask?.id === task.id) setDetailTask(null)
    }
  }

  const handleToggleEnabled = async (task: ScheduledTask) => {
    const result = await window.api.schedulerSetEnabled(task.id, !task.enabled)
    if (!isApiError(result)) {
      setTasks((prev) => prev.map((t) => t.id === result.id ? result : t))
      if (detailTask?.id === result.id) setDetailTask(result)
    }
  }

  const handleRunNow = async (task: ScheduledTask) => {
    setLastRunStatus((prev) => ({ ...prev, [task.id]: 'pending' }))
    await window.api.schedulerRunNow(task.id)
  }

  const handleFormSave = (saved: ScheduledTask) => {
    const mergeSavedTask = (prev: ScheduledTask[]) => {
      const idx = prev.findIndex((t) => t.id === saved.id)
      if (idx === -1) return [saved, ...prev]
      const next = [...prev]
      next[idx] = saved
      return next
    }
    setTasks((prev) => {
      return mergeSavedTask(prev)
    })
    setSchedulerTasks(mergeSavedTask(useAppStore.getState().schedulerTasks))
    void loadTasks()
    setShowForm(false)
    setEditTask(null)
  }

  if (detailTask) {
    return (
      <SchedulerTaskDetail
        task={detailTask}
        onBack={() => setDetailTask(null)}
        onEdit={(t) => { setEditTask(t); setShowForm(true); setDetailTask(null) }}
        onDeleted={() => { setTasks((prev) => prev.filter((t) => t.id !== detailTask.id)); setDetailTask(null) }}
        onTaskUpdated={(t) => setDetailTask(t)}
      />
    )
  }

  if (loading) {
    return (
      <>
        <PaneSkeleton rows={3} rowHeight="h-14" />
        {showForm && (
          <SchedulerTaskForm
            initial={editTask}
            onSave={handleFormSave}
            onCancel={() => { setShowForm(false); setEditTask(null) }}
          />
        )}
      </>
    )
  }

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSchedulerGenerator(true)}
            className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            aria-label="Generate scheduled task with AI"
          >
            <NexyIcon name="spark" className="w-3.5 h-3.5" />
            Generate
          </button>
          <button
            onClick={() => { setEditTask(null); setShowForm(true) }}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Create scheduled task"
          >
            <NexyIcon name="add" className="w-3.5 h-3.5" />
            New
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        {(['active', 'paused', 'all'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors capitalize ${
              filter === tab
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
        <button
          onClick={loadTasks}
          className="ml-auto rounded-nexy-sm border border-transparent p-1 text-nexy-muted hover:border-nexy-border hover:bg-nexy-raised hover:text-nexy-text"
          title="Refresh"
        >
          <NexyIcon name="refresh" className="w-3 h-3" />
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center italic pt-8">
            {filter === 'active' ? 'No active scheduled tasks' : filter === 'paused' ? 'No paused tasks' : 'No scheduled tasks'}
          </p>
        )}
        {filtered.map((task) => {
          const runStatus = lastRunStatus[task.id] ?? 'idle'
          return (
            <div
              key={task.id}
              title={task.name}
              className="group flex cursor-pointer flex-col gap-1 rounded-nexy-sm border border-transparent px-3 py-2 transition-colors hover:border-nexy-border hover:bg-nexy-recessed"
              onClick={() => setDetailTask(task)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{task.name}</span>
                <StatusBadge status={runStatus as ScheduledRun['status'] | 'idle'} />
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1">{task.prompt}</p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {task.enabled ? `Next: ${formatNextRun(task.nextRunAt)}` : 'Paused'}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleRunNow(task)}
                    className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    title="Run now"
                  >
                    <NexyIcon name="play" className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleToggleEnabled(task)}
                    className="p-1 rounded text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    title={task.enabled ? 'Pause' : 'Resume'}
                  >
                    <NexyIcon name={task.enabled ? 'pause' : 'play'} className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => { setEditTask(task); setShowForm(true) }}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Edit"
                  >
                    <NexyIcon name="edit" className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(task)}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Delete"
                  >
                    <NexyIcon name="delete" className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

    </div>
    {showForm && (
      <SchedulerTaskForm
        initial={editTask}
        onSave={handleFormSave}
        onCancel={() => { setShowForm(false); setEditTask(null) }}
      />
    )}
    </>
  )
}
