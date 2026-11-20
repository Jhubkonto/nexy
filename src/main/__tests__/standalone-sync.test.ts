import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const state = vi.hoisted(() => ({ db: null as Database.Database | null }))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('test database is not ready')
    return state.db
  },
}))

import { handleStandaloneSyncCommand } from '../standalone-sync'
import { deleteSkillConfig, getSkillConfig } from '../skills'
import { readSkillResource } from '../skill-packages'

describe('standalone peer synchronization', () => {
  beforeEach(() => {
    state.db = new Database(':memory:')
    state.db.pragma('foreign_keys = ON')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    state.db.prepare(
      'INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('project-1', 'Desktop name', 'blue', 1, 10)
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  function command(command: string, data: Record<string, unknown>) {
    const payload = command === 'sync:hello'
      ? {
          schemaVersion: 2,
          supportedEntityTypes: ['project', 'agent', 'conversation', 'message', 'wiki', 'prompt', 'skill'],
          attachmentSupport: 'metadata',
          maxBatchSize: 100,
          ...data,
        }
      : data
    const reply = vi.fn()
    expect(handleStandaloneSyncCommand(command, payload, reply)).toBe(true)
    expect(reply).toHaveBeenCalledTimes(1)
    return reply.mock.calls[0][0] as { event: string; data: Record<string, any> }
  }

  it('preserves continuation snapshots and immutable image content in both sync directions', () => {
    const db = state.db!
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('continuity', 'test', 1, 1)").run()
    const continuation = { version: 1, backend: 'openai', status: 'complete', exchange: [], submitted: [
      { type: 'text', text: 'saved attachment and expanded reference' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,c2F2ZWQ=' } },
    ] }
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp, continuation_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run('desktop-user', 'continuity', 'user', 'display text', 1, JSON.stringify(continuation))
    const hello = command('sync:hello', { deviceId: 'continuity-device', datasetId: 'continuity-data', protocolVersion: 1 })
    const snapshot = hello.data.snapshot.messages.find((row: { id: string }) => row.id === 'desktop-user')
    expect(JSON.parse(snapshot.continuation_json)).toEqual(continuation)
    const result = command('sync:push', {
      deviceId: 'continuity-device', datasetId: 'continuity-data', operations: [{
        operationId: 'continuity-upload', deviceId: 'continuity-device', deviceSequence: 1,
        entityType: 'message', entityId: 'android-user', operation: 'upsert', baseRemoteVersion: 0,
        payloadJson: JSON.stringify({ conversationId: 'continuity', role: 'user', content: 'android display', timestamp: 2, continuation }),
      }],
    })
    expect(result.data.conflicts).toEqual([])
    const uploaded = db.prepare("SELECT continuation_json FROM messages WHERE id = 'android-user'").get() as { continuation_json: string }
    expect(JSON.parse(uploaded.continuation_json)).toEqual(continuation)
  })

  it('loads the shared canonical fixture without field loss', () => {
    const fixture = JSON.parse(
      readFileSync(resolve(process.cwd(), 'fixtures/standalone-sync-v1.json'), 'utf8'),
    ) as Record<string, any>
    expect(fixture.schemaVersion).toBe(1)
    expect(Object.keys(fixture.entities)).toEqual([
      'project', 'agent', 'conversation', 'message', 'wiki', 'prompt', 'skill',
    ])
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture)
    expect(fixture.normalizedChatTurn.map((event: Record<string, unknown>) => event.type))
      .toEqual(['turn_started', 'assistant_text_delta', 'turn_completed'])
  })

  it('negotiates protocol and returns a versioned snapshot', () => {
    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    expect(result.event).toBe('sync:welcome')
    expect(result.data.protocolVersion).toBe(1)
    expect(result.data.schemaVersion).toBe(2)
    expect(result.data.attachmentSupport).toBe('metadata')
    expect(result.data.maxBatchSize).toBe(100)
    expect(result.data.snapshot.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'project-1', name: 'Desktop name' })]),
    )
    expect(result.data.snapshot.versions['project:project-1']).toBe(1)
  })

  it('syncs credential metadata and bindings without credential payloads', () => {
    const secret = 'desktop-secret-must-stay-local'
    state.db!.prepare(`
      INSERT INTO credentials
        (id, name, kind, provider, encrypted_payload, payload_encrypted, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'credential-1',
      'Desktop OpenAI',
      'api-key',
      'openai',
      secret,
      1,
      JSON.stringify({ fingerprint: 'fingerprint-1' }),
      1,
      10,
    )
    state.db!.prepare(`
      INSERT INTO credential_bindings
        (id, credential_id, project_id, agent_id, capability, approval_mode, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('binding-1', 'credential-1', 'project-1', null, 'provider:openai', 'auto', null, 1, 10)

    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 2,
    })
    const snapshotJson = JSON.stringify(result.data.snapshot)

    expect(snapshotJson).not.toContain(secret)
    expect(result.data.snapshot.credentials).toEqual([expect.objectContaining({
      id: 'credential-1',
      name: 'Desktop OpenAI',
      provider: 'openai',
      fingerprint: 'fingerprint-1',
    })])
    expect(result.data.snapshot.credentialBindings).toEqual([expect.objectContaining({
      id: 'binding-1',
      credentialId: 'credential-1',
      projectId: 'project-1',
      capability: 'provider:openai',
    })])
  })

  it('returns only desktop changes after a protocol-v2 cursor', () => {
    const initial = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 2,
      lastDesktopSequence: 0,
    })
    expect(initial.data.isDelta).toBe(false)
    expect(initial.data.desktopSequence).toBeGreaterThan(0)

    state.db!.prepare(
      "UPDATE projects SET name = 'Changed once', updated_at = 20 WHERE id = 'project-1'",
    ).run()
    const delta = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 2,
      lastDesktopSequence: initial.data.desktopSequence,
    })
    expect(delta.data.isDelta).toBe(true)
    expect(delta.data.snapshot.projects).toEqual([
      expect.objectContaining({ id: 'project-1', name: 'Changed once' }),
    ])
    expect(delta.data.snapshot.agents).toEqual([])
    expect(delta.data.desktopSequence).toBeGreaterThan(initial.data.desktopSequence)

    const settled = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 2,
      lastDesktopSequence: delta.data.desktopSequence,
    })
    expect(settled.data.isDelta).toBe(true)
    expect(settled.data.snapshot.projects).toEqual([])
    expect(settled.data.snapshot.messages).toEqual([])
  })

  it('acknowledges a transport probe without building a snapshot', () => {
    const result = command('sync:probe', {
      probeId: 'probe-1',
      clientSentAt: 123,
    })

    expect(result.event).toBe('sync:probe-ack')
    expect(result.data.probeId).toBe('probe-1')
    expect(result.data.serverReceivedAt).toEqual(expect.any(Number))
    expect(result.data.snapshot).toBeUndefined()
  })

  it('includes completed_at in the conversations snapshot so Android can preserve mark-complete state on reconnect', () => {
    state.db!.prepare(
      "INSERT INTO conversations (id, title, completed_at, created_at, updated_at) VALUES ('conv-1', 'Done chat', 5000, 1, 10)",
    ).run()

    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    expect(result.data.snapshot.conversations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'conv-1', completed_at: 5000 })]),
    )
  })

  it('bounds reconnect message snapshots while retaining the newest history window', () => {
    state.db!.prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('long-chat', 'Long chat', 1, 100)",
    ).run()
    const insert = state.db!.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    )
    for (let index = 0; index < 80; index += 1) {
      insert.run(`message-${index}`, 'long-chat', index % 2 === 0 ? 'user' : 'assistant', `content-${index}`, index)
    }

    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const messages = result.data.snapshot.messages as Array<{ id: string }>

    expect(messages).toHaveLength(60)
    expect(messages[0].id).toBe('message-20')
    expect(messages.at(-1)?.id).toBe('message-79')
  })

  it('caps the reconnect snapshot to the most-recently-updated conversations', () => {
    const insertConv = state.db!.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    const insertMsg = state.db!.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    )
    // 210 conversations; updated_at ascending with index so the newest 200 are conv-10..conv-209.
    for (let index = 0; index < 210; index += 1) {
      insertConv.run(`conv-${index}`, `Chat ${index}`, 1, index + 1)
      insertMsg.run(`msg-${index}`, `conv-${index}`, 'user', `content-${index}`, index + 1)
    }

    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const conversations = result.data.snapshot.conversations as Array<{ id: string }>
    const messages = result.data.snapshot.messages as Array<{ conversation_id: string }>
    const conversationIds = new Set(conversations.map(c => c.id))

    expect(conversations).toHaveLength(200)
    // Oldest 10 are dropped; the newest window is retained.
    expect(conversationIds.has('conv-9')).toBe(false)
    expect(conversationIds.has('conv-10')).toBe(true)
    expect(conversationIds.has('conv-209')).toBe(true)
    // Messages are only emitted for conversations included in the snapshot.
    expect(messages.every(m => conversationIds.has(m.conversation_id))).toBe(true)
  })

  it('omits bulk message bodies in shell hydration while keeping conversation previews', () => {
    state.db!.prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('shell-chat', 'Shell chat', 1, 100)",
    ).run()
    const insert = state.db!.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    )
    for (let index = 0; index < 40; index += 1) {
      insert.run(`shell-msg-${index}`, 'shell-chat', index % 2 === 0 ? 'user' : 'assistant', `body-${index}`, index)
    }

    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 2,
      hydrationMode: 'shell',
    })

    expect(result.data.hydrationMode).toBe('shell')
    // No bulk message bodies travel in the connect frame…
    expect(result.data.snapshot.messages).toEqual([])
    expect(result.data.snapshot.versions).not.toHaveProperty('message:shell-msg-39')
    // …but the conversation row keeps its last-message preview so list rows still render.
    const conversation = (result.data.snapshot.conversations as Array<{ id: string; last_message: string }>)
      .find(row => row.id === 'shell-chat')
    expect(conversation?.last_message).toBe('body-39')
  })

  it('omits wiki, prompt, and skill bodies in shell hydration (item C)', () => {
    state.db!.prepare(
      'INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('lib-proj', 'Lib project', 'blue', 1, 1)
    state.db!.prepare(
      "INSERT INTO project_wiki_entries (id, project_id, title, body, tags, created_at, updated_at) VALUES ('wiki-1', 'lib-proj', 'W', 'wiki body', '[]', 1, 1)",
    ).run()
    state.db!.prepare(
      "INSERT INTO prompt_library_entries (id, title, body, description, category, tags, scope, created_at, updated_at) VALUES ('prompt-1', 'P', 'prompt body', '', 'Custom', '[]', 'global', 1, 1)",
    ).run()
    state.db!.prepare(
      "INSERT INTO skills (id, config_json, created_at, updated_at) VALUES ('skill-1', '{\"name\":\"S\",\"instructions\":\"skill body\"}', 1, 1)",
    ).run()

    const shell = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 2,
      hydrationMode: 'shell',
    })
    // Library bodies are deferred to wiki:list / prompt:list / skill:list on screen entry…
    expect(shell.data.snapshot.wiki).toEqual([])
    expect(shell.data.snapshot.prompts).toEqual([])
    expect(shell.data.snapshot.skills).toEqual([])
    expect(shell.data.snapshot.versions).not.toHaveProperty('wiki:wiki-1')
    expect(shell.data.snapshot.versions).not.toHaveProperty('prompt:prompt-1')
    expect(shell.data.snapshot.versions).not.toHaveProperty('skill:skill-1')

    // …but a full snapshot still carries them, with their sync versions.
    const full = command('sync:hello', {
      deviceId: 'android-2',
      datasetId: 'dataset-1',
      protocolVersion: 2,
      hydrationMode: 'full',
    })
    expect((full.data.snapshot.wiki as Array<{ id: string }>).some(r => r.id === 'wiki-1')).toBe(true)
    expect((full.data.snapshot.prompts as Array<{ id: string }>).some(r => r.id === 'prompt-1')).toBe(true)
    expect((full.data.snapshot.skills as Array<{ id: string }>).some(r => r.id === 'skill-1')).toBe(true)
    expect(full.data.snapshot.versions).toHaveProperty('wiki:wiki-1')
    expect(full.data.snapshot.versions).toHaveProperty('prompt:prompt-1')
    expect(full.data.snapshot.versions).toHaveProperty('skill:skill-1')
  })

  it('still returns full message bodies when hydration mode is unspecified', () => {
    state.db!.prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('full-chat', 'Full chat', 1, 100)",
    ).run()
    state.db!.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('full-msg', 'full-chat', 'user', 'kept', 1)",
    ).run()

    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 2,
    })

    expect(result.data.hydrationMode).toBe('full')
    expect(result.data.snapshot.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'full-msg', content: 'kept' })]),
    )
  })

  it('applies and acknowledges an idempotent Android operation', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const operation = {
      operationId: 'operation-1',
      deviceId: 'android-1',
      deviceSequence: 1,
      entityType: 'project',
      entityId: 'project-1',
      operation: 'upsert',
      payloadJson: JSON.stringify({
        id: 'project-1',
        name: 'Android name',
        color: 'green',
        createdAt: 1,
        updatedAt: 20,
      }),
      baseRemoteVersion: 1,
    }

    const first = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [operation],
    })
    const replay = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [operation],
    })

    expect(first.data.operationIds).toEqual(['operation-1'])
    expect(first.data.conflicts).toEqual([])
    expect(replay.data.operationIds).toEqual(['operation-1'])
    expect(
      state.db!.prepare('SELECT name, color FROM projects WHERE id = ?').get('project-1'),
    ).toMatchObject({ name: 'Android name', color: 'green' })
    expect(
      state.db!.prepare('SELECT COUNT(*) AS count FROM sync_applied_operations').get(),
    ).toMatchObject({ count: 1 })
  })

  it('materializes complete skill packages pushed from Android', () => {
    command('sync:hello', {
      deviceId: 'android-1', datasetId: 'dataset-1', protocolVersion: 2,
    })
    const skillId = 'synced-package-skill'
    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'skill-package-upsert',
        deviceId: 'android-1',
        deviceSequence: 50,
        entityType: 'skill',
        entityId: skillId,
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: skillId,
          name: 'synced-package',
          description: 'Use when checking synchronized packages.',
          instructions: 'Read references/checklist.md.',
          created_at: 1,
          updated_at: 2,
          packageFiles: [
            { relativePath: 'SKILL.md', encoding: 'utf8', content: 'remote entry is regenerated', sizeBytes: 27 },
            { relativePath: 'references/checklist.md', encoding: 'utf8', content: 'Preserved on desktop.\n', sizeBytes: 22 },
          ],
        }),
        baseRemoteVersion: 0,
      }],
    })

    expect(result.event).toBe('sync:ack')
    const skill = getSkillConfig(skillId)
    expect(skill?.packagePath).toBeTruthy()
    expect(readSkillResource(skill!.packagePath!, 'references/checklist.md')).toBe('Preserved on desktop.\n')

    const snapshot = command('sync:hello', {
      deviceId: 'android-2', datasetId: 'dataset-1', protocolVersion: 2, hydrationMode: 'full',
    })
    const synced = (snapshot.data.snapshot.skills as Array<Record<string, any>>).find(item => item.id === skillId)
    expect(synced!).not.toHaveProperty('packagePath')
    expect(synced!.packageFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'references/checklist.md', encoding: 'utf8', content: 'Preserved on desktop.\n' }),
    ]))
    deleteSkillConfig(skillId)
  })

  it('preserves both versions when the base version is stale', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run('New desktop edit', 30, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-conflict',
        deviceId: 'android-1',
        deviceSequence: 2,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'upsert',
        payloadJson: JSON.stringify({ id: 'project-1', name: 'Android edit', color: 'blue' }),
        baseRemoteVersion: 1,
      }],
    })

    expect(result.data.conflicts).toHaveLength(1)
    expect(
      state.db!.prepare('SELECT name FROM projects WHERE id = ?').get('project-1'),
    ).toMatchObject({ name: 'New desktop edit' })
    expect(
      state.db!.prepare('SELECT COUNT(*) AS count FROM sync_conflicts WHERE resolved_at IS NULL').get(),
    ).toMatchObject({ count: 1 })
  })

  it('automatically merges independent field changes from the same base version', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET color = ?, updated_at = ? WHERE id = ?')
      .run('green', 30, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-merge',
        deviceId: 'android-1',
        deviceSequence: 3,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: 'project-1',
          name: 'Android name',
          color: 'blue',
          config: {},
          createdAt: 1,
          updatedAt: 20,
        }),
        baseRemoteVersion: 1,
      }],
    })

    expect(result.data.conflicts).toEqual([])
    expect(
      state.db!.prepare('SELECT name, color FROM projects WHERE id = ?').get('project-1'),
    ).toMatchObject({ name: 'Android name', color: 'green' })
  })

  it('rejects incompatible protocol versions without mutating device state', () => {
    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 99,
    })

    expect(result.event).toBe('sync:error')
    expect(result.data.code).toBe('unsupported-protocol')
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM sync_devices').get()).toMatchObject({ count: 0 })
  })

  it('rejects incompatible schema versions without mutating device state', () => {
    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
      schemaVersion: 99,
    })

    expect(result.event).toBe('sync:error')
    expect(result.data.code).toBe('unsupported-schema')
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM sync_devices').get()).toMatchObject({ count: 0 })
  })

  it('supports one prior Android sync schema without enabling unsupported attachments', () => {
    const result = command('sync:hello', {
      deviceId: 'android-prior',
      datasetId: 'dataset-1',
      protocolVersion: 1,
      schemaVersion: 1,
      attachmentSupport: 'metadata',
    })

    expect(result.event).toBe('sync:welcome')
    expect(result.data.schemaVersion).toBe(1)
    expect(result.data.attachmentSupport).toBe('none')
  })

  it('records desktop-originated changes with a stable device and monotonic sequence', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run('Desktop changed', 50, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const changes = state.db!.prepare(`
      SELECT sequence, device_id, entity_version FROM sync_desktop_changes
      WHERE dataset_id = ? AND entity_type = 'project' AND entity_id = ?
      ORDER BY sequence
    `).all('dataset-1', 'project-1') as Array<{
      sequence: number
      device_id: string
      entity_version: number
    }>
    expect(changes).toHaveLength(2)
    expect(changes[1].sequence).toBeGreaterThan(changes[0].sequence)
    expect(changes[1].device_id).toBe(changes[0].device_id)
    expect(changes.map(change => change.entity_version)).toEqual([1, 2])
  })

  it('synchronizes conversation archive and in-place message edits', () => {
    state.db!.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES ('conversation-edit', 'Editable', 1, 1)
    `).run()
    state.db!.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, timestamp)
      VALUES ('message-edit', 'conversation-edit', 'user', 'Before', 2)
    `).run()
    const hello = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'archive-conversation',
        deviceId: 'android-1',
        deviceSequence: 40,
        entityType: 'conversation',
        entityId: 'conversation-edit',
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: 'conversation-edit',
          title: 'Editable',
          archived: true,
          createdAt: 1,
          updatedAt: 3,
        }),
        baseRemoteVersion: hello.data.snapshot.versions['conversation:conversation-edit'],
      }, {
        operationId: 'edit-message',
        deviceId: 'android-1',
        deviceSequence: 41,
        entityType: 'message',
        entityId: 'message-edit',
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: 'message-edit',
          conversationId: 'conversation-edit',
          role: 'user',
          content: 'After',
          timestamp: 2,
        }),
        baseRemoteVersion: hello.data.snapshot.versions['message:message-edit'],
      }],
    })

    expect(result.data.conflicts).toEqual([])
    expect(state.db!.prepare('SELECT archived FROM conversations WHERE id = ?').get('conversation-edit'))
      .toMatchObject({ archived: 1 })
    expect(state.db!.prepare('SELECT content FROM messages WHERE id = ?').get('message-edit'))
      .toMatchObject({ content: 'After' })
  })

  it('applies the selected Android value and converges after conflict resolution', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run('Desktop edit', 30, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const conflictResult = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-resolve',
        deviceId: 'android-1',
        deviceSequence: 10,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'upsert',
        payloadJson: JSON.stringify({ id: 'project-1', name: 'Android edit', color: 'blue' }),
        baseRemoteVersion: 1,
      }],
    })
    const conflictId = conflictResult.data.conflicts[0].id

    const resolved = command('sync:resolve-conflict', { conflictId, resolution: 'remote' })

    expect(resolved.event).toBe('sync:conflict-resolved')
    expect(state.db!.prepare('SELECT name FROM projects WHERE id = ?').get('project-1'))
      .toMatchObject({ name: 'Android edit' })
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM sync_conflicts WHERE resolved_at IS NULL').get())
      .toMatchObject({ count: 0 })
  })

  it('preserves a delete-versus-edit conflict for review', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run('Desktop retained edit', 40, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-delete-conflict',
        deviceId: 'android-1',
        deviceSequence: 11,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'delete',
        payloadJson: JSON.stringify({ id: 'project-1', deletedAt: 50 }),
        baseRemoteVersion: 1,
      }],
    })

    expect(result.data.conflicts).toHaveLength(1)
    expect(state.db!.prepare('SELECT name FROM projects WHERE id = ?').get('project-1'))
      .toMatchObject({ name: 'Desktop retained edit' })
  })

  it('excludes secrets and device-local paths in both synchronization directions', () => {
    state.db!.prepare('UPDATE projects SET config_json = ? WHERE id = ?').run(JSON.stringify({
      description: 'portable',
      apiKey: 'desktop-secret',
      rootDirectory: 'C:\\private\\workspace',
      nested: { token: 'pairing-secret', enabled: true },
    }), 'project-1')

    const hello = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const serialized = JSON.stringify(hello.data.snapshot)
    expect(serialized).toContain('portable')
    expect(serialized).not.toContain('desktop-secret')
    expect(serialized).not.toContain('pairing-secret')
    expect(serialized).not.toContain('private')

    command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-secret-filter',
        deviceId: 'android-1',
        deviceSequence: 9,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: 'project-1',
          name: 'Safe project',
          color: 'blue',
          config: {
            description: 'allowed',
            api_key: 'android-secret',
            workspacePath: '/private/mobile',
          },
        }),
        baseRemoteVersion: hello.data.snapshot.versions['project:project-1'],
      }],
    })
    const row = state.db!.prepare('SELECT config_json FROM projects WHERE id = ?').get('project-1') as {
      config_json: string
    }
    expect(JSON.parse(row.config_json)).toEqual({ description: 'allowed' })
  })

  it('resumes content-hashed attachment transfer and serves completed chunks', () => {
    const content = Buffer.from('resumable attachment bytes')
    const hash = createHash('sha256').update(content).digest('hex')
    const first = content.subarray(0, 10)
    const second = content.subarray(10)

    const manifest = command('sync:attachment-manifest', {
      contentHash: hash,
      displayName: 'proof.txt',
      mimeType: 'text/plain',
      sizeBytes: content.length,
      attachmentId: 'attachment-1',
      messageId: 'message-1',
    })
    expect(manifest.data).toMatchObject({ nextOffset: 0, complete: false })

    const partial = command('sync:attachment-chunk', {
      contentHash: hash,
      offset: 0,
      dataBase64: first.toString('base64'),
    })
    expect(partial.data).toMatchObject({ nextOffset: 10, complete: false })

    const resumed = command('sync:attachment-manifest', {
      contentHash: hash,
      displayName: 'proof.txt',
      mimeType: 'text/plain',
      sizeBytes: content.length,
    })
    expect(resumed.data).toMatchObject({ nextOffset: 10, complete: false })

    const complete = command('sync:attachment-chunk', {
      contentHash: hash,
      offset: 10,
      dataBase64: second.toString('base64'),
    })
    expect(complete.data).toMatchObject({ nextOffset: content.length, complete: true })

    const pulled = command('sync:attachment-pull', { contentHash: hash, offset: 0 })
    expect(Buffer.from(pulled.data.dataBase64, 'base64')).toEqual(content)
    expect(pulled.data).toMatchObject({
      displayName: 'proof.txt',
      attachmentId: 'attachment-1',
      messageId: 'message-1',
      complete: true,
    })
  })

  it('orders device sequences and safely replays after a dropped acknowledgement', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const first = {
      operationId: 'ordered-1',
      deviceId: 'android-1',
      deviceSequence: 20,
      entityType: 'project',
      entityId: 'project-1',
      operation: 'upsert',
      payloadJson: JSON.stringify({ id: 'project-1', name: 'First', color: 'blue' }),
      baseRemoteVersion: 1,
    }
    const second = {
      ...first,
      operationId: 'ordered-2',
      deviceSequence: 21,
      payloadJson: JSON.stringify({ id: 'project-1', name: 'Second', color: 'blue' }),
      baseRemoteVersion: 2,
    }

    const applied = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [second, first],
    })
    const replay = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [second, first],
    })

    expect(applied.data.conflicts).toEqual([])
    expect(replay.data.operationIds).toEqual(['ordered-1', 'ordered-2'])
    expect(state.db!.prepare('SELECT name FROM projects WHERE id = ?').get('project-1'))
      .toMatchObject({ name: 'Second' })
  })

  it('rolls back a partial batch when application terminates with an invalid operation', () => {
    const reply = vi.fn()
    expect(() => handleStandaloneSyncCommand('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'partial-valid',
        deviceId: 'android-1',
        deviceSequence: 30,
        entityType: 'project',
        entityId: 'project-new',
        operation: 'upsert',
        payloadJson: JSON.stringify({ id: 'project-new', name: 'Must roll back', color: 'blue' }),
        baseRemoteVersion: 0,
      }, {
        operationId: 'partial-invalid',
        deviceId: 'android-1',
        deviceSequence: 31,
        entityType: 'unsupported',
        entityId: 'invalid',
        operation: 'upsert',
        payloadJson: '{}',
        baseRemoteVersion: 0,
      }],
    }, reply)).toThrow('Unsupported sync entity type')
    expect(state.db!.prepare('SELECT 1 FROM projects WHERE id = ?').get('project-new')).toBeUndefined()
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM sync_applied_operations').get())
      .toMatchObject({ count: 0 })
  })
})
