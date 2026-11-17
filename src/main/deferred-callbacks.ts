import { randomUUID } from 'crypto'
import { powerMonitor, BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { dispatchChatSend } from './chat-handlers'
import { getActiveChatTurnSnapshot } from './active-chat-turns'
import { isMobileInForeground } from './ws-server'
import { sendDeferredJobNotification } from './fcm-sender'
import { log } from './logger'
import { startActivity, endActivity, getActivitySnapshot } from './activity-tracker'

/**
 * Cross-session wake-ups for long-running work.
 *
 * The harness only delivers a background command's completion notification back into the session
 * that spawned it, so a turn that says "I'll report back when the build finishes" cannot keep that
 * promise once the session ends. Nexy owns both the process boundary and the conversation store,
 * so it can: a `deferred_callbacks` row binds "conversation X is waiting on job Y", and when Y
 * finishes the resolver dispatches a genuine follow-up turn into X — days later, after a restart,
 * or from another device. This is the same `dispatchChatSend` re-entry the scheduler already uses
 * for cron runs; the only new part is the binding table and who is allowed to pull the trigger.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type DeferredTriggerKind = 'process' | 'build' | 'deadline'

export type DeferredCallbackStatus =
  | 'pending'
  | 'ready'
  | 'fired'
  | 'expired'
  | 'orphaned'
  | 'cancelled'
  | 'failed'

export interface DeferredCallback {
  id: string
  conversationId: string
  triggerKind: DeferredTriggerKind
  triggerRef: string
  label: string
  pid: number | null
  projectId: string | null
  agentId: string | null
  chainDepth: number
  status: DeferredCallbackStatus
  result: DeferredResult | null
  createdAt: number
  expiresAt: number
  firedAt: number | null
}

export interface DeferredResult {
  status: 'success' | 'failure' | 'cancelled' | 'timeout' | 'orphaned'
  exitCode?: number | null
  detail?: string | null
}

export interface DeferredCallbackCreateInput {
  conversationId: string
  triggerKind: DeferredTriggerKind
  triggerRef: string
  label: string
  pid?: number | null
  projectId?: string | null
  agentId?: string | null
  chainDepth?: number
  /** Overrides the default expiry. Clamped to at most DEFAULT_EXPIRY_MS. */
  timeoutMs?: number
}

/** A fired callback's own follow-up turn may schedule at most this many further callbacks deep. */
export const MAX_CHAIN_DEPTH = 3

/** Hard ceiling on how long a binding stays armed, so an orphan can never wake a conversation months later. */
export const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000

/** Keeps a pathological build log from blowing up the woken turn's context. */
const MAX_DETAIL_CHARS = 4000

const DRAIN_INTERVAL_MS = 30_000

// ─────────────────────────────────────────────────────────────
// Chain-depth hints
// ─────────────────────────────────────────────────────────────

/**
 * A woken turn may itself arm a new deferred callback (e.g. via the `nexy_defer` MCP bridge).
 * That new row needs `chainDepth = <fired row's depth> + 1` so MAX_CHAIN_DEPTH actually bounds a
 * self-resolving loop — but the CLI adapter that starts the bridge has no other way to learn what
 * depth the turn it's running *is*. This in-memory hint bridges that gap for exactly one turn:
 * `fireCallback`/the orphan report set it right before dispatching, and the adapter consumes
 * (and clears) it when it starts the bridge for that conversation's turn. It is deliberately not
 * persisted — a hint that outlives the process it was meant for would misattribute depth to an
 * unrelated later turn in the same conversation.
 */
const chainDepthHints = new Map<string, number>()

function noteChainDepthHint(conversationId: string, depth: number): void {
  chainDepthHints.set(conversationId, depth)
}

/** Reads and clears the hint left for this conversation's next turn; 0 if none was armed. */
export function consumeChainDepthHint(conversationId: string): number {
  const depth = chainDepthHints.get(conversationId) ?? 0
  chainDepthHints.delete(conversationId)
  return depth
}

// ─────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────

function rowToCallback(row: Record<string, unknown>): DeferredCallback {
  let result: DeferredResult | null = null
  const raw = row.result_json as string | null
  if (raw) {
    try {
      result = JSON.parse(raw) as DeferredResult
    } catch {
      result = null
    }
  }
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    triggerKind: row.trigger_kind as DeferredTriggerKind,
    triggerRef: row.trigger_ref as string,
    label: row.label as string,
    pid: (row.pid as number | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    agentId: (row.agent_id as string | null) ?? null,
    chainDepth: (row.chain_depth as number | null) ?? 0,
    status: row.status as DeferredCallbackStatus,
    result,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    firedAt: (row.fired_at as number | null) ?? null,
  }
}

// ─────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────

export function createDeferredCallback(input: DeferredCallbackCreateInput): DeferredCallback {
  const db = getDatabase()
  const chainDepth = input.chainDepth ?? 0

  // A woken turn can arm another callback; without this a self-resolving job could wake the same
  // conversation indefinitely.
  if (chainDepth >= MAX_CHAIN_DEPTH) {
    throw new Error(`Deferred callback rejected: chain depth ${chainDepth} exceeds MAX_CHAIN_DEPTH (${MAX_CHAIN_DEPTH})`)
  }

  const conversation = db
    .prepare('SELECT id FROM conversations WHERE id = ?')
    .get(input.conversationId) as { id: string } | undefined
  if (!conversation) {
    throw new Error(`Deferred callback rejected: unknown conversation ${input.conversationId}`)
  }

  // Two live bindings on one trigger would wake the conversation twice for a single completion.
  if (findPendingDeferredCallback(input.triggerKind, input.triggerRef)) {
    throw new Error(
      `Deferred callback rejected: ${input.triggerKind}:${input.triggerRef} already has a pending callback`,
    )
  }

  const now = Date.now()
  const requested = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_EXPIRY_MS
  const expiresAt = now + Math.min(requested, DEFAULT_EXPIRY_MS)
  const id = randomUUID()

  db.prepare(`
    INSERT INTO deferred_callbacks (
      id, conversation_id, trigger_kind, trigger_ref, label, pid,
      project_id, agent_id, chain_depth, status, result_json, created_at, expires_at, fired_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)
  `).run(
    id,
    input.conversationId,
    input.triggerKind,
    input.triggerRef,
    input.label,
    input.pid ?? null,
    input.projectId ?? null,
    input.agentId ?? null,
    chainDepth,
    now,
    expiresAt,
  )

  log.info(`[deferred] Armed ${input.triggerKind}:${input.triggerRef} for conversation ${input.conversationId}`)
  const callback = getDeferredCallback(id)!
  startDeferredActivity(callback)
  return callback
}

function startDeferredActivity(callback: DeferredCallback, unknown = false): void {
  if (callback.triggerKind === 'deadline') return
  startActivity({
    id: `deferred:${callback.id}`,
    kind: 'chat',
    label: unknown ? 'Background task status unknown' : 'Background task running',
    detail: callback.label,
    conversationId: callback.conversationId,
    projectId: callback.projectId ?? undefined,
    agentId: callback.agentId ?? undefined,
    startedAt: callback.createdAt,
  })
}

export function getDeferredCallback(id: string): DeferredCallback | null {
  const row = getDatabase().prepare('SELECT * FROM deferred_callbacks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToCallback(row) : null
}

/** Rows still waiting on their trigger — excludes queued ('ready') rows, which already have a result. */
export function listPendingDeferredCallbacks(): DeferredCallback[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM deferred_callbacks WHERE status = 'pending' ORDER BY created_at ASC")
    .all() as Record<string, unknown>[]
  return rows.map(rowToCallback)
}

export function findPendingDeferredCallback(
  triggerKind: DeferredTriggerKind,
  triggerRef: string,
): DeferredCallback | null {
  const row = getDatabase()
    .prepare(
      "SELECT * FROM deferred_callbacks WHERE trigger_kind = ? AND trigger_ref = ? AND status = 'pending' LIMIT 1",
    )
    .get(triggerKind, triggerRef) as Record<string, unknown> | undefined
  return row ? rowToCallback(row) : null
}

export function cancelDeferredCallback(id: string): boolean {
  const info = getDatabase()
    .prepare("UPDATE deferred_callbacks SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'ready')")
    .run(id)
  if (info.changes > 0) endActivity(`deferred:${id}`, { completed: false })
  return info.changes > 0
}

// ─────────────────────────────────────────────────────────────
// Prompt rendering
// ─────────────────────────────────────────────────────────────

export function renderDeferredPrompt(
  callback: Pick<DeferredCallback, 'label' | 'triggerKind' | 'triggerRef'>,
  result: DeferredResult,
): string {
  const lines: string[] = []
  const exitCode =
    typeof result.exitCode === 'number' ? ` (exit code ${result.exitCode})` : ''
  lines.push(
    `The deferred job you were waiting on has finished.`,
    ``,
    `- Job: ${callback.label}`,
    `- Reference: ${callback.triggerKind}:${callback.triggerRef}`,
    `- Outcome: ${result.status}${exitCode}`,
  )

  const detail = (result.detail ?? '').trim()
  if (detail) {
    const capped =
      detail.length > MAX_DETAIL_CHARS
        ? `…(truncated)…\n${detail.slice(-MAX_DETAIL_CHARS)}`
        : detail
    lines.push(``, `Output:`, '```', capped, '```')
  }

  lines.push(
    ``,
    `Report this result plainly, then continue the work it was blocking. Do not re-run the job unless it failed and rerunning is the right next step.`,
  )
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────
// Firing
// ─────────────────────────────────────────────────────────────

function activeWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.isDestroyed())
}

function conversationIsBusy(conversationId: string): boolean {
  return getActiveChatTurnSnapshot(conversationId)?.status === 'active'
}

/**
 * Pushes to the phone the moment the underlying job resolves, independent of — and typically well
 * ahead of — the follow-up assistant turn `dispatchChatSend` kicks off. Mirrors the existing
 * `!isMobileInForeground()` gate used for chat-complete pushes elsewhere: no point paging a phone
 * that's already looking at the app. Best-effort: a push failure must never affect the callback's
 * own fired/orphaned state, so every error is swallowed here.
 */
function notifyMobileOfResult(callback: Pick<DeferredCallback, 'conversationId' | 'label'>, result: DeferredResult): void {
  if (isMobileInForeground()) return
  try {
    const exitCode = typeof result.exitCode === 'number' ? ` (exit ${result.exitCode})` : ''
    void sendDeferredJobNotification(getDatabase(), {
      conversationId: callback.conversationId,
      title: `${callback.label}: ${result.status}${exitCode}`,
    }).catch(() => {
      /* a missed push must not affect the callback's terminal state */
    })
  } catch {
    /* nor may a synchronous throw from the sender */
  }
}

/**
 * Dispatches the follow-up turn. Guarded by a `WHERE status = ...` claim so that two concurrent
 * resolvers (a `powerMonitor` resume racing the drain timer, say) cannot both wake the same
 * conversation.
 */
async function fireCallback(callback: DeferredCallback, result: DeferredResult, from: DeferredCallbackStatus): Promise<boolean> {
  const db = getDatabase()
  const now = Date.now()
  const claimed = db
    .prepare("UPDATE deferred_callbacks SET status = 'fired', fired_at = ?, result_json = ? WHERE id = ? AND status = ?")
    .run(now, JSON.stringify(result), callback.id, from)
  if (claimed.changes === 0) return false

  notifyMobileOfResult(callback, result)

  const prompt = renderDeferredPrompt(callback, result)
  const win = activeWindow()

  // Echo to the renderer so the woken turn reads as a genuine user message in the transcript
  // rather than an assistant volunteering an unexplained status update.
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send('chat:remote-message', { conversationId: callback.conversationId, content: prompt })
  }

  noteChainDepthHint(callback.conversationId, callback.chainDepth + 1)
  try {
    await dispatchChatSend(win, callback.conversationId, prompt, {
      agentId: callback.agentId ?? undefined,
      projectId: callback.projectId ?? undefined,
    })
    log.info(`[deferred] Woke conversation ${callback.conversationId} for ${callback.triggerKind}:${callback.triggerRef}`)
    return true
  } catch (error) {
    // Leave the row in a distinct terminal state: it must not look 'pending' (which would re-fire
    // on the next rehydrate) nor silently claim success.
    db.prepare("UPDATE deferred_callbacks SET status = 'failed' WHERE id = ?").run(callback.id)
    log.error(
      `[deferred] Failed to wake conversation ${callback.conversationId}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/**
 * Called when the awaited job actually finishes. Returns true only if a conversation was woken
 * right now; a queued ('ready') result returns false and is delivered later by the drain pass.
 */
export async function resolveDeferredCallback(
  triggerKind: DeferredTriggerKind,
  triggerRef: string,
  result: DeferredResult,
): Promise<boolean> {
  const db = getDatabase()
  const callback = findPendingDeferredCallback(triggerKind, triggerRef)
  if (!callback) return false

  endActivity(`deferred:${callback.id}`, { completed: false })

  if (callback.expiresAt <= Date.now()) {
    db.prepare("UPDATE deferred_callbacks SET status = 'expired' WHERE id = ? AND status = 'pending'").run(callback.id)
    log.info(`[deferred] Dropped expired callback for ${triggerKind}:${triggerRef}`)
    return false
  }

  // Never collide with a turn the user is actively driving in that conversation — park the result
  // and let the drain pass deliver it once the conversation goes idle.
  if (conversationIsBusy(callback.conversationId)) {
    db.prepare("UPDATE deferred_callbacks SET status = 'ready', result_json = ? WHERE id = ? AND status = 'pending'").run(
      JSON.stringify(result),
      callback.id,
    )
    log.info(`[deferred] Queued result for busy conversation ${callback.conversationId}`)
    return false
  }

  return fireCallback(callback, result, 'pending')
}

/** Delivers results parked while their conversation was busy. */
export async function drainReadyDeferredCallbacks(): Promise<number> {
  const rows = getDatabase()
    .prepare("SELECT * FROM deferred_callbacks WHERE status = 'ready' ORDER BY created_at ASC")
    .all() as Record<string, unknown>[]

  let delivered = 0
  for (const row of rows) {
    const callback = rowToCallback(row)
    if (conversationIsBusy(callback.conversationId)) continue
    const result = callback.result ?? { status: 'success' as const, exitCode: null }
    if (await fireCallback(callback, result, 'ready')) delivered++
  }
  return delivered
}

// ─────────────────────────────────────────────────────────────
// Restart / rehydrate
// ─────────────────────────────────────────────────────────────

function processIsAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without actually signalling.
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Swept on startup, on system wake, and on a timer. Turns the two silent failure modes into
 * visible ones: a deadline that passed while the app was closed becomes 'expired', and a tracked
 * child process that died with the app becomes 'orphaned' *and* tells the conversation so.
 */
export async function rehydrateDeferredCallbacks(): Promise<void> {
  const db = getDatabase()
  const now = Date.now()

  const expired = db.prepare("SELECT id FROM deferred_callbacks WHERE status IN ('pending', 'ready') AND expires_at <= ?").all(now) as { id: string }[]
  db.prepare("UPDATE deferred_callbacks SET status = 'expired' WHERE status IN ('pending', 'ready') AND expires_at <= ?").run(now)
  for (const row of expired) endActivity(`deferred:${row.id}`, { completed: false })

  for (const callback of listPendingDeferredCallbacks()) {
    // Existing entries are still observed by this process. A restored child cannot be
    // observed for its exit status after a restart, even if its PID still exists.
    if (!getActivitySnapshot().some((activity) => activity.id === `deferred:${callback.id}`)) {
      startDeferredActivity(callback, callback.triggerKind !== 'deadline')
    }
    if (callback.triggerKind !== 'process' && callback.triggerKind !== 'build') continue
    if (callback.pid === null) continue
    if (processIsAlive(callback.pid)) continue

    const claimed = db
      .prepare("UPDATE deferred_callbacks SET status = 'orphaned' WHERE id = ? AND status = 'pending'")
      .run(callback.id)
    if (claimed.changes === 0) continue
    endActivity(`deferred:${callback.id}`, { completed: false })

    const result: DeferredResult = {
      status: 'orphaned',
      exitCode: null,
      detail: 'The process was interrupted — it is no longer running, most likely because Nexy restarted while it was in flight. No exit status was recorded.',
    }
    notifyMobileOfResult(callback, result)
    const prompt = renderDeferredPrompt(callback, result)
    const win = activeWindow()
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send('chat:remote-message', { conversationId: callback.conversationId, content: prompt })
    }
    noteChainDepthHint(callback.conversationId, callback.chainDepth + 1)
    try {
      await dispatchChatSend(win, callback.conversationId, prompt, {
        agentId: callback.agentId ?? undefined,
        projectId: callback.projectId ?? undefined,
      })
    } catch (error) {
      log.error(
        `[deferred] Failed to report orphaned job: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  await drainReadyDeferredCallbacks()
}

// ─────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────

let drainTimer: NodeJS.Timeout | null = null

export function startDeferredCallbackEngine(): void {
  void rehydrateDeferredCallbacks()
  if (!drainTimer) {
    drainTimer = setInterval(() => {
      void rehydrateDeferredCallbacks()
    }, DRAIN_INTERVAL_MS)
  }
  powerMonitor.on('resume', () => {
    void rehydrateDeferredCallbacks()
  })
}

export function stopDeferredCallbackEngine(): void {
  if (drainTimer) {
    clearInterval(drainTimer)
    drainTimer = null
  }
}
