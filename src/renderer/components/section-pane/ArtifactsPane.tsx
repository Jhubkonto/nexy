import { useDeferredValue, useEffect, useMemo, useState, useCallback } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import type { ArtifactRow } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { DeleteArtifactDialog } from '../DeleteArtifactDialog'
import { ArtifactKindBadge, artifactDisplayTitle } from '../artifacts/artifactDisplay'
import { PaneSkeleton, PaneEmptyState } from './pane-primitives'

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return <span className="nexy-font-status shrink-0 tabular-nums text-nexy-activity">{m}:{String(s).padStart(2, '0')}</span>
}

// ---------------------------------------------------------------------------
// Scope types
// ---------------------------------------------------------------------------

type ArtifactScope = 'project' | 'all'

// ---------------------------------------------------------------------------
// ArtifactListItem row
// ---------------------------------------------------------------------------

function ArtifactListItem({ artifact, onDelete, onExport, onClick }: {
  artifact: ArtifactRow
  onDelete: (id: string) => void
  onExport: (artifact: ArtifactRow) => void
  onClick: (id: string) => void
}) {
  return (
    <div
      title={artifactDisplayTitle(artifact.title, artifact.kind)}
      onClick={() => onClick(artifact.id)}
      className="group flex cursor-pointer items-center gap-2 rounded-nexy-sm border border-transparent px-2 py-2 transition-colors hover:border-nexy-border hover:bg-nexy-recessed"
    >
      <ArtifactKindBadge kind={artifact.kind} />
      <div className="flex-1 min-w-0">
        <p className="truncate text-xs font-medium text-nexy-text">{artifactDisplayTitle(artifact.title, artifact.kind)}</p>
        <p className="truncate text-[10px] text-nexy-muted">
          {artifact.status === 'generating' ? (
            <span className="text-nexy-activity">generating…</span>
          ) : (
            <>
              {artifact.currentVersion ? `v${artifact.currentVersion.versionNumber}` : '—'}
              {' · '}
              {artifact.status}
            </>
          )}
        </p>
      </div>
      {artifact.status === 'generating' && (
        <NexyIcon name="busy" className="h-3 w-3 shrink-0 text-nexy-activity" />
      )}
      <div className="invisible group-hover:visible flex items-center gap-0.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onExport(artifact) }}
          className="rounded-nexy-sm border border-transparent p-1 text-nexy-muted hover:border-nexy-border hover:bg-nexy-raised hover:text-nexy-text"
          aria-label={`Export ${artifact.title}`}
          title="Export"
        >
          <NexyIcon name="download" className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(artifact.id) }}
          className="rounded-nexy-sm border border-transparent p-1 text-nexy-muted hover:border-nexy-error hover:bg-nexy-recessed hover:text-nexy-error"
          aria-label={`Delete ${artifact.title}`}
          title="Delete"
        >
          <NexyIcon name="delete" className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ArtifactsPane
// ---------------------------------------------------------------------------

export function ArtifactsPane() {
  const projects = useAppStore((s) => s.projects)
  const pendingGen = useAppStore((s) => s.pendingArtifactGeneration)
  const openArtifactPanel = useAppStore((s) => s.openArtifactPanel)
  const addToast = useAppStore((s) => s.addToast)

  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [scope, setScope] = useState<ArtifactScope>('all')
  const [scopeProjectId, setScopeProjectId] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ArtifactRow | null>(null)

  const loadAll = useCallback(async () => {
    if (scope === 'project' && !scopeProjectId) {
      setArtifacts([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // No projectId means "every artifact regardless of project" (see artifact:list handler).
      setArtifacts(scope === 'project' ? await window.api.artifactList(scopeProjectId) : await window.api.artifactList())
    } catch {
      // leave existing list
    } finally {
      setLoading(false)
    }
  }, [scope, scopeProjectId])

  useEffect(() => { void loadAll() }, [loadAll])

  // Debrief/quiz generation (and other artifact updates) run in the main process and can
  // finish while this pane isn't focused — refetch on any artifact change rather than only
  // reflecting state as of last mount.
  useEffect(() => window.api.onArtifactUpdated(() => void loadAll()), [loadAll])

  const filtered = useMemo(
    () => deferredQuery
      ? artifacts.filter((a) => {
        const q = deferredQuery.toLowerCase()
        return a.title.toLowerCase().includes(q) || a.kind.toLowerCase().includes(q)
      })
      : artifacts,
    [artifacts, deferredQuery],
  )

  const handleDelete = async () => {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setPendingDelete(null)
    try {
      await window.api.artifactDelete(id)
      setArtifacts((prev) => prev.filter((a) => a.id !== id))
    } catch {
      addToast('Failed to delete artifact', 'error')
    }
  }

  const handleExport = async (artifact: ArtifactRow) => {
    if (!artifact.currentVersionId) {
      addToast('No version to export', 'error')
      return
    }
    try {
      const result = await window.api.artifactExport(artifact.currentVersionId, 'raw-files')
      addToast(`Exported to: ${result.exportPath}`, 'success')
    } catch {
      addToast('Export failed', 'error')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex h-9 items-center justify-between border-b border-nexy-border px-4">
        <span className="nexy-font-status text-nexy-muted">
          {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search */}
      <div className="border-b border-nexy-border px-3 py-2">
        <div className="relative">
          <NexyIcon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nexy-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artifacts…"
            className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-1.5 pl-8 pr-7 text-xs text-nexy-text outline-none transition-colors placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-nexy-muted hover:text-nexy-text"
              aria-label="Clear search"
            >
              <NexyIcon name="close" className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Scope pills */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-nexy-border px-3 py-2">
        {(['all', 'project'] as ArtifactScope[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={`rounded-nexy-sm border-2 px-2.5 py-1 text-[11px] font-medium transition-colors ${
              scope === s
                ? 'border-nexy-accent bg-nexy-accent text-nexy-on-accent'
                : 'border-nexy-border bg-nexy-recessed text-nexy-muted hover:bg-nexy-raised hover:text-nexy-text'
            }`}
          >
            {s === 'project' ? 'Project' : 'All'}
          </button>
        ))}
        {scope === 'project' && projects.length > 0 && (
          <select
            value={scopeProjectId}
            onChange={(e) => setScopeProjectId(e.target.value)}
            className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-2 py-1 text-[11px] text-nexy-text focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-0.5">
        {loading ? (
          <PaneSkeleton rows={3} rowHeight="h-12" />
        ) : (
          <>
            {pendingGen && (
              <div title={pendingGen.title} className="flex items-center gap-2 rounded-nexy-sm border-2 border-nexy-activity bg-nexy-recessed px-2 py-2 shadow-nexy">
                <NexyIcon name="busy" className="h-3.5 w-3.5 shrink-0 text-nexy-activity" />
                <ArtifactKindBadge kind={pendingGen.kind} />
                <span className="flex-1 truncate text-xs font-medium text-nexy-text">{pendingGen.title}</span>
                <ElapsedTimer startedAt={pendingGen.startedAt} />
              </div>
            )}
            {filtered.length === 0 && !pendingGen ? (
              <PaneEmptyState>
                {deferredQuery
                    ? `No artifacts match "${deferredQuery}"`
                    : scope === 'project'
                      ? (scopeProjectId ? 'No artifacts for this project yet' : 'Select a project to filter by')
                      : 'No artifacts yet'}
              </PaneEmptyState>
            ) : (
              filtered.map((artifact) => (
                <ArtifactListItem
                  key={artifact.id}
                  artifact={artifact}
                  onClick={openArtifactPanel}
                  onDelete={() => setPendingDelete(artifact)}
                  onExport={(a) => void handleExport(a)}
                />
              ))
            )}
          </>
        )}
      </div>

      {pendingDelete && (
        <DeleteArtifactDialog
          artifactTitle={pendingDelete.title}
          onConfirm={() => void handleDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
