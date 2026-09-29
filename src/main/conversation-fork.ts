import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type {
  ConversationForkOptions,
  ConversationForkResult,
} from "../shared/types";
import {
  CompressionPlan,
  ForkMessageInput,
  getConversationRow,
  isRecord,
  MessageExportRow,
  parseJson,
} from "./conversation-types";
import { roleLabel } from "./conversation-formatters";
import { getCliModels } from "./cli-detection";
import { estimateMessageTokens, resolveContextWindow } from "./context-compression";
import { isLegacyPortableOperationalSummary } from "../shared/conversation-portability";

type AgentBackend = "claude-cli" | "codex-cli" | "hermes-cli";

function getAgentBackendConfig(db: Database.Database, agentId: string | null) {
  if (!agentId) return { backend: null as AgentBackend | null, cliModel: null as string | null };
  const row = db
    .prepare("SELECT config_json FROM agents WHERE id = ?")
    .get(agentId) as { config_json: string } | undefined;
  if (!row) throw new Error("Target agent not found");
  const config = parseJson<Record<string, unknown>>(row.config_json, {});
  const backend = config.backend === "claude-cli" || config.backend === "codex-cli" || config.backend === "hermes-cli"
    ? config.backend
    : null;
  return {
    backend,
    cliModel: typeof config.cliModel === "string" ? config.cliModel : null,
  };
}

function validateForkTarget(db: Database.Database, agentId: string | null, model: string | null): string | null {
  const { backend, cliModel } = getAgentBackendConfig(db, agentId);
  if (backend === "claude-cli" || backend === "codex-cli" || backend === "hermes-cli") {
    const availableModels = getCliModels(backend).map((entry) => entry.id);
    const resolvedModel = model ?? cliModel ?? availableModels[0] ?? null;
    // A newly installed Claude Code session has no confirmed picker snapshot until the
    // background probe completes. Preserve an explicitly configured legacy Claude agent in
    // that short window; it remains an intentional backend/model pairing, not a new picker
    // choice. Once discovery has a snapshot, normal compatibility validation resumes.
    if (backend === 'claude-cli' && availableModels.length === 0 && cliModel && resolvedModel === cliModel) {
      return resolvedModel;
    }
    if (resolvedModel && !availableModels.includes(resolvedModel)) {
      throw new Error(`Model ${resolvedModel} is not available for ${backend}`);
    }
    return resolvedModel;
  }
  return model;
}

function shouldOmitFromFork(row: MessageExportRow): boolean {
  return row.role === "tool-call"
    || row.role === "team-activity"
    || isLegacyPortableOperationalSummary(row.role, row.content);
}

function continuedTitle(title: string): string {
  return `Continued: ${title.replace(/^(?:Continued:\s*)+/i, "").trim()}`;
}

function buildForkContextSnapshot(row: MessageExportRow, now: number, sourceConversationId: string, rewrites: string[]): string {
  const contextSnapshot = parseJson<unknown>(row.context_snapshot, null);
  const next = isRecord(contextSnapshot) ? { ...contextSnapshot } : {};
  return JSON.stringify({
    ...next,
    nexyFork: {
      sourceConversationId,
      sourceMessageId: row.id,
      forkedAt: now,
      compatibilityRewrites: rewrites,
    },
  });
}

function mergeCompressionSnapshot(contextSnapshotJson: string, metadata: Record<string, unknown>): string {
  const existing = parseJson<unknown>(contextSnapshotJson, null);
  const base = isRecord(existing) ? { ...existing } : {};
  return JSON.stringify({ ...base, nexyCompression: metadata });
}

export function summarizeForCompression(messages: ForkMessageInput[], maxChars: number): string {
  const lines: string[] = [];
  for (const message of messages) {
    const compact = message.content.replace(/\s+/g, " ").trim();
    const preview = compact.length > 360 ? `${compact.slice(0, 360).trimEnd()}...` : compact;
    lines.push(`- ${roleLabel(message.role)}: ${preview || "No content"}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  const summary = lines.join("\n");
  return summary.length > maxChars ? `${summary.slice(0, maxChars).trimEnd()}\n...[summary truncated]` : summary;
}

export function maybeCompressForkMessages(
  db: Database.Database,
  messages: ForkMessageInput[],
  sourceConversationId: string,
  targetModel: string | null,
  now: number,
): CompressionPlan {
  const targetContextWindow = resolveContextWindow(db, targetModel);
  if (!targetContextWindow || messages.length <= 4) {
    return { messages, compressedCount: 0 };
  }

  const estimatedOriginalTokens = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const targetBudget = Math.floor(targetContextWindow * 0.75);
  if (estimatedOriginalTokens <= targetBudget) {
    return { messages, compressedCount: 0 };
  }

  const summaryBudget = Math.max(512, Math.floor(targetBudget * 0.25));
  const tailBudget = Math.max(1_000, targetBudget - summaryBudget);
  const retained: ForkMessageInput[] = [];
  let retainedTokens = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const nextTokens = estimateMessageTokens(message);
    if (retained.length >= 4 && retainedTokens + nextTokens > tailBudget) break;
    retained.unshift(message);
    retainedTokens += nextTokens;
  }

  const compressed = messages.slice(0, messages.length - retained.length);
  if (compressed.length === 0) {
    return { messages, compressedCount: 0 };
  }

  const metadata = {
    sourceConversationId,
    compressedAt: now,
    targetModel,
    targetContextWindow,
    targetBudget,
    estimatedOriginalTokens,
    compressedMessageCount: compressed.length,
    retainedMessageCount: retained.length,
    strategy: "deterministic-summary-plus-recent-turns",
  };
  const summaryContent = [
    "[Compressed continuation context]",
    `Target model: ${targetModel}`,
    `Target context window: ${targetContextWindow} tokens`,
    `Original estimate: ${estimatedOriginalTokens} tokens`,
    `Compressed older messages: ${compressed.length}`,
    `Retained recent messages: ${retained.length}`,
    "",
    "Summary of compressed messages:",
    summarizeForCompression(compressed, summaryBudget * 4),
  ].join("\n");
  const summaryMessage: ForkMessageInput = {
    role: "system",
    content: summaryContent,
    model: targetModel,
    isEdited: 0,
    previousContent: null,
    attachmentsJson: null,
    contextSnapshotJson: JSON.stringify({ nexyCompression: metadata }),
    timestamp: compressed[0]?.timestamp ?? now,
    rewritten: true,
    citationsJson: null,
  };
  const retainedWithMetadata = retained.map((message) => ({
    ...message,
    contextSnapshotJson: mergeCompressionSnapshot(message.contextSnapshotJson, {
      ...metadata,
      retainedFromCompression: true,
    }),
  }));

  return {
    messages: [summaryMessage, ...retainedWithMetadata],
    compressedCount: compressed.length,
  };
}

function rewriteMessageForTarget(row: MessageExportRow, now: number, sourceConversationId: string): ForkMessageInput {
  const rewrites: string[] = [];
  let role = row.role;
  let content = row.content;
  const attachmentsJson = row.attachments;

  if (!["user", "assistant", "system"].includes(row.role)) {
    role = "system";
    content = `[Portable unsupported-role summary]\nOriginal role: ${row.role}\n\n${row.content}`;
    rewrites.push("unsupported-role-to-system-summary");
  }

  return {
    role,
    content,
    model: row.model,
    isEdited: row.is_edited,
    previousContent: row.previous_content,
    attachmentsJson,
    contextSnapshotJson: buildForkContextSnapshot(row, now, sourceConversationId, rewrites),
    timestamp: row.timestamp,
    rewritten: rewrites.length > 0,
    citationsJson: row.citations,
  };
}

export function forkConversation(
  db: Database.Database,
  conversationId: string,
  options: ConversationForkOptions = {},
): ConversationForkResult {
  const source = getConversationRow(db, conversationId);
  if (!source) throw new Error("Conversation not found");

  const now = Date.now();
  const forkId = randomUUID();
  const targetAgentId = Object.prototype.hasOwnProperty.call(options, "agentId")
    ? (options.agentId ?? null)
    : source.agent_id;
  const requestedModel = Object.prototype.hasOwnProperty.call(options, "model")
    ? (options.model === "default" ? null : options.model ?? null)
    : source.model;
  const targetModel = validateForkTarget(db, targetAgentId, requestedModel);
  const targetHermesProfile = targetModel && (targetModel === requestedModel || !Object.prototype.hasOwnProperty.call(options, "model"))
    ? (options.conversationHermesProfile ?? source.conversation_hermes_profile ?? null)
    : null;
  const targetProjectId = Object.prototype.hasOwnProperty.call(options, "projectId")
    ? (options.projectId ?? null)
    : source.project_id;
  if (targetProjectId) {
    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(targetProjectId);
    if (!project) throw new Error("Target project not found");
  }

  const cutoff = typeof options.cutoffTimestamp === "number" ? options.cutoffTimestamp : null;
  const rows = db
    .prepare(
      `SELECT id, conversation_id, role, content, model, is_edited, previous_content,
              timestamp, attachments, context_snapshot, citations
       FROM messages
       WHERE conversation_id = ?${cutoff !== null ? " AND timestamp <= ?" : ""}
       ORDER BY timeline_order ASC, timestamp ASC, id ASC`,
    )
    .all(...(cutoff !== null ? [conversationId, cutoff] : [conversationId])) as MessageExportRow[];
  const retainedRows = rows.filter((row) => !shouldOmitFromFork(row));
  const omittedMessageCount = rows.length - retainedRows.length;
  const rewrittenForkMessages = retainedRows.map((row) => rewriteMessageForTarget(row, now, conversationId));
  const compressionPlan = maybeCompressForkMessages(db, rewrittenForkMessages, conversationId, targetModel, now);
  const forkMessages = compressionPlan.messages;

  const transaction = db.transaction(() => {
    db.prepare(
      "INSERT INTO conversations (id, agent_id, project_id, title, model, conversation_hermes_profile, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(forkId, targetAgentId, targetProjectId, continuedTitle(source.title), targetModel, targetHermesProfile, 0, now, now);

    const insertMessage = db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, model, is_edited, previous_content, attachments, context_snapshot, timestamp, citations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const message of forkMessages) {
      insertMessage.run(
        randomUUID(), forkId, message.role, message.content, message.model,
        message.isEdited, message.previousContent, message.attachmentsJson,
        message.contextSnapshotJson, message.timestamp, message.citationsJson,
      );
    }
  });

  transaction();
  const conversation = getConversationRow(db, forkId);
  if (!conversation) throw new Error("Forked conversation could not be loaded");

  return {
    conversation,
    message_count: forkMessages.length,
    rewritten_message_count: rewrittenForkMessages.filter((message) => message.rewritten).length,
    compressed_message_count: compressionPlan.compressedCount,
    omitted_message_count: omittedMessageCount,
  };
}
