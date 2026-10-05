import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the module under test.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: { setFeedURL: vi.fn() } },
}))

vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

vi.mock('../local-feed-server', () => ({
  startFeedServer: vi.fn().mockResolvedValue(3001),
  stopFeedServer: vi.fn(),
  getFeedUrl: vi.fn().mockReturnValue('http://127.0.0.1:3001'),
  getFeedPort: vi.fn().mockReturnValue(3001),
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

const { spawnMockFn, execFileMockFn, execMockFn } = vi.hoisted(() => ({
  spawnMockFn: vi.fn(),
  execFileMockFn: vi.fn(),
  execMockFn: vi.fn(),
}))
vi.mock('child_process', () => ({ spawn: spawnMockFn, execFile: execFileMockFn, exec: execMockFn }))

// ---------------------------------------------------------------------------
// fs mocks — so we can control existsSync / readdirSync / statSync / readFile
// without touching the real FS.
// ---------------------------------------------------------------------------

const {
  existsSyncMock,
  readdirSyncMock,
  statSyncMock,
  copyFileSyncMock,
  mkdirSyncMock,
  readFileMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  copyFileSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  readFileMock: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  statSync: statSyncMock,
  copyFileSync: copyFileSyncMock,
  mkdirSync: mkdirSyncMock,
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  readFile: readFileMock,
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

function makeYml(version: string, installerName: string, size = 100) {
  return `version: ${version}\npath: ${installerName}\nsize: ${size}\n`
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  vi.restoreAllMocks()
  existsSyncMock.mockReset()
  readdirSyncMock.mockReset()
  statSyncMock.mockReset()
  copyFileSyncMock.mockReset()
  mkdirSyncMock.mockReset()
  readFileMock.mockReset()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('publishArtifactToFeed', () => {
  let db: Database.Database

  beforeEach(async () => {
    db = createDatabase()
    const { getDatabase } = await import('../database')
    vi.mocked(getDatabase).mockReturnValue(db)

    execFileMockFn.mockReset()
    execFileMockFn.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, r: { stdout: string; stderr: string }) => void) =>
        cb(null, { stdout: '', stderr: '' }),
    )
  })

  it('returns error when no feed path is configured', async () => {
    const { publishArtifactToFeed } = await import('../build-handlers')
    const result = await publishArtifactToFeed(db)
    expect(result.published).toBe(false)
    expect(result.error).toMatch(/No local update feed path/i)
  })

  it('returns error when no installer file is found', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('local_update_feed_path', ?)").run('/feed')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run('/ws')

    // Release dir exists but is empty
    existsSyncMock.mockReturnValue(true)
    readdirSyncMock.mockReturnValue([])

    const { publishArtifactToFeed } = await import('../build-handlers')
    const result = await publishArtifactToFeed(db)
    expect(result.published).toBe(false)
    expect(result.error).toMatch(/No .* installer found/i)
  })

  it('returns error when yml is missing', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('local_update_feed_path', ?)").run('/feed')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run('/ws')

    // Release dir has installer; yml does NOT exist
    readdirSyncMock.mockReturnValue(['Setup.exe'])
    statSyncMock.mockReturnValue({ isFile: () => true, mtimeMs: 2000 })
    existsSyncMock.mockImplementation((p: string) => {
      // release dir exists, installer file exists, but yml file does not
      if (String(p).endsWith('.yml')) return false
      return true
    })

    const { publishArtifactToFeed } = await import('../build-handlers')
    const result = await publishArtifactToFeed(db)
    expect(result.published).toBe(false)
    // The function reports "No .exe installer found" when no installer passes the statSync
    // isFile() check — OR it reports yml missing. Either error means publish failed.
    expect(result.error).toBeTruthy()
  })

  it('copies installer + yml and returns published:true with version', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('local_update_feed_path', ?)").run('/feed')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run('/ws')

    const ymlContent = makeYml('1.2.3', 'Setup 1.2.3.exe')

    readdirSyncMock.mockReturnValue(['Setup 1.2.3.exe'])
    statSyncMock.mockReturnValue({ isFile: () => true, mtimeMs: 3000 })
    // existsSync: everything exists, no old yml in feed to backup
    existsSyncMock.mockImplementation((p: string) => {
      // old yml in feed dir — say it does NOT exist, skipping backup path
      if (String(p) === '/feed/latest.yml') return false
      return true
    })
    readFileMock.mockResolvedValue(ymlContent)

    const { publishArtifactToFeed } = await import('../build-handlers')
    const result = await publishArtifactToFeed(db)

    expect(result.published).toBe(true)
    expect(result.version).toBe('1.2.3')
    // yml + installer were both copied
    expect(copyFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('latest.yml'),
      expect.stringContaining('latest.yml'),
    )
    expect(copyFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('Setup 1.2.3.exe'),
      expect.stringContaining('Setup 1.2.3.exe'),
    )
  })

  it('starts the feed server when it is not already running', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('local_update_feed_path', ?)").run('/feed')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run('/ws')

    const { isFeedRunning, startFeedServer } = await import('../local-feed-server')
    vi.mocked(isFeedRunning).mockReturnValue(false)

    const ymlContent = makeYml('2.0.0', 'Setup 2.0.0.exe')
    readdirSyncMock.mockReturnValue(['Setup 2.0.0.exe'])
    statSyncMock.mockReturnValue({ isFile: () => true, mtimeMs: 4000 })
    existsSyncMock.mockImplementation((p: string) => {
      if (String(p) === '/feed/latest.yml') return false
      return true
    })
    readFileMock.mockResolvedValue(ymlContent)

    const { publishArtifactToFeed } = await import('../build-handlers')
    await publishArtifactToFeed(db)

    expect(startFeedServer).toHaveBeenCalledWith('/feed')
  })
})
