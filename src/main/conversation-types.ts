import type Database from "better-sqlite3";
import type { ConversationRow } from "../shared/types";

export type MessageExportRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  is_edited: number;
  previous_content: string | null;
  timestamp: number;
  attachments: string | null;
  context_snapshot: string | null;
  citations: string | null;
  continuation_json?: string | null;
  provider_history?: string | null;
};

export type ImportedMessageInput = {
  role: string;
  content: string;
  model: string | null;
  isEdited: number;
  previousContent: string | null;
  attachmentsJson: string | null;
  contextSnapshotJson: string | null;
  timestamp: number;
  citationsJson?: string | null;
  continuationJson?: string | null;
  providerHistory?: string | null;
};

export type ForkMessageInput = {
  role: string;
  content: string;
  model: string | null;
  isEdited: number;
  previousContent: string | null;
  attachmentsJson: string | null;
  contextSnapshotJson: string;
  timestamp: number;
  rewritten: boolean;
  citationsJson?: string | null;
  continuationJson?: string | null;
  providerHistory?: string | null;
};

export type CompressionPlan = {
  messages: ForkMessageInput[];
  compressedCount: number;
};

export type AgentBackend = "claude-cli" | "codex-cli" | "hermes-cli";

export type AgentBackendConfig = {
  backend: AgentBackend | null;
  cliModel: string | null;
};

export type ConversationSummaryRow = {
  summary: string;
  summary_json: string;
  source_message_count: number;
  retained_message_count: number;
  estimated_tokens_before: number;
  target_budget: number;
  strategy: string;
  updated_at: number;
};

export type CompressionSourceMessage = {
  role: string;
  content: string;
  timestamp: number;
};

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function arrayFromJson<T>(value: string | null | undefined): T[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function getConversationRow(db: Database.Database, conversationId: string): ConversationRow | null {
  const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as ConversationRow | undefined;
  return row ?? null;
}
