# Android standalone data and capability contract

Contract version: 3. Reviewed against the Android screens, `WsRepository`, `WsEvent`, desktop
WebSocket handlers, and database migrations on 2026-08-15.

## Identifier policy

- New projects, agents, conversations, messages, reusable-content records, outbox operations,
  conflicts, drafts, and attachment references use lowercase RFC 4122 UUID v4 strings.
- Android has one stable UUID device identity. It survives upgrades and is never synchronized as
  user content.
- A dataset identity is the first 24 hexadecimal characters of SHA-256 over the pairing token.
  Android binds its local database to the first dataset and refuses synchronization with another
  saved desktop profile.
- Attachment content identity is the lowercase 64-character SHA-256 digest of the bytes. Transfer
  deduplication never relies on filenames, timestamps, or paths.
- Outbox ordering uses `(deviceId, deviceSequence)`; wall-clock timestamps are display metadata and
  never decide conflict winners.

## Canonical synchronized records

| Entity | Canonical fields | Android-owned local fields | Excluded fields |
| --- | --- | --- | --- |
| Project | `id`, `name`, `color`, portable `config`, `createdAt`, `updatedAt` | sync status/version | root/workspace paths, secrets |
| Agent | `id`, `name`, `icon`, `backend`, `cliModel`, portable `config`, timestamps | sync status/version | credentials, local paths |
| Conversation | `id`, `title`, agent/project/model IDs, `pinned`, timestamps | draft, summary, sync status | active stream state |
| Message | `id`, conversation ID, role/content/model/provider, finish reason, usage, attachments, thinking, timestamp | partial/failure and sync status | inline attachment bytes |
| Wiki | `id`, project ID, title/body/tags/source conversation, timestamps | sync status/version | none |
| Prompt | `id`, title/body/description/category/tags/scope/project ID, timestamps | sync status/version | none |
| Skill | portable versioned configuration, ID, timestamps | sync status/version | filesystem paths and secrets |
| Credential metadata | `id`, name, kind, provider, fingerprint, timestamps, revocation state | device-local vault value and local bindings | encrypted payload/value |
| Credential binding | `id`, credential ID, project/agent/conversation scope, capability, approval mode, expiry, timestamps | device-local approval state | credential payload/value |
| Attachment | attachment/message IDs, display name, MIME type, size, SHA-256 | local path and transfer state | local path; bytes travel only in verified chunks |

Unknown optional JSON fields are retained in canonical payload JSON. Malformed optional JSON is
treated as an empty/default value rather than crashing or silently replacing a pending local edit.
API keys, authorization values, passwords, pairing secrets, data URLs, base64 payload fields,
workspace/root/local paths, transient streams, logs, build state, and device settings are removed
recursively at both synchronization boundaries.

Android provider keys are stored in the device-local Keystore-backed credential vault. Existing
standalone provider keys are migrated into the vault on first access and removed from the legacy
provider preference entries. Standalone sync may carry credential metadata and binding scopes so
Android can display availability and permissions, but it never carries vault payloads, encrypted
values, or plaintext secrets. A local Android credential remains required for provider execution;
only an explicit, human-confirmed provider-key handoff can transfer a key from desktop to Android.

## Android capability matrix

| Area/action | Offline | Internet, no desktop | Paired desktop |
| --- | --- | --- | --- |
| Startup/navigation/settings/appearance | Local | Local | Local |
| Conversation list, search, rename, pin, delete, branch | Local + queued sync | Local + queued sync | Local/desktop synchronization |
| Draft composition and restoration | Local durable | Local durable | Local durable |
| Send/regenerate/stop standalone chat | Draft only | Direct provider | Direct provider or desktop execution |
| Agent create/edit/delete/config | Local + queued sync | Local + queued sync | Synchronized |
| Project create/rename/delete/portable config | Local + queued sync | Local + queued sync | Synchronized |
| Prompt, skill, and wiki browse/search/CRUD | Local + queued sync | Local + queued sync | Synchronized |
| Provider keys and endpoint validation | Read encrypted config | Direct provider API | Android-local vault keys; optional desktop provider view |
| Attachment selection/storage | Local content-addressed | Direct provider upload | Resumable peer synchronization |
| Sync summary, failed-operation inspection/retry/discard | Cached status | Cached status | Active synchronization |
| Conflict review/resolution | Review only | Review only | Resolve Android/desktop value |
| Backup, restore, integrity check, diagnostics export | Local | Local | Local |
| Artifacts and workspace-writing generators | Desktop required | Desktop required | Desktop execution |
| Managed workflow authoring, review, version history, and publication | Read-only cached state; actions disabled | Desktop required | Full control through desktop execution/storage |
| Builds, shell, Git, code changes, CLI backends | Desktop required | Desktop required | Desktop execution |
| Local stdio MCP, desktop automation, scheduled execution | Desktop required | Desktop required | Desktop execution |
| Tool approval or stopping an active desktop process | Disabled, never queued | Disabled, never queued | Live desktop only |
| HTTP remote MCP | Not enabled | Not enabled | Not enabled; requires separate threat model |

Managed automated workflows do not become Android-local merely because their editor is available
on Android. Source discovery, immutable snapshots, artifact versions, model execution, scheduling,
diff generation, destination checks, and file writes all remain desktop-authoritative. The Android
UI must show the paired-desktop requirement and disable review, regeneration, preview, and publish
controls while disconnected; those operations are never placed in the standalone outbox.

## State dimensions

UI state keeps desktop connectivity, internet connectivity, execution target, data freshness,
pending/failed operation counts, synchronization progress, conflicts, last success, and active chat
turns separate. Disconnecting does not clear Room-backed lists or reinterpret cached data as fresh.

## Protocol envelope

Protocol 2 negotiates Room sync schema, entity types, attachment support, a maximum batch size,
and a durable desktop change cursor. A valid cursor receives only changed entities; protocol 1
remains supported as a full-snapshot compatibility fallback.
Mutations carry operation ID, device ID/sequence, entity ID/type, base version, operation, canonical
payload, and display timestamp. Metadata is applied before message bodies; messages are prioritized
for the visible conversation and committed in bounded transactions so global hydration yields to
interactive chat work.
Attachment manifests use SHA-256 and transfer at most 64 KB per chunk, resuming from the receiver's
reported offset.

Chat history uses a separate request-correlated flow. The latest 20 messages are validated by a
content hash and can return `not-modified`; changed pages stream newest-first in batches of at most
10 messages or 128 KB. Older pages remain 60 messages and load only on upward pagination.
