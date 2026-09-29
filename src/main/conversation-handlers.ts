import { randomUUID } from "crypto";
import { getActiveChatTurnSnapshot } from "./active-chat-turns";
import { BrowserWindow, dialog } from "electron";
import { readFileSync } from "fs";
import { getDatabase } from "./database";
import { safeHandle } from "./safe-handle";
import type {
  CodexExecutionModeOverride,
  ConversationCompressionSaveInput,
  ConversationExportPackOptions,
  ConversationForkOptions,
  ConversationImportOptions,
} from "../shared/types";
import { buildConversationExport, buildConversationExportPack } from "./conversation-export";
import { importConversationExport } from "./conversation-import";
import { forkConversation } from "./conversation-fork";
import {
  getConversationCompressionPreview,
  prepareConversationCompressionSummary,
  saveConversationCompressionSummary,
} from "./conversation-compression";
import { broadcastConversationMessages } from "./chat-handlers";
import { parseConversationExport } from "./conversation-serialization";
import { approvePendingApprovalsForConversation } from "./tools";
import { listConversationPage } from "./conversation-pagination";

export {
  buildConversationExport,
  buildConversationExportPack,
  importConversationExport,
  forkConversation,
  prepareConversationCompressionSummary,
  saveConversationCompressionSummary,
  getConversationCompressionPreview,
};

export interface ConversationRecord {
  id: string;
  agent_id: string | null;
  project_id: string | null;
  title: string;
  created_at: number;
  updated_at: number;
}

/** Extracted so non-IPC callers (e.g. the automated workflow executor) can create a real,
 *  persisted conversation without going through the IPC invoke layer. */
export function createConversationRecord(
  agentId?: string | null,
  projectId?: string | null,
  title = "New Chat",
): ConversationRecord {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, agentId ?? null, projectId ?? null, title, now, now);
  return {
    id,
    agent_id: agentId ?? null,
    project_id: projectId ?? null,
    title,
    created_at: now,
    updated_at: now,
  };
}

export function registerConversationHandlers(): void {
  const db = getDatabase();
  const columns = db
    .prepare("PRAGMA table_info(conversations)")
    .all() as Array<{ name: string }>;
  const ensureConversationModelColumn = () => {
    if (!columns.some((col) => col.name === "model")) {
      db.exec("ALTER TABLE conversations ADD COLUMN model TEXT");
      columns.push({ name: "model" });
    }
  };
  // Eagerly ensure cli_backend exists so chat dispatch can SELECT it safely.
  if (!columns.some((col) => col.name === "cli_backend")) {
    db.exec("ALTER TABLE conversations ADD COLUMN cli_backend TEXT");
  }

  safeHandle("conversation:list", () => {
    return db
      .prepare(
        `SELECT c.*, cr.rating as rating FROM conversations c
         LEFT JOIN conversation_ratings cr ON cr.conversation_id = c.id
         WHERE c.archived = 0 AND c.kind != 'project-conversation-mode'
         ORDER BY c.updated_at DESC`,
      )
      .all();
  });

  safeHandle("conversation:list-page", (_event, request) => {
    return listConversationPage(db, request);
  });

  safeHandle(
    "conversation:create",
    (_event, agentId?: string, projectId?: string) => createConversationRecord(agentId, projectId),
  );

  safeHandle("conversation:compression-preview", (_event, conversationId: string) => {
    return getConversationCompressionPreview(db, conversationId);
  });

  safeHandle("conversation:prepare-compression-summary", (_event, conversationId: string) => {
    return prepareConversationCompressionSummary(db, conversationId);
  });

  safeHandle("conversation:save-compression-summary", (_event, input: ConversationCompressionSaveInput) => {
    return saveConversationCompressionSummary(db, input);
  });

  safeHandle("conversation:delete", (_event, id: string) => {
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return true;
  });

  safeHandle("conversation:export-json", (_event, conversationId: string) => {
    return buildConversationExport(db, conversationId);
  });

  safeHandle("conversation:export-pack", (_event, conversationId: string, options?: ConversationExportPackOptions) => {
    return buildConversationExportPack(db, conversationId, options ?? { format: "json" });
  });

  safeHandle("conversation:fork", (_event, conversationId: string, options?: ConversationForkOptions) => {
    return forkConversation(db, conversationId, options);
  });

  safeHandle("conversation:import-json", async (_event, options?: ConversationImportOptions) => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "Import conversation",
      properties: ["openFile"],
      filters: [
        { name: "Nexy conversation", extensions: ["json"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const raw = readFileSync(result.filePaths[0], "utf-8");
    const exported = parseConversationExport(JSON.parse(raw));
    return importConversationExport(db, exported, options);
  });

  safeHandle("conversation:get-messages", (_event, conversationId: string) => {
    return db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC",
      )
      .all(conversationId);
  });

  safeHandle("chat:get-active-turn", (_event, conversationId: string) => {
    return getActiveChatTurnSnapshot(conversationId);
  });

  safeHandle(
    "conversation:insert-message",
    (_event, conversationId: string, role: string, content: string) => {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
      ).run(id, conversationId, role, content, now);
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
      // The caller that invoked this (e.g. a delayed code-change result) may have switched away
      // from this conversation between starting the command and this insert landing — this
      // notifies every window so whichever one currently has it open picks the message up live
      // instead of only showing it after the user navigates away and back.
      broadcastConversationMessages(conversationId);
      return db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
    },
  );

  safeHandle("conversation:search", (_event, query: string) => {
    if (!query.trim()) {
      return db
        .prepare(
          "SELECT * FROM conversations WHERE archived = 0 AND kind != 'project-conversation-mode' ORDER BY updated_at DESC",
        )
        .all();
    }
    const searchTerm = `%${query}%`;
    return db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.archived = 0 AND c.kind != 'project-conversation-mode'
           AND (c.title LIKE ? OR m.content LIKE ?)
         ORDER BY c.updated_at DESC`,
      )
      .all(searchTerm, searchTerm);
  });

  safeHandle("conversation:rename", (_event, id: string, title: string) => {
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
    ).run(title, Date.now(), id);
    return true;
  });

  safeHandle(
    "conversation:set-model",
    (_event, id: string, model: string | null, cliBackend?: string | null, hermesProfile?: string | null) => {
      ensureConversationModelColumn();
      db.prepare(
        "UPDATE conversations SET model = ?, conversation_hermes_profile = ?, cli_backend = ?, updated_at = ? WHERE id = ?",
      ).run(model, model && cliBackend === 'hermes-cli' ? (hermesProfile?.trim() || null) : null, cliBackend ?? null, Date.now(), id);
      return true;
    },
  );

  safeHandle(
    "conversation:set-mode",
    (
      _event,
      id: string,
      mode: {
        thinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null;
        fullAutoApproveOverride?: boolean | null;
        agenticModeOverride?: boolean | null;
        terminalSandboxOverride?: boolean | null;
        cliModeOverride?: string | null;
        codexExecutionModeOverride?: CodexExecutionModeOverride | null;
      },
    ) => {
      // Only the field(s) actually present in `mode` are touched — a caller updating just one
      // of the overrides must not silently clear the others back to "inherit agent/project default".
      const existing = db
        .prepare("SELECT thinking_effort_override, full_auto_approve_override, agentic_mode_override, terminal_sandbox_override, cli_mode_override, codex_execution_mode_override FROM conversations WHERE id = ?")
        .get(id) as { thinking_effort_override: string | null; full_auto_approve_override: number | null; agentic_mode_override: number | null; terminal_sandbox_override: number | null; cli_mode_override: string | null; codex_execution_mode_override: string | null } | undefined;
      const thinkingEffortOverride = "thinkingEffortOverride" in mode
        ? (mode.thinkingEffortOverride ?? null)
        : (existing?.thinking_effort_override ?? null);
      const fullAutoApproveOverride = "fullAutoApproveOverride" in mode
        ? (mode.fullAutoApproveOverride === true ? 1 : mode.fullAutoApproveOverride === false ? 0 : null)
        : (existing?.full_auto_approve_override ?? null);
      const agenticModeOverride = "agenticModeOverride" in mode
        ? (mode.agenticModeOverride === true ? 1 : mode.agenticModeOverride === false ? 0 : null)
        : (existing?.agentic_mode_override ?? null);
      const terminalSandboxOverride = "terminalSandboxOverride" in mode
        ? (mode.terminalSandboxOverride === true ? 1 : mode.terminalSandboxOverride === false ? 0 : null)
        : (existing?.terminal_sandbox_override ?? null);
      const cliModeOverride = "cliModeOverride" in mode
        ? (mode.cliModeOverride ?? null)
        : (existing?.cli_mode_override ?? null);
      const codexExecutionModeOverride = "codexExecutionModeOverride" in mode
        ? (mode.codexExecutionModeOverride === "plan" ? "plan" : null)
        : (existing?.codex_execution_mode_override ?? null);
      db.prepare(
        "UPDATE conversations SET thinking_effort_override = ?, full_auto_approve_override = ?, agentic_mode_override = ?, terminal_sandbox_override = ?, cli_mode_override = ?, codex_execution_mode_override = ?, updated_at = ? WHERE id = ?",
      ).run(thinkingEffortOverride, fullAutoApproveOverride, agenticModeOverride, terminalSandboxOverride, cliModeOverride, codexExecutionModeOverride, Date.now(), id);
      if (cliModeOverride === "bypassPermissions") {
        approvePendingApprovalsForConversation(id);
      }
      return true;
    },
  );

  safeHandle(
    "conversation:set-pinned",
    (_event, id: string, pinned: boolean) => {
      db.prepare(
        "UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?",
      ).run(pinned ? 1 : 0, Date.now(), id);
      return true;
    },
  );

  safeHandle(
    "conversation:update-context",
    (
      _event,
      updates: { conversationId: string; projectId?: string | null; agentId?: string | null },
    ) => {
      const assignments: string[] = [];
      const values: Array<string | number | null> = [];

      if (Object.prototype.hasOwnProperty.call(updates, "projectId")) {
        assignments.push("project_id = ?");
        values.push(updates.projectId ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, "agentId")) {
        assignments.push("agent_id = ?");
        values.push(updates.agentId ?? null);
      }
      if (assignments.length === 0) {
        return true;
      }

      assignments.push("updated_at = ?");
      values.push(Date.now());
      values.push(updates.conversationId);
      db.prepare(
        `UPDATE conversations SET ${assignments.join(", ")} WHERE id = ?`,
      ).run(...values);
      return true;
    },
  );
}

export function registerMessageHandlers(): void {
  const db = getDatabase();

  safeHandle("message:delete", (_event, id: string) => {
    db.prepare("DELETE FROM messages WHERE id = ?").run(id);
    return true;
  });

  safeHandle(
    "message:delete-after",
    (_event, conversationId: string, timestamp: number) => {
      db.prepare(
        "DELETE FROM messages WHERE conversation_id = ? AND timestamp >= ?",
      ).run(conversationId, timestamp);
      broadcastConversationMessages(conversationId);
      return true;
    },
  );
}
