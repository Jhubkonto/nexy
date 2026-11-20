import { loadConversationHistory, historyRevision } from './conversation-continuity';
import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type {
  ConversationCompressionDraft,
  ConversationCompressionPreview,
  ConversationCompressionSaveInput,
  StructuredConversationSummary,
} from "../shared/types";
import {
  CompressionSourceMessage,
  ConversationSummaryRow,
  ForkMessageInput,
  isRecord,
  parseJson,
} from "./conversation-types";
import {
  buildStructuredSummary,
  estimateMessageTokens,
  estimateTokens,
  renderStructuredSummary,
  resolveContextWindow,
} from "./context-compression";
import { summarizeForCompression } from "./conversation-fork";

function parseCompressionSections(value: string): ConversationCompressionPreview["sections"] {
  const parsed = parseJson<unknown>(value, null);
  if (!isRecord(parsed)) return null;
  const getList = (key: string): string[] => {
    const item = parsed[key];
    return Array.isArray(item) ? item.filter((value): value is string => typeof value === "string") : [];
  };
  return {
    goals: getList("goals"),
    decisions: getList("decisions"),
    constraints: getList("constraints"),
    filesTouched: getList("filesTouched"),
    commandsRun: getList("commandsRun"),
    openQuestions: getList("openQuestions"),
    nextActions: getList("nextActions"),
    recentContextNotes: getList("recentContextNotes"),
  };
}

function emptyCompressionSections(): StructuredConversationSummary {
  return {
    goals: [],
    decisions: [],
    constraints: [],
    filesTouched: [],
    commandsRun: [],
    openQuestions: [],
    nextActions: [],
    recentContextNotes: [],
  };
}

function normalizeCompressionSections(value: StructuredConversationSummary): StructuredConversationSummary {
  const cleanList = (items: string[]): string[] => (
    Array.isArray(items)
      ? items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 24)
      : []
  );
  return {
    goals: cleanList(value.goals),
    decisions: cleanList(value.decisions),
    constraints: cleanList(value.constraints),
    filesTouched: cleanList(value.filesTouched),
    commandsRun: cleanList(value.commandsRun),
    openQuestions: cleanList(value.openQuestions),
    nextActions: cleanList(value.nextActions),
    recentContextNotes: cleanList(value.recentContextNotes),
  };
}

function getCompressionSourceMessages(db: Database.Database, conversationId: string): CompressionSourceMessage[] {
  return loadConversationHistory(db, conversationId, '__all__').map((message) => ({ ...message, timestamp: message.timestamp ?? 0 }));
}

function getRetainedTailTokens(db: Database.Database, conversationId: string, retainedCount: number): number {
  if (retainedCount <= 0) return 0;
  const rows = db
    .prepare(
      `SELECT content
       FROM messages
       WHERE conversation_id = ? AND role != 'system'
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(conversationId, retainedCount) as { content: string }[];
  return rows.reduce((sum, row) => sum + estimateTokens(row.content), 0);
}

function getConversationCompressionModel(db: Database.Database, conversationId: string): string | null {
  const row = db
    .prepare(
      `SELECT c.model AS conversation_model, p.default_model AS project_model
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.id = ?`,
    )
    .get(conversationId) as { conversation_model: string | null; project_model: string | null } | undefined;
  return row?.conversation_model ?? row?.project_model ?? null;
}

export function prepareConversationCompressionSummary(
  db: Database.Database,
  conversationId: string,
): ConversationCompressionDraft {
  const messages = getCompressionSourceMessages(db, conversationId);
  if (messages.length === 0) {
    return {
      conversation_id: conversationId,
      summarized_message_count: 0,
      retained_message_count: 0,
      omitted_message_count: 0,
      estimated_tokens_before: 0,
      estimated_tokens_after: 0,
      target_budget: 0,
      strategy: "manual-structured-summary-plus-recent-turns",
      sections: emptyCompressionSections(),
    };
  }

  const model = getConversationCompressionModel(db, conversationId);
  const contextWindow = resolveContextWindow(db, model) ?? 32_768;
  const targetBudget = Math.max(0, Math.floor(contextWindow * 0.9) - Math.min(8192, Math.floor(contextWindow * 0.25)) - 512);
  const estimatedTokensBefore = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const retainedCount = messages.length <= 4 ? 1 : Math.min(8, Math.max(4, Math.ceil(messages.length * 0.25)));
  const summarizedCount = Math.max(0, messages.length - retainedCount);
  const summarizedMessages = summarizedCount > 0 ? messages.slice(0, summarizedCount) : messages;
  const sections = buildStructuredSummary(summarizedMessages);
  if (sections.recentContextNotes.length === 0 && summarizedMessages.length > 0) {
    sections.recentContextNotes.push(summarizeForCompression(
      summarizedMessages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        model: null,
        isEdited: 0,
        previousContent: null,
        attachmentsJson: null,
        contextSnapshotJson: "{}",
        rewritten: false,
      } satisfies ForkMessageInput)),
      Math.max(2_000, Math.floor(targetBudget * 1.2)),
    ));
  }

  const normalizedSections = normalizeCompressionSections(sections);
  const retainedMessages = messages.slice(summarizedCount);
  const estimatedTokensAfter =
    estimateTokens(renderStructuredSummary(normalizedSections)) +
    retainedMessages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

  return {
    conversation_id: conversationId,
    summarized_message_count: summarizedCount,
    retained_message_count: messages.length - summarizedCount,
    omitted_message_count: 0,
    estimated_tokens_before: estimatedTokensBefore,
    estimated_tokens_after: estimatedTokensAfter,
    target_budget: targetBudget,
    strategy: "manual-structured-summary-plus-recent-turns",
    sections: normalizedSections,
  };
}

export function saveConversationCompressionSummary(
  db: Database.Database,
  input: ConversationCompressionSaveInput,
): ConversationCompressionPreview {
  const now = Date.now();
  const sections = normalizeCompressionSections(input.sections);
  const summaryText = renderStructuredSummary(sections);
  const summarizedCount = Math.max(0, Math.floor(input.summarizedMessageCount));
  const retainedCount = Math.max(0, Math.floor(input.retainedMessageCount));
  const estimatedTokensBefore = Math.max(0, Math.floor(input.estimatedTokensBefore));
  const targetBudget = Math.max(0, Math.floor(input.targetBudget));
  const strategy = input.strategy.trim() || "manual-structured-summary-plus-recent-turns";

  db.prepare(
    `INSERT INTO conversation_summaries
      (id, conversation_id, summary, summary_json, source_message_count, retained_message_count, estimated_tokens_before, target_budget, strategy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
      summary = excluded.summary,
      summary_json = excluded.summary_json,
      source_message_count = excluded.source_message_count,
      retained_message_count = excluded.retained_message_count,
      estimated_tokens_before = excluded.estimated_tokens_before,
      target_budget = excluded.target_budget,
      strategy = excluded.strategy,
      updated_at = excluded.updated_at`,
  ).run(
    randomUUID(),
    input.conversationId,
    summaryText,
    JSON.stringify(sections),
    summarizedCount,
    retainedCount,
    estimatedTokensBefore,
    targetBudget,
    strategy,
    now,
    now,
  );

  db.prepare('UPDATE conversation_summaries SET source_revision = ? WHERE conversation_id = ?')
    .run(historyRevision(loadConversationHistory(db, input.conversationId, '__all__').slice(0, summarizedCount)), input.conversationId);

  return getConversationCompressionPreview(db, input.conversationId);
}

export function getConversationCompressionPreview(
  db: Database.Database,
  conversationId: string,
): ConversationCompressionPreview {
  const total = (db
    .prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ? AND role != 'system'")
    .get(conversationId) as { count: number } | undefined)?.count ?? 0;
  const row = db
    .prepare("SELECT * FROM conversation_summaries WHERE conversation_id = ?")
    .get(conversationId) as ConversationSummaryRow | undefined;

  if (!row) {
    return {
      conversation_id: conversationId,
      has_summary: false,
      summarized_message_count: 0,
      retained_message_count: total,
      omitted_message_count: 0,
      estimated_tokens_before: 0,
      estimated_tokens_after: 0,
      target_budget: 0,
      strategy: null,
      updated_at: null,
      sections: null,
    };
  }

  const summarized = row.source_message_count;
  const retained = row.retained_message_count;
  const estimatedTokensAfter = estimateTokens(row.summary) + getRetainedTailTokens(db, conversationId, retained);
  return {
    conversation_id: conversationId,
    has_summary: true,
    summarized_message_count: summarized,
    retained_message_count: retained,
    omitted_message_count: Math.max(0, total - summarized - retained),
    estimated_tokens_before: row.estimated_tokens_before,
    estimated_tokens_after: estimatedTokensAfter,
    target_budget: row.target_budget,
    strategy: row.strategy,
    updated_at: row.updated_at,
    sections: parseCompressionSections(row.summary_json),
  };
}
