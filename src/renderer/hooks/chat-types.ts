export type ToastType = 'info' | 'success' | 'error'

export type ActivityEvent =
  | { type: 'thinking' }
  | { type: 'tool'; name: string; server: string }

export interface ToolCallEvent {
  toolName: string
  serverName: string
  args: Record<string, unknown>
  result: string
  success: boolean
  resultImages?: { dataUrl: string }[]
  conversationId: string | null
}

export interface Attachment {
  id: string
  name: string
  path?: string
  size: number
  type?: 'file' | 'image' | 'folder'
  source?: 'desktop' | 'mobile' | 'pasted'
  thumbnailDataUrl?: string
  previewDataUrl?: string
}

export interface LocalAttachment extends Attachment {
  path: string
}

export interface PastedImage {
  id: string
  dataUrl: string
  name: string
  label?: string
  mode?: 'vision' | 'text'
  ocrText?: string
  ocrPending?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'team-activity' | 'tool-call'
  content: string
  timestamp: number
  model?: string | null
  attachments?: Attachment[]
  images?: PastedImage[]
  isEdited?: boolean
  isError?: boolean
  errorType?: string
  retryable?: boolean
  isStopped?: boolean
  contextSnapshot?: string
  toolCallId?: string
  toolName?: string
  serverName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  toolSuccess?: boolean
  toolInProgress?: boolean
  toolResultImages?: { dataUrl: string }[]
  thinkingBlocks?: Map<string, { blockId: string; content: string; done: boolean; firstSeenAt?: number }>
  // Ordered response-text bursts when the reply was interrupted by tool calls (e.g.
  // "I'll check X." -> tool call -> "Here's the answer.") — used to interleave the
  // narration with the tool calls it surrounded instead of showing it all at once.
  // `content` remains the full concatenated text regardless. Undefined/empty when the
  // reply text was never interrupted (the common case).
  textSegments?: Map<string, { blockId: string; content: string; done: boolean; firstSeenAt?: number }>
  userInputs?: import('../../shared/chat-turn-types').ResolvedUserInput[]
  citations?: import('../../shared/citations').Citation[]
  // True for a text segment optimistically promoted into `messages` mid-turn (as soon as
  // it closes) so it interleaves with tool-call messages in true chronological order
  // instead of staying stuck in the live-only render area until the whole turn settles.
  // The turn isn't done yet when this is true — MessageBubble must not show the
  // model/timestamp/action chrome that implies a finished, final answer.
  isFrozenMidTurn?: boolean
}

export interface CliCostSummary {
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
  quality?: 'provider' | 'tokenizer' | 'estimate'
  source?: string
  requestCount?: number
  complete?: boolean
  cachedInputTokens?: number
  reasoningTokens?: number
}

export interface ContextRef {
  key: 'workspace' | 'git' | 'git-diff' | 'file' | 'clipboard' | 'wiki' | 'prompt-instruction'
  token: string
  value?: string
}

export interface AtContextOption {
  token: '@workspace' | '@git' | '@git:diff' | '@file:' | '@wiki'
  key: ContextRef['key']
  description: string
}

export interface StreamError {
  type: string
  message: string
  retryable: boolean
  retryAfterSeconds?: number
}

export interface ContextSnapshot {
  systemPrompt: string
  contextRefs: { token: string; key: string }[]
  attachments: { name: string; size: number }[]
  historyLength: number
  estimatedTokens: number
  model: string
  timestamp: number
  /** Filled in server-side after the send actually resolves — the fields above are only the client's guess. */
  serverModel?: string | null
  serverCompression?: { compressedMessageCount: number; retainedMessageCount: number } | null
  /** Provider-reported token counts (Claude CLI, Codex CLI, OpenAI-compatible APIs incl. OpenRouter).
   *  Unset for backends that don't expose usage (e.g. Hermes CLI in its current single-shot mode) —
   *  the estimate above is the only number available for those. */
  serverInputTokens?: number
  serverOutputTokens?: number
  nextRequest?: import('../../shared/token-usage').TokenCount
  turnTotal?: import('../../shared/token-usage').TurnUsageTotal
}

export interface TeamActivityStep {
  stepId: string
  agentId: string
  agentName: string
  agentIcon: string
  task: string
  status: 'delegating' | 'done' | 'error'
  result?: string
  liveContent?: string
  durationMs?: number
}

export interface ConversationDbMessage {
  id: string
  role: string
  content: string
  timestamp: number
  model?: string | null
  is_edited?: number
  attachments?: string
  context_snapshot?: string | null
}

export const AT_CONTEXT_OPTIONS: AtContextOption[] = [
  {
    token: '@workspace',
    key: 'workspace',
    description: 'Attach workspace summary',
  },
  {
    token: '@git',
    key: 'git',
    description: 'Attach git branch, status, recent commits',
  },
  {
    token: '@git:diff',
    key: 'git-diff',
    description: 'Attach diff summary of changes since last commit',
  },
  {
    token: '@file:',
    key: 'file',
    description: 'Attach file by path (example: @file:src/main.ts)',
  },
  {
    token: '@wiki',
    key: 'wiki',
    description: 'Attach project wiki entries',
  },
]


/**
 * The subset of a keyboard event the composer key handler actually needs.
 * Both a React textarea event and ProseMirror's native DOM event satisfy this,
 * so the raw and rendered composers share one handler without casting.
 */
export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  defaultPrevented: boolean
  preventDefault: () => void
}
