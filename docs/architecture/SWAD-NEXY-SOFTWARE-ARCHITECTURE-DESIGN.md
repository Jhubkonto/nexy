---
document:
  title: "Nexy Software Architecture Design"
  code: "SWAD-NEXY"
  controlled_document: true
template:
  source: "TEMP_SWAD_Software_Architecture_Design_v01"
  release_date: "2026-04-29"
project:
  number: "NEXY"
  name: "Nexy AI workspace"
release:
  date: "2026-08-19"
  baseline: "1.3.37"
  document_owner: "Nexy maintainers"
  confidentiality: "internal"
versions:
  - version: "1.0"
    change: "Initial architecture design record"
---

# 1. Purpose

This Software Architecture Design (SWAD) records the stable software structure of Nexy: desktop execution, renderer presentation, Android companion behavior, provider and CLI integration, persistence, tools, automation, and security boundaries.

It is deliberately implementation-aware. The architecture is not a replacement for source code or tests; it is the map that lets a maintainer understand responsibilities and interfaces without reconstructing the whole system from imports.

# 2. Scope and assumptions

| Field | Entry |
| --- | --- |
| Product/software item | Nexy desktop application plus Android companion |
| Covered baseline | Nexy `1.3.37`, source reviewed `2026-08-19` |
| Desktop runtime | Electron 33, TypeScript, React 19, Vite, Zustand, SQLite |
| Android runtime | Kotlin, Jetpack Compose, Room, OkHttp/WebSocket, Android Keystore |
| External AI systems | User-selected BYOK API providers and installed CLI backends |
| Hosting assumption | No Nexy-hosted backend required; desktop is the authority for desktop capabilities |
| Related detailed designs | [Core runtime](SWDD-NEXY-CORE-RUNTIME.md), [Android and sync](SWDD-NEXY-ANDROID-COMPANION-AND-SYNC.md), [automation and delivery](SWDD-NEXY-AUTOMATION-ARTIFACTS-AND-GIT.md) |

The architecture assumes a trusted local user controls the desktop and chooses which external providers, CLI programs, MCP servers, project folders, and tools are enabled. It does not assume that model output, external MCP content, project files, or network responses are trustworthy.

# 3. Architecture objectives

1. Keep the renderer unable to access Node, Electron, credentials, SQLite, or arbitrary system APIs directly.
2. Give different AI providers and CLIs one Nexy conversation and streaming model.
3. Make conversations, agents, projects, artifacts, workflows, schedules, and audit records durable.
4. Make tool access explicit, configurable, and approval-aware.
5. Keep desktop capabilities authoritative while allowing Android to work locally and synchronize safely.
6. Make active chat turns resumable, cancelable, observable, and renderable on both clients.
7. Preserve enough versioning, checksums, and audit data to explain and safely publish generated work.

# 4. Architecture overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Desktop UI: Electron renderer                                       │
│ React 19 + Zustand + Tailwind; chat, panels, generators, settings   │
│ No Node/Electron access                                             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ typed window.api
┌───────────────────────────────▼─────────────────────────────────────┐
│ Preload security boundary                                            │
│ contextBridge + ipcRenderer wrappers                                │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ validated IPC
┌───────────────────────────────▼─────────────────────────────────────┐
│ Desktop main process                                                 │
│                                                                     │
│  IPC/domain handlers ─── chat/runtime ─── providers and CLIs         │
│         │                    │              │                       │
│         ├── SQLite            ├── tools/MCP  ├── context/agents       │
│         ├── projects/wiki    ├── artifacts  ├── workflows/scheduler  │
│         ├── Git/builds       └── voice/OCR  └── updater/feed          │
│                                                                     │
│  Authenticated WebSocket server ──────────────── Android companion   │
└─────────────────────────────────────────────────────────────────────┘
               │                    │                    │
               ▼                    ▼                    ▼
       SQLite user data       project files       child/external systems
```

## 4.1 Major partitions

| Partition | Main location | Responsibility |
| --- | --- | --- |
| Desktop shell/lifecycle | `src/main/index.ts`, lifecycle/system modules | Window, single instance, protocols, CSP, updater, startup/shutdown |
| Renderer presentation | `src/renderer/` | React screens, input, rendering, local UI state, optimistic interaction |
| Secure bridge | `src/preload/index.ts` | Explicitly exposed typed request and event surface |
| Shared contract | `src/shared/` | Types, model metadata, chat turn events, utilities, provider messages |
| IPC/application services | `src/main/*-handlers.ts` | Validate and coordinate domain requests |
| Conversation runtime | `chat-handlers.ts`, `chat-provider-dispatch.ts`, `chat-turn-emitter.ts` | Build context, route execution, stream events, persist result |
| Backend adapters | `providers/`, `cli-adapters/`, `backend-routing.ts` | Convert Nexy requests to provider/CLI protocols |
| Tool runtime | `tool-loop.ts`, `tools.ts`, `mcp.ts`, desktop bridges | Call tools, enforce trust/approval, return results |
| Durable storage | `database.ts`, `database-migrations.ts`, domain services | SQLite schema, migrations, row mapping, transactions |
| Work-product/automation | artifacts, workflow, scheduler, build, Git modules | Versioned output, repeated execution, projects, delivery, maintenance |
| Mobile transport | `ws-server.ts`, `ws-handlers.ts`, `standalone-sync.ts` | Authenticated pairing, commands, snapshots, deltas, live events |
| Android client | `android/app/src/main/java/io/nexy/android/` | Room-backed local app, sync outbox, direct chat, remote control UI |

# 5. Software item structure

| Software item | Inputs | Outputs | Security/reliability relevance |
| --- | --- | --- | --- |
| `NEXY-UI` renderer | User actions, IPC replies/events | UI state and visible requests | Must not access privileged APIs directly |
| `NEXY-BRIDGE` preload | Renderer calls/events | Limited IPC invocation/subscriptions | Smallest possible privilege boundary |
| `NEXY-MAIN` application services | IPC commands, WebSocket commands, timers | Domain results, events, child processes | Sender validation, error normalization, authorization |
| `NEXY-CHAT` runtime | Conversation, agent, project, context, backend | Ordered turn events and persisted messages | Cancellation, partial recovery, context limits |
| `NEXY-BACKENDS` | Provider/CLI credentials and request | Normalized stream chunks and usage | Secret handling and provider-specific failures |
| `NEXY-TOOLS` | Agent tool policy, tool requests | Tool results and approval requests | File/path confinement, approval, trust boundaries |
| `NEXY-DATA` | Domain writes and migrations | SQLite records | WAL, foreign keys, versioned migrations |
| `NEXY-PROJECT` | Workspace paths, config, Git state | Source context, edits, diffs, audit records | Scope confinement and user-controlled workspace access |
| `NEXY-DELIVERY` | Artifact/workflow/schedule definitions | Versions, previews, files, run history | Immutable lineage, checksums, atomic publish |
| `NEXY-MOBILE-SERVER` | Paired client frames | Authenticated commands/events/sync | Token, protocol, device and project scope |
| `NEXY-ANDROID` | Local records, WebSocket, direct APIs | Local UI and queued/remote mutations | Keystore secrets, outbox idempotency, conflict visibility |

# 6. Interfaces and external dependencies

| Interface ID | Source | Destination | Type | Purpose |
| --- | --- | --- | --- | --- |
| IF-UI-BRIDGE | Renderer | Preload | `window.api` typed calls/events | Request and receive application operations |
| IF-BRIDGE-MAIN | Preload | Main | Electron IPC | Invoke handlers and receive push events |
| IF-MAIN-DB | Main services | SQLite | Synchronous SQL/service calls | Persist durable Nexy state |
| IF-CHAT-PROVIDER | Chat runtime | API provider | HTTPS/SSE or compatible stream | Execute model turns |
| IF-CHAT-CLI | Chat runtime | CLI adapter/process | stdio/ACP/process stream | Execute local CLI-backed turns |
| IF-CHAT-TOOL | Chat runtime | Built-in/MCP/desktop tool | Internal tool contract | Inspect, fetch, edit, automate, or delegate |
| IF-MAIN-MOBILE | Desktop WebSocket server | Android | Authenticated WebSocket | Remote commands, sync, and live events |
| IF-ANDROID-API | Android standalone chat | Anthropic/OpenAI/OpenRouter | HTTPS stream | Direct phone-local provider chat |
| IF-PROJECT-FILES | Project services | User workspace | Filesystem/Git/process | Read/write project sources and run builds |
| IF-EXTERNAL-MCP | Nexy development loopback bridge | External MCP client | stdio + loopback token | Approved access to the Nexy source checkout only |

Important third-party dependencies are Electron, React, Zustand, better-sqlite3, `@modelcontextprotocol/sdk`, `ws`, `node-pty`, `@nut-tree-fork/nut-js`, `electron-updater`, Android Room, Compose, OkHttp, and Android security libraries. Their versions are controlled by `package.json`, Gradle version catalogs, and the build configuration.

# 7. Runtime behavior

## 7.1 Desktop startup

```text
single-instance lock
  → window + isolation + CSP
  → database open + migrations
  → IPC registration
  → MCP/mobile/updater initialization
  → renderer hydration
  → ready for user actions
```

Startup must fail safely when an optional integration is unavailable. A missing provider key, CLI, MCP server, or Firebase configuration should affect that capability rather than make unrelated local data unusable.

## 7.2 Chat control flow

```text
user request
  → chat handler
  → load conversation/project/agent
  → build bounded context
  → route to provider, CLI, or orchestrator
  → tool loop and approvals as required
  → ChatTurnEmitter events
  → desktop renderer + mobile WebSocket
  → assistant persistence and notifications
```

Each active turn has a stable `turnId`. Events are sequenced. Cancellation targets the conversation/turn and is independent of historical message loading.

## 7.3 Orchestration control flow

```text
leader agent
  → delegate_to_agent(agent id, task)
  → specialist turn
  → bounded result
  → leader continuation
```

The default maximum delegation depth is five. This is a runtime guard, not a promise that every specialist task will finish successfully.

## 7.4 Workflows and scheduling

Workflows are saved before execution. A run owns step states and run history; a reusable template is independent from a particular run. Schedules create chat or workflow runs through the same controlled execution services rather than inventing a second execution path.

# 8. Data architecture

The desktop uses a single-file `better-sqlite3` database in the application user-data directory, WAL mode, foreign keys, and append-only versioned migrations. Principal data domains are:

| Domain | Representative records |
| --- | --- |
| Identity/settings | settings, credentials, credential bindings |
| Workspaces | projects, project agents, sources, milestones, variables |
| Chat | conversations, messages, tool calls, summaries, ratings |
| Agent knowledge | agents, skills, agent skills, knowledge files, MCP overrides |
| Reusable text | prompt entries and prompt versions |
| Delivery | artifacts, artifact versions, workflow templates/runs/steps, reviews, previews |
| Automation | scheduled tasks, attached workflow specs, scheduled runs |
| Project operations | edit sessions, touched files, audit/diff records |
| Diagnostics | error logs, build records, update/feed metadata |

Android Room stores canonical portable records plus Android-owned fields such as draft, outbox, conflict, sync status, local attachment path, and transfer progress. Non-portable fields and secrets are filtered out by contract.

# 9. Security and trust architecture

## 9.1 Desktop boundary

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and sandboxing. The preload script uses `contextBridge` and exposes only explicitly listed API methods. Main handlers are registered through `safeHandle`, which validates the sender and normalizes failures.

## 9.2 Tool boundary

Tool enablement and approval are per-agent and, for MCP, per-server/per-tool. File operations are constrained to the working scope. Managed publishing checks relative paths and rejects symlink/link escapes. External MCP writes go through normal Nexy approval prompts and are never blanket-trusted.

## 9.3 Credential boundary

Desktop provider keys use `safeStorage` where available. Android provider keys use a Keystore-backed vault. Synchronization carries credential metadata and bindings when needed for display, never key payloads. A desktop-to-phone key handoff is a separate explicit human approval.

## 9.4 Mobile boundary

Local pairing uses a random token and QR-pinned certificate fingerprint. External URLs require normal Android TLS trust unless a supplied fingerprint is used. Regenerating the token invalidates existing connections. Protocol negotiation must complete before either database is modified.

# 10. Quality attributes and architectural controls

| Attribute | Architectural control |
| --- | --- |
| Safety of user data | SQLite migrations, backups, versioned artifacts, atomic publish, attachment hashes |
| Responsiveness | Streaming events, bounded sync batches, pagination, separate background activity state |
| Recoverability | Partial turn persistence, outbox retry, scheduler run history, build records, tombstones |
| Portability | Provider abstraction, JSON export/import, portable project config, Android sync contract |
| Testability | Shared types, domain modules, Vitest tests, Android unit/instrumentation tests, handler boundaries |
| Privacy | Local-first storage, secret filtering, protected vaults, no routine payload logging |
| Extensibility | Provider registry, CLI adapters, MCP discovery, typed IPC, versioned workflows |
| Explainability | Activity events, tool records, artifact lineage, project audits, debrief artifacts |

# 11. Traceability references

| Record | Use |
| --- | --- |
| [README](../../README.md) | Product capability and setup summary |
| [Existing architecture](../../src/docs/ARCHITECTURE.md) | Detailed current source layout and desktop data flow |
| [Functionality guide](NEXY_FUNCTIONALITY_GUIDE.md) | Human-readable feature behavior |
| [Android standalone](../android-standalone.md) | Standalone capability and backup behavior |
| [Android contract](../android-standalone-contract.md) | Canonical entities, filtering, protocol, conflicts |
| [Mobile WebSocket](../MOBILE_WEBSOCKET.md) | Pairing and remote managed workflow interface |
| [Development MCP](../development-mcp.md) | External developer bridge for the Nexy checkout and disposable test runtime |
| `src/shared/types.ts` | Cross-process and cross-platform data contracts |
| `src/main/database-migrations.ts` | Database schema evolution source |
| `src/main/__tests__/`, `src/renderer/__tests__/` | Desktop verification evidence |
| `android/app/src/test/`, `android/app/src/androidTest/` | Android verification evidence |
