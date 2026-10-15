import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import { broadcastToMobile } from './ws-server'
import { startActivity, endActivity } from './activity-tracker'
import { runAgentTurn } from './agent-turn-runner'
import { createConversationRecord } from './conversation-handlers'
import { getAutomatedWorkflowGeneratorModel } from './automated-workflow-generator'
import { getAutomatedWorkflowRun } from './automated-workflow-runs'
import type {
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowRunStep,
  AutomatedWorkflowStep,
} from '../shared/types'

// ---- Pure helpers, ported from the abandoned workflow-executor.ts (git commit cda1f46) ----
// Adapted to operate on the persisted AutomatedWorkflowStep shape directly instead of an
// in-memory snapshot object, since this module persists at every transition via SQL rather than
// threading an immutable snapshot through a pure reducer.

const DEFAULT_CONTEXT_LIMIT = 6000

function dependencyIds(step: Pick<AutomatedWorkflowStep, 'dependsOnStepIds'>): string[] {
  return Array.isArray(step.dependsOnStepIds)
    ? step.dependsOnStepIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
}

export function orderWorkflowSteps<T extends AutomatedWorkflowStep>(steps: T[]): T[] {
  const byId = new Map<string, T>()
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const step of steps) {
    if (!step.id) throw new Error('Workflow step is missing an id')
    if (byId.has(step.id)) throw new Error(`Duplicate workflow step id: ${step.id}`)
    byId.set(step.id, step)
    inDegree.set(step.id, 0)
    dependents.set(step.id, [])
  }

  for (const step of steps) {
    for (const depId of dependencyIds(step)) {
      if (!byId.has(depId)) {
        throw new Error(`Workflow step "${step.id}" depends on missing step "${depId}"`)
      }
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1)
      dependents.get(depId)?.push(step.id)
    }
  }

  const queue = steps.filter((step) => (inDegree.get(step.id) ?? 0) === 0).map((step) => step.id)
  const ordered: T[] = []

  while (queue.length > 0) {
    const id = queue.shift() as string
    const step = byId.get(id)
    if (!step) continue
    ordered.push(step)

    for (const childId of dependents.get(id) ?? []) {
      const nextDegree = (inDegree.get(childId) ?? 0) - 1
      inDegree.set(childId, nextDegree)
      if (nextDegree === 0) queue.push(childId)
    }
  }

  if (ordered.length !== steps.length) {
    throw new Error('Workflow contains a dependency cycle')
  }

  return ordered
}

function truncateContext(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trimEnd()}\n\n[context truncated]`
}

/**
 * Weaves completed-dependency output into a step's prompt. `completedStepsById` must already
 * contain an entry for every dependency — including skipped ones (the caller is responsible for
 * seeding a synthetic "no output available" entry for skipped steps; this function doesn't need
 * to know the difference between "done" and "skipped", it just needs *some* output text).
 */
export function weaveStepPrompt(
  step: Pick<AutomatedWorkflowStep, 'id' | 'prompt' | 'dependsOnStepIds'>,
  completedStepsById: Map<string, { id: string; title: string; output: string }>,
  contextLimit = DEFAULT_CONTEXT_LIMIT,
): string {
  const deps = dependencyIds(step)
  if (deps.length === 0) return step.prompt

  const contextBlocks = deps.map((depId) => {
    const dep = completedStepsById.get(depId)
    if (!dep) {
      throw new Error(`Workflow step "${step.id}" cannot start before dependency "${depId}" completes`)
    }
    return [
      `## Context from step '${dep.title}'`,
      truncateContext(dep.output, contextLimit),
    ].join('\n\n')
  })

  return [
    ...contextBlocks,
    '## Your task:',
    step.prompt,
  ].join('\n\n')
}

export function getDownstreamWorkflowStepIds(steps: AutomatedWorkflowStep[], stepId: string): Set<string> {
  const downstream = new Set<string>([stepId])
  let changed = true
  while (changed) {
    changed = false
    for (const step of steps) {
      if (downstream.has(step.id)) continue
      if (dependencyIds(step).some((depId) => downstream.has(depId))) {
        downstream.add(step.id)
        changed = true
      }
    }
  }
  return downstream
}

// ---- Stateful, DB-backed runner ----

// Best-effort abort signal, checked at loop boundaries between steps and again right before a
// step's result is persisted (the race guard) — this module never attempts to cancel an in-flight
// HTTP call to a provider, only to stop the run from *starting* another step and to discard a
// result that arrives after the user already aborted.
const abortedRuns = new Set<string>()

function notifyRunChanged(run: AutomatedWorkflowRunDetail): void {
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) {
        w.webContents.send('automated-workflow-runs:detail', run)
        w.webContents.send('automated-workflow-runs:changed', { projectId: run.projectId, runId: run.id })
      }
    })
  } catch {
    // Best-effort desktop push — some test environments stub BrowserWindow without getAllWindows.
  }
  broadcastToMobile({ event: 'automated-workflow-runs:detail', data: { run } })
  broadcastToMobile({ event: 'automated-workflow-runs:changed', data: { projectId: run.projectId, runId: run.id } })
}

function broadcastStepStream(runId: string, stepDbId: string, chunk: string): void {
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('automated-workflow-runs:step-stream', { runId, stepDbId, chunk })
    })
  } catch {
    // Best-effort desktop push, see notifyRunChanged.
  }
  broadcastToMobile({ event: 'automated-workflow-runs:step-stream', data: { runId, stepDbId, chunk } })
}

function resolvePrimaryAgentId(projectId: string | null): string | null {
  // No project_agents row can exist for a project that doesn't exist — a project-less run has
  // no agent fallback at all, which is exactly what makes it land in model-mode (no skills) by
  // default unless a step explicitly names a real agent.
  if (!projectId) return null
  const row = getDatabase()
    .prepare('SELECT agent_id FROM project_agents WHERE project_id = ? ORDER BY is_primary DESC, sort_order ASC, added_at ASC LIMIT 1')
    .get(projectId) as { agent_id: string } | undefined
  return row?.agent_id ?? null
}

function insertMessage(conversationId: string, role: 'user' | 'assistant', content: string): void {
  getDatabase()
    .prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), conversationId, role, content, Date.now())
}

function findNextReadyStep(detail: AutomatedWorkflowRunDetail): AutomatedWorkflowRunStep | null {
  const byKey = new Map(detail.steps.map((s) => [s.id, s]))
  const isSatisfied = (key: string) => {
    const dep = byKey.get(key)
    return dep?.status === 'done' || dep?.status === 'skipped'
  }
  const ordered = orderWorkflowSteps(detail.steps)
  return ordered.find((s) => s.status === 'pending' && dependencyIds(s).every(isSatisfied)) ?? null
}

function buildCompletedMap(detail: AutomatedWorkflowRunDetail): Map<string, { id: string; title: string; output: string }> {
  const map = new Map<string, { id: string; title: string; output: string }>()
  for (const s of detail.steps) {
    if (s.status === 'done') {
      map.set(s.id, { id: s.id, title: s.title, output: s.output })
    } else if (s.status === 'skipped') {
      map.set(s.id, { id: s.id, title: s.title, output: `[Step '${s.title}' was skipped by the user — no output is available.]` })
    }
  }
  return map
}

function markRunTerminalIfComplete(runId: string): AutomatedWorkflowRunDetail {
  const db = getDatabase()
  const detail = getAutomatedWorkflowRun(runId)!
  const allTerminal = detail.steps.every((s) => s.status === 'done' || s.status === 'skipped')
  const now = Date.now()
  db.prepare('UPDATE automated_workflow_runs SET status = ?, current_step_id = NULL, updated_at = ? WHERE id = ?')
    .run(allTerminal ? 'done' : 'pending', now, runId)
  return getAutomatedWorkflowRun(runId)!
}

/**
 * Returns `applied: false` when the target step is no longer `awaiting_confirmation` — e.g. a
 * duplicate confirm request (two clients, or a slow retry) racing a confirmation that already
 * happened. Callers must treat that as a no-op, not a signal to advance the run again: doing so
 * previously let a stale second confirm re-enter advanceAutomatedWorkflowRun after a *different*
 * step had already been started, find no 'pending' step to run (the real next step being
 * 'running'), and incorrectly stamp the run back to 'pending' out from under the step actually in
 * flight.
 */
function applyStepConfirmation(
  runId: string,
  stepDbId: string,
  editedOutput?: string,
): { detail: AutomatedWorkflowRunDetail; applied: boolean } | null {
  const db = getDatabase()
  const detail = getAutomatedWorkflowRun(runId)
  if (!detail) return null
  const step = detail.steps.find((s) => s.dbId === stepDbId)
  if (!step || step.status !== 'awaiting_confirmation') return { detail, applied: false }

  if (typeof editedOutput === 'string') {
    db.prepare('UPDATE automated_workflow_run_steps SET output = ? WHERE id = ?').run(editedOutput, stepDbId)
  }
  db.prepare('UPDATE automated_workflow_run_steps SET status = \'done\', completed_at = COALESCE(completed_at, ?) WHERE id = ?')
    .run(Date.now(), stepDbId)

  const updated = markRunTerminalIfComplete(runId)
  notifyRunChanged(updated)
  return { detail: updated, applied: true }
}

/**
 * Advances a run by exactly one step in 'gated' mode, or loops through consecutive ready steps
 * until the run completes, fails, or is aborted in 'auto' mode. Persists at every transition so
 * a crash mid-call leaves clean, recoverable DB state (see recoverStuckAutomatedWorkflowRuns)
 * rather than an in-memory-only "it was running" flag.
 */
export async function advanceAutomatedWorkflowRun(runId: string): Promise<AutomatedWorkflowRunDetail | null> {
  const db = getDatabase()
  let detail = getAutomatedWorkflowRun(runId)
  if (!detail) return null

  for (;;) {
    if (abortedRuns.has(runId)) break

    const next = findNextReadyStep(detail)
    if (!next) {
      detail = markRunTerminalIfComplete(runId)
      notifyRunChanged(detail)
      break
    }

    if (next.kind === 'collect') {
      const startedAt = Date.now()
      db.prepare(`UPDATE automated_workflow_run_steps SET status = 'running',
        started_at = COALESCE(started_at, ?), error = NULL WHERE id = ?`).run(startedAt, next.dbId)
      db.prepare(`UPDATE automated_workflow_runs SET status = 'running', current_step_id = ?, updated_at = ? WHERE id = ?`)
        .run(next.dbId, startedAt, runId)
      detail = getAutomatedWorkflowRun(runId)!
      notifyRunChanged(detail)
      try {
        const { executeManagedCollectStep } = await import('./automated-workflow-managed')
        executeManagedCollectStep(detail, detail.steps.find((step) => step.dbId === next.dbId)!)
        db.prepare(`UPDATE automated_workflow_runs SET status = 'pending', current_step_id = NULL, error = NULL, updated_at = ? WHERE id = ?`)
          .run(Date.now(), runId)
        detail = getAutomatedWorkflowRun(runId)!
        notifyRunChanged(detail)
        continue
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failedAt = Date.now()
        db.prepare(`UPDATE automated_workflow_run_steps SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`)
          .run(message, failedAt, next.dbId)
        db.prepare(`UPDATE automated_workflow_runs SET status = 'failed', error = ?, current_step_id = NULL, updated_at = ? WHERE id = ?`)
          .run(message, failedAt, runId)
        detail = getAutomatedWorkflowRun(runId)!
        notifyRunChanged(detail)
        break
      }
    }

    if (next.kind === 'review') {
      try {
        const { prepareManagedReviewStep } = await import('./automated-workflow-managed')
        prepareManagedReviewStep(detail, next)
        detail = getAutomatedWorkflowRun(runId)!
        notifyRunChanged(detail)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failedAt = Date.now()
        db.prepare(`UPDATE automated_workflow_run_steps SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`)
          .run(message, failedAt, next.dbId)
        db.prepare(`UPDATE automated_workflow_runs SET status = 'failed', error = ?, current_step_id = NULL, updated_at = ? WHERE id = ?`)
          .run(message, failedAt, runId)
        detail = getAutomatedWorkflowRun(runId)!
        notifyRunChanged(detail)
      }
      break
    }

    if (next.kind === 'publish') {
      try {
        const { prepareManagedPublishStep } = await import('./automated-workflow-managed')
        prepareManagedPublishStep(detail, next)
        detail = getAutomatedWorkflowRun(runId)!
        notifyRunChanged(detail)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failedAt = Date.now()
        db.prepare(`UPDATE automated_workflow_run_steps SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`)
          .run(message, failedAt, next.dbId)
        db.prepare(`UPDATE automated_workflow_runs SET status = 'failed', error = ?, current_step_id = NULL, updated_at = ? WHERE id = ?`)
          .run(message, failedAt, runId)
        detail = getAutomatedWorkflowRun(runId)!
        notifyRunChanged(detail)
      }
      break
    }

    // Agent-or-model resolution: a step is fulfilled by EITHER a specific agent (that agent's
    // own attached skills apply, exactly as before) OR a bare model (no skills at all, full
    // stop — skill access is strictly agent-gated, never freely available to a bare model).
    // Explicit step.agentId always wins. Otherwise, if the step didn't explicitly request a
    // bare model, fall back to the project's primary agent (today's exact pre-existing
    // behavior, unchanged). Only if neither resolves — including a project-less run, which has
    // no primary-agent fallback at all — does the step run in model-mode.
    const resolvedAgentId = next.agentId ?? (next.model ? null : resolvePrimaryAgentId(detail.projectId))
    const agentId = resolvedAgentId ?? undefined
    const stepModel = resolvedAgentId ? undefined : (next.model ?? detail.model ?? getAutomatedWorkflowGeneratorModel())

    const conversation = createConversationRecord(agentId, detail.projectId, `${detail.title} — ${next.title}`)
    let prompt: string
    try {
      if (next.kind === 'model') {
        const { buildManagedModelPrompt } = await import('./automated-workflow-managed')
        prompt = buildManagedModelPrompt(detail, next)
      } else prompt = weaveStepPrompt(next, buildCompletedMap(detail))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      db.prepare(`UPDATE automated_workflow_run_steps SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`)
        .run(message, failedAt, next.dbId)
      db.prepare(`UPDATE automated_workflow_runs SET status = 'failed', error = ?, current_step_id = NULL, updated_at = ? WHERE id = ?`)
        .run(message, failedAt, runId)
      detail = getAutomatedWorkflowRun(runId)!
      notifyRunChanged(detail)
      break
    }
    insertMessage(conversation.id, 'user', prompt)

    const startedAt = Date.now()
    db.prepare(`
      UPDATE automated_workflow_run_steps
      SET status = 'running', conversation_id = ?, started_at = COALESCE(started_at, ?), error = NULL
      WHERE id = ?
    `).run(conversation.id, startedAt, next.dbId)
    db.prepare('UPDATE automated_workflow_runs SET status = \'running\', current_step_id = ?, updated_at = ? WHERE id = ?')
      .run(next.dbId, startedAt, runId)
    detail = getAutomatedWorkflowRun(runId)!
    notifyRunChanged(detail)

    const activityId = `automated-workflow:${runId}:${next.dbId}`
    startActivity({
      id: activityId,
      kind: 'automated-workflow-run',
      projectId: detail.projectId ?? undefined,
      conversationId: conversation.id,
      label: `Running step "${next.title}"…`,
    })

    let output: string
    try {
      output = await runAgentTurn({
        agentId,
        conversationId: conversation.id,
        fallbackModel: stepModel ?? detail.model ?? getAutomatedWorkflowGeneratorModel(),
        taskContent: prompt,
        requestId: `automated-workflow:${runId}:${next.dbId}:${next.attempt}`,
        generationOptions: { temperature: 0.5, maxTokens: 4096 },
        onChunk: (chunk) => broadcastStepStream(runId, next.dbId, chunk),
      })
    } catch (error) {
      endActivity(activityId)
      // Race guard: only persist if this step is still the one we started — an abort/retry/skip
      // issued while the call was in flight already moved it out of 'running'.
      const raced = getAutomatedWorkflowRun(runId)
      const racedStep = raced?.steps.find((s) => s.dbId === next.dbId)
      if (!raced || racedStep?.status !== 'running') { detail = raced ?? detail; break }

      const failedAt = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      db.prepare('UPDATE automated_workflow_run_steps SET status = \'failed\', error = ?, completed_at = ? WHERE id = ?')
        .run(message, failedAt, next.dbId)
      db.prepare('UPDATE automated_workflow_runs SET status = \'failed\', error = ?, current_step_id = NULL, updated_at = ? WHERE id = ?')
        .run(message, failedAt, runId)
      detail = getAutomatedWorkflowRun(runId)!
      notifyRunChanged(detail)
      break
    }
    endActivity(activityId)

    const raced = getAutomatedWorkflowRun(runId)
    const racedStep = raced?.steps.find((s) => s.dbId === next.dbId)
    if (!raced || racedStep?.status !== 'running') { detail = raced ?? detail; break }

    const cleanOutput = output.trim()
    insertMessage(conversation.id, 'assistant', cleanOutput)
    const doneAt = Date.now()
    if (next.kind === 'model') {
      const { commitManagedModelOutput } = await import('./automated-workflow-managed')
      commitManagedModelOutput(getAutomatedWorkflowRun(runId)!, getAutomatedWorkflowRun(runId)!.steps.find((step) => step.dbId === next.dbId)!, cleanOutput)
      db.prepare(`UPDATE automated_workflow_runs SET status = 'pending', current_step_id = NULL, updated_at = ? WHERE id = ?`)
        .run(doneAt, runId)
      detail = getAutomatedWorkflowRun(runId)!
      notifyRunChanged(detail)
      continue
    }
    db.prepare('UPDATE automated_workflow_run_steps SET status = \'awaiting_confirmation\', output = ?, completed_at = ? WHERE id = ?')
      .run(cleanOutput, doneAt, next.dbId)
    db.prepare('UPDATE automated_workflow_runs SET status = \'awaiting_confirmation\', updated_at = ? WHERE id = ?')
      .run(doneAt, runId)
    detail = getAutomatedWorkflowRun(runId)!
    notifyRunChanged(detail)

    if (detail.confirmationMode === 'auto') {
      const confirmResult = applyStepConfirmation(runId, next.dbId)
      if (!confirmResult || !confirmResult.applied) break
      detail = confirmResult.detail
      continue
    }
    break
  }

  abortedRuns.delete(runId)
  return detail
}

/** No-op if the run has already been started (idempotent — safe to call from a "resume" UI action). */
export async function startAutomatedWorkflowRun(runId: string): Promise<AutomatedWorkflowRunDetail | null> {
  const detail = getAutomatedWorkflowRun(runId)
  if (!detail) return null
  if (detail.status !== 'pending') return detail
  return advanceAutomatedWorkflowRun(runId)
}

/** Confirms an awaiting_confirmation step (optionally overwriting its output) and advances. */
export async function confirmAutomatedWorkflowStep(
  runId: string,
  stepDbId: string,
  editedOutput?: string,
): Promise<AutomatedWorkflowRunDetail | null> {
  const result = applyStepConfirmation(runId, stepDbId, editedOutput)
  if (!result) return null
  if (!result.applied || result.detail.status === 'done') return result.detail
  return advanceAutomatedWorkflowRun(runId)
}

/** Resets a failed step and everything downstream of it back to 'pending', then re-runs it. */
export async function retryAutomatedWorkflowStep(runId: string, stepDbId: string): Promise<AutomatedWorkflowRunDetail | null> {
  const db = getDatabase()
  const detail = getAutomatedWorkflowRun(runId)
  if (!detail) return null
  const step = detail.steps.find((s) => s.dbId === stepDbId)
  if (!step || step.status !== 'failed') return detail
  if (step.kind) {
    const { resetManagedWorkflowFromStep } = await import('./automated-workflow-managed')
    resetManagedWorkflowFromStep(runId, stepDbId)
    return advanceAutomatedWorkflowRun(runId)
  }

  const resetIds = getDownstreamWorkflowStepIds(detail.steps, step.id)
  const now = Date.now()
  for (const s of detail.steps) {
    if (!resetIds.has(s.id)) continue
    const nextAttempt = s.dbId === stepDbId ? s.attempt + 1 : s.attempt
    db.prepare(`
      UPDATE automated_workflow_run_steps
      SET status = 'pending', attempt = ?, output = '', error = NULL, conversation_id = NULL, started_at = NULL, completed_at = NULL
      WHERE id = ?
    `).run(nextAttempt, s.dbId)
  }
  db.prepare('UPDATE automated_workflow_runs SET status = \'pending\', error = NULL, current_step_id = NULL, updated_at = ? WHERE id = ?')
    .run(now, runId)
  notifyRunChanged(getAutomatedWorkflowRun(runId)!)

  return advanceAutomatedWorkflowRun(runId)
}

/** Marks a failed step 'skipped' (not reset — downstream steps see a synthetic placeholder for its output) and advances. */
export async function skipAutomatedWorkflowStep(runId: string, stepDbId: string): Promise<AutomatedWorkflowRunDetail | null> {
  const db = getDatabase()
  const detail = getAutomatedWorkflowRun(runId)
  if (!detail) return null
  const step = detail.steps.find((s) => s.dbId === stepDbId)
  if (!step || step.status !== 'failed') return detail
  if (step.kind && step.kind !== 'model') throw new Error(`${step.kind} steps are required and cannot be skipped`)

  db.prepare('UPDATE automated_workflow_run_steps SET status = \'skipped\', error = NULL, completed_at = ? WHERE id = ?')
    .run(Date.now(), stepDbId)
  db.prepare('UPDATE automated_workflow_runs SET error = NULL WHERE id = ?').run(runId)
  const afterSkip = markRunTerminalIfComplete(runId)
  notifyRunChanged(afterSkip)
  if (afterSkip.status === 'done') return afterSkip

  return advanceAutomatedWorkflowRun(runId)
}

/** Cancels the whole run. If a step is mid-flight, its eventual result is discarded by the race guard in advanceAutomatedWorkflowRun. */
export function abortAutomatedWorkflowRun(runId: string): AutomatedWorkflowRunDetail | null {
  const db = getDatabase()
  const detail = getAutomatedWorkflowRun(runId)
  if (!detail) return null

  abortedRuns.add(runId)
  const now = Date.now()
  const runningStep = detail.steps.find((s) => s.dbId === detail.currentStepId && s.status === 'running')
  if (runningStep) {
    db.prepare('UPDATE automated_workflow_run_steps SET status = \'cancelled\', completed_at = ? WHERE id = ?')
      .run(now, runningStep.dbId)
  }
  db.prepare('UPDATE automated_workflow_runs SET status = \'cancelled\', current_step_id = NULL, updated_at = ? WHERE id = ?')
    .run(now, runId)

  const updated = getAutomatedWorkflowRun(runId)!
  notifyRunChanged(updated)
  return updated
}

/** Switches a run between 'gated' (pause for review after each step) and 'auto' (advance immediately, only pause on failure). */
export function setAutomatedWorkflowConfirmationMode(runId: string, mode: AutomatedWorkflowConfirmationMode): AutomatedWorkflowRunDetail | null {
  const existing = getAutomatedWorkflowRun(runId)
  if (!existing) return null
  getDatabase().prepare('UPDATE automated_workflow_runs SET confirmation_mode = ?, updated_at = ? WHERE id = ?')
    .run(mode, Date.now(), runId)
  const updated = getAutomatedWorkflowRun(runId)!
  notifyRunChanged(updated)
  return updated
}

// Call once at app startup (mirrors recoverStuckCodeChanges's precedent in remote-edit-handlers.ts).
// A step still 'running' at process start represents an in-flight LLM call that died with the
// previous process — there's no DB state that lets you "resume" a half-finished network request,
// so it's surfaced as a failure with a clear explanation rather than silently re-issued (which
// would risk a duplicate provider call for a request whose original outcome is unknown) or left
// stuck forever (which is what would happen without this sweep, since nothing else ever revisits
// a 'running' row).
export function recoverStuckAutomatedWorkflowRuns(): void {
  const db = getDatabase()
  const stuckSteps = db.prepare('SELECT id, run_id FROM automated_workflow_run_steps WHERE status = \'running\'')
    .all() as { id: string; run_id: string }[]
  const now = Date.now()
  for (const { id, run_id } of stuckSteps) {
    db.prepare('UPDATE automated_workflow_run_steps SET status = \'failed\', error = ?, completed_at = ? WHERE id = ?')
      .run('The app was closed or restarted while this step was running.', now, id)
    db.prepare(`
      UPDATE automated_workflow_runs
      SET status = 'failed', error = ?, current_step_id = NULL, updated_at = ?
      WHERE id = ? AND status IN ('running', 'pending', 'awaiting_confirmation')
    `).run('The app was closed or restarted while a step was running.', now, run_id)
  }
}

export function registerAutomatedWorkflowExecutorHandlers(): void {
  recoverStuckAutomatedWorkflowRuns()

  safeHandle('automated-workflow-runs:start', (_event, runId: string) => startAutomatedWorkflowRun(runId))

  safeHandle('automated-workflow-runs:confirm-step', (_event, runId: string, stepDbId: string, editedOutput?: string) =>
    confirmAutomatedWorkflowStep(runId, stepDbId, editedOutput))

  safeHandle('automated-workflow-runs:retry-step', (_event, runId: string, stepDbId: string) =>
    retryAutomatedWorkflowStep(runId, stepDbId))

  safeHandle('automated-workflow-runs:skip-step', (_event, runId: string, stepDbId: string) =>
    skipAutomatedWorkflowStep(runId, stepDbId))

  safeHandle('automated-workflow-runs:abort', (_event, runId: string) => abortAutomatedWorkflowRun(runId))

  safeHandle('automated-workflow-runs:set-confirmation-mode', (_event, runId: string, mode: AutomatedWorkflowConfirmationMode) =>
    setAutomatedWorkflowConfirmationMode(runId, mode))
}
