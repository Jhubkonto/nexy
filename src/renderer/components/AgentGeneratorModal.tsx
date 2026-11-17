import { sourceQualifiedModel } from '../../shared/models'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../store/app-store'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { StreamingFadeText } from './chat/StreamingFadeText'
import type { AgentGeneratorSpec, AgentGeneratorMessage, AvailableModelGroup, AvailableModelEntry } from '../../shared/types'
import { PromptLibraryModal } from './PromptLibraryModal'
import { ModelPicker } from './chat/ModelPicker'
import { VoiceInputButton } from './chat/VoiceInputButton'
import { Button } from './ui/primitives'
import { NexyIcon } from './ui/icons/NexyIcon'

interface PastedImage {
  id: string
  dataUrl: string
  name: string
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// ─── Draft preview ────────────────────────────────────────────────────────────

function ToolBadge({ label, enabled }: { label: string; enabled: boolean }) {
  if (!enabled) return null
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">
      {label}
    </span>
  )
}

function DraftPreview({ spec }: { spec: AgentGeneratorSpec | null }) {
  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-gray-500 select-none">
        <NexyIcon name="agent" className="w-8 h-8 opacity-40" />
        <p className="text-xs text-center max-w-[160px]">
          Your agent preview will appear here as the conversation progresses.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full text-sm">
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none">{spec.icon}</span>
        <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{spec.name}</span>
      </div>

      {spec.agenticMode && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
          Agentic mode
        </span>
      )}

      {spec.systemPrompt && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">System prompt</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-5 whitespace-pre-wrap">{spec.systemPrompt}</p>
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Tools</p>
        <div className="flex flex-wrap gap-1">
          <ToolBadge label="File Edit" enabled={spec.tools.fileEdit} />
          <ToolBadge label="Terminal" enabled={spec.tools.terminal} />
          <ToolBadge label="Web Fetch" enabled={spec.tools.webFetch} />
          {!spec.tools.fileEdit && !spec.tools.terminal && !spec.tools.webFetch && (
            <span className="text-xs text-gray-400 italic">None</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-gray-400">
        <span>Temp: {spec.temperature}</span>
        {spec.responseFormat !== 'default' && <span>Format: {spec.responseFormat}</span>}
      </div>

      {spec.rootDirectory && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Root directory</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{spec.rootDirectory}</p>
        </div>
      )}

      {spec.customCommands && spec.customCommands.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
            Commands ({spec.customCommands.length})
          </p>
          <div className="space-y-0.5">
            {spec.customCommands.map((cmd, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-indigo-400 text-[10px]">/</span>
                <span className="text-xs text-gray-600 dark:text-gray-300 truncate">{cmd.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Creation overlay ─────────────────────────────────────────────────────────

const CREATION_STEPS = [
  'Creating agent…',
  'Configuring tools…',
  'Setting up context…',
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

// ─── Chat bubble ──────────────────────────────────────────────────────────────

function ChatBubble({ role, content, images }: { role: 'user' | 'assistant'; content: string; images?: { dataUrl: string; name: string }[] }) {
  const displayContent = content.replace(/<agent-spec>[\s\S]*?<\/agent-spec>/g, '').trim()
  if (!displayContent && (!images || images.length === 0)) return null

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-nexy-accent text-nexy-on-accent rounded-nexy-sm border-2 border-nexy-border shadow-nexy px-3 py-2 text-sm space-y-1.5">
          {images && images.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {images.map((img, i) => (
                <img key={i} src={img.dataUrl} alt={img.name} className="w-14 h-14 object-cover rounded-lg opacity-90" />
              ))}
            </div>
          )}
          {displayContent && <p className="whitespace-pre-wrap">{displayContent}</p>}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2">
      <div className="w-6 h-6 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent flex items-center justify-center shrink-0 mt-0.5">
        <NexyIcon name="agent" className="w-3 h-3 text-white" />
      </div>
      <div className="max-w-[85%] bg-nexy-recessed rounded-nexy-sm border border-nexy-border px-3 py-2 text-sm text-nexy-text whitespace-pre-wrap">
        <StreamingFadeText text={displayContent} />
      </div>
    </div>
  )
}

// ─── Done overlay (P2#16 — add to project) ───────────────────────────────────

interface DoneOverlayProps {
  agentName: string
  agentId: string | null
  projects: { id: string; name: string }[]
  activeProjectId: string | null
  onAddToProject: (projectId: string) => Promise<void>
  onClose: () => void
  onGenerateAnother: () => void
}

function DoneOverlay({ agentName, agentId, projects, activeProjectId, onAddToProject, onClose, onGenerateAnother }: DoneOverlayProps) {
  const [addingToProject, setAddingToProject] = useState<string | null>(null)
  const [addedToProject, setAddedToProject] = useState<string | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const handleAdd = async (projectId: string) => {
    if (!agentId) return
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
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">Agent Created!</p>
        {agentName && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            &ldquo;{agentName}&rdquo; is ready to use.
          </p>
        )}
      </div>
      {agentId && projects.length > 0 && (
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

// ─── Session persistence ──────────────────────────────────────────────────────

const GREETING: AgentGeneratorMessage = {
  role: 'assistant',
  content: "Let's create a new agent. Tell me what you want this agent to do, and I'll help configure the perfect setup.",
}

interface AgentGeneratorSession {
  messages: AgentGeneratorMessage[]
  spec: AgentGeneratorSpec | null
}

let _session: AgentGeneratorSession | null = null

function getSession(): AgentGeneratorSession {
  return _session ?? { messages: [GREETING], spec: null }
}

function saveSession(session: AgentGeneratorSession) {
  _session = session
}

function clearSession() {
  _session = null
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function AgentGeneratorModal({ onClose }: { onClose: () => void }) {
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const addToast = useAppStore((s) => s.addToast)
  const loadAgents = useAppStore((s) => s.loadAgents)
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const openEditAgent = useAppStore((s) => s.openEditAgent)

  const [messages, setMessages] = useState<AgentGeneratorMessage[]>(() => getSession().messages)
  const [streamingText, setStreamingText] = useState('')
  const [inputText, setInputText] = useState('')
  const [spec, setSpec] = useState<AgentGeneratorSpec | null>(() => getSession().spec)
  const [isStreaming, setIsStreaming] = useState(false)
  const [creationStep, setCreationStep] = useState<number>(-1)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [missedSpec, setMissedSpec] = useState(false)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [pendingImages, setPendingImages] = useState<PastedImage[]>([])
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null)
  const [createdAgentName, setCreatedAgentName] = useState<string | null>(null)
  const [isDone, setIsDone] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')
  const isCreating = creationStep >= 0

  const { scrollContainerRef, contentContainerRef, handleScrollContainerScroll } = useAutoScroll({
    isGenerating: isStreaming,
    contentSignal: `${messages.length}:${streamingText.length}`,
  })

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  useEffect(() => {
    const offToken = window.api.onAgentGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((prev) => prev + chunk)
    })
    const offSpec = window.api.onAgentGeneratorSpecReady((incoming) => {
      setSpec(incoming)
      setMissedSpec(false)
    })
    const offDone = window.api.onAgentGeneratorDone(({ hasSpec }) => {
      const capturedText = streamingTextRef.current
      const clean = capturedText.replace(/<agent-spec>[\s\S]*?<\/agent-spec>/g, '').trim()
      if (clean) {
        setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      }
      if (!hasSpec && !clean) setMissedSpec(true)
    })
    return () => {
      offToken()
      offSpec()
      offDone()
    }
  }, [])

  const sendMessage = useCallback(async (userText: string) => {
    if (isStreaming || !userText.trim()) return

    const imagesToSend = [...pendingImages]
    const userMsg: AgentGeneratorMessage = {
      role: 'user',
      content: userText.trim(),
      ...(imagesToSend.length > 0 ? { images: imagesToSend.map((img) => ({ dataUrl: img.dataUrl, name: img.name })) } : {}),
    }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInputText('')
    setPendingImages([])
    setIsStreaming(true)
    setStreamingText('')
    streamingTextRef.current = ''
    setMissedSpec(false)

    try {
      const result = await window.api.agentGeneratorChat(nextMessages, genModel ?? undefined)
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
  }, [isStreaming, messages, addToast, genModel, pendingImages])

  useEffect(() => { saveSession({ messages, spec }) }, [messages, spec])

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'))
    if (items.length === 0) return
    e.preventDefault()
    for (const item of items) {
      const file = item.getAsFile()
      if (!file) continue
      const dataUrl = await readFileAsDataUrl(file)
      setPendingImages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), dataUrl, name: `image.${item.type.split('/')[1] ?? 'png'}` },
      ])
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(inputText || (pendingImages.length > 0 ? 'Here is a screenshot for context.' : ''))
    }
  }

  const handleCreate = useCallback(async (specToCreate: AgentGeneratorSpec, openForEdit = false) => {
    setCreationError(null)
    setCreationStep(0)

    try {
      setCreationStep(1)
      setCreationStep(2)
      const t = specToCreate.tools
      const created = await window.api.createAgent({
        name: specToCreate.name,
        icon: specToCreate.icon,
        systemPrompt: specToCreate.systemPrompt,
        temperature: specToCreate.temperature,
        responseFormat: specToCreate.responseFormat,
        maxTokens: 4096,
        agenticMode: specToCreate.agenticMode,
        contextDirectories: specToCreate.contextDirectories,
        contextFiles: [],
        mcpServers: [],
        rootDirectory: specToCreate.rootDirectory ?? '',
        memory: specToCreate.memory ?? '',
        customCommands: specToCreate.customCommands ?? [],
        contextRules: { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false },
        tools: {
          fileEdit: { enabled: t.fileEdit, approval: 'always-ask', instructions: '' },
          terminal: { enabled: t.terminal, approval: 'always-ask', instructions: '' },
          webFetch: { enabled: t.webFetch, approval: 'always-ask', instructions: '' },
        },
      }) as { id?: string } | null

      setCreationStep(3)
      await loadAgents()
      clearSession()

      if (openForEdit && created?.id) {
        onClose()
        openEditAgent(created.id)
        return
      }

      setCreatedAgentId(created?.id ?? null)
      setCreatedAgentName(specToCreate.name)
      setIsDone(true)
    } catch (err) {
      setCreationError(err instanceof Error ? err.message : 'Creation failed')
      setCreationStep(-1)
    }
  }, [loadAgents, onClose, openEditAgent])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Generate new agent"
    >
      <div
        className="nexy-generator-shell relative bg-nexy-raised border-2 border-nexy-border rounded-nexy-lg shadow-nexy flex flex-col overflow-hidden"
        style={{ width: 'min(860px, 96vw)', height: 'min(640px, 90vh)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-nexy-border bg-nexy-surface shrink-0">
          <div className="flex items-center gap-2">
            <NexyIcon name="agent" className="w-4 h-4 text-nexy-accent" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New Agent</h2>
          </div>
          <div className="flex items-center gap-2">
            {!isCreating && (
              <>
                {messages.length > 1 && (
                  <button
                    onClick={() => {
                      clearSession()
                      setMessages([GREETING])
                      setSpec(null)
                      setMissedSpec(false)
                      setInputText('')
                      setGenModel(null)
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Start over
                  </button>
                )}
                <button
                  onClick={() => {
                    onClose()
                    openCreateAgent()
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Set up manually
                </button>
              </>
            )}
            <button
              onClick={onClose}
              disabled={isCreating && !creationError}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              aria-label="Close"
            >
              <NexyIcon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0 divide-x divide-gray-200 dark:divide-gray-700">
          {/* Left: draft preview (38%) */}
          <div className="relative" style={{ width: '38%' }}>
            <div className="absolute inset-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Draft preview</p>
              </div>
              <div className="h-[calc(100%-33px)] overflow-hidden">
                <DraftPreview spec={spec} />
              </div>
            </div>
          </div>

          {/* Right: chat (62%) */}
          <div className="flex flex-col flex-1 min-w-0 relative">
                {/* Messages */}
                <div ref={scrollContainerRef} onScroll={handleScrollContainerScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  <div ref={contentContainerRef} className="space-y-3">
                    {messages.map((msg, i) => (
                      <ChatBubble key={i} role={msg.role} content={msg.content} images={msg.images} />
                    ))}
                    {isStreaming && streamingText && (
                      <ChatBubble role="assistant" content={streamingText} />
                    )}
                    {isStreaming && !streamingText && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent flex items-center justify-center shrink-0">
                          <NexyIcon name="agent" className="w-3 h-3 text-white" />
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2 bg-nexy-recessed rounded-nexy-sm border border-nexy-border">
                          <NexyIcon name="busy" className="w-3 h-3 text-nexy-accent shrink-0" />
                          <span className="text-xs text-gray-500 dark:text-gray-400">Generating agent spec…</span>
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
                        {' — '}{spec.name}
                      </div>
                      <button
                        onClick={() => void handleCreate(spec, true)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <NexyIcon name="edit" className="w-3 h-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => void handleCreate(spec)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors"
                      >
                        <NexyIcon name="spark" className="w-3.5 h-3.5" />
                        Create agent
                      </button>
                    </div>
                  )}
                  <div className="px-4 pb-4 pt-2">
                    <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed focus-within:ring-2 focus-within:ring-nexy-accent transition-colors shadow-nexy">
                      {pendingImages.length > 0 && (
                        <div className="flex gap-2 flex-wrap px-3 pt-2">
                          {pendingImages.map((img) => (
                            <div key={img.id} className="relative group">
                              <img
                                src={img.dataUrl}
                                alt={img.name}
                                className="w-14 h-14 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                              />
                              <button
                                onClick={() => setPendingImages((prev) => prev.filter((i) => i.id !== img.id))}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-700 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Remove image"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea
                        ref={inputRef}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={(e) => void handlePaste(e)}
                        placeholder={spec ? 'Refine or ask for changes…' : 'Describe your agent…'}
                        rows={1}
                        disabled={isStreaming}
                        className="chat-input w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto"
                      />
                      <div className="flex items-center justify-between px-2 pb-2">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setShowPromptLibrary(true)}
                            disabled={isStreaming}
                            className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Insert prompt from library"
                            aria-label="Insert prompt from library"
                          >
                            <NexyIcon name="prompt" className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => inputRef.current?.focus()}
                            onPaste={(e) => void handlePaste(e as unknown as React.ClipboardEvent<HTMLTextAreaElement>)}
                            disabled={isStreaming}
                            className={`p-1.5 rounded-md transition-colors ${
                              pendingImages.length > 0
                                ? 'text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30'
                                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            title="Paste image (Ctrl+V)"
                            aria-label="Paste image from clipboard"
                          >
                            <NexyIcon name="camera" className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
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
                            onClick={() => void sendMessage(inputText || (pendingImages.length > 0 ? 'Here is a screenshot for context.' : ''))}
                            disabled={isStreaming || (!inputText.trim() && pendingImages.length === 0)}
                            className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${
                              (inputText.trim() || pendingImages.length > 0) && !isStreaming
                                ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300'
                                : 'bg-transparent text-gray-400 dark:text-gray-500 cursor-not-allowed'
                            }`}
                            aria-label="Send message"
                          >
                            <NexyIcon name="send" className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {missedSpec && (
                      <p className="text-[10px] text-amber-500 mt-1.5 text-center">
                        No spec was generated — try asking me to configure the agent.
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

        {/* Creation progress overlay */}
        {isCreating && !isDone && (
          <CreationOverlay
            step={creationStep}
            error={creationError}
            onRetry={() => {
              if (spec) void handleCreate(spec)
            }}
          />
        )}

        {/* Done overlay with add-to-project option */}
        {isDone && (
          <DoneOverlay
            agentName={createdAgentName ?? ''}
            agentId={createdAgentId}
            projects={projects}
            activeProjectId={activeProjectId}
            onAddToProject={(projectId) => addAgentToProject(projectId, createdAgentId!)}
            onClose={() => {
              setIsDone(false)
              onClose()
            }}
            onGenerateAnother={() => {
              setIsDone(false)
              setCreatedAgentId(null)
              setCreatedAgentName(null)
              setCreationStep(-1)
              clearSession()
              setMessages([GREETING])
              setSpec(null)
              setMissedSpec(false)
              setInputText('')
              setPendingImages([])
            }}
          />
        )}
      </div>

      {showPromptLibrary && (
        <PromptLibraryModal
          projectId={null}
          draftContent={inputText}
          onInsert={(content) => {
            setInputText((prev) => prev ? `${prev}\n${content}` : content)
            inputRef.current?.focus()
          }}
          onRun={(content) => void sendMessage(content)}
          onClose={() => setShowPromptLibrary(false)}
        />
      )}
    </div>
  )
}
