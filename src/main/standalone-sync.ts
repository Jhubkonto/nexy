import { createHash, randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabase } from './database'
import type { WsReply } from './ws-server'
import { normalizeProjectColor } from '../shared/project-colors'
import {
  deleteSkillConfig,
  getSkillConfigForTransport,
  listSkillConfigsForTransport,
  upsertSyncedSkillConfig,
} from './skills'

export const STANDALONE_SYNC_PROTOCOL_VERSION = 2
const SUPPORTED_SYNC_PROTOCOL_VERSIONS = [1, STANDALONE_SYNC_PROTOCOL_VERSION] as const
export const STANDALONE_SYNC_SCHEMA_VERSION = 2
const SUPPORTED_SYNC_SCHEMA_VERSIONS = [1, STANDALONE_SYNC_SCHEMA_VERSION] as const
const SUPPORTED_ENTITY_TYPES = ['project', 'agent', 'conversation', 'message', 'wiki', 'prompt', 'skill'] as const
const MAX_SYNC_BATCH_SIZE = 100

// Hydration modes negotiated in sync:hello (item B — "shell then hydrate").
//   'full'  — legacy behavior: the connect snapshot inlines up to SNAPSHOT_MESSAGES_PER_CONVERSATION
//             message bodies for the most-recent SNAPSHOT_MAX_CONVERSATIONS conversations.
//   'shell' — metadata only: conversation rows (with their inlined `last_message` preview),
//             projects and agents, but NO bulk message bodies AND no wiki / prompt / skill bodies.
//             Message bodies hydrate on demand through conversation:get-messages when a chat is
//             opened; wiki / prompt / skill bodies hydrate through wiki:list / prompt:list /
//             skill:list when their screen (or a prompt/skill picker) is opened (item C). Every
//             Android consumer of those library entities already fetches them lazily and caches the
//             result in Room, and standalone chat never reads them, so omitting them from the
//             connect frame leaves no screen unpopulated.
// A single long chat history could otherwise push ~12k message blocks into one WebSocket frame on
// every reconnect; shell mode keeps the connect frame tiny so Home renders "Live" almost instantly.
// Older Android builds omit the field and default to 'full', so the change is backward compatible.
type HydrationMode = 'full' | 'shell'
const SUPPORTED_HYDRATION_MODES: readonly HydrationMode[] = ['full', 'shell']

function negotiateHydrationMode(value: unknown): HydrationMode {
  return SUPPORTED_HYDRATION_MODES.includes(value as HydrationMode) ? (value as HydrationMode) : 'full'
}
// A reconnect snapshot is a hydration window, not a full conversation export. Sending every
// message makes the WebSocket frame and Android's JSON object graph grow without bound; a single
// long-running chat can then exhaust the mobile heap while the home screen shows "Syncing".
// Older rows remain available through conversation:get-messages pagination and are cached locally
// when viewed.
const SNAPSHOT_MESSAGES_PER_CONVERSATION = 60
// The per-conversation message cap bounds each chat, but the snapshot still grew linearly with the
// total number of conversations — hundreds of chats meant hundreds of (up to 60) message blocks in
// one WebSocket frame, spiking Android's allocation on connect. Cap the initial hydration window to
// the most-recently-updated conversations; older ones page in through conversation:get-messages and
// the on-demand conversation list. Mirrors SNAPSHOT_MESSAGES_PER_CONVERSATION.
const SNAPSHOT_MAX_CONVERSATIONS = 200

interface SyncOperation {
  operationId: string
  deviceId: string
  deviceSequence: number
  entityType: string
  entityId: string
  operation: 'upsert' | 'delete'
  payloadJson: string
  baseRemoteVersion: number
}

interface EntityVersionRow {
  version: number
  source_updated_at: number
}

export function handleStandaloneSyncCommand(
  command: string,
  data: Record<string, unknown>,
  reply: WsReply,
): boolean {
  if (!command.startsWith('sync:')) return false
  if (command === 'sync:probe') {
    reply({
      event: 'sync:probe-ack',
      data: {
        probeId: requiredString(data.probeId, 'probeId'),
        serverReceivedAt: Date.now(),
      },
    })
    return true
  }
  if (command === 'sync:hello') {
    handleHello(data, reply)
    return true
  }
  if (command === 'sync:push') {
    handlePush(data, reply)
    return true
  }
  if (command === 'sync:resolve-conflict') {
    handleResolveConflict(data, reply)
    return true
  }
  if (command === 'sync:snapshot-ack') {
    handleSnapshotAck(data)
    return true
  }
  if (command === 'sync:attachment-manifest') {
    handleAttachmentManifest(data, reply)
    return true
  }
  if (command === 'sync:attachment-chunk') {
    handleAttachmentChunk(data, reply)
    return true
  }
  if (command === 'sync:attachment-pull') {
    handleAttachmentPull(data, reply)
    return true
  }
  reply({
    event: 'sync:error',
    data: { code: 'unknown-command', message: `Unsupported sync command: ${command}` },
  })
  return true
}

function handleHello(data: Record<string, unknown>, reply: WsReply): void {
  const deviceId = requiredString(data.deviceId, 'deviceId')
  const datasetId = requiredString(data.datasetId, 'datasetId')
  const requestedVersion = numberValue(data.protocolVersion, 0)
  if (!SUPPORTED_SYNC_PROTOCOL_VERSIONS.includes(requestedVersion as 1 | 2)) {
    reply({
      event: 'sync:error',
      data: {
        code: 'unsupported-protocol',
        message: `Desktop supports sync protocols ${SUPPORTED_SYNC_PROTOCOL_VERSIONS.join(', ')}; Android requested ${requestedVersion}.`,
        supportedProtocolVersion: STANDALONE_SYNC_PROTOCOL_VERSION,
      },
    })
    return
  }
  const requestedSchema = numberValue(data.schemaVersion, 0)
  if (!SUPPORTED_SYNC_SCHEMA_VERSIONS.includes(requestedSchema as 1 | 2)) {
    reply({
      event: 'sync:error',
      data: {
        code: 'unsupported-schema',
        message: `Desktop supports sync schemas ${SUPPORTED_SYNC_SCHEMA_VERSIONS.join(', ')}; Android requested ${requestedSchema}.`,
        supportedSchemaVersion: STANDALONE_SYNC_SCHEMA_VERSION,
      },
    })
    return
  }
  const requestedEntities = stringArray(data.supportedEntityTypes)
  const negotiatedEntities = SUPPORTED_ENTITY_TYPES.filter(type => requestedEntities.includes(type))
  if (negotiatedEntities.length === 0) {
    reply({ event: 'sync:error', data: { code: 'no-common-entities', message: 'No synchronized entity types are shared.' } })
    return
  }
  const requestedBatchSize = numberValue(data.maxBatchSize, MAX_SYNC_BATCH_SIZE)
  const maxBatchSize = Math.max(1, Math.min(MAX_SYNC_BATCH_SIZE, requestedBatchSize))
  const attachmentSupport =
    requestedSchema >= 2 && data.attachmentSupport === 'metadata' ? 'metadata' : 'none'
  const hydrationMode = negotiateHydrationMode(data.hydrationMode)

  const db = getDatabase()
  const now = Date.now()
  db.prepare(`
    INSERT INTO sync_devices (id, dataset_id, name, protocol_version, last_seen_at, last_received_sequence)
    VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
      dataset_id = excluded.dataset_id,
      name = excluded.name,
      protocol_version = excluded.protocol_version,
      last_seen_at = excluded.last_seen_at
  `).run(deviceId, datasetId, stringValue(data.deviceName) ?? 'Nexy Android', requestedVersion, now)

  const syncPayload = buildSyncSnapshot(
    db,
    datasetId,
    requestedVersion >= 2 ? numberValue(data.lastDesktopSequence, 0) : 0,
    hydrationMode,
  )
  reply({
    event: 'sync:welcome',
    data: {
      protocolVersion: requestedVersion,
      schemaVersion: requestedSchema,
      supportedEntityTypes: negotiatedEntities,
      attachmentSupport,
      hydrationMode,
      maxBatchSize,
      desktopDeviceId: desktopDeviceId(db),
      datasetId,
      desktopSequence: syncPayload.desktopSequence,
      isDelta: syncPayload.isDelta,
      snapshot: syncPayload.snapshot,
    },
  })
}

function handlePush(data: Record<string, unknown>, reply: WsReply): void {
  const deviceId = requiredString(data.deviceId, 'deviceId')
  const datasetId = requiredString(data.datasetId, 'datasetId')
  const rawOperations = Array.isArray(data.operations) ? data.operations : []
  const operations = rawOperations.map(parseOperation)
    .sort((left, right) => left.deviceSequence - right.deviceSequence)
  if (operations.length > MAX_SYNC_BATCH_SIZE) {
    throw new Error(`Sync batches are limited to ${MAX_SYNC_BATCH_SIZE} operations`)
  }

  const db = getDatabase()
  const acknowledged: string[] = []
  const conflicts: Record<string, unknown>[] = []
  let lastSequence = 0
  const applyBatch = db.transaction(() => {
    for (const operation of operations) {
      if (operation.deviceId !== deviceId) throw new Error('Operation device identity mismatch')
      lastSequence = Math.max(lastSequence, operation.deviceSequence)
      const alreadyApplied = db.prepare(
        'SELECT 1 FROM sync_applied_operations WHERE operation_id = ? OR (device_id = ? AND device_sequence = ?)',
      ).get(operation.operationId, deviceId, operation.deviceSequence)
      if (alreadyApplied) {
        acknowledged.push(operation.operationId)
        continue
      }

      const currentVersion = entityVersion(db, datasetId, operation.entityType, operation.entityId)
      if (operation.baseRemoteVersion !== currentVersion) {
        const merged = tryMergeIndependentFields(db, datasetId, operation, currentVersion)
        if (merged) {
          applyOperation(db, datasetId, merged, currentVersion + 1)
          markOperationApplied(db, operation)
          acknowledged.push(operation.operationId)
          continue
        }
        const conflict = recordConflict(db, datasetId, operation, currentVersion)
        conflicts.push(conflict)
        markOperationApplied(db, operation)
        acknowledged.push(operation.operationId)
        continue
      }

      applyOperation(db, datasetId, operation, currentVersion + 1)
      markOperationApplied(db, operation)
      acknowledged.push(operation.operationId)
    }
    db.prepare(`
      UPDATE sync_devices
      SET last_seen_at = ?, last_received_sequence = MAX(last_received_sequence, ?)
      WHERE id = ? AND dataset_id = ?
    `).run(Date.now(), lastSequence, deviceId, datasetId)
  })
  applyBatch()

  const requestedVersion = numberValue(data.protocolVersion, 1)
  const syncPayload = buildSyncSnapshot(
    db,
    datasetId,
    requestedVersion >= 2 ? numberValue(data.lastDesktopSequence, 0) : 0,
    negotiateHydrationMode(data.hydrationMode),
  )
  reply({
    event: 'sync:ack',
    data: {
      operationIds: acknowledged,
      lastReceivedSequence: lastSequence,
      conflicts,
      desktopSequence: syncPayload.desktopSequence,
      isDelta: syncPayload.isDelta,
      snapshot: syncPayload.snapshot,
    },
  })
}

function buildSyncSnapshot(
  db: Database.Database,
  datasetId: string,
  lastDesktopSequence: number,
  hydrationMode: HydrationMode = 'full',
): { snapshot: Record<string, unknown>; desktopSequence: number; isDelta: boolean } {
  // Scanning also advances entity versions for desktop-side writes that did not originate in
  // standalone sync. The returned delta then avoids transferring and re-applying unchanged rows.
  const full = buildSnapshot(db, datasetId, hydrationMode)
  const sequenceRow = db.prepare(
    'SELECT MIN(sequence) AS minSequence, MAX(sequence) AS maxSequence FROM sync_desktop_changes WHERE dataset_id = ?',
  ).get(datasetId) as { minSequence: number | null; maxSequence: number | null }
  const desktopSequence = sequenceRow.maxSequence ?? 0
  if (
    lastDesktopSequence <= 0 ||
    lastDesktopSequence > desktopSequence ||
    (sequenceRow.minSequence != null && lastDesktopSequence < sequenceRow.minSequence - 1)
  ) {
    return { snapshot: full, desktopSequence, isDelta: false }
  }

  const changes = db.prepare(`
    SELECT entity_type AS entityType, entity_id AS entityId
    FROM sync_desktop_changes
    WHERE dataset_id = ? AND sequence > ?
    ORDER BY sequence
  `).all(datasetId, lastDesktopSequence) as Array<{ entityType: string; entityId: string }>
  const changed = new Set(changes.map(change => `${change.entityType}:${change.entityId}`))
  const versions = full.versions as Record<string, number>
  const filteredVersions = Object.fromEntries(
    Object.entries(versions).filter(([key]) => changed.has(key)),
  )
  const filterRows = (key: string, type: string): unknown[] =>
    ((full[key] as Array<Record<string, unknown>>) ?? []).filter(row => changed.has(`${type}:${String(row.id)}`))
  return {
    desktopSequence,
    isDelta: true,
    snapshot: {
      projects: filterRows('projects', 'project'),
      agents: filterRows('agents', 'agent'),
      conversations: filterRows('conversations', 'conversation'),
      messages: filterRows('messages', 'message'),
      wiki: filterRows('wiki', 'wiki'),
      prompts: filterRows('prompts', 'prompt'),
      skills: filterRows('skills', 'skill'),
      // Credential metadata is small and read-only on Android. Include the complete current
      // metadata set in deltas so revocations and binding changes are never missed.
      credentials: full.credentials,
      credentialBindings: full.credentialBindings,
      attachments: full.attachments,
      versions: filteredVersions,
      tombstones: full.tombstones,
      conflicts: full.conflicts,
    },
  }
}

function handleResolveConflict(data: Record<string, unknown>, reply: WsReply): void {
  const conflictId = requiredString(data.conflictId, 'conflictId')
  const resolution = requiredString(data.resolution, 'resolution')
  if (!['local', 'remote'].includes(resolution)) throw new Error('Invalid conflict resolution')
  const db = getDatabase()
  const conflict = db.prepare('SELECT * FROM sync_conflicts WHERE id = ? AND resolved_at IS NULL').get(conflictId) as
    | Record<string, unknown>
    | undefined
  if (!conflict) {
    reply({ event: 'sync:conflict-resolved', data: { conflictId, alreadyResolved: true } })
    return
  }
  if (resolution === 'remote') {
    const operation = parseOperation(JSON.parse(String(conflict.remote_payload_json)))
    const currentVersion = entityVersion(db, String(conflict.dataset_id), operation.entityType, operation.entityId)
    applyOperation(db, String(conflict.dataset_id), operation, currentVersion + 1)
  }
  db.prepare('UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE id = ?')
    .run(Date.now(), resolution, conflictId)
  reply({ event: 'sync:conflict-resolved', data: { conflictId, resolution } })
}

function handleSnapshotAck(data: Record<string, unknown>): void {
  const datasetId = requiredString(data.datasetId, 'datasetId')
  const tombstones = Array.isArray(data.tombstones) ? data.tombstones : []
  const db = getDatabase()
  const acknowledge = db.transaction(() => {
    for (const value of tombstones) {
      const item = objectValue(value)
      const entityType = requiredString(item.entityType, 'entityType')
      const entityId = requiredString(item.entityId, 'entityId')
      const version = numberValue(item.version, 0)
      db.prepare(`
        UPDATE sync_tombstones SET acknowledged_at = ?
        WHERE dataset_id = ? AND entity_type = ? AND entity_id = ? AND version <= ?
      `).run(Date.now(), datasetId, entityType, entityId, version)
    }
    db.prepare('DELETE FROM sync_tombstones WHERE dataset_id = ? AND acknowledged_at IS NOT NULL')
      .run(datasetId)
    // One paired Android is supported in v1. Retain the newest five baselines per entity plus
    // every version referenced by an unresolved conflict.
    db.exec(`
      DELETE FROM sync_entity_history
      WHERE rowid IN (
        SELECT history.rowid
        FROM sync_entity_history history
        JOIN sync_entity_versions current
          ON current.dataset_id = history.dataset_id
         AND current.entity_type = history.entity_type
         AND current.entity_id = history.entity_id
        WHERE history.dataset_id = ${sqlQuote(datasetId)}
          AND history.version < current.version - 4
          AND NOT EXISTS (
            SELECT 1 FROM sync_conflicts conflict
            WHERE conflict.dataset_id = history.dataset_id
              AND conflict.entity_type = history.entity_type
              AND conflict.entity_id = history.entity_id
              AND conflict.resolved_at IS NULL
              AND history.version IN (conflict.local_version, conflict.remote_version)
          )
      )
    `)
  })
  acknowledge()
}

function handleAttachmentManifest(data: Record<string, unknown>, reply: WsReply): void {
  const hash = attachmentHash(data.contentHash)
  const size = numberValue(data.sizeBytes, -1)
  if (size < 0 || size > 20 * 1024 * 1024) throw new Error('Attachment size is outside the 20 MB limit')
  const db = getDatabase()
  db.prepare(`
    INSERT INTO sync_attachments (
      content_hash, display_name, mime_type, size_bytes, content, received_bytes, updated_at,
      attachment_id, message_id
    ) VALUES (?, ?, ?, ?, X'', 0, ?, ?, ?)
    ON CONFLICT(content_hash) DO UPDATE SET
      display_name = excluded.display_name,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      attachment_id = COALESCE(excluded.attachment_id, sync_attachments.attachment_id),
      message_id = COALESCE(excluded.message_id, sync_attachments.message_id),
      updated_at = excluded.updated_at
  `).run(
    hash,
    stringValue(data.displayName) ?? 'attachment',
    stringValue(data.mimeType) ?? 'application/octet-stream',
    size,
    Date.now(),
    stringValue(data.attachmentId),
    stringValue(data.messageId),
  )
  const row = db.prepare(
    'SELECT received_bytes, completed_at FROM sync_attachments WHERE content_hash = ?',
  ).get(hash) as { received_bytes: number; completed_at: number | null }
  reply({
    event: 'sync:attachment-status',
    data: { contentHash: hash, nextOffset: row.received_bytes, complete: row.completed_at != null },
  })
}

function handleAttachmentChunk(data: Record<string, unknown>, reply: WsReply): void {
  const hash = attachmentHash(data.contentHash)
  const offset = numberValue(data.offset, -1)
  const chunk = Buffer.from(requiredString(data.dataBase64, 'dataBase64'), 'base64')
  if (chunk.length > 64 * 1024) throw new Error('Attachment chunks are limited to 64 KB')
  const db = getDatabase()
  let nextOffset = 0
  let complete = false
  db.transaction(() => {
    const row = db.prepare(`
      SELECT size_bytes, content, received_bytes, completed_at
      FROM sync_attachments WHERE content_hash = ?
    `).get(hash) as { size_bytes: number; content: Buffer; received_bytes: number; completed_at: number | null } | undefined
    if (!row) throw new Error('Attachment manifest must be sent before chunks')
    if (row.completed_at != null) {
      nextOffset = row.received_bytes
      complete = true
      return
    }
    if (offset !== row.received_bytes) {
      nextOffset = row.received_bytes
      return
    }
    const content = Buffer.concat([Buffer.from(row.content), chunk])
    if (content.length > row.size_bytes) throw new Error('Attachment exceeds its declared size')
    complete = content.length === row.size_bytes
    if (complete && createHash('sha256').update(content).digest('hex') !== hash) {
      throw new Error('Attachment content hash mismatch')
    }
    db.prepare(`
      UPDATE sync_attachments
      SET content = ?, received_bytes = ?, completed_at = ?, updated_at = ?
      WHERE content_hash = ?
    `).run(content, content.length, complete ? Date.now() : null, Date.now(), hash)
    nextOffset = content.length
  })()
  reply({ event: 'sync:attachment-status', data: { contentHash: hash, nextOffset, complete } })
}

function handleAttachmentPull(data: Record<string, unknown>, reply: WsReply): void {
  const hash = attachmentHash(data.contentHash)
  const offset = Math.max(0, numberValue(data.offset, 0))
  const db = getDatabase()
  const row = db.prepare(`
    SELECT display_name, mime_type, size_bytes, content, attachment_id, message_id
    FROM sync_attachments WHERE content_hash = ? AND completed_at IS NOT NULL
  `).get(hash) as {
    display_name: string; mime_type: string; size_bytes: number; content: Buffer
    attachment_id: string | null; message_id: string | null
  } | undefined
  if (!row) throw new Error('Attachment is unavailable')
  const content = Buffer.from(row.content)
  const chunk = content.subarray(offset, Math.min(offset + 64 * 1024, content.length))
  reply({
    event: 'sync:attachment-chunk',
    data: {
      contentHash: hash,
      displayName: row.display_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      attachmentId: row.attachment_id,
      messageId: row.message_id,
      offset,
      dataBase64: chunk.toString('base64'),
      complete: offset + chunk.length === content.length,
    },
  })
}

function buildSnapshot(
  db: Database.Database,
  datasetId: string,
  hydrationMode: HydrationMode = 'full',
): Record<string, unknown> {
  const includeMessageBodies = hydrationMode === 'full'
  // Item C: shell hydration also defers the project wiki, prompt library, and skill bodies. See the
  // HydrationMode comment above for why this is safe; mirrors the message-body deferral below.
  const includeLibraryBodies = hydrationMode === 'full'
  const projects = (db.prepare(`
    SELECT id, name, color, config_json, default_model, project_hermes_profile, created_at, updated_at
    FROM projects ORDER BY updated_at, id
  `).all() as Record<string, unknown>[]).map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    config: sanitizeSyncValue(parseJsonValue(row.config_json, {})),
    defaultModel: row.default_model,
    projectHermesProfile: row.project_hermes_profile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  const agents = (db.prepare(`
    SELECT id, config_json, created_at, updated_at
    FROM agents ORDER BY updated_at, id
  `).all() as Record<string, unknown>[]).map(row => ({
    ...objectValue(sanitizeSyncValue(parseJsonValue(row.config_json, {}))),
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  const conversationIds = (db.prepare(`
    SELECT id FROM conversations ORDER BY updated_at DESC, id DESC LIMIT ?
  `).all(SNAPSHOT_MAX_CONVERSATIONS) as Array<{ id: string }>).map(row => row.id)
  const conversations = conversationIds.length === 0 ? [] : db.prepare(`
    SELECT c.id, c.title, c.agent_id, c.project_id, c.model, c.conversation_hermes_profile, c.pinned, c.archived, c.completed_at,
           c.thinking_effort_override, c.full_auto_approve_override, c.agentic_mode_override,
           c.terminal_sandbox_override, c.cli_mode_override, c.codex_execution_mode_override,
           c.kind, c.created_at, c.updated_at,
           json_extract(a.config_json, '$.name') AS agent_name,
           json_extract(a.config_json, '$.icon') AS agent_icon,
           p.name AS project_name,
           (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
    FROM conversations c
    LEFT JOIN agents a ON a.id = c.agent_id
    LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.id IN (${conversationIds.map(() => '?').join(',')})
    ORDER BY c.updated_at, c.id
  `).all(...conversationIds) as Record<string, unknown>[]
  // A single windowed query (PARTITION BY conversation_id) forces SQLite to sort every message
  // row in the snapshot window before ranking, ignoring the idx_messages_conversation index. Since
  // that index already orders rows per-conversation, fetching each conversation's most recent slice
  // with an indexed ORDER BY + LIMIT is a index range scan instead of a full sort.
  // Shell hydration ships zero message bodies — chats hydrate on demand via conversation:get-messages.
  // The conversation rows above still carry their `last_message` preview, so Home/Projects list rows
  // stay fully rendered; only the bulk per-conversation history is deferred.
  const messagesStmt = db.prepare(`
    SELECT id, conversation_id, role, content, model, provider, finish_reason, attachments, thinking_blocks, text_segments,
           input_tokens, output_tokens, timestamp
    FROM messages
    WHERE conversation_id = ?
    ORDER BY timestamp DESC, id DESC
    LIMIT ?
  `)
  const messages: Record<string, unknown>[] = []
  if (includeMessageBodies) {
    for (const conversationId of conversationIds) {
      messages.push(...(messagesStmt.all(conversationId, SNAPSHOT_MESSAGES_PER_CONVERSATION) as Record<string, unknown>[]))
    }
    messages.sort((left, right) => {
      const leftTimestamp = numberValue(left.timestamp, 0)
      const rightTimestamp = numberValue(right.timestamp, 0)
      if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp
      return String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0
    })
  }
  const wiki: Record<string, unknown>[] = !includeLibraryBodies ? [] : (db.prepare(`
    SELECT id, project_id, title, body, tags, source_conversation_id, created_at, updated_at
    FROM project_wiki_entries ORDER BY updated_at, id
  `).all() as Record<string, unknown>[]).map(row => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    tags: parseJsonValue(row.tags, []),
    sourceConversationId: row.source_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  const prompts: Record<string, unknown>[] = !includeLibraryBodies ? [] : (db.prepare(`
    SELECT id, title, body, description, category, tags, scope, project_id, created_at, updated_at
    FROM prompt_library_entries ORDER BY updated_at, id
  `).all() as Record<string, unknown>[]).map(row => ({
    id: row.id,
    title: row.title,
    body: row.body,
    description: row.description,
    category: row.category,
    tags: parseJsonValue(row.tags, []),
    scope: row.scope,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  const skills: Record<string, unknown>[] = !includeLibraryBodies
    ? []
    : listSkillConfigsForTransport().map(skill => objectValue(sanitizeSyncValue(skill)))

  // Credential payloads are deliberately not selected here. These two arrays are permission and
  // display metadata only, allowing Android to show which capabilities are available without
  // transferring API keys, encrypted payloads, or any other secret-bearing field.
  const credentials: Record<string, unknown>[] = db.prepare(
    "SELECT id, name, kind, provider, metadata_json, created_at, updated_at, last_used_at, revoked_at FROM credentials ORDER BY updated_at, id",
  ).all().map((row) => {
    const value = row as Record<string, unknown>
    const metadata = parseJsonValue(value.metadata_json, {})
    return {
      id: value.id,
      name: value.name,
      kind: value.kind,
      provider: value.provider,
      fingerprint: objectValue(metadata).fingerprint ?? null,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
      lastUsedAt: value.last_used_at,
      revokedAt: value.revoked_at,
    }
  }) as Record<string, unknown>[]
  const credentialBindings: Record<string, unknown>[] = db.prepare(
    'SELECT id, credential_id, project_id, agent_id, conversation_id, capability, approval_mode, expires_at, created_at, updated_at FROM credential_bindings ORDER BY updated_at, id',
  ).all().map((row) => {
    const value = row as Record<string, unknown>
    return {
      id: value.id,
      credentialId: value.credential_id,
      projectId: value.project_id,
      agentId: value.agent_id,
      conversationId: value.conversation_id,
      capability: value.capability,
      approvalMode: value.approval_mode,
      expiresAt: value.expires_at,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }
  }) as Record<string, unknown>[]

  const versions: Record<string, number> = {}
  for (const [type, rows] of [
    ['project', projects],
    ['agent', agents],
    ['conversation', conversations],
    ['message', messages],
    ['wiki', wiki],
    ['prompt', prompts],
    ['skill', skills],
  ] as const) {
    if (rows.length === 0) continue
    // Looking up sync_entity_versions one row at a time meant thousands of round trips on a large
    // snapshot. The table's primary key is (dataset_id, entity_type, entity_id), so a single scan
    // per type fetches every existing version in one query instead of one per entity.
    const existingRows = db.prepare(`
      SELECT entity_id, version, source_updated_at FROM sync_entity_versions
      WHERE dataset_id = ? AND entity_type = ?
    `).all(datasetId, type) as Array<{ entity_id: string; version: number; source_updated_at: number }>
    const existing = new Map(existingRows.map(row => [row.entity_id, row]))
    for (const row of rows) {
      const record = row as Record<string, unknown>
      const id = String(record.id)
      const sourceUpdatedAt = numberValue(record.updated_at ?? record.updatedAt ?? record.timestamp, 0)
      versions[`${type}:${id}`] = ensureEntityVersion(db, datasetId, type, id, sourceUpdatedAt, existing.get(id))
    }
  }

  const tombstones = db.prepare(`
    SELECT entity_type AS entityType, entity_id AS entityId, version, deleted_at AS deletedAt
    FROM sync_tombstones WHERE dataset_id = ? ORDER BY deleted_at
  `).all(datasetId)
  const conflicts = db.prepare(`
    SELECT id, entity_type AS entityType, entity_id AS entityId,
           local_payload_json AS localValueJson, remote_payload_json AS remoteValueJson,
           local_version AS localVersion, remote_version AS remoteVersion, created_at AS createdAt
    FROM sync_conflicts WHERE dataset_id = ? AND resolved_at IS NULL ORDER BY created_at
  `).all(datasetId)
  const attachments = db.prepare(`
    SELECT content_hash AS contentHash, display_name AS displayName, mime_type AS mimeType,
           size_bytes AS sizeBytes, attachment_id AS attachmentId, message_id AS messageId
    FROM sync_attachments WHERE completed_at IS NOT NULL ORDER BY updated_at, content_hash
  `).all()
  return { projects, agents, conversations, messages, wiki, prompts, skills, credentials, credentialBindings, attachments, versions, tombstones, conflicts }
}

function applyOperation(
  db: Database.Database,
  datasetId: string,
  operation: SyncOperation,
  nextVersion: number,
): void {
  if (operation.operation === 'delete') {
    deleteEntity(db, operation.entityType, operation.entityId)
    db.prepare(`
      INSERT INTO sync_tombstones (dataset_id, entity_type, entity_id, version, deleted_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(dataset_id, entity_type, entity_id) DO UPDATE SET
        version = excluded.version, deleted_at = excluded.deleted_at, acknowledged_at = NULL
    `).run(datasetId, operation.entityType, operation.entityId, nextVersion, Date.now())
    upsertEntityVersion(db, datasetId, operation.entityType, operation.entityId, nextVersion, Date.now())
    storeEntityHistory(db, datasetId, operation.entityType, operation.entityId, nextVersion, { deleted: true })
    appendDesktopChange(db, datasetId, operation.entityType, operation.entityId, 'delete', {}, nextVersion)
    return
  }

  const payload = objectValue(sanitizeSyncValue(JSON.parse(operation.payloadJson)))
  switch (operation.entityType) {
    case 'project': {
      db.prepare(`
        INSERT INTO projects (id, name, color, config_json, default_model, project_hermes_profile, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
          config_json = COALESCE(excluded.config_json, projects.config_json), default_model = excluded.default_model,
          project_hermes_profile = excluded.project_hermes_profile, updated_at = excluded.updated_at
      `).run(
        operation.entityId,
        stringValue(payload.name) ?? 'Project',
        normalizeProjectColor(payload.color) ?? 'blue',
        jsonString(payload.config),
        nullableString(payload.defaultModel),
        nullableString(payload.projectHermesProfile),
        numberValue(payload.createdAt, Date.now()),
        numberValue(payload.updatedAt, Date.now()),
      )
      break
    }
    case 'agent': {
      const config = objectValue(payload.config)
      const configJson = JSON.stringify({
        ...config,
        name: stringValue(payload.name) ?? stringValue(config.name) ?? 'Agent',
        icon: stringValue(payload.icon) ?? stringValue(config.icon) ?? '',
        backend: stringValue(payload.backend) ?? stringValue(config.backend) ?? 'openai',
        cliModel: stringValue(payload.cliModel) ?? stringValue(config.cliModel),
      })
      db.prepare(`
        INSERT INTO agents (id, config_json, is_default, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
      `).run(
        operation.entityId,
        configJson,
        numberValue(payload.createdAt, Date.now()),
        numberValue(payload.updatedAt, Date.now()),
      )
      break
    }
    case 'conversation': {
      db.prepare(`
        INSERT INTO conversations (id, agent_id, model, conversation_hermes_profile, pinned, archived, project_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id, model = excluded.model,
          conversation_hermes_profile = excluded.conversation_hermes_profile,
          pinned = excluded.pinned, archived = excluded.archived, project_id = excluded.project_id, title = excluded.title,
          updated_at = excluded.updated_at
      `).run(
        operation.entityId,
        nullableString(payload.agentId),
        nullableString(payload.model),
        nullableString(payload.conversationHermesProfile),
        payload.pinned === true ? 1 : 0,
        payload.archived === true ? 1 : 0,
        nullableString(payload.projectId),
        stringValue(payload.title) ?? 'New Chat',
        numberValue(payload.createdAt, Date.now()),
        numberValue(payload.updatedAt, Date.now()),
      )
      break
    }
    case 'message': {
      db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, model, provider, finish_reason,
          attachments, thinking_blocks, input_tokens, output_tokens, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET content = excluded.content, model = excluded.model,
          provider = excluded.provider, finish_reason = excluded.finish_reason,
          attachments = excluded.attachments, thinking_blocks = excluded.thinking_blocks,
          input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens
      `).run(
        operation.entityId,
        requiredString(payload.conversationId, 'conversationId'),
        stringValue(payload.role) ?? 'user',
        stringValue(payload.content) ?? '',
        nullableString(payload.model),
        nullableString(payload.provider),
        nullableString(payload.finishReason),
        jsonString(payload.attachments) ?? '[]',
        jsonString(payload.thinkingBlocks) ?? '[]',
        numberValue(payload.inputTokens, 0),
        numberValue(payload.outputTokens, 0),
        numberValue(payload.timestamp, Date.now()),
      )
      break
    }
    case 'wiki': {
      db.prepare(`
        INSERT INTO project_wiki_entries (
          id, project_id, title, body, tags, source_conversation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, title = excluded.title,
          body = excluded.body, tags = excluded.tags,
          source_conversation_id = excluded.source_conversation_id, updated_at = excluded.updated_at
      `).run(
        operation.entityId,
        requiredString(payload.projectId, 'projectId'),
        stringValue(payload.title) ?? 'Wiki entry',
        stringValue(payload.body) ?? '',
        jsonString(payload.tags) ?? '[]',
        nullableString(payload.sourceConversationId),
        numberValue(payload.createdAt, Date.now()),
        numberValue(payload.updatedAt, Date.now()),
      )
      break
    }
    case 'prompt': {
      db.prepare(`
        INSERT INTO prompt_library_entries (
          id, title, body, description, category, tags, scope, project_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
          description = excluded.description, category = excluded.category, tags = excluded.tags,
          scope = excluded.scope, project_id = excluded.project_id, updated_at = excluded.updated_at
      `).run(
        operation.entityId,
        stringValue(payload.title) ?? 'Prompt',
        stringValue(payload.body) ?? '',
        stringValue(payload.description) ?? '',
        stringValue(payload.category) ?? 'Custom',
        jsonString(payload.tags) ?? '[]',
        stringValue(payload.scope) === 'project' ? 'project' : 'global',
        nullableString(payload.projectId),
        numberValue(payload.createdAt, Date.now()),
        numberValue(payload.updatedAt, Date.now()),
      )
      break
    }
    case 'skill': {
      const now = numberValue(payload.updated_at ?? payload.updatedAt, Date.now())
      upsertSyncedSkillConfig(
        operation.entityId,
        { ...payload, id: operation.entityId },
        numberValue(payload.created_at ?? payload.createdAt, now),
        now,
      )
      break
    }
    default:
      throw new Error(`Unsupported sync entity type: ${operation.entityType}`)
  }
  upsertEntityVersion(
    db,
    datasetId,
    operation.entityType,
    operation.entityId,
    nextVersion,
    numberValue(payload.updatedAt ?? payload.updated_at ?? payload.timestamp, Date.now()),
  )
  storeEntityHistory(
    db,
    datasetId,
    operation.entityType,
    operation.entityId,
    nextVersion,
    readEntityPayload(db, operation.entityType, operation.entityId),
  )
  appendDesktopChange(
    db,
    datasetId,
    operation.entityType,
    operation.entityId,
    'upsert',
    readEntityPayload(db, operation.entityType, operation.entityId),
    nextVersion,
  )
}

function appendDesktopChange(
  db: Database.Database,
  datasetId: string,
  entityType: string,
  entityId: string,
  operation: 'upsert' | 'delete',
  payload: Record<string, unknown>,
  entityVersion: number,
): void {
  db.prepare(`
    INSERT INTO sync_desktop_changes (
      device_id, dataset_id, entity_type, entity_id, operation,
      payload_json, entity_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    desktopDeviceId(db),
    datasetId,
    entityType,
    entityId,
    operation,
    JSON.stringify(payload),
    entityVersion,
    Date.now(),
  )
}

function deleteEntity(db: Database.Database, type: string, id: string): void {
  if (type === 'skill') {
    deleteSkillConfig(id)
    return
  }
  const table = {
    conversation: 'conversations',
    message: 'messages',
    agent: 'agents',
    project: 'projects',
    wiki: 'project_wiki_entries',
    prompt: 'prompt_library_entries',
  }[type]
  if (!table) throw new Error(`Unsupported sync entity type: ${type}`)
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
}

function recordConflict(
  db: Database.Database,
  datasetId: string,
  operation: SyncOperation,
  currentVersion: number,
): Record<string, unknown> {
  const id = randomUUID()
  const localPayload = readEntityPayload(db, operation.entityType, operation.entityId)
  db.prepare(`
    INSERT INTO sync_conflicts (
      id, dataset_id, entity_type, entity_id, operation_id, local_payload_json,
      remote_payload_json, local_version, remote_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    datasetId,
    operation.entityType,
    operation.entityId,
    operation.operationId,
    JSON.stringify(localPayload),
    JSON.stringify(operation),
    currentVersion,
    operation.baseRemoteVersion,
    Date.now(),
  )
  return {
    id,
    entityType: operation.entityType,
    entityId: operation.entityId,
    field: '*',
    localValueJson: JSON.stringify(localPayload),
    remoteValueJson: operation.payloadJson,
    localVersion: currentVersion,
    remoteVersion: operation.baseRemoteVersion,
    createdAt: Date.now(),
  }
}

function readEntityPayload(db: Database.Database, type: string, id: string): Record<string, unknown> {
  const row = (() => {
    const table = {
      conversation: 'conversations',
      message: 'messages',
      agent: 'agents',
      project: 'projects',
      wiki: 'project_wiki_entries',
      prompt: 'prompt_library_entries',
      skill: 'skills',
    }[type]
    if (!table) return undefined
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  })()
  if (!row) return {}
  switch (type) {
    case 'conversation':
      return {
        id: row.id,
        title: row.title,
        agentId: row.agent_id,
        projectId: row.project_id,
        model: row.model,
        provider: row.provider,
        finishReason: row.finish_reason,
        pinned: numberValue(row.pinned, 0) !== 0,
        archived: numberValue(row.archived, 0) !== 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    case 'message':
      return {
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        content: row.content,
        model: row.model,
        attachments: parseJsonValue(row.attachments, []),
        thinkingBlocks: parseJsonValue(row.thinking_blocks, []),
        textSegments: parseJsonValue(row.text_segments, []),
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        timestamp: row.timestamp,
      }
    case 'agent':
      return {
        ...objectValue(sanitizeSyncValue(parseJsonValue(row.config_json, {}))),
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    case 'project':
      return {
        id: row.id,
        name: row.name,
        color: row.color,
        config: sanitizeSyncValue(parseJsonValue(row.config_json, {})),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    case 'wiki':
      return {
        id: row.id,
        projectId: row.project_id,
        title: row.title,
        body: row.body,
        tags: parseJsonValue(row.tags, []),
        sourceConversationId: row.source_conversation_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    case 'prompt':
      return {
        id: row.id,
        title: row.title,
        body: row.body,
        description: row.description,
        category: row.category,
        tags: parseJsonValue(row.tags, []),
        scope: row.scope,
        projectId: row.project_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    case 'skill':
      return objectValue(sanitizeSyncValue(getSkillConfigForTransport(String(row.id)) ?? {}))
    default:
      return {}
  }
}

function ensureEntityVersion(
  db: Database.Database,
  datasetId: string,
  type: string,
  id: string,
  sourceUpdatedAt: number,
  current: EntityVersionRow | undefined,
): number {
  const version = current == null ? 1 : sourceUpdatedAt > current.source_updated_at ? current.version + 1 : current.version
  // Unchanged rows are the overwhelming majority on every snapshot (connect or push), so skip the
  // payload re-read and history insert entirely when the version didn't move — history for this
  // version was already recorded the last time it changed.
  if (current == null || version !== current.version) {
    upsertEntityVersion(db, datasetId, type, id, version, sourceUpdatedAt)
    const payload = readEntityPayload(db, type, id)
    appendDesktopChange(db, datasetId, type, id, 'upsert', payload, version)
    storeEntityHistory(db, datasetId, type, id, version, payload)
  }
  return version
}

function entityVersion(db: Database.Database, datasetId: string, type: string, id: string): number {
  const row = db.prepare(`
    SELECT version FROM sync_entity_versions
    WHERE dataset_id = ? AND entity_type = ? AND entity_id = ?
  `).get(datasetId, type, id) as { version: number } | undefined
  return row?.version ?? 0
}

function upsertEntityVersion(
  db: Database.Database,
  datasetId: string,
  type: string,
  id: string,
  version: number,
  sourceUpdatedAt: number,
): void {
  db.prepare(`
    INSERT INTO sync_entity_versions (
      dataset_id, entity_type, entity_id, version, source_updated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(dataset_id, entity_type, entity_id) DO UPDATE SET
      version = excluded.version, source_updated_at = excluded.source_updated_at, updated_at = excluded.updated_at
  `).run(datasetId, type, id, version, sourceUpdatedAt, Date.now())
}

function storeEntityHistory(
  db: Database.Database,
  datasetId: string,
  type: string,
  id: string,
  version: number,
  payload: Record<string, unknown>,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO sync_entity_history (
      dataset_id, entity_type, entity_id, version, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(datasetId, type, id, version, JSON.stringify(payload), Date.now())
}

function tryMergeIndependentFields(
  db: Database.Database,
  datasetId: string,
  operation: SyncOperation,
  currentVersion: number,
): SyncOperation | null {
  if (operation.operation !== 'upsert' || operation.baseRemoteVersion <= 0) return null
  const history = db.prepare(`
    SELECT payload_json FROM sync_entity_history
    WHERE dataset_id = ? AND entity_type = ? AND entity_id = ? AND version = ?
  `).get(datasetId, operation.entityType, operation.entityId, operation.baseRemoteVersion) as
    | { payload_json: string }
    | undefined
  if (!history) return null
  const baseline = objectValue(parseJsonValue(history.payload_json, {}))
  const current = readEntityPayload(db, operation.entityType, operation.entityId)
  const incoming = objectValue(parseJsonValue(operation.payloadJson, {}))
  const ignored = new Set(['id', 'localVersion', 'remoteVersion', 'updatedAt', 'updated_at'])
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current), ...Object.keys(incoming)])
  const androidChanged = [...keys].filter(key => !ignored.has(key) && !jsonEqual(baseline[key], incoming[key]))
  const desktopChanged = new Set(
    [...keys].filter(key => !ignored.has(key) && !jsonEqual(baseline[key], current[key])),
  )
  if (androidChanged.some(key => desktopChanged.has(key))) return null
  const merged = { ...current }
  for (const key of androidChanged) merged[key] = incoming[key]
  if ('updatedAt' in incoming || 'updatedAt' in current) merged.updatedAt = Date.now()
  if ('updated_at' in incoming || 'updated_at' in current) merged.updated_at = Date.now()
  return {
    ...operation,
    payloadJson: JSON.stringify(merged),
    baseRemoteVersion: currentVersion,
  }
}

function jsonEqual(first: unknown, second: unknown): boolean {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null)
}

function markOperationApplied(db: Database.Database, operation: SyncOperation): void {
  db.prepare(`
    INSERT OR IGNORE INTO sync_applied_operations (operation_id, device_id, device_sequence, applied_at)
    VALUES (?, ?, ?, ?)
  `).run(operation.operationId, operation.deviceId, operation.deviceSequence, Date.now())
}

function desktopDeviceId(db: Database.Database): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'sync_desktop_device_id'").get() as
    | { value: string }
    | undefined
  if (row?.value) return row.value
  const value = randomUUID()
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_desktop_device_id', ?)").run(value)
  return value
}

function parseOperation(value: unknown): SyncOperation {
  const record = objectValue(value)
  const operation = requiredString(record.operation, 'operation')
  if (operation !== 'upsert' && operation !== 'delete') throw new Error('Invalid sync operation')
  return {
    operationId: requiredString(record.operationId, 'operationId'),
    deviceId: requiredString(record.deviceId, 'deviceId'),
    deviceSequence: numberValue(record.deviceSequence, -1),
    entityType: requiredString(record.entityType, 'entityType'),
    entityId: requiredString(record.entityId, 'entityId'),
    operation,
    payloadJson: requiredString(record.payloadJson, 'payloadJson'),
    baseRemoteVersion: numberValue(record.baseRemoteVersion, 0),
  }
}

function requiredString(value: unknown, name: string): string {
  const result = stringValue(value)
  if (!result) throw new Error(`Missing ${name}`)
  return result
}

function attachmentHash(value: unknown): string {
  const hash = requiredString(value, 'contentHash').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid SHA-256 attachment hash')
  return hash
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function nullableString(value: unknown): string | null {
  return stringValue(value)
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const EXCLUDED_SYNC_KEYS = new Set([
  'apikey',
  'authorization',
  'contentbase64',
  'dataurl',
  'localpath',
  'pairingsecret',
  'password',
  'path',
  'previewdataurl',
  'rootdirectory',
  'secret',
  'thumbnaildataurl',
  'token',
  'workingdirectory',
  'workspacepath',
])

function sanitizeSyncValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSyncValue)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[-_]/g, '').toLowerCase()
    if (EXCLUDED_SYNC_KEYS.has(normalized)) continue
    result[key] = sanitizeSyncValue(child)
  }
  return result
}

function jsonString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      JSON.parse(value)
      return value
    } catch {
      return JSON.stringify(value)
    }
  }
  return JSON.stringify(value)
}

function parseJsonValue(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function syncDatasetIdFromToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 24)
}
