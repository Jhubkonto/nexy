import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { state, handlers, mockSafeStorage } = vi.hoisted(() => {
  const state: { db: Database.Database | null } = { db: null }
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockSafeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^enc:/, '')),
  }
  return { state, handlers, mockSafeStorage }
})

vi.mock('electron', () => ({ safeStorage: mockSafeStorage }))
vi.mock('../database', () => ({ getDatabase: () => state.db }))
vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
}))

import {
  createCredential,
  createCredentialBinding,
  listCredentialBindings,
  listCredentialMetadata,
  registerCredentialVaultHandlers,
  resolveCredential,
  resolveProviderCredentialInput,
  deleteCredentialBinding,
  getProviderCredentialRef,
} from '../credential-vault'
import { getProviderCredential, retrieveApiKey } from '../provider-secrets'

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  state.db = new Database(':memory:')
  initializeBaseSchema(state.db)
  runMigrations(state.db)
  handlers.clear()
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
  registerCredentialVaultHandlers()
})

describe('credential vault', () => {
  it('stores encrypted payloads while returning metadata without the secret', () => {
    const secret = 'sk-phase-one-secret'
    const metadata = createCredential({
      name: 'OpenAI production',
      kind: 'api-key',
      provider: 'openai',
      value: secret,
    })

    expect(metadata).toMatchObject({ name: 'OpenAI production', kind: 'api-key', provider: 'openai' })
    expect(JSON.stringify(metadata)).not.toContain(secret)
    expect(state.db!.prepare('SELECT encrypted_payload, payload_encrypted FROM credentials WHERE id = ?').get(metadata.id)).toEqual({
      encrypted_payload: Buffer.from(`enc:${secret}`).toString('base64'),
      payload_encrypted: 1,
    })
    expect(resolveCredential(metadata.id)).toBe(secret)
  })

  it('exposes metadata-only credential IPC', () => {
    const secret = 'token-not-for-renderer'
    const created = invoke('credential:create', {
      name: 'Deploy token',
      kind: 'token',
      value: secret,
    }) as ReturnType<typeof createCredential>
    const listed = invoke('credential:list') as ReturnType<typeof listCredentialMetadata>

    expect(created).not.toHaveProperty('value')
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(secret)
  })

  it('stores a website login as an encrypted, exact-origin credential without exposing its username or password', () => {
    const created = createCredential({
      name: 'Acme support',
      kind: 'password',
      targetOrigin: 'https://support.acme.test/',
      username: 'julian@example.test',
      value: 'correct-horse-battery-staple',
    })

    expect(created).toMatchObject({
      name: 'Acme support',
      kind: 'password',
      targetOrigin: 'https://support.acme.test',
    })
    expect(JSON.stringify(created)).not.toContain('julian@example.test')
    expect(JSON.stringify(created)).not.toContain('correct-horse-battery-staple')
    expect(resolveCredential(created.id)).toContain('correct-horse-battery-staple')
    expect(() => createCredential({
      name: 'Unsafe origin', kind: 'password', targetOrigin: 'http://acme.test', username: 'user', value: 'password',
    })).toThrow(/HTTPS origin/i)
  })

  it('moves a legacy provider setting into the vault on first read', () => {
    const secret = 'legacy-provider-secret'
    state.db!.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'byok_anthropic_key',
      Buffer.from(`enc:${secret}`).toString('base64'),
    )
    state.db!.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('byok_anthropic_key_encrypted', 'true')

    expect(retrieveApiKey('anthropic')).toBe(secret)
    expect(state.db!.prepare("SELECT value FROM settings WHERE key = 'byok_anthropic_key'").get()).toBeUndefined()
    expect(state.db!.prepare("SELECT COUNT(*) AS count FROM credentials WHERE provider = 'anthropic'").get()).toEqual({ count: 1 })
    expect(listCredentialMetadata()[0]).not.toHaveProperty('value')
  })

  it('returns an opaque provider reference without resolving the secret', () => {
    const secret = 'sk-reference-only-secret'
    createCredential({ name: 'OpenAI', kind: 'api-key', provider: 'openai', value: secret })

    const ref = getProviderCredential('openai')
    expect(ref).toMatchObject({ kind: 'provider-api-key', provider: 'openai' })
    expect(JSON.stringify(ref)).not.toContain(secret)
    expect(getProviderCredentialRef('openai')).toEqual(ref)
  })

  it('authorizes provider credentials by project and agent binding', () => {
    const created = createCredential({ name: 'Scoped OpenAI', kind: 'api-key', provider: 'openai', value: 'scoped-secret' })
    createCredentialBinding({
      credentialId: created.id,
      projectId: 'project-a',
      agentId: 'agent-a',
      capability: 'provider:openai',
    })

    expect(getProviderCredentialRef('openai', { projectId: 'project-a', agentId: 'agent-a' })).toMatchObject({ credentialId: created.id })
    expect(getProviderCredentialRef('openai', { projectId: 'project-b', agentId: 'agent-a' })).toBeNull()
    expect(JSON.stringify(listCredentialBindings(created.id))).not.toContain('scoped-secret')
  })

  it('limits a credential grant to its exact conversation and rechecks it before dispatch', () => {
    state.db!.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('chat-a', 'Chat A', 1, 1)
    state.db!.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('chat-b', 'Chat B', 1, 1)
    const created = createCredential({ name: 'Chat-only OpenAI', kind: 'api-key', provider: 'openai', value: 'chat-secret' })
    const binding = createCredentialBinding({
      credentialId: created.id,
      conversationId: 'chat-a',
      capability: 'provider:openai',
    })

    const ref = getProviderCredentialRef('openai', { conversationId: 'chat-a' })
    expect(ref).toMatchObject({ credentialId: created.id, bindingId: binding.id })
    expect(getProviderCredentialRef('openai', { conversationId: 'chat-b' })).toBeNull()
    expect(listCredentialBindings(created.id)).toEqual([expect.objectContaining({ conversationId: 'chat-a' })])

    expect(resolveProviderCredentialInput(ref!)).toBe('chat-secret')
    expect(deleteCredentialBinding(binding.id)).toBe(true)
    expect(() => resolveProviderCredentialInput(ref!)).toThrow(/not authorized/i)
  })

  it('cascades a conversation deletion to its credential grants', () => {
    state.db!.pragma('foreign_keys = ON')
    state.db!.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('chat-delete', 'Disposable', 1, 1)
    const created = createCredential({ name: 'Disposable OpenAI', kind: 'api-key', provider: 'openai', value: 'delete-secret' })
    createCredentialBinding({ credentialId: created.id, conversationId: 'chat-delete', capability: 'provider:openai' })

    state.db!.prepare('DELETE FROM conversations WHERE id = ?').run('chat-delete')
    expect(listCredentialBindings(created.id)).toEqual([])
  })

  it('fails closed for expired or always-ask bindings', () => {
    const created = createCredential({ name: 'Restricted OpenAI', kind: 'api-key', provider: 'openai', value: 'restricted-secret' })
    createCredentialBinding({ credentialId: created.id, capability: 'provider:openai', approvalMode: 'always-ask' })
    expect(getProviderCredentialRef('openai')).toBeNull()
  })
})
