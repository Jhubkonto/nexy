import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { CatalogModel, StructuredConversationSummary } from "../shared/types";

export type CompressibleMessage = {
  role: string;
  content: string;
  timestamp?: number;
  providerHistory?: string | null;
};

export type RollingCompressionResult = {
  messages: CompressibleMessage[];
  summary: {
    id: string;
    compressedMessageCount: number;
    retainedMessageCount: number;
    estimatedTokensBefore: number;
    targetBudget: number;
    structuredSummary: StructuredConversationSummary;
  } | null;
};

const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_SUMMARY_THRESHOLD = 12_000;

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export function estimateMessageTokens(message: CompressibleMessage): number {
  return estimateTokens(`${message.role}\n${message.content}`);
}

function getCatalogSnapshot(db: Database.Database): CatalogModel[] {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'model_catalog_snapshot'")
    .get() as { value: string } | undefined;
  if (!row) return [];
  const parsed = parseJson<unknown>(row.value, []);
  return Array.isArray(parsed) ? parsed as CatalogModel[] : [];
}

export function fallbackContextWindow(model: string): number | null {
  const lower = model.toLowerCase();
  if (lower.includes("deepseek-flash") || lower.includes("deepseek-v4")) return 1_000_000;
  if (lower.includes("deepseek-chat") || lower.includes("deepseek-reasoner")) return 128_000;
  if (lower.includes("gemma")) return 8_192;
  if (lower.includes("open-mistral") || lower.includes("mixtral")) return 32_768;
  if (lower.includes("llama") || lower.includes("qwen") || lower.includes("deepseek") || lower.includes("phi")) return 32_768;
  if (lower.includes("local") || lower.includes("ollama")) return 16_384;
  if (lower.includes("gpt-4") || lower.includes("gpt-5")) return 128_000;
  if (lower.includes("claude")) return 200_000;
  return null;
}

export function resolveContextWindow(db: Database.Database, model: string | null): number | null {
  if (!model || model === "default") return null;
  const catalogEntry = getCatalogSnapshot(db).find((entry) => entry.id === model);
  if (typeof catalogEntry?.contextWindow === "number" && catalogEntry.contextWindow > 0) {
    return catalogEntry.contextWindow;
  }
  return fallbackContextWindow(model);
}

function roleLabel(role: string): string {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  if (role === "tool-call") return "Tool call";
  if (role === "team-activity") return "Team activity";
  return role;
}

function summarizeMessages(messages: CompressibleMessage[], maxChars: number): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = message.content.replace(/\s+/g, " ").trim();
    const preview = text.length > 360 ? `${text.slice(0, 360).trimEnd()}...` : text;
    lines.push(`- ${roleLabel(message.role)}: ${preview || "No content"}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  const summary = lines.join("\n");
  return summary.length > maxChars ? `${summary.slice(0, maxChars).trimEnd()}\n...[summary truncated]` : summary;
}

function uniquePush(list: string[], value: string, limit: number): void {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || list.includes(cleaned) || list.length >= limit) return;
  list.push(cleaned);
}

function extractInlineCode(text: string): string[] {
  const matches = text.match(/`([^`]{2,160})`/g) ?? [];
  return matches.map((match) => match.slice(1, -1));
}

function extractFiles(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_.:/\\-]+\.(?:ts|tsx|js|jsx|json|md|css|html|py|java|kt|xml|yml|yaml|sql|toml|rs|go)/g) ?? [];
  return matches.slice(0, 8);
}

function classifyMessage(summary: StructuredConversationSummary, message: CompressibleMessage): void {
  const compact = message.content.replace(/\s+/g, " ").trim();
  if (!compact) return;
  const preview = compact.length > 300 ? `${compact.slice(0, 300).trimEnd()}...` : compact;
  const lower = compact.toLowerCase();

  if (message.role === "user" && (lower.includes("implement") || lower.includes("add ") || lower.includes("fix ") || lower.includes("go ahead"))) {
    uniquePush(summary.goals, preview, 8);
  }
  if (lower.includes("decided") || lower.includes("decision") || lower.includes("defer") || lower.includes("best practice")) {
    uniquePush(summary.decisions, preview, 8);
  }
  if (lower.includes("must ") || lower.includes("cannot ") || lower.includes("do not ") || lower.includes("constraint") || lower.includes("requirement")) {
    uniquePush(summary.constraints, preview, 8);
  }
  if (compact.includes("?")) {
    uniquePush(summary.openQuestions, preview, 8);
  }
  if (lower.includes("next") || lower.includes("todo") || lower.includes("follow up") || lower.includes("remaining")) {
    uniquePush(summary.nextActions, preview, 8);
  }
  for (const file of extractFiles(compact)) {
    uniquePush(summary.filesTouched, file, 12);
  }
  for (const code of extractInlineCode(compact)) {
    if (/^(npm|npx|git|pnpm|yarn|cargo|mvn|gradle|python|node|rg|vitest|tsc)\b/.test(code)) {
      uniquePush(summary.commandsRun, code, 12);
    }
  }
  uniquePush(summary.recentContextNotes, `${roleLabel(message.role)}: ${preview}`, 12);
}

export function buildStructuredSummary(
  messages: CompressibleMessage[],
  seed?: StructuredConversationSummary,
): StructuredConversationSummary {
  const summary: StructuredConversationSummary = seed
    ? {
        goals: [...seed.goals],
        decisions: [...seed.decisions],
        constraints: [...seed.constraints],
        filesTouched: [...seed.filesTouched],
        commandsRun: [...seed.commandsRun],
        openQuestions: [...seed.openQuestions],
        nextActions: [...seed.nextActions],
        recentContextNotes: [...seed.recentContextNotes],
      }
    : {
        goals: [],
        decisions: [],
        constraints: [],
        filesTouched: [],
        commandsRun: [],
        openQuestions: [],
        nextActions: [],
        recentContextNotes: [],
      };
  for (const message of messages) {
    classifyMessage(summary, message);
  }
  if (summary.goals.length === 0) {
    const firstUser = messages.find((message) => message.role === "user");
    if (firstUser) uniquePush(summary.goals, firstUser.content, 1);
  }
  return summary;
}

function renderSection(title: string, items: string[]): string[] {
  return [`## ${title}`, ...(items.length > 0 ? items.map((item) => `- ${item}`) : ["- None captured"])];
}

export function renderStructuredSummary(summary: StructuredConversationSummary): string {
  return [
    "Rolling conversation summary for context only. Use this to preserve older decisions, facts, and unresolved tasks without replaying every prior turn.",
    "",
    ...renderSection("Goals", summary.goals),
    "",
    ...renderSection("Decisions", summary.decisions),
    "",
    ...renderSection("Constraints", summary.constraints),
    "",
    ...renderSection("Files touched", summary.filesTouched),
    "",
    ...renderSection("Commands run", summary.commandsRun),
    "",
    ...renderSection("Open questions", summary.openQuestions),
    "",
    ...renderSection("Next actions", summary.nextActions),
    "",
    ...renderSection("Recent context notes", summary.recentContextNotes),
  ].join("\n");
}

function selectRetainedTail(messages: CompressibleMessage[], tokenBudget: number): CompressibleMessage[] {
  const retained: CompressibleMessage[] = [];
  let tokens = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const nextTokens = estimateMessageTokens(message);
    if (retained.length >= 4 && tokens + nextTokens > tokenBudget) break;
    retained.unshift(message);
    tokens += nextTokens;
  }
  return retained;
}

export function applyRollingContextCompression(
  db: Database.Database,
  conversationId: string,
  messages: CompressibleMessage[],
  model: string | null,
): RollingCompressionResult {
  if (messages.length <= 6) return { messages, summary: null };

  const estimatedTokensBefore = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const contextWindow = resolveContextWindow(db, model) ?? DEFAULT_CONTEXT_WINDOW;
  const targetBudget = Math.min(DEFAULT_SUMMARY_THRESHOLD, Math.max(4_000, Math.floor(contextWindow * 0.55)));
  if (estimatedTokensBefore <= targetBudget) {
    return { messages, summary: null };
  }

  const retainedBudget = Math.max(1_500, Math.floor(targetBudget * 0.55));
  const retained = selectRetainedTail(messages, retainedBudget);
  const compressed = messages.slice(0, messages.length - retained.length);
  if (compressed.length === 0) return { messages, summary: null };

  const existingRow = db
    .prepare(`SELECT summary_json, source_message_count FROM conversation_summaries WHERE conversation_id = ?`)
    .get(conversationId) as { summary_json: string; source_message_count: number } | undefined;
  const existingSummary = existingRow
    ? parseJson<StructuredConversationSummary | null>(existingRow.summary_json, null)
    : null;
  const existingCount = existingRow?.source_message_count ?? 0;

  const now = Date.now();
  const summaryId = randomUUID();
  let structuredSummary: StructuredConversationSummary;
  if (existingSummary && existingCount >= compressed.length) {
    // A prior summary (possibly hand-edited via "Compress now") already covers this span — keep it untouched
    // rather than silently regenerating and discarding manual edits on every message send.
    structuredSummary = existingSummary;
  } else if (existingSummary && existingCount > 0) {
    // Fold only the newly aged-out messages into the existing summary so earlier (possibly manual) content survives.
    structuredSummary = buildStructuredSummary(compressed.slice(existingCount), existingSummary);
  } else {
    structuredSummary = buildStructuredSummary(compressed);
  }
  if (structuredSummary.recentContextNotes.length === 0) {
    structuredSummary.recentContextNotes.push(summarizeMessages(compressed, Math.max(2_000, Math.floor(targetBudget * 1.2))));
  }
  const summaryText = renderStructuredSummary(structuredSummary);
  const summaryJson = JSON.stringify(structuredSummary);

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
    summaryId,
    conversationId,
    summaryText,
    summaryJson,
    compressed.length,
    retained.length,
    estimatedTokensBefore,
    targetBudget,
    "rolling-deterministic-summary-plus-recent-turns",
    now,
    now,
  );

  const summaryMessage: CompressibleMessage = {
    role: "user",
    content: `[Rolling conversation summary]\n${summaryText}`,
    timestamp: compressed[0]?.timestamp ?? now,
  };

  return {
    messages: [summaryMessage, ...retained],
    summary: {
      id: summaryId,
      compressedMessageCount: compressed.length,
      retainedMessageCount: retained.length,
      estimatedTokensBefore,
      targetBudget,
      structuredSummary,
    },
  };
}
