import type Database from "better-sqlite3";
import type {
  ConversationExportAgent,
  ConversationExportAttachment,
  ConversationExportContextRef,
  ConversationExportMessage,
  ConversationExportPack,
  ConversationExportPackOptions,
  ConversationExportProject,
  ConversationExportToolCall,
  ConversationExportV1,
  ConversationRow,
} from "../shared/types";
import { arrayFromJson, MessageExportRow, parseJson } from "./conversation-types";
import { buildContextBundle, buildMarkdownTranscript, slugFileName } from "./conversation-formatters";
import { isLegacyPortableOperationalSummary } from "../shared/conversation-portability";

function extractContextRefs(snapshot: unknown): ConversationExportContextRef[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const refs = (snapshot as { contextRefs?: unknown }).contextRefs;
  return Array.isArray(refs) ? (refs as ConversationExportContextRef[]) : [];
}

function summarizeToolCall(content: string): ConversationExportToolCall | null {
  const parsed = parseJson<Record<string, unknown> | null>(content, null);
  if (!parsed) {
    return { summary: content.slice(0, 500) };
  }

  const name = typeof parsed.name === "string"
    ? parsed.name
    : typeof parsed.toolName === "string"
      ? parsed.toolName
      : typeof parsed.tool === "string"
        ? parsed.tool
        : undefined;
  const server = typeof parsed.server === "string"
    ? parsed.server
    : typeof parsed.serverName === "string"
      ? parsed.serverName
      : undefined;
  const result = parsed.result ?? parsed.content ?? parsed.error;
  const resultText = typeof result === "string" ? result : result == null ? "" : JSON.stringify(result);

  return {
    ...parsed,
    id: typeof parsed.id === "string" ? parsed.id : undefined,
    name,
    server,
    args: parsed.args ?? parsed.input,
    result,
    success: typeof parsed.success === "boolean" ? parsed.success : undefined,
    summary: [server, name].filter(Boolean).join("/") || resultText.slice(0, 120) || "tool call",
  };
}

function getProjectExport(db: Database.Database, projectId: string | null): ConversationExportProject | null {
  if (!projectId) return null;
  const row = db
    .prepare("SELECT id, name, color, default_model, project_hermes_profile, created_at, updated_at FROM projects WHERE id = ?")
    .get(projectId) as ConversationExportProject | undefined;
  return row ?? null;
}

function getAgentExport(db: Database.Database, agentId: string | null): ConversationExportAgent | null {
  if (!agentId) return null;
  const row = db
    .prepare("SELECT id, config_json, is_default, created_at, updated_at FROM agents WHERE id = ?")
    .get(agentId) as { id: string; config_json: string; is_default: number; created_at: number; updated_at: number } | undefined;
  if (!row) return null;

  const config = parseJson<Record<string, unknown>>(row.config_json, {});
  return {
    id: row.id,
    name: typeof config.name === "string" ? config.name : null,
    icon: typeof config.icon === "string" ? config.icon : null,
    backend: typeof config.backend === "string" ? config.backend : null,
    cli_model: typeof config.cliModel === "string" ? config.cliModel : null,
    is_default: row.is_default === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapExportMessage(row: MessageExportRow): ConversationExportMessage {
  const contextSnapshot = parseJson<unknown>(row.context_snapshot, null);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    model: row.model,
    timestamp: row.timestamp,
    is_edited: row.is_edited === 1,
    previous_content: row.previous_content,
    attachments: arrayFromJson<ConversationExportAttachment>(row.attachments),
    context_refs: extractContextRefs(contextSnapshot),
    context_snapshot: contextSnapshot,
    tool_call: row.role === "tool-call" ? summarizeToolCall(row.content) : null,
    ...(arrayFromJson(row.citations).length > 0 ? { citations: arrayFromJson(row.citations) } : {}),
  };
}

export function buildConversationExport(db: Database.Database, conversationId: string): ConversationExportV1 {
  const conversation = db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(conversationId) as ConversationRow | undefined;
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const messages = db
    .prepare(
      `SELECT id, conversation_id, role, content, model, is_edited, previous_content,
              timestamp, attachments, context_snapshot, citations
       FROM messages
       WHERE conversation_id = ?
       ORDER BY timeline_order ASC, timestamp ASC, id ASC`,
    )
    .all(conversationId) as MessageExportRow[];

  return {
    schema: "nexy.conversation.v1",
    exported_at: Date.now(),
    conversation,
    project: getProjectExport(db, conversation.project_id),
    agent: getAgentExport(db, conversation.agent_id),
    messages: messages
      .filter((message) => !isLegacyPortableOperationalSummary(message.role, message.content))
      .map(mapExportMessage),
  };
}

export function buildConversationExportPack(
  db: Database.Database,
  conversationId: string,
  options: ConversationExportPackOptions,
): ConversationExportPack {
  const exported = buildConversationExport(db, conversationId);
  const format = options.format;
  const baseName = slugFileName(exported.conversation.title || "conversation");

  if (format === "json") {
    return {
      format,
      conversation_id: conversationId,
      file_name: `${baseName}.nexy-conversation.json`,
      mime_type: "application/json",
      content: `${JSON.stringify(exported, null, 2)}\n`,
    };
  }

  if (format === "markdown") {
    return {
      format,
      conversation_id: conversationId,
      file_name: `${baseName}.conversation.md`,
      mime_type: "text/markdown",
      content: buildMarkdownTranscript(exported),
    };
  }

  if (format === "context-bundle") {
    return {
      format,
      conversation_id: conversationId,
      file_name: `${baseName}.context-bundle.md`,
      mime_type: "text/markdown",
      content: buildContextBundle(exported),
    };
  }

  throw new Error("Unsupported conversation export pack format");
}
