import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Loader2, Plus, Save } from 'lucide-react'
import type { PromptLibraryEntry, PromptLibraryInput } from '../../shared/types'
import { extractPromptVariables, resolvePromptVariables } from '../../shared/prompt-variables'
import { Button, ModalShell, SegmentedTabs, SelectField, TextareaField, TextField } from './ui/primitives'

interface PromptLibraryModalProps {
  projectId: string | null
  projectName?: string | null
  draftContent?: string
  initialMode?: Mode
  onInsert: (content: string) => void
  onRun?: (content: string) => void | Promise<void>
  onAttachInstruction?: (content: string, title: string) => void
  onClose: () => void
}

type Mode = 'use' | 'save'

const EMPTY_DRAFT: PromptLibraryInput = {
  title: '',
  description: '',
  body: '',
  category: 'Custom',
  tags: [],
  scope: 'global',
  project_id: null,
}

function defaultsKey(projectId: string | null): string {
  return `prompt_variable_defaults:${projectId ?? 'global'}`
}

function parseDefaults(value: string | null): Record<string, string> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, item]) => typeof item === 'string')
        .map(([key, item]) => [key, item as string])
    )
  } catch {
    return {}
  }
}

function groupPrompts(prompts: PromptLibraryEntry[]): Record<string, PromptLibraryEntry[]> {
  return prompts.reduce<Record<string, PromptLibraryEntry[]>>((groups, prompt) => {
    const category = prompt.category || 'Custom'
    groups[category] = groups[category] ?? []
    groups[category].push(prompt)
    return groups
  }, {})
}

function tagsToInput(tags: string[] | undefined): string {
  return (tags ?? []).join(', ')
}

function inputToTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}

function scopeLabel(scope: string, projectName?: string | null): string {
  return scope === 'project'
    ? `Project: ${projectName ?? 'selected project'}`
    : 'Available everywhere'
}

function titleFromBody(body: string): string {
  const firstLine = body.trim().split('\n').find(Boolean) ?? ''
  return firstLine.slice(0, 64)
}

export function PromptLibraryModal({
  projectId,
  projectName,
  draftContent = '',
  initialMode = 'use',
  onInsert,
  onRun,
  onAttachInstruction,
  onClose,
}: PromptLibraryModalProps) {
  const draftContentRef = useRef(draftContent)
  draftContentRef.current = draftContent
  const [prompts, setPrompts] = useState<PromptLibraryEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PromptLibraryInput>(() => ({
    ...EMPTY_DRAFT,
    body: draftContent.trim(),
    title: titleFromBody(draftContent),
    scope: projectId ? 'project' : 'global',
    project_id: projectId,
  }))
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPrompts = useCallback(async () => {
    setLoading(true)
    try {
      const [entries, savedDefaults] = await Promise.all([
        window.api.listPrompts(projectId),
        window.api.getSetting(defaultsKey(projectId)).then(parseDefaults).catch(() => ({})),
      ])
      setPrompts(entries)
      setDefaults(savedDefaults)
      setSelectedId((current) => entries.some((entry) => entry.id === current) ? current : entries[0]?.id ?? null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadPrompts()
  }, [loadPrompts])

  useEffect(() => {
    // A modal can remain mounted while the chat changes project. Do not carry a
    // selection, edit form, or project scope across that boundary.
    setSelectedId(null)
    setValues({})
    setEditingId(null)
    setDraft({
      ...EMPTY_DRAFT,
      body: draftContentRef.current.trim(),
      title: titleFromBody(draftContentRef.current),
      scope: projectId ? 'project' : 'global',
      project_id: projectId,
    })
    setTagInput('')
    setError(null)
    setMode(initialMode)
  }, [initialMode, projectId])

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedId) ?? null,
    [prompts, selectedId]
  )
  const groupedPrompts = useMemo(() => groupPrompts(prompts), [prompts])
  const resolvedPrompt = selectedPrompt ? resolvePromptVariables(selectedPrompt.body, values) : ''
  const draftVariables = useMemo(() => extractPromptVariables(draft.body), [draft.body])

  useEffect(() => {
    if (!selectedPrompt) {
      setValues({})
      return
    }
    setValues((current) => {
      const next: Record<string, string> = {}
      for (const variable of selectedPrompt.variables) {
        next[variable] = current[variable] ?? defaults[variable] ?? ''
      }
      return next
    })
  }, [defaults, selectedPrompt])

  const startNewPrompt = useCallback((prefillFromComposer: boolean) => {
    const body = prefillFromComposer ? draftContent.trim() : ''
    setEditingId(null)
    setDraft({
      ...EMPTY_DRAFT,
      body,
      title: titleFromBody(body),
      scope: projectId ? 'project' : 'global',
      project_id: projectId,
    })
    setTagInput('')
    setError(null)
    setMode('save')
  }, [draftContent, projectId])

  const startEditPrompt = useCallback((prompt: PromptLibraryEntry) => {
    setEditingId(prompt.id)
    setDraft({
      title: prompt.title,
      body: prompt.body,
      description: prompt.description,
      category: prompt.category,
      tags: prompt.tags,
      scope: prompt.scope,
      project_id: prompt.project_id,
    })
    setTagInput(tagsToInput(prompt.tags))
    setError(null)
    setMode('save')
  }, [])

  const rememberVariableDefaults = useCallback(async () => {
    if (!selectedPrompt) return
    const nextDefaults = { ...defaults }
    for (const variable of selectedPrompt.variables) {
      if (values[variable]?.trim()) {
        nextDefaults[variable] = values[variable]
      }
    }
    await window.api.setSetting(defaultsKey(projectId), JSON.stringify(nextDefaults)).catch(() => undefined)
  }, [defaults, projectId, selectedPrompt, values])

  const handleSave = useCallback(async () => {
    const scope = draft.scope === 'project' ? 'project' : 'global'
    const activeProjectId = projectId?.trim() || null
    const editingPrompt = editingId ? prompts.find((prompt) => prompt.id === editingId) ?? null : null
    if (editingId && !editingPrompt) {
      setError('The selected prompt is no longer available in this project.')
      return
    }
    if (editingPrompt?.scope === 'project' && (editingPrompt.project_id?.trim() || null) !== activeProjectId) {
      setError('The project changed while this prompt was being edited. Reload it before saving.')
      return
    }
    const payload: PromptLibraryInput = {
      ...draft,
      title: String(draft.title ?? '').trim(),
      body: String(draft.body ?? ''),
      description: String(draft.description ?? '').trim(),
      category: String(draft.category ?? 'Custom').trim() || 'Custom',
      tags: inputToTags(tagInput),
      scope,
      project_id: scope === 'project' ? activeProjectId : null,
    }
    if (!payload.title || !payload.body.trim()) {
      setError('Title and prompt body are required.')
      return
    }
    if (payload.scope === 'project' && !payload.project_id) {
      setError('Select a project before saving a project prompt.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const saved = editingId
        ? await window.api.updatePrompt(editingId, payload)
        : await window.api.createPrompt(payload)
      await loadPrompts()
      setSelectedId(saved.id)
      setEditingId(saved.id)
      setMode('use')
    } catch {
      setError('Failed to save prompt.')
    } finally {
      setSaving(false)
    }
  }, [draft, editingId, loadPrompts, projectId, prompts, tagInput])

  const handleInsert = useCallback(async () => {
    if (!selectedPrompt) return
    await rememberVariableDefaults()
    onInsert(resolvedPrompt)
    onClose()
  }, [onClose, onInsert, rememberVariableDefaults, resolvedPrompt, selectedPrompt])

  const handleRun = useCallback(async () => {
    if (!selectedPrompt || !onRun) return
    await rememberVariableDefaults()
    onClose()
    await onRun(resolvedPrompt)
  }, [onClose, onRun, rememberVariableDefaults, resolvedPrompt, selectedPrompt])

  const handleAttachInstruction = useCallback(async () => {
    if (!selectedPrompt || !onAttachInstruction) return
    await rememberVariableDefaults()
    onAttachInstruction(resolvedPrompt, selectedPrompt.title)
    onClose()
  }, [onAttachInstruction, onClose, rememberVariableDefaults, resolvedPrompt, selectedPrompt])

  return (
    <ModalShell
      title="Prompt library"
      description={`Use, save, and edit reusable prompts${projectName ? ` for ${projectName}` : ''}.`}
      icon={<BookOpen className="w-4 h-4 text-gray-400" />}
      ariaLabel="Prompt library"
      maxWidth="max-w-6xl"
      bodyClassName="grid grid-cols-[280px_1fr] min-h-0 flex-1"
      onClose={onClose}
      headerActions={
        <Button
              type="button"
              onClick={() => startNewPrompt(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              Save current draft
        </Button>
      }
      footer={
        <>
          <Button onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleInsert()}
            disabled={mode !== 'use' || !selectedPrompt}
          >
            Insert prompt
          </Button>
          <Button
            onClick={() => void handleAttachInstruction()}
            disabled={mode !== 'use' || !selectedPrompt || !onAttachInstruction}
          >
            Attach as instructions
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleRun()}
            disabled={mode !== 'use' || !selectedPrompt || !onRun}
          >
            Run prompt
          </Button>
        </>
      }
    >
          <div className="border-r border-gray-200 dark:border-gray-700 min-h-0 flex flex-col">
            <SegmentedTabs
              value={mode}
              items={[
                { id: 'use', label: 'Use prompts' },
                { id: 'save', label: 'Save prompt' },
              ]}
              onChange={(nextMode) => nextMode === 'save' ? startNewPrompt(false) : setMode('use')}
            />
            <div className="overflow-y-auto p-2">
              {loading && (
                <div className="flex items-center gap-2 p-3 text-xs text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading prompts...
                </div>
              )}
              {!loading && prompts.length === 0 && (
                <p className="p-3 text-xs text-gray-400">No prompts saved yet.</p>
              )}
              {!loading && Object.entries(groupedPrompts).map(([category, entries]) => (
                <div key={category} className="mb-2">
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    {category}
                  </div>
                  {entries.map((prompt) => (
                    <button
                      key={prompt.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(prompt.id)
                        setMode('use')
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        selectedId === prompt.id && mode === 'use'
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="block text-xs font-medium whitespace-normal break-words leading-4">{prompt.title}</span>
                      <span className="block text-[11px] text-gray-400 whitespace-normal break-words mt-0.5">
                        {scopeLabel(prompt.scope, projectName)}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            {mode === 'use' ? (
              <div className="space-y-4">
                {selectedPrompt ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-medium text-gray-800 dark:text-gray-100 break-words">{selectedPrompt.title}</h3>
                        <p className="text-xs text-gray-500 mt-1">{scopeLabel(selectedPrompt.scope, projectName)} · {selectedPrompt.category}</p>
                        {selectedPrompt.description && (
                          <p className="text-sm text-gray-500 mt-2 whitespace-pre-wrap">{selectedPrompt.description}</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        onClick={() => startEditPrompt(selectedPrompt)}
                        className="shrink-0"
                      >
                        Edit
                      </Button>
                    </div>

                    {selectedPrompt.variables.length > 0 && (
                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Variables</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {selectedPrompt.variables.map((variable) => (
                            <TextField
                              key={variable}
                              label={`{{${variable}}}`}
                                value={values[variable] ?? ''}
                                onChange={(event) => setValues((current) => ({ ...current, [variable]: event.target.value }))}
                              className="font-mono"
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Preview</p>
                      <pre className="whitespace-pre-wrap text-sm leading-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 text-gray-700 dark:text-gray-200 p-4 max-h-[44vh] overflow-y-auto">
                        {resolvedPrompt}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">Select a prompt or save a new one.</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-medium text-gray-800 dark:text-gray-100">
                    {editingId ? 'Edit prompt' : 'Save a prompt'}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Prompts saved here are immediately available from the chat composer.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <TextField
                      label="Title"
                      value={draft.title}
                      onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Code review checklist"
                    />
                  <TextField
                      label="Category"
                      value={draft.category ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                      placeholder="Coding"
                    />
                </div>

                <TextField
                    label="Description"
                    value={draft.description ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="When to use this prompt"
                  />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <SelectField
                      label="Scope"
                      value={draft.scope ?? 'global'}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        scope: event.target.value === 'project' ? 'project' : 'global',
                        project_id: event.target.value === 'project' ? projectId : null,
                      }))}
                    >
                      <option value="global">Available everywhere</option>
                      <option value="project" disabled={!projectId}>{projectName ? `Project: ${projectName}` : 'Project prompt'}</option>
                    </SelectField>
                  <TextField
                      label="Tags"
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      placeholder="review, typescript"
                    />
                </div>

                <TextareaField
                    label="Prompt"
                    value={draft.body}
                    onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
                    className="min-h-[280px]"
                    placeholder="Write the reusable prompt..."
                  />

                {draftVariables.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {draftVariables.map((variable) => (
                      <span key={variable} className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] font-mono text-gray-600 dark:text-gray-300">
                        {'{{'}{variable}{'}}'}
                      </span>
                    ))}
                  </div>
                )}

                {error && <p className="text-xs text-red-500">{error}</p>}

                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    variant="primary"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save prompt
                  </Button>
                </div>
              </div>
            )}
          </div>
    </ModalShell>
  )
}
