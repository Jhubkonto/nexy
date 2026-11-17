import Database from 'better-sqlite3'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted mocks (must run before any imports) ───────────────────────────

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  hasWindow: true,
  /** Conversations that currently have a live (non-terminal) chat turn. */
  activeConversations: new Set<string>(),
  mobileInForeground: false,
}))

const fakeWebContents = { isDestroyed: () => false, send: vi.fn() }
const fakeWindow = { webContents: fakeWebContents, isDestroyed: () => false }

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => (state.hasWindow ? [fakeWindow] : [])) },
  powerMonitor: { on: vi.fn() },
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('DB not initialized')
    return state.db
  },
}))

vi.mock('../chat-handlers', () => ({
  dispatchChatSend: vi.fn().mockImplementation(() => Promise.resolve({ assistantMsgId: 'msg-1' })),
}))

vi.mock('../active-chat-turns', () => ({
  getActiveChatTurnSnapshot: vi.fn((conversationId: string) =>
    state.activeConversations.has(conversationId) ? { conversationId, status: 'active' } : null,
  ),
}))

vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn(), isMobileInForeground: () => state.mobileInForeground }))
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../fcm-sender', () => ({ sendDeferredJobNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../activity-tracker', () => ({ startActivity: vi.fn(), endActivity: vi.fn(), getActivitySnapshot: vi.fn(() => []) }))

// ─── Imports after mocks ──────────────────────────────────────────────────

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import {
  createDeferredCallback,
  getDeferredCallback,
  listPendingDeferredCallbacks,
  findPendingDeferredCallback,
  cancelDeferredCallback,
  resolveDeferredCallback,
  drainReadyDeferredCallbacks,
  rehydrateDeferredCallbacks,
  renderDeferredPrompt,
  consumeChainDepthHint,
  MAX_CHAIN_DEPTH,
  DEFAULT_EXPIRY_MS,
} from '../deferred-callbacks'
import { dispatchChatSend } from '../chat-handlers'
import { sendDeferredJobNotification } from '../fcm-sender'
import { startActivity, endActivity } from '../activity-tracker'

// ─── Helpers ──────────────────────────────────────────────────────────────

const CONV = 'conv-1'
// Above the OS maximum on every supported platform, so it can never be a live process.
const DEAD_PID = 2_147_483_647

function seedConversation(id = CONV): string {
  state.db!.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(id, 'Test conversation', Date.now(), Date.now())
  return id
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: CONV,
    triggerKind: 'build' as const,
    triggerRef: 'build-7f3a',
    label: 'Gradle compile',
    ...overrides,
  }
}

beforeEach(() => {
  state.db = new Database(':memory:')
  initializeBaseSchema(state.db)
  runMigrations(state.db)
  state.hasWindow = true
  state.activeConversations.clear()
  state.mobileInForeground = false
  vi.mocked(dispatchChatSend).mockClear()
  vi.mocked(sendDeferredJobNotification).mockClear()
  vi.mocked(startActivity).mockClear()
  vi.mocked(endActivity).mockClear()
  fakeWebContents.send.mockClear()
  seedConversation()
})

afterEach(() => {
  state.db?.close()
  state.db = null
  vi.restoreAllMocks()
})

// ─── Schema ───────────────────────────────────────────────────────────────

describe('deferred_callbacks schema', () => {
  it('creates the table via migration', () => {
    const row = state
      .db!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deferred_callbacks'")
      .get()
    expect(row).toBeTruthy()
  })

  it('cascades deletion when the conversation is removed', () => {
    state.db!.pragma('foreign_keys = ON')
    createDeferredCallback(makeInput())
    state.db!.prepare('DELETE FROM conversations WHERE id = ?').run(CONV)
    expect(listPendingDeferredCallbacks()).toHaveLength(0)
  })
})

// ─── Creation ─────────────────────────────────────────────────────────────

describe('createDeferredCallback', () => {
  it('persists a pending callback bound to the conversation', () => {
    const created = createDeferredCallback(makeInput())
    expect(created.status).toBe('pending')
    expect(created.conversationId).toBe(CONV)
    expect(created.triggerRef).toBe('build-7f3a')
    expect(getDeferredCallback(created.id)?.label).toBe('Gradle compile')
  })

  it('defaults expiry to 24h so an orphan never wakes a conversation months later', () => {
    const before = Date.now()
    const created = createDeferredCallback(makeInput())
    expect(created.expiresAt).toBeGreaterThanOrEqual(before + DEFAULT_EXPIRY_MS)
    expect(created.expiresAt).toBeLessThanOrEqual(Date.now() + DEFAULT_EXPIRY_MS)
  })

  it('honours an explicit timeout shorter than the default', () => {
    const created = createDeferredCallback(makeInput({ timeoutMs: 60_000 }))
    expect(created.expiresAt).toBeLessThan(Date.now() + DEFAULT_EXPIRY_MS)
  })

  it('is findable by its trigger identity', () => {
    createDeferredCallback(makeInput())
    expect(findPendingDeferredCallback('build', 'build-7f3a')).toBeTruthy()
    expect(findPendingDeferredCallback('build', 'other')).toBeNull()
    expect(findPendingDeferredCallback('process', 'build-7f3a')).toBeNull()
  })

  it('rejects a second pending callback for the same trigger (loop guard)', () => {
    createDeferredCallback(makeInput())
    expect(() => createDeferredCallback(makeInput())).toThrow(/already/i)
  })

  it('rejects creation past the max chain depth', () => {
    expect(() => createDeferredCallback(makeInput({ chainDepth: MAX_CHAIN_DEPTH }))).toThrow(/chain/i)
  })

  it('rejects an unknown conversation rather than creating an unwakeable row', () => {
    expect(() => createDeferredCallback(makeInput({ conversationId: 'nope' }))).toThrow(/conversation/i)
  })
})

// ─── Resolution ───────────────────────────────────────────────────────────

describe('deferred activity', () => {
  it('tracks a job until its result arrives while the conversation is busy', async () => {
    const callback = createDeferredCallback(makeInput())
    expect(startActivity).toHaveBeenCalledWith(expect.objectContaining({
      id: `deferred:${callback.id}`, conversationId: CONV, label: 'Background task running', detail: 'Gradle compile',
    }))
    state.activeConversations.add(CONV)
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'success' })
    expect(endActivity).toHaveBeenCalledWith(`deferred:${callback.id}`, { completed: false })
  })

  it('marks restored jobs as unknown when their completion can no longer be observed', async () => {
    const callback = createDeferredCallback(makeInput({ pid: process.pid }))
    await rehydrateDeferredCallbacks()
    expect(startActivity).toHaveBeenCalledWith(expect.objectContaining({
      id: `deferred:${callback.id}`, label: 'Background task status unknown',
    }))
  })
})

describe('resolveDeferredCallback', () => {
  it('wakes the bound conversation with the rendered result', async () => {
    createDeferredCallback(makeInput())
    const fired = await resolveDeferredCallback('build', 'build-7f3a', {
      status: 'failure',
      exitCode: 1,
      detail: 'FAILURE: compileDebugKotlin failed',
    })

    expect(fired).toBe(true)
    expect(dispatchChatSend).toHaveBeenCalledTimes(1)
    const [, conversationId, content] = vi.mocked(dispatchChatSend).mock.calls[0]
    expect(conversationId).toBe(CONV)
    expect(content).toContain('Gradle compile')
    expect(content).toContain('compileDebugKotlin failed')
  })

  it('echoes the woken turn to the renderer so it reads as a real user turn', async () => {
    createDeferredCallback(makeInput())
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })
    expect(fakeWebContents.send).toHaveBeenCalledWith(
      'chat:remote-message',
      expect.objectContaining({ conversationId: CONV }),
    )
  })

  it('marks the row fired exactly once even if resolved twice', async () => {
    const created = createDeferredCallback(makeInput())
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })
    const second = await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })

    expect(second).toBe(false)
    expect(dispatchChatSend).toHaveBeenCalledTimes(1)
    const row = getDeferredCallback(created.id)!
    expect(row.status).toBe('fired')
    expect(row.firedAt).toBeGreaterThan(0)
  })

  it('is a no-op when nothing is waiting on that trigger', async () => {
    expect(await resolveDeferredCallback('build', 'unknown', { status: 'success', exitCode: 0 })).toBe(false)
    expect(dispatchChatSend).not.toHaveBeenCalled()
  })

  it('does not wake a conversation for an already-expired callback', async () => {
    const created = createDeferredCallback(makeInput({ timeoutMs: 1000 }))
    state.db!.prepare('UPDATE deferred_callbacks SET expires_at = ? WHERE id = ?').run(Date.now() - 1, created.id)

    expect(await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })).toBe(false)
    expect(dispatchChatSend).not.toHaveBeenCalled()
    expect(getDeferredCallback(created.id)?.status).toBe('expired')
  })

  it('does not fire a cancelled callback', async () => {
    const created = createDeferredCallback(makeInput())
    cancelDeferredCallback(created.id)
    expect(await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })).toBe(false)
    expect(dispatchChatSend).not.toHaveBeenCalled()
    expect(getDeferredCallback(created.id)?.status).toBe('cancelled')
  })

  it('survives a dispatch failure without losing the row to a fired state', async () => {
    vi.mocked(dispatchChatSend).mockRejectedValueOnce(new Error('boom'))
    const created = createDeferredCallback(makeInput())
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })
    expect(getDeferredCallback(created.id)?.status).toBe('failed')
  })
})

// ─── Concurrency with a live turn ─────────────────────────────────────────

describe('concurrency with an in-flight chat turn', () => {
  it('queues instead of colliding with a turn already running in that conversation', async () => {
    state.activeConversations.add(CONV)
    const created = createDeferredCallback(makeInput())

    const fired = await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })

    expect(fired).toBe(false)
    expect(dispatchChatSend).not.toHaveBeenCalled()
    expect(getDeferredCallback(created.id)?.status).toBe('ready')
  })

  it('drains the queued result once the conversation goes idle', async () => {
    state.activeConversations.add(CONV)
    const created = createDeferredCallback(makeInput())
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'failure', exitCode: 1, detail: 'nope' })

    // Still busy: draining must not dispatch.
    await drainReadyDeferredCallbacks()
    expect(dispatchChatSend).not.toHaveBeenCalled()

    state.activeConversations.delete(CONV)
    await drainReadyDeferredCallbacks()

    expect(dispatchChatSend).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dispatchChatSend).mock.calls[0][2]).toContain('nope')
    expect(getDeferredCallback(created.id)?.status).toBe('fired')
  })

  it('does not fire a row cancelled after the drain pass already selected it', async () => {
    // The drain reads its batch up front, then awaits a dispatch per row. That await is a real
    // interleaving point: a row later in the batch can be cancelled while an earlier one is still
    // dispatching, so the stale snapshot must not be allowed to wake the conversation.
    state.activeConversations.add(CONV)
    createDeferredCallback(makeInput({ triggerRef: 'job-a', label: 'Job A' }))
    const second = createDeferredCallback(makeInput({ triggerRef: 'job-b', label: 'Job B' }))
    await resolveDeferredCallback('build', 'job-a', { status: 'success', exitCode: 0 })
    await resolveDeferredCallback('build', 'job-b', { status: 'success', exitCode: 0 })
    state.activeConversations.delete(CONV)

    vi.mocked(dispatchChatSend).mockImplementationOnce(async () => {
      cancelDeferredCallback(second.id)
      return { assistantMsgId: 'msg-1' }
    })

    await drainReadyDeferredCallbacks()

    expect(dispatchChatSend).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dispatchChatSend).mock.calls[0][2]).toContain('Job A')
    expect(getDeferredCallback(second.id)?.status).toBe('cancelled')
  })

  it('preserves the original result payload across the queue', async () => {
    state.activeConversations.add(CONV)
    createDeferredCallback(makeInput())
    await resolveDeferredCallback('build', 'build-7f3a', {
      status: 'failure',
      exitCode: 42,
      detail: 'distinctive-log-marker',
    })
    state.activeConversations.delete(CONV)
    await drainReadyDeferredCallbacks()

    const content = vi.mocked(dispatchChatSend).mock.calls[0][2]
    expect(content).toContain('42')
    expect(content).toContain('distinctive-log-marker')
  })
})

// ─── Restart / rehydrate semantics ────────────────────────────────────────

describe('rehydrateDeferredCallbacks', () => {
  it('expires rows whose deadline passed while the app was closed', async () => {
    const created = createDeferredCallback(makeInput())
    state.db!.prepare('UPDATE deferred_callbacks SET expires_at = ? WHERE id = ?').run(Date.now() - 1, created.id)

    await rehydrateDeferredCallbacks()

    expect(getDeferredCallback(created.id)?.status).toBe('expired')
    expect(dispatchChatSend).not.toHaveBeenCalled()
  })

  it('surfaces an interrupted process as a visible orphan instead of silence', async () => {
    const created = createDeferredCallback(
      makeInput({ triggerKind: 'process', triggerRef: 'pid-dead', pid: DEAD_PID }),
    )

    await rehydrateDeferredCallbacks()

    expect(getDeferredCallback(created.id)?.status).toBe('orphaned')
    expect(dispatchChatSend).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dispatchChatSend).mock.calls[0][2]).toMatch(/interrupt/i)
  })

  it('leaves a still-running process pending across a restart', async () => {
    const created = createDeferredCallback(
      makeInput({ triggerKind: 'process', triggerRef: `pid-${process.pid}`, pid: process.pid }),
    )

    await rehydrateDeferredCallbacks()

    expect(getDeferredCallback(created.id)?.status).toBe('pending')
    expect(dispatchChatSend).not.toHaveBeenCalled()
  })

  it('does not re-fire callbacks already resolved', async () => {
    createDeferredCallback(makeInput())
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })
    vi.mocked(dispatchChatSend).mockClear()

    await rehydrateDeferredCallbacks()

    expect(dispatchChatSend).not.toHaveBeenCalled()
  })
})

// ─── Prompt rendering ─────────────────────────────────────────────────────

describe('renderDeferredPrompt', () => {
  const base = { label: 'Gradle compile', triggerKind: 'build' as const, triggerRef: 'build-7f3a' }

  it('states the outcome and the exit code plainly', () => {
    const text = renderDeferredPrompt(base, { status: 'failure', exitCode: 1, detail: 'stack trace' })
    expect(text).toContain('Gradle compile')
    expect(text).toContain('failure')
    expect(text).toContain('1')
    expect(text).toContain('stack trace')
  })

  it('omits an absent exit code rather than printing null', () => {
    const text = renderDeferredPrompt(base, { status: 'success', exitCode: null })
    expect(text).not.toContain('null')
    expect(text).not.toContain('undefined')
  })

  it('caps the detail so a huge log cannot blow up the turn', () => {
    const text = renderDeferredPrompt(base, { status: 'failure', exitCode: 1, detail: 'x'.repeat(50_000) })
    expect(text.length).toBeLessThan(10_000)
  })
})

// ─── Mobile push polish ───────────────────────────────────────────────────

describe('mobile push on resolution', () => {
  it('pushes a notification when the phone is not in the foreground', async () => {
    createDeferredCallback(makeInput())
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })

    expect(sendDeferredJobNotification).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(sendDeferredJobNotification).mock.calls[0]
    expect(payload.conversationId).toBe(CONV)
    expect(payload.title).toContain('Gradle compile')
    expect(payload.title).toContain('success')
  })

  it('skips the push when the phone is already looking at the app', async () => {
    state.mobileInForeground = true
    createDeferredCallback(makeInput())
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })

    expect(sendDeferredJobNotification).not.toHaveBeenCalled()
  })

  it('still fires the callback if the push itself fails', async () => {
    vi.mocked(sendDeferredJobNotification).mockRejectedValueOnce(new Error('fcm down'))
    createDeferredCallback(makeInput())
    const fired = await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })

    expect(fired).toBe(true)
    expect(dispatchChatSend).toHaveBeenCalledTimes(1)
  })

  it('pushes for an orphaned job surfaced on rehydrate', async () => {
    createDeferredCallback(makeInput({ triggerKind: 'process', triggerRef: 'pid-dead', pid: DEAD_PID }))
    await rehydrateDeferredCallbacks()

    expect(sendDeferredJobNotification).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendDeferredJobNotification).mock.calls[0][1].title).toContain('orphaned')
  })
})

// ─── Chain-depth hint ──────────────────────────────────────────────────────

describe('consumeChainDepthHint', () => {
  it('is 0 for a conversation with no armed hint', () => {
    expect(consumeChainDepthHint('nobody-waiting')).toBe(0)
  })

  it('reflects the fired callback depth + 1, then clears', async () => {
    createDeferredCallback(makeInput({ chainDepth: 1 }))
    await resolveDeferredCallback('build', 'build-7f3a', { status: 'success', exitCode: 0 })

    expect(consumeChainDepthHint(CONV)).toBe(2)
    expect(consumeChainDepthHint(CONV)).toBe(0)
  })

  it('is set for an orphan report too, since the woken turn may re-arm work', async () => {
    createDeferredCallback(makeInput({ triggerKind: 'process', triggerRef: 'pid-dead', pid: DEAD_PID, chainDepth: 0 }))
    await rehydrateDeferredCallbacks()

    expect(consumeChainDepthHint(CONV)).toBe(1)
  })
})
