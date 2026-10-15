import Database from "better-sqlite3";
import { randomUUID } from "crypto";

export interface Migration {
  version: number;
  sql?: string;
  run?: (db: Database.Database) => void;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: 1, sql: "ALTER TABLE projects ADD COLUMN default_model TEXT" },
  { version: 2, sql: "ALTER TABLE messages ADD COLUMN attachments TEXT" },
  { version: 3, sql: "ALTER TABLE conversations ADD COLUMN model TEXT" },
  {
    version: 4,
    sql: "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
  },
  { version: 5, sql: "ALTER TABLE messages ADD COLUMN model TEXT" },
  {
    version: 6,
    sql: "ALTER TABLE messages ADD COLUMN is_edited INTEGER NOT NULL DEFAULT 0",
  },
  { version: 7, sql: "ALTER TABLE messages ADD COLUMN previous_content TEXT" },
  { version: 8, sql: "ALTER TABLE messages ADD COLUMN context_snapshot TEXT" },
  {
    version: 9,
    sql: "ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",
  },
  {
    version: 10,
    sql: "CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, updated_at)",
  },
  { version: 11, sql: "ALTER TABLE projects ADD COLUMN config_json TEXT" },
  {
    // Recreate messages table to add 'team-activity' to the role CHECK constraint.
    // SQLite does not support ALTER COLUMN, so we do a table-swap migration.
    version: 12,
    sql: `
      CREATE TABLE IF NOT EXISTS messages_v12 (
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
      INSERT OR IGNORE INTO messages_v12 (id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp)
        SELECT id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_v12 RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
    `,
  },
  {
    version: 13,
    sql: `
      CREATE TABLE IF NOT EXISTS project_wiki_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        source_conversation_id TEXT,
        source_message_id TEXT,
        superseded_by TEXT REFERENCES project_wiki_entries(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_project ON project_wiki_entries(project_id, updated_at);
    `,
  },
  {
    version: 14,
    sql: `
      CREATE TABLE IF NOT EXISTS agent_delegations (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        leader_agent_id TEXT NOT NULL,
        specialist_agent_id TEXT NOT NULL,
        task TEXT NOT NULL,
        result TEXT,
        status TEXT NOT NULL CHECK (status IN ('done', 'error')),
        duration_ms INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_delegations_conversation ON agent_delegations(conversation_id, created_at);
    `,
  },
  {
    version: 15,
    sql: `
      UPDATE settings SET value = 'none' WHERE key = 'auth_mode' AND value = 'copilot';
      DELETE FROM settings WHERE key IN ('auth_token', 'auth_user');
      UPDATE agents
      SET config_json = replace(config_json, '"backend":"copilot-api"', '"backend":"gh-copilot"')
      WHERE instr(config_json, '"backend":"copilot-api"') > 0;
      UPDATE agents
      SET config_json = replace(config_json, '"backend": "copilot-api"', '"backend": "gh-copilot"')
      WHERE instr(config_json, '"backend": "copilot-api"') > 0;
    `,
  },
  {
    // Recreate messages table to add 'tool-call' to the role CHECK constraint.
    // CLI adapters persist completed tool calls as history messages so they can
    // be replayed after reopening desktop or Android chat windows.
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS messages_v16 (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity', 'tool-call')),
        content TEXT NOT NULL,
        model TEXT,
        is_edited INTEGER NOT NULL DEFAULT 0,
        previous_content TEXT,
        context_snapshot TEXT,
        attachments TEXT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO messages_v16 (id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp)
        SELECT id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_v16 RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
    `,
  },
  {
    version: 17,
    sql: `
      CREATE TABLE IF NOT EXISTS prompt_library_entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Custom',
        tags TEXT NOT NULL DEFAULT '[]',
        scope TEXT NOT NULL CHECK (scope IN ('global', 'project')) DEFAULT 'global',
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_library_scope
        ON prompt_library_entries(scope, project_id, category, updated_at);
    `,
  },
  {
    version: 18,
    sql: `
      CREATE TABLE IF NOT EXISTS prompt_library_versions (
        id TEXT PRIMARY KEY,
        prompt_id TEXT NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Custom',
        tags TEXT NOT NULL DEFAULT '[]',
        scope TEXT NOT NULL CHECK (scope IN ('global', 'project')) DEFAULT 'global',
        project_id TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(prompt_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt
        ON prompt_library_versions(prompt_id, version DESC);
    `,
  },
  {
    version: 19,
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        source_message_count INTEGER NOT NULL,
        retained_message_count INTEGER NOT NULL,
        estimated_tokens_before INTEGER NOT NULL,
        target_budget INTEGER NOT NULL,
        strategy TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_summaries_updated
        ON conversation_summaries(updated_at);
    `,
  },
  {
    version: 20,
    sql: "ALTER TABLE conversation_summaries ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}'",
  },
  {
    version: 21,
    sql: `
      CREATE TABLE IF NOT EXISTS build_records (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        commit_sha TEXT,
        branch TEXT,
        version TEXT,
        platform TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        exit_code INTEGER,
        version_code INTEGER,
        artifact_paths TEXT,
        artifact_checksums TEXT,
        log_tail TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      )
    `,
  },
  {
    version: 22,
    sql: `
      ALTER TABLE build_records ADD COLUMN version_code INTEGER;
      ALTER TABLE build_records ADD COLUMN artifact_checksums TEXT;
    `,
  },
  {
    version: 23,
    sql: `
      CREATE TABLE IF NOT EXISTS mobile_clients (
        device_id TEXT PRIMARY KEY,
        fcm_token TEXT NOT NULL,
        registered_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 24,
    sql: `
      CREATE TABLE IF NOT EXISTS error_log (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('main', 'renderer', 'unhandled')),
        level TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info', 'debug')),
        message TEXT NOT NULL,
        stack TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_error_log_timestamp ON error_log(timestamp);
    `,
  },
  {
    version: 25,
    sql: `
      CREATE TABLE IF NOT EXISTS error_reports (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        screenshot_path TEXT,
        log_snapshot TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'investigated', 'fixed', 'rejected')) DEFAULT 'open',
        app_version TEXT,
        platform TEXT,
        os_version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_error_reports_status_created
        ON error_reports(status, created_at);
    `,
  },
  {
    version: 26,
    sql: `
      ALTER TABLE error_reports ADD COLUMN investigation_markdown TEXT;
      ALTER TABLE error_reports ADD COLUMN investigation_confidence TEXT;
      ALTER TABLE error_reports ADD COLUMN investigation_root_cause TEXT;
      ALTER TABLE error_reports ADD COLUMN investigation_affected_files TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE error_reports ADD COLUMN investigation_started_at INTEGER;
      ALTER TABLE error_reports ADD COLUMN investigation_completed_at INTEGER;
    `,
  },
  {
    version: 27,
    sql: `
      ALTER TABLE error_reports ADD COLUMN fix_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE error_reports ADD COLUMN fix_staged_files TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE error_reports ADD COLUMN fix_started_at INTEGER;
      ALTER TABLE error_reports ADD COLUMN fix_completed_at INTEGER;
      ALTER TABLE error_reports ADD COLUMN fix_error TEXT;
    `,
  },
  {
    version: 28,
    sql: `
      CREATE TABLE IF NOT EXISTS remote_edit_diffs (
        report_id     TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        diff_json     TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (report_id, relative_path)
      );
    `,
  },
  {
    version: 29,
    sql: `
      CREATE TABLE IF NOT EXISTS remote_edit_verification_runs (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
        steps_json TEXT NOT NULL DEFAULT '[]',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_remote_edit_verification_report
        ON remote_edit_verification_runs(report_id, started_at);
    `,
  },
  {
    version: 30,
    sql: `
      CREATE TABLE IF NOT EXISTS remote_edit_recovery_runs (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('prepared', 'reloading', 'confirmed', 'rollback-required', 'rolled-back', 'failed')),
        target_commit_sha TEXT,
        target_version TEXT,
        backup_manifest_json TEXT NOT NULL DEFAULT '[]',
        pre_reload_state_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        rollback_at INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_remote_edit_recovery_report
        ON remote_edit_recovery_runs(report_id, created_at);
    `,
  },
  {
    version: 31,
    sql: `
      CREATE TABLE IF NOT EXISTS remote_edit_history (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        report_title TEXT NOT NULL DEFAULT '',
        investigation_model TEXT,
        investigation_backend TEXT,
        investigation_rounds INTEGER NOT NULL DEFAULT 0,
        fix_applied_at INTEGER,
        verification_passed INTEGER NOT NULL DEFAULT 0,
        verification_failed_step TEXT,
        committed INTEGER NOT NULL DEFAULT 0,
        commit_sha TEXT,
        pushed INTEGER NOT NULL DEFAULT 0,
        reloaded INTEGER NOT NULL DEFAULT 0,
        rolled_back INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'investigating',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_remote_edit_history_created
        ON remote_edit_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_remote_edit_history_report
        ON remote_edit_history(report_id);
    `,
  },
  {
    version: 32,
    sql: `
      CREATE TABLE IF NOT EXISTS feature_generator_runs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'drafting',
        spec_json TEXT,
        team_json TEXT,
        plan_markdown TEXT,
        staged_files_json TEXT,
        applied_files_json TEXT,
        verification_json TEXT,
        commit_sha TEXT,
        reloaded INTEGER NOT NULL DEFAULT 0,
        rolled_back INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_feature_generator_runs_created
        ON feature_generator_runs(created_at DESC);
    `,
  },
  {
    version: 33,
    sql: `
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        description TEXT,
        storage_root TEXT NOT NULL,
        current_version_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_project
        ON artifacts(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS artifact_versions (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        notes TEXT,
        spec_json TEXT,
        manifest_json TEXT NOT NULL,
        source_conversation_id TEXT,
        source_message_id TEXT,
        created_by_agent_ids TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact
        ON artifact_versions(artifact_id, version_number DESC);

      CREATE TABLE IF NOT EXISTS artifact_files (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        media_type TEXT NOT NULL,
        role TEXT NOT NULL,
        size_bytes INTEGER,
        checksum TEXT
      );

      CREATE TABLE IF NOT EXISTS artifact_chat_refs (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
        project_id TEXT,
        conversation_id TEXT NOT NULL,
        message_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS artifact_generator_runs (
        id TEXT PRIMARY KEY,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'chatting',
        spec_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
    `,
  },
  {
    version: 34,
    sql: `
      CREATE TABLE IF NOT EXISTS agent_mcp_server_trust (
        agent_id  TEXT NOT NULL,
        server_id TEXT NOT NULL,
        trust     TEXT NOT NULL DEFAULT 'always-ask',
        PRIMARY KEY (agent_id, server_id),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 35,
    sql: `
      DROP TABLE IF EXISTS feature_generator_runs;
    `,
  },
  {
    version: 36,
    sql: `ALTER TABLE messages ADD COLUMN thinking_blocks TEXT`,
  },
  {
    version: 37,
    sql: `
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS agent_skills (
        agent_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        attached_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, skill_id),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_skills_agent
        ON agent_skills(agent_id, sort_order);
    `,
  },
  {
    version: 38,
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        agent_id TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        model TEXT,
        conversation_id TEXT,
        schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one-time', 'daily', 'weekdays', 'weekly', 'monthly')),
        local_time TEXT NOT NULL,
        weekday INTEGER,
        month_day INTEGER,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        tool_policy_json TEXT NOT NULL DEFAULT '{"preApproved":[],"alwaysAsk":[],"neverAllow":[]}',
        notification_pref TEXT NOT NULL DEFAULT 'failures_only' CHECK (notification_pref IN ('always', 'failures_only', 'off')),
        next_run_at INTEGER,
        last_run_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled
        ON scheduled_tasks(enabled, next_run_at);
    `,
  },
  {
    version: 39,
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        scheduled_at INTEGER,
        started_at INTEGER,
        finished_at INTEGER,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'approval_required', 'success', 'failed', 'skipped')) DEFAULT 'pending',
        error TEXT,
        conversation_id TEXT,
        message_id TEXT,
        trigger_source TEXT NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')) DEFAULT 'scheduled',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(task_id, scheduled_at)
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task
        ON scheduled_runs(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status
        ON scheduled_runs(status, created_at DESC);
    `,
  },
  {
    version: 40,
    sql: `ALTER TABLE build_records ADD COLUMN mobile_initiated INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 41,
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_debriefs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        summary TEXT NOT NULL DEFAULT '',
        commands_tools TEXT NOT NULL DEFAULT '[]',
        reproduction_guide TEXT NOT NULL DEFAULT '',
        mental_model TEXT NOT NULL DEFAULT '',
        generated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_debriefs_conversation ON conversation_debriefs(conversation_id);
    `,
  },
  {
    version: 42,
    sql: `ALTER TABLE conversations ADD COLUMN completed_at INTEGER;`,
  },
  {
    version: 43,
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_quiz_attempts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        attempted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quiz_attempts_conversation
        ON conversation_quiz_attempts(conversation_id, attempted_at DESC);
    `,
  },
  {
    version: 44,
    sql: `ALTER TABLE conversations ADD COLUMN cli_backend TEXT;`,
  },
  {
    version: 45,
    sql: `
      CREATE TABLE IF NOT EXISTS project_edit_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('chat-tool', 'remote-edit', 'self-heal', 'manual-apply')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_edit_sessions_project
        ON project_edit_sessions(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS project_touched_files (
        session_id TEXT NOT NULL REFERENCES project_edit_sessions(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('modified', 'created', 'deleted')),
        last_operation TEXT NOT NULL CHECK (last_operation IN ('write', 'create', 'delete', 'apply')),
        first_touched_at INTEGER NOT NULL,
        last_touched_at INTEGER NOT NULL,
        diff_json TEXT,
        PRIMARY KEY (session_id, relative_path)
      );
      CREATE INDEX IF NOT EXISTS idx_project_touched_files_session
        ON project_touched_files(session_id, last_touched_at DESC);
    `,
  },
  {
    version: 46,
    sql: `
      ALTER TABLE error_reports ADD COLUMN request_type TEXT
        CHECK (request_type IN ('edit', 'refactor', 'bugfix', 'investigation'));
      ALTER TABLE error_reports ADD COLUMN request_origin TEXT
        CHECK (request_origin IN ('chat', 'android', 'manual', 'build-failure', 'legacy-bug-report'));
      ALTER TABLE error_reports ADD COLUMN workspace_root TEXT;
      ALTER TABLE error_reports ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_error_reports_origin
        ON error_reports(request_origin, created_at DESC);
    `,
  },
  {
    // Widen request_type CHECK to add 'feature'/'custom', and add custom_type_label.
    // SQLite does not support ALTER COLUMN, so we do a table-swap migration.
    version: 47,
    sql: `
      CREATE TABLE IF NOT EXISTS error_reports_v47 (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        screenshot_path TEXT,
        log_snapshot TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'investigated', 'fixed', 'rejected')) DEFAULT 'open',
        app_version TEXT,
        platform TEXT,
        os_version TEXT,
        investigation_markdown TEXT,
        investigation_confidence TEXT,
        investigation_root_cause TEXT,
        investigation_affected_files TEXT NOT NULL DEFAULT '[]',
        investigation_started_at INTEGER,
        investigation_completed_at INTEGER,
        fix_status TEXT NOT NULL DEFAULT 'none',
        fix_staged_files TEXT NOT NULL DEFAULT '[]',
        fix_started_at INTEGER,
        fix_completed_at INTEGER,
        fix_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        request_type TEXT
          CHECK (request_type IN ('edit', 'refactor', 'bugfix', 'feature', 'investigation', 'custom')),
        request_origin TEXT
          CHECK (request_origin IN ('chat', 'android', 'manual', 'build-failure', 'legacy-bug-report')),
        workspace_root TEXT,
        project_id TEXT,
        custom_type_label TEXT
      );
      INSERT OR IGNORE INTO error_reports_v47 (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, investigation_markdown, investigation_confidence,
        investigation_root_cause, investigation_affected_files, investigation_started_at, investigation_completed_at,
        fix_status, fix_staged_files, fix_started_at, fix_completed_at, fix_error,
        created_at, updated_at, request_type, request_origin, workspace_root, project_id
      )
        SELECT
          id, title, description, screenshot_path, log_snapshot, status,
          app_version, platform, os_version, investigation_markdown, investigation_confidence,
          investigation_root_cause, investigation_affected_files, investigation_started_at, investigation_completed_at,
          fix_status, fix_staged_files, fix_started_at, fix_completed_at, fix_error,
          created_at, updated_at, request_type, request_origin, workspace_root, project_id
        FROM error_reports;
      DROP TABLE error_reports;
      ALTER TABLE error_reports_v47 RENAME TO error_reports;
      CREATE INDEX IF NOT EXISTS idx_error_reports_status_created
        ON error_reports(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_error_reports_origin
        ON error_reports(request_origin, created_at DESC);
    `,
  },
  {
    // Migrations 28-31 were edited in place (self_heal_* -> remote_edit_* table names)
    // instead of adding new migrations, so any DB that had already applied those
    // versions before the edit still has the legacy self_heal_* tables and never
    // got the remote_edit_* ones. This renames the legacy tables when present and
    // is a no-op otherwise (fresh installs / already-migrated DBs).
    version: 48,
    run: (db: Database.Database) => {
      const renames: Array<[string, string]> = [
        ["self_heal_diffs", "remote_edit_diffs"],
        ["self_heal_verification_runs", "remote_edit_verification_runs"],
        ["self_heal_recovery_runs", "remote_edit_recovery_runs"],
        ["self_heal_history", "remote_edit_history"],
      ];
      const tableExists = (name: string): boolean =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

      for (const [legacyName, currentName] of renames) {
        if (!tableExists(legacyName)) continue;
        if (tableExists(currentName)) {
          // Both exist (shouldn't happen in practice): keep the current table, drop the empty legacy one.
          db.exec(`DROP TABLE ${legacyName}`);
          continue;
        }
        db.exec(`ALTER TABLE ${legacyName} RENAME TO ${currentName}`);
      }
    },
  },
  {
    // Repairs DBs where migration 47's table-rebuild partially applied and was silently marked
    // done by a bug in runMigrations (fixed alongside this migration): the old runner advanced
    // user_version to the last version in a migration batch even when an earlier multi-statement
    // migration threw a "duplicate column name" / "already exists" error partway through, so
    // request_type / custom_type_label could end up missing despite user_version already being
    // >= 47. This re-runs migration 47's rebuild whenever request_type is absent, and is a no-op
    // on any DB where it already exists (fresh installs, or DBs that applied 47 correctly).
    version: 49,
    run: (db: Database.Database) => {
      const hasColumn = (table: string, column: string): boolean =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
          .some((col) => col.name === column);

      // custom_type_label only exists once migration 47's rebuild has actually completed —
      // request_type alone isn't a reliable signal, since migration 46 (a plain ALTER TABLE ADD
      // COLUMN, unaffected by the bug this repairs) already adds it on its own.
      if (hasColumn("error_reports", "custom_type_label")) return;

      db.exec(`
        DROP TABLE IF EXISTS error_reports_v49;
        CREATE TABLE error_reports_v49 (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          screenshot_path TEXT,
          log_snapshot TEXT,
          status TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'investigated', 'fixed', 'rejected')) DEFAULT 'open',
          app_version TEXT,
          platform TEXT,
          os_version TEXT,
          investigation_markdown TEXT,
          investigation_confidence TEXT,
          investigation_root_cause TEXT,
          investigation_affected_files TEXT NOT NULL DEFAULT '[]',
          investigation_started_at INTEGER,
          investigation_completed_at INTEGER,
          fix_status TEXT NOT NULL DEFAULT 'none',
          fix_staged_files TEXT NOT NULL DEFAULT '[]',
          fix_started_at INTEGER,
          fix_completed_at INTEGER,
          fix_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          request_type TEXT
            CHECK (request_type IN ('edit', 'refactor', 'bugfix', 'feature', 'investigation', 'custom')),
          request_origin TEXT
            CHECK (request_origin IN ('chat', 'android', 'manual', 'build-failure', 'legacy-bug-report')),
          workspace_root TEXT,
          project_id TEXT,
          custom_type_label TEXT
        );
      `);
      const sourceColumns = (db.prepare("PRAGMA table_info(error_reports)").all() as Array<{ name: string }>)
        .map((col) => col.name);
      const targetColumns = (db.prepare("PRAGMA table_info(error_reports_v49)").all() as Array<{ name: string }>)
        .map((col) => col.name)
        .filter((name) => sourceColumns.includes(name));
      const columnList = targetColumns.join(", ");
      db.exec(`
        INSERT OR IGNORE INTO error_reports_v49 (${columnList})
          SELECT ${columnList} FROM error_reports;
        DROP TABLE error_reports;
        ALTER TABLE error_reports_v49 RENAME TO error_reports;
        CREATE INDEX IF NOT EXISTS idx_error_reports_status_created
          ON error_reports(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_error_reports_origin
          ON error_reports(request_origin, created_at DESC);
      `);
    },
  },
  {
    // Code Changes requests predate the project-scoped rework and were only ever test data —
    // clearing them (and their dependent rows, none of which have cascading FKs) so every
    // remaining error_reports row going forward is created through the new project-scoped flow.
    version: 50,
    sql: `
      DELETE FROM remote_edit_diffs;
      DELETE FROM remote_edit_verification_runs;
      DELETE FROM remote_edit_recovery_runs;
      DELETE FROM remote_edit_history;
      DELETE FROM error_reports;
    `,
  },
  {
    // Revision notes typed into "Revise plan" were only ever used to build the one-shot prompt
    // sent to the model, then discarded — persisting the latest one so the UI can show what
    // guidance shaped the current plan instead of losing it the moment the revision completes.
    version: 51,
    sql: "ALTER TABLE error_reports ADD COLUMN investigation_revision_notes TEXT",
  },
  {
    version: 52,
    sql: `
      CREATE TABLE IF NOT EXISTS sync_devices (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        name TEXT,
        protocol_version INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        last_received_sequence INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sync_entity_versions (
        dataset_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        source_updated_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (dataset_id, entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS sync_applied_operations (
        operation_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_sequence INTEGER NOT NULL,
        applied_at INTEGER NOT NULL,
        UNIQUE (device_id, device_sequence)
      );
      CREATE TABLE IF NOT EXISTS sync_tombstones (
        dataset_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        deleted_at INTEGER NOT NULL,
        acknowledged_at INTEGER,
        PRIMARY KEY (dataset_id, entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        local_payload_json TEXT NOT NULL,
        remote_payload_json TEXT NOT NULL,
        local_version INTEGER NOT NULL,
        remote_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolution TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_unresolved
        ON sync_conflicts(dataset_id, resolved_at, created_at);
    `,
  },
  {
    version: 53,
    sql: `
      CREATE TABLE IF NOT EXISTS sync_entity_history (
        dataset_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (dataset_id, entity_type, entity_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_sync_entity_history_lookup
        ON sync_entity_history(dataset_id, entity_type, entity_id, version);
    `,
  },
  {
    version: 54,
    sql: `
      ALTER TABLE messages ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE messages ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 55,
    sql: `
      ALTER TABLE messages ADD COLUMN provider TEXT;
      ALTER TABLE messages ADD COLUMN finish_reason TEXT;
    `,
  },
  {
    version: 56,
    sql: `
      CREATE TABLE IF NOT EXISTS sync_attachments (
        content_hash TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        content BLOB NOT NULL DEFAULT X'',
        received_bytes INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_attachments_incomplete
        ON sync_attachments(completed_at, updated_at);
    `,
  },
  {
    version: 57,
    sql: `
      ALTER TABLE sync_attachments ADD COLUMN attachment_id TEXT;
      ALTER TABLE sync_attachments ADD COLUMN message_id TEXT;
    `,
  },
  {
    version: 58,
    sql: "ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
  },
  {
    version: 59,
    sql: `
      CREATE TABLE IF NOT EXISTS sync_desktop_changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        entity_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_desktop_changes_dataset_sequence
        ON sync_desktop_changes(dataset_id, sequence);
    `,
  },
  {
    // Lets a Code Changes request (error_reports row) be linked back to the chat conversation
    // it was created from, so /code-change can find/reuse an existing in-flight request for the
    // conversation instead of creating a duplicate every time it's invoked.
    version: 60,
    sql: `
      ALTER TABLE error_reports ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_error_reports_conversation ON error_reports(conversation_id);
    `,
  },
  {
    // Debrief and Quiz move from their own bespoke tables to the artifact system (versioned,
    // re-runnable, markdown-exportable via the existing artifact:export path). Quiz attempts
    // only ever stored a score, never the questions asked, so there is nothing meaningful to
    // carry forward — dropped outright, matching the precedent set by migration 50. The one
    // existing debrief per conversation (conversation_debriefs) is migrated best-effort into an
    // artifact by a startup task (see main/legacy-debrief-migration.ts) rather than here, since
    // that requires filesystem access via Electron's `app` module, which this migrations file
    // deliberately has no dependency on.
    version: 61,
    sql: `DROP TABLE IF EXISTS conversation_quiz_attempts;`,
  },
  {
    // Manual Workflow plans are now persisted per-project instead of regenerated-and-
    // discarded every time the tab opens. Per-step status mutates over time, so — same
    // reasoning as error_reports/remote_edit_* — this gets its own parent+child tables
    // rather than being folded into the immutable-version Artifact system.
    version: 62,
    sql: `
      CREATE TABLE IF NOT EXISTS manual_workflow_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        goal_summary TEXT NOT NULL DEFAULT '',
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        model TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed')) DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_manual_workflow_runs_project_updated
        ON manual_workflow_runs(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS manual_workflow_run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES manual_workflow_runs(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        step_key TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        agent_id TEXT,
        agent_name TEXT,
        prompt TEXT NOT NULL,
        expected_output TEXT NOT NULL DEFAULT '',
        depends_on_step_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('not_started', 'started', 'done')) DEFAULT 'not_started',
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_manual_workflow_run_steps_run_index
        ON manual_workflow_run_steps(run_id, step_index);
    `,
  },
  {
    // /debrief and /quiz now create the artifact row up front with status='generating' and
    // fill it in once the LLM call resolves, so the chat card and Project Artifacts tab can
    // reflect in-progress/failed generation even if the user navigates away mid-run. Needs the
    // owning conversation recorded before any version (which normally carries it) exists yet,
    // plus somewhere to keep the failure reason for the card's error state.
    version: 63,
    sql: `
      ALTER TABLE artifacts ADD COLUMN conversation_id TEXT;
      ALTER TABLE artifacts ADD COLUMN error_message TEXT;
    `,
  },
  {
    // Per-conversation overrides for thinking effort and tool approval mode. NULL means
    // "inherit the agent's configured default" for both columns — these only take effect
    // when explicitly set via the composer's per-chat mode picker.
    version: 64,
    sql: `
      ALTER TABLE conversations ADD COLUMN thinking_effort_override TEXT;
      ALTER TABLE conversations ADD COLUMN full_auto_approve_override INTEGER;
    `,
  },
  {
    // status='fixed' was the only terminal-success value for error_reports regardless of
    // request_type, which reads correctly for a bugfix but mislabels a completed
    // 'feature'/'edit'/'refactor'/'custom' request (Code Changes is a general change-request
    // feature, not just a bug-fixing one — see BUGFIX_REQUEST_TYPES in remote-edit/investigator.ts
    // for the matching fix on the planning-prompt side). Widens the CHECK constraint to add a
    // type-neutral 'completed' value and backfills every existing 'fixed' row to it. SQLite has
    // no ALTER COLUMN and cannot modify a CHECK constraint in place, so this rebuilds the table
    // (same pattern as migrations 47/49), copying columns dynamically via PRAGMA table_info to
    // avoid hardcoding a column list that would go stale against later ALTER TABLE ADD COLUMN
    // migrations (e.g. investigation_revision_notes from v51, conversation_id from v60).
    version: 65,
    run: (db: Database.Database) => {
      db.exec(`
        DROP TABLE IF EXISTS error_reports_v65;
        CREATE TABLE error_reports_v65 (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          screenshot_path TEXT,
          log_snapshot TEXT,
          status TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'investigated', 'completed', 'rejected')) DEFAULT 'open',
          app_version TEXT,
          platform TEXT,
          os_version TEXT,
          investigation_markdown TEXT,
          investigation_confidence TEXT,
          investigation_root_cause TEXT,
          investigation_affected_files TEXT NOT NULL DEFAULT '[]',
          investigation_revision_notes TEXT,
          investigation_started_at INTEGER,
          investigation_completed_at INTEGER,
          fix_status TEXT NOT NULL DEFAULT 'none',
          fix_staged_files TEXT NOT NULL DEFAULT '[]',
          fix_started_at INTEGER,
          fix_completed_at INTEGER,
          fix_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          request_type TEXT
            CHECK (request_type IN ('edit', 'refactor', 'bugfix', 'feature', 'investigation', 'custom')),
          request_origin TEXT
            CHECK (request_origin IN ('chat', 'android', 'manual', 'build-failure', 'legacy-bug-report')),
          workspace_root TEXT,
          project_id TEXT,
          custom_type_label TEXT,
          conversation_id TEXT
        );
      `);
      const sourceColumns = (db.prepare("PRAGMA table_info(error_reports)").all() as Array<{ name: string }>)
        .map((col) => col.name);
      const targetColumns = (db.prepare("PRAGMA table_info(error_reports_v65)").all() as Array<{ name: string }>)
        .map((col) => col.name)
        .filter((name) => name !== "status" && sourceColumns.includes(name));
      const columnList = targetColumns.join(", ");
      db.exec(`
        INSERT OR IGNORE INTO error_reports_v65 (status, ${columnList})
          SELECT CASE WHEN status = 'fixed' THEN 'completed' ELSE status END, ${columnList}
          FROM error_reports;
        DROP TABLE error_reports;
        ALTER TABLE error_reports_v65 RENAME TO error_reports;
        CREATE INDEX IF NOT EXISTS idx_error_reports_status_created
          ON error_reports(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_error_reports_origin
          ON error_reports(request_origin, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_error_reports_conversation
          ON error_reports(conversation_id);
      `);
    },
  },
  {
    // Widens project_edit_sessions.source to add 'cli-tool' — Claude CLI / Codex CLI file edits
    // during normal chat used to be entirely invisible to Project Audit (only the BYOK
    // write_project_file tool and Code Changes recorded anything), so switching between a BYOK
    // chat and a CLI-backed chat in the same project silently produced a fragmented audit trail.
    // SQLite cannot modify a CHECK constraint in place, so this rebuilds the table (same pattern
    // as migrations 47/49/65). Drops the project_id/conversation_id/agent_id REFERENCES clauses
    // (plain TEXT columns instead) — same precedent migration 49 already set for error_reports'
    // project_id — since keeping a FOREIGN KEY ... REFERENCES agents(id) on a rebuilt table
    // throws "no such table: agents" against certain SQLite builds when the referenced table
    // doesn't exist yet at rebuild time (e.g. a DB mid-upgrade from a very old schema version).
    version: 66,
    run: (db: Database.Database) => {
      db.exec(`
        DROP TABLE IF EXISTS project_edit_sessions_v66;
        CREATE TABLE project_edit_sessions_v66 (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          conversation_id TEXT,
          agent_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL CHECK (source IN ('chat-tool', 'remote-edit', 'self-heal', 'manual-apply', 'code-changes', 'cli-tool')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      const sourceColumns = (db.prepare("PRAGMA table_info(project_edit_sessions)").all() as Array<{ name: string }>)
        .map((col) => col.name);
      const targetColumns = (db.prepare("PRAGMA table_info(project_edit_sessions_v66)").all() as Array<{ name: string }>)
        .map((col) => col.name)
        .filter((name) => sourceColumns.includes(name));
      const columnList = targetColumns.join(", ");
      db.exec(`
        INSERT OR IGNORE INTO project_edit_sessions_v66 (${columnList})
          SELECT ${columnList} FROM project_edit_sessions;
        DROP TABLE project_edit_sessions;
        ALTER TABLE project_edit_sessions_v66 RENAME TO project_edit_sessions;
        CREATE INDEX IF NOT EXISTS idx_project_edit_sessions_project
          ON project_edit_sessions(project_id, updated_at DESC);
      `);
    },
  },
  {
    // "Manual Workflow" was never supposed to be manual — it's the fallback for getting
    // multi-step, multi-agent delegation working when orchestration isn't available (CLI
    // backends disable orchestration, see chat-handlers.ts's `orchEnabled` check). What
    // shipped in migration 62 was a fully human-click-through checklist instead. This rebuilds
    // it as "Automated Workflow": steps execute automatically via a real agent turn, with a
    // per-run confirmation_mode choosing whether execution pauses for user approval after each
    // step ('gated') or advances immediately and only pauses on failure ('auto'). Widens the
    // status vocabulary at both levels ('awaiting_confirmation' distinguishes "a step just
    // finished and needs a look" from 'running'; 'failed'/'skipped' didn't exist before at
    // all) and adds columns the old design had no use for (attempt, output, error,
    // conversation_id, current_step_id) since a step is now a real, capturable agent turn
    // instead of a copy-pasted prompt the user ran by hand in an untracked conversation.
    // Backfilled rows always land in 'pending'/'gated' — none of them have ever actually run
    // automatically, and mapping an old 'active' run to 'running' would make the crash-recovery
    // startup sweep (which treats any 'running' row as an interrupted, now-unrecoverable LLM
    // call) immediately fail every migrated in-progress workflow the moment a user upgrades.
    // Plain TEXT columns instead of FOREIGN KEY ... REFERENCES (project_id/run_id/conversation_id)
    // — same precedent as migration 66: with foreign_keys=ON, the backfill INSERT below fails
    // with "no such table: projects" on any upgrade path where this migration runs before the
    // referenced table exists yet in that path (e.g. from a stripped-down pre-projects fixture).
    version: 67,
    sql: `
      CREATE TABLE IF NOT EXISTS automated_workflow_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goal_summary TEXT NOT NULL DEFAULT '',
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        model TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'awaiting_confirmation', 'failed', 'done', 'cancelled')) DEFAULT 'pending',
        confirmation_mode TEXT NOT NULL CHECK (confirmation_mode IN ('gated', 'auto')) DEFAULT 'gated',
        current_step_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_automated_workflow_runs_project_updated
        ON automated_workflow_runs(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS automated_workflow_run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        step_key TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        agent_id TEXT,
        agent_name TEXT,
        prompt TEXT NOT NULL,
        expected_output TEXT NOT NULL DEFAULT '',
        depends_on_step_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'awaiting_confirmation', 'done', 'failed', 'skipped', 'cancelled')) DEFAULT 'pending',
        attempt INTEGER NOT NULL DEFAULT 0,
        output TEXT NOT NULL DEFAULT '',
        error TEXT,
        conversation_id TEXT,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_automated_workflow_run_steps_run_index
        ON automated_workflow_run_steps(run_id, step_index);

      INSERT INTO automated_workflow_runs
        (id, project_id, title, goal_summary, assumptions_json, model, status, confirmation_mode, created_at, updated_at)
        SELECT id, project_id, title, goal_summary, assumptions_json, model,
          CASE status WHEN 'completed' THEN 'done' ELSE 'pending' END,
          'gated', created_at, updated_at
        FROM manual_workflow_runs;

      INSERT INTO automated_workflow_run_steps
        (id, run_id, step_index, step_key, title, summary, agent_id, agent_name, prompt, expected_output, depends_on_step_ids_json, status, attempt, output, started_at, completed_at)
        SELECT id, run_id, step_index, step_key, title, summary, agent_id, agent_name, prompt, expected_output, depends_on_step_ids_json,
          CASE status WHEN 'done' THEN 'done' ELSE 'pending' END,
          0,
          CASE status WHEN 'done' THEN '(marked done under the previous Manual Workflow -- original output was not captured)' ELSE '' END,
          started_at, completed_at
        FROM manual_workflow_run_steps;

      DROP TABLE IF EXISTS manual_workflow_run_steps;
      DROP TABLE IF EXISTS manual_workflow_runs;
    `,
  },
  {
    // Steps gain an optional model column, an alternative to agent_id (not additional to it) —
    // per the corrected domain-model hierarchy (src/roadmap-new/), a step is fulfilled by
    // EITHER a specific agent (that agent's own attached skills apply, exactly as before) OR a
    // bare model (no skills at all, full stop — skills are strictly agent-gated, never freely
    // available to a bare model). Nullable, mirrors agent_id exactly; the executor picks
    // whichever is populated (see automated-workflow-executor.ts's resolution order).
    version: 68,
    sql: "ALTER TABLE automated_workflow_run_steps ADD COLUMN model TEXT",
  },
  {
    // Automated Workflow becomes project-optional, so it can be a truly self-contained,
    // top-level entity like Skills/Scheduled rather than mandatorily tied to a project (see
    // src/roadmap-new/ hierarchy roadmap). Also adds scheduled_run_id/spec_sort_order now
    // (unused until the scheduler-to-workflow linkage lands) to avoid a second table-swap
    // later — cheap to bundle here since this table is already being rebuilt for the
    // project_id change. SQLite has no ALTER COLUMN, so this rebuilds the table — same pattern
    // as migrations 47/49/65/66/67. Plain TEXT project_id (no FOREIGN KEY ... REFERENCES),
    // matching migration 67's existing precedent for this exact table.
    version: 69,
    sql: `
      DROP TABLE IF EXISTS automated_workflow_runs_v69;
      CREATE TABLE automated_workflow_runs_v69 (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
        goal_summary TEXT NOT NULL DEFAULT '',
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        model TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'awaiting_confirmation', 'failed', 'done', 'cancelled')) DEFAULT 'pending',
        confirmation_mode TEXT NOT NULL CHECK (confirmation_mode IN ('gated', 'auto')) DEFAULT 'gated',
        current_step_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        scheduled_run_id TEXT,
        spec_sort_order INTEGER
      );
      INSERT OR IGNORE INTO automated_workflow_runs_v69
        (id, project_id, title, goal_summary, assumptions_json, model, status, confirmation_mode, current_step_id, error, created_at, updated_at, started_at, completed_at)
        SELECT id, project_id, title, goal_summary, assumptions_json, model, status, confirmation_mode, current_step_id, error, created_at, updated_at, started_at, completed_at
        FROM automated_workflow_runs;
      DROP TABLE automated_workflow_runs;
      ALTER TABLE automated_workflow_runs_v69 RENAME TO automated_workflow_runs;
      CREATE INDEX IF NOT EXISTS idx_automated_workflow_runs_project_updated
        ON automated_workflow_runs(project_id, updated_at DESC);
    `,
  },
  {
    // Lets a schedule target one or many Automated Workflow runs instead of only a plain chat
    // message (src/roadmap-new/ hierarchy roadmap). target_type defaults to 'chat' so every
    // existing scheduled task keeps its current behavior completely unchanged.
    // scheduled_task_workflows freezes a copy of the spec at attach time (workflow_spec_json)
    // rather than only keeping a source_run_id reference, so a schedule's behavior doesn't
    // silently change or break if its source run is later edited or discarded; source_run_id
    // is kept as an optional back-link for UI convenience only. confirmation_mode on an
    // attached spec defaults to 'auto', not the 'gated' default used everywhere else in this
    // app — an unattended, timer-fired workflow has no human present to approve a gated pause,
    // so 'auto' is the only default that makes sense here (a 'gated' spec is still legal; it
    // surfaces via the 'approval_required' scheduled_runs status, present in that column's
    // CHECK constraint since migration 39 but never actually produced until now).
    version: 70,
    sql: `
      ALTER TABLE scheduled_tasks ADD COLUMN target_type TEXT NOT NULL DEFAULT 'chat'
        CHECK (target_type IN ('chat', 'automated_workflow'));
      CREATE TABLE IF NOT EXISTS scheduled_task_workflows (
        task_id            TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        workflow_spec_json TEXT NOT NULL,
        source_run_id      TEXT,
        confirmation_mode  TEXT NOT NULL CHECK (confirmation_mode IN ('gated', 'auto')) DEFAULT 'auto',
        sort_order         INTEGER NOT NULL DEFAULT 0,
        created_at         INTEGER NOT NULL,
        PRIMARY KEY (task_id, sort_order)
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_task_workflows_task
        ON scheduled_task_workflows(task_id, sort_order);
      ALTER TABLE scheduled_runs ADD COLUMN workflow_run_ids_json TEXT;
    `,
  },
  {
    // Conversation rating & analytics system (src/roadmap-new/conversation-rating-system-roadmap.md).
    // conversation_tool_calls/conversation_skill_invocations are structured, queryable capture logs
    // that back the rating's frozen context_snapshot_json — replacing the previous state where "what
    // was used in this conversation" only existed as unstructured JSON inside message rows, or wasn't
    // recorded at all (skill usage). conversation_ratings is one row per conversation; re-rating
    // overwrites via the UNIQUE(conversation_id) constraint rather than accumulating a history.
    version: 71,
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_tool_calls (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        tool_name       TEXT NOT NULL,
        server_name     TEXT,
        success         INTEGER NOT NULL,
        created_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_tool_calls_conv ON conversation_tool_calls(conversation_id);

      CREATE TABLE IF NOT EXISTS conversation_skill_invocations (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        skill_id        TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        created_at      INTEGER NOT NULL,
        UNIQUE(conversation_id, skill_id)
      );

      CREATE TABLE IF NOT EXISTS conversation_ratings (
        id                     TEXT PRIMARY KEY,
        conversation_id        TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        rating                 INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        note                   TEXT,
        context_snapshot_json  TEXT NOT NULL,
        created_at             INTEGER NOT NULL,
        updated_at             INTEGER NOT NULL
      );
    `,
  },
  {
    version: 72,
    sql: `
      ALTER TABLE error_reports ADD COLUMN step TEXT NOT NULL DEFAULT 'describe'
        CHECK (step IN ('describe', 'plan-review', 'executing', 'verifying', 'final-review', 'attention'));
      ALTER TABLE error_reports ADD COLUMN repo_relative_path TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS code_change_plan_revisions (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL,
        revision_notes TEXT,
        plan_markdown TEXT NOT NULL,
        affected_files TEXT NOT NULL DEFAULT '[]',
        outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'superseded', 'execution-failed', 'verification-failed')),
        created_at INTEGER NOT NULL
      );

      DELETE FROM remote_edit_diffs;
      DELETE FROM remote_edit_verification_runs;
      DELETE FROM remote_edit_recovery_runs;
      DELETE FROM remote_edit_history;
      DELETE FROM error_reports;
    `,
  },
  {
    version: 73,
    sql: `
      ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
    `,
  },
  {
    version: 74,
    sql: `
      DELETE FROM messages WHERE role = 'system' AND content GLOB '__code-change-ref:*';
    `,
  },
  {
    // Automated Workflow gains a template concept, decoupled from run (execution) history —
    // a generated plan is no longer single-use. automated_workflow_templates stores only the
    // spec shape (title/goalSummary/assumptions/steps), a strict subset of what already flows
    // through saveAutomatedWorkflowRunFromSpec, so "run again" is just: load template -> build
    // an AutomatedWorkflowSpec -> call the existing save-spec path with a null run id. Plain
    // TEXT project_id/template_id (no FOREIGN KEY ... REFERENCES), matching migration 67/69's
    // established precedent for this table family.
    version: 75,
    sql: `
      CREATE TABLE IF NOT EXISTS automated_workflow_templates (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
        goal_summary TEXT NOT NULL DEFAULT '',
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        steps_json TEXT NOT NULL DEFAULT '[]',
        model TEXT,
        source_run_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automated_workflow_templates_project_updated
        ON automated_workflow_templates(project_id, updated_at DESC);

      ALTER TABLE automated_workflow_runs ADD COLUMN template_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_automated_workflow_runs_template
        ON automated_workflow_runs(template_id);
    `,
  },
  {
    // Per-conversation override for the terminal tool's sandbox bypass (run_terminal_command
    // working directories outside the project root). Same tri-state convention as
    // full_auto_approve_override from migration 64: NULL means "inherit the project's
    // terminalSandboxBypass default".
    version: 76,
    sql: `
      ALTER TABLE conversations ADD COLUMN terminal_sandbox_override INTEGER;
    `,
  },
  {
    // Ordered response-text bursts for a CLI turn whose text was interrupted by tool
    // calls (e.g. "I'll check X." -> tool call -> "Here's the answer.") — lets the
    // historical render interleave them with the tool-call rows the same way
    // thinking_blocks (migration 36) are interleaved. `content` still holds the full,
    // concatenated text; this is purely a rendering aid.
    version: 77,
    sql: `ALTER TABLE messages ADD COLUMN text_segments TEXT`,
  },
  {
    // Learning history: persist each completed quiz run so scores accumulate over time
    // (the old conversation_quiz_attempts table was dropped when quizzes moved to the
    // artifact system — this is a fresh schema keyed to artifact id + version, not a revival).
    // category_breakdown / missed_questions are JSON blobs; missed_questions feeds the
    // "re-quiz what I missed" flow.
    version: 78,
    sql: `
      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        conversation_id TEXT,
        project_id TEXT,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        category_breakdown TEXT,
        missed_questions TEXT,
        attempted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quiz_attempts_artifact ON quiz_attempts(artifact_id);
    `,
  },
  {
    // Persist each spoken teach-back/viva turn against the exact artifact version.
    version: 79,
    sql: `
      CREATE TABLE IF NOT EXISTS teachback_attempts (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
        conversation_id TEXT,
        project_id TEXT,
        parent_attempt_id TEXT,
        turn_number INTEGER NOT NULL DEFAULT 0,
        prompt TEXT NOT NULL,
        transcript TEXT NOT NULL,
        feedback_json TEXT NOT NULL,
        attempted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_teachback_attempts_artifact
        ON teachback_attempts(artifact_id, attempted_at DESC);
    `,
  },
  {
    // Per-conversation CLI mode override (fourth ChatModePicker section): Claude Code
    // --permission-mode ('plan'|'acceptEdits'|'bypassPermissions') or Codex --sandbox
    // ('read-only'|'workspace-write'|'danger-full-access'). NULL = backend default.
    version: 80,
    sql: `ALTER TABLE conversations ADD COLUMN cli_mode_override TEXT`,
  },
  {
    // Stable per-conversation order. The trigger makes every legacy INSERT path safe
    // while explicit ordinals can still be supplied by sync/import code.
    version: 81,
    run: (db) => {
      const columns = db.pragma('table_info(messages)') as Array<{ name: string }>
      if (!columns.some((column) => column.name === 'timeline_order')) {
        db.exec('ALTER TABLE messages ADD COLUMN timeline_order INTEGER')
      }
      db.exec(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY conversation_id ORDER BY timestamp ASC, rowid ASC
          ) AS ordinal
          FROM messages
        )
        UPDATE messages
        SET timeline_order = (SELECT ordinal FROM ranked WHERE ranked.id = messages.id)
        WHERE timeline_order IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_timeline_order
          ON messages(conversation_id, timeline_order);
        CREATE TRIGGER IF NOT EXISTS messages_assign_timeline_order
        AFTER INSERT ON messages
        WHEN NEW.timeline_order IS NULL
        BEGIN
          UPDATE messages
          SET timeline_order = (
            SELECT COALESCE(MAX(timeline_order), 0) + 1
            FROM messages
            WHERE conversation_id = NEW.conversation_id AND id <> NEW.id
          )
          WHERE id = NEW.id;
        END;
      `)
    },
  },
  {
    // Codex collaboration/execution mode is independent of its approval policy and
    // filesystem sandbox. NULL = Codex default; currently the only override is 'plan'.
    version: 82,
    sql: `ALTER TABLE conversations ADD COLUMN codex_execution_mode_override TEXT`,
  },
  {
    // Provider tool-loop autonomy can be overridden per conversation. NULL inherits the
    // assigned agent's setting (or false for a plain chat); 1/0 explicitly enables/disables it.
    version: 83,
    sql: `ALTER TABLE conversations ADD COLUMN agentic_mode_override INTEGER`,
  },
  {
    // Reusable spoken forms for normal assistant messages. Keeping this separate from
    // message content lets deterministic and provider-generated recaps be replaced
    // without editing chat history.
    version: 84,
    sql: `
      CREATE TABLE IF NOT EXISTS message_spoken_outputs (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        spoken_text TEXT NOT NULL,
        output_kind TEXT NOT NULL,
        generation_kind TEXT NOT NULL,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    // Durable project-scoped Voice Conversation sessions. Source rows intentionally keep
    // stable string handles instead of foreign keys to every possible source table so a
    // deleted chat/wiki/artifact can still render as unavailable after restart.
    version: 85,
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_mode_sessions (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_json TEXT NOT NULL,
        response_style TEXT NOT NULL DEFAULT 'conversational',
        auto_speak INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_mode_sessions_project
        ON conversation_mode_sessions(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS conversation_mode_turns (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        assistant_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        spoken_answer TEXT,
        evidence_state TEXT NOT NULL,
        retrieval_stats_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_mode_turns_conversation
        ON conversation_mode_turns(conversation_id, created_at, id);

      CREATE TABLE IF NOT EXISTS conversation_mode_sources (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES conversation_mode_turns(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_sub_id TEXT,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT,
        location_json TEXT NOT NULL DEFAULT '{}',
        rank INTEGER NOT NULL,
        score REAL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_mode_sources_turn
        ON conversation_mode_sources(turn_id, rank, id);
    `,
  },
  {
    // A project is a logical umbrella. Local source bindings and Git repositories are separate,
    // stable entities; config_json.rootDirectory remains as a compatibility alias.
    version: 86,
    sql: `
      CREATE TABLE IF NOT EXISTS project_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('workspace-root', 'folder')),
        local_path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, local_path)
      );
      CREATE INDEX IF NOT EXISTS idx_project_sources_project
        ON project_sources(project_id, is_primary DESC, created_at);

      CREATE TABLE IF NOT EXISTS project_repositories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES project_sources(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        relative_path TEXT NOT NULL DEFAULT '',
        remote_url TEXT,
        branch TEXT,
        dirty INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        available INTEGER NOT NULL DEFAULT 1,
        verify_commands_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(source_id, relative_path)
      );
      CREATE INDEX IF NOT EXISTS idx_project_repositories_project
        ON project_repositories(project_id, enabled DESC, label);
    `,
  },
  {
    // Makes audit file identity repository-aware. Snapshot labels keep history readable if a
    // source is later removed; nullable branch/commit fields capture Git context when known.
    version: 87,
    run: (db) => {
      db.exec(`
        CREATE TABLE project_touched_files_v87 (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES project_edit_sessions(id) ON DELETE CASCADE,
          source_id TEXT REFERENCES project_sources(id) ON DELETE SET NULL,
          source_label TEXT,
          repository_id TEXT REFERENCES project_repositories(id) ON DELETE SET NULL,
          repository_label TEXT,
          relative_path TEXT NOT NULL,
          display_path TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('modified', 'created', 'deleted')),
          last_operation TEXT NOT NULL CHECK (last_operation IN ('write', 'create', 'delete', 'apply')),
          branch TEXT,
          commit_hash TEXT,
          legacy_repository_unknown INTEGER NOT NULL DEFAULT 0,
          first_touched_at INTEGER NOT NULL,
          last_touched_at INTEGER NOT NULL,
          diff_json TEXT
        );
      `)

      type LegacyFile = {
        session_id: string; relative_path: string; status: string; last_operation: string
        first_touched_at: number; last_touched_at: number; diff_json: string | null
        project_id: string | null
      }
      type Source = { id: string; project_id: string; label: string; is_primary: number }
      type Repo = { id: string; project_id: string; source_id: string; label: string; relative_path: string; branch: string | null }
      const files = db.prepare(`SELECT f.*, s.project_id FROM project_touched_files f
        JOIN project_edit_sessions s ON s.id = f.session_id`).all() as LegacyFile[]
      const sources = db.prepare('SELECT id, project_id, label, is_primary FROM project_sources').all() as Source[]
      const repositories = db.prepare(`SELECT id, project_id, source_id, label, relative_path, branch
        FROM project_repositories`).all() as Repo[]
      const reportRepo = db.prepare('SELECT project_id, repo_relative_path FROM error_reports WHERE id = ?')
      const insert = db.prepare(`INSERT INTO project_touched_files_v87
        (id, session_id, source_id, source_label, repository_id, repository_label, relative_path,
         display_path, status, last_operation, branch, commit_hash, legacy_repository_unknown,
         first_touched_at, last_touched_at, diff_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`)

      for (const file of files) {
        const source = sources.find((candidate) => candidate.project_id === file.project_id && candidate.is_primary === 1)
          ?? sources.find((candidate) => candidate.project_id === file.project_id)
        const normalizedLegacyPath = file.relative_path.replace(/\\/g, '/').replace(/^\.\//, '')
        let repo: Repo | undefined
        if (source) {
          const reportId = file.session_id.startsWith('remote-edit:') ? file.session_id.slice('remote-edit:'.length) : null
          const report = reportId ? reportRepo.get(reportId) as { project_id: string | null; repo_relative_path: string | null } | undefined : undefined
          const requestedPrefix = report?.project_id === file.project_id ? (report.repo_relative_path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '') : null
          const candidates = repositories.filter((candidate) => candidate.source_id === source.id)
          repo = requestedPrefix !== null
            ? candidates.find((candidate) => candidate.relative_path.replace(/\\/g, '/').replace(/\/$/, '') === requestedPrefix)
            : undefined
          repo ??= candidates
            .filter((candidate) => {
              const prefix = candidate.relative_path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
              return prefix === '' || normalizedLegacyPath === prefix || normalizedLegacyPath.startsWith(`${prefix}/`)
            })
            .sort((a, b) => b.relative_path.length - a.relative_path.length)[0]
        }
        const repoPrefix = repo?.relative_path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '') ?? ''
        const relativePath = repo && repoPrefix && (normalizedLegacyPath === repoPrefix || normalizedLegacyPath.startsWith(`${repoPrefix}/`))
          ? normalizedLegacyPath.slice(repoPrefix.length).replace(/^\//, '')
          : normalizedLegacyPath
        insert.run(
          randomUUID(), file.session_id, source?.id ?? null, source?.label ?? null,
          repo?.id ?? null, repo?.label ?? null, relativePath, normalizedLegacyPath,
          file.status, file.last_operation, repo?.branch ?? null, repo ? 0 : 1,
          file.first_touched_at, file.last_touched_at, file.diff_json,
        )
      }

      db.exec(`
        DROP TABLE project_touched_files;
        ALTER TABLE project_touched_files_v87 RENAME TO project_touched_files;
        CREATE INDEX idx_project_touched_files_session
          ON project_touched_files(session_id, last_touched_at DESC);
        CREATE UNIQUE INDEX idx_project_touched_files_identity
          ON project_touched_files(session_id, IFNULL(source_id, ''), IFNULL(repository_id, ''), relative_path);
        CREATE INDEX idx_project_touched_files_repository
          ON project_touched_files(repository_id, last_touched_at DESC);
      `)
    },
  },
  {
    // Skill availability is no longer treated as invocation. These fields describe the real
    // activation event and pin it to the package contents used by the conversation.
    version: 88,
    sql: `
      ALTER TABLE conversation_skill_invocations ADD COLUMN content_hash TEXT;
      ALTER TABLE conversation_skill_invocations ADD COLUMN trigger TEXT NOT NULL DEFAULT 'implicit';
      ALTER TABLE conversation_skill_invocations ADD COLUMN status TEXT NOT NULL DEFAULT 'activated';
    `,
  },
  {
    // Retire the report-driven Code Changes workflow while preserving ordinary conversations
    // and immutable project audit history. The Git workbench has no dependency on these tables.
    version: 89,
    sql: `
      UPDATE conversations SET kind = 'chat' WHERE kind = 'code-change';
      UPDATE project_edit_sessions SET source = 'manual-apply' WHERE source IN ('remote-edit', 'self-heal', 'code-changes');
      DELETE FROM messages WHERE role = 'system' AND content GLOB '__code-change-ref:*';
      DROP TABLE IF EXISTS code_change_plan_revisions;
      DROP TABLE IF EXISTS remote_edit_diffs;
      DROP TABLE IF EXISTS remote_edit_verification_runs;
      DROP TABLE IF EXISTS remote_edit_recovery_runs;
      DROP TABLE IF EXISTS remote_edit_history;
      DROP TABLE IF EXISTS error_reports;
    `,
  },
  {
    // Durable structured clarification cards resolved during an assistant turn.
    version: 90,
    sql: `ALTER TABLE messages ADD COLUMN user_inputs TEXT;`,
  },
  {
    // Flags whether mcp_servers.config_json is safeStorage-encrypted at rest.
    // 0 = legacy plaintext JSON (still readable); 1 = base64 encrypted blob.
    // Secrets in a server's env map used to be persisted in the clear here.
    // mcp_servers is only created by initializeBaseSchema (no migration creates it),
    // so guard with CREATE IF NOT EXISTS for upgrade paths that skip the base schema —
    // the ADD COLUMN then no-ops (duplicate column) when the table already carries it.
    version: 91,
    sql: `
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        config_encrypted INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      ALTER TABLE mcp_servers ADD COLUMN config_encrypted INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // Managed-artifact workflows. Runtime artifact/version identities live in normalized tables;
    // template/run step configuration remains JSON-compatible and legacy steps keep NULL kind.
    version: 92,
    sql: `
      ALTER TABLE automated_workflow_run_steps ADD COLUMN kind TEXT;
      ALTER TABLE automated_workflow_run_steps ADD COLUMN input_bindings_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE automated_workflow_run_steps ADD COLUMN deliverables_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE automated_workflow_run_steps ADD COLUMN review_source_json TEXT;
      ALTER TABLE automated_workflow_run_steps ADD COLUMN publish_destination_json TEXT;
      ALTER TABLE automated_workflow_run_steps ADD COLUMN include_project_instructions INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS automated_workflow_step_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        step_attempt INTEGER NOT NULL DEFAULT 0,
        binding_name TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
        source_step_id TEXT,
        stale_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(step_id, step_attempt, binding_name, direction)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_step_artifacts_run_step
        ON automated_workflow_step_artifacts(run_id, step_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_step_artifacts_version
        ON automated_workflow_step_artifacts(artifact_version_id);

      CREATE TABLE IF NOT EXISTS automated_workflow_reviews (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
        reviewed_by_client TEXT NOT NULL CHECK (reviewed_by_client IN ('desktop', 'android')),
        reviewed_at INTEGER NOT NULL,
        superseded_at INTEGER,
        UNIQUE(step_id, artifact_version_id, decision)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_reviews_step
        ON automated_workflow_reviews(run_id, step_id, reviewed_at DESC);

      CREATE TABLE IF NOT EXISTS automated_workflow_publish_previews (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
        project_source_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        destination_checksum TEXT,
        before_content_ref TEXT,
        diff_text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        invalidated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_publish_previews_step
        ON automated_workflow_publish_previews(run_id, step_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS automated_workflow_publish_actions (
        id TEXT PRIMARY KEY,
        preview_id TEXT NOT NULL REFERENCES automated_workflow_publish_previews(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'conflicted')),
        approved_by_client TEXT NOT NULL CHECK (approved_by_client IN ('desktop', 'android')),
        approved_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        before_recovery_ref TEXT,
        result_checksum TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_publish_actions_preview
        ON automated_workflow_publish_actions(preview_id, approved_at DESC);

      CREATE TABLE IF NOT EXISTS automated_workflow_attention (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('review', 'stale', 'publish', 'publish-conflict', 'coalesced')),
        resolved_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_attention_open
        ON automated_workflow_attention(run_id, resolved_at, created_at DESC);

      CREATE TABLE IF NOT EXISTS automated_workflow_schedule_state (
        template_id TEXT PRIMARY KEY,
        active_run_id TEXT,
        replacement_due_at INTEGER,
        coalesced_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    // Desktop-local credential vault. Secret payloads are stored separately from metadata and
    // encrypted by the main-process vault service when Electron safeStorage is available.
    version: 93,
    sql: `
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        provider TEXT,
        encrypted_payload TEXT NOT NULL,
        payload_encrypted INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_credentials_provider
        ON credentials(provider, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_credentials_name
        ON credentials(name COLLATE NOCASE);
    `,
  },
  {
    // Secret-free permission metadata for credential records. The encrypted payload remains in
    // credentials and is never copied into this table or the standalone sync snapshot.
    version: 94,
    sql: `
      CREATE TABLE IF NOT EXISTS credential_bindings (
        id TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        approval_mode TEXT NOT NULL CHECK (approval_mode IN ('auto', 'always-ask')) DEFAULT 'auto',
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_credential_bindings_lookup
        ON credential_bindings(credential_id, capability, expires_at);
      CREATE INDEX IF NOT EXISTS idx_credential_bindings_project_agent
        ON credential_bindings(project_id, agent_id, capability);
    `,
  },
  {
    // Structured web citations belong to the assistant response, not to the provider's raw
    // stream. Keeping them in their own JSON column preserves the original response text while
    // giving the renderer enough information to turn provider reference IDs into real links.
    version: 95,
    sql: `ALTER TABLE messages ADD COLUMN citations TEXT`,
  },
  {
    // Secret-free, conversation-scoped capability references. MCP credentials remain in the
    // existing encrypted server configuration and are never copied into this profile.
    version: 96,
    sql: `
      ALTER TABLE conversations ADD COLUMN capability_profile_json TEXT NOT NULL DEFAULT '{"version":1,"skillIds":[],"mcp":[]}'
      ;
      CREATE TABLE IF NOT EXISTS conversation_capability_invocations (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL CHECK (trigger IN ('explicit', 'implicit')),
        created_at INTEGER NOT NULL,
        UNIQUE(conversation_id, skill_id)
      );
      CREATE INDEX IF NOT EXISTS idx_capability_invocations_conversation
        ON conversation_capability_invocations(conversation_id, created_at);
    `,
  },
  {
    // Cross-session wake-ups. A conversation that starts a long-running job (a Gradle build, a
    // packaging run) previously had no way to be re-entered when that job finished: the harness
    // only delivers a background command's completion back into the session that spawned it, so
    // "I'll report back when it finishes" was unkeepable once the session ended. Persisting the
    // binding here lets the resolver dispatch a real follow-up turn into the conversation later,
    // including after an app restart — and lets a job interrupted by that restart surface as a
    // visible 'orphaned' row rather than silence.
    version: 97,
    sql: `
      CREATE TABLE IF NOT EXISTS deferred_callbacks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('process', 'build', 'deadline')),
        trigger_ref TEXT NOT NULL,
        label TEXT NOT NULL,
        pid INTEGER,
        project_id TEXT,
        agent_id TEXT,
        chain_depth INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'fired', 'expired', 'orphaned', 'cancelled', 'failed')) DEFAULT 'pending',
        result_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        fired_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_deferred_callbacks_trigger
        ON deferred_callbacks(trigger_kind, trigger_ref, status);
      CREATE INDEX IF NOT EXISTS idx_deferred_callbacks_status
        ON deferred_callbacks(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_deferred_callbacks_conversation
      ON deferred_callbacks(conversation_id, status);
    `,
  },
  {
    // Hermes profiles are part of a model target. Keep the existing model columns and add
    // nullable profile companions so older rows continue to mean "use the default profile".
    version: 98,
    run: (db) => {
      const hasTable = (table: string): boolean => Boolean(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      )
      const addColumn = (table: string, column: string): void => {
        if (!hasTable(table)) return
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
        if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
      }
      addColumn('projects', 'project_hermes_profile')
      addColumn('conversations', 'conversation_hermes_profile')
    },
  },
  {
    version: 99,
    sql: `
      CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        goal TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        revision_json TEXT,
        process_json TEXT,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        artifact_version_id TEXT REFERENCES artifact_versions(id) ON DELETE SET NULL,
        error_message TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_test_runs_project_started
        ON test_runs(project_id, started_at DESC);
    `,
  },
  {
    version: 100,
    sql: `
      ALTER TABLE test_runs ADD COLUMN result_json TEXT;
    `,
  },
  {
    version: 101,
    sql: `
      ALTER TABLE test_runs ADD COLUMN conversation_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_test_runs_conversation_started
        ON test_runs(conversation_id, started_at DESC);
    `,
  },
  {
    // A grant can be limited to one persisted chat. Deleting that chat revokes the grant through
    // the foreign key; no credential value is ever stored in this permission record.
    version: 102,
    sql: `
      ALTER TABLE credential_bindings ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_credential_bindings_conversation
        ON credential_bindings(conversation_id, capability, expires_at);
    `,
  },
];


export function initializeBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'blue',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      model TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      capability_profile_json TEXT NOT NULL DEFAULT '{"version":1,"skillIds":[],"mcp":[]}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity', 'tool-call')),
      content TEXT NOT NULL,
      model TEXT,
      is_edited INTEGER NOT NULL DEFAULT 0,
      previous_content TEXT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      timeline_order INTEGER,
      citations TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, timestamp);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('main', 'renderer', 'unhandled')),
      level TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info', 'debug')),
      message TEXT NOT NULL,
      stack TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_error_log_timestamp
      ON error_log(timestamp);

    CREATE TABLE IF NOT EXISTS automated_workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      goal_summary TEXT NOT NULL DEFAULT '',
      assumptions_json TEXT NOT NULL DEFAULT '[]',
      model TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'awaiting_confirmation', 'failed', 'done', 'cancelled')) DEFAULT 'pending',
      confirmation_mode TEXT NOT NULL CHECK (confirmation_mode IN ('gated', 'auto')) DEFAULT 'gated',
      current_step_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      scheduled_run_id TEXT,
      spec_sort_order INTEGER,
      template_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_automated_workflow_runs_project_updated
      ON automated_workflow_runs(project_id, updated_at DESC);
    -- idx_automated_workflow_runs_template is deliberately NOT created here — this whole
    -- CREATE TABLE is a no-op on any pre-existing (pre-migration-75) database, since
    -- CREATE TABLE IF NOT EXISTS skips a table that already exists without adding new columns
    -- to it. Indexing template_id here would crash initializeBaseSchema() on every existing
    -- install with "no such column: template_id", since this whole function runs unconditionally
    -- on every startup, before runMigrations() gets a chance to actually add the column via
    -- migration 75. Migration 75 creates this exact index itself (via runMigrations(), which
    -- always replays after initializeBaseSchema for both fresh and existing databases), so
    -- nothing is lost by leaving it out here.

    CREATE TABLE IF NOT EXISTS automated_workflow_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      goal_summary TEXT NOT NULL DEFAULT '',
      assumptions_json TEXT NOT NULL DEFAULT '[]',
      steps_json TEXT NOT NULL DEFAULT '[]',
      model TEXT,
      source_run_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automated_workflow_templates_project_updated
      ON automated_workflow_templates(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS automated_workflow_run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      step_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      agent_id TEXT,
      agent_name TEXT,
      model TEXT,
      prompt TEXT NOT NULL,
      expected_output TEXT NOT NULL DEFAULT '',
      depends_on_step_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'awaiting_confirmation', 'done', 'failed', 'skipped', 'cancelled')) DEFAULT 'pending',
      attempt INTEGER NOT NULL DEFAULT 0,
      output TEXT NOT NULL DEFAULT '',
      error TEXT,
      conversation_id TEXT,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_automated_workflow_run_steps_run_index
      ON automated_workflow_run_steps(run_id, step_index);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS conversation_tool_calls (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      tool_name       TEXT NOT NULL,
      server_name     TEXT,
      success         INTEGER NOT NULL,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_tool_calls_conv ON conversation_tool_calls(conversation_id);

    CREATE TABLE IF NOT EXISTS conversation_skill_invocations (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      skill_id        TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      created_at      INTEGER NOT NULL,
      UNIQUE(conversation_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS conversation_ratings (
      id                     TEXT PRIMARY KEY,
      conversation_id        TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
      rating                 INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      note                   TEXT,
      context_snapshot_json  TEXT NOT NULL,
      created_at             INTEGER NOT NULL,
      updated_at             INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      config_encrypted INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS agent_knowledge_files (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      file_path   TEXT NOT NULL,
      inject_mode TEXT NOT NULL DEFAULT 'always',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_mcp_tool_overrides (
      agent_id     TEXT NOT NULL,
      server_id    TEXT NOT NULL,
      tool_name    TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      approval     TEXT NOT NULL DEFAULT 'always-ask',
      instructions TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (agent_id, server_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      attached_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, skill_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_skills_agent
      ON agent_skills(agent_id, sort_order);

    CREATE TABLE IF NOT EXISTS project_agents (
      project_id   TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      is_primary   INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      added_at     INTEGER NOT NULL,
      PRIMARY KEY (project_id, agent_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id)   REFERENCES agents(id)   ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompt_library_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Custom',
      tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL CHECK (scope IN ('global', 'project')) DEFAULT 'global',
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_library_scope
      ON prompt_library_entries(scope, project_id, category, updated_at);

    CREATE TABLE IF NOT EXISTS prompt_library_versions (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Custom',
      tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL CHECK (scope IN ('global', 'project')) DEFAULT 'global',
      project_id TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(prompt_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt
      ON prompt_library_versions(prompt_id, version DESC);

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      source_message_count INTEGER NOT NULL,
      retained_message_count INTEGER NOT NULL,
      estimated_tokens_before INTEGER NOT NULL,
      target_budget INTEGER NOT NULL,
      strategy TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_updated
      ON conversation_summaries(updated_at);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      agent_id TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      model TEXT,
      conversation_id TEXT,
      schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one-time', 'daily', 'weekdays', 'weekly', 'monthly')),
      local_time TEXT NOT NULL,
      weekday INTEGER,
      month_day INTEGER,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      tool_policy_json TEXT NOT NULL DEFAULT '{"preApproved":[],"alwaysAsk":[],"neverAllow":[]}',
      notification_pref TEXT NOT NULL DEFAULT 'failures_only' CHECK (notification_pref IN ('always', 'failures_only', 'off')),
      next_run_at INTEGER,
      last_run_at INTEGER,
      target_type TEXT NOT NULL DEFAULT 'chat' CHECK (target_type IN ('chat', 'automated_workflow')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled
      ON scheduled_tasks(enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS scheduled_task_workflows (
      task_id            TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      workflow_spec_json TEXT NOT NULL,
      source_run_id      TEXT,
      confirmation_mode  TEXT NOT NULL CHECK (confirmation_mode IN ('gated', 'auto')) DEFAULT 'auto',
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL,
      PRIMARY KEY (task_id, sort_order)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_task_workflows_task
      ON scheduled_task_workflows(task_id, sort_order);

    CREATE TABLE IF NOT EXISTS scheduled_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      scheduled_at INTEGER,
      started_at INTEGER,
      finished_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'approval_required', 'success', 'failed', 'skipped')) DEFAULT 'pending',
      error TEXT,
      conversation_id TEXT,
      message_id TEXT,
      trigger_source TEXT NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')) DEFAULT 'scheduled',
      workflow_run_ids_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(task_id, scheduled_at)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task
      ON scheduled_runs(task_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status
      ON scheduled_runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS project_edit_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL CHECK (source IN ('chat-tool', 'remote-edit', 'self-heal', 'manual-apply')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_edit_sessions_project
      ON project_edit_sessions(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS project_touched_files (
      session_id TEXT NOT NULL REFERENCES project_edit_sessions(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('modified', 'created', 'deleted')),
      last_operation TEXT NOT NULL CHECK (last_operation IN ('write', 'create', 'delete', 'apply')),
      first_touched_at INTEGER NOT NULL,
      last_touched_at INTEGER NOT NULL,
      diff_json TEXT,
      PRIMARY KEY (session_id, relative_path)
    );

    CREATE INDEX IF NOT EXISTS idx_project_touched_files_session
      ON project_touched_files(session_id, last_touched_at DESC);
  `);
}

// "duplicate column name" only unambiguously proves the migration already applied when the
// statement that threw it is itself an idempotent, self-contained ADD COLUMN — in that case the
// desired end-state (the column exists) is already true regardless of what happened before or
// after it. "already exists" is only trustworthy the same way for CREATE TABLE/INDEX IF NOT
// EXISTS statements — those already declare their own idempotency, so a bare "already exists"
// engine error on top of that (rare, but possible on odd schema states) still means the intended
// object exists. Any other statement shape — a bare CREATE TABLE, INSERT, DROP TABLE, or RENAME,
// the kind chained together in table-rebuild migrations — throwing "already exists" does NOT
// prove the rebuild's end-state is correct (e.g. a stray intermediate table left by a prior
// interrupted run); swallowing it there risks marking an incomplete rebuild as done.
function isIgnorableStatementError(statement: string, error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const normalized = statement.trim().toLowerCase();
  if (message.includes("duplicate column name")) {
    return /^alter\s+table\s+\S+\s+add\s+column\b/.test(normalized);
  }
  if (message.includes("already exists")) {
    return /^create\s+(table|index)\s+if\s+not\s+exists\b/.test(normalized);
  }
  return false;
}

// Splits a migration's SQL into individual statements so that one statement's ignorable error
// (see isIgnorableStatementError) doesn't prevent independent statements after it from running —
// this matters for migrations that chain several unrelated ADD COLUMN calls, where an earlier
// "duplicate column name" must not skip a later, still-pending column addition.
function splitStatements(sql: string): string[] {
  return sql.split(";").map((part) => part.trim()).filter(Boolean);
}

export function runMigrations(
  db: Database.Database,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  const pending = migrations.filter((migration) => migration.version > currentVersion);

  if (pending.length === 0) {
    return;
  }

  const applyPendingMigrations = db.transaction(() => {
    for (const migration of pending) {
      if (migration.run) {
        migration.run(db);
      } else if (migration.sql) {
        for (const statement of splitStatements(migration.sql)) {
          try {
            db.exec(statement);
          } catch (error: unknown) {
            if (!isIgnorableStatementError(statement, error)) {
              throw error;
            }
          }
        }
      }
      // The whole pending batch runs inside one transaction, so a later migration throwing a
      // non-ignorable error rolls this bump back along with everything else in the batch —
      // user_version only actually advances once every migration below the throwing one (and
      // every statement within each) has genuinely completed or been safely ignored.
      db.pragma(`user_version = ${migration.version}`);
    }
  });

  applyPendingMigrations();
}
