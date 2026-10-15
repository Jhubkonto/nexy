import { useCallback, useEffect, useState } from 'react'
import type { CredentialKind, CredentialMetadata } from '../../../shared/types'
import { TabHeader } from './TabHeader'
import { NexyIcon } from '../ui/icons/NexyIcon'

type CredentialDraft = {
  name: string
  kind: CredentialKind
  targetOrigin: string
  username: string
  value: string
}

const EMPTY_DRAFT: CredentialDraft = {
  name: '', kind: 'password', targetOrigin: '', username: '', value: '',
}

const KIND_OPTIONS: { value: CredentialKind; label: string; description: string }[] = [
  { value: 'password', label: 'Website login', description: 'Username and password for one exact website origin' },
  { value: 'token', label: 'Access token', description: 'Personal access token or bearer token' },
  { value: 'env-bundle', label: 'Environment secret', description: 'A value for an approved MCP server or workflow' },
  { value: 'secret-file', label: 'Secret file', description: 'Private key, certificate, or other secret file contents' },
  { value: 'api-key', label: 'Generic API key', description: 'A non-LLM API key for an approved consumer' },
]

function kindLabel(kind: CredentialKind): string {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind
}

function formatLastUsed(value: number | null): string {
  return value ? `Last used ${new Date(value).toLocaleDateString()}` : 'Not used yet'
}

/** General-purpose, metadata-only credential-vault UI. Provider keys remain in API Providers. */
export function CredentialsTab() {
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<CredentialDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      // Provider-linked records are deliberately owned by API Providers. The shared vault is
      // an implementation boundary, not a merged product surface.
      setCredentials((await window.api.credentialList()).filter((credential) => credential.provider === null))
    } catch {
      setError('Could not load credentials')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const setKind = (kind: CredentialKind) => {
    setDraft((current) => ({ ...current, kind, targetOrigin: kind === 'password' ? current.targetOrigin : '', username: kind === 'password' ? current.username : '' }))
  }

  const save = async () => {
    setError(null)
    if (!draft.name.trim() || !draft.value) {
      setError('A name and secret value are required')
      return
    }
    if (draft.kind === 'password' && (!draft.targetOrigin.trim() || !draft.username.trim())) {
      setError('Website address, username, and password are required for a website login')
      return
    }
    setBusy(true)
    try {
      await window.api.credentialCreate({
        name: draft.name,
        kind: draft.kind,
        value: draft.value,
        ...(draft.kind === 'password' ? { targetOrigin: draft.targetOrigin, username: draft.username } : {}),
      })
      setDraft(EMPTY_DRAFT)
      setShowAdd(false)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save credential')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (credential: CredentialMetadata) => {
    if (!window.confirm(`Delete “${credential.name}”? This immediately removes all of its access grants.`)) return
    setBusy(true)
    setError(null)
    try {
      await window.api.credentialDelete(credential.id)
      await refresh()
    } catch {
      setError('Could not delete credential')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TabHeader title="Credentials" description="Store reusable secrets locally. Credentials are separate from LLM API provider keys." />

      <div className="rounded-none border-2 border-nexy-info bg-nexy-info/10 p-3 shadow-nexy">
        <p className="text-xs text-nexy-info">Secret values, usernames, and passwords are encrypted on this device and are never shown in chat, exports, or sync metadata.</p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">A credential does nothing by itself: Nexy must grant it to a precise consumer and scope before it can be used.</p>
      </div>

      {error && <p role="alert" className="rounded-none border-2 border-nexy-error bg-nexy-error/10 p-2 text-xs text-nexy-error">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">{credentials.length === 1 ? '1 credential' : `${credentials.length} credentials`}</p>
        <button type="button" onClick={() => { setShowAdd((open) => !open); setError(null) }} className="inline-flex items-center gap-1 border-2 border-nexy-accent bg-nexy-accent px-3 py-1.5 text-xs font-medium text-nexy-on-accent shadow-nexy hover:brightness-110">
          <NexyIcon name={showAdd ? 'close' : 'add'} size={12} /> {showAdd ? 'Cancel' : 'Add credential'}
        </button>
      </div>

      {showAdd && <section className="space-y-3 rounded-none border-2 border-gray-300 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200" htmlFor="credential-kind">Credential type</label>
          <select id="credential-kind" value={draft.kind} onChange={(event) => setKind(event.target.value as CredentialKind)} className="w-full border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-nexy-accent focus:outline-none dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100">
            {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-gray-500">{KIND_OPTIONS.find((option) => option.value === draft.kind)?.description}</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200" htmlFor="credential-name">Name</label>
          <input id="credential-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={draft.kind === 'password' ? 'e.g. Acme support portal' : 'e.g. Personal GitHub token'} className="w-full border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-nexy-accent focus:outline-none dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100" />
        </div>
        {draft.kind === 'password' && <>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200" htmlFor="credential-origin">Website address</label>
            <input id="credential-origin" type="url" value={draft.targetOrigin} onChange={(event) => setDraft((current) => ({ ...current, targetOrigin: event.target.value }))} placeholder="https://support.example.com" className="w-full border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-nexy-accent focus:outline-none dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100" />
            <p className="mt-1 text-[11px] text-gray-500">Only this exact HTTPS origin can ever receive this login through Nexy’s browser broker.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200" htmlFor="credential-username">Username</label>
            <input id="credential-username" autoComplete="username" value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} className="w-full border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-nexy-accent focus:outline-none dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100" />
          </div>
        </>}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200" htmlFor="credential-value">{draft.kind === 'password' ? 'Password' : 'Secret value'}</label>
          <input id="credential-value" type="password" autoComplete={draft.kind === 'password' ? 'current-password' : 'off'} value={draft.value} onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))} className="w-full border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-nexy-accent focus:outline-none dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100" />
        </div>
        <button type="button" disabled={busy} onClick={() => void save()} className="border-2 border-nexy-accent bg-nexy-accent px-3 py-1.5 text-xs font-medium text-nexy-on-accent shadow-nexy hover:brightness-110 disabled:opacity-50">{busy ? 'Saving…' : 'Save credential'}</button>
      </section>}

      <div className="space-y-2">
        {credentials.length === 0 && <div className="border-2 border-dashed border-gray-300 p-4 text-center text-xs text-gray-500 dark:border-gray-600">No credentials saved yet.</div>}
        {credentials.map((credential) => <article key={credential.id} className="flex items-start justify-between gap-3 border-2 border-gray-300 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-gray-900 dark:text-gray-100">{credential.name}</p><span className="border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 dark:border-gray-600 dark:text-gray-300">{kindLabel(credential.kind)}</span>{credential.revokedAt && <span className="border border-nexy-error px-1.5 py-0.5 text-[10px] text-nexy-error">Revoked</span>}</div>
            {credential.targetOrigin && <p className="mt-1 truncate text-xs text-gray-600 dark:text-gray-300">Website: {credential.targetOrigin}</p>}
            <p className="mt-1 text-[11px] text-gray-500">{formatLastUsed(credential.lastUsedAt)}{credential.fingerprint ? ` · ${credential.fingerprint.slice(0, 8)}…` : ''}</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void remove(credential)} className="shrink-0 border border-transparent px-2 py-1 text-xs text-nexy-error hover:border-nexy-error disabled:opacity-50">Delete</button>
        </article>)}
      </div>
    </>
  )
}
