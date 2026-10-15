import { safeStorage } from 'electron'
import { createHash, randomUUID } from 'crypto'
import type {
  CredentialApprovalMode,
  CredentialBindingCreateInput,
  CredentialBindingMetadata,
  CredentialBindingUpdateInput,
  CredentialCreateInput,
  CredentialKind,
  CredentialMetadata,
  CredentialUpdateInput,
} from '../shared/types'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'

interface CredentialRow {
  id: string
  name: string
  kind: CredentialKind
  provider: string | null
  encrypted_payload: string
  payload_encrypted: number
  metadata_json: string
  created_at: number
  updated_at: number
  last_used_at: number | null
  revoked_at: number | null
}

interface CredentialBindingRow {
  id: string
  credential_id: string
  project_id: string | null
  agent_id: string | null
  conversation_id: string | null
  capability: string
  approval_mode: CredentialApprovalMode
  expires_at: number | null
  created_at: number
  updated_at: number
}

/** Opaque reference carried by orchestration code. It never contains a secret value. */
export type ProviderCredentialRef = {
  readonly kind: 'provider-api-key'
  readonly provider: string
  readonly credentialId: string
  readonly bindingId?: string
  /** The resolved scope is retained for main-process re-authorization at dispatch time. */
  readonly scope?: CredentialAccessScope
}

export type CredentialAccessScope = {
  projectId?: string | null
  agentId?: string | null
  conversationId?: string | null
}

export const providerCapability = (provider: string): string => `provider:${provider}`

const CREDENTIAL_KINDS: ReadonlySet<string> = new Set([
  'api-key',
  'token',
  'password',
  'secret-file',
  'env-bundle',
])

function hasVaultTable(): boolean {
  try {
    return Boolean(
      getDatabase()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credentials'")
        .get(),
    )
  } catch {
    // Keeps the provider compatibility layer usable in narrowly mocked/older environments.
    return false
  }
}

export function isCredentialVaultAvailable(): boolean {
  return hasVaultTable()
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
}

function encodePayload(value: string): { payload: string; encrypted: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      payload: safeStorage.encryptString(value).toString('base64'),
      encrypted: true,
    }
  }
  return { payload: value, encrypted: false }
}

function decodePayload(row: Pick<CredentialRow, 'encrypted_payload' | 'payload_encrypted'>): string {
  if (row.payload_encrypted && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(row.encrypted_payload, 'base64'))
  }
  return row.encrypted_payload
}

function parseFingerprint(metadataJson: string): string | null {
  try {
    const metadata = JSON.parse(metadataJson) as { fingerprint?: unknown }
    return typeof metadata.fingerprint === 'string' ? metadata.fingerprint : null
  } catch {
    return null
  }
}

function parseTargetOrigin(metadataJson: string): string | null {
  try {
    const metadata = JSON.parse(metadataJson) as { targetOrigin?: unknown }
    return typeof metadata.targetOrigin === 'string' ? metadata.targetOrigin : null
  } catch {
    return null
  }
}

function normalizeTargetOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Website address must be a valid HTTPS origin')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Website credentials must use an exact HTTPS origin, such as https://example.com')
  }
  return url.origin
}

function encodeCredentialValue(input: Pick<CredentialCreateInput, 'kind' | 'value' | 'username'>): string {
  if (input.kind !== 'password') return input.value
  const username = input.username?.trim()
  if (!username) throw new Error('Username is required for a website login')
  return JSON.stringify({ version: 1, username, password: input.value })
}

function credentialMetadata(value: string, targetOrigin: string | null): string {
  return JSON.stringify({ fingerprint: fingerprint(value), targetOrigin })
}

function toMetadata(row: CredentialRow): CredentialMetadata {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    targetOrigin: parseTargetOrigin(row.metadata_json),
    fingerprint: parseFingerprint(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }
}

function validateKind(kind: string): asserts kind is CredentialKind {
  if (!CREDENTIAL_KINDS.has(kind)) throw new Error(`Unsupported credential kind: ${kind}`)
}

function validateName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('Credential name is required')
  if (normalized.length > 200) throw new Error('Credential name is too long')
  return normalized
}

function getRow(id: string): CredentialRow | undefined {
  return getDatabase()
    .prepare('SELECT * FROM credentials WHERE id = ?')
    .get(id) as CredentialRow | undefined
}

function hasBindingTable(): boolean {
  try {
    return Boolean(getDatabase().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credential_bindings'").get())
  } catch {
    return false
  }
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function validateCapability(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('Credential capability is required')
  if (normalized.length > 160) throw new Error('Credential capability is too long')
  return normalized
}

function validateApprovalMode(value: string): asserts value is CredentialApprovalMode {
  if (value !== 'auto' && value !== 'always-ask') throw new Error(`Unsupported credential approval mode: ${value}`)
}

function bindingMetadata(row: CredentialBindingRow): CredentialBindingMetadata {
  return {
    id: row.id,
    credentialId: row.credential_id,
    projectId: row.project_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    capability: row.capability,
    approvalMode: row.approval_mode,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function bindingIsActive(row: CredentialBindingRow, now = Date.now()): boolean {
  return row.expires_at === null || row.expires_at > now
}

function scopeMatches(row: CredentialBindingRow, scope: CredentialAccessScope): boolean {
  const projectId = normalizeOptionalId(scope.projectId)
  const agentId = normalizeOptionalId(scope.agentId)
  const conversationId = normalizeOptionalId(scope.conversationId)
  return (row.project_id === null || row.project_id === projectId)
    && (row.agent_id === null || row.agent_id === agentId)
    && (row.conversation_id === null || row.conversation_id === conversationId)
}

function hasExplicitBindings(credentialId: string, capability: string): boolean {
  if (!hasBindingTable()) return false
  return Boolean(getDatabase().prepare(
    'SELECT 1 FROM credential_bindings WHERE credential_id = ? AND capability = ? LIMIT 1',
  ).get(credentialId, capability))
}

function selectBinding(
  credentialId: string,
  capability: string,
  scope: CredentialAccessScope,
): CredentialBindingRow | null {
  if (!hasBindingTable()) return null
  const rows = getDatabase().prepare(
    'SELECT * FROM credential_bindings WHERE credential_id = ? AND capability = ? ORDER BY updated_at DESC',
  ).all(credentialId, capability) as CredentialBindingRow[]
  return rows
    .filter((row) => row.approval_mode === 'auto' && bindingIsActive(row) && scopeMatches(row, scope))
    .sort((left, right) => {
      const specificity = (row: CredentialBindingRow) =>
        (row.conversation_id !== null ? 4 : 0) + (row.project_id !== null ? 2 : 0) + (row.agent_id !== null ? 1 : 0)
      return specificity(right) - specificity(left) || right.updated_at - left.updated_at
    })[0] ?? null
}

export function listCredentialMetadata(): CredentialMetadata[] {
  if (!hasVaultTable()) return []
  const rows = getDatabase()
    .prepare('SELECT * FROM credentials ORDER BY name COLLATE NOCASE, created_at')
    .all() as CredentialRow[]
  return rows.map(toMetadata)
}

export function createCredential(input: CredentialCreateInput): CredentialMetadata {
  if (!hasVaultTable()) throw new Error('Credential vault is not available')
  validateKind(input.kind)
  const name = validateName(input.name)
  if (typeof input.value !== 'string' || input.value.length === 0) {
    throw new Error('Credential value is required')
  }
  const targetOrigin = normalizeTargetOrigin(input.targetOrigin)
  if (input.kind === 'password' && !targetOrigin) {
    throw new Error('Website address is required for a website login')
  }
  if (input.kind !== 'password' && targetOrigin) {
    throw new Error('Only website-login credentials can have a website address')
  }

  const now = Date.now()
  const id = randomUUID()
  const payloadValue = encodeCredentialValue(input)
  const encoded = encodePayload(payloadValue)
  const metadata = credentialMetadata(input.value, targetOrigin)
  getDatabase()
    .prepare(`
      INSERT INTO credentials
        (id, name, kind, provider, encrypted_payload, payload_encrypted, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      name,
      input.kind,
      input.provider?.trim() || null,
      encoded.payload,
      encoded.encrypted ? 1 : 0,
      metadata,
      now,
      now,
    )

  return toMetadata(getRow(id)!)
}

export function updateCredential(id: string, input: CredentialUpdateInput): CredentialMetadata {
  if (!hasVaultTable()) throw new Error('Credential vault is not available')
  const existing = getRow(id)
  if (!existing) throw new Error('Credential not found')

  const name = input.name === undefined ? existing.name : validateName(input.name)
  const provider = input.provider === undefined ? existing.provider : input.provider?.trim() || null
  const targetOrigin = input.targetOrigin === undefined ? parseTargetOrigin(existing.metadata_json) : normalizeTargetOrigin(input.targetOrigin)
  if (existing.kind === 'password' && !targetOrigin) throw new Error('Website address is required for a website login')
  if (existing.kind !== 'password' && targetOrigin) throw new Error('Only website-login credentials can have a website address')
  let payload = existing.encrypted_payload
  let payloadEncrypted = existing.payload_encrypted
  let metadataJson = existing.metadata_json
  if (input.value !== undefined) {
    if (!input.value) throw new Error('Credential value is required')
    const payloadValue = encodeCredentialValue({
      kind: existing.kind,
      value: input.value,
      username: input.username,
    })
    const encoded = encodePayload(payloadValue)
    payload = encoded.payload
    payloadEncrypted = encoded.encrypted ? 1 : 0
    metadataJson = credentialMetadata(input.value, targetOrigin)
  } else if (input.targetOrigin !== undefined) {
    metadataJson = credentialMetadata(decodePayload(existing), targetOrigin)
  }

  const now = Date.now()
  const revokedAt = input.revoked === undefined
    ? existing.revoked_at
    : input.revoked ? (existing.revoked_at ?? now) : null
  getDatabase()
    .prepare(`
      UPDATE credentials
      SET name = ?, provider = ?, encrypted_payload = ?, payload_encrypted = ?,
          metadata_json = ?, updated_at = ?, revoked_at = ?
      WHERE id = ?
    `)
    .run(name, provider, payload, payloadEncrypted, metadataJson, now, revokedAt, id)

  return toMetadata(getRow(id)!)
}

export function deleteCredential(id: string): boolean {
  if (!hasVaultTable()) return false
  return getDatabase().prepare('DELETE FROM credentials WHERE id = ?').run(id).changes > 0
}

export function listCredentialBindings(credentialId?: string | null): CredentialBindingMetadata[] {
  if (!hasBindingTable()) return []
  const rows = credentialId
    ? getDatabase().prepare('SELECT * FROM credential_bindings WHERE credential_id = ? ORDER BY capability, created_at').all(credentialId)
    : getDatabase().prepare('SELECT * FROM credential_bindings ORDER BY capability, created_at').all()
  return (rows as CredentialBindingRow[]).map(bindingMetadata)
}

export function createCredentialBinding(input: CredentialBindingCreateInput): CredentialBindingMetadata {
  if (!hasBindingTable()) throw new Error('Credential binding support is not available')
  if (!getRow(input.credentialId)) throw new Error('Credential not found')
  const capability = validateCapability(input.capability)
  const approvalMode = input.approvalMode ?? 'auto'
  validateApprovalMode(approvalMode)
  const expiresAt = input.expiresAt == null ? null : Number(input.expiresAt)
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) throw new Error('Credential binding expiry must be in the future')
  const now = Date.now()
  const id = randomUUID()
  getDatabase().prepare(`
    INSERT INTO credential_bindings
      (id, credential_id, project_id, agent_id, conversation_id, capability, approval_mode, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.credentialId,
    normalizeOptionalId(input.projectId),
    normalizeOptionalId(input.agentId),
    normalizeOptionalId(input.conversationId),
    capability,
    approvalMode,
    expiresAt,
    now,
    now,
  )
  return bindingMetadata(getDatabase().prepare('SELECT * FROM credential_bindings WHERE id = ?').get(id) as CredentialBindingRow)
}

export function updateCredentialBinding(id: string, input: CredentialBindingUpdateInput): CredentialBindingMetadata {
  if (!hasBindingTable()) throw new Error('Credential binding support is not available')
  const existing = getDatabase().prepare('SELECT * FROM credential_bindings WHERE id = ?').get(id) as CredentialBindingRow | undefined
  if (!existing) throw new Error('Credential binding not found')
  const capability = input.capability === undefined ? existing.capability : validateCapability(input.capability)
  const approvalMode = input.approvalMode === undefined ? existing.approval_mode : input.approvalMode
  validateApprovalMode(approvalMode)
  const expiresAt = input.expiresAt === undefined ? existing.expires_at : input.expiresAt == null ? null : Number(input.expiresAt)
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) throw new Error('Credential binding expiry must be in the future')
  const now = Date.now()
  getDatabase().prepare(`
    UPDATE credential_bindings
    SET project_id = ?, agent_id = ?, conversation_id = ?, capability = ?, approval_mode = ?, expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.projectId === undefined ? existing.project_id : normalizeOptionalId(input.projectId),
    input.agentId === undefined ? existing.agent_id : normalizeOptionalId(input.agentId),
    input.conversationId === undefined ? existing.conversation_id : normalizeOptionalId(input.conversationId),
    capability,
    approvalMode,
    expiresAt,
    now,
    id,
  )
  return bindingMetadata(getDatabase().prepare('SELECT * FROM credential_bindings WHERE id = ?').get(id) as CredentialBindingRow)
}

export function deleteCredentialBinding(id: string): boolean {
  if (!hasBindingTable()) return false
  return getDatabase().prepare('DELETE FROM credential_bindings WHERE id = ?').run(id).changes > 0
}

/** Main-process-only secret resolution. Never expose this through IPC. */
export function resolveCredential(id: string): string | null {
  if (!hasVaultTable()) return null
  const row = getRow(id)
  if (!row || row.revoked_at !== null) return null
  const value = decodePayload(row)
  getDatabase().prepare('UPDATE credentials SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
  return value
}

/** Main-process-only provider lookup used by the compatibility provider API. */
export function resolveProviderCredential(provider: string): string | null {
  if (!hasVaultTable()) return null
  const row = getDatabase()
    .prepare("SELECT * FROM credentials WHERE provider = ? AND kind = 'api-key' AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 1")
    .get(provider) as CredentialRow | undefined
  return row ? resolveCredential(row.id) : null
}

/** Returns metadata-only access to the currently selected provider credential. */
export function getProviderCredentialRef(provider: string, scope: CredentialAccessScope = {}): ProviderCredentialRef | null {
  if (!hasVaultTable()) return null
  const rows = getDatabase()
    .prepare("SELECT id FROM credentials WHERE provider = ? AND kind = 'api-key' AND revoked_at IS NULL ORDER BY updated_at DESC")
    .all(provider) as Array<{ id: string }>
  const capability = providerCapability(provider)
  for (const row of rows) {
    const binding = selectBinding(row.id, capability, scope)
    // A credential without explicit bindings retains Phase 1's implicit global access. Once a
    // binding exists, it must match this project/agent and be auto-approved and unexpired.
    if (!hasExplicitBindings(row.id, capability) || binding) {
      return { kind: 'provider-api-key', provider, credentialId: row.id, bindingId: binding?.id, scope }
    }
  }
  return null
}

/** Resolves an opaque provider reference at the final provider-adapter boundary. */
export function resolveProviderCredentialRef(ref: ProviderCredentialRef): string {
  // A reference may live through retries. Recheck its binding immediately before sending the
  // request so revocation, expiry, or a chat deletion takes effect even after preflight.
  if (ref.bindingId) {
    const binding = hasBindingTable()
      ? getDatabase().prepare('SELECT * FROM credential_bindings WHERE id = ?').get(ref.bindingId) as CredentialBindingRow | undefined
      : undefined
    if (!binding || binding.credential_id !== ref.credentialId || binding.capability !== providerCapability(ref.provider)
      || binding.approval_mode !== 'auto' || !bindingIsActive(binding) || !scopeMatches(binding, ref.scope ?? {})) {
      throw new Error(`Credential for provider "${ref.provider}" is not authorized for this chat`)
    }
  }
  const value = resolveCredential(ref.credentialId)
  if (!value) throw new Error(`Credential for provider "${ref.provider}" is unavailable`)
  return value
}

export type ProviderCredentialInput = ProviderCredentialRef | string

/** Compatibility helper for low-level provider tests and legacy integrations. */
export function resolveProviderCredentialInput(input: ProviderCredentialInput): string {
  return typeof input === 'string' ? input : resolveProviderCredentialRef(input)
}

export function upsertProviderCredential(provider: string, value: string): void {
  if (!hasVaultTable()) throw new Error('Credential vault is not available')
  const existing = getDatabase()
    .prepare("SELECT * FROM credentials WHERE provider = ? AND kind = 'api-key' ORDER BY updated_at DESC LIMIT 1")
    .get(provider) as CredentialRow | undefined
  if (existing) {
    updateCredential(existing.id, { value, revoked: false })
    return
  }
  createCredential({ name: `${provider} API key`, kind: 'api-key', provider, value })
}

export function removeProviderCredentials(provider: string): number {
  if (!hasVaultTable()) return 0
  return getDatabase()
    .prepare("DELETE FROM credentials WHERE provider = ? AND kind = 'api-key'")
    .run(provider).changes
}

export function registerCredentialVaultHandlers(): void {
  safeHandle('credential:list', () => listCredentialMetadata())
  safeHandle('credential:create', (_event, input: CredentialCreateInput) => createCredential(input))
  safeHandle('credential:update', (_event, id: string, input: CredentialUpdateInput) => updateCredential(id, input))
  safeHandle('credential:delete', (_event, id: string) => deleteCredential(id))
  safeHandle('credential-binding:list', (_event, credentialId?: string | null) => listCredentialBindings(credentialId))
  safeHandle('credential-binding:create', (_event, input: CredentialBindingCreateInput) => createCredentialBinding(input))
  safeHandle('credential-binding:update', (_event, id: string, input: CredentialBindingUpdateInput) => updateCredentialBinding(id, input))
  safeHandle('credential-binding:delete', (_event, id: string) => deleteCredentialBinding(id))
}
