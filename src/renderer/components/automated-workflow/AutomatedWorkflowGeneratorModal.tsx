import { sourceQualifiedModel } from '../../../shared/models'
import { useEffect, useRef, useState } from 'react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  AutomatedWorkflowGeneratorMessage,
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowSpec,
  AutomatedWorkflowStep,
  WorkflowSourceOption,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { ModelPicker } from '../chat/ModelPicker'
import { VoiceInputButton } from '../chat/VoiceInputButton'
import { DropdownPanel } from '../DropdownPanel'
import { clearAutomatedWorkflowGeneration, trackAutomatedWorkflowGeneration } from '../BackgroundActivityBridges'
import { ChatBubble, stripSpecTags, WORKFLOW_STAGES } from './AutomatedWorkflowShared'
import { NexyIcon } from '../ui/icons/NexyIcon'

interface AutomatedWorkflowGeneratorModalProps {
  /** null generates a standalone, project-less workflow; a project id scopes generation to that
   *  project's context (its agents apply as candidates, its variables can be inserted). */
  projectId: string | null
  /** Shown in the header when generating for a project — omit for the global/standalone entry point. */
  projectName?: string
  /** Only offered when generating for a project — matches the project-scoped tab's existing
   *  variable-insertion capability; a project-less plan has no project variables to offer. */
  projectVariables?: { key: string; value: string }[]
  onClose: () => void
  onCreated: (run: AutomatedWorkflowRunDetail) => void
}

const MANAGED_WORKFLOW_STARTERS = [
  { label: 'Weekly report', prompt: 'Create a weekly report workflow from selected project notes. Let me review the Markdown draft, then publish it to reports/weekly.md.' },
  { label: 'Release notes', prompt: 'Create release notes from selected changelog and project files. Let me edit and approve the Markdown, then publish it to RELEASE_NOTES.md.' },
  { label: 'Design draft', prompt: 'Create a design document from selected requirements. Include a review step, then publish the approved Markdown to docs/design.md.' },
] as const

// Same overlay/modal chrome as every other AI generator (ScheduleGeneratorModal, SkillGeneratorModal,
// AgentGeneratorModal, ArtifactGeneratorModal) — the automated workflow generator was previously
// embedded inline inside its host pane's content area instead of using this established pattern.
export function AutomatedWorkflowGeneratorModal({
  projectId,
  projectName,
  projectVariables = [],
  onClose,
  onCreated,
}: AutomatedWorkflowGeneratorModalProps) {
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const addToast = useAppStore((s) => s.addToast)
  const authState = useAppStore((s) => s.authState)
  const hasGeneratorBackend = authState.authenticated || authState.cliInstalled

  const [messages, setMessages] = useState<AutomatedWorkflowGeneratorMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [missedSpec, setMissedSpec] = useState(false)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [showVariablePicker, setShowVariablePicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sourceOptions, setSourceOptions] = useState<WorkflowSourceOption[]>([])
  // The plan generated so far, already persisted as a 'pending' run — kept open (not committed
  // to the caller) so the user can keep chatting to refine it. Each subsequent spec-ready updates
  // this same run in place rather than creating a new one, as long as it's still all-pending
  // (nothing started yet) — mirrors the pre-modal inline generator's exact reuse/branch logic.
  const [savedRun, setSavedRun] = useState<AutomatedWorkflowRunDetail | null>(null)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const variablePickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')
  const genModelRef = useRef<string | null>(null)
  const savedRunRef = useRef<AutomatedWorkflowRunDetail | null>(null)
  genModelRef.current = genModel
  savedRunRef.current = savedRun

  const { scrollContainerRef, contentContainerRef, handleScrollContainerScroll } = useAutoScroll({
    isGenerating,
    contentSignal: `${messages.length}:${streamingText.length}:${saving ? 1 : 0}`,
  })

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  useEffect(() => {
    if (!projectId) { setSourceOptions([]); return }
    window.api.listManagedWorkflowSources(projectId).then((result) => {
      if (!isApiError(result)) setSourceOptions(result)
    }).catch(() => setSourceOptions([]))
  }, [projectId])

  const updateManagedStep = async (stepId: string, update: (step: AutomatedWorkflowStep) => AutomatedWorkflowStep) => {
    const current = savedRunRef.current
    if (!current || saving) return
    const steps = current.steps.map((step): AutomatedWorkflowStep => {
      const specStep: AutomatedWorkflowStep = {
        id: step.id, kind: step.kind, title: step.title, summary: step.summary,
        agentId: step.agentId, agentName: step.agentName, model: step.model,
        prompt: step.prompt, expectedOutput: step.expectedOutput,
        dependsOnStepIds: step.dependsOnStepIds, inputBindings: step.inputBindings,
        deliverables: step.deliverables, reviewSource: step.reviewSource,
        publishDestination: step.publishDestination,
        includeProjectInstructions: step.includeProjectInstructions,
      }
      return step.id === stepId ? update(specStep) : specStep
    })
    setSaving(true)
    try {
      const result = await window.api.saveAutomatedWorkflowRunFromSpec(projectId, {
        title: current.title, goalSummary: current.goalSummary, assumptions: current.assumptions, steps,
      }, genModelRef.current, current.id)
      if (!isApiError(result)) setSavedRun(result)
      else throw new Error(result.error)
    } catch (error) { addToast(error instanceof Error ? error.message : 'Failed to update workflow', 'error') }
    finally { setSaving(false) }
  }

  useEffect(() => {
    const offToken = window.api.onAutomatedWorkflowGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((current) => current + chunk)
    })
    const offSpec = window.api.onAutomatedWorkflowGeneratorSpecReady(async (incoming: AutomatedWorkflowSpec) => {
      setMissedSpec(false)
      setSaving(true)
      const current = savedRunRef.current
      const reuseId = current && current.steps.every((s) => s.status === 'pending') ? current.id : null
      try {
        const saved = await window.api.saveAutomatedWorkflowRunFromSpec(projectId, incoming, genModelRef.current, reuseId)
        if (saved && !isApiError(saved)) setSavedRun(saved)
      } catch (error) {
        addToast(error instanceof Error ? error.message : 'Failed to save workflow plan', 'error')
      } finally {
        setSaving(false)
      }
    })
    const offDone = window.api.onAutomatedWorkflowGeneratorDone(({ hasSpec }) => {
      clearAutomatedWorkflowGeneration(projectId)
      const clean = stripSpecTags(streamingTextRef.current)
      if (clean) setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      setIsGenerating(false)
      setStreamingText('')
      streamingTextRef.current = ''
      if (!hasSpec && !clean) setMissedSpec(true)
    })
    return () => { offToken(); offSpec(); offDone() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectId/genModel read via refs/closure at effect-registration time is fine here; addToast/onClose/onCreated are stable from the caller
  }, [projectId])

  const sendMessage = async (userText: string) => {
    const trimmed = userText.trim()
    if (!trimmed || isGenerating) return
    const nextMessages: AutomatedWorkflowGeneratorMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setInputText('')
    setIsGenerating(true)
    trackAutomatedWorkflowGeneration(projectId)
    setMissedSpec(false)
    setStreamingText('')
    streamingTextRef.current = ''
    try {
      const result = await window.api.automatedWorkflowGeneratorChat(projectId, nextMessages, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (error) {
      setIsGenerating(false)
      addToast(error instanceof Error ? error.message : 'Failed to generate workflow', 'error')
    } finally {
      clearAutomatedWorkflowGeneration(projectId)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(inputText)
    }
  }

  const handleInsertVariable = (key: string) => {
    setInputText((current) => `${current}{{${key}}}`)
    setShowVariablePicker(false)
  }

  const handleStartOver = () => {
    clearAutomatedWorkflowGeneration(projectId)
    setMessages([])
    setInputText('')
    setStreamingText('')
    streamingTextRef.current = ''
    setMissedSpec(false)
    setSavedRun(null)
    setGenModel(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Generate automated workflow">
      <div className="relative flex flex-col overflow-hidden rounded-nexy-lg border-2 border-nexy-border bg-nexy-raised shadow-nexy" style={{ width: 'min(720px, 96vw)', height: 'min(640px, 90vh)' }}>
        <div className="flex shrink-0 items-center justify-between border-b-2 border-nexy-border bg-nexy-surface px-5 py-3.5">
          <div className="flex items-center gap-2 min-w-0">
            <NexyIcon name="workflow" className="h-4 w-4 shrink-0 text-nexy-accent" />
            <h2 className="nexy-font-panel truncate text-nexy-text">
              {projectName ? `New Workflow — ${projectName}` : 'New Standalone Workflow'}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleStartOver}
                disabled={isGenerating || saving}
                className="rounded-nexy-sm border border-transparent px-2 py-1 text-xs text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start over
              </button>
            )}
            <button onClick={onClose} className="rounded-nexy-sm border border-transparent p-1 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text" aria-label="Close">
              <NexyIcon name="close" className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pt-3 shrink-0 space-y-1.5">
          <p className="text-[11px] text-nexy-muted">
            {projectId
              ? 'Describe the project goal or milestone you want the team to execute. The planner assigns each step to one of the project\'s agents (that agent\'s own skills apply) or a plain model — whichever fits the step best.'
              : 'Describe a goal. This plan has no project, but the planner can still assign steps to any of your existing agents (that agent\'s own skills apply) or a plain model — whichever fits the step best.'}
          </p>
          {!hasGeneratorBackend && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              No provider or supported CLI backend is configured. Add an API key or install a CLI backend in Settings before generating a workflow.
            </p>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-5 py-3 gap-3">
          <div
            ref={scrollContainerRef}
            onScroll={handleScrollContainerScroll}
            className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-3 py-2"
          >
            <div ref={contentContainerRef} className="space-y-2">
              {messages.length === 0 && !isGenerating && (
                <div className="flex h-full select-none flex-col items-center justify-center gap-3 px-4 text-nexy-muted">
                  <p className="nexy-font-status max-w-[260px] text-center text-nexy-muted">How it works:</p>
                  <div className="space-y-1.5 text-left w-full max-w-[280px]">
                    {WORKFLOW_STAGES.map(({ icon, label }, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <NexyIcon name={icon} className="w-3.5 h-3.5 shrink-0 text-nexy-muted" />
                        <span className="text-[11px] text-nexy-muted">{label}</span>
                      </div>
                    ))}
                  </div>
                  {projectId && (
                    <div className="flex max-w-[360px] flex-wrap justify-center gap-1.5" aria-label="Managed workflow starters">
                      {MANAGED_WORKFLOW_STARTERS.map((starter) => (
                        <button key={starter.label} type="button" onClick={() => setInputText(starter.prompt)}
                          className="rounded-nexy-sm border border-nexy-border bg-nexy-raised px-2 py-1 text-[10px] text-nexy-text hover:border-nexy-accent hover:text-nexy-accent">
                          {starter.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {messages.map((msg, i) => <ChatBubble key={i} role={msg.role} content={msg.content} />)}
              {isGenerating && streamingText && <ChatBubble role="assistant" content={streamingText} />}
              {isGenerating && !streamingText && (
                <div className="flex items-center gap-2 text-[11px] text-nexy-activity">
                  <NexyIcon name="busy" className="h-3.5 w-3.5" />
                  Generating…
                </div>
              )}
              {saving && (
                <div className="flex items-center gap-2 text-[11px] text-nexy-activity">
                  <NexyIcon name="busy" className="h-3.5 w-3.5" />
                  Saving plan…
                </div>
              )}
            </div>
          </div>

          {savedRun && !isGenerating && (
            <div className="shrink-0 space-y-2 rounded-nexy-sm border-2 border-nexy-success bg-nexy-recessed px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-nexy-success">Plan ready: {savedRun.title}</p>
                  <p className="text-[10px] text-nexy-muted">Review what Nexy will read, create, ask you to approve, and write.</p>
                </div>
                <button type="button" onClick={() => { onCreated(savedRun); onClose() }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-nexy-sm border-2 border-nexy-success bg-nexy-success px-2.5 py-1.5 text-[11px] font-medium text-white shadow-nexy-sm">
                  Use this plan
                </button>
              </div>
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {savedRun.steps.map((step) => (
                  <div key={step.dbId} className="rounded-nexy-sm border border-nexy-border bg-nexy-raised p-2 text-[10px]">
                    <p className="font-semibold text-nexy-text">{step.stepIndex + 1}. {step.kind ? `${step.kind[0].toUpperCase()}${step.kind.slice(1)}` : 'Model'} — {step.title}</p>
                    {step.kind === 'collect' && (step.inputBindings ?? []).map((binding) => binding.source.type === 'project-files' && (
                      <div key={binding.bindingId} className="mt-1 grid grid-cols-[110px_1fr] gap-1">
                        <select aria-label={`Source for ${step.title}`} value={binding.source.projectSourceId}
                          onChange={(event) => void updateManagedStep(step.id, (draft) => ({ ...draft,
                            inputBindings: (draft.inputBindings ?? []).map((item) => item.bindingId === binding.bindingId && item.source.type === 'project-files'
                              ? { ...item, source: { ...item.source, projectSourceId: event.target.value } } : item),
                          }))}
                          className="border border-nexy-border bg-nexy-recessed px-1 text-nexy-text">
                          {[...new Map(sourceOptions.map((option) => [option.projectSourceId, option.label])).entries()].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                        <input aria-label={`Files for ${step.title}`} defaultValue={binding.source.include.join(', ')}
                          onBlur={(event) => void updateManagedStep(step.id, (draft) => ({ ...draft,
                            inputBindings: (draft.inputBindings ?? []).map((item) => item.bindingId === binding.bindingId && item.source.type === 'project-files'
                              ? { ...item, source: { ...item.source, include: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } } : item),
                          }))}
                          className="border border-nexy-border bg-nexy-recessed px-1 font-mono text-nexy-text" />
                      </div>
                    ))}
                    {step.kind === 'model' && <p className="mt-0.5 text-nexy-muted">Creates {step.deliverables?.[0]?.title ?? step.expectedOutput} from {(step.inputBindings ?? []).map((binding) => binding.bindingId).join(', ') || 'declared inputs'}.</p>}
                    {step.kind === 'review' && <p className="mt-0.5 text-nexy-muted">You edit and approve {step.reviewSource?.outputName ?? 'the deliverable'}.</p>}
                    {step.kind === 'publish' && step.publishDestination && (
                      <div className="mt-1 grid grid-cols-[110px_1fr] gap-1">
                        <select aria-label={`Publish source for ${step.title}`} value={step.publishDestination.projectSourceId}
                          onChange={(event) => void updateManagedStep(step.id, (draft) => ({ ...draft,
                            publishDestination: draft.publishDestination ? { ...draft.publishDestination, projectSourceId: event.target.value } : undefined,
                          }))}
                          className="border border-nexy-border bg-nexy-recessed px-1 text-nexy-text">
                          {[...new Map(sourceOptions.map((option) => [option.projectSourceId, option.label])).entries()].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                        <input aria-label={`Destination for ${step.title}`} defaultValue={step.publishDestination.relativePath}
                          onBlur={(event) => void updateManagedStep(step.id, (draft) => ({ ...draft,
                            publishDestination: draft.publishDestination ? { ...draft.publishDestination, relativePath: event.target.value.trim() } : undefined,
                          }))}
                          className="border border-nexy-border bg-nexy-recessed px-1 font-mono text-nexy-text" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="shrink-0 rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised focus-within:border-nexy-accent focus-within:ring-1 focus-within:ring-nexy-accent">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              disabled={isGenerating || saving}
              placeholder={messages.length > 0 ? 'Reply to refine the workflow…' : 'Describe the goal you want a step-by-step plan for.'}
              className="w-full resize-none bg-transparent px-2.5 pb-1.5 pt-2 text-xs text-nexy-text focus:outline-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2 border-t-2 border-nexy-border px-2 pb-2 pt-1">
              <div className="flex items-center gap-0.5">
                {projectId && (
                  <DropdownPanel
                    open={showVariablePicker}
                    onClose={() => setShowVariablePicker(false)}
                    align="left"
                    width="w-56"
                    trigger={
                      <button
                        type="button"
                        ref={variablePickerRef}
                        onClick={() => setShowVariablePicker((v) => !v)}
                        disabled={projectVariables.length === 0}
                        title={projectVariables.length === 0 ? 'No project variables defined (Settings → General)' : 'Insert a project variable'}
                        className="rounded-nexy-sm border border-transparent p-1.5 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Insert project variable"
                      >
                        <NexyIcon name="prompt" className="h-4 w-4" />
                      </button>
                    }
                  >
                    <div className="max-h-48 overflow-y-auto py-1">
                      {projectVariables.length === 0 ? (
                        <p className="px-3 py-2 text-[10px] italic text-nexy-muted">No project variables defined</p>
                      ) : projectVariables.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => handleInsertVariable(v.key)}
                          className="flex w-full flex-col px-3 py-1.5 text-left text-xs text-nexy-text hover:bg-nexy-recessed"
                        >
                          <span className="font-mono">{`{{${v.key}}}`}</span>
                          <span className="truncate text-[10px] text-nexy-muted">{v.value}</span>
                        </button>
                      ))}
                    </div>
                  </DropdownPanel>
                )}
                <ModelPicker
                  value={genModel ?? 'default'}
                  availableGroups={availableGroups}
                  catalogModels={catalogModels}
                  globalDefaultModel={globalDefaultModel ?? undefined}
                  includeDefault={true}
                  buttonRef={modelPickerRef}
                  buttonClassName="flex max-w-[120px] items-center gap-1 rounded-nexy-sm border border-transparent px-1.5 py-1 text-[11px] text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text"
                  onSelectDefault={() => setGenModel(null)}
                  onSelectAvailableModel={(group: AvailableModelGroup, model: AvailableModelEntry) => {
                    const id = sourceQualifiedModel(group.sourceKey, model.id)
                    setGenModel(id)
                  }}
                />
                <VoiceInputButton disabled={isGenerating} onText={(text) => setInputText((current) => current.trim() ? `${current.trimEnd()} ${text}` : text)} />
              </div>
              <button
                type="button"
                onClick={() => void sendMessage(inputText)}
                disabled={isGenerating || saving || !inputText.trim() || !hasGeneratorBackend}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-nexy-sm border-2 border-nexy-accent bg-nexy-accent px-2.5 py-1.5 text-[11px] font-medium text-white shadow-nexy-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <NexyIcon name={isGenerating ? 'busy' : 'spark'} className="h-3.5 w-3.5" />
                {messages.length > 0 ? 'Send' : 'Generate workflow'}
              </button>
            </div>
          </div>
          {missedSpec && (
            <p className="shrink-0 text-[10px] text-nexy-warning">
              No structured workflow was returned yet. Reply above with more detail about the goal or expected deliverables.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
