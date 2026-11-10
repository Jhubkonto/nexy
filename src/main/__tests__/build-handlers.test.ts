import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'

// ---------------------------------------------------------------------------
// Mock electron, database, and safe-handle before importing the module
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: { setFeedURL: vi.fn() } },
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

vi.mock('../local-feed-server', () => ({
  startFeedServer: vi.fn().mockResolvedValue(0),
  stopFeedServer: vi.fn(),
  getFeedUrl: vi.fn().mockReturnValue(''),
  getFeedPort: vi.fn().mockReturnValue(0),
  isFeedRunning: vi.fn().mockReturnValue(false),
  getFeedDir: vi.fn().mockReturnValue(''),
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
  startWsServer: vi.fn(),
  stopWsServer: vi.fn(),
  getWsStatus: vi.fn(),
  getQrDataUrl: vi.fn(),
  regenerateToken: vi.fn(),
  setWsCommandHandler: vi.fn(),
  getWakelockEnabled: vi.fn(),
  setWakelockEnabled: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const openDatabases: Database.Database[] = []

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeBaseSchema(db)
  runMigrations(db)
  openDatabases.push(db)
  return db
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
  vi.restoreAllMocks()
})

describe('desktop package version preparation', () => {
  let root: string
  let workspace: string
  let feed: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'nexy-package-version-'))
    workspace = path.join(root, 'workspace')
    feed = path.join(root, 'feed')
    await Promise.all([mkdir(workspace), mkdir(feed)])
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'nexy', version: '1.6.2' }))
    await writeFile(path.join(workspace, 'package-lock.json'), JSON.stringify({ version: '1.6.2', packages: { '': { version: '1.6.2' } } }))
  })

  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  async function publish(version: string) {
    const name = process.platform === 'darwin' ? 'latest-mac.yml' : process.platform === 'linux' ? 'latest-linux.yml' : 'latest.yml'
    await writeFile(path.join(feed, name), `version: ${version}\npath: installer.exe\n`)
  }

  it('increments matching versions and updates both lockfile versions', async () => {
    const { prepareDesktopPackageVersion } = await import('../build-handlers')
    await publish('1.6.2')
    expect(await prepareDesktopPackageVersion(workspace, feed)).toBe('1.6.3')
    expect(JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8')).version).toBe('1.6.3')
    const lock = JSON.parse(await readFile(path.join(workspace, 'package-lock.json'), 'utf8'))
    expect([lock.version, lock.packages[''].version]).toEqual(['1.6.3', '1.6.3'])
    expect(await prepareDesktopPackageVersion(workspace, feed)).toBe('1.6.3')
  })

  it('rejects an older workspace and an unavailable feed without modifying the version', async () => {
    const { prepareDesktopPackageVersion } = await import('../build-handlers')
    await publish('1.7.0')
    await expect(prepareDesktopPackageVersion(workspace, feed)).rejects.toThrow('older than published')
    await expect(prepareDesktopPackageVersion(workspace, null)).rejects.toThrow('Configure a local update feed')
    expect(JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8')).version).toBe('1.6.2')
  })
})

// ---------------------------------------------------------------------------
// Tests: getWorkspaceInfo
// ---------------------------------------------------------------------------

describe('getWorkspaceInfo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDatabase()
  })

  it('returns git metadata when inside a git repo', async () => {
    const { execSync } = await import('child_process')
    const { mkdirSync, rmSync, writeFileSync } = await import('fs')
    const { join } = await import('path')
    const tmpDir = require('os').tmpdir() as string
    const repoDir = join(tmpDir, `nexy-build-git-${Date.now()}`)

    mkdirSync(repoDir, { recursive: true })
    execSync('git init', { cwd: repoDir, stdio: 'ignore' })
    execSync('git config user.email test@example.com', { cwd: repoDir, stdio: 'ignore' })
    execSync('git config user.name Test', { cwd: repoDir, stdio: 'ignore' })
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    execSync('git add package.json', { cwd: repoDir, stdio: 'ignore' })
    execSync('git commit -m init', { cwd: repoDir, stdio: 'ignore' })
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(repoDir)

    try {
      const { getWorkspaceInfo } = await import('../build-handlers')
      const info = await getWorkspaceInfo(db)

      expect(info.isGitRepo).toBe(true)
      expect(info.path).toBe(repoDir)
      expect(info.branch).toBeTruthy()
      expect(info.commitSha).toBeTruthy()
      expect(typeof info.dirty).toBe('boolean')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it('returns isGitRepo false when workspace is not a git repo', async () => {
    // Use the OS temp directory which is never a git repo
    const tmpDir = require('os').tmpdir() as string
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(tmpDir)

    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = await getWorkspaceInfo(db)

    expect(info.isGitRepo).toBe(false)
    expect(info.branch).toBeNull()
    expect(info.commitSha).toBeNull()
    expect(info.dirty).toBe(false)
  })

  it('respects build_workspace_path setting', async () => {
    const tmpDir = require('os').tmpdir() as string
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(tmpDir)

    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = await getWorkspaceInfo(db)

    expect(info.path).toBe(tmpDir)
  })

  it('falls back to process.cwd() when no setting is stored', async () => {
    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = await getWorkspaceInfo(db)

    expect(info.path).toBe(process.cwd())
  })
})

// ---------------------------------------------------------------------------
// Tests: build_records migration
// ---------------------------------------------------------------------------

describe('build_records migration', () => {
  it('creates the build_records table with artifact metadata columns', () => {
    const db = createDatabase()
    openDatabases.push(db)

    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='build_records'")
      .get() as { name: string } | undefined

    expect(row?.name).toBe('build_records')

    // Verify all expected columns exist
    const columns = db.prepare("PRAGMA table_info(build_records)").all() as { name: string }[]
    const columnNames = columns.map((c) => c.name)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('workspace_path')
    expect(columnNames).toContain('commit_sha')
    expect(columnNames).toContain('branch')
    expect(columnNames).toContain('version')
    expect(columnNames).toContain('platform')
    expect(columnNames).toContain('command')
    expect(columnNames).toContain('status')
    expect(columnNames).toContain('exit_code')
    expect(columnNames).toContain('version_code')
    expect(columnNames).toContain('artifact_paths')
    expect(columnNames).toContain('artifact_checksums')
    expect(columnNames).toContain('log_tail')
    expect(columnNames).toContain('started_at')
    expect(columnNames).toContain('finished_at')
  })

  it('can insert and query build records', () => {
    const db = createDatabase()
    openDatabases.push(db)

    db.prepare(
      `INSERT INTO build_records
        (id, workspace_path, commit_sha, branch, version, platform, command, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('build-1', '/workspace', 'abc1234', 'main', '0.9.0', 'win32', 'typecheck', 'running', Date.now())

    const row = db.prepare('SELECT * FROM build_records WHERE id = ?').get('build-1') as Record<string, unknown>
    expect(row).toBeDefined()
    expect(row.status).toBe('running')
    expect(row.command).toBe('typecheck')

    db.prepare("UPDATE build_records SET status = 'success', exit_code = 0, finished_at = ? WHERE id = ?").run(Date.now(), 'build-1')
    const updated = db.prepare('SELECT status FROM build_records WHERE id = ?').get('build-1') as { status: string }
    expect(updated.status).toBe('success')
  })

  it('migration 40 adds mobile_initiated column with default 0', () => {
    const db = createDatabase()
    openDatabases.push(db)

    const columns = db.prepare('PRAGMA table_info(build_records)').all() as { name: string; dflt_value: string | null }[]
    const col = columns.find((c) => c.name === 'mobile_initiated')
    expect(col).toBeDefined()
    expect(col?.dflt_value).toBe('0')
  })

  it('can insert a mobile-initiated build record', () => {
    const db = createDatabase()
    openDatabases.push(db)

    db.prepare(
      `INSERT INTO build_records
        (id, workspace_path, platform, command, status, started_at, mobile_initiated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('mob-1', '/ws', 'win32', 'typecheck', 'running', Date.now(), 1)

    const row = db.prepare('SELECT mobile_initiated FROM build_records WHERE id = ?').get('mob-1') as { mobile_initiated: number }
    expect(row.mobile_initiated).toBe(1)
  })
})
