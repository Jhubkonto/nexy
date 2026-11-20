import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleAlert, Loader2, ShieldCheck } from 'lucide-react'
import type { CapabilityPreflight, CapabilityScope, CapabilityTrust, ConversationCapabilityProfile, CredentialBindingMetadata, CredentialMetadata, McpServerWithStatus, SkillConfig } from '../../shared/types'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Button, ModalShell, SaveStatus, SegmentedTabs, SelectField, TextField, type SaveState } from './ui/primitives'

type Props = {
  conversationId: string | null
  modelId?: string | null
  skills: SkillConfig[]
  projectId?: string | null
  projectName?: string | null
  agentId?: string | null
  agentName?: string | null
  onEnsureConversation?: () => Promise<string | null>
  onOpenMcp?: () => void
  onOpenSkills?: () => void
  onOpenProjectCapabilities?: () => void
}

type Tab = 'skills' | 'mcp' | 'credentials' | 'readiness'
const emptyProfile: ConversationCapabilityProfile = { version: 1, skillIds: [], mcp: [] }
const statusLabel: Record<CapabilityPreflight['items'][number]['status'], string> = {
  ready: 'Ready', missing: 'Needs setup', invalid: 'Needs attention', disconnected: 'Disconnected', unsupported: 'Model unsupported',
}

function scopeProfile(preflight: CapabilityPreflight, scope: CapabilityScope) {
  return preflight.scopeProfiles
    ? preflight.scopeProfiles[scope] ?? emptyProfile
    : scope === 'chat' ? preflight.profile : emptyProfile
}

function selectionKey(profile: ConversationCapabilityProfile) {
  return JSON.stringify([
    [...profile.skillIds].sort(),
    profile.mcp.map(({ serverId, trust }) => `${serverId}:${trust}`).sort(),
  ])
}

export function CapabilitiesModal(props: Props) {
  const { conversationId, onEnsureConversation } = props
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null)
  const [scope, setScope] = useState<CapabilityScope>('chat')
  const [savedCount, setSavedCount] = useState(0)
  const previousConversation = useRef(conversationId)
  const conversationGeneration = useRef(0)
  const currentConversation = useRef(conversationId)
  currentConversation.current = conversationId
  const mounted = useRef(true)
  const creatingRef = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (previousConversation.current === conversationId) return
    previousConversation.current = conversationId
    conversationGeneration.current++
    if (conversationId === pendingConversationId) {
      setPendingConversationId(null)
      return
    }
    setOpen(false)
    setPendingConversationId(null)
    setSavedCount(0)
    setScope('chat')
    setCreationError(null)
  }, [conversationId, pendingConversationId])

  const activeConversationId = conversationId ?? pendingConversationId
  const activeScope = scope === 'project' && !props.projectId || scope === 'agent' && !props.agentId ? 'chat' : scope
  const openModal = async () => {
    if (creatingRef.current || open) return
    setCreationError(null)
    if (activeConversationId) {
      setOpen(true)
      return
    }
    if (!onEnsureConversation) return
    creatingRef.current = true
    setCreating(true)
    const generation = conversationGeneration.current
    try {
      const createdId = await onEnsureConversation()
      const adopted = createdId !== null && currentConversation.current === createdId
      if (!mounted.current || !adopted && (conversationGeneration.current !== generation || currentConversation.current !== null)) return
      if (createdId) {
        setPendingConversationId(createdId)
        setOpen(true)
      } else {
        setCreationError('Could not create a chat. Try opening capabilities again.')
      }
    } catch (cause) {
      if (mounted.current && conversationGeneration.current === generation) setCreationError(cause instanceof Error ? cause.message : 'Could not create a chat')
    } finally {
      creatingRef.current = false
      if (mounted.current) setCreating(false)
    }
  }

  return <>
    <button
      type="button"
      onClick={() => void openModal()}
      disabled={creating || !activeConversationId && !onEnsureConversation}
      className={`inline-flex items-center gap-1 rounded-nexy-sm px-1.5 py-1 text-xs transition-colors disabled:opacity-60 ${open ? 'bg-nexy-recessed text-nexy-accent' : 'text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text'}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Chat capabilities${savedCount > 0 ? `, ${savedCount} active` : ''}`}
      title="Use skills and MCP tools in this chat"
    >
      {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
      {savedCount > 0 && <span>{savedCount}</span>}
    </button>
    {creationError && <span role="alert" className="text-xs text-nexy-error">{creationError}</span>}
    {open && activeConversationId && <CapabilitiesEditor
      {...props}
      key={activeConversationId}
      conversationId={activeConversationId}
      scope={activeScope}
      onScopeChange={setScope}
      onClose={() => setOpen(false)}
      onSavedCount={setSavedCount}
    />}
  </>
}

function CapabilitiesEditor({ conversationId, modelId, skills, projectId, projectName, agentId, agentName, onOpenMcp, onOpenSkills, onOpenProjectCapabilities, scope, onScopeChange, onClose, onSavedCount }: Props & {
  conversationId: string
  scope: CapabilityScope
  onScopeChange: (scope: CapabilityScope) => void
  onClose: () => void
  onSavedCount: (count: number) => void
}) {
  const [tab, setTab] = useState<Tab>('skills')
  const [draft, setDraft] = useState(emptyProfile)
  const [savedProfile, setSavedProfile] = useState(emptyProfile)
  const [servers, setServers] = useState<McpServerWithStatus[]>([])
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([])
  const [bindings, setBindings] = useState<CredentialBindingMetadata[]>([])
  const [credentialId, setCredentialId] = useState('')
  const [duration, setDuration] = useState<'hour' | 'today' | 'until-removed'>('until-removed')
  const [preflight, setPreflight] = useState<CapabilityPreflight | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [skillSearch, setSkillSearch] = useState('')
  const [serverSearch, setServerSearch] = useState('')
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const loadedRef = useRef(false)
  const busyRef = useRef(false)
  const request = useRef(0)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const dirty = selectionKey(draft) !== selectionKey(savedProfile)

  const refresh = useCallback(async (hydrate = false) => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const [nextPreflight, nextServers, nextCredentials, nextBindings] = await Promise.all([
        window.api.resolveCapabilities(conversationId, modelId), window.api.listMcpServers(),
        window.api.credentialList(), window.api.credentialBindingList(),
      ])
      if (request.current !== id) return
      if (hydrate || !loadedRef.current) {
        const profile = scopeProfile(nextPreflight, scopeRef.current)
        setDraft(profile)
        setSavedProfile(profile)
      }
      setPreflight(nextPreflight)
      setServers(nextServers)
      setCredentials(nextCredentials)
      setBindings(nextBindings)
      onSavedCount(nextPreflight.profile.skillIds.length + nextPreflight.profile.mcp.length)
      loadedRef.current = true
      setLoaded(true)
    } catch (cause) {
      if (request.current === id) setError(cause instanceof Error ? cause.message : 'Could not load capabilities')
    } finally {
      if (request.current === id) setLoading(false)
    }
  }, [conversationId, modelId, onSavedCount])

  useEffect(() => {
    const requests = request
    void refresh()
    return () => { requests.current++ }
  }, [refresh])
  useEffect(() => window.api.onMcpServerStatusChanged(() => {
    if (!busyRef.current) void refresh()
  }), [refresh])

  const availableCredentials = credentials.filter((item) => item.provider === null && item.revokedAt === null)
  const chatBindings = bindings.filter((binding) => binding.conversationId === conversationId
    && credentials.some((credential) => credential.id === binding.credentialId && credential.provider === null))
  const filteredSkills = useMemo(() => {
    const query = skillSearch.trim().toLowerCase()
    return skills.filter((skill) => `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(query))
  }, [skillSearch, skills])
  const filteredServers = useMemo(() => servers.filter((server) => server.name.toLowerCase().includes(serverSearch.trim().toLowerCase())), [serverSearch, servers])

  const requestAction = (action: () => void) => {
    if (busyRef.current) return
    if (dirty) setPendingAction(() => action)
    else action()
  }
  const navigate = (callback: (() => void) | undefined) => requestAction(() => { onClose(); callback?.() })
  const changeScope = (nextScope: CapabilityScope) => {
    if (nextScope === scope) return
    requestAction(() => {
      onScopeChange(nextScope)
      const profile = preflight ? scopeProfile(preflight, nextScope) : emptyProfile
      setDraft(profile)
      setSavedProfile(profile)
      setSaveState('idle')
    })
  }

  const save = async () => {
    if (!loaded || busyRef.current) return
    busyRef.current = true
    // Invalidate any background read that started before this write.
    request.current++
    setBusy(true)
    setError(null)
    setSaveState('saving')
    const id = request.current
    try {
      if (scope === 'chat') await window.api.setConversationCapabilities(conversationId, draft)
      else await window.api.activateCapabilities(conversationId, { ...draft, scope, targetId: scope === 'project' ? projectId : agentId })
      if (request.current !== id) return
      setSavedProfile(draft)
      setSaveState('saved')
      await refresh(true)
    } catch (cause) {
      if (request.current === id) {
        setError(cause instanceof Error ? cause.message : 'Could not update capabilities')
        setSaveState('error')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
      setLoading(false)
    }
  }

  const writeCredential = async (operation: () => Promise<unknown>) => {
    if (!loaded || busyRef.current) return
    busyRef.current = true
    request.current++
    const id = request.current
    setBusy(true)
    setError(null)
    try {
      await operation()
      if (request.current !== id) return
      setCredentialId('')
      await refresh()
    } catch (cause) {
      if (request.current === id) setError(cause instanceof Error ? cause.message : 'Could not update credential access')
    } finally {
      busyRef.current = false
      setBusy(false)
      setLoading(false)
    }
  }
  const grantCredential = () => {
    const credential = availableCredentials.find((item) => item.id === credentialId)
    if (!credential) return
    const now = Date.now()
    const expiresAt = duration === 'hour' ? now + 60 * 60 * 1000
      : duration === 'today' ? new Date(new Date(now).setHours(23, 59, 59, 999)).getTime() : null
    void writeCredential(() => window.api.credentialBindingCreate({
      credentialId, conversationId, capability: `credential:${credential.id}`, approvalMode: 'auto', expiresAt,
    }))
  }
  const edit = (update: (profile: ConversationCapabilityProfile) => ConversationCapabilityProfile) => {
    setDraft(update)
    setSaveState('idle')
  }
  const disabled = busy || !loaded
  const description = scope === 'chat' ? 'Choose skills and MCP tools for this chat.'
    : scope === 'project' ? 'Add capabilities for future chats in this project.' : 'Attach reusable capabilities to this agent’s defaults.'

  return <>
    <ModalShell
      title="Chat capabilities"
      description={description}
      icon={<ShieldCheck className="h-4 w-4 shrink-0" />}
      maxWidth="max-w-4xl"
      height="h-[84vh] max-h-[calc(100dvh-2rem)]"
      bodyClassName="flex min-h-0 flex-1 flex-col text-left text-xs text-nexy-text"
      suspended={Boolean(pendingAction)}
      busy={busy}
      closeOnEscape
      onClose={() => requestAction(onClose)}
      footerClassName="items-center"
      footer={<>
        <span role="status" className="mr-auto text-xs text-nexy-muted">
          {dirty && !busy && saveState !== 'error' ? 'Unsaved changes' : <SaveStatus state={saveState} />}
        </span>
        <Button onClick={() => requestAction(onClose)} disabled={busy}>Close</Button>
        <Button variant="primary" onClick={() => void save()} disabled={disabled}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {saveState === 'saving' ? 'Saving…' : scope === 'chat' ? 'Use in this chat' : scope === 'project' ? 'Add to project' : 'Attach to agent'}
        </Button>
      </>}
    >
      <div className="shrink-0 space-y-2 border-b border-nexy-border bg-nexy-surface px-5 py-3">
        <SelectField label="Use this setup" value={scope} disabled={disabled} onChange={(event) => changeScope(event.target.value as CapabilityScope)} className="!py-1.5 !text-xs">
          <option value="chat">This chat</option>
          {projectId && <option value="project">This project{projectName ? ` · ${projectName}` : ''}</option>}
          {agentId && <option value="agent">This agent{agentName ? ` · ${agentName}` : ''}</option>}
        </SelectField>
        <p className="break-words text-nexy-muted">
          {scope === 'chat' && 'One-off use; no agent changes.'}
          {scope === 'project' && <>Saving here only adds to the project. {onOpenProjectCapabilities
            ? <><button type="button" disabled={busy} onClick={() => navigate(onOpenProjectCapabilities)} className="text-nexy-accent hover:underline">Manage project capabilities</button> to remove one or loosen its approval level.</>
            : 'Use Project Settings → Capabilities to remove one or loosen its approval level.'}</>}
          {scope === 'agent' && 'Saving adds skills and MCP servers to this agent. Manage the agent to remove them.'}
        </p>
      </div>
      <div className="shrink-0 overflow-x-auto">
        <div className="min-w-[24rem]">
          <SegmentedTabs<Tab> value={tab} onChange={setTab} items={[
            { id: 'skills', label: 'Skills' }, { id: 'mcp', label: 'MCP tools' },
            { id: 'credentials', label: 'Credentials' }, { id: 'readiness', label: 'Readiness' },
          ]} />
        </div>
      </div>
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 [overflow-wrap:anywhere]">
        {loading && <p role="status" className="mb-3 flex items-center gap-2 text-nexy-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{loaded ? 'Refreshing capabilities…' : 'Loading capabilities…'}</p>}
        {error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-nexy-error"><span>{error}</span><Button disabled={busy || loading} onClick={() => void refresh()}>Retry</Button></div>}
        {loaded && <fieldset disabled={busy} className="min-w-0 space-y-3">
          {tab === 'skills' && <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-nexy-muted">{draft.skillIds.length}/{skills.length} selected</p>
              {onOpenSkills && <Button onClick={() => navigate(onOpenSkills)}>Open Skills</Button>}
            </div>
            {skills.length === 0 ? <p className="text-nexy-muted">Import a skill to make it available here.</p> : <>
              <TextField type="search" value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder="Search skills" aria-label="Search skills" />
              <div className="space-y-1">
                {filteredSkills.map((skill) => <label key={skill.id} className="flex cursor-pointer items-start gap-3 rounded-nexy-sm border border-nexy-border p-3 hover:bg-nexy-recessed">
                  <input type="checkbox" checked={draft.skillIds.includes(skill.id)} onChange={() => edit((current) => ({ ...current, skillIds: current.skillIds.includes(skill.id) ? current.skillIds.filter((id) => id !== skill.id) : [...current.skillIds, skill.id] }))} className="mt-0.5 shrink-0 accent-nexy-accent" />
                  <span className="min-w-0"><span className="block font-bold">{skill.icon} {skill.name}</span><span className="mt-1 block text-nexy-muted">{skill.description || 'Reusable task instructions'}</span></span>
                </label>)}
                {filteredSkills.length === 0 && <p className="text-nexy-muted">No skills match “{skillSearch}”.</p>}
              </div>
            </>}
          </>}
          {tab === 'mcp' && <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-nexy-muted">{draft.mcp.length}/{servers.length} selected</p>
              {onOpenMcp && <Button onClick={() => navigate(onOpenMcp)}>{servers.length ? 'Manage or add MCP capabilities' : 'Open MCP setup'}</Button>}
            </div>
            {servers.length === 0 ? <p className="text-nexy-muted">No MCP servers configured yet.</p> : <>
              <TextField type="search" value={serverSearch} onChange={(event) => setServerSearch(event.target.value)} placeholder="Search MCP servers" aria-label="Search MCP servers" />
              <div className="space-y-2">{filteredServers.map((server) => {
                const entry = draft.mcp.find((item) => item.serverId === server.id)
                return <div key={server.id} className="space-y-2 rounded-nexy-sm border border-nexy-border p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={Boolean(entry)} onChange={() => edit((current) => ({ ...current, mcp: entry ? current.mcp.filter((item) => item.serverId !== server.id) : [...current.mcp, { serverId: server.id, trust: 'always-ask' }] }))} className="mt-0.5 shrink-0 accent-nexy-accent" />
                    <span className="min-w-0 flex-1"><span className="block font-bold">{server.name}</span><span className="mt-1 block text-nexy-muted">{server.status} · {server.toolCount} tools</span></span>
                    {server.status === 'connected' && <Check className="h-4 w-4 shrink-0 text-nexy-success" aria-hidden="true" />}
                  </label>
                  {entry && <SelectField label={`Approval for ${server.name}`} value={entry.trust} onChange={(event) => {
                    const trust = event.target.value as CapabilityTrust
                    edit((current) => ({ ...current, mcp: current.mcp.map((item) => item.serverId === server.id ? { ...item, trust } : item) }))
                  }} className="!text-xs">
                    <option value="always-ask">Ask every time</option>
                    <option value="auto">Auto — no prompt (needed for CLI/agent turns)</option>
                    <option value="block">Blocked</option>
                  </SelectField>}
                </div>
              })}</div>
              {filteredServers.length === 0 && <p className="text-nexy-muted">No MCP servers match “{serverSearch}”.</p>}
            </>}
            {draft.mcp.some((entry) => entry.trust === 'always-ask') && <p className="text-nexy-warning">“Ask every time” servers can't be approved during a headless/CLI turn — set to Auto if the agent needs them without a human present.</p>}
          </>}
          {tab === 'credentials' && <>
            <p className="text-nexy-muted">Grant and Remove apply immediately to this chat, regardless of the selected scope. Secret values are never shown here.</p>
            {chatBindings.length === 0 && <p className="text-nexy-muted">No credentials granted to this chat.</p>}
            {chatBindings.map((binding) => <div key={binding.id} className="flex items-start justify-between gap-3 rounded-nexy-sm border border-nexy-border p-3">
              <span className="min-w-0"><b>{credentials.find((item) => item.id === binding.credentialId)?.name ?? 'Unavailable credential'}</b><span className="mt-1 block text-nexy-muted">{binding.capability} · {binding.expiresAt === null ? 'until removed' : `until ${new Date(binding.expiresAt).toLocaleString()}`}</span></span>
              <Button variant="danger" onClick={() => void writeCredential(() => window.api.credentialBindingDelete(binding.id))}>Remove</Button>
            </div>)}
            {availableCredentials.length ? <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-[1_1_12rem]"><SelectField label="Credential for this chat" value={credentialId} onChange={(event) => setCredentialId(event.target.value)}>
                <option value="">Select a credential…</option>
                {availableCredentials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </SelectField></div>
              <div className="min-w-0 flex-[1_1_8rem]"><SelectField label="Credential grant duration" value={duration} onChange={(event) => setDuration(event.target.value as typeof duration)}>
                <option value="until-removed">Until removed</option><option value="today">Today</option><option value="hour">1 hour</option>
              </SelectField></div>
              <Button variant="primary" disabled={!credentialId} onClick={grantCredential}>Grant</Button>
            </div> : <p className="text-nexy-muted">Add a credential in Settings → Credential Manager before granting it to this chat.</p>}
          </>}
          {tab === 'readiness' && <>
            <p className="text-nexy-muted">Readiness reflects saved capabilities, including inherited project and agent settings. Save your changes to update it.</p>
            {!preflight?.items.length && <p className="text-nexy-muted">No saved capabilities to check.</p>}
            {preflight?.items.map((item) => <div key={`${item.kind}:${item.id}`} className="flex items-start gap-3 rounded-nexy-sm border border-nexy-border p-3">
              {item.status === 'ready' ? <Check className="h-4 w-4 shrink-0 text-nexy-success" aria-hidden="true" /> : <CircleAlert className="h-4 w-4 shrink-0 text-nexy-warning" aria-hidden="true" />}
              <span className="min-w-0"><b>{item.label}</b> — {statusLabel[item.status]}. {item.detail}<span className="mt-1 block text-nexy-muted">Source: {item.provenance}</span></span>
            </div>)}
            {onOpenMcp && preflight?.items.some((item) => item.kind === 'mcp' && item.status !== 'ready') && <Button onClick={() => navigate(onOpenMcp)}>Fix MCP setup</Button>}
            {onOpenSkills && preflight?.items.some((item) => item.kind === 'skill' && item.status !== 'ready') && <Button onClick={() => navigate(onOpenSkills)}>Open Skills</Button>}
          </>}
        </fieldset>}
      </div>
    </ModalShell>
    {pendingAction && <ConfirmDialog
      title="Discard unsaved changes?"
      confirmLabel="Discard"
      irreversible={false}
      onCancel={() => setPendingAction(null)}
      onConfirm={() => { setPendingAction(null); pendingAction() }}
    >Your skill and MCP edits have not been saved.</ConfirmDialog>}
  </>
}
