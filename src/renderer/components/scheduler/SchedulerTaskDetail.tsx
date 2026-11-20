/* eslint-disable react-hooks/exhaustive-deps -- loadRuns is invoked only when the selected task changes. */
import { useState, useEffect } from 'react'
import { ArrowLeft, Play, Pause, Pencil, Trash2, MessageSquare, Loader2, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react'
import type { ScheduledTask, ScheduledRun } from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/primitives'

function statusIcon(status: ScheduledRun['status']) {
  switch (status) {
    case 'running': return <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
    case 'success': return <CheckCircle2 className="w-3 h-3 text-green-500" />
    case 'failed': return <XCircle className="w-3 h-3 text-red-500" />
    case 'approval_required': return <AlertTriangle className="w-3 h-3 text-amber-500" />
    default: return <Clock className="w-3 h-3 text-gray-400" />
  }
}

function formatTs(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

interface Props {
  task: ScheduledTask
  onBack: () => void
  onEdit: (task: ScheduledTask) => void
  onDeleted: () => void
  onTaskUpdated: (task: ScheduledTask) => void
}

export function SchedulerTaskDetail({ task, onBack, onEdit, onDeleted, onTaskUpdated }: Props) {
  const selectConversation = useAppStore((s) => s.selectConversation)
  const [runs, setRuns] = useState<ScheduledRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [running, setRunning] = useState(false)
  const [resumingId, setResumingId] = useState<string | null>(null)

  useEffect(() => {
    void loadRuns()
  }, [task.id])

  // Live updates
  useEffect(() => {
    const off = window.api.onSchedulerRunUpdated((run) => {
      if (run.taskId !== task.id) return
      setRuns((prev) => {
        const idx = prev.findIndex((r) => r.id === run.id)
        if (idx === -1) return [run, ...prev]
        const next = [...prev]; next[idx] = run; return next
      })
      if (run.status !== 'running' && run.status !== 'pending') setRunning(false)
      if (run.status !== 'running' && run.status !== 'pending' && run.id === resumingId) setResumingId(null)
    })
    return off
  }, [task.id, resumingId])

  async function loadRuns() {
    setLoadingRuns(true)
    try {
      const result = await window.api.schedulerListRuns(task.id)
      if (!isApiError(result)) setRuns(result)
    } finally {
      setLoadingRuns(false)
    }
  }

  async function handleRunNow() {
    setRunning(true)
    await window.api.schedulerRunNow(task.id)
  }

  async function handleResume(runId: string) {
    setResumingId(runId)
    const result = await window.api.schedulerResumeRun(runId)
    if (isApiError(result)) setResumingId(null)
  }

  async function handleToggleEnabled() {
    const result = await window.api.schedulerSetEnabled(task.id, !task.enabled)
    if (!isApiError(result)) onTaskUpdated(result)
  }

  async function handleDelete() {
    if (!confirm(`Delete "${task.name}"?`)) return
    const result = await window.api.schedulerDelete(task.id)
    if (!isApiError(result)) onDeleted()
  }

  const scheduleLabel = (() => {
    switch (task.scheduleType) {
      case 'daily': return `Daily at ${task.localTime}`
      case 'weekdays': return `Weekdays at ${task.localTime}`
      case 'weekly': {
        const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        return `Weekly on ${DAYS[task.weekday ?? 1]} at ${task.localTime}`
      }
      case 'monthly': return `Monthly on day ${task.monthDay} at ${task.localTime}`
      case 'one-time': return `Once at ${task.localTime}`
    }
  })()

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <button onClick={onBack} className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex-1 truncate">{task.name}</h3>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        {/* Task info */}
        <div className="rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          <div className="px-3 py-2">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Prompt</p>
            <p className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{task.prompt}</p>
          </div>
          <div className="px-3 py-2">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Schedule</p>
            <p className="text-xs text-gray-700 dark:text-gray-200">{scheduleLabel} ({task.timezone})</p>
          </div>
          {task.nextRunAt && task.enabled && (
            <div className="px-3 py-2">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Next run</p>
              <p className="text-xs text-gray-700 dark:text-gray-200">{formatTs(task.nextRunAt)}</p>
            </div>
          )}
          {task.lastRunAt && (
            <div className="px-3 py-2">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Last run</p>
              <p className="text-xs text-gray-700 dark:text-gray-200">{formatTs(task.lastRunAt)}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="primary"
            onClick={handleRunNow}
            disabled={running}
            className="gap-1.5 rounded-lg"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Run now
          </Button>
          <Button
            variant="secondary"
            onClick={handleToggleEnabled}
            className="gap-1.5 rounded-lg"
          >
            <Pause className="w-3 h-3" />
            {task.enabled ? 'Pause' : 'Resume'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => onEdit(task)}
            className="gap-1.5 rounded-lg"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </Button>
          {task.conversationId && (
            <Button
              variant="secondary"
              onClick={() => selectConversation(task.conversationId!)}
              className="gap-1.5 rounded-lg"
            >
              <MessageSquare className="w-3 h-3" />
              View thread
            </Button>
          )}
          <Button
            variant="danger"
            onClick={handleDelete}
            className="gap-1.5 rounded-lg border border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </Button>
        </div>

        {/* Run history */}
        <div>
          <h4 className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Run history</h4>
          {loadingRuns ? (
            <div className="space-y-1">
              {[1, 2].map((i) => <div key={i} className="h-8 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
            </div>
          ) : runs.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No runs yet</p>
          ) : (
            <div className="space-y-1">
              {runs.map((run) => (
                <div key={run.id} title={`${run.status.charAt(0).toUpperCase()}${run.status.slice(1)}${run.triggerSource === 'manual' ? ' (manual)' : ''}`} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-100 dark:border-gray-800">
                  {statusIcon(run.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-gray-700 dark:text-gray-200 capitalize">
                      {run.status}{run.triggerSource === 'manual' ? ' (manual)' : ''}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      {run.startedAt ? formatTs(run.startedAt) : formatTs(run.createdAt)}
                    </p>
                  </div>
                  {run.status === 'approval_required' && (
                    <button
                      onClick={() => void handleResume(run.id)}
                      disabled={resumingId === run.id}
                      className="text-[10px] font-medium px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
                    >
                      {resumingId === run.id ? 'Resuming…' : 'Approve & resume'}
                    </button>
                  )}
                  {run.error && (
                    <span className="text-[10px] text-red-400 truncate max-w-[120px]" title={run.error}>{run.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
