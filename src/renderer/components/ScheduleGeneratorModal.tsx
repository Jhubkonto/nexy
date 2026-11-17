import { sourceQualifiedModel } from '../../shared/models'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app-store'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { StreamingFadeText } from './chat/StreamingFadeText'
import type { AvailableModelEntry, AvailableModelGroup, ScheduleGeneratorMessage, ScheduleGeneratorSpec, ScheduledTaskCreateInput, ScheduleType } from '../../shared/types'
import { ModelPicker } from './chat/ModelPicker'
import { PromptLibraryModal } from './PromptLibraryModal'
import { VoiceInputButton } from './chat/VoiceInputButton'
import { Button } from './ui/primitives'
import { NexyIcon } from './ui/icons/NexyIcon'

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const TIMEZONES = Array.from(new Set([DEFAULT_TIMEZONE, 'UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo']))
const SCHEDULE_TYPES: ScheduleType[] = ['one-time', 'daily', 'weekdays', 'weekly', 'monthly']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function specToTaskInput(spec: ScheduleGeneratorSpec): ScheduledTaskCreateInput {
  return {
    name: spec.name,
    prompt: spec.prompt,
    enabled: true,
    agentId: spec.agentId ?? null,
    projectId: spec.projectId ?? null,
    scheduleType: spec.scheduleType,
    localTime: spec.localTime,
    model: spec.model ?? null,
    weekday: spec.scheduleType === 'weekly' ? spec.weekday ?? 1 : null,
    monthDay: spec.scheduleType === 'monthly' ? spec.monthDay ?? 1 : null,
    timezone: spec.timezone,
    notificationPref: spec.notificationPref,
    toolPolicy: spec.preApproved && spec.preApproved.length > 0 ? { preApproved: spec.preApproved } : undefined,
  }
}

function stripSpec(content: string): string {
  return content.replace(/<schedule-spec>[\s\S]*?<\/schedule-spec>/g, '').trim()
}

function DraftPreview({ spec }: { spec: ScheduleGeneratorSpec | null }) {
  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-gray-500 select-none">
        <NexyIcon name="scheduled" className="w-8 h-8 opacity-40" />
        <p className="text-xs text-center max-w-[170px]">Your schedule preview will appear here as the conversation progresses.</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full text-sm">
      <div className="flex items-center gap-2">
        <NexyIcon name="scheduled" className="w-5 h-5 text-nexy-accent shrink-0" />
        <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{spec.name}</span>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Prompt</p>
        <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{spec.prompt || 'No prompt yet'}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-2 py-1.5">
          <p className="text-[10px] text-gray-400">Type</p>
          <p className="text-gray-700 dark:text-gray-200 capitalize">{spec.scheduleType.replace('-', ' ')}</p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-2 py-1.5">
          <p className="text-[10px] text-gray-400">Time</p>
          <p className="text-gray-700 dark:text-gray-200">{spec.localTime}</p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-2 py-1.5 col-span-2">
          <p className="text-[10px] text-gray-400">Timezone</p>
          <p className="text-gray-700 dark:text-gray-200 truncate">{spec.timezone}</p>
        </div>
      </div>
      {spec.scheduleType === 'weekly' && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Every {WEEKDAYS[spec.weekday ?? 1]}</p>
      )}
      {spec.scheduleType === 'monthly' && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Day {spec.monthDay ?? 1} of each month</p>
      )}
      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        {spec.agentId && <p>Agent: {spec.agentId}</p>}
        {spec.projectId && <p>Project: {spec.projectId}</p>}
        <p>Notifications: {spec.notificationPref.replace('_', ' ')}</p>
      </div>
    </div>
  )
}

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const displayContent = stripSpec(content)
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
        <NexyIcon name="scheduled" className="w-3 h-3 text-white" />
      </div>
      <div className="max-w-[85%] bg-nexy-recessed rounded-nexy-sm border border-nexy-border px-3 py-2 text-sm text-nexy-text whitespace-pre-wrap">
        <StreamingFadeText text={displayContent} />
      </div>
    </div>
  )
}

const GREETING: ScheduleGeneratorMessage = {
  role: 'assistant',
  content: "Let's create a scheduled task. Tell me what should run, when it should run, and whether it should use a project or agent.",
}

interface ScheduleGeneratorSession {
  messages: ScheduleGeneratorMessage[]
  spec: ScheduleGeneratorSpec | null
}

let _session: ScheduleGeneratorSession | null = null
const getSession = () => _session ?? { messages: [GREETING], spec: null }
const saveSession = (session: ScheduleGeneratorSession) => { _session = session }
const clearSession = () => { _session = null }

function EditForm({ spec, onChange, onConfirm, onCancel }: {
  spec: ScheduleGeneratorSpec
  onChange: (spec: ScheduleGeneratorSpec) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const set = (patch: Partial<ScheduleGeneratorSpec>) => onChange({ ...spec, ...patch })

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Task</p>
          <input value={spec.name} onChange={(e) => set({ name: e.target.value })} placeholder="Task name" className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          <textarea value={spec.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="Prompt to run..." rows={5} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none" />
        </section>
        <section className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Type</span>
            <select value={spec.scheduleType} onChange={(e) => set({ scheduleType: e.target.value as ScheduleType })} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
              {SCHEDULE_TYPES.map((type) => <option key={type} value={type}>{type.replace('-', ' ')}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Time</span>
            <input type="time" value={spec.localTime} onChange={(e) => set({ localTime: e.target.value })} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
          </label>
          {spec.scheduleType === 'weekly' && (
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Weekday</span>
              <select value={spec.weekday ?? 1} onChange={(e) => set({ weekday: Number(e.target.value) })} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                {WEEKDAYS.map((day, idx) => <option key={day} value={idx}>{day}</option>)}
              </select>
            </label>
          )}
          {spec.scheduleType === 'monthly' && (
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Month day</span>
              <input type="number" min={1} max={31} value={spec.monthDay ?? 1} onChange={(e) => set({ monthDay: Number(e.target.value) })} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </label>
          )}
          <label className="space-y-1 col-span-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Timezone</span>
            <select value={spec.timezone} onChange={(e) => set({ timezone: e.target.value })} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Agent</span>
            <select value={spec.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || undefined })} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
              <option value="">None</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Project</span>
            <select value={spec.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || undefined })} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
              <option value="">None</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </section>
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Notifications</p>
          {(['always', 'failures_only', 'off'] as const).map((pref) => (
            <label key={pref} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <input type="radio" checked={spec.notificationPref === pref} onChange={() => set({ notificationPref: pref })} />
              {pref.replace('_', ' ')}
            </label>
          ))}
        </section>
      </div>
      <div className="px-4 pb-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
        <Button variant="secondary" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400">Back</Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={!spec.name.trim() || !spec.prompt.trim()}
          className="gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition-colors ml-auto"
        >
          <NexyIcon name="spark" className="w-3.5 h-3.5" />
          Create task
        </Button>
      </div>
    </div>
  )
}

function CreationOverlay() {
  return (
    <div className="absolute inset-0 z-10 bg-white/90 dark:bg-gray-900/90 flex flex-col items-center justify-center gap-3">
      <NexyIcon name="busy" className="w-6 h-6 text-nexy-accent" />
      <p className="text-xs text-gray-500 dark:text-gray-400">Creating scheduled task...</p>
    </div>
  )
}

export function ScheduleGeneratorModal({ onClose }: { onClose: () => void }) {
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const addToast = useAppStore((s) => s.addToast)
  const setSchedulerTasks = useAppStore((s) => s.setSchedulerTasks)
  const openCreateSchedulerTask = useAppStore((s) => s.openCreateSchedulerTask)
  const [messages, setMessages] = useState<ScheduleGeneratorMessage[]>(() => getSession().messages)
  const [streamingText, setStreamingText] = useState('')
  const [inputText, setInputText] = useState('')
  const [spec, setSpec] = useState<ScheduleGeneratorSpec | null>(() => getSession().spec)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editSpec, setEditSpec] = useState<ScheduleGeneratorSpec | null>(null)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [missedSpec, setMissedSpec] = useState(false)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [creationStep, setCreationStep] = useState<string | null>(null)
  const [creationError, setCreationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')
  const requestInFlightRef = useRef(false)

  const { scrollContainerRef, contentContainerRef, handleScrollContainerScroll } = useAutoScroll({
    isGenerating: isStreaming,
    contentSignal: `${messages.length}:${streamingText.length}`,
  })

  useEffect(() => { window.api.listAvailableModels().then(setAvailableGroups).catch(() => {}) }, [])
  useEffect(() => { saveSession({ messages, spec }) }, [messages, spec])

  useEffect(() => {
    const offToken = window.api.onScheduleGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((prev) => prev + chunk)
    })
    const offSpec = window.api.onScheduleGeneratorSpecReady((incoming) => {
      setSpec(incoming)
      setMissedSpec(false)
    })
    const offDone = window.api.onScheduleGeneratorDone(({ hasSpec }) => {
      const clean = stripSpec(streamingTextRef.current)
      if (clean) setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      if (!hasSpec && !clean) {
        setMissedSpec(true)
        addToast('Schedule generator returned no response. Choose a different model or try again.', 'error')
      }
    })
    return () => { offToken(); offSpec(); offDone() }
  }, [addToast])

  const sendMessage = useCallback(async (userText: string) => {
    if (requestInFlightRef.current || isStreaming || !userText.trim()) return
    requestInFlightRef.current = true
    const userMsg: ScheduleGeneratorMessage = { role: 'user', content: userText.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInputText('')
    setIsStreaming(true)
    setStreamingText('')
    streamingTextRef.current = ''
    setMissedSpec(false)
    try {
      const result = await window.api.scheduleGeneratorChat(nextMessages, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) throw new Error(String((result as { error: unknown }).error))
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to get response', 'error')
    } finally {
      requestInFlightRef.current = false
      setIsStreaming(false)
      setStreamingText('')
      streamingTextRef.current = ''
    }
  }, [addToast, genModel, isStreaming, messages])

  const refreshTasks = useCallback(async () => {
    const result = await window.api.schedulerList()
    if (result && typeof result === 'object' && 'error' in result) throw new Error(String((result as { error: unknown }).error))
    setSchedulerTasks(result)
  }, [setSchedulerTasks])

  const handleCreate = useCallback(async (target: ScheduleGeneratorSpec) => {
    setCreationStep('Creating scheduled task')
    setCreationError(null)
    try {
      const result = await window.api.schedulerCreate(specToTaskInput(target))
      if (result && typeof result === 'object' && 'error' in result) throw new Error(String((result as { error: unknown }).error))
      await refreshTasks()
      clearSession()
      onClose()
      addToast(`Scheduled task "${target.name}" created`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create scheduled task'
      setCreationError(message)
      addToast(message, 'error')
    } finally {
      setCreationStep(null)
    }
  }, [addToast, onClose, refreshTasks])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(inputText)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Generate scheduled task">
      <div className="nexy-generator-shell relative bg-nexy-raised border-2 border-nexy-border rounded-nexy-lg shadow-nexy flex flex-col overflow-hidden" style={{ width: 'min(860px, 96vw)', height: 'min(640px, 90vh)' }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-nexy-border bg-nexy-surface shrink-0">
          <div className="flex items-center gap-2">
            <NexyIcon name="scheduled" className="w-4 h-4 text-nexy-accent" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New Schedule</h2>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && !creationStep && (
              <>
                {messages.length > 1 && (
                  <Button
                    variant="ghost"
                    onClick={() => { clearSession(); setMessages([GREETING]); setSpec(null); setMissedSpec(false); setInputText(''); setGenModel(null) }}
                    className="px-2 py-1 rounded transition-colors"
                  >
                    Start over
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => { onClose(); openCreateSchedulerTask() }}
                  className="px-2 py-1 rounded transition-colors"
                >
                  Set up manually
                </Button>
              </>
            )}
            <button onClick={onClose} disabled={!!creationStep} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40" aria-label="Close">
              <NexyIcon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-1 min-h-0 divide-x divide-gray-200 dark:divide-gray-700">
          <div className="relative" style={{ width: '38%' }}>
            <div className="absolute inset-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Draft preview</p>
              </div>
              <div className="h-[calc(100%-33px)] overflow-hidden">
                <DraftPreview spec={isEditing ? editSpec : spec} />
              </div>
            </div>
          </div>
          <div className="flex flex-col flex-1 min-w-0 relative">
            {creationStep && <CreationOverlay />}
            {isEditing && editSpec ? (
              <EditForm spec={editSpec} onChange={setEditSpec} onConfirm={() => void handleCreate(editSpec)} onCancel={() => setIsEditing(false)} />
            ) : (
              <>
                <div ref={scrollContainerRef} onScroll={handleScrollContainerScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  <div ref={contentContainerRef} className="space-y-3">
                    {messages.map((msg, i) => <ChatBubble key={i} role={msg.role} content={msg.content} />)}
                    {isStreaming && streamingText && <ChatBubble role="assistant" content={streamingText} />}
                    {isStreaming && !streamingText && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent flex items-center justify-center shrink-0">
                          <NexyIcon name="scheduled" className="w-3 h-3 text-white" />
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2 bg-nexy-recessed rounded-nexy-sm border border-nexy-border">
                          <NexyIcon name="busy" className="w-3 h-3 text-nexy-accent shrink-0" />
                          <span className="text-xs text-gray-500 dark:text-gray-400">Generating schedule spec...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="border-t border-gray-100 dark:border-gray-800">
                  {spec && !isStreaming && (
                    <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                      <div className="flex-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                        <span className="text-green-600 dark:text-green-400 font-medium">Spec ready</span>
                        {' - '}{spec.name}
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => { setEditSpec({ ...spec }); setIsEditing(true) }}
                        className="gap-1 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <NexyIcon name="edit" className="w-3 h-3" />
                        Edit
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => void handleCreate(spec)}
                        className="gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition-colors"
                      >
                        <NexyIcon name="spark" className="w-3.5 h-3.5" />
                        Create task
                      </Button>
                    </div>
                  )}
                  {creationError && <p className="px-4 pt-2 text-[10px] text-red-500">{creationError}</p>}
                  <div className="px-4 pb-4 pt-2">
                    <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed focus-within:ring-2 focus-within:ring-nexy-accent transition-colors shadow-nexy">
                      <textarea ref={inputRef} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} placeholder={spec ? 'Refine or ask for changes...' : 'Describe your schedule...'} rows={1} disabled={isStreaming} className="chat-input w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto" />
                      <div className="flex items-center justify-between px-2 pb-2">
                        <button type="button" onClick={() => setShowPromptLibrary(true)} disabled={isStreaming} className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" title="Insert prompt from library" aria-label="Insert prompt from library">
                          <NexyIcon name="prompt" className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-1">
                          <ModelPicker value={genModel ?? 'default'} availableGroups={availableGroups} catalogModels={catalogModels} globalDefaultModel={globalDefaultModel ?? undefined} includeDefault={true} buttonRef={modelPickerRef} onSelectDefault={() => setGenModel(null)} onSelectAvailableModel={(group: AvailableModelGroup, model: AvailableModelEntry) => setGenModel(sourceQualifiedModel(group.sourceKey, model.id))} />
                          <VoiceInputButton disabled={isStreaming} onText={(text) => setInputText((current) => current.trim() ? `${current.trimEnd()} ${text}` : text)} />
                          <button type="button" onClick={() => void sendMessage(inputText)} disabled={isStreaming || !inputText.trim()} className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${inputText.trim() && !isStreaming ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300' : 'bg-transparent text-gray-400 dark:text-gray-500 cursor-not-allowed'}`} aria-label="Send message">
                            <NexyIcon name="send" className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {missedSpec && <p className="text-[10px] text-amber-500 mt-1.5 text-center">No spec was generated - try asking me to configure the schedule.</p>}
                    {!spec && !missedSpec && <p className="text-[10px] text-gray-400 mt-1.5 text-center">Press Enter to send · Shift+Enter for newline</p>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {showPromptLibrary && (
        <PromptLibraryModal
          projectId={null}
          draftContent={inputText}
          onInsert={(content) => { setInputText((prev) => prev ? `${prev}\n${content}` : content); inputRef.current?.focus() }}
          onRun={(content) => void sendMessage(content)}
          onClose={() => setShowPromptLibrary(false)}
        />
      )}
    </div>
  )
}
