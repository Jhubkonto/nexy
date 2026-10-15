import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Loader2, Search, ShieldCheck, X } from 'lucide-react'
import type { CapabilityPreflight, CapabilityScope, CapabilityTrust, ConversationCapabilityProfile, CredentialBindingMetadata, CredentialMetadata, McpServerWithStatus, SkillConfig } from '../../shared/types'
import { DropdownPanel } from './DropdownPanel'

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

const statusLabel: Record<CapabilityPreflight['items'][number]['status'], string> = {
  ready: 'Ready',
  missing: 'Needs setup',
  invalid: 'Needs attention',
  disconnected: 'Disconnected',
  unsupported: 'Model unsupported',
}

export function CapabilityPopover({ conversationId, modelId, skills, projectId, projectName, agentId, agentName, onEnsureConversation, onOpenMcp, onOpenSkills, onOpenProjectCapabilities }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [selectedMcp, setSelectedMcp] = useState<Array<{ serverId: string; trust: CapabilityTrust }>>([])
  const [servers, setServers] = useState<McpServerWithStatus[]>([])
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([])
  const [credentialBindings, setCredentialBindings] = useState<CredentialBindingMetadata[]>([])
  const [credentialId, setCredentialId] = useState('')
  const [credentialDuration, setCredentialDuration] = useState<'hour' | 'today' | 'until-removed'>('until-removed')
  const [preflight, setPreflight] = useState<CapabilityPreflight | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null)
  const [scope, setScope] = useState<'chat' | 'project' | 'agent'>('chat')
  const [skillSearch, setSkillSearch] = useState('')
  const activeConversationId = conversationId ?? pendingConversationId
  const availableCredentials = credentials.filter((item) => item.provider === null && item.revokedAt === null)

  const applyProfile = useCallback((profile: ConversationCapabilityProfile | null | undefined) => {
    if (!profile) return
    setSelectedSkillIds(profile.skillIds)
    setSelectedMcp(profile.mcp)
  }, [])

  const refresh = useCallback(async () => {
    if (!activeConversationId) return
    setError(null)
    try {
      const [nextPreflight, nextServers, nextCredentials, nextBindings] = await Promise.all([
        window.api.resolveCapabilities(activeConversationId, modelId),
        window.api.listMcpServers(),
        window.api.credentialList(),
        window.api.credentialBindingList(),
      ])
      // The effective profile is what execution uses, but the controls edit one persisted
      // scope at a time. Rehydrate from that scope so an inherited stricter policy does not
      // make a saved value appear to have been reset.
      applyProfile(nextPreflight.scopeProfiles?.[scope] ?? nextPreflight.profile)
      setPreflight(nextPreflight)
      setServers(nextServers)
      setCredentials(nextCredentials)
      setCredentialBindings(nextBindings)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load capabilities')
    }
  }, [activeConversationId, applyProfile, modelId, scope])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    return window.api.onMcpServerStatusChanged(() => { void refresh() })
  }, [open, refresh])

  const activeCount = selectedSkillIds.length + selectedMcp.length
  const selectedServerIds = useMemo(() => new Set(selectedMcp.map((entry) => entry.serverId)), [selectedMcp])
  const filteredSkills = useMemo(() => {
    const query = skillSearch.trim().toLowerCase()
    if (!query) return skills
    return skills.filter((skill) => `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(query))
  }, [skillSearch, skills])

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const toggleServer = (serverId: string) => {
    setSelectedMcp((current) => current.some((entry) => entry.serverId === serverId)
      ? current.filter((entry) => entry.serverId !== serverId)
      : [...current, { serverId, trust: 'always-ask' }])
  }

  const setServerTrust = (serverId: string, trust: CapabilityTrust) => {
    setSelectedMcp((current) => current.map((entry) => entry.serverId === serverId ? { ...entry, trust } : entry))
  }

  const changeScope = (nextScope: CapabilityScope) => {
    setScope(nextScope)
    applyProfile(preflight?.scopeProfiles?.[nextScope] ?? (nextScope === 'chat' ? preflight?.profile : null))
  }

  const save = async () => {
    if (!activeConversationId) return
    setBusy(true)
    setError(null)
    try {
      const profile = { version: 1 as const, skillIds: selectedSkillIds, mcp: selectedMcp }
      if (scope === 'chat') {
        await window.api.setConversationCapabilities(activeConversationId, profile)
      } else {
        await window.api.activateCapabilities(activeConversationId, { ...profile, scope, targetId: scope === 'project' ? projectId : agentId })
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update capabilities')
    } finally {
      setBusy(false)
    }
  }

  const openMcpSetup = () => {
    setOpen(false)
    onOpenMcp?.()
  }

  const openSkills = () => {
    setOpen(false)
    onOpenSkills?.()
  }

  const openProjectCapabilities = () => {
    setOpen(false)
    onOpenProjectCapabilities?.()
  }

  const grantCredential = async () => {
    if (!activeConversationId || !credentialId) return
    const credential = credentials.find((item) => item.id === credentialId)
    if (!credential || credential.provider !== null || credential.revokedAt !== null) {
      setError('Choose an available credential')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const now = Date.now()
      const expiresAt = credentialDuration === 'hour'
        ? now + 60 * 60 * 1000
        : credentialDuration === 'today'
          ? new Date(new Date(now).setHours(23, 59, 59, 999)).getTime()
          : null
      await window.api.credentialBindingCreate({
        credentialId,
        conversationId: activeConversationId,
        capability: `credential:${credential.id}`,
        approvalMode: 'auto',
        expiresAt,
      })
      setCredentialId('')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not grant credential access')
    } finally {
      setBusy(false)
    }
  }

  const removeCredentialGrant = async (bindingId: string) => {
    setBusy(true)
    setError(null)
    try {
      await window.api.credentialBindingDelete(bindingId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove credential access')
    } finally {
      setBusy(false)
    }
  }

  const toggleOpen = async () => {
    if (!open && !conversationId && !pendingConversationId && onEnsureConversation) {
      const createdId = await onEnsureConversation()
      if (createdId) setPendingConversationId(createdId)
    }
    setOpen((value) => !value)
  }

  return (
    <DropdownPanel
      open={open && Boolean(activeConversationId)}
      onClose={() => setOpen(false)}
      align="right"
      width="w-96 max-w-[calc(100vw-1rem)]"
      className="max-h-[80vh]"
      trigger={
        <button
          type="button"
          onClick={() => void toggleOpen()}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors ${
            open
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'
          }`}
          aria-expanded={open}
          aria-label={`Chat capabilities${activeCount > 0 ? `, ${activeCount} active` : ''}`}
          title="Use skills and MCP tools in this chat without creating an agent"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {activeCount > 0 && <span>{activeCount}</span>}
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
        </button>
      }
    >
      {activeConversationId && (
        <div className="flex max-h-[80vh] flex-col overflow-y-auto p-3 text-left">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Use capabilities in this chat</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">This does not create or modify an agent.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Close capabilities">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <section>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Use this setup</div>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input type="radio" name="capability-scope" checked={scope === 'chat'} onChange={() => changeScope('chat')} className="mt-0.5 accent-blue-600" />
                  <span><span className="block text-xs font-medium text-gray-700 dark:text-gray-200">This chat <span className="font-normal text-blue-600">(recommended)</span></span><span className="block text-[11px] text-gray-500 dark:text-gray-400">One-off use; no agent changes.</span></span>
                </label>
                {projectId && <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input type="radio" name="capability-scope" checked={scope === 'project'} onChange={() => changeScope('project')} className="mt-0.5 accent-blue-600" />
                  <span><span className="block text-xs font-medium text-gray-700 dark:text-gray-200">This project{projectName ? ` · ${projectName}` : ''}</span><span className="block text-[11px] text-gray-500 dark:text-gray-400">Available to future chats in this project.</span></span>
                </label>}
                {/* Project and agent scope only ever add. Say so here, because the checkboxes
                    below look like they can deselect an inherited grant and they cannot. */}
                {scope === 'project' && (
                  <p className="px-2 text-[11px] text-gray-500 dark:text-gray-400">
                    Saving here only adds to the project.{' '}
                    {onOpenProjectCapabilities && (
                      <button type="button" onClick={openProjectCapabilities} className="font-medium text-blue-600 hover:underline">
                        Manage project capabilities
                      </button>
                    )}
                    {onOpenProjectCapabilities ? ' to remove one or loosen its approval level.' : ' Use Project Settings → Capabilities to remove one or loosen its approval level.'}
                  </p>
                )}
                {agentId && <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input type="radio" name="capability-scope" checked={scope === 'agent'} onChange={() => changeScope('agent')} className="mt-0.5 accent-blue-600" />
                  <span><span className="block text-xs font-medium text-gray-700 dark:text-gray-200">This agent{agentName ? ` · ${agentName}` : ''}</span><span className="block text-[11px] text-gray-500 dark:text-gray-400">Reusable defaults for chats using this agent.</span></span>
                </label>}
              </div>
            </section>

            <section>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Credentials</div>
              <p className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">Choose which saved credential this chat may access. Secret values are never shown here.</p>
              {credentialBindings.filter((binding) => binding.conversationId === activeConversationId
                && credentials.some((credential) => credential.id === binding.credentialId && credential.provider === null)).map((binding) => {
                const credential = credentials.find((item) => item.id === binding.credentialId)
                const expiry = binding.expiresAt === null ? 'until removed' : `until ${new Date(binding.expiresAt).toLocaleString()}`
                return <div key={binding.id} className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-800">
                  <span className="min-w-0 text-[11px] text-gray-700 dark:text-gray-200"><b>{credential?.name ?? 'Unavailable credential'}</b> · {binding.capability} · {expiry}</span>
                  <button type="button" disabled={busy} onClick={() => void removeCredentialGrant(binding.id)} className="shrink-0 text-[11px] font-medium text-red-600 hover:underline disabled:opacity-60">Remove</button>
                </div>
              })}
              {availableCredentials.length > 0 ? <div className="flex gap-1.5">
                <select value={credentialId} onChange={(event) => setCredentialId(event.target.value)} aria-label="Credential for this chat" className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200">
                  <option value="">Select a credential…</option>
                  {availableCredentials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select value={credentialDuration} onChange={(event) => setCredentialDuration(event.target.value as typeof credentialDuration)} aria-label="Credential grant duration" className="rounded border border-gray-200 bg-white px-1 py-1 text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200">
                  <option value="until-removed">Until removed</option>
                  <option value="today">Today</option>
                  <option value="hour">1 hour</option>
                </select>
                <button type="button" disabled={busy || !credentialId} onClick={() => void grantCredential()} className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-60">Grant</button>
              </div> : <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Add a credential in Settings → Credential Manager before granting it to this chat.</p>}
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Skills</div>
                {skills.length > 0 && <span className="text-[10px] text-gray-400 dark:text-gray-500">{selectedSkillIds.length}/{skills.length} active</span>}
              </div>
              {skills.length === 0 ? (
                <div className="flex items-center justify-between gap-2"><p className="text-xs text-gray-500 dark:text-gray-400">Import a skill to make it available here.</p>{onOpenSkills && <button type="button" onClick={openSkills} className="shrink-0 text-[11px] font-medium text-blue-600 hover:underline">Open Skills</button>}</div>
              ) : (
                <>
                  <label className="mb-1.5 flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800">
                    <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                    <input
                      type="search"
                      value={skillSearch}
                      onChange={(event) => setSkillSearch(event.target.value)}
                      placeholder="Search skills"
                      aria-label="Search skills"
                      className="min-w-0 flex-1 bg-transparent text-xs text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100"
                    />
                  </label>
                  <div className="max-h-48 overflow-y-auto overscroll-contain pr-1">
                    {filteredSkills.length > 0 ? filteredSkills.map((skill) => (
                      <label key={skill.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                        <input type="checkbox" checked={selectedSkillIds.includes(skill.id)} onChange={() => toggleSkill(skill.id)} className="mt-0.5 accent-blue-600" />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-gray-700 dark:text-gray-200">{skill.icon} {skill.name}</span>
                          <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{skill.description || 'Reusable task instructions'}</span>
                        </span>
                      </label>
                    )) : <p className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400">No skills match “{skillSearch}”.</p>}
                  </div>
                </>
              )}
            </section>

            <section>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">MCP tools</div>
              {servers.length === 0 ? (
                <div className="flex items-center justify-between gap-2"><p className="text-xs text-gray-500 dark:text-gray-400">No MCP servers configured yet.</p>{onOpenMcp && <button type="button" onClick={openMcpSetup} className="shrink-0 text-[11px] font-medium text-blue-600 hover:underline">Open MCP setup</button>}</div>
              ) : <div className="max-h-40 overflow-y-auto overscroll-contain pr-1">{servers.map((server) => {
                const entry = selectedMcp.find((e) => e.serverId === server.id)
                return (
                  <div key={server.id} className="rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={selectedServerIds.has(server.id)} onChange={() => toggleServer(server.id)} className="accent-blue-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-gray-700 dark:text-gray-200">{server.name}</span>
                        <span className="block text-[11px] text-gray-500 dark:text-gray-400">{server.status} · {server.toolCount} tools</span>
                      </span>
                      {server.status === 'connected' && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                    </label>
                    {entry && (
                      <div className="mt-1 flex items-center gap-1.5 pl-6">
                        <span className="text-[10px] text-gray-400">Approval:</span>
                        <select
                          value={entry.trust}
                          onChange={(event) => setServerTrust(server.id, event.target.value as CapabilityTrust)}
                          className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                        >
                          <option value="always-ask">Ask every time</option>
                          <option value="auto">Auto — no prompt (needed for CLI/agent turns)</option>
                          <option value="block">Blocked</option>
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}</div>}
              {selectedMcp.some((entry) => entry.trust === 'always-ask') && <p className="mt-1 px-2 text-[11px] text-amber-600 dark:text-amber-300">"Ask every time" servers can't be approved during a headless/CLI turn — set to Auto if the agent needs them without a human present.</p>}
              {onOpenMcp && servers.length > 0 && <button type="button" onClick={openMcpSetup} className="mt-1 px-2 text-[11px] font-medium text-blue-600 hover:underline">Manage or add MCP capabilities</button>}
            </section>

            {preflight && preflight.items.length > 0 && (
              <section className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Readiness</div>
                {preflight.items.map((item) => (
                  <div key={`${item.kind}:${item.id}`} className="flex items-start gap-2 py-1 text-[11px]">
                    {item.status === 'ready' ? <Check className="mt-0.5 h-3 w-3 text-emerald-500" /> : <CircleAlert className="mt-0.5 h-3 w-3 text-amber-500" />}
                    <span className="min-w-0"><b>{item.label}</b> — {statusLabel[item.status]}. {item.detail} <span className="text-gray-400">({item.provenance})</span></span>
                  </div>
                ))}
                {onOpenMcp && preflight.items.some((item) => item.kind === 'mcp' && item.status !== 'ready') && <button type="button" onClick={openMcpSetup} className="mt-1 px-2 text-[11px] font-medium text-blue-600 hover:underline">Fix MCP setup</button>}
              </section>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button type="button" onClick={() => void save()} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? 'Saving…' : scope === 'chat' ? 'Use in this chat' : scope === 'project' ? 'Add to project' : 'Attach to agent'}
          </button>
        </div>
      )}
    </DropdownPanel>
  )
}
