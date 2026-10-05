import { app, BrowserWindow, shell, globalShortcut, Tray, Menu, nativeImage, ipcMain, powerMonitor } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { getDatabase, closeDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { registerAuthHandlers } from './auth'
import { initMcpServers, shutdownMcpServers } from './mcp'
import { stopDevelopmentMcpBridge } from './development-mcp'
import { stopAllIsolatedNexyInstances } from './isolated-runtime'
import { initAutoUpdater, registerUpdaterHandlers, checkForUpdatesOnStartup } from './updater'
import { loadModelCatalog } from './model-catalog'
import { ClaudeAdapter } from './cli-adapters/claude'
import { probeClaudeCliModels, cacheClaudeCliDiscovery } from './cli-adapters/claude-model-probe'
import { initLogger } from './logger'
import { validateSender } from './safe-handle'
import { initDebugMode, debugLog } from './debug-mode'
import { initErrorLogCapture } from './error-log-handlers'
import { autoStartWsServerIfEnabled, startWsServerIfNeeded, getCurrentPairingUrl, setIpChangeCallback, setClientCountChangeCallback } from './ws-server'
import { sendDesktopOnlinePush, sendIpChangedPush } from './fcm-sender'
import { getSchedulerTraySummary, schedulerEngine, setSchedulerStatusChangeCallback } from './scheduler-engine'
import { startDeferredCallbackEngine } from './deferred-callbacks'
import { initializeActivityBadge, setUnseenCountChangeCallback } from './activity-badge'
import { cancelAllPendingUserInputs } from './user-input'
import { applyStoredAutoStartSetting, isRunInBackgroundEnabled } from './app-lifecycle-settings'
import { HermesAcpAdapterInstance } from './cli-adapters/hermes-acp'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let mobileClientCount = 0

const isDev = !app.isPackaged
const PROTOCOL = 'nexy'
const isIsolatedRuntime = process.env.NEXY_ISOLATED_RUNTIME === '1' || process.argv.includes('--nexy-isolated-runtime')
const isolatedUserData = process.env.NEXY_ISOLATED_USER_DATA

// This must happen before database initialization and before the single-instance lock.
// An isolated runtime must never attach to the user's normal profile.
if (isolatedUserData) {
  mkdirSync(isolatedUserData, { recursive: true })
  app.setPath('userData', isolatedUserData)
}

// Register deep link protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      join(__dirname, '..')
    ])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

function createWindow(showOnReady = true): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Nexy',
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Content Security Policy — relaxed in dev for Vite HMR
  const devCsp = isDev ? " http://localhost:* ws://localhost:*" : ""
  const isolatedRuntimeCsp = isIsolatedRuntime ? " http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*" : ""
  const scriptSrc = isDev ? "'self' 'unsafe-inline' http://localhost:* ws://localhost:*" : "'self'"
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'${devCsp}${isolatedRuntimeCsp}; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'${devCsp}${isolatedRuntimeCsp}; img-src 'self' data:${isIsolatedRuntime ? '' : ' https:'}; connect-src 'self'${isIsolatedRuntime ? isolatedRuntimeCsp : ' https://api.openai.com https://api.anthropic.com https://*.openai.azure.com https://api.github.com'}${devCsp}; font-src 'self'${devCsp}${isolatedRuntimeCsp}`
        ]
      }
    })
  })
  if (isIsolatedRuntime) {
    mainWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      try {
        const hostname = new URL(details.url).hostname
        callback({ cancel: hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1' })
      } catch {
        callback({ cancel: true })
      }
    })
  }

  mainWindow.on('ready-to-show', () => {
    if (!isIsolatedRuntime) initializeActivityBadge()
    const db = getDatabase()
    const zoomRow = db.prepare("SELECT value FROM settings WHERE key = 'zoomFactor'").get() as { value: string } | undefined
    if (zoomRow) {
      const factor = parseFloat(zoomRow.value)
      if (!isNaN(factor) && factor >= 0.5 && factor <= 3.0) {
        mainWindow?.webContents.setZoomFactor(factor)
      }
    }
    if (showOnReady && !isIsolatedRuntime) mainWindow?.show()
    if (mainWindow && !isIsolatedRuntime) {
      void loadModelCatalog(mainWindow).catch(() => {})
    }
    if (!isIsolatedRuntime && ClaudeAdapter.isAvailable()) {
      void probeClaudeCliModels()
        .then((discovery) => {
          // Do not make a partial rendered menu authoritative. The snapshot function preserves
          // the last complete result and tells us whether selectable choices actually changed.
          const changed = cacheClaudeCliDiscovery(discovery)
          debugLog('claude-models', `discovery=${discovery.status} version=${discovery.cliVersion ?? 'unknown'} models=[${discovery.models.map((model) => model.id).join(',')}]${'reason' in discovery ? ` reason=${discovery.reason}` : ''}`)
          if (changed) mainWindow?.webContents.send('model:cli-models-updated')
        })
        .catch(() => {})
    }
  })

  mainWindow.on('close', (event) => {
    if (isQuitting || !isRunInBackgroundEnabled()) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isIsolatedRuntime) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Allow opening DevTools with Ctrl+Shift+I in any mode
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow?.webContents.toggleDevTools()
    }
  })
}

function showMainWindow(afterLoad?: () => void): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(true)
    if (afterLoad) mainWindow?.webContents.once('did-finish-load', afterLoad)
    return
  }
  mainWindow.show()
  mainWindow.focus()
  afterLoad?.()
}

// Windows' notification area does not reliably render SVG data URLs passed to Tray. Use the
// generated PNG logo instead. electron-builder's buildResources directory is only read while
// packaging, so the asset is copied into the installed app's resources directory as tray-icon.png.
function buildTrayIcon() {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray-icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) return icon

  // Keep development/startup resilient if the generated asset is temporarily unavailable.
  const fallbackSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<rect x="1" y="1" width="30" height="30" rx="7" fill="#090D18"/>',
    '<rect x="3" y="3" width="26" height="26" rx="6" fill="#53627D"/>',
    '<rect x="4" y="4" width="24" height="24" rx="5" fill="#121A2B"/>',
    '<rect x="7" y="6" width="4" height="20" rx="1" fill="#8D7CFF"/>',
    '<rect x="21" y="6" width="4" height="20" rx="1" fill="#8D7CFF"/>',
    '<polygon points="10,6 14,6 22,26 18,26" fill="#8D7CFF"/>',
    '</svg>',
  ].join('')
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString('base64')}`)
}

function updateTrayIcon(): void {
  tray?.setImage(buildTrayIcon())
}

function formatTrayRunTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function refreshTrayPresentation(): void {
  if (!tray) return
  const summary = getSchedulerTraySummary()
  const scheduleLabel = `${summary.armedCount} ${summary.armedCount === 1 ? 'schedule' : 'schedules'} armed`
  const mobileLabel = mobileClientCount > 0
    ? `${mobileClientCount} Android connected`
    : 'no Android connected'

  tray.setToolTip(`Nexy — ${scheduleLabel}; ${mobileLabel}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Nexy',
      click: () => showMainWindow(),
    },
    {
      label: 'New Chat',
      click: () => showMainWindow(() => mainWindow?.webContents.send('chat:new')),
    },
    { type: 'separator' },
    {
      label: `Schedules: ${summary.armedCount} armed`,
      enabled: false,
    },
    {
      label: summary.nextRunAt === null
        ? 'Next run: none'
        : `Next run: ${formatTrayRunTime(summary.nextRunAt)}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
}

function createTray(): void {
  tray = new Tray(buildTrayIcon())
  setUnseenCountChangeCallback(updateTrayIcon)
  setSchedulerStatusChangeCallback(refreshTrayPresentation)
  refreshTrayPresentation()

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      showMainWindow()
    }
  })
}

function registerGlobalHotkey(): void {
  const hotkey = process.platform === 'darwin' ? 'CommandOrControl+Shift+H' : 'Ctrl+Shift+H'

  globalShortcut.register(hotkey, () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      showMainWindow()
    }
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function handleDeepLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'chat' && parsed.pathname.length > 1) {
      const conversationId = parsed.pathname.slice(1)
      if (!UUID_RE.test(conversationId)) return
      mainWindow?.webContents.send('deeplink:open-chat', conversationId)
    } else if (parsed.hostname === 'agent' && parsed.pathname.length > 1) {
      const agentId = parsed.pathname.slice(1)
      if (!UUID_RE.test(agentId)) return
      mainWindow?.webContents.send('deeplink:open-agent', agentId)
    }
    showMainWindow()
  } catch {
    debugLog('app', `invalid deep link URL: ${url}`)
    console.warn('[app] invalid deep link URL:', url)
  }
}

// Handle deep links on second instance (Windows/Linux)
app.on('second-instance', (_event, commandLine) => {
  const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`))
  if (url) handleDeepLink(url)
  showMainWindow()
})

// Handle deep links on macOS
app.on('open-url', (_event, url) => {
  handleDeepLink(url)
})

app.whenReady().then(() => {
  initLogger()

  // Windows uses the AppUserModelID as the notification/toast sender name.
  // Without this, Electron falls back to the default "electron.app.Nexy".
  // Must match the NSIS appId in electron-builder.yml.
  app.setAppUserModelId('com.nexy.app')

  // Remove the default Electron application menu
  Menu.setApplicationMenu(null)

  // Initialize database
  getDatabase()
  // Keep login-item state synchronized and honor background auto-start without flashing a window.
  if (!isIsolatedRuntime) applyStoredAutoStartSetting()

  // Start scheduler after DB is ready
  if (!isIsolatedRuntime) schedulerEngine.start()

  // Sweep deferred callbacks: expire stale bindings, and report any job that was still in flight
  // when the app last closed so an interrupted build surfaces in its conversation instead of
  // silently never being reported.
  if (!isIsolatedRuntime) startDeferredCallbackEngine()

  if (!isIsolatedRuntime) registerAuthHandlers()
  if (!isIsolatedRuntime) registerUpdaterHandlers()

  const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden === true
  createWindow(!startHidden && !isIsolatedRuntime)
  if (!isIsolatedRuntime) initializeActivityBadge()
  registerIpcHandlers(mainWindow ?? undefined)
  if (!isIsolatedRuntime) setIpChangeCallback((newUrl) => {
    void sendIpChangedPush(getDatabase(), newUrl).catch(() => {})
  })

  if (!isIsolatedRuntime) setClientCountChangeCallback((count) => {
    mobileClientCount = count
    refreshTrayPresentation()
    mainWindow?.webContents.send('ws:client-count', count)
  })

  if (!isIsolatedRuntime) void autoStartWsServerIfEnabled().then(() => {
    const url = getCurrentPairingUrl()
    if (url) void sendDesktopOnlinePush(getDatabase(), url).catch(() => {})
  })

  if (!isIsolatedRuntime) powerMonitor.on('resume', () => {
    void startWsServerIfNeeded().then(() => {
      const url = getCurrentPairingUrl()
      if (url) void sendDesktopOnlinePush(getDatabase(), url).catch(() => {})
    })
  })
  if (!isIsolatedRuntime) createTray()
  if (!isIsolatedRuntime) registerGlobalHotkey()

  // Window control IPC handlers (use sender to target the correct window)
  const EDIT_ACTIONS = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])

  ipcMain.handle('window:minimize', (event) => {
    if (!validateSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:maximize', (event) => {
    if (!validateSender(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize(); else win.maximize()
  })
  ipcMain.handle('window:close', (event) => {
    if (!validateSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('window:is-maximized', (event) => {
    if (!validateSender(event)) return false
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
  ipcMain.handle('window:edit-action', (event, action: string) => {
    if (!validateSender(event)) return
    if (!EDIT_ACTIONS.has(action)) return
    const wc = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (!wc) return
    ;(wc as unknown as Record<string, () => void>)[action]?.()
  })
  ipcMain.handle('window:zoom', (event, delta: number) => {
    if (!validateSender(event)) return
    const wc = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (!wc) return
    const db = getDatabase()
    if (delta === 0) {
      wc.setZoomFactor(1.0)
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('zoomFactor', '1')").run()
    } else {
      const STEP = 0.1
      const current = wc.getZoomFactor()
      const next = Math.round(Math.min(3.0, Math.max(0.5, current + (delta > 0 ? STEP : -STEP))) * 10) / 10
      wc.setZoomFactor(next)
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('zoomFactor', ?)").run(String(next))
    }
  })

  // Forward maximize/restore state changes to the renderer
  if (mainWindow && !isIsolatedRuntime) {
    const sendMaximizeChange = (maximized: boolean) =>
      mainWindow?.webContents.send('window:maximize-change', maximized)
    mainWindow.on('maximize', () => sendMaximizeChange(true))
    mainWindow.on('unmaximize', () => sendMaximizeChange(false))
    mainWindow.on('enter-full-screen', () => sendMaximizeChange(true))
    mainWindow.on('leave-full-screen', () => sendMaximizeChange(false))
  }

  // Initialize auto-updater
  if (mainWindow && !isIsolatedRuntime) {
    initDebugMode(mainWindow)
    initErrorLogCapture(mainWindow)
    initAutoUpdater(mainWindow)
    checkForUpdatesOnStartup()
  }

  // Initialize MCP servers
  if (!isIsolatedRuntime) initMcpServers().catch((err) => {
    debugLog('mcp', `init failed at startup: ${err instanceof Error ? err.message : String(err)}`)
    console.error('[mcp] failed to init servers at startup:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(true)
    } else {
      showMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isRunInBackgroundEnabled()) {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  HermesAcpAdapterInstance.closeAll()
})

app.on('will-quit', () => {
  setSchedulerStatusChangeCallback(null)
  cancelAllPendingUserInputs()
  globalShortcut.unregisterAll()
  shutdownMcpServers().catch(() => {})
  stopDevelopmentMcpBridge().catch(() => {})
  stopAllIsolatedNexyInstances().catch(() => {})
  closeDatabase()
})
