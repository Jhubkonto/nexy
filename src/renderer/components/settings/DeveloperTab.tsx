import { useEffect, useMemo, useState } from 'react'
import { NexyIcon } from '../ui/icons'
import { TabHeader } from './TabHeader'
import type {
  AdbDevice,
  AndroidBuildCommandName,
  AndroidSigningConfig,
  AndroidUpdateManifest,
  AndroidWorkspaceInfo,
  BuildCommandName,
  BuildRecord,
  BuildStatus,
  ErrorLogEntry,
  LocalUpdateFeed,
  PreflightCheck,
  PublishedEntry,
  WorkspaceInfo,
} from '@shared/types'
import { Button, SegmentedTabs } from '../ui/primitives'
import { BuildLog } from '../BuildLog'

type LegacyIconProps = { className?: string }
const RefreshCw = ({ className }: LegacyIconProps) => <NexyIcon name="refresh" className={className} />
const CheckCircle = ({ className }: LegacyIconProps) => <NexyIcon name="check" className={className} />
const AlertTriangle = ({ className }: LegacyIconProps) => <NexyIcon name="warning" className={className} />
const XCircle = ({ className }: LegacyIconProps) => <NexyIcon name="error" className={className} />
const ChevronDown = ({ className }: LegacyIconProps) => <NexyIcon name="minimize" className={className} />
const ChevronRight = ({ className }: LegacyIconProps) => <NexyIcon name="chevron-right" className={className} />
const Rss = ({ className }: LegacyIconProps) => <NexyIcon name="external" className={className} />
const UploadCloud = ({ className }: LegacyIconProps) => <NexyIcon name="upload" className={className} />
const History = ({ className }: LegacyIconProps) => <NexyIcon name="restore" className={className} />
const Smartphone = ({ className }: LegacyIconProps) => <NexyIcon name="mobile" className={className} />

interface Props {
  // Desktop workspace
  workspaceInfo: WorkspaceInfo | null
  workspacePathInput: string
  onSetWorkspacePathInput: (v: string) => void
  onRefreshWorkspace: () => void
  onSaveWorkspacePath: (path?: string) => void
  // Desktop build
  buildRecords: BuildRecord[]
  activeBuildId: string | null
  activeBuildCommand: BuildCommandName | null
  buildLogLines: string[]
  lastBuildStatus: BuildStatus | null
  onRunBuildCommand: (cmd: BuildCommandName) => void
  onCancelBuild: () => void
  // Preflight
  preflightChecks: PreflightCheck[] | null
  preflightRunning: boolean
  onRunPreflight: () => void
  // Feed
  feedInfo: LocalUpdateFeed | null
  feedPathInput: string
  publishedEntries: PublishedEntry[]
  publishing: boolean
  publishResult: string | null
  onSetFeedPathInput: (v: string) => void
  onSaveFeedPath: (path?: string) => void
  onPublishUpdate: () => void
  onRollback: (version: string) => void
  // Launch dev
  launchDevError: string | null
  onLaunchDev: () => void
  // Android workspace
  androidWorkspaceInfo: AndroidWorkspaceInfo | null
  androidWorkspacePathInput: string
  onSetAndroidWorkspacePathInput: (v: string) => void
  onSaveAndroidWorkspacePath: (path?: string) => void
  onRefreshAndroidWorkspace: () => void
  // Android build
  androidBuildRecords: BuildRecord[]
  activeAndroidBuildId: string | null
  activeAndroidCommand: AndroidBuildCommandName | null
  androidLogLines: string[]
  androidLastBuildStatus: BuildStatus | null
  onAndroidStartCommand: (cmd: AndroidBuildCommandName) => void
  onAndroidCancelCommand: () => void
  // Signing
  signingDraft: AndroidSigningConfig
  signingValidation: PreflightCheck[] | null
  onSetSigningDraft: (updater: (d: AndroidSigningConfig) => AndroidSigningConfig) => void
  onSaveSigningConfig: () => void
  onValidateSigningConfig: () => void
  // ADB
  adbDevices: AdbDevice[]
  adbRefreshing: boolean
  adbInstalling: boolean
  latestAdbInstallRecord: BuildRecord | undefined
  latestAdbInstallApk: string | undefined
  onRefreshAdbDevices: () => void
  onAndroidInstallApk: (serial: string) => void
  // Android feed
  androidPublishResult: string | null
  androidUpdateManifest: AndroidUpdateManifest | null
  androidPublishHistory: AndroidUpdateManifest[]
  androidRestoring: number | null
  onAndroidPublishUpdate: () => void
  onAndroidRestoreVersion: (versionCode: number) => void
  // Debug
  debugLogging: boolean
  onToggleDebugLogging: () => void
  desktopPackagingBlocked: boolean
  // Set when the tab is opened from an activity feed entry that needs a specific sub-tab
  // (e.g. clicking an Android build activity should land on the Android sub-tab, not Desktop).
  initialDeveloperTab?: 'desktop' | 'android' | 'console' | null
  initialErrorLogId?: string | null
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
// Android Signing Modal
// ---------------------------------------------------------------------------

interface AndroidSigningModalProps {
  signingDraft: AndroidSigningConfig
  signingValidation: PreflightCheck[] | null
  onSetSigningDraft: (updater: (d: AndroidSigningConfig) => AndroidSigningConfig) => void
  onSaveSigningConfig: () => void
  onValidateSigningConfig: () => void
  onClose: () => void
}

function AndroidSigningModal({
  signingDraft, signingValidation, onSetSigningDraft, onSaveSigningConfig, onValidateSigningConfig, onClose,
}: AndroidSigningModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[440px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Use an existing Android signing key</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100">
            <p className="font-semibold">Most projects do not need this.</p>
            <p className="mt-1 leading-relaxed">
              Nexy creates a secure release key automatically the first time you run <span className="font-mono">assembleRelease</span>. Keep that key for all future updates so Android accepts them.
            </p>
          </div>
          <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
            <p className="font-medium text-gray-800 dark:text-gray-100">Only enter these details if you already have a signing key.</p>
            <p>Use the same keystore, alias, and passwords as the app currently installed on your devices. Changing keys means Android treats the build as a different app update and will reject it.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={signingDraft.keystorePath}
              onChange={(e) => onSetSigningDraft((d) => ({ ...d, keystorePath: e.target.value }))}
              placeholder="Keystore file path (.jks or .p12)"
              className="col-span-2 text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono"
            />
            <input
              type="password"
              value={signingDraft.keystorePassword}
              onChange={(e) => onSetSigningDraft((d) => ({ ...d, keystorePassword: e.target.value }))}
              placeholder="Keystore password"
              className="text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            />
            <input
              type="text"
              value={signingDraft.keyAlias}
              onChange={(e) => onSetSigningDraft((d) => ({ ...d, keyAlias: e.target.value }))}
              placeholder="Key alias (the name inside the keystore)"
              className="text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            />
            <input
              type="password"
              value={signingDraft.keyPassword}
              onChange={(e) => onSetSigningDraft((d) => ({ ...d, keyPassword: e.target.value }))}
              placeholder="Key password"
              className="col-span-2 text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            />
          </div>

          {signingValidation && (
            <div className="space-y-1 rounded border border-gray-100 dark:border-gray-700 p-2">
              {signingValidation.map((c) => (
                <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
                  {c.status === 'ok'
                    ? <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                    : c.status === 'warn'
                    ? <AlertTriangle className="w-3 h-3 text-yellow-500 shrink-0" />
                    : <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
                  <span className="text-gray-700 dark:text-gray-300">{c.label}</span>
                  <span className="text-gray-400 ml-auto">{c.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-700">
          <Button variant="secondary" onClick={onValidateSigningConfig} className="px-2.5 py-1 rounded text-gray-700 dark:text-gray-300">Validate</Button>
          <Button variant="secondary" onClick={onClose} className="px-2.5 py-1 rounded text-gray-600 dark:text-gray-400">Cancel</Button>
          <Button
            variant="primary"
            onClick={() => { onSaveSigningConfig(); onClose() }}
            className="px-2.5 py-1 rounded bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

async function browseForDirectory(apply: (path: string) => void): Promise<void> {
  const result = await window.api.openDirectoryDialog()
  if (Array.isArray(result) && result[0]) apply(result[0])
}

function normalizePath(p: string): string {
  return p.trim().toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '')
}

// Flags feed directories that builds will overwrite (build outputs) or that
// live inside a workspace checkout.
function feedPathWarning(feedPath: string, workspacePaths: (string | undefined)[]): string | null {
  const p = normalizePath(feedPath)
  if (!p) return null
  if (/\\(build|dist|out|release)(\\|$)/.test(p) || /\\node_modules(\\|$)/.test(p)) {
    return 'This looks like a build output directory — builds will overwrite or delete published files here. Choose a dedicated folder, e.g. C:\\nexy-feed.'
  }
  for (const ws of workspacePaths) {
    const wsNorm = ws ? normalizePath(ws) : ''
    if (wsNorm && (p === wsNorm || p.startsWith(`${wsNorm}\\`))) {
      return 'This folder is inside a workspace checkout — pick a folder outside the repo so published installers survive builds and clean checkouts.'
    }
  }
  return null
}

function PathWarning({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-yellow-700 dark:text-yellow-300">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
      {text}
    </p>
  )
}

function FeedStatusPill({ running, url }: { running: boolean; url: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${
      running
        ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
      {running ? <span className="font-mono">{url}</span> : 'Feed offline'}
    </span>
  )
}

function PublishResultLine({ result }: { result: string }) {
  const failed = !/^published/i.test(result)
  return (
    <p className={`flex items-center gap-1.5 text-[11px] ${
      failed ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'
    }`}>
      {failed ? <XCircle className="w-3.5 h-3.5 shrink-0" /> : <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
      {result}
    </p>
  )
}

type DeveloperInnerTab = 'desktop' | 'android' | 'console'

const DESKTOP_COMMANDS: BuildCommandName[] = ['typecheck', 'test', 'build', 'package']

function isDesktopCommand(command: BuildRecord['command']): command is BuildCommandName {
  return DESKTOP_COMMANDS.includes(command as BuildCommandName)
}

function commandDisplayName(command: BuildCommandName): string {
  switch (command) {
    case 'typecheck':
      return 'Typecheck'
    case 'test':
      return 'Tests'
    case 'build':
      return 'Build'
    case 'package':
      return 'Package'
    default:
      return command
  }
}

function nextDesktopCommand(command: BuildCommandName): BuildCommandName | null {
  switch (command) {
    case 'typecheck':
      return 'test'
    case 'test':
      return 'build'
    case 'build':
      return 'package'
    default:
      return null
  }
}

function desktopOutcomeCopy(record: BuildRecord | undefined): { title: string; detail: string; action?: BuildCommandName } {
  if (!record) {
    return {
      title: 'No desktop command has run yet',
      detail: 'Start with typecheck, then run tests, build, and package when each step passes.',
      action: 'typecheck',
    }
  }
  if (!isDesktopCommand(record.command)) {
    return {
      title: 'No desktop command has run yet',
      detail: 'Start with typecheck, then run tests, build, and package when each step passes.',
      action: 'typecheck',
    }
  }

  if (record.status === 'running') {
    return {
      title: `${commandDisplayName(record.command)} is running`,
      detail: 'Watch the output below. You can cancel the running command from the command row.',
    }
  }

  if (record.status === 'cancelled') {
    return {
      title: `${commandDisplayName(record.command)} was cancelled`,
      detail: 'Re-run it when you are ready, or choose another command.',
      action: record.command,
    }
  }

  if (record.status === 'failed') {
    return {
      title: `${commandDisplayName(record.command)} failed`,
      detail: 'Open the output, copy the log if needed, fix the reported issue, then re-run this same command.',
      action: record.command,
    }
  }

  const next = nextDesktopCommand(record.command)
  if (next) {
    return {
      title: `${commandDisplayName(record.command)} passed`,
      detail: `Next: run ${next} to continue the desktop release flow.`,
      action: next,
    }
  }

  return {
    title: 'Package completed',
    detail: 'Next: set a local update feed if needed, then publish the packaged installer for update testing.',
  }
}

export function DeveloperTab({
  workspaceInfo, workspacePathInput, onSetWorkspacePathInput, onRefreshWorkspace, onSaveWorkspacePath,
  buildRecords, activeBuildId, activeBuildCommand, buildLogLines, lastBuildStatus,
  onRunBuildCommand, onCancelBuild,
  preflightChecks, preflightRunning, onRunPreflight,
  feedInfo, feedPathInput, publishedEntries, publishing, publishResult,
  onSetFeedPathInput, onSaveFeedPath, onPublishUpdate, onRollback,
  launchDevError, onLaunchDev,
  androidWorkspaceInfo, androidWorkspacePathInput, onSetAndroidWorkspacePathInput,
  onSaveAndroidWorkspacePath, onRefreshAndroidWorkspace,
  androidBuildRecords, activeAndroidBuildId, activeAndroidCommand, androidLogLines, androidLastBuildStatus,
  onAndroidStartCommand, onAndroidCancelCommand,
  signingDraft, signingValidation, onSetSigningDraft, onSaveSigningConfig, onValidateSigningConfig,
  adbDevices, adbRefreshing, adbInstalling, latestAdbInstallRecord, latestAdbInstallApk,
  onRefreshAdbDevices, onAndroidInstallApk,
  androidPublishResult, androidUpdateManifest, androidPublishHistory, androidRestoring,
  onAndroidPublishUpdate, onAndroidRestoreVersion,
  desktopPackagingBlocked,
  debugLogging, onToggleDebugLogging,
  initialDeveloperTab,
  initialErrorLogId,
}: Props) {
  const [developerTab, setDeveloperTab] = useState<DeveloperInnerTab>(initialDeveloperTab ?? 'desktop')
  const [developmentMcpStatus, setDevelopmentMcpStatus] = useState<Awaited<ReturnType<typeof window.api.getDevelopmentMcpStatus>> | null>(null)
  const [developmentMcpConnection, setDevelopmentMcpConnection] = useState<Awaited<ReturnType<typeof window.api.startDevelopmentMcp>> | null>(null)
  const [developmentMcpBusy, setDevelopmentMcpBusy] = useState(false)
  const [developmentMcpError, setDevelopmentMcpError] = useState<string | null>(null)

  // The settings modal (and this tab) can stay mounted across multiple activity-feed clicks —
  // react to a later request to switch sub-tab rather than only honoring the initial mount value.
  useEffect(() => {
    if (initialDeveloperTab) setDeveloperTab(initialDeveloperTab)
  }, [initialDeveloperTab])

  useEffect(() => {
    if (developerTab !== 'desktop' || !workspaceInfo?.isNexyWorkspace) return
    void window.api.getDevelopmentMcpStatus().then(setDevelopmentMcpStatus).catch(() => setDevelopmentMcpStatus(null))
  }, [developerTab, workspaceInfo?.isNexyWorkspace, workspaceInfo?.path])

  const connectDevelopmentMcp = async () => {
    setDevelopmentMcpBusy(true)
    setDevelopmentMcpError(null)
    try { const connection = await window.api.startDevelopmentMcp(); setDevelopmentMcpConnection(connection); setDevelopmentMcpStatus({ workspacePath: workspaceInfo?.path ?? null, running: true, url: connection.url, stdio: { command: connection.command, args: connection.args, env: connection.env } }) }
    catch (error) { setDevelopmentMcpError(error instanceof Error ? error.message : 'Could not connect the development bridge') }
    finally { setDevelopmentMcpBusy(false) }
  }
  const stopDevelopmentMcp = async () => {
    setDevelopmentMcpBusy(true)
    setDevelopmentMcpError(null)
    try { await window.api.stopDevelopmentMcp(); setDevelopmentMcpConnection(null); setDevelopmentMcpStatus((status) => ({ workspacePath: status?.workspacePath ?? workspaceInfo?.path ?? null, running: false, url: null, stdio: null })) }
    catch (error) { setDevelopmentMcpError(error instanceof Error ? error.message : 'Could not stop the development bridge') }
    finally { setDevelopmentMcpBusy(false) }
  }
  const copyDevelopmentMcpSetup = async () => {
    const setup = developmentMcpConnection ?? developmentMcpStatus?.stdio
    if (!setup) return
    await navigator.clipboard.writeText(JSON.stringify({ mcpServers: { nexyDevelopment: { command: setup.command, args: setup.args, env: setup.env } } }, null, 2))
  }

  // Console state
  const [consoleEntries, setConsoleEntries] = useState<ErrorLogEntry[]>([])
  const [consoleLevel, setConsoleLevel] = useState<'all' | ErrorLogEntry['level']>('all')
  const [consoleStatus, setConsoleStatus] = useState<string | null>(null)
  const [unreadErrorCount, setUnreadErrorCount] = useState(0)

  useEffect(() => {
    if (!initialErrorLogId || developerTab !== 'console' || !consoleEntries.some((entry) => entry.id === initialErrorLogId)) return
    const target = document.getElementById(`error-log-${initialErrorLogId}`)
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' })
  }, [initialErrorLogId, developerTab, consoleEntries])

  // Build history expand
  const [expandedDesktopHistoryId, setExpandedDesktopHistoryId] = useState<string | null>(null)
  const [expandedAndroidHistoryId, setExpandedAndroidHistoryId] = useState<string | null>(null)

  // Signing modal
  const [signingModalOpen, setSigningModalOpen] = useState(false)

  const activeFeedPathWarning = useMemo(
    () => feedPathWarning(feedPathInput || (feedInfo?.feedPath ?? ''), [workspaceInfo?.path, androidWorkspaceInfo?.path]),
    [feedPathInput, feedInfo?.feedPath, workspaceInfo?.path, androidWorkspaceInfo?.path],
  )

  const latestDesktopBuild = buildRecords[0]
  const latestDesktopOutcome = desktopOutcomeCopy(latestDesktopBuild)
  // A subsequent typecheck, test, or build does not remove the installer that
  // a successful package command put in release/.  Looking only at the first
  // record therefore made publishing unavailable immediately after any later
  // desktop command completed.
  const latestSuccessfulDesktopPackage = buildRecords.find(
    (record) => isDesktopCommand(record.command) && record.command === 'package' && record.status === 'success',
  )
  const canPublishDesktopPackage = Boolean(latestSuccessfulDesktopPackage)
  const canLaunchDevBuild = latestDesktopBuild && isDesktopCommand(latestDesktopBuild.command) && latestDesktopBuild.command === 'build' && latestDesktopBuild.status === 'success'
  const latestSuccessfulAndroidRelease = androidBuildRecords.find(
    (record) => record.command === 'assembleRelease' && record.status === 'success',
  )
  const androidReleaseFeedState = (() => {
    if (!latestSuccessfulAndroidRelease) return 'no-release' as const
    if (!androidUpdateManifest) return 'not-published' as const
    if (
      androidUpdateManifest.versionCode !== latestSuccessfulAndroidRelease.versionCode ||
      (androidUpdateManifest.buildId != null && androidUpdateManifest.buildId !== latestSuccessfulAndroidRelease.id)
    ) {
      return 'mismatch' as const
    }
    return androidUpdateManifest.buildId == null ? 'legacy-match' as const : 'match' as const
  })()

  // Preflight worst status for tab badge
  const preflightWorst = preflightChecks?.some((c) => c.status === 'fail') ? 'fail'
    : preflightChecks?.some((c) => c.status === 'warn') ? 'warn'
    : preflightChecks?.length ? 'pass'
    : null

  // Reset unread count when Console tab becomes active
  useEffect(() => {
    if (developerTab === 'console') {
      setUnreadErrorCount(0)
    }
  }, [developerTab])

  // Console entries subscription
  useEffect(() => {
    if (
      typeof window.api.getRecentErrors !== 'function' ||
      typeof window.api.onErrorLogEntry !== 'function'
    ) {
      return
    }
    let cancelled = false
    window.api.getRecentErrors(100)
      .then((entries) => {
        if (!cancelled) setConsoleEntries(entries)
      })
      .catch(() => {
        if (!cancelled) setConsoleStatus('Failed to load error log')
      })
    const off = window.api.onErrorLogEntry((entry) => {
      setConsoleEntries((prev) => [...prev.slice(-199), entry])
      if (entry.level === 'error') {
        setUnreadErrorCount((n) => n + 1)
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const filteredConsoleEntries = useMemo(
    () => consoleEntries.filter((entry) => consoleLevel === 'all' || entry.level === consoleLevel),
    [consoleEntries, consoleLevel],
  )
  const handleClearConsole = async () => {
    await window.api.clearErrors()
    setConsoleEntries([])
    setConsoleStatus('Console cleared')
  }

  const handleCopyConsole = async () => {
    const text = filteredConsoleEntries
      .map((entry) => {
        const line = `${new Date(entry.timestamp).toLocaleTimeString()} [${entry.level}] [${entry.source}] ${entry.message}`
        return entry.stack ? `${line}\n${entry.stack}` : line
      })
      .join('\n')
    await navigator.clipboard.writeText(text)
    setConsoleStatus('Copied visible entries')
  }

  // Desktop tab label with preflight dot
  const desktopTabLabel = (
    <span className="inline-flex items-center gap-1.5">
      Desktop
      {preflightWorst && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          preflightWorst === 'fail' ? 'bg-red-500' :
          preflightWorst === 'warn' ? 'bg-yellow-400' :
          'bg-green-500'
        }`} />
      )}
    </span>
  )

  return (
    <div className="nexy-developer-tools text-nexy-text">
      <TabHeader title="Developer" description="Build, test, and package the app from within Nexy." />

      <SegmentedTabs
        value={developerTab}
        items={[
          { id: 'desktop', label: desktopTabLabel },
          { id: 'android', label: 'Android' },
          { id: 'console', label: 'Console', badge: unreadErrorCount },
        ]}
        onChange={setDeveloperTab}
      />

      {/* ================================================================
          DESKTOP TAB
      ================================================================ */}
      {developerTab === 'desktop' && (
        <div className="space-y-4">
          {/* Workspace */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Workspace</p>
              <button
                onClick={onRefreshWorkspace}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={workspacePathInput}
                onChange={(e) => onSetWorkspacePathInput(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button
                variant="secondary"
                onClick={() => void browseForDirectory((p) => onSaveWorkspacePath(p))}
                className="rounded-lg"
              >
                Browse…
              </Button>
              <Button
                variant="primary"
                onClick={() => onSaveWorkspacePath()}
                className="rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-900 dark:hover:bg-gray-100"
              >
                Save
              </Button>
            </div>
            {workspaceInfo && !workspaceInfo.hasPackageJson && (
              <PathWarning text="No package.json found here — point this at the Nexy source checkout (the folder you run npm from), not the installed app." />
            )}
            {workspaceInfo?.isNexyWorkspace && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/60 dark:bg-blue-950/30">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Agent-assisted testing</p>
                    <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">Connect an external agent to this Nexy checkout. It can build, launch a disposable loopback runtime, use its Playwright tools, and report findings. Every write, command, Git change, build, and runtime action requires approval.</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${developmentMcpStatus?.running ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{developmentMcpStatus?.running ? 'Connected' : 'Stopped'}</span>
                </div>
                <p className="mt-2 truncate font-mono text-[10px] text-gray-500 dark:text-gray-400">{workspaceInfo.path}</p>
                {developmentMcpError && <p className="mt-2 text-[11px] text-red-700 dark:text-red-300">{developmentMcpError}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {developmentMcpStatus?.running ? <><Button variant="secondary" onClick={() => void stopDevelopmentMcp()} disabled={developmentMcpBusy}>Stop access</Button><Button variant="primary" onClick={() => void copyDevelopmentMcpSetup()} disabled={!developmentMcpConnection && !developmentMcpStatus?.stdio}>Copy MCP setup</Button></> : <Button variant="primary" onClick={() => void connectDevelopmentMcp()} disabled={developmentMcpBusy}>{developmentMcpBusy ? 'Connecting…' : 'Connect external agent'}</Button>}
                </div>
              </div>
            )}
            {workspaceInfo && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {workspaceInfo.isGitRepo ? (
                  <>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono">
                      {workspaceInfo.branch ?? '(detached)'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-mono">
                      {workspaceInfo.commitSha ?? '—'}
                    </span>
                    {workspaceInfo.dirty && (
                      <span className="px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">dirty</span>
                    )}
                  </>
                ) : (
                  <span className="text-gray-400">Not a git repo</span>
                )}
                {workspaceInfo.version && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                    v{workspaceInfo.version}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Build actions */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Build commands</p>
            <div className="flex flex-wrap gap-2">
              {DESKTOP_COMMANDS.map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => activeBuildId ? onCancelBuild() : onRunBuildCommand(cmd)}
                  disabled={(!!activeBuildId && activeBuildCommand !== cmd) || (cmd === 'package' && desktopPackagingBlocked)}
                  title={cmd === 'package' && desktopPackagingBlocked ? 'Package from an external terminal after closing this dev app.' : undefined}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 ${
                    activeBuildCommand === cmd
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {activeBuildCommand === cmd ? `Cancel ${cmd}` : cmd}
                </button>
              ))}
            </div>
            {desktopPackagingBlocked && (
              <p className="text-[11px] text-yellow-700 dark:text-yellow-300">
                Packaging is disabled while Nexy is running from this dev checkout. Close the dev app and run npm run package from an external terminal to avoid Windows locking native modules.
              </p>
            )}
            {lastBuildStatus && !activeBuildId && (
              <p className={`text-xs ${lastBuildStatus === 'success' ? 'text-green-600 dark:text-green-400' : lastBuildStatus === 'cancelled' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                {lastBuildStatus === 'success' ? '✓ Completed successfully' : lastBuildStatus === 'cancelled' ? '⊘ Cancelled' : '✗ Failed'}
              </p>
            )}
            <div className={`rounded-lg border px-3 py-2 text-xs ${
              latestDesktopBuild?.status === 'success'
                ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200'
                : latestDesktopBuild?.status === 'failed'
                  ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200'
                  : latestDesktopBuild?.status === 'cancelled'
                    ? 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-900/20 dark:text-yellow-200'
                    : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-300'
            }`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{latestDesktopOutcome.title}</span>
                {latestDesktopBuild?.finishedAt && (
                  <span className="text-[10px] opacity-70">
                    {Math.round((latestDesktopBuild.finishedAt - latestDesktopBuild.startedAt) / 1000)}s
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] opacity-85">{latestDesktopOutcome.detail}</span>
                {latestDesktopOutcome.action && !activeBuildId && (
                  <button
                    type="button"
                    onClick={() => onRunBuildCommand(latestDesktopOutcome.action as BuildCommandName)}
                    className="rounded border border-current/25 px-2 py-0.5 text-[11px] font-medium hover:bg-white/40 dark:hover:bg-white/10"
                  >
                    Run {latestDesktopOutcome.action}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Live log */}
          {buildLogLines.length > 0 && (
            <BuildLog
              lines={buildLogLines}
              running={activeBuildId !== null}
              finished={activeBuildId === null && lastBuildStatus !== null}
              resizable
            />
          )}

          {/* Build history */}
          {buildRecords.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-500">Recent builds</p>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {buildRecords.map((rec) => {
                  const isExpanded = expandedDesktopHistoryId === rec.id
                  const logLines = rec.logTail ? rec.logTail.split('\n') : []
                  return (
                    <div key={rec.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedDesktopHistoryId(isExpanded ? null : rec.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
                      >
                        <span className={`font-mono w-16 shrink-0 ${rec.status === 'success' ? 'text-green-600 dark:text-green-400' : rec.status === 'running' ? 'text-blue-500' : rec.status === 'cancelled' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500'}`}>
                          {rec.status}
                        </span>
                        <span className="font-mono text-gray-700 dark:text-gray-300 w-20 shrink-0">{rec.command}</span>
                        <span className="text-gray-400 font-mono truncate">{rec.branch ?? '—'}</span>
                        <span className="text-gray-400 ml-auto shrink-0">{new Date(rec.startedAt).toLocaleString()}</span>
                        {rec.finishedAt && (
                          <span className="text-gray-400 shrink-0">{Math.round((rec.finishedAt - rec.startedAt) / 1000)}s</span>
                        )}
                        {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-700">
                          {logLines.length > 0 && (
                            <BuildLog lines={logLines} resizable={false} maxHeightPx={480} />
                          )}
                          <Button
                            variant="secondary"
                            onClick={() => onRunBuildCommand(rec.command as BuildCommandName)}
                            disabled={!!activeBuildId}
                            className="px-2 py-1 text-[11px]"
                          >
                            Re-run {rec.command}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Preflight */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Preflight checks</p>
              <Button
                variant="secondary"
                onClick={onRunPreflight}
                disabled={preflightRunning}
                className="border-0 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                {preflightRunning ? 'Running...' : 'Run checks'}
              </Button>
            </div>
            {preflightChecks && (
              <div className="space-y-1.5">
                {preflightChecks.map((check) => (
                  <div key={check.label} className="flex items-start gap-2 text-xs">
                    {check.status === 'ok' && <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-px" />}
                    {check.status === 'warn' && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-px" />}
                    {check.status === 'fail' && <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-px" />}
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{check.label}</span>
                      <span className="text-gray-400 ml-1.5">{check.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Local update feed */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <Rss className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">Local update feed</p>
                <p className="text-[11px] text-gray-500">
                  Serves installers to this app and the Android companion. "Check for updates" points here while the feed is live.
                </p>
              </div>
              {feedInfo && <FeedStatusPill running={feedInfo.running} url={feedInfo.feedUrl} />}
            </div>

            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={feedPathInput}
                  onChange={(e) => onSetFeedPathInput(e.target.value)}
                  placeholder="C:\nexy-feed"
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  variant="secondary"
                  onClick={() => void browseForDirectory((p) => onSaveFeedPath(p))}
                  className="rounded-lg"
                >
                  Browse…
                </Button>
                <Button
                  variant="primary"
                  onClick={() => onSaveFeedPath()}
                  className="rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-900 dark:hover:bg-gray-100"
                >
                  Set
                </Button>
              </div>
              {activeFeedPathWarning && <PathWarning text={activeFeedPathWarning} />}

              {feedInfo?.feedPath && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={onPublishUpdate}
                    disabled={publishing || !canPublishDesktopPackage}
                    className="rounded-lg inline-flex items-center gap-1.5"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    {publishing ? 'Publishing…' : 'Publish latest build'}
                  </Button>
                  {!canPublishDesktopPackage && (
                    <p className="text-[11px] text-gray-400">Run package successfully first — the newest installer in release/ is what gets published.</p>
                  )}
                </div>
              )}
              {publishResult && <PublishResultLine result={publishResult} />}

              {/* Version shelf */}
              {publishedEntries.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    <History className="w-3 h-3" /> Published versions
                  </p>
                  <div className="max-h-[160px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                    {publishedEntries.map((entry) => (
                      <div
                        key={`${entry.version}-${String(entry.isBackup)}`}
                        className={`flex items-center gap-2 px-3 py-2 text-[11px] ${entry.isBackup ? '' : 'bg-green-50/60 dark:bg-green-900/10'}`}
                      >
                        <span className={`font-mono font-medium ${entry.isBackup ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
                          v{entry.version}
                        </span>
                        {entry.isBackup ? (
                          <span className="text-[9px] text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-400 px-1.5 py-0.5 rounded-full">backup</span>
                        ) : (
                          <span className="text-[9px] text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300 px-1.5 py-0.5 rounded-full">current</span>
                        )}
                        {formatBytes(entry.installerSize) && (
                          <span className="text-[10px] text-gray-400">{formatBytes(entry.installerSize)}</span>
                        )}
                        <span className="text-gray-400 ml-auto text-[10px]">{new Date(entry.publishedAt).toLocaleDateString()}</span>
                        {entry.isBackup && (
                          <Button
                            variant="secondary"
                            onClick={() => onRollback(entry.version)}
                            className="px-2 py-0.5 text-[10px]"
                          >
                            Reinstall
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Launch dev build */}
          {canLaunchDevBuild && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Launch dev build</p>
              <p className="text-xs text-gray-500">Open the built desktop app as a separate Electron process for smoke testing before packaging.</p>
              <Button
                variant="primary"
                onClick={onLaunchDev}
                className="rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-900 dark:hover:bg-gray-100"
              >
                Launch
              </Button>
              {launchDevError && <p className="text-xs text-red-500">{launchDevError}</p>}
            </div>
          )}
        </div>
      )}

      {/* ================================================================
          ANDROID TAB
      ================================================================ */}
      {developerTab === 'android' && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Android Build</p>

          {/* Android workspace */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={androidWorkspacePathInput}
                onChange={(e) => onSetAndroidWorkspacePathInput(e.target.value)}
                placeholder="/path/to/nexy/android"
                className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono"
              />
              <Button variant="secondary" onClick={() => void browseForDirectory((p) => onSaveAndroidWorkspacePath(p))} className="px-2.5 py-1.5 rounded-lg">Browse…</Button>
              <Button variant="secondary" onClick={() => onSaveAndroidWorkspacePath()} className="px-2.5 py-1.5 rounded-lg">Save</Button>
              <button onClick={onRefreshAndroidWorkspace} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><RefreshCw className="w-3.5 h-3.5" /></button>
            </div>
            {androidWorkspaceInfo && androidWorkspaceInfo.path.trim() !== '' && !androidWorkspaceInfo.hasGradleProject && (
              <PathWarning text="No Gradle wrapper found here — point this at the android/ folder inside the Nexy checkout." />
            )}
            {androidWorkspaceInfo && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mr-0.5">Source</span>
                  {androidWorkspaceInfo.branch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono">{androidWorkspaceInfo.branch}</span>}
                  {androidWorkspaceInfo.commitSha && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">{androidWorkspaceInfo.commitSha}</span>}
                  {androidWorkspaceInfo.dirty && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">dirty</span>}
                </div>
                {(androidWorkspaceInfo.versionCode != null || androidWorkspaceInfo.versionName) && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-400 uppercase tracking-wide mr-0.5">Git baseline</span>
                    {androidWorkspaceInfo.versionName && <span className="font-mono">v{androidWorkspaceInfo.versionName}</span>}
                    {androidWorkspaceInfo.versionCode != null && <span>build {androidWorkspaceInfo.versionCode}</span>}
                    <span>· release builds reserve a newer build number</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Android build commands */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {(['test', 'assembleDebug', 'assembleRelease', 'bundleRelease'] as AndroidBuildCommandName[]).map((cmd) => (
                <Button
                  key={cmd}
                  variant="secondary"
                  onClick={() => onAndroidStartCommand(cmd)}
                  disabled={activeAndroidBuildId !== null}
                  className="px-2.5 py-1 rounded font-mono"
                >
                  {cmd}
                </Button>
              ))}
              {activeAndroidBuildId && (
                <Button
                  variant="danger"
                  onClick={onAndroidCancelCommand}
                  className="px-2.5 py-1 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/40"
                >
                  Cancel {activeAndroidCommand}
                </Button>
              )}
            </div>
            {androidLastBuildStatus && !activeAndroidBuildId && (
              <p className={`text-xs ${androidLastBuildStatus === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {androidLastBuildStatus === 'success' ? '✓ Build succeeded' : `✗ Build ${androidLastBuildStatus}`}
              </p>
            )}
          </div>

          {/* Android live log */}
          {androidLogLines.length > 0 && (
            <BuildLog
              lines={androidLogLines}
              running={activeAndroidBuildId !== null}
              finished={activeAndroidBuildId === null && androidLastBuildStatus !== null}
              resizable
            />
          )}

          {/* Android build history */}
          {androidBuildRecords.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Recent builds</p>
              <div className="rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {androidBuildRecords.slice(0, 5).map((r) => {
                  const isExpanded = expandedAndroidHistoryId === r.id
                  const logLines = r.logTail ? r.logTail.split('\n') : []
                  return (
                    <div key={r.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedAndroidHistoryId(isExpanded ? null : r.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'success' ? 'bg-green-500' : r.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-red-400'}`} />
                        <span className="font-mono text-gray-600 dark:text-gray-300 w-32 truncate">{r.command}</span>
                        <span className="text-gray-400">{r.branch ?? '—'}</span>
                        {r.versionCode != null && <span className="text-gray-400">build {r.versionCode}</span>}
                        <span className="text-gray-400 ml-auto">{new Date(r.startedAt).toLocaleString()}</span>
                        <span className="text-gray-400">{r.finishedAt ? `${Math.round((r.finishedAt - r.startedAt) / 1000)}s` : '…'}</span>
                        {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-700">
                          {r.artifactPaths.length > 0 && (
                            <div className="text-[10px] text-gray-400 font-mono space-y-0.5">
                              {r.artifactPaths.map((artifactPath) => {
                                const checksum = r.artifactChecksums[artifactPath]
                                return (
                                  <p key={artifactPath} className="truncate">
                                    {checksum ? `${artifactPath} · sha256 ${checksum.slice(0, 12)}` : artifactPath}
                                  </p>
                                )
                              })}
                            </div>
                          )}
                          {logLines.length > 0 && (
                            <BuildLog lines={logLines} resizable={false} maxHeightPx={480} />
                          )}
                          <Button
                            variant="secondary"
                            onClick={() => onAndroidStartCommand(r.command as AndroidBuildCommandName)}
                            disabled={activeAndroidBuildId !== null}
                            className="px-2 py-1 text-[11px]"
                          >
                            Re-run {r.command}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Signing config */}
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-3">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Signing</p>
              {signingDraft.keystorePath ? (
                <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                  <CheckCircle className="w-3 h-3" /> {signingDraft.generated ? 'Auto-generated' : 'Configured'}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-gray-400">
                  <XCircle className="w-3 h-3" /> Not configured
                </span>
              )}
            </div>
            <Button
              variant="secondary"
              onClick={() => setSigningModalOpen(true)}
              className="px-2.5 py-1 rounded"
            >
              Use existing key…
            </Button>
          </div>
          {!signingDraft.keystorePath && (
            <p className="-mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              No setup is required for your first release. Run <span className="font-mono">assembleRelease</span> and Nexy will create and save a release key automatically. Use an existing key only to continue updating an app signed elsewhere.
            </p>
          )}

          {signingModalOpen && (
            <AndroidSigningModal
              signingDraft={signingDraft}
              signingValidation={signingValidation}
              onSetSigningDraft={onSetSigningDraft}
              onSaveSigningConfig={onSaveSigningConfig}
              onValidateSigningConfig={onValidateSigningConfig}
              onClose={() => setSigningModalOpen(false)}
            />
          )}

          {/* ADB Install */}
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">ADB Install</p>
              <button
                type="button"
                onClick={onRefreshAdbDevices}
                disabled={adbRefreshing}
                className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:cursor-wait disabled:opacity-60 flex items-center gap-1"
                aria-label={adbRefreshing ? 'Searching for ADB devices' : 'Refresh ADB devices'}
              >
                <RefreshCw className={`w-3 h-3 ${adbRefreshing ? 'animate-spin' : ''}`} />
                {adbRefreshing ? 'Searching…' : 'Refresh'}
              </button>
            </div>
            {latestAdbInstallRecord && latestAdbInstallApk ? (
              <p className="text-[11px] text-gray-500">
                Ready to install {latestAdbInstallRecord.command} artifact: <span className="font-mono">{latestAdbInstallApk.split(/[\\/]/).pop()}</span>
              </p>
            ) : (
              <p className="text-[11px] text-gray-400">Run assembleDebug or assembleRelease successfully before installing over ADB.</p>
            )}
            {adbDevices.length === 0 ? (
              <p className="text-[11px] text-gray-400">No devices connected. Connect via USB and enable USB debugging.</p>
            ) : (
              <div className="space-y-1">
                {adbDevices.map((d) => (
                  <div key={d.serial} className="rounded-md">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.state === 'device' ? 'bg-green-500' : d.state === 'unauthorized' ? 'bg-amber-500' : 'bg-gray-400'}`} />
                      <span className="font-mono text-gray-600 dark:text-gray-300">{d.model ?? d.serial}</span>
                      <span className="text-gray-400 text-[10px]">{d.state}</span>
                      <Button
                        variant="secondary"
                        onClick={() => onAndroidInstallApk(d.serial)}
                        disabled={adbInstalling || d.state !== 'device' || !latestAdbInstallApk}
                        className="ml-auto px-2 py-0.5 text-[10px]"
                      >
                        Install APK
                      </Button>
                    </div>
                    {d.state === 'unauthorized' && (
                      <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                        Unlock this phone and accept the “Allow USB debugging?” prompt. If it does not appear, revoke USB debugging authorizations in Android Developer options, reconnect the cable, then refresh here.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Distribution options */}
          <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700 mt-3">
            <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wide select-none">
              Distribution Options
            </summary>
            <div className="px-3 pb-3 space-y-3 text-[11px] text-gray-600 dark:text-gray-400">
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-0.5">LAN Feed (default)</p>
                <p>Run <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">assembleRelease</code>, then click Publish below. The Android app's Settings → Updates section detects the new version automatically when on the same network.</p>
              </div>
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Play Internal App Sharing</p>
                <p>Run <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">bundleRelease</code> to produce an <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">.aab</code> artifact. In the Google Play Console, open your app → Internal App Sharing → Upload bundle. Share the generated link with testers — no store review required.</p>
              </div>
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Private APK Distribution</p>
                <p>Share the signed <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">assembleRelease</code> APK directly (email, cloud storage, etc.) or host it on any HTTPS server. For OTA delivery through the companion app, serve the APK at a stable URL and publish a matching <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">android-update.json</code> manifest with the same schema.</p>
              </div>
            </div>
          </details>

          {/* Android update feed */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <Smartphone className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">Android update feed</p>
                <p className="text-[11px] text-gray-500">Publish the signed release APK so the phone's Settings → Updates screen can install it over LAN.</p>
              </div>
            </div>
            <div className="p-3 space-y-2.5">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-[11px]">
                <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 px-3 py-2.5 bg-white dark:bg-gray-900">
                  <span className="text-gray-500">Latest assembled APK</span>
                  {latestSuccessfulAndroidRelease ? (
                    <span className="flex flex-wrap items-center gap-1.5 text-gray-700 dark:text-gray-200">
                      <strong>v{latestSuccessfulAndroidRelease.version ?? 'Unknown'}</strong>
                      <span>build {latestSuccessfulAndroidRelease.versionCode ?? 'Unknown'}</span>
                      <span className="font-mono text-gray-400">id {latestSuccessfulAndroidRelease.id.slice(0, 12)}</span>
                    </span>
                  ) : (
                    <span className="text-gray-400">No successful assembleRelease build</span>
                  )}

                  <span className="text-gray-500">Currently on feed</span>
                  {androidUpdateManifest ? (
                    <span className="flex flex-wrap items-center gap-1.5 text-gray-700 dark:text-gray-200">
                      <strong>v{androidUpdateManifest.versionName}</strong>
                      <span>build {androidUpdateManifest.versionCode}</span>
                      <span className="font-mono text-gray-400">
                        {androidUpdateManifest.buildId ? `id ${androidUpdateManifest.buildId.slice(0, 12)}` : 'legacy manifest'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-400">Nothing published</span>
                  )}
                </div>
                <div className={`px-3 py-2 border-t text-[10px] font-medium ${
                  androidReleaseFeedState === 'match'
                    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300'
                    : androidReleaseFeedState === 'mismatch'
                      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                }`}>
                  {androidReleaseFeedState === 'match' && '✓ Feed exactly matches the latest assembled release'}
                  {androidReleaseFeedState === 'legacy-match' && 'Build number matches, but this older feed entry has no build ID to verify exactly'}
                  {androidReleaseFeedState === 'mismatch' && '✗ Feed does not match the latest assembled release — publish before installing'}
                  {androidReleaseFeedState === 'not-published' && 'Latest release has not been published'}
                  {androidReleaseFeedState === 'no-release' && 'Run assembleRelease to create a publishable APK'}
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={onAndroidPublishUpdate}
                className="rounded-lg inline-flex items-center gap-1.5"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Publish release APK to feed
              </Button>
              {androidPublishResult && <PublishResultLine result={androidPublishResult} />}
              {androidUpdateManifest && (
                <div className="rounded-lg border border-green-200 dark:border-green-900/50 bg-green-50/60 dark:bg-green-900/10 px-3 py-2 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">Current release on feed</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium">v{androidUpdateManifest.versionName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">build {androidUpdateManifest.versionCode}</span>
                    {androidUpdateManifest.buildId && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-mono">id {androidUpdateManifest.buildId.slice(0, 12)}</span>}
                    {androidUpdateManifest.commitSha && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-mono">{androidUpdateManifest.commitSha}</span>}
                    <span className="text-[10px] text-gray-500 ml-auto">{new Date(androidUpdateManifest.publishedAt).toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Android version shelf */}
              {androidPublishHistory.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    <History className="w-3 h-3" /> Published history
                  </p>
                  <div className="max-h-[160px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                    {androidPublishHistory.map((entry) => (
                      <div key={entry.versionCode} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                        <div className="flex flex-wrap gap-1.5 items-center min-w-0 flex-1">
                          <span className="font-mono font-medium text-gray-700 dark:text-gray-300">v{entry.versionName}</span>
                          <span className="text-[9px] text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-400 px-1.5 py-0.5 rounded-full">build {entry.versionCode}</span>
                          <span className="text-gray-400 text-[10px]">{new Date(entry.publishedAt).toLocaleDateString()}</span>
                          {entry.commitSha && <span className="font-mono text-gray-400 text-[9px]">{entry.commitSha}</span>}
                        </div>
                        <Button
                          variant="secondary"
                          onClick={() => onAndroidRestoreVersion(entry.versionCode)}
                          disabled={androidRestoring === entry.versionCode}
                          className="shrink-0 px-2 py-0.5 text-[10px]"
                        >
                          {androidRestoring === entry.versionCode ? 'Restoring…' : 'Restore'}
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400">To move back to an older version on the phone, uninstall the current app first, then restore here and tap Install update on the phone.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          CONSOLE TAB
      ================================================================ */}
      {developerTab === 'console' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Debug logging</p>
              <p className="text-xs text-gray-500 mt-0.5">Enable verbose developer diagnostics in terminal, log file, and console panel.</p>
            </div>
            <button
              onClick={onToggleDebugLogging}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${debugLogging ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
              aria-pressed={debugLogging}
              aria-label="Toggle debug logging"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${debugLogging ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Console</p>
                <p className="text-[11px] text-gray-500">Recent app diagnostics captured inside Nexy.</p>
              </div>
              <div className="flex items-center gap-1.5">
                {(['all', 'error', 'warn', 'info', 'debug'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setConsoleLevel(level)}
                    className={`text-[11px] px-2 py-1 rounded-md capitalize ${
                      consoleLevel === level
                        ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                        : 'bg-white dark:bg-gray-900 text-gray-500 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {level}
                  </button>
                ))}
                <Button
                  variant="secondary"
                  onClick={() => void handleCopyConsole()}
                  disabled={filteredConsoleEntries.length === 0}
                  className="px-2 py-1 rounded-md text-[11px]"
                >
                  Copy
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleClearConsole()}
                  disabled={consoleEntries.length === 0}
                  className="px-2 py-1 rounded-md text-[11px]"
                >
                  Clear
                </Button>
              </div>
            </div>
            <div className="max-h-[480px] overflow-y-auto bg-white dark:bg-gray-900">
              {filteredConsoleEntries.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-400">
                  {consoleEntries.length === 0 ? 'No diagnostics captured.' : 'No entries match this filter.'}
                </p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredConsoleEntries.map((entry) => (
                    <details
                      key={entry.id}
                      id={`error-log-${entry.id}`}
                      open={entry.id === initialErrorLogId || undefined}
                      className={`group ${entry.id === initialErrorLogId ? 'bg-amber-50 ring-2 ring-inset ring-amber-400 dark:bg-amber-950/30 dark:ring-amber-600' : ''}`}
                    >
                      <summary className="flex cursor-pointer items-start gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60">
                        <span className="shrink-0 font-mono text-[11px] text-gray-400">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                          entry.level === 'error'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                            : entry.level === 'warn'
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                        }`}>
                          {entry.level}
                        </span>
                        <span className="shrink-0 text-[11px] text-gray-400">{entry.source}</span>
                        <span className="min-w-0 flex-1 break-words text-gray-700 dark:text-gray-300">{entry.message}</span>
                      </summary>
                      {entry.stack && (
                        <pre className="mx-3 mb-2 overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                          {entry.stack}
                        </pre>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </div>
            {consoleStatus && (
              <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400 dark:border-gray-800">
                {consoleStatus}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
