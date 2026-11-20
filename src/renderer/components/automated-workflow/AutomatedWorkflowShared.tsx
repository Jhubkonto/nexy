import { useEffect, useState } from 'react'
import { NexyIcon, type NexyIconName } from '../ui/icons/NexyIcon'
import type {
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowRunStatus,
  AutomatedWorkflowRunStep,
  AutomatedWorkflowRunSummary,
  WorkflowArtifactVersionContent,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { formatRelativeTime } from '../../../shared/utils'
import { StreamingFadeText } from '../chat/StreamingFadeText'

// Shared between the project-scoped AutomatedWorkflowTab.tsx and the global, top-level
// AutomatedWorkflowsPane.tsx — both render the same run/step shapes and need identical
// interactive behavior (agent/model badge, confirm/retry/skip/abort), so this is the single
// source of truth for that rendering rather than two copies drifting apart.

export function stripSpecTags(content: string): string {
  return content.replace(/<automated-workflow-spec>[\s\S]*?<\/automated-workflow-spec>/g, '').trim()
}

// The 4-stage flow, used identically in the generator modal's empty state and the pane/tab info
// panels — a single source of truth for the icons/wording so the two surfaces never drift apart.
// "Run it whenever you're ready" is deliberate: a saved plan sits as "Pending" indefinitely until
// the user presses Start — reviewing it does not commit you to running it immediately.
export const WORKFLOW_STAGES: { icon: NexyIconName; label: string }[] = [
  { icon: 'chat', label: 'Describe your goal' },
  { icon: 'spark', label: 'Review the generated plan' },
  { icon: 'play', label: 'Run it whenever you\'re ready — step-by-step or automatic' },
  { icon: 'refresh', label: 'Reuse it later with "Run again" — no need to re-describe the goal' },
]

export function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const displayContent = stripSpecTags(content)
  if (!displayContent) return null

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-nexy-sm border-2 border-nexy-accent bg-nexy-accent px-3 py-1.5 text-xs text-white whitespace-pre-wrap">
          {displayContent}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-nexy-sm border border-nexy-border bg-nexy-recessed px-3 py-1.5 text-xs text-nexy-text whitespace-pre-wrap">
        <StreamingFadeText text={displayContent} />
      </div>
    </div>
  )
}

export function StepStatusBadge({ status }: { status: AutomatedWorkflowRunStep['status'] }) {
  const config = {
    pending: { label: 'Not started', cls: 'text-nexy-muted', icon: 'scheduled' as NexyIconName },
    running: { label: 'Running…', cls: 'text-nexy-activity', icon: 'busy' as NexyIconName },
    awaiting_confirmation: { label: 'Needs review', cls: 'text-nexy-warning', icon: 'warning' as NexyIconName },
    done: { label: 'Done', cls: 'text-nexy-success', icon: 'check' as NexyIconName },
    failed: { label: 'Failed', cls: 'text-nexy-error', icon: 'error' as NexyIconName },
    skipped: { label: 'Skipped', cls: 'text-nexy-muted', icon: 'stop' as NexyIconName },
    cancelled: { label: 'Cancelled', cls: 'text-nexy-muted', icon: 'stop' as NexyIconName },
  }[status]
  return (
    <span className={`nexy-font-status flex shrink-0 items-center gap-1 ${config.cls}`}>
      <NexyIcon name={config.icon} className="w-3 h-3 shrink-0" />
      {config.label}
    </span>
  )
}

// Icon+label, no pill background — converges RunListRow's status indicator with ScheduledPane's
// own StatusBadge visual language instead of the colored-pill style this used to have.
export function RunStatusBadge({ status }: { status: AutomatedWorkflowRunStatus }) {
  const config = {
    pending: { label: 'Pending', cls: 'text-nexy-muted', icon: 'scheduled' as NexyIconName },
    running: { label: 'Active', cls: 'text-nexy-activity', icon: 'busy' as NexyIconName },
    awaiting_confirmation: { label: 'Active', cls: 'text-nexy-activity', icon: 'busy' as NexyIconName },
    done: { label: 'Completed', cls: 'text-nexy-success', icon: 'check' as NexyIconName },
    failed: { label: 'Failed', cls: 'text-nexy-error', icon: 'error' as NexyIconName },
    cancelled: { label: 'Cancelled', cls: 'text-nexy-muted', icon: 'stop' as NexyIconName },
  }[status]
  return (
    <span className={`nexy-font-status flex shrink-0 items-center gap-1 ${config.cls}`}>
      <NexyIcon name={config.icon} className="w-3 h-3 shrink-0" />
      {config.label}
    </span>
  )
}

export function ActionButton({
  onClick,
  disabled,
  variant = 'default',
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'danger'
  icon: NexyIconName
  children: React.ReactNode
}) {
  const variantCls = {
    default: 'border-2 border-nexy-border bg-nexy-raised text-nexy-text hover:bg-nexy-recessed',
    primary: 'border-2 border-nexy-accent bg-nexy-accent text-white hover:brightness-110',
    danger: 'border-2 border-nexy-error bg-nexy-raised text-nexy-error hover:bg-nexy-recessed',
  }[variant]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`nexy-font-status inline-flex items-center gap-1 rounded-nexy-sm px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantCls}`}
    >
      <NexyIcon name={icon} className="w-3 h-3" />
      {children}
    </button>
  )
}

function ManagedReviewCard({ step, header }: { step: AutomatedWorkflowRunStep; header: React.ReactNode }) {
  const versionId = step.managed?.currentVersion?.id ?? null
  const [version, setVersion] = useState<WorkflowArtifactVersionContent | null>(null)
  const [draft, setDraft] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!versionId) return
    let live = true
    window.api.getManagedWorkflowVersion(versionId).then((result) => {
      if (!live || !result || isApiError(result)) return
      setVersion(result)
      setDraft(result.content)
    }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [versionId])

  const perform = async (name: string, operation: () => Promise<unknown>) => {
    setBusyAction(name); setError(null)
    try {
      const result = await operation()
      if (isApiError(result)) throw new Error(result.error)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusyAction(null) }
  }

  const loadVersion = async (selectedVersionId: string) => {
    setBusyAction('version'); setError(null)
    try {
      const result = await window.api.getManagedWorkflowVersion(selectedVersionId)
      if (!result || isApiError(result)) throw new Error(result && isApiError(result) ? result.error : 'Version not found')
      setVersion(result); setDraft(result.content)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusyAction(null) }
  }

  return (
    <div className="space-y-2 rounded-nexy-sm border-2 border-nexy-warning bg-nexy-recessed px-3 py-2">
      {header}
      {step.managed?.isStale && <p className="text-[10px] font-medium text-nexy-error">This deliverable is out of date. Regenerate it before approval.</p>}
      {version && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-nexy-muted">
          <span>{version.version.title} · v{version.version.versionNumber}</span>
          {version.versions.map((candidate) => (
            <button key={candidate.id} type="button" disabled={busyAction !== null}
              onClick={() => void loadVersion(candidate.id)}
              className={`border px-1.5 py-0.5 ${candidate.id === version.version.id ? 'border-nexy-accent text-nexy-accent' : 'border-nexy-border'}`}>
              v{candidate.versionNumber}
            </button>
          ))}
        </div>
      )}
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={10}
        aria-label={`Managed Markdown for ${step.title}`}
        className="w-full resize-y rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2.5 py-2 font-mono text-[10px] text-nexy-text focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-warning" />
      {error && <p className="text-[10px] text-nexy-error">{error}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <ActionButton icon="edit" disabled={!versionId || busyAction !== null || draft === version?.content}
          onClick={() => void perform('save', () => window.api.editManagedWorkflowVersion({
            runId: step.runId, stepDbId: step.dbId, expectedVersionId: versionId!, content: draft, client: 'desktop',
          }))}>Save new version</ActionButton>
        <ActionButton icon="check" variant="primary" disabled={!versionId || busyAction !== null || step.managed?.isStale || draft !== version?.content || version?.version.id !== versionId}
          onClick={() => void perform('approve', () => window.api.reviewManagedWorkflowVersion({
            runId: step.runId, stepDbId: step.dbId, artifactVersionId: versionId!, decision: 'approved', client: 'desktop',
          }))}>Approve content</ActionButton>
        <ActionButton icon="error" disabled={!versionId || busyAction !== null}
          onClick={() => void perform('reject', () => window.api.reviewManagedWorkflowVersion({
            runId: step.runId, stepDbId: step.dbId, artifactVersionId: versionId!, decision: 'rejected', client: 'desktop',
          }))}>Reject</ActionButton>
        <ActionButton icon="refresh" disabled={busyAction !== null}
          onClick={() => void perform('regenerate', () => window.api.regenerateManagedWorkflowSteps(step.runId, step.dbId))}>
          Regenerate affected
        </ActionButton>
      </div>
      <details className="text-[10px] text-nexy-muted">
        <summary className="cursor-pointer">Version provenance</summary>
        <div className="mt-1 space-y-0.5 font-mono">
          {(step.managed?.bindings ?? []).map((binding) => (
            <p key={binding.id}>{binding.direction} · {binding.bindingName} · {binding.artifactVersionId.slice(0, 12)}{binding.staleAt ? ' · stale' : ''}</p>
          ))}
        </div>
      </details>
    </div>
  )
}

function ManagedPublishCard({ step, header }: { step: AutomatedWorkflowRunStep; header: React.ReactNode }) {
  const preview = step.managed?.publishPreview ?? null
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey] = useState(() => `${step.runId}:${step.dbId}:${preview?.id ?? 'preview'}`)
  const perform = async (name: string, operation: () => Promise<unknown>) => {
    setBusyAction(name); setError(null)
    try {
      const result = await operation()
      if (isApiError(result)) throw new Error(result.error)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusyAction(null) }
  }
  return (
    <div className="space-y-2 rounded-nexy-sm border-2 border-nexy-warning bg-nexy-recessed px-3 py-2">
      {header}
      <p className="text-[10px] text-nexy-muted">Publishing approved version {preview?.artifactVersionId.slice(0, 12)} to <span className="font-mono text-nexy-text">{preview?.relativePath}</span>.</p>
      {preview?.invalidatedAt && <p className="text-[10px] text-nexy-error">This preview is no longer valid. Refresh it before publishing.</p>}
      {preview && <pre className="max-h-72 overflow-auto whitespace-pre font-mono text-[10px] selectable rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-2 text-nexy-text">{preview.diffText || 'No content changes.'}</pre>}
      {step.managed?.publishAction && <p className="text-[10px] text-nexy-muted">Publish status: {step.managed.publishAction.status}{step.managed.publishAction.error ? ` · ${step.managed.publishAction.error}` : ''}</p>}
      {error && <p className="text-[10px] text-nexy-error">{error}</p>}
      <div className="flex flex-wrap gap-1">
        <ActionButton icon="refresh" disabled={!preview || busyAction !== null}
          onClick={() => void perform('preview', () => window.api.createManagedWorkflowPublishPreview({
            runId: step.runId, stepDbId: step.dbId, artifactVersionId: preview!.artifactVersionId,
          }))}>Refresh preview</ActionButton>
        <ActionButton icon="upload" variant="primary" disabled={!preview || Boolean(preview.invalidatedAt) || busyAction !== null}
          onClick={() => void perform('publish', () => window.api.confirmManagedWorkflowPublish({
            runId: step.runId, stepDbId: step.dbId, previewId: preview!.id, idempotencyKey, client: 'desktop',
          }))}>Confirm file write</ActionButton>
      </div>
    </div>
  )
}

export function StepCard({
  step,
  confirmationMode,
  waitingOn,
  streamingText,
  busy,
  onApprove,
  onRetry,
  onSkip,
  onOpenConversation,
}: {
  step: AutomatedWorkflowRunStep
  confirmationMode: AutomatedWorkflowConfirmationMode
  waitingOn?: string[]
  streamingText?: string
  busy: boolean
  onApprove: (step: AutomatedWorkflowRunStep, editedOutput: string) => void
  onRetry: (step: AutomatedWorkflowRunStep) => void
  onSkip: (step: AutomatedWorkflowRunStep) => void
  onOpenConversation: (conversationId: string) => void
}) {
  const [draftOutput, setDraftOutput] = useState(step.output)
  useEffect(() => {
    setDraftOutput(step.output)
  }, [step.dbId, step.output])

  // Exactly one of agentName/model applies — a step is fulfilled by EITHER an agent (its own
  // attached skills apply) OR a bare model (no skills at all). Never show both, never neither.
  const fulfilledByLabel = step.agentName
    ? step.agentName
    : step.model
      ? `Model: ${step.model}`
      : step.kind === 'collect' || step.kind === 'review' || step.kind === 'publish'
        ? 'Nexy managed step'
        : 'Unassigned'

  const header = (
    <div title={`${step.stepIndex + 1}. ${step.title}`} className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">
          {step.stepIndex + 1}. {step.title}
        </p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {step.kind ? `${step.kind[0].toUpperCase()}${step.kind.slice(1)} · ` : ''}{fulfilledByLabel}{step.expectedOutput ? ` · Output: ${step.expectedOutput}` : ''}
        </p>
        {waitingOn && waitingOn.length > 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Waiting on: {waitingOn.join(', ')}</p>
        )}
      </div>
      <StepStatusBadge status={step.status} />
    </div>
  )

  const openConversationButton = step.conversationId ? (
    <ActionButton icon="chat" onClick={() => onOpenConversation(step.conversationId!)}>
      Open conversation
    </ActionButton>
  ) : null

  if (step.kind === 'review' && step.status === 'awaiting_confirmation') {
    return <ManagedReviewCard step={step} header={header} />
  }
  if (step.kind === 'publish' && step.status === 'awaiting_confirmation') {
    return <ManagedPublishCard step={step} header={header} />
  }

  if (step.status === 'running') {
    return (
      <div className="space-y-2 rounded-nexy-sm border-2 border-nexy-activity bg-nexy-recessed px-3 py-2">
        {header}
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-nexy-sm border border-nexy-border bg-nexy-raised px-2.5 py-2 text-[10px] text-nexy-text">
          {streamingText || 'Starting…'}
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse align-middle bg-nexy-activity" />
        </pre>
      </div>
    )
  }

  if (step.status === 'awaiting_confirmation') {
    // In 'auto' mode the executor self-confirms this step immediately after writing this status
    // (see advanceAutomatedWorkflowRun) — it's a transient snapshot of what just happened, not a
    // real checkpoint. Showing an editable Approve UI here would let a click race the executor's
    // own auto-advance and misfire against whatever step is running by the time it lands.
    if (confirmationMode === 'auto') {
      return (
        <div className="space-y-2 rounded-nexy-sm border-2 border-nexy-warning bg-nexy-recessed px-3 py-2">
          {header}
          <p className="text-[10px] text-amber-600 dark:text-amber-400">Advancing automatically…</p>
        </div>
      )
    }
    return (
      <div className="space-y-2 rounded-nexy-sm border-2 border-nexy-warning bg-nexy-recessed px-3 py-2">
        {header}
        <textarea
          value={draftOutput}
          onChange={(e) => setDraftOutput(e.target.value)}
          rows={4}
          aria-label={`Output for step ${step.stepIndex + 1}`}
          className="w-full resize-y rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2.5 py-2 text-[10px] text-nexy-text focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-warning"
        />
        <div className="flex items-center gap-1 flex-wrap">
          <ActionButton icon="check" variant="primary" disabled={busy} onClick={() => onApprove(step, draftOutput)}>
            Approve &amp; continue
          </ActionButton>
          {openConversationButton}
        </div>
      </div>
    )
  }

  if (step.status === 'failed') {
    return (
      <div className="space-y-2 rounded-nexy-sm border-2 border-nexy-error bg-nexy-recessed px-3 py-2">
        {header}
        {step.error && <p className="text-[10px] text-red-600 dark:text-red-400">{step.error}</p>}
        <div className="flex items-center gap-1 flex-wrap">
          <ActionButton icon="refresh" disabled={busy} onClick={() => onRetry(step)}>Retry</ActionButton>
          {(!step.kind || step.kind === 'model') && <ActionButton icon="chevron-right" disabled={busy} onClick={() => onSkip(step)}>Skip</ActionButton>}
          {openConversationButton}
        </div>
      </div>
    )
  }

  if (step.status === 'done') {
    return (
      <details className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-gray-700 dark:text-gray-200 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate">{step.stepIndex + 1}. {step.title}</span>
          <StepStatusBadge status={step.status} />
        </summary>
        <div className="mt-2 space-y-2">
          {step.output && (
            <pre className="whitespace-pre-wrap rounded-nexy-sm border border-nexy-border bg-nexy-recessed px-2.5 py-2 text-[10px] text-nexy-text">
              {step.output}
            </pre>
          )}
          {step.managed?.currentVersion && (
            <p className="text-[10px] text-nexy-muted">Artifact: {step.managed.currentVersion.title} · v{step.managed.currentVersion.versionNumber} · {step.managed.currentVersion.checksum?.slice(0, 12) ?? 'checksum unavailable'}</p>
          )}
          {openConversationButton && <div className="flex">{openConversationButton}</div>}
        </div>
      </details>
    )
  }

  if (step.status === 'skipped') {
    return (
      <div className="space-y-1 rounded-nexy-sm border border-nexy-border px-3 py-2 opacity-70">
        {header}
        <p className="text-[10px] text-gray-500 dark:text-gray-400 italic">You skipped this step.</p>
      </div>
    )
  }

  if (step.status === 'cancelled') {
    return (
      <div className="space-y-1 rounded-nexy-sm border border-nexy-border px-3 py-2 opacity-70">
        {header}
        <p className="text-[10px] text-gray-500 dark:text-gray-400 italic">This step was cancelled.</p>
      </div>
    )
  }

  // pending
  return (
    <div className="space-y-1 rounded-nexy-sm border border-nexy-border px-3 py-2 opacity-80">
      {header}
      {step.summary && <p className="text-[11px] text-gray-600 dark:text-gray-300">{step.summary}</p>}
    </div>
  )
}

export function ConfirmationModeToggle({
  mode,
  disabled,
  onChange,
}: {
  mode: AutomatedWorkflowConfirmationMode
  disabled: boolean
  onChange: (mode: AutomatedWorkflowConfirmationMode) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-nexy-sm border-2 border-nexy-border text-[10px]">
      {(['gated', 'auto'] as const).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value)}
          aria-pressed={mode === value}
          className={`px-2 py-1 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            mode === value
              ? 'bg-nexy-accent text-white'
              : 'bg-nexy-raised text-nexy-text hover:bg-nexy-recessed'
          }`}
        >
          {value === 'gated' ? 'Confirm each step' : 'Run automatically'}
        </button>
      ))}
    </div>
  )
}

export function RunListRow({
  run,
  projectName,
  onOpen,
  onDiscard,
}: {
  run: AutomatedWorkflowRunSummary
  /** Shown as a badge when provided — the global pane passes "Project: X" / "Global"; the
   *  project-scoped tab's list (which is always exactly one project) omits it. */
  projectName?: string
  onOpen: () => void
  onDiscard: () => void
}) {
  const { total, done, running, awaitingConfirmation } = run.stepCounts
  const inProgress = running + awaitingConfirmation
  return (
    <div
      title={run.title}
      onClick={onOpen}
      className="cursor-pointer space-y-1 rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-3 py-2.5 transition-colors hover:bg-nexy-recessed"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{run.title}</p>
        <RunStatusBadge status={run.status} />
      </div>
      {run.goalSummary && <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1">{run.goalSummary}</p>}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {done}/{total} steps done{inProgress > 0 ? ` · ${inProgress} in progress` : ''}
        </span>
        <div className="flex items-center gap-2">
          {projectName && (
            <span className="nexy-font-status border border-nexy-border bg-nexy-recessed px-1.5 py-0.5 text-nexy-muted">
              {projectName}
            </span>
          )}
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Updated {formatRelativeTime(run.updatedAt)}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDiscard() }}
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
            aria-label="Discard workflow plan"
          >
            <NexyIcon name="delete" className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
