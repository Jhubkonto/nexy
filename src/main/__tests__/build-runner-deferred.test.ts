import Database from 'better-sqlite3'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../deferred-callbacks', () => ({
  resolveDeferredCallback: vi.fn().mockResolvedValue(true),
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { runBuildProcess, cancelBuildProcess } from '../build-runner'
import { resolveDeferredCallback } from '../deferred-callbacks'
import type { ChildProcess } from 'child_process'

let db: Database.Database
let registry: Map<string, ChildProcess>

function seedBuild(id: string): void {
  db.prepare(
    `INSERT INTO build_records (id, workspace_path, platform, command, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)`,
  ).run(id, 'C:/workspace', 'windows', 'build', Date.now())
}

/** Runs a command through the real runner and resolves once its close handler has fully settled. */
function runToCompletion(buildId: string, cmd: string): Promise<void> {
  return new Promise((resolve) => {
    const child = runBuildProcess({
      db,
      buildId,
      spawnCmd: cmd,
      spawnArgs: [],
      cwd: process.cwd(),
      logEvent: 'build:log-chunk',
      doneEvent: 'build:command-done',
      registry,
    })
    // The close listener returns its async work; awaiting a macrotask after close is enough
    // for the DB update + deferred resolution to have run.
    child.on('close', () => setTimeout(resolve, 50))
  })
}

beforeEach(() => {
  db = new Database(':memory:')
  initializeBaseSchema(db)
  runMigrations(db)
  registry = new Map()
  vi.mocked(resolveDeferredCallback).mockClear()
})

afterEach(() => {
  db.close()
})

describe('build-runner deferred-callback wiring', () => {
  it('wakes a waiting conversation when a build succeeds', async () => {
    seedBuild('build-ok')
    await runToCompletion('build-ok', 'exit 0')

    expect(resolveDeferredCallback).toHaveBeenCalledTimes(1)
    const [kind, ref, result] = vi.mocked(resolveDeferredCallback).mock.calls[0]
    expect(kind).toBe('build')
    expect(ref).toBe('build-ok')
    expect(result).toMatchObject({ status: 'success', exitCode: 0 })
  })

  it('reports the failure diagnostic so the woken turn has something to act on', async () => {
    seedBuild('build-bad')
    await runToCompletion('build-bad', 'exit 3')

    expect(resolveDeferredCallback).toHaveBeenCalledTimes(1)
    const [, ref, result] = vi.mocked(resolveDeferredCallback).mock.calls[0]
    expect(ref).toBe('build-bad')
    expect(result).toMatchObject({ status: 'failure', exitCode: 3 })
    expect(typeof result.detail).toBe('string')
  })

  it('resolves the callback on cancellation so the conversation is not left armed forever', async () => {
    seedBuild('build-cancel')
    const child = runBuildProcess({
      db,
      buildId: 'build-cancel',
      spawnCmd: process.platform === 'win32' ? 'timeout /t 30' : 'sleep 30',
      spawnArgs: [],
      cwd: process.cwd(),
      logEvent: 'build:log-chunk',
      doneEvent: 'build:command-done',
      registry,
    })

    cancelBuildProcess({ db, buildId: 'build-cancel', registry })

    expect(resolveDeferredCallback).toHaveBeenCalledWith(
      'build',
      'build-cancel',
      expect.objectContaining({ status: 'cancelled' }),
    )

    // The killed shell still emits 'close' asynchronously, and the runner's close handler queries
    // the database. Let that settle inside the test, otherwise it runs after afterEach() has closed
    // the connection and surfaces as an unhandled rejection from the sqlite layer.
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        setTimeout(resolve, 50)
        return
      }
      child.on('close', () => setTimeout(resolve, 50))
    })
  })

  it('does not fail the build when the deferred resolver throws', async () => {
    vi.mocked(resolveDeferredCallback).mockRejectedValueOnce(new Error('resolver exploded'))
    seedBuild('build-throw')
    await runToCompletion('build-throw', 'exit 0')

    const row = db.prepare('SELECT status, exit_code FROM build_records WHERE id = ?').get('build-throw') as {
      status: string
      exit_code: number
    }
    expect(row.status).toBe('success')
    expect(row.exit_code).toBe(0)
  })
})
