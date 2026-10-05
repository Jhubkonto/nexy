import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/primitives'
import { NexyIcon } from '../ui/icons/NexyIcon'
import type { WikiEntry } from '../../../shared/types'

function parseWikiTags(value: string): string[] {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean)))
}

function sortWikiEntries(entries: WikiEntry[]): WikiEntry[] {
  return [...entries].sort((a, b) => b.updated_at - a.updated_at)
}

export function WikiTab({ projectId }: { projectId: string }) {
  const addToast = useAppStore((s) => s.addToast)
  const [entries, setEntries] = useState<WikiEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const resetEditor = useCallback(() => {
    setEditingId(null)
    setDraftTitle('')
    setDraftTags('')
    setDraftBody('')
  }, [])

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(sortWikiEntries(await window.api.listWikiEntries(projectId)))
    } catch {
      addToast('Failed to load wiki entries', 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast, projectId])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  const openNewEntry = useCallback(() => {
    setConfirmDeleteId(null)
    setEditingId('new')
    setDraftTitle('')
    setDraftTags('')
    setDraftBody('')
  }, [])

  const openEntry = useCallback((entry: WikiEntry) => {
    setConfirmDeleteId(null)
    setEditingId(entry.id)
    setDraftTitle(entry.title)
    setDraftTags(entry.tags.join(', '))
    setDraftBody(entry.body)
  }, [])

  const handleSave = useCallback(async () => {
    const title = draftTitle.trim()
    if (!title) {
      addToast('Wiki title is required', 'error')
      return
    }
    setSaving(true)
    try {
      const tags = parseWikiTags(draftTags)
      if (editingId === 'new') {
        const created = await window.api.createWikiEntry(projectId, title, draftBody, tags)
        setEntries((prev) => sortWikiEntries([created, ...prev]))
        addToast('Wiki entry created', 'success')
      } else if (editingId) {
        const updated = await window.api.updateWikiEntry(editingId, { title, body: draftBody, tags })
        setEntries((prev) => sortWikiEntries(prev.map((entry) => (entry.id === editingId ? updated : entry))))
        addToast('Wiki entry updated', 'success')
      }
      resetEditor()
    } catch {
      addToast('Failed to save wiki entry', 'error')
    } finally {
      setSaving(false)
    }
  }, [addToast, draftBody, draftTags, draftTitle, editingId, projectId, resetEditor])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await window.api.deleteWikiEntry(id)
      setEntries((prev) => prev.filter((entry) => entry.id != id))
      setConfirmDeleteId(null)
      if (editingId === id) resetEditor()
      addToast('Wiki entry deleted', 'success')
    } catch {
      addToast('Failed to delete wiki entry', 'error')
    }
  }, [addToast, editingId, resetEditor])

  const parsedDraftTags = parseWikiTags(draftTags)

  const renderEditor = (mode: 'new' | 'edit') => (
    <div className="space-y-3 rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed p-3 shadow-nexy">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <NexyIcon name="artifact" size={16} className="text-primary" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">
            {mode === 'new' ? 'New wiki entry' : 'Editing wiki entry'}
          </span>
        </div>
        <Button variant="secondary" onClick={resetEditor} className="text-[11px]">
          <NexyIcon name="refresh" size={12} />
          Cancel
        </Button>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Title</label>
        <input
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="e.g. Architecture decisions"
          className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label="Wiki title"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tags</label>
        <input
          value={draftTags}
          onChange={(e) => setDraftTags(e.target.value)}
          placeholder="architecture, decisions, onboarding"
          className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label="Wiki tags"
        />
        {parsedDraftTags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {parsedDraftTags.map((tag) => (
              <span key={tag} className="rounded-nexy-sm border border-nexy-border bg-nexy-raised px-2 py-0.5 text-[10px] text-nexy-text">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Body</label>
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={8}
          placeholder="Write markdown notes for this project..."
          className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
          aria-label="Wiki body"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="primary" onClick={handleSave} disabled={saving || !draftTitle.trim()}>
          <NexyIcon name="check" size={14} />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Project wiki</label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Capture durable project context, decisions, and notes.</p>
        </div>
        <button
          type="button"
          onClick={openNewEntry}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600"
        >
          <NexyIcon name="add" size={14} />
          New entry
        </button>
      </div>

      {editingId == 'new' && renderEditor('new')}

      {loading ? (
        <div className="rounded-nexy-sm border-2 border-dashed border-nexy-border bg-nexy-recessed px-4 py-8 text-center text-sm text-nexy-muted">
          Loading wiki entries…
        </div>
      ) : entries.length === 0 ? (
        <div className="space-y-2 rounded-nexy-sm border-2 border-dashed border-nexy-border bg-nexy-recessed px-4 py-8 text-center">
          <NexyIcon name="artifact" size={20} className="mx-auto text-muted-foreground" />
          <p className="text-sm text-gray-600 dark:text-gray-300">No wiki entries yet. Add your first entry to start building project knowledge.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            if (editingId === entry.id) return <div key={entry.id}>{renderEditor('edit')}</div>
            return (
              <div
                key={entry.id}
                onClick={() => openEntry(entry)}
                className={`cursor-pointer rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-3 shadow-nexy transition-colors hover:border-nexy-accent ${entry.superseded_by ? 'opacity-60' : ''}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEntry(entry) }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold text-gray-800 dark:text-gray-100 ${entry.superseded_by ? 'line-through' : ''}`}>
                        {entry.title}
                      </span>
                      {entry.tags.map((tag) => (
                        <span key={tag} className="rounded-nexy-sm border border-nexy-border bg-nexy-recessed px-2 py-0.5 text-[10px] text-nexy-text">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p
                      className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words"
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                    >
                      {entry.body || 'No content yet.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openEntry(entry)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      aria-label={`Edit ${entry.title}`}
                      title="Edit entry"
                    >
                      <NexyIcon name="edit" size={14} />
                    </button>
                    {confirmDeleteId === entry.id ? (
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-gray-500 dark:text-gray-400">Are you sure?</span>
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry.id)}
                          className="px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(entry.id)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label={`Delete ${entry.title}`}
                        title="Delete entry"
                      >
                        <NexyIcon name="delete" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
