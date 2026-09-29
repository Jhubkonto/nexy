import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type {
  ConversationExportV1,
  ConversationImportOptions,
  ConversationImportResult,
} from "../shared/types";
import { getConversationRow, ImportedMessageInput, isRecord } from "./conversation-types";

function serializeContextSnapshot(
  message: ConversationExportV1["messages"][number],
  importedIntoExisting: boolean,
): string | null {
  const base = isRecord(message.context_snapshot)
    ? { ...message.context_snapshot }
    : message.context_refs.length > 0
      ? { contextRefs: message.context_refs }
      : {};
  const next = {
    ...base,
    nexyImport: {
      originalMessageId: message.id,
      originalTimestamp: message.timestamp,
      importedAt: Date.now(),
      timestampShifted: importedIntoExisting,
    },
  };
  return JSON.stringify(next);
}

function normalizeImportedMessages(
  exported: ConversationExportV1,
  importedIntoExisting: boolean,
  existingMaxTimestamp: number | null,
): ImportedMessageInput[] {
  const supportedRoles = new Set(["user", "assistant", "system", "team-activity", "tool-call"]);
  const baseTimestamp = importedIntoExisting ? Math.max(Date.now(), existingMaxTimestamp ?? 0) : null;

  return exported.messages.map((message, index) => ({
    role: supportedRoles.has(message.role) ? message.role : "system",
    content: message.content,
    model: message.model ?? null,
    isEdited: message.is_edited ? 1 : 0,
    previousContent: message.previous_content ?? null,
    attachmentsJson: message.attachments.length > 0 ? JSON.stringify(message.attachments) : null,
    contextSnapshotJson: serializeContextSnapshot(message, importedIntoExisting),
    timestamp: baseTimestamp == null ? message.timestamp : baseTimestamp + index + 1,
    citationsJson: message.citations?.length ? JSON.stringify(message.citations) : null,
  }));
}

export function importConversationExport(
  db: Database.Database,
  exported: ConversationExportV1,
  options: ConversationImportOptions = {},
): ConversationImportResult {
  const now = Date.now();
  const targetConversationId = options.targetConversationId ?? null;
  const existingConversation = targetConversationId ? getConversationRow(db, targetConversationId) : null;
  if (targetConversationId && !existingConversation) {
    throw new Error("Target conversation not found");
  }
  const importedIntoExisting = !!existingConversation;
  const conversationId = existingConversation?.id ?? randomUUID();
  const importedTitle = exported.conversation.title?.trim() || "Imported conversation";
  const title = importedIntoExisting
    ? existingConversation.title
    : importedTitle.startsWith("Imported: ") ? importedTitle : `Imported: ${importedTitle}`;
  const existingMaxTimestamp = importedIntoExisting
    ? (db
        .prepare("SELECT MAX(timestamp) AS maxTimestamp FROM messages WHERE conversation_id = ?")
        .get(conversationId) as { maxTimestamp: number | null } | undefined)?.maxTimestamp ?? null
    : null;
  const messages = normalizeImportedMessages(exported, importedIntoExisting, existingMaxTimestamp);

  const transaction = db.transaction(() => {
    if (!importedIntoExisting) {
      const projectId = exported.conversation.project_id
        ? (db.prepare("SELECT id FROM projects WHERE id = ?").get(exported.conversation.project_id) ? exported.conversation.project_id : null)
        : null;
      const agentId = exported.conversation.agent_id
        ? (db.prepare("SELECT id FROM agents WHERE id = ?").get(exported.conversation.agent_id) ? exported.conversation.agent_id : null)
        : null;
      db.prepare(
        "INSERT INTO conversations (id, agent_id, project_id, title, model, conversation_hermes_profile, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        conversationId,
        agentId,
        projectId,
        title,
        exported.conversation.model ?? null,
        exported.conversation.conversation_hermes_profile ?? null,
        0,
        exported.conversation.created_at ?? now,
        now,
      );
    }

    const insertMessage = db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, model, is_edited, previous_content, attachments, context_snapshot, timestamp, citations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const message of messages) {
      insertMessage.run(
        randomUUID(),
        conversationId,
        message.role,
        message.content,
        message.model,
        message.isEdited,
        message.previousContent,
        message.attachmentsJson,
        message.contextSnapshotJson,
        message.timestamp,
        message.citationsJson,
      );
    }

    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  });

  transaction();
  const conversation = getConversationRow(db, conversationId);
  if (!conversation) {
    throw new Error("Imported conversation could not be loaded");
  }
  return {
    conversation,
    message_count: messages.length,
    imported_into_existing: importedIntoExisting,
  };
}
