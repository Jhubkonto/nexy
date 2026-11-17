import { sourceQualifiedModel } from '../../shared/models'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../store/app-store'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { StreamingFadeText } from './chat/StreamingFadeText'
import type { ArtifactSpec, ArtifactGeneratorMessage, AvailableModelGroup, AvailableModelEntry } from '../../shared/types'
import { ModelPicker } from './chat/ModelPicker'
import { VoiceInputButton } from './chat/VoiceInputButton'
import { Button } from './ui/primitives'
import { NexyIcon } from './ui/icons/NexyIcon'

// ─── Spec preview ─────────────────────────────────────────────────────────────

function SpecPreview({ spec }: { spec: ArtifactSpec | null }) {
  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-gray-500 select-none">
        <NexyIcon name="artifact" className="w-8 h-8 opacity-40" />
        <p className="text-xs text-center max-w-[160px]">
          Your artifact spec will appear here as the conversation progresses.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium uppercase">
          {spec.kind}
        </span>
        <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{spec.title}</span>
      </div>

      {spec.intendedUse && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Intended use</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">{spec.intendedUse}</p>
        </div>
      )}

      {spec.audience && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Audience</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">{spec.audience}</p>
        </div>
      )}

      {spec.outputFiles.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Output files</p>
          <div className="space-y-0.5">
            {spec.outputFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-medium">{f.role}</span>
                <span className="text-xs font-mono text-gray-600 dark:text-gray-400 truncate">{f.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {spec.acceptanceCriteria.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Acceptance criteria</p>
          <ul className="space-y-0.5">
            {spec.acceptanceCriteria.map((c, i) => (
              <li key={i} className="text-xs text-gray-600 dark:text-gray-300 flex gap-1.5">
                <span className="text-green-500 shrink-0">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── EditForm ─────────────────────────────────────────────────────────────────

const ARTIFACT_KINDS = ['document', 'code', 'ui', 'data', 'prompt', 'agent-config', 'plan', 'bundle', 'other'] as const

interface EditFormProps {
  spec: ArtifactSpec
  onChange: (spec: ArtifactSpec) => void
  onConfirm: () => void
  onBack: () => void
}

function EditForm({ spec, onChange, onConfirm, onBack }: EditFormProps) {
  const set = (patch: Partial<ArtifactSpec>) => onChange({ ...spec, ...patch })

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Title</p>
          <input
            value={spec.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Artifact title"
            className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
        </section>

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Kind</p>
          <div className="flex flex-wrap gap-1.5">
            {ARTIFACT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => set({ kind })}
                className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                  spec.kind === kind
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {kind}
              </button>
            ))}
          </div>
        </section>

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Intended use</p>
          <textarea
            value={spec.intendedUse ?? ''}
            onChange={(e) => set({ intendedUse: e.target.value })}
            placeholder="What is this artifact for?"
            rows={3}
            className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-purple-400 resize-none"
          />
        </section>

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Audience</p>
          <input
            value={spec.audience ?? ''}
            onChange={(e) => set({ audience: e.target.value })}
            placeholder="Who is this for?"
            className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
        </section>

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Output files</p>
          <div className="space-y-1.5">
            {spec.outputFiles.map((f, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  value={f.path}
                  onChange={(e) => {
                    const files = [...spec.outputFiles]
                    files[i] = { ...f, path: e.target.value }
                    set({ outputFiles: files })
                  }}
                  placeholder="path"
                  className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none font-mono"
                />
                <input
                  value={f.role}
                  onChange={(e) => {
                    const files = [...spec.outputFiles]
                    files[i] = { ...f, role: e.target.value as ArtifactSpec['outputFiles'][number]['role'] }
                    set({ outputFiles: files })
                  }}
                  placeholder="role"
                  className="w-20 text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => set({ outputFiles: spec.outputFiles.filter((_, j) => j !== i) })}
                  className="p-1 text-gray-400 hover:text-red-500"
                  aria-label="Remove file"
                >
                  <NexyIcon name="delete" className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ outputFiles: [...spec.outputFiles, { path: '', role: 'primary' as const, mediaType: 'text/plain' }] })}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <NexyIcon name="add" className="w-3 h-3" />
              Add file
            </button>
          </div>
        </section>

        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Acceptance criteria</p>
          <div className="space-y-1.5">
            {spec.acceptanceCriteria.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  value={c}
                  onChange={(e) => {
                    const criteria = [...spec.acceptanceCriteria]
                    criteria[i] = e.target.value
                    set({ acceptanceCriteria: criteria })
                  }}
                  placeholder="Criterion…"
                  className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => set({ acceptanceCriteria: spec.acceptanceCriteria.filter((_, j) => j !== i) })}
                  className="p-1 text-gray-400 hover:text-red-500"
                  aria-label="Remove criterion"
                >
                  <NexyIcon name="delete" className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ acceptanceCriteria: [...spec.acceptanceCriteria, ''] })}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <NexyIcon name="add" className="w-3 h-3" />
              Add criterion
            </button>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
        <button
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          disabled={!spec.title.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
        >
          <NexyIcon name="spark" className="w-3.5 h-3.5" />
          Generate artifact
        </button>
      </div>
    </div>
  )
}

// ─── CreationOverlay ──────────────────────────────────────────────────────────

const CREATION_STEPS = [
  'Creating artifact…',
  'Writing files…',
  'Finalizing…',
  'Done ✓',
] as const

function CreationOverlay({ step, error, onRetry }: { step: number; error: string | null; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 z-10 bg-white/90 dark:bg-gray-900/90 flex flex-col items-center justify-center gap-4">
      {error ? (
        <>
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">Creation failed</p>
          <p className="text-xs text-gray-500 max-w-sm text-center">{error}</p>
          <Button variant="primary" onClick={onRetry} className="text-sm">
            Try again
          </Button>
        </>
      ) : (
        <>
          <NexyIcon name="busy" className="w-6 h-6 text-nexy-accent" />
          <div className="space-y-1.5 text-left min-w-[200px]">
            {CREATION_STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                {i < step ? (
                  <span className="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center text-white text-[8px]">✓</span>
                ) : i === step ? (
                  <NexyIcon name="busy" className="w-3.5 h-3.5 text-nexy-accent shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-gray-600" />
                )}
                <span className={`text-xs ${i === step ? 'text-gray-900 dark:text-gray-100 font-medium' : i < step ? 'text-gray-400 line-through' : 'text-gray-400'}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── DoneOverlay ──────────────────────────────────────────────────────────────

interface DoneOverlayProps {
  artifactTitle: string | null
  artifactId: string | null
  projects: { id: string; name: string }[]
  activeProjectId: string | null
  onAddToProject: (projectId: string) => Promise<void>
  onClose: () => void
  onGenerateAnother: () => void
}

function DoneOverlay({ artifactTitle, artifactId, projects, activeProjectId, onAddToProject, onClose, onGenerateAnother }: DoneOverlayProps) {
  const [addingToProject, setAddingToProject] = useState<string | null>(null)
  const [addedToProject, setAddedToProject] = useState<string | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const handleAdd = async (projectId: string) => {
    if (!artifactId) return
    setAddingToProject(projectId)
    try {
      await onAddToProject(projectId)
      setAddedToProject(projectId)
    } finally {
      setAddingToProject(null)
    }
  }

  return (
    <div className="absolute inset-0 z-10 bg-white/95 dark:bg-gray-900/95 flex flex-col items-center justify-center gap-5 px-8">
      <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
        <span className="text-xl">✓</span>
      </div>
      <div className="text-center space-y-1">
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">Artifact Created!</p>
        {artifactTitle && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            &ldquo;{artifactTitle}&rdquo; is ready.
          </p>
        )}
      </div>
      {artifactId && projects.length > 0 && (
        <div className="w-full max-w-sm space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 text-center font-medium">Add to project</p>
          {activeProject && (
            <button
              onClick={() => void handleAdd(activeProject.id)}
              disabled={addingToProject !== null || addedToProject === activeProject.id}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors ${
                addedToProject === activeProject.id
                  ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
              } disabled:opacity-50`}
            >
              <span className="truncate">{activeProject.name}</span>
              {addingToProject === activeProject.id ? (
                <NexyIcon name="busy" className="w-3.5 h-3.5 shrink-0" />
              ) : addedToProject === activeProject.id ? (
                <span className="text-xs shrink-0">Added ✓</span>
              ) : (
                <span className="text-xs shrink-0">Active project</span>
              )}
            </button>
          )}
          {projects.filter((p) => p.id !== activeProjectId).length > 0 && (
            <details className="text-xs text-gray-400">
              <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 select-none text-center">Other projects…</summary>
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {projects.filter((p) => p.id !== activeProjectId).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => void handleAdd(p.id)}
                    disabled={addingToProject !== null || addedToProject === p.id}
                    className="w-full text-left px-3 py-1.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 truncate transition-colors"
                  >
                    {addedToProject === p.id ? `${p.name} ✓` : p.name}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 mt-2">
        <Button variant="secondary" onClick={onGenerateAnother}>
          Generate another
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}

// ─── Chat bubble ──────────────────────────────────────────────────────────────

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const displayContent = content.replace(/<artifact-spec>[\s\S]*?<\/artifact-spec>/g, '').trim()
  if (!displayContent) return null

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-nexy-accent text-nexy-on-accent rounded-nexy-sm border-2 border-nexy-border shadow-nexy px-3 py-2 text-sm whitespace-pre-wrap">
          {displayContent}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2">
      <div className="w-6 h-6 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent flex items-center justify-center shrink-0 mt-0.5">
        <NexyIcon name="artifact" className="w-3 h-3 text-white" />
      </div>
      <div className="max-w-[85%] bg-nexy-recessed rounded-nexy-sm border border-nexy-border px-3 py-2 text-sm text-nexy-text whitespace-pre-wrap">
        <StreamingFadeText text={displayContent} />
      </div>
    </div>
  )
}

// ─── Session persistence ──────────────────────────────────────────────────────

const GREETING: ArtifactGeneratorMessage = {
  role: 'assistant',
  content: "Let's create an artifact. Tell me what you want to build — a document, code file, prompt pack, data file, or anything else — and I'll help define it.",
}

interface ArtifactGeneratorSession {
  messages: ArtifactGeneratorMessage[]
  spec: ArtifactSpec | null
}

let _session: ArtifactGeneratorSession | null = null

function getSession(): ArtifactGeneratorSession {
  return _session ?? { messages: [GREETING], spec: null }
}
function saveSession(s: ArtifactGeneratorSession) { _session = s }
function clearSession() { _session = null }

// ─── Background generation lifecycle vars ────────────────────────────────────
// These survive modal unmount so the file-event listener stays active during generation.

let _cleanupFileListener: (() => void) | null = null
let _generationInFlight = false

// ─── Main modal ───────────────────────────────────────────────────────────────

interface ArtifactGeneratorModalProps {
  projectId?: string
  onClose: () => void
  onArtifactCreated?: () => void
}

export function ArtifactGeneratorModal({ projectId, onClose, onArtifactCreated }: ArtifactGeneratorModalProps) {
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const addToast = useAppStore((s) => s.addToast)
  const setPendingArtifactGeneration = useAppStore((s) => s.setPendingArtifactGeneration)
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)

  const [messages, setMessages] = useState<ArtifactGeneratorMessage[]>(() => getSession().messages)
  const [streamingText, setStreamingText] = useState('')
  const [inputText, setInputText] = useState('')
  const [spec, setSpec] = useState<ArtifactSpec | null>(() => getSession().spec)
  const [editSpec, setEditSpec] = useState<ArtifactSpec | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStep, setGenerationStep] = useState(0)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [isDone, setIsDone] = useState(false)
  const [createdArtifactId, setCreatedArtifactId] = useState<string | null>(null)
  const [createdArtifactTitle, setCreatedArtifactTitle] = useState<string | null>(null)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [missedSpec, setMissedSpec] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')

  const { scrollContainerRef, contentContainerRef, handleScrollContainerScroll } = useAutoScroll({
    isGenerating: isStreaming,
    contentSignal: `${messages.length}:${streamingText.length}`,
  })

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  useEffect(() => {
    const offToken = window.api.onArtifactGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((prev) => prev + chunk)
    })
    const offSpec = window.api.onArtifactGeneratorSpecReady((incoming) => {
      const scoped = projectId ? { ...incoming, scope: { type: 'project' as const, projectId } } : incoming
      setSpec(scoped)
      setMissedSpec(false)
    })
    const offFile = window.api.onArtifactGeneratorFileEvent((_e) => {
    })
    _cleanupFileListener = offFile

    const offDone = window.api.onArtifactGeneratorDone(({ hasSpec }) => {
      const capturedText = streamingTextRef.current
      const clean = capturedText.replace(/<artifact-spec>[\s\S]*?<\/artifact-spec>/g, '').trim()
      if (clean) {
        setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      }
      if (!hasSpec && !clean) setMissedSpec(true)
    })

    return () => {
      offToken()
      offSpec()
      offDone()
      // Only tear down file listener if no generation is in flight
      if (!_generationInFlight) {
        offFile()
        _cleanupFileListener = null
      }
    }
  }, [projectId])

  const sendMessage = useCallback(async (userText: string) => {
    if (isStreaming || !userText.trim()) return
    const userMsg: ArtifactGeneratorMessage = { role: 'user', content: userText.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInputText('')
    setIsStreaming(true)
    setStreamingText('')
    streamingTextRef.current = ''
    setMissedSpec(false)

    try {
      const result = await window.api.artifactGeneratorChat(nextMessages, projectId, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to get response', 'error')
    } finally {
      setIsStreaming(false)
      setStreamingText('')
      streamingTextRef.current = ''
    }
  }, [isStreaming, messages, addToast, genModel, projectId])

  useEffect(() => { saveSession({ messages, spec }) }, [messages, spec])

  const doGenerate = useCallback(async (specToGenerate: ArtifactSpec) => {
    const runId = crypto.randomUUID()
    _generationInFlight = true
    setIsGenerating(true)
    setGenerationStep(0)
    setGenerationError(null)
    setPendingArtifactGeneration({ title: specToGenerate.title, kind: specToGenerate.kind, startedAt: Date.now() })
    clearSession()

    // Advance steps for UX feedback
    const stepTimer1 = setTimeout(() => setGenerationStep(1), 2000)
    const stepTimer2 = setTimeout(() => setGenerationStep(2), 5000)

    const GENERATION_TIMEOUT_MS = 3 * 60 * 1000
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Generation timed out after 3 minutes. The model may be overloaded — try again.')), GENERATION_TIMEOUT_MS)
    )

    try {
      const result = await Promise.race([
        window.api.artifactGeneratorGenerate(runId, specToGenerate, projectId, genModel ?? undefined),
        timeoutPromise,
      ])
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)
      setGenerationStep(3)
      setPendingArtifactGeneration(null)
      setCreatedArtifactTitle(specToGenerate.title)
      // Try to get the created artifact id from the most recent done run
      try {
        const runs = await window.api.artifactGeneratorGetRuns()
        const latest = runs.find((r) => r.status === 'done' && r.artifactId)
        if (latest?.artifactId) setCreatedArtifactId(latest.artifactId)
      } catch { /* non-fatal */ }
      onArtifactCreated?.()
      setIsDone(true)
    } catch (err) {
      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)
      setPendingArtifactGeneration(null)
      setGenerationError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setIsGenerating(false)
      _generationInFlight = false
      _cleanupFileListener?.()
      _cleanupFileListener = null
    }
  }, [projectId, genModel, setPendingArtifactGeneration, onArtifactCreated])

  const handleGenerate = useCallback(() => {
    const specToUse = isEditing ? editSpec : spec
    if (!specToUse) return
    setIsEditing(false)
    void doGenerate(specToUse)
  }, [isEditing, editSpec, spec, doGenerate])

  const handleGenerateAnother = useCallback(() => {
    setMessages([GREETING])
    setSpec(null)
    setEditSpec(null)
    setIsEditing(false)
    setIsDone(false)
    setCreatedArtifactId(null)
    setCreatedArtifactTitle(null)
    setGenerationError(null)
    setGenerationStep(0)
    setInputText('')
    setGenModel(null)
    clearSession()
  }, [])

  const handleAddToProject = useCallback(async (pid: string) => {
    if (!createdArtifactId) return
    await window.api.artifactMoveToProject(createdArtifactId, pid)
  }, [createdArtifactId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(inputText)
    }
  }

  const resetAll = () => {
    clearSession()
    setMessages([GREETING])
    setSpec(null)
    setEditSpec(null)
    setIsEditing(false)
    setMissedSpec(false)
    setInputText('')
    setGenModel(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Generate new artifact"
    >
      <div
        className="nexy-generator-shell relative bg-nexy-raised border-2 border-nexy-border rounded-nexy-lg shadow-nexy flex flex-col overflow-hidden"
        style={{ width: 'min(860px, 96vw)', height: 'min(640px, 90vh)' }}
      >
        {/* CreationOverlay */}
        {isGenerating && (
          <CreationOverlay
            step={generationStep}
            error={generationError}
            onRetry={() => {
              setIsGenerating(false)
              setGenerationError(null)
            }}
          />
        )}

        {/* DoneOverlay */}
        {isDone && (
          <DoneOverlay
            artifactTitle={createdArtifactTitle}
            artifactId={createdArtifactId}
            projects={projects}
            activeProjectId={activeProjectId}
            onAddToProject={handleAddToProject}
            onClose={onClose}
            onGenerateAnother={handleGenerateAnother}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-nexy-border bg-nexy-surface shrink-0">
          <div className="flex items-center gap-2">
            <NexyIcon name="artifact" className="w-4 h-4 text-nexy-accent" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {isEditing ? 'Edit Artifact Spec' : (projectId ? 'New Project Artifact' : 'New Global Artifact')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (messages.length > 1 || spec) && (
              <button
                onClick={resetAll}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Start over
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Close"
            >
              <NexyIcon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body — two columns or edit form */}
        {isEditing && editSpec ? (
          <EditForm
            spec={editSpec}
            onChange={setEditSpec}
            onConfirm={handleGenerate}
            onBack={() => setIsEditing(false)}
          />
        ) : (
          <div className="flex flex-1 min-h-0 divide-x divide-gray-200 dark:divide-gray-700">
            {/* Left: spec preview (38%) */}
            <div className="relative" style={{ width: '38%' }}>
              <div className="absolute inset-0 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Artifact spec</p>
                </div>
                <div className="h-[calc(100%-33px)] overflow-hidden">
                  <SpecPreview spec={spec} />
                </div>
              </div>
            </div>

            {/* Right: chat (62%) */}
            <div className="flex flex-col flex-1 min-w-0">
              {/* Messages */}
              <div ref={scrollContainerRef} onScroll={handleScrollContainerScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                <div ref={contentContainerRef} className="space-y-3">
                  {messages.map((msg, i) => (
                    <ChatBubble key={i} role={msg.role} content={msg.content} />
                  ))}
                  {isStreaming && streamingText && (
                    <ChatBubble role="assistant" content={streamingText} />
                  )}
                  {isStreaming && !streamingText && (
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent flex items-center justify-center shrink-0">
                        <NexyIcon name="artifact" className="w-3 h-3 text-white" />
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2 bg-nexy-recessed rounded-nexy-sm border border-nexy-border">
                        <NexyIcon name="busy" className="w-3 h-3 text-nexy-accent shrink-0" />
                        <span className="text-xs text-gray-500 dark:text-gray-400">Generating artifact spec…</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Input / spec footer */}
              <div className="border-t border-gray-100 dark:border-gray-800">
                {spec && !isStreaming && (
                  <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                    <div className="flex-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                      <span className="text-green-600 dark:text-green-400 font-medium">Spec ready</span>
                      {' — '}{spec.title}
                    </div>
                    <button
                      onClick={() => { setEditSpec({ ...spec }); setIsEditing(true) }}
                      className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={handleGenerate}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium transition-colors"
                    >
                      <NexyIcon name="spark" className="w-3.5 h-3.5" />
                      Generate artifact
                    </button>
                  </div>
                )}
                <div className="px-4 pb-4 pt-2">
                  <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed focus-within:ring-2 focus-within:ring-nexy-accent transition-colors shadow-nexy">
                    <textarea
                      ref={inputRef}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={spec ? 'Refine the spec or ask for changes…' : 'Describe the artifact you want to create…'}
                      rows={1}
                      disabled={isStreaming}
                      className="chat-input w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto"
                    />
                    <div className="flex items-center justify-end px-2 pb-2 gap-1">
                      <ModelPicker
                        value={genModel ?? 'default'}
                        availableGroups={availableGroups}
                        catalogModels={catalogModels}
                        globalDefaultModel={globalDefaultModel ?? undefined}
                        includeDefault={true}
                        buttonRef={modelPickerRef}
                        onSelectDefault={() => setGenModel(null)}
                        onSelectAvailableModel={(group: AvailableModelGroup, model: AvailableModelEntry) => {
                          const id = sourceQualifiedModel(group.sourceKey, model.id)
                          setGenModel(id)
                        }}
                      />
                      <VoiceInputButton disabled={isStreaming} onText={(text) => setInputText((current) => current.trim() ? `${current.trimEnd()} ${text}` : text)} />
                      <button
                        type="button"
                        onClick={() => void sendMessage(inputText)}
                        disabled={isStreaming || !inputText.trim()}
                        className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${
                          inputText.trim() && !isStreaming
                            ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300'
                            : 'bg-transparent text-gray-400 dark:text-gray-500 cursor-not-allowed'
                        }`}
                        aria-label="Send message"
                      >
                        <NexyIcon name="send" className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {missedSpec && (
                    <p className="text-[10px] text-amber-500 mt-1.5 text-center">
                      No spec was generated — try describing what artifact you want.
                    </p>
                  )}
                  {!spec && !missedSpec && (
                    <p className="text-[10px] text-gray-400 mt-1.5 text-center">
                      Press Enter to send · Shift+Enter for newline
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
