import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MIGRATIONS,
  initializeBaseSchema,
  runMigrations,
  type Migration,
} from '../database-migrations'

const openDatabases: Database.Database[] = []

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  openDatabases.push(db)
  return db
}

function getColumnNames(db: Database.Database, tableName: string) {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
    ({ name }) => name
  )
}

function insertConversation(db: Database.Database, id = 'conv-1') {
  db.prepare(
    "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, 'Test', 1, 1)
}

function insertMessageWithRole(db: Database.Database, role: string, conversationId = 'conv-1') {
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).run(`msg-${role}`, conversationId, role, 'content', 1)
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

describe('database migrations', () => {
  it('applies all migrations to a fresh DB and sets user_version', () => {
    const db = createDatabase()

    initializeBaseSchema(db)
    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(101)
    expect(getColumnNames(db, 'projects')).toEqual(
      expect.arrayContaining(['default_model', 'config_json', 'project_hermes_profile'])
    )
    expect(getColumnNames(db, 'conversations')).toContain('conversation_hermes_profile')
    expect(getColumnNames(db, 'test_runs')).toEqual(expect.arrayContaining(['result_json', 'artifact_id', 'artifact_version_id']))
    expect(getColumnNames(db, 'messages')).toEqual(
      expect.arrayContaining(['attachments', 'context_snapshot', 'input_tokens', 'output_tokens', 'provider', 'finish_reason'])
    )
    expect(getColumnNames(db, 'message_spoken_outputs')).toEqual(
      expect.arrayContaining(['message_id', 'spoken_text', 'output_kind', 'generation_kind', 'model'])
    )
    expect(getColumnNames(db, 'conversation_mode_sessions')).toEqual(
      expect.arrayContaining(['conversation_id', 'project_id', 'scope_json', 'response_style', 'auto_speak'])
    )
    expect(getColumnNames(db, 'conversation_mode_turns')).toEqual(
      expect.arrayContaining(['conversation_id', 'user_message_id', 'evidence_state', 'retrieval_stats_json'])
    )
    expect(getColumnNames(db, 'conversation_mode_sources')).toEqual(
      expect.arrayContaining(['turn_id', 'source_type', 'source_id', 'project_id', 'location_json'])
    )
    expect(getColumnNames(db, 'conversations')).toEqual(
      expect.arrayContaining(['project_id', 'archived', 'codex_execution_mode_override', 'agentic_mode_override'])
    )
    expect(getColumnNames(db, 'project_wiki_entries')).toEqual(
      expect.arrayContaining(['tags', 'superseded_by'])
    )
    expect(getColumnNames(db, 'agent_delegations')).toEqual(
      expect.arrayContaining(['conversation_id', 'leader_agent_id', 'specialist_agent_id', 'status'])
    )
    expect(getColumnNames(db, 'conversation_summaries')).toEqual(
      expect.arrayContaining(['conversation_id', 'summary', 'summary_json', 'source_message_count', 'retained_message_count'])
    )
    expect(getColumnNames(db, 'error_log')).toEqual(
      expect.arrayContaining(['source', 'level', 'message', 'stack', 'timestamp'])
    )
    expect(getColumnNames(db, 'skills')).toEqual(
      expect.arrayContaining(['id', 'config_json', 'created_at', 'updated_at'])
    )
    expect(getColumnNames(db, 'agent_skills')).toEqual(
      expect.arrayContaining(['agent_id', 'skill_id', 'sort_order', 'attached_at'])
    )
    expect(getColumnNames(db, 'build_records')).toEqual(
      expect.arrayContaining(['mobile_initiated'])
    )
    expect(getColumnNames(db, 'conversation_debriefs')).toEqual(
      expect.arrayContaining(['conversation_id', 'summary', 'commands_tools', 'reproduction_guide', 'mental_model'])
    )
    expect(getColumnNames(db, 'conversations')).toEqual(expect.arrayContaining(['completed_at', 'cli_backend']))
    // conversation_quiz_attempts (migration 43) is dropped by migration 61 — Quiz now persists
    // its questions as a versioned artifact instead of a score-only attempt row.
    expect(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name),
    ).not.toContain('conversation_quiz_attempts')
    expect(getColumnNames(db, 'project_edit_sessions')).toEqual(
      expect.arrayContaining(['project_id', 'conversation_id', 'agent_id', 'title', 'source', 'created_at', 'updated_at'])
    )
    expect(getColumnNames(db, 'project_touched_files')).toEqual(
      expect.arrayContaining([
        'id', 'session_id', 'source_id', 'source_label', 'repository_id', 'repository_label',
        'relative_path', 'display_path', 'status', 'last_operation', 'branch', 'commit_hash',
        'legacy_repository_unknown', 'diff_json',
      ])
    )
    expect(getColumnNames(db, 'sync_devices')).toEqual(
      expect.arrayContaining(['id', 'dataset_id', 'protocol_version', 'last_received_sequence'])
    )
    expect(getColumnNames(db, 'sync_entity_versions')).toEqual(
      expect.arrayContaining(['entity_type', 'entity_id', 'version', 'source_updated_at'])
    )
    expect(getColumnNames(db, 'sync_conflicts')).toEqual(
      expect.arrayContaining(['entity_type', 'entity_id', 'local_payload_json', 'remote_payload_json'])
    )
    expect(getColumnNames(db, 'sync_entity_history')).toEqual(
      expect.arrayContaining(['entity_type', 'entity_id', 'version', 'payload_json'])
    )
    expect(getColumnNames(db, 'sync_attachments')).toEqual(
      expect.arrayContaining(['content_hash', 'size_bytes', 'content', 'received_bytes', 'completed_at', 'attachment_id', 'message_id'])
    )
    expect(getColumnNames(db, 'sync_desktop_changes')).toEqual(
      expect.arrayContaining(['sequence', 'device_id', 'dataset_id', 'entity_type', 'entity_version'])
    )
    expect(getColumnNames(db, 'automated_workflow_run_steps')).toEqual(
      expect.arrayContaining([
        'model', 'kind', 'input_bindings_json', 'deliverables_json', 'review_source_json',
        'publish_destination_json', 'include_project_instructions',
      ])
    )
    expect(getColumnNames(db, 'automated_workflow_runs')).toEqual(
      expect.arrayContaining(['project_id', 'scheduled_run_id', 'spec_sort_order', 'template_id'])
    )
    expect(getColumnNames(db, 'automated_workflow_templates')).toEqual(
      expect.arrayContaining(['id', 'project_id', 'title', 'goal_summary', 'assumptions_json', 'steps_json', 'model', 'source_run_id', 'created_at', 'updated_at'])
    )
    expect(getColumnNames(db, 'scheduled_tasks')).toEqual(
      expect.arrayContaining(['target_type'])
    )
    expect(getColumnNames(db, 'scheduled_task_workflows')).toEqual(
      expect.arrayContaining(['task_id', 'workflow_spec_json', 'source_run_id', 'confirmation_mode', 'sort_order', 'created_at'])
    )
    expect(getColumnNames(db, 'scheduled_runs')).toEqual(
      expect.arrayContaining(['workflow_run_ids_json'])
    )
    for (const table of [
      'automated_workflow_step_artifacts', 'automated_workflow_reviews',
      'automated_workflow_publish_previews', 'automated_workflow_publish_actions',
      'automated_workflow_attention', 'automated_workflow_schedule_state',
    ]) {
      expect(getColumnNames(db, table).length).toBeGreaterThan(0)
    }
    expect(getColumnNames(db, 'conversation_tool_calls')).toEqual(
      expect.arrayContaining(['id', 'conversation_id', 'tool_name', 'server_name', 'success', 'created_at'])
    )
    expect(getColumnNames(db, 'conversation_skill_invocations')).toEqual(
      expect.arrayContaining(['id', 'conversation_id', 'skill_id', 'agent_id', 'content_hash', 'trigger', 'status', 'created_at'])
    )
    expect(getColumnNames(db, 'conversation_ratings')).toEqual(
      expect.arrayContaining(['id', 'conversation_id', 'rating', 'note', 'context_snapshot_json', 'created_at', 'updated_at'])
    )
  })

  it('backfills and assigns a stable total order when message timestamps collide', () => {
    const db = createDatabase()
    initializeBaseSchema(db)
    insertConversation(db)
    const insert = db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    )
    insert.run('first', 'conv-1', 'user', 'one', 1_000)
    insert.run('second', 'conv-1', 'assistant', 'two', 1_000)

    runMigrations(db)
    insert.run('third', 'conv-1', 'assistant', 'three', 1_000)

    expect(
      db.prepare(
        'SELECT id, timeline_order FROM messages WHERE conversation_id = ? ORDER BY timeline_order',
      ).all('conv-1'),
    ).toEqual([
      { id: 'first', timeline_order: 1 },
      { id: 'second', timeline_order: 2 },
      { id: 'third', timeline_order: 3 },
    ])
  })

  it('describes conversation_tool_calls, conversation_skill_invocations, and conversation_ratings identically on a fresh install vs. an incrementally-migrated install (migration 71)', () => {
    const freshDb = createDatabase()
    initializeBaseSchema(freshDb)
    runMigrations(freshDb)

    const incrementalDb = createDatabase()
    initializeBaseSchema(incrementalDb)
    const migrationsUpTo70 = MIGRATIONS.filter((migration) => migration.version <= 70)
    runMigrations(incrementalDb, migrationsUpTo70)
    runMigrations(incrementalDb)

    for (const table of ['conversation_tool_calls', 'conversation_skill_invocations', 'conversation_ratings']) {
      expect(getColumnNames(incrementalDb, table).sort()).toEqual(getColumnNames(freshDb, table).sort())
    }
  })

  it('upgrades v84 data to Conversation Mode and remains usable by an older client', () => {
    const db = createDatabase()
    initializeBaseSchema(db)
    runMigrations(db, MIGRATIONS.filter((migration) => migration.version <= 84))
    db.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at)
       VALUES ('compat-project', 'Compatibility', 1, 1)`,
    ).run()
    db.prepare(
      `INSERT INTO conversations (id, project_id, title, created_at, updated_at)
       VALUES ('legacy-chat', 'compat-project', 'Legacy chat', 1, 1)`,
    ).run()
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp)
       VALUES ('legacy-message', 'legacy-chat', 'user', 'Preserve me', 1)`,
    ).run()

    expect(db.pragma('user_version', { simple: true })).toBe(84)
    expect(() => db.prepare('SELECT * FROM conversation_mode_sessions').all()).toThrow()

    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(101)
    expect(db.prepare('SELECT content FROM messages WHERE id = ?').get('legacy-message'))
      .toEqual({ content: 'Preserve me' })

    db.prepare(
      `INSERT INTO conversation_mode_sessions
       (conversation_id, project_id, scope_json, created_at, updated_at)
       VALUES ('legacy-chat', 'compat-project', '{}', 2, 2)`,
    ).run()

    // A pre-v85 client sees a newer user_version, applies no migrations, and can
    // continue using the unchanged projects/conversations/messages contract.
    expect(() => runMigrations(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 84),
    )).not.toThrow()
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp)
       VALUES ('older-client-message', 'legacy-chat', 'assistant', 'Still compatible', 3)`,
    ).run()
    expect(db.prepare(
      `SELECT content FROM messages
       WHERE id IN ('legacy-message', 'older-client-message') ORDER BY timestamp`,
    ).all()).toEqual([
      { content: 'Preserve me' },
      { content: 'Still compatible' },
    ])
    expect(db.prepare(
      'SELECT conversation_id FROM conversation_mode_sessions WHERE conversation_id = ?',
    ).get('legacy-chat')).toEqual({ conversation_id: 'legacy-chat' })
  })

  it('makes automated_workflow_runs.project_id nullable while preserving existing project-scoped rows (migration 69)', () => {
    const db = createDatabase()
    initializeBaseSchema(db)
    const migrationsUpTo67 = MIGRATIONS.filter((migration) => migration.version <= 67)
    runMigrations(db, migrationsUpTo67)
    db.prepare(
      `INSERT INTO projects (id, name, color, created_at, updated_at) VALUES ('proj-1', 'Test Project', 'blue', 1, 1)`,
    ).run()
    db.prepare(
      `INSERT INTO automated_workflow_runs (id, project_id, title, created_at, updated_at)
       VALUES ('run-1', 'proj-1', 'Existing run', 1, 1)`,
    ).run()

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(101)
    expect(db.prepare('SELECT project_id FROM automated_workflow_runs WHERE id = ?').get('run-1'))
      .toEqual({ project_id: 'proj-1' })
    expect(() => {
      db.prepare(
        `INSERT INTO automated_workflow_runs (id, project_id, title, created_at, updated_at)
         VALUES ('run-2', NULL, 'Project-less run', 1, 1)`,
      ).run()
    }).not.toThrow()
    expect(db.prepare('SELECT project_id FROM automated_workflow_runs WHERE id = ?').get('run-2'))
      .toEqual({ project_id: null })
  })

  it('defaults existing scheduled_tasks rows to target_type=chat (migration 70)', () => {
    const db = createDatabase()
    initializeBaseSchema(db)
    const migrationsUpTo69 = MIGRATIONS.filter((migration) => migration.version <= 69)
    runMigrations(db, migrationsUpTo69)
    db.prepare(
      `INSERT INTO scheduled_tasks (id, name, schedule_type, local_time, created_at, updated_at)
       VALUES ('task-1', 'Existing task', 'daily', '09:00', 1, 1)`,
    ).run()

    runMigrations(db)

    expect(db.prepare('SELECT target_type FROM scheduled_tasks WHERE id = ?').get('task-1'))
      .toEqual({ target_type: 'chat' })
  })

  it('does not crash calling initializeBaseSchema again against a pre-migration-75 database on a simulated app restart', () => {
    // Reproduces a real startup sequence (initializeSchema() calls initializeBaseSchema(db) then
    // runMigrations(db) unconditionally, every single launch, not just on first install). A
    // database created before migration 75 already has automated_workflow_runs without a
    // template_id column — CREATE TABLE IF NOT EXISTS in initializeBaseSchema is then a no-op on
    // that pre-existing table, so any statement in that same base-schema batch that assumes
    // template_id already exists (e.g. an index on it) crashes the whole app on startup instead
    // of leaving the column to be added by migration 75's own ALTER TABLE, which runs right after.
    const db = createDatabase()
    initializeBaseSchema(db)
    const migrationsUpTo74 = MIGRATIONS.filter((migration) => migration.version <= 74)
    runMigrations(db, migrationsUpTo74)
    expect(getColumnNames(db, 'automated_workflow_runs')).not.toContain('template_id')

    expect(() => initializeBaseSchema(db)).not.toThrow()
    expect(() => runMigrations(db)).not.toThrow()

    expect(getColumnNames(db, 'automated_workflow_runs')).toContain('template_id')
    expect(db.pragma('user_version', { simple: true })).toBe(101)
  })

  it('describes automated_workflow_templates and the widened automated_workflow_runs identically on a fresh install vs. an incrementally-migrated install (migration 75)', () => {
    const freshDb = createDatabase()
    initializeBaseSchema(freshDb)
    runMigrations(freshDb)

    const incrementalDb = createDatabase()
    initializeBaseSchema(incrementalDb)
    const migrationsUpTo74 = MIGRATIONS.filter((migration) => migration.version <= 74)
    runMigrations(incrementalDb, migrationsUpTo74)
    runMigrations(incrementalDb)

    for (const table of ['automated_workflow_templates', 'automated_workflow_runs']) {
      expect(getColumnNames(incrementalDb, table).sort()).toEqual(getColumnNames(freshDb, table).sort())
    }
  })

  it('renames legacy self_heal_* tables to remote_edit_* left behind by an in-place migration edit', () => {
    // Simulates a real DB that had already applied migrations 28-31 back when they
    // used self_heal_* table names, before those migration entries were edited in
    // place (instead of appending a new migration) to use remote_edit_* names.
    const db = createDatabase()
    initializeBaseSchema(db)
    const migrationsUpToLegacyNaming = MIGRATIONS.filter((migration) => migration.version <= 31).map(
      (migration): Migration => {
        if (migration.version !== 28 && migration.version !== 29 && migration.version !== 30 && migration.version !== 31) {
          return migration
        }
        // Re-apply the pre-rename SQL these versions originally shipped with.
        const legacySql = {
          28: `CREATE TABLE IF NOT EXISTS self_heal_diffs (
                 report_id TEXT NOT NULL, relative_path TEXT NOT NULL, diff_json TEXT NOT NULL,
                 PRIMARY KEY (report_id, relative_path)
               );`,
          29: `CREATE TABLE IF NOT EXISTS self_heal_verification_runs (
                 id TEXT PRIMARY KEY, report_id TEXT NOT NULL, status TEXT NOT NULL,
                 steps_json TEXT NOT NULL DEFAULT '[]', started_at INTEGER NOT NULL,
                 completed_at INTEGER, retry_count INTEGER NOT NULL DEFAULT 0, error TEXT
               );`,
          30: `CREATE TABLE IF NOT EXISTS self_heal_recovery_runs (
                 id TEXT PRIMARY KEY, report_id TEXT NOT NULL, status TEXT NOT NULL,
                 target_commit_sha TEXT, target_version TEXT,
                 backup_manifest_json TEXT NOT NULL DEFAULT '[]', pre_reload_state_json TEXT NOT NULL DEFAULT '{}',
                 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                 confirmed_at INTEGER, rollback_at INTEGER, error TEXT
               );`,
          31: `CREATE TABLE IF NOT EXISTS self_heal_history (
                 id TEXT PRIMARY KEY, report_id TEXT NOT NULL, report_title TEXT NOT NULL DEFAULT '',
                 investigation_model TEXT, investigation_backend TEXT, investigation_rounds INTEGER NOT NULL DEFAULT 0,
                 fix_applied_at INTEGER, verification_passed INTEGER NOT NULL DEFAULT 0, verification_failed_step TEXT,
                 committed INTEGER NOT NULL DEFAULT 0, commit_sha TEXT, pushed INTEGER NOT NULL DEFAULT 0,
                 reloaded INTEGER NOT NULL DEFAULT 0, rolled_back INTEGER NOT NULL DEFAULT 0,
                 status TEXT NOT NULL DEFAULT 'investigating', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
               );`,
        }[migration.version]
        return { version: migration.version, sql: legacySql }
      },
    )
    runMigrations(db, migrationsUpToLegacyNaming)
    db.prepare(
      `INSERT INTO self_heal_history (id, report_id, report_title, status, created_at, updated_at)
       VALUES ('hist-1', 'report-1', 'Legacy entry', 'investigating', 1, 1)`,
    ).run()

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(101)
    const tableNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((row) => row.name)
    expect(tableNames).not.toContain('self_heal_diffs')
    expect(tableNames).not.toContain('self_heal_verification_runs')
    expect(tableNames).not.toContain('self_heal_recovery_runs')
    expect(tableNames).not.toContain('self_heal_history')
    expect(tableNames).not.toContain('remote_edit_diffs')
    expect(tableNames).not.toContain('remote_edit_verification_runs')
    expect(tableNames).not.toContain('remote_edit_recovery_runs')
    expect(tableNames).not.toContain('remote_edit_history')
  })

  it('allows persisted tool call messages on a fresh DB', () => {
    const db = createDatabase()

    initializeBaseSchema(db)
    runMigrations(db)
    insertConversation(db)

    expect(() => insertMessageWithRole(db, 'tool-call')).not.toThrow()
  })

  it('is idempotent when run twice', () => {
    const db = createDatabase()

    initializeBaseSchema(db)

    expect(() => {
      runMigrations(db)
      runMigrations(db)
    }).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(101)
  })

  it('only runs pending migrations for a partial upgrade', () => {
    const db = createDatabase()

    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'blue',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        default_model TEXT
      );

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        model TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity')),
        content TEXT NOT NULL,
        attachments TEXT,
        model TEXT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `)
    db.pragma('user_version = 5')

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(101)
    expect(getColumnNames(db, 'messages')).toEqual(
      expect.arrayContaining(['is_edited', 'previous_content', 'context_snapshot'])
    )
    expect(getColumnNames(db, 'conversations')).toEqual(expect.arrayContaining(['project_id']))
    expect(getColumnNames(db, 'project_wiki_entries')).toEqual(
      expect.arrayContaining(['tags', 'superseded_by'])
    )
    expect(getColumnNames(db, 'projects')).toEqual(expect.arrayContaining(['config_json']))
    expect(getColumnNames(db, 'conversation_summaries')).toEqual(
      expect.arrayContaining(['summary_json'])
    )
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('idx_conversations_project')
    ).toBeTruthy()
    expect(getColumnNames(db, 'agent_skills')).toEqual(
      expect.arrayContaining(['agent_id', 'skill_id', 'sort_order'])
    )
  })

  it('upgrades a v15 messages table to allow persisted tool call messages', () => {
    const db = createDatabase()

    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        model TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        project_id TEXT,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity')),
        content TEXT NOT NULL,
        model TEXT,
        is_edited INTEGER NOT NULL DEFAULT 0,
        previous_content TEXT,
        context_snapshot TEXT,
        attachments TEXT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `)
    db.pragma('user_version = 15')
    insertConversation(db)
    insertMessageWithRole(db, 'assistant')

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(101)
    expect(() => insertMessageWithRole(db, 'tool-call')).not.toThrow()
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM messages WHERE role = ?").get('assistant')
    ).toEqual({ count: 1 })
  })

  it('re-throws genuine errors', () => {
    const db = createDatabase()
    // Test only migrations up to 17 to avoid conflicts with the fresh schema from initializeBaseSchema
    const failingMigrations: ReadonlyArray<Migration> = [
      ...MIGRATIONS.filter((m) => m.version <= 17),
      { version: 100, sql: 'ALTER TABLE missing_table ADD COLUMN broken TEXT' },
    ]

    initializeBaseSchema(db)

    expect(() => runMigrations(db, failingMigrations)).toThrow(/missing_table/)
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })

  it('rolls back the whole pending batch (leaving user_version unchanged) when a table-rebuild migration hits "already exists" on a bare CREATE TABLE', () => {
    // Regression test: a prior bug in runMigrations treated "duplicate column name" /
    // "already exists" as ignorable for any statement, including the bare CREATE TABLE step of
    // a table-rebuild sequence — where the error does not prove the rebuild's end-state is
    // correct (e.g. a stray intermediate table left by a prior interrupted run). Swallowing it
    // there could mark an incomplete rebuild as done. A bare CREATE TABLE (not IF NOT EXISTS)
    // must always re-throw "already exists", even though CREATE TABLE IF NOT EXISTS and plain
    // ALTER TABLE ADD COLUMN statements may still ignore it. The whole pending batch runs in one
    // transaction, so an unswallowed error here rolls everything in this run back — including
    // migration 1's otherwise-successful CREATE TABLE — leaving user_version unchanged so the
    // full batch is retried from scratch on the next app start (same as the pre-existing
    // 're-throws genuine errors' behavior).
    const db = createDatabase()
    const migrations: ReadonlyArray<Migration> = [
      { version: 1, sql: 'CREATE TABLE t_v2 (id TEXT PRIMARY KEY)' },
      {
        // Simulates a rebuild whose CREATE TABLE step collides with a stray leftover table
        // from an interrupted prior run — the INSERT/DROP/RENAME steps that would complete
        // the rebuild never run once this throws.
        version: 2,
        sql: `
          CREATE TABLE t_v2 (id TEXT PRIMARY KEY, extra TEXT);
          INSERT INTO t_v2 (id) SELECT id FROM t_v2;
        `,
      },
      { version: 3, sql: 'CREATE TABLE unrelated (id TEXT PRIMARY KEY)' },
    ]

    expect(() => runMigrations(db, migrations)).toThrow(/already exists/)
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unrelated'").get(),
    ).toBeUndefined()
  })

  it('lets independent ALTER TABLE ADD COLUMN statements in the same migration proceed even if an earlier one is already applied', () => {
    // Companion regression test: migration 22 in MIGRATIONS chains two unrelated ADD COLUMN
    // statements, where the first can legitimately hit "duplicate column name" on a fresh
    // install (that column already shipped in migration 21's CREATE TABLE) while the second is
    // still genuinely pending. Fixing the table-rebuild case must not regress this — each
    // statement's ignorable error must only affect that statement, not the ones after it.
    const db = createDatabase()
    const migrations: ReadonlyArray<Migration> = [
      { version: 1, sql: 'CREATE TABLE t (id TEXT PRIMARY KEY, already_there TEXT)' },
      {
        version: 2,
        sql: `
          ALTER TABLE t ADD COLUMN already_there TEXT;
          ALTER TABLE t ADD COLUMN still_pending TEXT;
        `,
      },
    ]

    expect(() => runMigrations(db, migrations)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(getColumnNames(db, 't')).toEqual(expect.arrayContaining(['already_there', 'still_pending']))
  })

  it('still tolerates a single-statement migration re-hitting "duplicate column name"', () => {
    const db = createDatabase()
    const migrations: ReadonlyArray<Migration> = [
      { version: 1, sql: 'CREATE TABLE t (id TEXT PRIMARY KEY, name TEXT)' },
      // Simulates a column that was already added by some other path — a single ALTER TABLE
      // ADD COLUMN statement re-hitting "duplicate column name" safely proves the column
      // already exists, so this remains ignorable.
      { version: 2, sql: 'ALTER TABLE t ADD COLUMN name TEXT' },
      { version: 3, sql: 'CREATE TABLE unrelated (id TEXT PRIMARY KEY)' },
    ]

    expect(() => runMigrations(db, migrations)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(3)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unrelated'").get(),
    ).toBeTruthy()
  })

  it('fresh install does not retain retired Code Changes tables', () => {
    const db = createDatabase()
    initializeBaseSchema(db)
    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(101)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
    expect(tables).not.toContain('error_reports')
    expect(tables.some((name) => name.startsWith('remote_edit_'))).toBe(false)
    expect(tables).not.toContain('code_change_plan_revisions')
  })
})
