import { useEffect, useMemo, useRef, useState } from 'react'
import { isApiError, type AvailableModelGroup } from '../../../shared/types'
import {
  WORK_HISTORY_PRESETS, cleanWorkHistoryTitle, workHistoryLocalDate, workHistoryPresetDates, workHistoryRange, workHistoryReportWithTitles,
  type WorkHistoryExternalAccess, type WorkHistoryPreset, type WorkHistoryRequest, type WorkHistoryRun, type WorkHistorySource,
} from '../../../shared/work-history'
import { useAppStore } from '../../store/app-store'
import { ModelPicker } from '../chat/ModelPicker'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { Button, SegmentedTabs, SelectField, TextareaField } from '../ui/primitives'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { PaneEmptyState } from './pane-primitives'

const GROUPINGS: Array<{ id: WorkHistoryRequest['grouping']; label: string }> = [
  { id: 'project', label: 'Project' }, { id: 'chat', label: 'Chat' }, { id: 'agent', label: 'Agent' }, { id: 'custom', label: 'Custom' },
]
/** Codex and Hermes summarise through the in-chat Work history capability instead. */
const UNSUPPORTED_SOURCES = new Set(['codex-cli', 'hermes-cli'])
const sectionLabel = 'block text-[11px] font-bold uppercase tracking-wide text-nexy-muted mb-1.5'

function chip(active: boolean): string {
  return `rounded-nexy-sm border-2 px-2 py-1 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-nexy-accent ${
    active ? 'border-nexy-border bg-nexy-accent text-nexy-on-accent' : 'border-nexy-border-soft text-nexy-muted hover:border-nexy-border hover:text-nexy-text'}`
}

function rangeLabel(start: number, end: number): string {
  const format = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const first = format(start), last = format(end - 1)
  return first === last ? first : `${first} – ${last}`
}

function StatusBadge({ status }: { status: WorkHistoryRun['status'] }) {
  const style = {
    completed: 'border-green-700 text-green-700 dark:border-green-400 dark:text-green-400',
    running: 'border-nexy-activity text-nexy-activity',
    cancelled: 'border-nexy-border-soft text-nexy-muted',
    failed: 'border-nexy-error text-nexy-error',
  }[status]
  return <span className={`shrink-0 rounded-nexy-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase ${style}`}>{status}</span>
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2 rounded-nexy-sm border-2 p-2 text-xs ${
    tone === 'error' ? 'border-nexy-error text-nexy-error bg-red-50 dark:bg-red-950/30' : 'border-nexy-border-soft text-nexy-text bg-nexy-recessed'}`}>
    <NexyIcon name={tone === 'error' ? 'error' : 'info'} size={14} className="mt-0.5 shrink-0" />
    <div className="min-w-0">{children}</div>
  </div>
}

/** Explains in-chat CLI use and controls opt-in access for terminal sessions outside Nexy. */
function WorkHistoryCliAccess() {
  const [access, setAccess] = useState<WorkHistoryExternalAccess | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { void window.api.workHistoryExternalStatus().then(result => { if (isApiError(result)) setError(result.error); else setAccess(result) }) }, [])
  const apply = async (enable: boolean) => {
    setError('')
    const result = enable ? await window.api.workHistoryExternalEnable() : await window.api.workHistoryExternalDisable()
    if (isApiError(result)) setError(result.error)
    else setAccess(result)
  }
  const snippet = (label: string, text: string) => <div key={label} className="space-y-1">
    <div className="flex items-center justify-between"><span className="font-bold">{label}</span><Button variant="ghost" className="!px-1.5 !py-0.5" onClick={() => void navigator.clipboard.writeText(text)}><NexyIcon name="duplicate" size={12} />Copy</Button></div>
    <pre className="whitespace-pre-wrap break-all rounded-nexy-sm border-2 border-nexy-border-soft bg-nexy-recessed p-1.5 text-[11px]">{text}</pre>
  </div>
  return <details className="rounded-nexy-sm border-2 border-nexy-border-soft p-2 text-xs space-y-2">
    <summary className="cursor-pointer font-bold">Use Claude, Codex or Hermes from a chat</summary>
    <p>In a CLI-backed chat, enable the <strong>Work history</strong> capability and ask, for example, “Summarise what I worked on last week by project”. The CLI reads the chats through Nexy and writes the summary with its own model. Ask it to save the report to list it here.</p>
    <p className="text-nexy-muted">The CLI and its model provider receive the requested chat content and may retain it under their own settings.</p>
    <p className="font-bold pt-1">Terminal sessions outside Nexy</p>
    {access?.enabled
      ? <>
          <p>Access is on. The setup below contains a secret token; anyone with it can read your chat history while Nexy is running.</p>
          {access.setup && [snippet('Claude Code', access.setup.claude), snippet('Codex (~/.codex/config.toml)', access.setup.codex), snippet('Hermes (config.yaml)', access.setup.hermes)]}
          <Button variant="danger" onClick={() => void apply(false)}>Stop access</Button>
          <p className="text-nexy-muted">Stopping access or closing Nexy revokes this setup; enabling again issues a new one.</p>
        </>
      : <Button onClick={() => void apply(true)}>Allow terminal CLI access</Button>}
    {error && <p role="alert" className="text-nexy-error">{error}</p>}
  </details>
}

function ReportDetail({ run, onBack }: { run: WorkHistoryRun; onBack: () => void }) {
  const selectConversation = useAppStore(s => s.selectConversation)
  const [error, setError] = useState('')
  const titles = useMemo(() => new Map(run.sources.map(source => [source.id, source.title])), [run.sources])
  const report = run.report ? workHistoryReportWithTitles(run.report, titles) : null
  return <div className="flex h-full flex-col">
    <div className="flex items-center gap-2 border-b-2 border-nexy-border px-2 py-1.5">
      <Button variant="ghost" className="!px-1.5" onClick={onBack} aria-label="Back to reports"><NexyIcon name="back" size={14} /></Button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold">{rangeLabel(run.request.start, run.request.end)}</p>
        <p className="truncate text-[11px] text-nexy-muted">{run.sources.length} chats · by {run.request.grouping ?? 'project'} · {run.request.model}</p>
      </div>
      <StatusBadge status={run.status} />
    </div>
    <div className="flex-1 overflow-auto p-3 space-y-3 text-sm">
      {run.status === 'running' && <div className="space-y-2">
        <div className="h-1.5 w-full overflow-hidden rounded-nexy-sm border border-nexy-border-soft"><div className="h-full w-1/3 animate-pulse bg-nexy-activity" /></div>
        <p className="text-xs">{run.progress}</p>
        <Button onClick={() => void window.api.workHistoryCancel(run.id).then(result => { if (isApiError(result)) setError(result.error) })}><NexyIcon name="stop" size={12} />Cancel</Button>
      </div>}
      {(run.status === 'failed' || run.status === 'cancelled') && <Notice tone={run.status === 'failed' ? 'error' : 'info'}>{run.error ?? (run.status === 'cancelled' ? 'The report was cancelled.' : 'The report failed.')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {report && <>
        <MarkdownRenderer content={report} />
        <div className="flex gap-2">
          <Button onClick={() => void navigator.clipboard.writeText(report)}><NexyIcon name="duplicate" size={12} />Copy</Button>
          <Button onClick={() => void window.api.saveTextFile(`work-history-${workHistoryLocalDate(new Date(run.request.start))}.md`, report)}><NexyIcon name="download" size={12} />Export</Button>
        </div>
      </>}
      {run.sources.length > 0 && <div>
        <span className={sectionLabel}>Sources</span>
        <ul className="space-y-0.5">
          {run.sources.map(source => <li key={source.id}>
            <button className="flex w-full items-center gap-1.5 rounded-nexy-sm px-1 py-1 text-left text-xs hover:bg-nexy-recessed disabled:opacity-50 disabled:hover:bg-transparent" disabled={!source.available} onClick={() => selectConversation(source.id)}>
              <NexyIcon name="chat" size={12} className="shrink-0" />
              <span className="truncate">{cleanWorkHistoryTitle(source.title)}{source.available ? '' : ' (deleted)'}</span>
            </button>
          </li>)}
        </ul>
      </div>}
    </div>
  </div>
}

export function WorkHistoryPane() {
  const [tab, setTab] = useState<'new' | 'saved'>('new')
  const [preset, setPreset] = useState<WorkHistoryPreset>('today')
  const today = workHistoryLocalDate(new Date())
  const [custom, setCustom] = useState({ first: today, last: today })
  const [projectId, setProjectId] = useState('all')
  const [agentId, setAgentId] = useState('all')
  const [model, setModel] = useState('default')
  const [grouping, setGrouping] = useState<WorkHistoryRequest['grouping']>('project')
  const [instructions, setInstructions] = useState('')
  const [groups, setGroups] = useState<AvailableModelGroup[]>([])
  const [sources, setSources] = useState<WorkHistorySource[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [runs, setRuns] = useState<WorkHistoryRun[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const projects = useAppStore(s => s.projects)
  const agents = useAppStore(s => s.agents)
  const catalogModels = useAppStore(s => s.catalogModels)
  const globalDefaultModel = useAppStore(s => s.globalDefaultModel)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const { first, last } = workHistoryPresetDates(preset, new Date()) ?? custom
  const reportGroups = useMemo(() => groups.filter(group => !UNSUPPORTED_SOURCES.has(group.sourceKey)), [groups])
  const anyRunning = runs.some(run => run.status === 'running')

  const refresh = async () => {
    const result = await window.api.workHistoryList()
    if (!isApiError(result)) setRuns(result)
  }
  useEffect(() => { void refresh() }, [])
  // Opened from the activity panel: show that report once the pane is mounted.
  const openRunId = useAppStore(s => s.workHistoryOpenRunId)
  const setOpenRunId = useAppStore(s => s.setWorkHistoryOpenRunId)
  useEffect(() => {
    if (!openRunId) return
    setActive(openRunId); setTab('saved'); setOpenRunId(null)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRunId])
  useEffect(() => {
    const timer = setInterval(() => void refresh(), anyRunning ? 2000 : 10000)
    return () => clearInterval(timer)
  }, [anyRunning])
  useEffect(() => { window.api.listAvailableModels().then(setGroups).catch(() => {}) }, [])

  const range = (() => { try { return workHistoryRange(first, last) } catch { return null } })()
  const filters = (): Pick<WorkHistoryRequest, 'projectId' | 'agentId'> => ({
    ...(projectId === 'all' ? {} : { projectId: projectId === 'none' ? null : projectId }),
    ...(agentId === 'all' ? {} : { agentId: agentId === 'none' ? null : agentId }),
  })

  // Preview automatically when the period or filters change.
  useEffect(() => {
    setSources(null); setSelected([])
    if (!range) return
    let cancelled = false
    setPreviewing(true)
    const timer = setTimeout(() => {
      void window.api.workHistoryPreview({ ...range, model, grouping, instructions: '', ...filters() }).then(result => {
        if (cancelled) return
        setPreviewing(false)
        if (isApiError(result)) { setError(result.error); return }
        setError(''); setSources(result); setSelected(result.map(source => source.id))
      })
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.start, range?.end, projectId, agentId])

  const generate = async () => {
    if (!range || !selected.length) return
    setError(''); setStarting(true)
    const result = await window.api.workHistoryStart({ ...range, model, grouping, instructions: instructions.trim(), ...filters(), conversationIds: selected })
    setStarting(false)
    if (isApiError(result)) { setError(result.error); return }
    await refresh()
    setActive(result); setTab('saved')
  }

  const activeRun = runs.find(item => item.id === active)
  if (activeRun) return <ReportDetail run={activeRun} onBack={() => setActive(null)} />

  const all = sources ?? []
  const chosen = all.filter(source => selected.includes(source.id))
  return <div className="flex h-full flex-col">
    <SegmentedTabs value={tab} onChange={setTab} items={[{ id: 'new', label: 'New report' }, { id: 'saved', label: runs.length ? `Saved (${runs.length})` : 'Saved' }]} />
    {tab === 'saved'
      ? <div className="flex-1 overflow-auto">
          {runs.length === 0 && <PaneEmptyState>No reports yet.</PaneEmptyState>}
          {runs.map(run => <button key={run.id} onClick={() => setActive(run.id)} className="flex w-full items-center gap-2 border-b border-nexy-border-soft px-3 py-2 text-left hover:bg-nexy-recessed">
            <NexyIcon name="history" size={14} className="shrink-0 text-nexy-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold">{rangeLabel(run.request.start, run.request.end)}</span>
              <span className="block truncate text-[11px] text-nexy-muted">{run.sources.length} chats · by {run.request.grouping ?? 'project'} · {new Date(run.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
            </span>
            <StatusBadge status={run.status} />
          </button>)}
        </div>
      : <>
          <div className="flex-1 overflow-auto p-3 space-y-4 text-sm">
            <section>
              <span className={sectionLabel}>Period</span>
              <div className="flex flex-wrap gap-1">
                {WORK_HISTORY_PRESETS.map(item => <button key={item.id} type="button" className={chip(preset === item.id)} aria-pressed={preset === item.id}
                  onClick={() => { if (item.id === 'custom') setCustom({ first, last }); setPreset(item.id) }}>{item.label}</button>)}
              </div>
              {preset === 'custom'
                ? <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-nexy-muted">From<input type="date" className="mt-0.5 w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-1.5 py-1 text-xs text-nexy-text" value={custom.first} max={custom.last} onChange={e => e.target.value && setCustom(c => ({ ...c, first: e.target.value }))} /></label>
                    <label className="text-[11px] text-nexy-muted">Through<input type="date" className="mt-0.5 w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-1.5 py-1 text-xs text-nexy-text" value={custom.last} min={custom.first} onChange={e => e.target.value && setCustom(c => ({ ...c, last: e.target.value }))} /></label>
                  </div>
                : range && <p className="mt-1.5 text-xs font-medium">{rangeLabel(range.start, range.end)}</p>}
            </section>
            <section className="space-y-2">
              <span className={sectionLabel}>Filter</span>
              <SelectField aria-label="Project" value={projectId} onChange={e => setProjectId(e.target.value)}>
                <option value="all">All projects</option><option value="none">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
              <SelectField aria-label="Agent" value={agentId} onChange={e => setAgentId(e.target.value)}>
                <option value="all">All agents</option><option value="none">No agent</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SelectField>
            </section>
            <section className="space-y-2">
              <span className={sectionLabel}>Report</span>
              <ModelPicker
                value={model}
                availableGroups={reportGroups}
                catalogModels={catalogModels}
                globalDefaultModel={globalDefaultModel ?? undefined}
                includeDefault
                buttonRef={modelButtonRef}
                buttonClassName="flex w-full items-center justify-between gap-1 rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-3 py-2 text-sm text-nexy-text hover:bg-nexy-raised"
                onSelectDefault={() => setModel('default')}
                onSelectAvailableModel={(group, entry) => setModel(group.sourceType === 'cli' ? `${group.sourceKey}:${entry.id}` : entry.id)}
              />
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[11px] text-nexy-muted">Group by</span>
                {GROUPINGS.map(item => <button key={item.id} type="button" className={chip(grouping === item.id)} aria-pressed={grouping === item.id} onClick={() => setGrouping(item.id)}>{item.label}</button>)}
              </div>
              <TextareaField rows={2} maxLength={4000} placeholder="Instructions (optional), e.g. focus on decisions and open questions" value={instructions} onChange={e => setInstructions(e.target.value)} />
            </section>
            {error && <Notice tone="error">{error}</Notice>}
            <section>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-nexy-muted">Chats</span>
                  <span className="block text-[11px] text-nexy-muted">{previewing ? 'Finding chats with activity…'
                    : !sources ? 'Choose a valid period.'
                    : !all.length ? 'No chat activity in this period.'
                    : `${chosen.length} of ${all.length} selected · about ${Math.round(chosen.reduce((sum, s) => sum + s.estimatedCharacters, 0) / 5).toLocaleString()} words`}</span>
                </div>
                {all.length > 0 && <Button variant="ghost" className="!px-1.5 !py-0.5" onClick={() => setSelected(selected.length === all.length ? [] : all.map(s => s.id))}>{selected.length === all.length ? 'Select none' : 'Select all'}</Button>}
              </div>
              <ul className="space-y-0.5">
                {all.map(source => <li key={source.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-nexy-sm px-1 py-1 hover:bg-nexy-recessed">
                    <input type="checkbox" className="mt-0.5" checked={selected.includes(source.id)} onChange={e => setSelected(e.target.checked ? [...selected, source.id] : selected.filter(id => id !== source.id))} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{cleanWorkHistoryTitle(source.title)}</span>
                      <span className="block truncate text-[11px] text-nexy-muted">{[source.projectName ?? 'No project', source.agentName, `${source.messageCount} messages`, source.archived ? 'archived' : null].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                </li>)}
              </ul>
            </section>
            <WorkHistoryCliAccess />
          </div>
          <div className="border-t-2 border-nexy-border p-2">
            <Button variant="primary" className="w-full" disabled={!selected.length || starting || !range} onClick={() => void generate()}>
              <NexyIcon name="spark" size={12} />{starting ? 'Starting…' : selected.length ? `Generate report · ${selected.length} chat${selected.length === 1 ? '' : 's'}` : 'Generate report'}
            </Button>
          </div>
        </>}
  </div>
}
