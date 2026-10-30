import { useEffect, useState } from 'react'
import { isApiError } from '../../../shared/types'
import type { WorkHistoryCapability, WorkHistoryExternalAccess, WorkHistoryRequest, WorkHistoryRun, WorkHistorySource } from '../../../shared/work-history'
import { useAppStore } from '../../store/app-store'

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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
  const snippet = (label: string, text: string) => <div key={label}>
    <p className="font-medium">{label} <button className="underline" onClick={() => void navigator.clipboard.writeText(text)}>Copy</button></p>
    <pre className="whitespace-pre-wrap break-all text-xs rounded border border-gray-300 dark:border-gray-600 p-1">{text}</pre>
  </div>
  return <details className="space-y-2">
    <summary className="font-semibold cursor-pointer">Summarise with Claude, Codex or Hermes</summary>
    <p>In a CLI-backed chat, enable the <strong>Work history</strong> capability, then ask, for example, “Summarise what I worked on last week by project”. The CLI reads the selected chats through Nexy and writes the summary with its own model. Ask it to save the report if you want it listed below.</p>
    <p className="text-xs">The selected CLI and its model provider receive the requested chat content and may retain it under their own settings. Nexy checks batch coverage and source IDs, but cannot verify every claim in a CLI-written summary.</p>
    <p className="font-medium">Terminal sessions outside Nexy</p>
    {access?.enabled
      ? <>
          <p>External access is on. The setup below contains a secret token; anyone with it can read your chat history while Nexy is running. <button className="underline" onClick={() => void apply(false)}>Stop access</button></p>
          {access.setup && [snippet('Claude Code', access.setup.claude), snippet('Codex (~/.codex/config.toml)', access.setup.codex), snippet('Hermes (config.yaml)', access.setup.hermes)]}
          <p className="text-xs">Stopping access or closing Nexy revokes this setup; enabling again issues a new one.</p>
        </>
      : <button className="underline" onClick={() => void apply(true)}>Allow terminal CLI access</button>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
  </details>
}

export function WorkHistoryPane() {
  const [start, setStart] = useState(localDate(new Date()))
  const [end, setEnd] = useState(start)
  const [model, setModel] = useState('gpt-5-mini')
  const [capabilities, setCapabilities] = useState<WorkHistoryCapability[]>([])
  const [grouping, setGrouping] = useState<WorkHistoryRequest['grouping']>('project')
  const [instructions, setInstructions] = useState('')
  const [projectId, setProjectId] = useState('all')
  const [agentId, setAgentId] = useState('all')
  const [sources, setSources] = useState<WorkHistorySource[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [runs, setRuns] = useState<WorkHistoryRun[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [error, setError] = useState('')
  const projects = useAppStore(s => s.projects)
  const agents = useAppStore(s => s.agents)
  const selectConversation = useAppStore(s => s.selectConversation)
  const field = 'w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-1'
  const refresh = async () => {
    const result = await window.api.workHistoryList()
    if (isApiError(result)) setError(result.error)
    else setRuns(result)
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 2000); return () => clearInterval(timer) }, [])
  useEffect(() => { void window.api.workHistoryCapabilities().then(result => { if (!isApiError(result)) setCapabilities(result) }) }, [])
  useEffect(() => { setSources(null) }, [start, end, projectId, agentId])
  const request = (): WorkHistoryRequest => {
    const from = new Date(`${start}T00:00:00`)
    const until = new Date(`${end}T00:00:00`)
    until.setDate(until.getDate() + 1)
    return { start: from.getTime(), end: until.getTime(), model, grouping, instructions,
      ...(projectId === 'all' ? {} : { projectId: projectId === 'none' ? null : projectId }),
      ...(agentId === 'all' ? {} : { agentId: agentId === 'none' ? null : agentId }) }
  }
  const preview = async () => {
    setError('')
    const result = await window.api.workHistoryPreview(request())
    if (isApiError(result)) setError(result.error)
    else { setSources(result); setSelected(result.map(source => source.id)) }
  }
  const generate = async () => {
    setError('')
    const result = await window.api.workHistoryStart({ ...request(), conversationIds: selected })
    if (isApiError(result)) setError(result.error)
    else { setActive(result); await refresh() }
  }
  const run = runs.find(item => item.id === active)
  return <div className="h-full overflow-auto p-3 text-sm space-y-3">
    <p>Summarize activity within local calendar dates, including archived chats.</p>
    <WorkHistoryCliAccess />
    <label className="block">From<input className={field} type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
    <label className="block">Through<input className={field} type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
    <button className="underline" onClick={() => { const d = new Date(`${start}T00:00:00`); d.setDate(d.getDate() - (d.getDay() + 6) % 7); setStart(localDate(d)); d.setDate(d.getDate() + 6); setEnd(localDate(d)) }}>Select week (Monday–Sunday)</button>
    <label className="block">Project<select className={field} value={projectId} onChange={e => setProjectId(e.target.value)}><option value="all">All</option><option value="none">Unassigned</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="block">Agent<select className={field} value={agentId} onChange={e => setAgentId(e.target.value)}><option value="all">All</option><option value="none">Unassigned</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label className="block">API model or Claude CLI<input className={field} value={model} onChange={e => setModel(e.target.value)} /><span className="text-xs">Use claude-cli or claude-cli:sonnet for Claude Code.</span></label>
    <label className="block">Backend<select className={field} value={/^claude-cli(?::|$)/i.test(model) ? 'claude' : /^(codex|hermes)(?:-cli)?(?::|$)/i.exec(model)?.[1]?.toLowerCase() ?? 'api'} onChange={e => setModel(e.target.value === 'claude' ? 'claude-cli' : 'gpt-5-mini')}>
      {capabilities.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.id}{item.available ? '' : ` — ${item.reason}`}</option>)}
    </select></label>
    {capabilities.filter(item => !item.available).map(item => <p className="text-xs" key={item.id}>{item.id}: {item.reason}</p>)}
    <label className="block">Group by<select className={field} value={grouping} onChange={e => setGrouping(e.target.value as WorkHistoryRequest['grouping'])}><option value="project">Project</option><option value="chat">Chat</option><option value="agent">Agent</option><option value="custom">Custom</option></select></label>
    <label className="block">Instructions<textarea className={field} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
    <button className="underline" onClick={() => void preview()}>Preview matching chats</button>
    {sources && <div className="space-y-1"><p>{sources.length} matching chats · approximately {sources.filter(s => selected.includes(s.id)).reduce((sum, s) => sum + s.estimatedCharacters, 0).toLocaleString()} characters of activity before batching</p>{sources.map(s => <label className="block" key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} /> {s.title} · {s.projectName ?? 'No project'} · {s.agentName ?? 'No agent'} · {s.messageCount} {s.archived ? '· archived' : ''}</label>)}<button className="underline" disabled={!selected.length} onClick={() => void generate()}>Generate report</button></div>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    <h3 className="font-semibold">Saved reports</h3>
    {runs.map(item => <button className="block underline text-left" key={item.id} onClick={() => setActive(item.id)}>{new Date(item.createdAt).toLocaleString()} · {item.status}</button>)}
    {run && <div className="space-y-2"><p>{run.progress}{run.error ? `: ${run.error}` : ''}</p>{run.status === 'running' && <button className="underline" onClick={() => void window.api.workHistoryCancel(run.id)}>Cancel</button>}{run.report && <><div className="whitespace-pre-wrap">{run.report.split(/(\[source:[^\]\r\n]+\])/gi).map((part, index) => {
      const id = /^\[source:([^\]]+)\]$/i.exec(part)?.[1]
      const source = id && run.sources.find(item => item.id === id)
      return source ? <button key={index} className="underline" disabled={!source.available} onClick={() => selectConversation(source.id)}>{source.title}{source.available ? '' : ' (unavailable)'}</button> : part
    })}</div><button className="underline" onClick={() => void navigator.clipboard.writeText(run.report!)}>Copy</button> <button className="underline" onClick={() => void window.api.saveTextFile('work-history.md', run.report!)}>Export</button></>}<h4 className="font-semibold">Sources</h4>{run.sources.map(s => <button className="block underline text-left" disabled={!s.available} key={s.id} onClick={() => selectConversation(s.id)}>{s.title}{s.available ? '' : ' (unavailable)'}</button>)}</div>}
  </div>
}
