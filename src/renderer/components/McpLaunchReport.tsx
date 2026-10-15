import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Circle, Copy, Download, FileText, Loader2, MinusCircle, RefreshCw, Settings, Wrench, XCircle } from 'lucide-react'
import type { McpLaunchAction, McpLaunchStage, McpTestResult } from '@shared/types'

export interface McpLaunchReportHandlers {
  onRetry?: () => void
  onRepairSandbox?: () => void
  onDownloadBrowser?: () => void
  onEditSetup?: () => void
  onViewLog?: (errorLogId: string) => void
}

interface McpLaunchReportProps extends McpLaunchReportHandlers {
  result: McpTestResult
  /** Disables actions while a retry, repair, or download is running. */
  busy?: boolean
  busyAction?: McpLaunchAction
}

const ACTION_LABELS: Record<McpLaunchAction, string> = {
  retry: 'Retry',
  'repair-sandbox': 'Repair sandbox',
  'download-browser': 'Download Chromium',
  'edit-setup': 'Edit setup',
}

const ACTION_ICONS: Record<McpLaunchAction, typeof RefreshCw> = {
  retry: RefreshCw,
  'repair-sandbox': Wrench,
  'download-browser': Download,
  'edit-setup': Settings,
}

function StageIcon({ state }: { state: McpLaunchStage['state'] }) {
  if (state === 'passed') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
  if (state === 'failed') return <XCircle className="h-3.5 w-3.5 shrink-0 text-nexy-error" aria-hidden />
  if (state === 'skipped') return <MinusCircle className="h-3.5 w-3.5 shrink-0 text-nexy-muted" aria-hidden />
  return <Circle className="h-3.5 w-3.5 shrink-0 text-nexy-muted opacity-50" aria-hidden />
}

const STAGE_STATE_LABEL: Record<McpLaunchStage['state'], string> = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  'not-run': 'not reached',
}

/**
 * Explains an MCP server start attempt: a plain-language summary, the start-up
 * checklist, the actions that can fix it, and the captured error output.
 */
export function McpLaunchReport({ result, busy, busyAction, onRetry, onRepairSandbox, onDownloadBrowser, onEditSetup, onViewLog }: McpLaunchReportProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const failure = result.failure
  const handlers: Record<McpLaunchAction, (() => void) | undefined> = {
    retry: onRetry,
    'repair-sandbox': onRepairSandbox,
    'download-browser': onDownloadBrowser,
    'edit-setup': onEditSetup,
  }
  const actions = (failure?.actions ?? []).filter((action) => handlers[action])
  const hasDetails = Boolean(result.stderr || (!result.ok && result.error))
  const technicalText = [result.error && `Error: ${result.error}`, result.stderr].filter(Boolean).join('\n\n')

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(technicalText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied; the text remains selectable.
    }
  }

  return (
    <div
      className={`space-y-2 rounded-lg border px-3 py-2 text-xs ${result.ok ? 'border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-900/20' : 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-900/20'}`}
      role="status"
      aria-live="polite"
    >
      {result.ok ? (
        <div className="flex items-start gap-2 text-green-700 dark:text-green-400">
          <CheckCircle2 className="mt-px h-4 w-4 shrink-0" />
          <span>Connected — found {result.tools?.length ?? 0} tool{result.tools?.length === 1 ? '' : 's'}.</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-red-700 dark:text-red-300">
          <AlertCircle className="mt-px h-4 w-4 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-bold">{failure?.title ?? 'Connection failed'}</p>
            <p className="break-words text-red-700/90 dark:text-red-300/90">{failure?.explanation ?? result.error ?? 'The server did not complete its MCP handshake.'}</p>
          </div>
        </div>
      )}

      {result.stages && result.stages.length > 0 && (
        <ol className="space-y-1 border-t border-black/5 pt-2 dark:border-white/10" aria-label="Start-up checklist">
          {result.stages.map((stage) => (
            <li key={stage.id} className="flex items-start gap-2" aria-label={`${stage.label}: ${STAGE_STATE_LABEL[stage.state]}`}>
              <span className="mt-px"><StageIcon state={stage.state} /></span>
              <span className={`min-w-0 ${stage.state === 'not-run' ? 'text-nexy-muted' : 'text-nexy-text'}`}>
                {stage.label}
                {stage.detail && <span className="text-nexy-muted"> — {stage.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {(actions.length > 0 || (result.errorLogId && onViewLog)) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {actions.map((action) => {
            const Icon = ACTION_ICONS[action]
            const running = busy && busyAction === action
            return (
              <button
                key={action}
                type="button"
                onClick={handlers[action]}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-nexy-sm border border-nexy-border bg-nexy-raised px-2 py-1 text-[11px] font-bold text-nexy-text hover:bg-nexy-recessed disabled:cursor-wait disabled:opacity-50"
              >
                {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                {ACTION_LABELS[action]}
              </button>
            )
          })}
          {result.errorLogId && onViewLog && (
            <button
              type="button"
              onClick={() => onViewLog(result.errorLogId!)}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-nexy-accent hover:underline"
            >
              <FileText className="h-3 w-3" /> View logs
            </button>
          )}
        </div>
      )}

      {hasDetails && (
        <div className="border-t border-black/5 pt-1 dark:border-white/10">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex items-center gap-1 text-[11px] font-bold text-nexy-muted hover:text-nexy-text"
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Technical details
          </button>
          {detailsOpen && (
            <div className="mt-1 space-y-1">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-nexy-recessed p-2 font-mono text-[10px] text-nexy-text">{technicalText}</pre>
              <button type="button" onClick={() => void copyDetails()} className="inline-flex items-center gap-1 text-[10px] font-bold text-nexy-muted hover:text-nexy-text">
                <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy details'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
