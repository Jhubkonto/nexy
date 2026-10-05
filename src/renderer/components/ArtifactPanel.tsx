import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Download, FolderDown, Trash2, Package, History, Info, FolderOpen, Settings, GitCompare } from 'lucide-react'
import type { ArtifactRow, ArtifactVersion } from '../../shared/types'
import { useAppStore } from '../store/app-store'
import { ResizeHandle } from './ResizeHandle'
import { DeleteArtifactDialog } from './DeleteArtifactDialog'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ArtifactKindBadge, artifactDisplayTitle } from './artifacts/artifactDisplay'
import { Button, ModalShell } from './ui/primitives'

function primaryMarkdownFile(artifact: ArtifactRow) {
  const file = artifact.currentVersion?.files?.find((candidate) => candidate.role === 'primary')
    ?? artifact.currentVersion?.files?.[0]
  if (!file) return null
  const isMarkdown = file.mediaType.toLowerCase() === 'text/markdown' || file.relativePath.toLowerCase().endsWith('.md')
  return isMarkdown ? file : null
}

function MarkdownArtifactTab({ artifact }: { artifact: ArtifactRow }) {
  const [content, setContent] = useState<string | null | undefined>(undefined)
  const file = primaryMarkdownFile(artifact)
  const filePath = file?.relativePath

  useEffect(() => {
    let cancelled = false
    setContent(undefined)
    if (!artifact.currentVersionId || !filePath) {
      setContent(null)
      return () => { cancelled = true }
    }

    window.api.artifactGetFileContent(artifact.currentVersionId, filePath)
      .then((result) => { if (!cancelled) setContent(result.content) })
      .catch(() => { if (!cancelled) setContent(null) })

    return () => { cancelled = true }
  }, [artifact.currentVersionId, filePath])

  return (
    <div className="h-full overflow-y-auto p-5">
      {content === undefined ? (
        <p className="text-xs text-gray-400">Loading Markdown…</p>
      ) : content === null ? (
        <p className="text-xs text-gray-400">Markdown content is unavailable.</p>
      ) : (
        <MarkdownRenderer content={content} />
      )}
    </div>
  )
}

function TestReportArtifactTab({ artifact }: { artifact: ArtifactRow }) {
  const [report, setReport] = useState<Record<string, unknown> | null | undefined>(undefined)
  const file = artifact.currentVersion?.files?.find((candidate) => candidate.relativePath === 'report.json')
  const filePath = file?.relativePath

  useEffect(() => {
    let cancelled = false
    setReport(undefined)
    if (!artifact.currentVersionId || !filePath) {
      setReport(null)
      return () => { cancelled = true }
    }
    window.api.artifactGetFileContent(artifact.currentVersionId, filePath)
      .then((result) => {
        if (cancelled) return
        try { setReport(JSON.parse(result.content) as Record<string, unknown>) } catch { setReport(null) }
      })
      .catch(() => { if (!cancelled) setReport(null) })
    return () => { cancelled = true }
  }, [artifact.currentVersionId, filePath])

  if (report === undefined) return <p className="p-4 text-xs text-gray-400">Loading test report…</p>
  if (!report) return <p className="p-4 text-xs text-gray-400">Test report data is unavailable.</p>
  const status = typeof report.status === 'string' ? report.status : 'unknown'
  const steps = Array.isArray(report.steps) ? report.steps.filter((step): step is Record<string, unknown> => Boolean(step && typeof step === 'object')) : []
  const revision = report.revision && typeof report.revision === 'object' ? report.revision as Record<string, unknown> : null
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${status === 'passed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : status === 'running' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>{status}</span>
        <span className="text-[10px] text-gray-400">{typeof report.mode === 'string' ? report.mode : '—'}</span>
      </div>
      {typeof report.goal === 'string' && <p className="text-xs text-gray-700 dark:text-gray-300">{report.goal}</p>}
      {typeof report.error === 'string' && <pre className="whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{report.error}</pre>}
      {revision && <div className="text-[10px] text-gray-500 dark:text-gray-400"><span className="font-semibold">Revision:</span> {String(revision.commit ?? 'unknown')} · {String(revision.branch ?? 'unknown')}</div>}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Steps</p>
        <div className="space-y-1">
          {steps.length === 0 ? <p className="text-xs text-gray-400">No step results recorded.</p> : steps.map((step, index) => (
            <div key={`${String(step.id ?? index)}-${index}`} className="rounded border border-gray-200 px-2 py-1.5 dark:border-gray-700">
              <div className="flex items-center gap-2 text-[11px]"><span className={step.status === 'passed' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{String(step.status ?? 'unknown').toUpperCase()}</span><span className="font-mono text-gray-600 dark:text-gray-300">{String(step.id ?? `step-${index + 1}`)}</span></div>
              {typeof step.detail === 'string' && <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">{step.detail}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ArtifactStatusBadge({ status }: { status: string }) {
  const colorClass = status === 'ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : status === 'generating' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
    : status === 'failed' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
  return (
    <span className={`inline-block w-16 shrink-0 truncate text-center text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colorClass}`}>
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Details Tab
// ---------------------------------------------------------------------------

function DetailsTab({ artifact, projects, downloading, onDownloadCurrent }: {
  artifact: ArtifactRow
  projects: { id: string; name: string }[]
  downloading: boolean
  onDownloadCurrent: () => void
}) {
  const project = artifact.projectId ? projects.find((p) => p.id === artifact.projectId) : null
  const addToast = useAppStore((s) => s.addToast)
  const [defaultRoot, setDefaultRoot] = useState('')
  const [editingRoot, setEditingRoot] = useState(false)
  const [rootInput, setRootInput] = useState('')

  useEffect(() => {
    window.api.artifactGeneratorGetStorageRoot()
      .then((r) => setDefaultRoot(r.path))
      .catch(() => {})
  }, [])

  const handleSaveRoot = async () => {
    try {
      await window.api.artifactGeneratorSetStorageRoot(rootInput)
      setDefaultRoot(rootInput)
      setEditingRoot(false)
    } catch {
      addToast('Failed to save storage root', 'error')
    }
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-2 flex-wrap">
        <ArtifactKindBadge kind={artifact.kind} />
        <ArtifactStatusBadge status={artifact.status} />
        {artifact.currentVersion && (
          <span className="text-[10px] text-gray-400">v{artifact.currentVersion.versionNumber}</span>
        )}
      </div>

      {artifact.description && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Description</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">{artifact.description}</p>
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Project</p>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {project ? project.name : 'Global (no project)'}
        </p>
      </div>

      {artifact.currentVersion?.files && artifact.currentVersion.files.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
            Files (v{artifact.currentVersion.versionNumber})
          </p>
          <div className="space-y-1">
            {artifact.currentVersion.files.map((f) => (
              <p key={f.id} className="text-[11px] font-mono text-gray-500 dark:text-gray-400 break-all">{f.relativePath}</p>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 flex-wrap">
        {artifact.currentVersionId && (
          <Button variant="secondary" onClick={onDownloadCurrent} disabled={downloading}>
            <FolderDown className="w-3.5 h-3.5" />
            {downloading ? 'Downloading…' : 'Download'}
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Default storage location for new artifacts</p>
          <button
            type="button"
            onClick={() => { setEditingRoot(true); setRootInput(defaultRoot) }}
            className="ml-auto text-[10px] text-blue-500 hover:text-blue-600"
          >
            Change
          </button>
        </div>
        {editingRoot ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              className="flex-1 text-[11px] font-mono px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => void handleSaveRoot()}
              className="text-[10px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingRoot(false)}
              className="text-[10px] px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">{defaultRoot || '—'}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compare versions modal
// ---------------------------------------------------------------------------

function CompareVersionsModal({ newer, older, onClose }: {
  newer: ArtifactVersion
  older: ArtifactVersion
  onClose: () => void
}) {
  const olderPaths = new Set((older.files ?? []).map((f) => f.relativePath))
  const newerPaths = new Set((newer.files ?? []).map((f) => f.relativePath))
  const added = [...newerPaths].filter((p) => !olderPaths.has(p)).sort()
  const removed = [...olderPaths].filter((p) => !newerPaths.has(p)).sort()
  const unchangedCount = [...newerPaths].filter((p) => olderPaths.has(p)).length

  return (
    <ModalShell
      title={`v${older.versionNumber} → v${newer.versionNumber}`}
      maxWidth="max-w-md"
      height=""
      bodyClassName="p-5 space-y-3 max-h-[60vh] overflow-y-auto"
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Compares which files exist in each version, by file path only — it doesn&apos;t check whether a file&apos;s contents changed. Use it to spot files that were added or dropped between versions.
      </p>
      {added.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Added</p>
          {added.map((path) => (
            <p key={path} className="text-[11px] font-mono px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20 text-gray-700 dark:text-gray-300 break-all">+ {path}</p>
          ))}
        </div>
      )}
      {removed.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">Removed</p>
          {removed.map((path) => (
            <p key={path} className="text-[11px] font-mono px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-gray-700 dark:text-gray-300 break-all">- {path}</p>
          ))}
        </div>
      )}
      {added.length === 0 && removed.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{unchangedCount} file(s) unchanged — no structural differences.</p>
      )}
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// History Tab
// ---------------------------------------------------------------------------

function HistoryTab({ artifactId, kind, onVersionDeleted }: { artifactId: string; kind: string; onVersionDeleted: () => void }) {
  const [versions, setVersions] = useState<ArtifactVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [compareVersions, setCompareVersions] = useState<{ newer: ArtifactVersion; older: ArtifactVersion } | null>(null)
  const addToast = useAppStore((s) => s.addToast)

  const loadVersions = useCallback(() => {
    setLoading(true)
    return window.api.artifactListVersions(artifactId)
      .then(setVersions)
      .catch(() => addToast('Failed to load version history', 'error'))
      .finally(() => setLoading(false))
  }, [artifactId, addToast])

  useEffect(() => { void loadVersions() }, [loadVersions])

  const handleExport = async (versionId: string) => {
    setExportingId(versionId)
    setExportedPath(null)
    try {
      const result = await window.api.artifactExport(versionId, 'raw-files')
      setExportedPath(result.exportPath)
    } catch {
      addToast('Export failed', 'error')
    } finally {
      setExportingId(null)
    }
  }

  const handleDeleteVersion = async (versionId: string) => {
    setConfirmDeleteId(null)
    try {
      await window.api.artifactDeleteVersion(versionId)
      await loadVersions()
      onVersionDeleted()
    } catch {
      addToast('Failed to delete version — it may be the artifact\'s only remaining one', 'error')
    }
  }

  if (loading) {
    return <p className="p-4 text-xs text-gray-400">Loading…</p>
  }

  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      <p className="px-1 text-[11px] text-gray-400 dark:text-gray-500">
        Compare shows which files changed by path between two versions, not their content. Each version can be exported or deleted individually.
      </p>
      {versions.length === 0 ? (
        <p className="text-xs text-gray-400 italic px-1">No version history yet</p>
      ) : (
        <div className="space-y-1">
          {versions.map((v, index) => {
            const olderVersion = versions[index + 1]
            return (
              <div
                key={v.id}
                className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2 py-1.5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                    v{v.versionNumber} · {artifactDisplayTitle(v.title, kind)}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                    {v.files?.length ?? 0} file{(v.files?.length ?? 0) !== 1 ? 's' : ''} · {new Date(v.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {confirmDeleteId === v.id ? (
                  <div className="flex items-center gap-1 text-[11px] shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleDeleteVersion(v.id)}
                      className="px-2 py-0.5 rounded-md bg-red-600 text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5 shrink-0">
                    {olderVersion && (
                      <button
                        type="button"
                        onClick={() => setCompareVersions({ newer: v, older: olderVersion })}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                        aria-label={`Compare v${v.versionNumber} with v${olderVersion.versionNumber}`}
                        title="Compare with previous version"
                      >
                        <GitCompare className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleExport(v.id)}
                      disabled={exportingId === v.id}
                      className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                      aria-label={`Export version ${v.versionNumber}`}
                      title="Export"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(v.id)}
                      disabled={versions.length <= 1}
                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                      aria-label={`Delete version ${v.versionNumber}`}
                      title={versions.length <= 1 ? "Can't delete an artifact's only version" : 'Delete'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {exportedPath && (
        <div className="flex items-center gap-2 px-1">
          <p className="text-[10px] font-mono text-gray-500 truncate flex-1">Exported to: {exportedPath}</p>
          <button
            type="button"
            onClick={() => void window.api.artifactOpenFolder(exportedPath)}
            className="text-[10px] text-blue-500 hover:text-blue-600 shrink-0 flex items-center gap-1"
          >
            <FolderOpen className="w-3 h-3" />
            Open
          </button>
        </div>
      )}
      {compareVersions && (
        <CompareVersionsModal
          newer={compareVersions.newer}
          older={compareVersions.older}
          onClose={() => setCompareVersions(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ArtifactPanel
// ---------------------------------------------------------------------------

const PANEL_MIN = 320
const PANEL_MAX = 700

export function ArtifactPanel({ artifactId }: { artifactId: string }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeArtifactPanel = useAppStore((s) => s.closeArtifactPanel)
  const requestArtifactAttach = useAppStore((s) => s.requestArtifactAttach)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const projects = useAppStore((s) => s.projects)
  const addToast = useAppStore((s) => s.addToast)
  const setSectionPane = useAppStore((s) => s.setSectionPane)

  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'markdown' | 'details' | 'history'>('details')
  const [width, setWidth] = useState(440)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [downloadingCurrent, setDownloadingCurrent] = useState(false)

  const getMaxSize = useCallback(() => Math.min(PANEL_MAX, Math.floor(window.innerWidth * 0.45)), [])

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(PANEL_MIN, Math.min(getMaxSize(), size)))
  }, [getMaxSize])

  useEffect(() => {
    setLoading(true)
    window.api.artifactGet(artifactId)
      .then((a) => {
        setArtifact(a)
        setTab(a && (a.kind === 'plan' || a.kind === 'test-report') && primaryMarkdownFile(a) ? 'markdown' : 'details')
      })
      .catch(() => addToast('Failed to load artifact', 'error'))
      .finally(() => setLoading(false))
  }, [artifactId, addToast])

  const handleDelete = async () => {
    if (!artifact) return
    try {
      await window.api.artifactDelete(artifact.id)
      closeArtifactPanel()
    } catch {
      addToast('Failed to delete artifact', 'error')
    }
  }

  const handleDownloadCurrent = async () => {
    if (!artifact?.currentVersionId) return
    setDownloadingCurrent(true)
    try {
      const result = await window.api.artifactDownload(artifact.currentVersionId, 'raw-files')
      if (!result.canceled && result.downloadPath) {
        addToast(`Downloaded to: ${result.downloadPath}`, 'success')
      }
    } catch {
      addToast('Download failed', 'error')
    } finally {
      setDownloadingCurrent(false)
    }
  }

  const handleUseInChat = () => {
    if (!artifact) return
    requestArtifactAttach(artifact.id, artifact.currentVersionId ?? undefined)
    setSectionPane('artifacts')
    addToast('Artifact attached to conversation', 'success')
  }

  return (
    <div className="fixed inset-0 top-9 z-50 flex" role="dialog" aria-modal="true" aria-label="Artifact details panel">
      <div className="flex-1 bg-black/30" onClick={closeArtifactPanel} aria-hidden="true" />
      <div
        ref={panelRef}
        style={{ width }}
        className="relative flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl"
      >
      <ResizeHandle
        direction="horizontal"
        containerRef={panelRef as React.RefObject<HTMLElement>}
        onSetSize={handleSetSize}
        align="start"
        minSize={PANEL_MIN}
        maxSize={getMaxSize}
      />

      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center justify-between px-4 h-9">
          <div className="flex items-center gap-2 min-w-0">
            <Package className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
              {loading ? 'Loading…' : (artifact ? artifactDisplayTitle(artifact.title, artifact.kind) : 'Artifact')}
            </h2>
          </div>
          <button
            onClick={closeArtifactPanel}
            className="p-0.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            aria-label="Close artifact panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {artifact?.storageRoot && (
          <p
            className="px-4 pb-2 -mt-1 text-[10px] font-mono text-gray-400 dark:text-gray-500 truncate"
            title={artifact.storageRoot}
          >
            {artifact.storageRoot}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-gray-200 dark:border-gray-700 shrink-0 px-4">
        {(artifact?.kind === 'plan' || artifact?.kind === 'test-report') && primaryMarkdownFile(artifact) && (
          <button
            onClick={() => setTab('markdown')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === 'markdown'
                ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {artifact.kind === 'test-report' ? 'Report' : 'Markdown'}
          </button>
        )}
        {([
          { id: 'details', label: 'Details', Icon: Info },
          { id: 'history', label: 'History', Icon: History },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === id
                ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <p className="p-4 text-xs text-gray-400">Loading artifact…</p>
        ) : artifact ? (
          <>
            {tab === 'markdown' && artifact.kind === 'plan' && <MarkdownArtifactTab artifact={artifact} />}
            {tab === 'markdown' && artifact.kind === 'test-report' && <TestReportArtifactTab artifact={artifact} />}
            {tab === 'details' && (
              <DetailsTab
                artifact={artifact}
                projects={projects}
                downloading={downloadingCurrent}
                onDownloadCurrent={() => void handleDownloadCurrent()}
              />
            )}
            {tab === 'history' && (
              <HistoryTab
                artifactId={artifact.id}
                kind={artifact.kind}
                onVersionDeleted={() => window.api.artifactGet(artifactId).then((a) => setArtifact(a)).catch(() => {})}
              />
            )}
          </>
        ) : (
          <p className="p-4 text-xs text-gray-400">Artifact not found</p>
        )}
      </div>

      {/* Footer */}
      {artifact && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          {confirmDelete && (
            <DeleteArtifactDialog
              artifactTitle={artifactDisplayTitle(artifact.title, artifact.kind)}
              onConfirm={() => { setConfirmDelete(false); void handleDelete() }}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
          {currentConversationId && (
            <button
              onClick={handleUseInChat}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              Use in Chat
            </button>
          )}
        </div>
      )}

      </div>
    </div>
  )
}
