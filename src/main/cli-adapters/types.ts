import type { BrowserWindow } from 'electron'
import type { ProviderMessage } from '../providers'
import type { UserInputAnswer, UserInputQuestion } from '../../shared/chat-turn-types'
import type { Citation } from '../../shared/citations'

export interface CliAdapterRequest {
  summaryOnly?: boolean
  continuity?: {
    priorRevision: string
    currentPrompt: string
    currentImages: { id: string; name: string; dataUrl: string }[]
    onSessionReady: (commit: (revision: string) => void) => void
  }
  systemPrompt?: string
  /** Per-invocation custom subagents. Claude CLI receives these through --agents so callers can
   * refresh an app-owned project team without relying on Claude's persistent teammate state. */
  agents?: Record<string, { description: string; prompt: string }>
  messages: ProviderMessage[]
  images?: { id: string; name: string; dataUrl: string }[]
  mcpServers?: {
    id: string
    key: string
    command: string
    args: string[]
    env?: Record<string, string>
    cwd?: string
  }[]
  allowedTools?: string[]
  cwd: string
  model: string
  conversationId: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'max' | 'disabled'
  skipPermissions?: boolean
  // Per-conversation CLI mode override (shared/types CliModeOverride): Claude Code maps
  // 'plan'|'acceptEdits'|'bypassPermissions' to --permission-mode; Codex maps
  // 'read-only'|'workspace-write'|'danger-full-access' to --sandbox. Adapters ignore values
  // from the other backend's family (one conversation column serves both).
  permissionMode?: string
  /** Hermes ACP profile. The process is launched with `--profile <name>` and is never switched in-place. */
  hermesProfile?: string
  // Codex collaboration/execution mode, independent of approval policy and sandbox.
  // 'plan' is sent through the app-server protocol because `codex exec` has no Plan flag.
  executionMode?: 'plan'
  // Directories the CLI's own built-in sandbox should be allowed to touch beyond `cwd` — set
  // when the project/conversation's terminal sandbox bypass is enabled. Not all adapters honor
  // this (currently Claude CLI only, via --add-dir); adapters that don't support it ignore it.
  extraAllowedDirs?: string[]
  // Non-interactive CLI processes cannot display their own permission dialog. Adapters
  // that support a permission callback (currently Claude Code via PermissionRequest
  // hooks) pause the tool call and delegate the exact request to Nexy's approval UI.
  requestPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  /** Claude --print omits its native ExitPlanMode tool. In Plan mode, its Nexy MCP bridge
   * invokes this callback and waits for the same approval handoff used by native clients. */
  requestPlanApproval?: (plan: string) => Promise<boolean>
  /** Pauses a supported CLI protocol request while Nexy's desktop or paired Android UI
   * collects a structured answer. This is deliberately separate from permissions. */
  requestUserInput?: (questions: UserInputQuestion[]) => Promise<UserInputAnswer[]>
  /** Opts this turn into the `nexy_defer` MCP bridge (currently Claude CLI only), letting the
   * agent hand off a long shell command to Nexy's deferred-callback tracking instead of blocking
   * on it — see deferred-callbacks.ts. Off by default so callers that invoke an adapter directly
   * without a real conversation behind it (tests, one-off tool checks) don't pay for a loopback
   * server they have no use for. */
  deferredJobsEnabled?: boolean
}

export type CliStreamEvent =
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; content: string; isError: boolean }
  | { type: 'cost'; totalCostUsd: number; inputTokens: number; outputTokens: number; requestId?: string }
  | { type: 'thinking_chunk'; blockId: string; chunk: string }
  | { type: 'thinking_end'; blockId: string }
  // Marks a response-text burst (see onChunk's blockId) as closed — without this, a
  // renderer watching the live stream can't distinguish "only one text burst so far,
  // still being typed" from "that burst already finished, a tool call interrupted it"
  // and would defer an already-closed lead-in sentence to the very end of the turn.
  | { type: 'text_end'; blockId: string }
  // Native Codex Plan collaboration mode emits a distinct plan item when the model has
  // finished planning. Nexy uses this event as Codex's ExitPlanMode handoff.
  | { type: 'plan_ready'; plan: string }
  // A transient status update (e.g. CLI lifecycle narration) — surfaced as the live
  // "Thinking…" activity line, never persisted into message history. Distinct from
  // thinking_chunk/thinking_end, which accumulate into a reasoning block that sticks
  // around after the turn completes.
  | { type: 'activity'; label: string }
  | { type: 'citations'; citations: Citation[] }

export interface CliAgentAdapter {
  readonly name: string
  send(
    window: BrowserWindow | undefined,
    req: CliAdapterRequest,
    // blockId identifies which contiguous text burst this chunk belongs to (see
    // ChatAssistantTextDeltaEvent) — adapters that segment text around tool calls pass
    // it; adapters that don't (or callers of adapters that don't) omit it, and the
    // whole response is treated as one legacy block.
    onChunk: (chunk: string, blockId?: string) => void,
    onEvent?: (event: CliStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<string>
  isAvailable(): boolean
}
