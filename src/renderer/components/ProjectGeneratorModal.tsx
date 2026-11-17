import { sourceQualifiedModel } from '../../shared/models'
/* eslint-disable react-hooks/exhaustive-deps -- callbacks intentionally retain the run-start configuration. */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { StreamingFadeText } from './chat/StreamingFadeText'
import type { ProjectGeneratorSpec, ProjectGeneratorMessage, AvailableModelGroup, AvailableModelEntry } from '../../shared/types'
import { PromptLibraryModal } from './PromptLibraryModal'
import { ModelPicker } from './chat/ModelPicker'
import { VoiceInputButton } from './chat/VoiceInputButton'
import { Button } from './ui/primitives'
import { ResizableChatInput } from './chat/ResizableChatInput'
import { NexyIcon } from './ui/icons/NexyIcon'

// ─── Draft preview ────────────────────────────────────────────────────────────

const COLOR_DOT: Record<string, string> = {
  blue: 'bg-blue-500', green: 'bg-green-500', red: 'bg-red-500',
  purple: 'bg-purple-500', orange: 'bg-orange-500', pink: 'bg-pink-500',
  yellow: 'bg-yellow-400', gray: 'bg-gray-400',
}

function DraftPreview({ spec }: { spec: ProjectGeneratorSpec | null }) {
  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-nexy-muted select-none nexy-dither">
        <NexyIcon name="project" size={32} className="opacity-60" />
        <p className="text-xs text-center max-w-[160px]">
          Your project preview will appear here as the conversation progresses.
        </p>
      </div>
    )
  }

  const dot = COLOR_DOT[spec.color] ?? COLOR_DOT.blue

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full text-sm">
      {/* Name + color */}
      <div className="flex items-center gap-2">
        <span className={`w-3 h-3 rounded-none border border-nexy-border shrink-0 ${dot}`} />
        <span className="font-semibold text-nexy-text truncate">{spec.name}</span>
      </div>

      {(spec.sources?.length ?? 0) > 0 && (
        <div>
          <p className="nexy-status-label text-[10px] uppercase tracking-wide text-nexy-muted mb-1">Sources</p>
          <div className="space-y-1">
            {spec.sources!.map((source) => (
              <div key={source.key} className="rounded-nexy-sm border border-nexy-border bg-nexy-recessed px-2 py-1.5">
                <p className="text-xs font-medium text-nexy-text">{source.label}</p>
                <p className="text-[10px] font-mono text-nexy-muted truncate">{source.localPath ?? source.remoteUrl ?? 'Desktop setup required'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instructions excerpt */}
      {spec.instructions && (
        <div>
          <p className="nexy-status-label text-[10px] uppercase tracking-wide text-nexy-muted mb-1">Instructions</p>
          <p className="text-xs text-nexy-text line-clamp-4 whitespace-pre-wrap">{spec.instructions}</p>
        </div>
      )}

      {/* Scope */}
      {(spec.inScope.length > 0 || spec.outOfScope.length > 0) && (
        <div>
          <p className="nexy-status-label text-[10px] uppercase tracking-wide text-nexy-muted mb-1">Scope</p>
          <div className="space-y-0.5">
            {spec.inScope.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-green-500 text-[10px] mt-0.5 shrink-0">✓</span>
                <span className="text-xs text-nexy-text">{s.description}</span>
              </div>
            ))}
            {spec.outOfScope.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-red-400 text-[10px] mt-0.5 shrink-0">✕</span>
                <span className="text-xs text-nexy-muted">{s.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      {spec.milestones.length > 0 && (
        <div>
          <p className="nexy-status-label text-[10px] uppercase tracking-wide text-nexy-muted mb-1">
            Milestones ({spec.milestones.length})
          </p>
          <div className="space-y-0.5">
            {spec.milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-none border border-nexy-border shrink-0 ${m.status === 'active' ? 'bg-nexy-accent' : 'bg-nexy-recessed'}`} />
                <span className="text-xs text-nexy-text truncate">{m.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agents */}
      {spec.agents.length > 0 && (
        <div>
          <p className="nexy-status-label text-[10px] uppercase tracking-wide text-nexy-muted mb-1">
            Agent team ({spec.agents.length})
          </p>
          <div className="space-y-1.5">
            {spec.agents.map((agent, i) => (
              <div key={i} className="flex items-start gap-2 rounded-nexy-sm border border-nexy-border bg-nexy-recessed px-2.5 py-2">
                <span className="text-base leading-none mt-0.5">
                  {agent.newAgent?.icon ?? '🤖'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-nexy-text truncate">
                      {agent.newAgent?.name ?? agent.role}
                    </span>
                    {agent.isLeader && (
                      <NexyIcon name="rating" size={12} className="text-nexy-warning" />
                    )}
                    {!agent.existingAgentId && (
                      <span className="nexy-status-label text-[9px] px-1 py-0.5 rounded-nexy-sm border border-nexy-border bg-nexy-recessed text-nexy-accent font-medium shrink-0">
                        New
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-nexy-muted truncate">{agent.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Creation progress overlay ─────────────────────────────────────────────────

const CREATION_STEPS = [
  'Creating project…',
  'Updating project config…',
  'Creating agents…',
  'Adding agents to project…',
  'Setting lead agent…',
  'Enabling orchestration…',
] as const

function CreationOverlay({ step, error, onRetry }: { step: number; error: string | null; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 z-10 bg-nexy-raised/95 flex flex-col items-center justify-center gap-4 nexy-dither">
      {error ? (
        <>
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">Creation failed</p>
          <p className="text-xs text-nexy-muted max-w-sm text-center">{error}</p>
          <Button variant="primary" onClick={onRetry} className="text-sm">
            Try again
          </Button>
        </>
      ) : (
        <>
          <NexyIcon name="busy" size={24} className="text-nexy-accent" />
          <div className="space-y-1.5 text-left min-w-[200px]">
            {CREATION_STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                {i < step ? (
                  <span className="w-3.5 h-3.5 rounded-none border border-nexy-border bg-nexy-success flex items-center justify-center text-nexy-on-accent text-[8px]">✓</span>
                ) : i === step ? (
                  <NexyIcon name="busy" size={14} className="text-nexy-accent" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-none border-2 border-nexy-border" />
                )}
                <span className={`text-xs ${i === step ? 'text-nexy-text font-medium' : i < step ? 'text-nexy-muted line-through' : 'text-nexy-muted'}`}>
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

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const displayContent = content.replace(/<project-spec>[\s\S]*?<\/project-spec>/g, '').trim()
  if (!displayContent) return null

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-nexy-accent text-nexy-on-accent rounded-nexy-sm border-2 border-nexy-border px-3 py-2 text-sm whitespace-pre-wrap shadow-nexy">
          {displayContent}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2">
      <div className="w-6 h-6 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent flex items-center justify-center shrink-0 mt-0.5">
        <NexyIcon name="spark" size={12} className="text-nexy-on-accent" />
      </div>
      <div className="max-w-[85%] bg-nexy-recessed rounded-nexy-sm border border-nexy-border px-3 py-2 text-sm text-nexy-text whitespace-pre-wrap">
        <StreamingFadeText text={displayContent} />
      </div>
    </div>
  )
}

// ─── Session persistence (survives close/reopen within the same app session) ──

const GREETING: ProjectGeneratorMessage = {
  role: 'assistant',
  content: "Let's create a new project. Tell me what you're building or working on, and I'll help configure the perfect setup.",
}

interface GeneratorSession {
  messages: ProjectGeneratorMessage[]
  spec: ProjectGeneratorSpec | null
}

let _session: GeneratorSession | null = null

function getSession(): GeneratorSession {
  return _session ?? { messages: [GREETING], spec: null }
}

function saveSession(session: GeneratorSession) {
  _session = session
}

function clearSession() {
  _session = null
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function ProjectGeneratorModal({ onClose }: { onClose: () => void }) {
  const agents = useAppStore((s) => s.agents)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const createProject = useAppStore((s) => s.createProject)
  const updateProjectConfig = useAppStore((s) => s.updateProjectConfig)
  const setProjectDefaultModel = useAppStore((s) => s.setProjectDefaultModel)
  const loadAgents = useAppStore((s) => s.loadAgents)
  const loadProjectAgents = useAppStore((s) => s.loadProjectAgents)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const setProjectPrimaryAgent = useAppStore((s) => s.setProjectPrimaryAgent)
  const selectProject = useAppStore((s) => s.selectProject)
  const addToast = useAppStore((s) => s.addToast)
  const setShowNewProjectForm = useAppStore((s) => s.setShowNewProjectForm)
  const openEditProject = useAppStore((s) => s.openEditProject)

  const [messages, setMessages] = useState<ProjectGeneratorMessage[]>(() => getSession().messages)
  const [streamingText, setStreamingText] = useState('')
  const [inputText, setInputText] = useState('')
  const [spec, setSpec] = useState<ProjectGeneratorSpec | null>(() => getSession().spec)
  const [isStreaming, setIsStreaming] = useState(false)
  const [creationStep, setCreationStep] = useState<number>(-1)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [missedSpec, setMissedSpec] = useState(false)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [pendingImages, setPendingImages] = useState<{ id: string; dataUrl: string; name: string }[]>([])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const isCreating = creationStep >= 0

  const { scrollContainerRef, contentContainerRef, handleScrollContainerScroll } = useAutoScroll({
    isGenerating: isStreaming,
    contentSignal: `${messages.length}:${streamingText.length}`,
  })

  // Fetch available models on mount
  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  // Subscribe to IPC events
  useEffect(() => {
    const offToken = window.api.onProjectGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((prev) => prev + chunk)
    })
    const offSpec = window.api.onProjectGeneratorSpecReady((incoming) => {
      setSpec(incoming)
      setMissedSpec(false)
    })
    const offDone = window.api.onProjectGeneratorDone(({ hasSpec }) => {
      const capturedText = streamingTextRef.current
      const clean = capturedText.replace(/<project-spec>[\s\S]*?<\/project-spec>/g, '').trim()
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

  // Kick off the conversation with a first-turn empty user message if no messages yet
  const sendMessage = useCallback(async (userText: string) => {
    if (isStreaming || !userText.trim()) return

    const userMsg: ProjectGeneratorMessage = { role: 'user', content: userText.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInputText('')
    setIsStreaming(true)
    setStreamingText('')
    streamingTextRef.current = ''
    setMissedSpec(false)
    const imagesToSend = pendingImages.map(({ dataUrl }) => ({ dataUrl }))
    setPendingImages([])

    const agentSummaries = agents.map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      systemPrompt: a.systemPrompt,
    }))

    try {
      const result = await window.api.projectGeneratorChat(nextMessages, agentSummaries, genModel ?? undefined, imagesToSend.length > 0 ? imagesToSend : undefined)
      // safeHandle returns { error } instead of throwing — surface it
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get response'
      addToast(msg, 'error')
    } finally {
      setIsStreaming(false)
      setStreamingText('')
      streamingTextRef.current = ''
    }
  }, [isStreaming, messages, agents, addToast, genModel, pendingImages])

  // Ref written directly in the token handler — always current, no effect lag
  const streamingTextRef = useRef('')

  // Persist conversation across close/reopen
  useEffect(() => { saveSession({ messages, spec }) }, [messages, spec])

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'))
    if (items.length === 0) return
    e.preventDefault()
    for (const item of items) {
      const file = item.getAsFile()
      if (!file) continue
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      setPendingImages((prev) => [...prev, { id: crypto.randomUUID(), dataUrl, name: `image.${item.type.split('/')[1] ?? 'png'}` }])
    }
  }, [])

  const handlePasteClipboard = useCallback(async () => {
    const result = await window.api.readClipboardContent()
    if (!result) { addToast('No image found in clipboard', 'info'); return }
    if ('dataUrl' in result && result.dataUrl) {
      setPendingImages((prev) => [...prev, { id: crypto.randomUUID(), dataUrl: result.dataUrl as string, name: 'clipboard.png' }])
    } else {
      addToast('No image found in clipboard', 'info')
    }
  }, [addToast])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputText)
    }
  }

  const handleCreate = useCallback(async (specToCreate: ProjectGeneratorSpec, openForEdit = false) => {
    setCreationError(null)
    setCreationStep(0)
    const createdAgentIds: string[] = []
    let projectId: string | null = null

    try {
      // Step 0: create project
      await createProject(specToCreate.name, specToCreate.color)
      const project = useAppStore.getState().projects.find((p) => p.name === specToCreate.name)
      if (!project) throw new Error('Project was not found after creation')
      projectId = project.id

      // Step 1: update config
      setCreationStep(1)
      const attachableSources = specToCreate.sources?.filter((source) => source.mode === 'attach-existing' && source.localPath?.trim()) ?? []
      const compatibilityRoot = specToCreate.rootDirectory ?? attachableSources[0]?.localPath ?? ''
      await updateProjectConfig(projectId, {
        instructions: specToCreate.instructions,
        rootDirectory: compatibilityRoot,
        instructionMode: (specToCreate.instructionMode ?? 'prepend') as 'prepend' | 'append' | 'replace' | 'standalone',
        variables: specToCreate.variables,
        inScope: specToCreate.inScope.map((s, i) => ({ id: String(i), ...s })),
        outOfScope: specToCreate.outOfScope.map((s, i) => ({ id: String(i), ...s })),
        milestones: specToCreate.milestones.map((m, i) => ({ id: String(i), ...m })),
        instructionsEnabled: true,
        workflowMode: specToCreate.orchestrationEnabled ? 'orchestrated' : 'single-agent',
        orchestrationEnabled: specToCreate.orchestrationEnabled,
      })
      for (const source of attachableSources) {
        await window.api.addProjectSource(projectId, { label: source.label, localPath: source.localPath! })
      }

      // Step 2: create new agents
      setCreationStep(2)
      const agentIdByRole: Record<string, string> = {}
      for (const agentSpec of specToCreate.agents) {
        if (agentSpec.existingAgentId) {
          agentIdByRole[agentSpec.role] = agentSpec.existingAgentId
        } else if (agentSpec.newAgent) {
          const t = agentSpec.newAgent.tools
          const created = await window.api.createAgent({
            name: agentSpec.newAgent.name,
            icon: agentSpec.newAgent.icon,
            systemPrompt: agentSpec.newAgent.systemPrompt,
            temperature: agentSpec.newAgent.temperature,
            responseFormat: agentSpec.newAgent.responseFormat,
            maxTokens: 4096,
            contextDirectories: [],
            contextFiles: [],
            mcpServers: [],
            agenticMode: false,
            tools: {
              fileEdit: { enabled: t?.fileEdit ?? false, approval: 'always-ask', instructions: '' },
              terminal: { enabled: t?.terminal ?? false, approval: 'always-ask', instructions: '' },
              webFetch: { enabled: t?.webFetch ?? false, approval: 'always-ask', instructions: '' },
            },
          })
          agentIdByRole[agentSpec.role] = created.id
          createdAgentIds.push(created.id)
        }
      }

      // Step 3: add agents to project
      setCreationStep(3)
      for (const agentSpec of specToCreate.agents) {
        const agentId = agentIdByRole[agentSpec.role]
        if (agentId) await addAgentToProject(projectId, agentId)
      }

      // Step 4: set primary agent
      setCreationStep(4)
      const leaderSpec = specToCreate.agents.find((a) => a.isLeader)
      if (leaderSpec) {
        const leaderId = agentIdByRole[leaderSpec.role]
        if (leaderId) await setProjectPrimaryAgent(projectId, leaderId)
      }

      // Step 5: enable orchestration + default model
      setCreationStep(5)
      if (specToCreate.defaultModel) {
        await setProjectDefaultModel(projectId, specToCreate.defaultModel)
      }

      // Done — navigate to the new project
      await Promise.all([
        loadAgents(),
        loadProjectAgents(projectId),
      ])
      selectProject(projectId)
      clearSession()
      onClose()
      addToast(`Project "${specToCreate.name}" created`, 'success')

      if (openForEdit) {
        openEditProject(projectId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Creation failed'
      setCreationError(message)
      // Rollback: delete created agents and project
      for (const id of createdAgentIds) {
        await window.api.deleteAgent(id).catch(() => {})
      }
      if (projectId) {
        await window.api.deleteProject(projectId).catch(() => {})
      }
      setCreationStep(-1)
    }
  }, [createProject, updateProjectConfig, addAgentToProject, setProjectPrimaryAgent, loadAgents, loadProjectAgents, selectProject, onClose, addToast, openEditProject])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Generate new project"
    >
      <div className="relative bg-nexy-raised rounded-nexy-lg border-2 border-nexy-border shadow-nexy flex flex-col overflow-hidden"
        style={{ width: 'min(920px, 96vw)', height: 'min(680px, 90vh)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-nexy-border bg-nexy-surface shrink-0">
          <div className="flex items-center gap-2">
            <NexyIcon name="project" size={16} className="text-nexy-accent" />
            <h2 className="nexy-panel-title text-sm font-semibold text-nexy-text">New Project</h2>
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
                      setPendingImages([])
                      setGenModel(null)
                    }}
                    className="text-xs text-nexy-muted hover:text-nexy-text px-2 py-1 rounded-nexy-sm border border-transparent hover:border-nexy-border hover:bg-nexy-recessed transition-colors"
                  >
                    Start over
                  </button>
                )}
                <button
                  onClick={() => {
                    onClose()
                    setShowNewProjectForm(true)
                  }}
                  className="text-xs text-nexy-muted hover:text-nexy-text px-2 py-1 rounded-nexy-sm border border-transparent hover:border-nexy-border hover:bg-nexy-recessed transition-colors"
                >
                  Set up manually
                </button>
              </>
            )}
            <button
              onClick={onClose}
              disabled={isCreating && !creationError}
              className="text-nexy-muted hover:text-nexy-text p-1 rounded-nexy-sm border border-transparent hover:border-nexy-border hover:bg-nexy-recessed disabled:opacity-40"
              aria-label="Close"
            >
              <NexyIcon name="close" size={16} />
            </button>
          </div>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0 divide-x divide-gray-200 dark:divide-gray-700">
          {/* Left: draft preview (40%) */}
          <div className="relative" style={{ width: '38%' }}>
            <div className="absolute inset-0 overflow-hidden">
              <div className="px-3 py-2 border-b-2 border-nexy-border bg-nexy-surface shrink-0">
                <p className="nexy-status-label text-[10px] uppercase tracking-wider text-nexy-muted font-medium">Draft preview</p>
              </div>
              <div className="h-[calc(100%-33px)] overflow-hidden">
                <DraftPreview spec={spec} />
              </div>
            </div>
          </div>

          {/* Right: chat (60%) */}
          <div className="flex flex-col flex-1 min-w-0 relative">
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
                          <NexyIcon name="spark" size={12} className="text-nexy-on-accent" />
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2 bg-nexy-recessed rounded-nexy-sm border border-nexy-border">
                          <Loader2 className="w-3 h-3 text-nexy-accent animate-spin shrink-0" aria-hidden="true" />
                          <span className="text-xs text-nexy-muted">Generating project spec…</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Input / spec footer */}
                <div className="border-t-2 border-nexy-border bg-nexy-surface">
                  {spec && !isStreaming && (
                    <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                      <div className="flex-1 text-xs text-nexy-muted truncate">
                        <span className="text-green-600 dark:text-green-400 font-medium">Spec ready</span>
                        {' — '}{spec.agents.length} agent{spec.agents.length !== 1 ? 's' : ''}, {spec.milestones.length} milestone{spec.milestones.length !== 1 ? 's' : ''}
                      </div>
                      <button
                        onClick={() => handleCreate(spec, true)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-nexy-sm border-2 border-nexy-border text-xs text-nexy-text hover:bg-nexy-recessed transition-colors shadow-nexy"
                      >
                        <NexyIcon name="edit" size={12} />
                        Edit
                      </button>
                      <button
                        onClick={() => handleCreate(spec)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent hover:brightness-110 text-nexy-on-accent text-xs font-medium transition-colors shadow-nexy"
                      >
                        <NexyIcon name="add" size={14} />
                        Create project
                        <NexyIcon name="chevron-right" size={12} />
                      </button>
                    </div>
                  )}
                  <div className="px-4 pb-4 pt-2">
                    {pendingImages.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {pendingImages.map((img) => (
                          <div key={img.id} className="relative group">
                            <img
                              src={img.dataUrl}
                              alt={img.name}
                              className="w-14 h-14 object-cover rounded-nexy-sm border-2 border-nexy-border nexy-pixel-art"
                            />
                            <button
                              onClick={() => setPendingImages((prev) => prev.filter((i) => i.id !== img.id))}
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-none border border-nexy-border bg-nexy-text text-nexy-surface flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="Remove image"
                            >
                              <NexyIcon name="close" size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <ResizableChatInput
                      inputRef={inputRef}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onPaste={(e) => void handlePaste(e)}
                      placeholder={spec ? 'Refine or ask for changes…' : 'Describe your project… (paste images with Ctrl+V)'}
                      disabled={isStreaming}
                      aria-label="Project description"
                      leftActions={
                        <>
                          <button
                            type="button"
                            onClick={() => void handlePasteClipboard()}
                            disabled={isStreaming}
                            className="p-1.5 rounded-nexy-sm border border-transparent text-nexy-muted hover:text-nexy-text hover:border-nexy-border hover:bg-nexy-recessed disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Paste image from clipboard"
                            aria-label="Paste image from clipboard"
                          >
                            <NexyIcon name="clipboard" size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowPromptLibrary(true)}
                            disabled={isStreaming}
                            className="p-1.5 rounded-nexy-sm border border-transparent text-nexy-muted hover:text-nexy-text hover:border-nexy-border hover:bg-nexy-recessed disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Insert prompt from library"
                            aria-label="Insert prompt from library"
                          >
                            <NexyIcon name="prompt" size={16} />
                          </button>
                        </>
                      }
                      rightActions={
                        <>
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
                            onClick={() => {
                              if (spec) { setSpec(null) }
                              sendMessage(inputText)
                            }}
                            disabled={isStreaming || !inputText.trim()}
                            className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${
                              inputText.trim() && !isStreaming
                                ? 'border-nexy-border bg-nexy-text text-nexy-surface hover:brightness-110 shadow-nexy'
                                : 'border-transparent bg-transparent text-nexy-muted cursor-not-allowed'
                            }`}
                            aria-label="Send message"
                          >
                            <NexyIcon name="send" size={16} />
                          </button>
                        </>
                      }
                    />
                    {missedSpec && (
                      <p className="text-[10px] text-amber-500 mt-1.5 text-center">No spec was generated — try asking me to set up the project.</p>
                    )}
                    {!spec && !missedSpec && <p className="text-[10px] text-nexy-muted mt-1.5 text-center">Press Enter to send · Shift+Enter for newline</p>}
                  </div>
                </div>
          </div>
        </div>

        {/* Creation progress overlay */}
        {isCreating && (
          <CreationOverlay
            step={creationStep}
            error={creationError}
            onRetry={() => {
              if (spec) handleCreate(spec)
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
          onRun={(content) => sendMessage(content)}
          onClose={() => setShowPromptLibrary(false)}
        />
      )}
    </div>
  )
}
