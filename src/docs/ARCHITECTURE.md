# Architecture — Nexy

## Overview

Nexy is a cross-platform desktop application built with Electron, React 19, and TypeScript. It follows Electron's standard multi-process model with a hard security boundary between the renderer (UI) and the main process (system access, network, database).

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderer process  (sandboxed, no Node access)                  │
│  React 19 + Zustand + Tailwind                                  │
│                         │                                       │
│             window.api  │  (contextBridge)                      │
└─────────────────────────┼───────────────────────────────────────┘
                          │  IPC (ipcRenderer ↔ ipcMain)
┌─────────────────────────┼───────────────────────────────────────┐
│  Preload script  (limited bridge, CJS)                          │
│  Exposes typed window.api surface only                          │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│  Main process  (full Node / Electron access)                    │
│                                                                 │
│  IPC handlers ──► Auth ──► BYOK providers / CLI backends        │
│               ──► Providers (native and OpenAI-compatible APIs) │
│               ──► CLI adapters (Claude / Codex / Hermes)        │
│               ──► Orchestrator (multi-agent delegation)         │
│               ──► Agents / Knowledge / Tools                    │
│               ──► MCP servers (stdio child processes)           │
│               ──► File handlers / Context injection             │
│               ──► Database (better-sqlite3)                     │
│               ──► Auto-updater (electron-updater)               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Process Architecture

### Main process (`src/main/`)

The entry point is `src/main/index.ts`. On startup it:
1. Enforces a single-instance lock and registers the app deep-link protocol.
2. Creates the frameless `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
3. Applies a Content Security Policy (relaxed in dev for Vite HMR).
4. Opens the SQLite database (`getDatabase()`), runs schema init and versioned migrations.
5. Registers all IPC handlers via `registerIpcHandlers()`.
6. Initialises MCP server connections and the auto-updater.

### Preload script (`src/preload/index.ts`)

A minimal CJS bridge. Uses `contextBridge.exposeInMainWorld` to attach `window.api` to the renderer. Every method is a thin `ipcRenderer.invoke` or `ipcRenderer.on` wrapper. This is the **only** path through which the renderer can reach the main process.

### Renderer (`src/renderer/`)

A standard Vite + React 19 SPA loaded by the `BrowserWindow`. It has no direct Node or Electron access — all side effects go through `window.api`.

### CLI skill-management bridge

Provider chats and CLI chats share the skill-capture implementation in
`src/main/skill-service.ts`. The service owns SKILL.md parsing, validation, provenance tags,
and case-insensitive upsert behavior. UI approval remains outside the service so every caller
must explicitly complete the same approval handoff before persistence.

When the current user message clearly asks to save, import, keep, or create a reusable skill,
the CLI dispatch path starts a short-lived loopback MCP bridge from
`src/main/skill-save-mcp-bridge.ts`. The bridge:

- binds only to `127.0.0.1` on an ephemeral port;
- authenticates every request with a per-run random secret;
- exposes only `save_skill` through a stdio worker;
- forwards the request to Nexy's approval UI before calling the shared service;
- ignores CLI full-auto mode for this library write; and
- closes in the CLI dispatch `finally` block.

The worker has no database or filesystem persistence access. Existing configured MCP servers
remain governed by their normal trust policy; the Nexy skill bridge is injected only for the
explicit skill-capture turn and is never stored as a user-configured MCP server.

---

## Source Layout

```
src/
├── main/
│   ├── index.ts                  # Entry: window, lifecycle, init
│   ├── ipc-handlers.ts           # Aggregator — registers all handler modules
│   ├── database.ts               # SQLite singleton, schema init
│   ├── database-migrations.ts    # Versioned migration runner (PRAGMA user_version)
│   ├── auth.ts                   # BYOK auth mode persistence
│   ├── http-client.ts            # Shared HTTPS helpers: httpsPost, httpsGet, parseSseStream
│   ├── providers.ts              # Multi-provider streaming and capability routing
│   ├── orchestrator.ts           # Multi-agent delegation (leader + team via delegate_to_agent tool)
│   ├── chat-handlers.ts          # Chat IPC: send message, regenerate, edit, stop
│   ├── conversation-handlers.ts  # Conversation + message CRUD
│   ├── agents.ts                 # Agent CRUD + config persistence
│   ├── knowledge.ts              # Agent knowledge file management
│   ├── tools.ts                  # Built-in tool IPC (file-edit, terminal, web-fetch)
│   ├── mcp.ts                    # MCP server lifecycle + tool discovery
│   ├── file-handlers.ts          # File/directory read + context injection
│   ├── project-handlers.ts       # Project CRUD + per-project agent config
│   ├── settings-handlers.ts      # App settings (theme, hotkey, zoom, provider keys…)
│   ├── system-handlers.ts        # Window controls, deep-link, CLI detection
│   ├── updater.ts                # electron-updater integration
│   ├── safe-handle.ts            # ipcMain.handle wrapper with error catching
│   └── cli-detection.ts          # Detects installed CLI tools (gh, git…)
│
├── preload/
│   └── index.ts                  # contextBridge — exposes window.api
│
├── renderer/
│   ├── App.tsx                   # Root layout, lazy panels, global IPC event listeners
│   ├── main.tsx                  # React DOM root
│   ├── slash-commands.ts         # Slash command registry
│   │
│   ├── components/
│   │   ├── ChatWindow.tsx         # Chat view orchestrator (thin, ~386 lines)
│   │   ├── Sidebar.tsx            # Left nav: conversations, projects, agents
│   │   ├── TitleBar.tsx           # Custom title bar, agent badge, dir breadcrumb
│   │   ├── AgentPanel.tsx         # Agent builder/editor panel
│   │   ├── ProjectPanel.tsx       # Project view, assignment, config
│   │   ├── ProjectSettingsPanel.tsx
│   │   ├── SettingsPanel.tsx      # App settings UI
│   │   ├── McpServerPanel.tsx     # MCP server config + tool list
│   │   ├── MessageBubble.tsx      # Single chat message renderer
│   │   ├── MarkdownRenderer.tsx   # react-markdown + rehype-highlight
│   │   ├── ToolApproval.tsx       # Approval modal for tool calls
│   │   ├── ContextInspector.tsx   # Active context block inspector
│   │   ├── SearchBar.tsx          # Conversation search
│   │   ├── SectionPane.tsx        # Resizable right-side section container
│   │   ├── ResizeHandle.tsx       # Drag-to-resize handle
│   │   ├── Toast.tsx              # Toast notifications
│   │   ├── OnboardingModal.tsx    # First-run auth/setup flow
│   │   ├── DirectoryPicker.tsx    # Working directory picker
│   │   ├── TeamActivityBlock.tsx  # Multi-agent activity feed
│   │   ├── DeleteAgentDialog.tsx
│   │   ├── DeleteConversationDialog.tsx
│   │   ├── DeleteProjectDialog.tsx
│   │   └── CreateProjectPanel.tsx
│   │
│   ├── components/chat/           # ChatWindow sub-components
│   │   ├── ChatMessages.tsx       # Message list + streaming indicator
│   │   ├── ChatComposer.tsx       # Input textarea + send controls
│   │   ├── AttachmentBar.tsx      # Attached files / image strip
│   │   ├── SlashCommandMenu.tsx   # Slash command dropdown
│   │   └── AtContextMenu.tsx      # @-context reference dropdown
│   │
│   ├── hooks/                     # Custom React hooks (extracted from ChatWindow)
│   │   ├── chat-types.ts          # Shared types for chat hooks
│   │   ├── useChat.ts             # Messages, streaming state, send/regenerate/edit
│   │   ├── useFileInput.ts        # Paste/drag-drop, attachment + image state
│   │   ├── useSlashMenu.ts        # Slash command menu open/close/filter state
│   │   ├── useAtMenu.ts           # @-context menu + resolveContextBlock
│   │   ├── useTimers.ts           # generationElapsedSec, rateLimitRemainingSec
│   │   └── useChatWindowActions.ts # High-level orchestration hook
│   │
│   └── store/
│       ├── app-store.ts           # Zustand store root + hydrate action
│       ├── types.ts               # Store state type
│       └── slices/
│           ├── authSlice.ts       # Setup/auth state, BYOK mode, CLI readiness
│           ├── conversationSlice.ts # Active conversation, messages, streaming
│           ├── projectSlice.ts    # Projects list, active project
│           ├── agentSlice.ts      # Agents list, active agent, agent panel state
│           └── uiSlice.ts         # Theme, sidebar visibility, toasts, panels
│
├── shared/
│   ├── types.ts                   # Cross-boundary types: Message, Conversation, AgentConfig,
│   │                              #   ProjectConfig, DEFAULT_PROJECT_CONFIG, IpcChannels,
│   │                              #   ProviderMessage discriminated union, ToolConfig…
│   ├── models.ts                  # Provider model display helpers
│   ├── utils.ts                   # Shared utilities
│
└── test/                          # Vitest test helpers, renderer mocks
```

---

## Data Flow: Chat Message

```
User types + sends
       │
  ChatComposer (renderer)
       │  window.api.sendChatMessage(...)
       ▼
  ipcRenderer.invoke('chat:send', payload)
       │
  chat-handlers.ts (main)
       │── loads conversation history from SQLite
       │── resolves agent config + context files
       │── creates ChatTurnEmitter for this turn
       │── calls the selected BYOK provider, CLI adapter, or orchestrator
       │
  ChatTurnEmitter (main)
       │── emits ordered, sequenced ChatTurnEvents (chat:turn-event)
       │── simultaneously emits legacy compatibility events (chat:stream-chunk,
       │   chat:thinking-delta, chat:activity, etc.)
       │── routes to both Electron IPC (desktop renderer) and WebSocket (Android)
       │
  Desktop renderer (useChatLiveTurn + useChatTurnReducer)
       │── chatTurnReducer applies events in order → live ChatTurnState
       │── ChatRenderItem adapter builds ordered list for ChatMessages
       ▼
  ChatMessages.tsx renders live + historical items from ordered render list
```

---

## Chat Event Lifecycle

All chat turns flow through a normalized event sequence emitted by `ChatTurnEmitter` (`src/main/chat-turn-emitter.ts`). Events are monotonically sequenced per turn and carry a `turnId` so late events from previous turns can be discarded.

### Event types (`src/shared/chat-turn-types.ts`)

| Event | When emitted |
|---|---|
| `turn_started` | Immediately when `dispatchChatSend` begins |
| `user_message_committed` | After the user message is persisted to DB |
| `activity_changed` | Each time the activity label changes (thinking, tool, preparing) |
| `thinking_delta` | Each reasoning/thinking block chunk |
| `thinking_done` | When a thinking block is complete |
| `tool_started` | CLI: when a tool call begins |
| `tool_finished` | When a tool call completes (MCP or CLI) |
| `cost_updated` | When token cost is reported by the provider |
| `model_changed` | When the actual model id is known from the stream |
| `assistant_text_delta` | Each text chunk from the assistant |
| `turn_completed` | On `stream_end` (normal completion) |
| `turn_failed` | On provider error |
| `history_snapshot_received` | After history is reloaded from DB |

### Desktop lifecycle

```
ChatTurnEmitter.started()
       ↓
  [activity_changed × N] (thinking → tool → thinking → ...)
  [thinking_delta × N]
  [thinking_done × N]
  [tool_started / tool_finished × N]
  [assistant_text_delta × N]
       ↓
ChatTurnEmitter.streamEnd()   → turn_completed
                              → legacy: chat:stream-end, chat:activity(complete)
       ↓
persistAssistantMessage()     → DB insert with thinking_blocks
broadcastConversationMessages() → WebSocket push to Android
```

Desktop reducer (`chatTurnReducer`) handles `chat:turn-event` exclusively. Legacy events (`chat:stream-chunk`, `chat:activity`, etc.) are still emitted for backwards compatibility but the reducer ignores them.

### Android lifecycle

Android `ChatViewModel` subscribes to all WsEvents. The normalized `ChatTurnEvent` path feeds `reduceChatTurn` to update `_liveTurnState`. The `chat:stream-chunk` / `chat:stream-end` events additionally control the typewriter drain coroutine in `ChatViewModel` — this is a rendering concern separate from the reducer.

**Re-entry restoration**: when a user navigates away while a turn is active and returns, `ConversationMessages` arrives without an assistant response. `ChatViewModel` restores the in-progress state from `WsRepository.activeChatSnapshots` (activity label, thinking blocks, completed tool calls) so the UI shows the correct awaiting state.

**Active history polling**: after `sendMessage()` starts a turn, a 2.5-second poll fires if no stream events arrive. This guards against dropped WebSocket messages during reconnects.

---

## State Management

The renderer uses a single **Zustand** store (`useAppStore`) composed from five domain slices with **Immer** for immutable updates:

| Slice | Responsibility |
|---|---|
| `authSlice` | Setup/auth mode, provider key readiness, CLI readiness |
| `conversationSlice` | Active conversation, message list, streaming state, model selection |
| `projectSlice` | Projects list, active project |
| `agentSlice` | Agents list, active agent, agent panel open/closed |
| `uiSlice` | Theme, sidebar visibility, toasts, modal flags, section panes |

The `hydrate` action in `app-store.ts` loads all persistent state from the main process on startup via a single `window.api.hydrate()` call.

---

## Database

**Engine:** `better-sqlite3` (synchronous, single-file SQLite)  
**Location:** `{userData}/data/nexy.db`  
**Settings:** `WAL` journal mode, `foreign_keys = ON`

### Schema

| Table | Purpose |
|---|---|
| `settings` | Key-value app settings (theme, hotkey, zoom, provider keys) |
| `projects` | Projects with color, config JSON |
| `conversations` | Conversations with optional agent, model, project, pinned flag |
| `messages` | Chat messages with role, content, attachments, edit history, context snapshot |
| `agents` | Agent configs (name, icon, system prompt, model, tools, etc.) |
| `knowledge_files` | Agent knowledge files with injection mode |
| `mcp_servers` | MCP server configs (command, args, env, enabled) |
| `tool_overrides` | Per-agent tool enable/approval overrides |

### Migrations

Schema changes are applied via a **versioned migration runner** in `database-migrations.ts`. The current schema version is tracked with SQLite's `PRAGMA user_version`. Each migration runs exactly once, in order, and is idempotent. The current version is the last entry in `MIGRATIONS`; it is intentionally not duplicated here because migrations are append-only.

---

## IPC Channel Model

All renderer ↔ main communication uses typed request-response or push channels. Main-process request handlers are registered through `safeHandle`, which validates the sender and converts failures to structured error results; new handlers must not call `ipcMain.handle` directly.

The full channel surface is typed in `src/shared/types.ts` as the `IpcChannels` union. Handler registration is split into domain modules and aggregated in `ipc-handlers.ts`.

---

## Authentication And Backend Setup

Nexy supports BYOK API providers and local CLI backends. Provider API keys are stored with Electron `safeStorage` where available. CLI backends authenticate through their own tools, such as Claude CLI or Codex CLI, and Nexy detects their availability before routing chats to them.

BYOK tool loops derive their input budget from the model catalog or a model fallback, with output
capacity and estimation headroom reserved. Estimates include reasoning, tool schemas, arguments,
and images. When needed, trimming drops complete exchanges while retaining system instructions
and the current task. Reaching the iteration limit switches to an explicit answer-only instruction;
DeepSeek terminal requests retain schemas with `tool_choice: none` and thinking disabled.

Global chat Max tokens supports Automatic (`max_tokens: "auto"`, also the missing-setting default)
and Manual (saved positive numbers). `output-budget.ts` resolves provider-qualified output and
context limits after thinking-mode selection. DeepSeek Automatic reserves 8K tokens without
thinking, 64K with thinking, or 128K at maximum effort. Unknown models retain conservative defaults.
One `OutputBudgetRecovery` instance owns each chat turn: only a typed `length` failure before any
answer text can increase Automatic's budget, once, up to twice the initial reserve and within
model/context limits. Ordinary rounds and both finalisation transports share that allowance.
Recovery compacts whole exchanges, rechecks cancellation, keeps completed tool results, and
discards the failed response's reasoning and tool batch. Manual limits never increase. Notices
use the existing chat activity/text channels; diagnostics contain budgets and counts, not content.

DeepSeek assistant rows keep per-turn provider messages in `messages.provider_history`, separately
from display text. Retained turns restore exact reasoning and matched assistant/tool exchanges after
rolling compression. Edited rows and legacy rows use their display text. Other providers do not
receive this DeepSeek history. HTTP response and SSE parsers retain UTF-8 decoder state across
network chunks.

---

## Provider Abstraction

`src/main/providers.ts` implements a uniform streaming interface over configured API providers:

| Provider | Endpoint |
|---|---|
| `openai` | OpenAI API |
| `anthropic` | Anthropic Messages API |
| `azure` | Azure OpenAI deployment API |
| `gemini` | Gemini API / configured compatibility route |
| `mistral`, `groq`, `xai`, `openrouter` | Provider-specific OpenAI-compatible APIs |

The authoritative provider configuration and fallback-model ownership live in `src/main/provider-registry.ts`; the model-catalog guide explains the live-cache and fallback order. CLI backends (Claude, Codex, and Hermes) are implemented in `src/main/cli-adapters/`. Active streaming requests are tracked so per-conversation abort works across provider paths.

---

## Multi-Agent Orchestration

When a project has `orchestrationEnabled`, the **orchestrator** (`src/main/orchestrator.ts`) takes over the chat flow:

1. A **leader agent** receives the user message along with a `delegate_to_agent` tool definition.
2. The leader may call `delegate_to_agent` with a `agent_id` and `task` to forward sub-tasks to team specialist agents.
3. Each delegation is capped by `MAX_DELEGATION_DEPTH` (default 5) to prevent infinite loops.
4. Activity steps are streamed back to the renderer as `team-activity` messages shown in `TeamActivityBlock.tsx`.

---

## MCP Integration

Model Context Protocol servers are managed in `src/main/mcp.ts`:

- Server configs are persisted in the `mcp_servers` table.
- On startup, enabled servers are launched as `stdio` child processes via `@modelcontextprotocol/sdk`.
- The tool catalogue is discovered from each connected server and made available to the agent tool-call pipeline.
- Server lifecycle (connect, disconnect, reconnect) is managed at runtime via IPC handlers.

---

## Built-in Tools

The following built-in tools are available to agents (subject to per-agent config and user approval):

| Tool | Handler | Description |
|---|---|---|
| `file_edit` | `tools.ts` | Read, write, create, and diff files in the working directory |
| `web_fetch` | `tools.ts` | Fetch a URL and return its content |

Each tool has an approval mode: `auto` (no prompt), `always-ask` (modal per call), or `disabled`. The `ToolApproval.tsx` component handles the approval dialog.

---

## Managed-Artifact Automated Workflows

Automated workflows support a managed deliverable path in addition to legacy text-only model
steps. The four managed step kinds are `collect`, `model`, `review`, and `publish`:

```text
declared project files -> immutable source version -> model artifact version
                       -> human review/version -> checked publish preview -> atomic file write
```

`automated-workflow-executor.ts` owns step transitions, while
`automated-workflow-managed.ts` owns source confinement, version bindings, review records,
staleness, diffs, and publication. Managed content is stored through the existing tables and
services in `artifacts.ts`; workflow tables store lineage and decisions rather than a second copy
of the document model.

Every input binding names an exact `artifact_versions.id`. Editing creates a new immutable version
and transitively marks dependent bindings stale. Content approval is separate from publish-action
approval. Publication requires an unexpired preview of the approved version and unchanged
destination checksum, confines relative paths to an authoritative project source, rejects link
escapes, and uses a temporary file plus atomic replacement. Legacy untyped workflow steps retain
their existing prompt-weaving behavior.

Desktop IPC and the authenticated mobile WebSocket expose the same managed operations. Desktop
remains authoritative for SQLite, artifacts, project files, model execution, and scheduling;
paired Android is an authoring/review/control client, not a second executor.

---

## Build & Toolchain

| Tool | Role |
|---|---|
| `electron-vite` | Unified dev server + build for main, preload, renderer |
| `Vite` (renderer) | React SPA bundling, HMR in dev |
| `TypeScript` | All source — `strict` mode, project references per process |
| `tsconfig.typecheck.json` | Non-composite typecheck config (avoids TS6305 project-ref noise) |
| `Tailwind CSS` | Utility-first styling in renderer |
| `electron-builder` | Cross-platform distributable packaging |
| `Vitest` | Test runner across main, renderer, and shared logic |
| `eslint` + `typescript-eslint` | Linting |
| `electron-builder install-app-deps` | Installs/rebuilds native modules for Electron packaging |

### Native module note

`better-sqlite3` and `node-pty` are native dependencies. `postinstall` runs `electron-builder install-app-deps` after `npm install` so packaging uses Electron-compatible native binaries. The builder is configured with `nativeRebuilder: legacy` because `node-pty` ships Windows prebuilds and the default `@electron/rebuild` path can fall back to a slow or failing node-gyp rebuild on Python 3.12+ systems. If native module errors appear at runtime after manual `npm rebuild` or agent-triggered builds, re-run:

```bash
npm run postinstall
```

---

## Testing

Tests live alongside their modules in `__tests__/` subdirectories:

```
src/main/__tests__/           # Main-process unit tests
src/renderer/__tests__/       # Renderer component + hook tests
src/renderer/__tests__/hooks/ # Chat hook tests
```

The test environment for renderer tests uses `happy-dom`. Main-process tests mock Electron and `better-sqlite3` as needed. Run the full suite with:

```bash
npm test
```

---

## Security Model

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload script is the only allowed bridge; it exposes only explicitly listed methods.
- A restrictive CSP is applied via `webRequest.onHeadersReceived`; external `connect-src` is limited to the known API endpoints.
- Provider API keys are stored via Electron `safeStorage` where available (OS keychain encryption on Windows/macOS).
- External URLs opened from the app are delegated to the OS browser via `shell.openExternal`; `setWindowOpenHandler` returns `{ action: 'deny' }` for all in-app navigation.
