# Android standalone mode

Nexy Android stores its working dataset locally and can open without a paired desktop. Pairing
adds synchronization and desktop-only tools; it is not required for local browsing, editing, or
direct cloud chat.

## Capability matrix

| Capability | No network | Internet only | Paired desktop |
| --- | --- | --- | --- |
| Browse/search conversations, projects, agents, prompts, skills, and wiki | Cached data | Local data | Local data synchronized with desktop |
| Create, edit, pin, branch, and delete local records | Queued | Queued | Synchronized |
| Compose drafts | Durable | Durable | Durable |
| Cloud chat | Draft only | Anthropic, OpenAI, or OpenRouter direct from Android | Direct Android chat or desktop chat |
| Resolve synchronization conflicts | Review cached conflicts | Review cached conflicts | Choose Android or desktop value and synchronize |
| Builds, shell, Git, CLI models, stdio MCP, workspace changes, automation | Unavailable | Unavailable | Available through desktop |
| Project Git workbench | Unavailable | Unavailable | Available through desktop |
| Generators that write workspace files | Unavailable | Unavailable | Available through desktop |

An internet connection alone never grants access to desktop files or processes. API credentials
remain Android-local, use Keystore-backed encrypted preferences, and are excluded from snapshots,
outbox records, and backups.

## Local state and synchronization

Room is the Android source of truth. Local changes are committed before network work begins and
enter a durable outbox with an idempotency key, device sequence, entity version, and retry state.
The desktop and Android prefer synchronization protocol version 2. Initial pairing uses a bounded
snapshot; subsequent reconnects send a durable desktop cursor and receive only changed entities.
Protocol version 1 remains available as a full-snapshot fallback for older desktop builds.

Independent field changes merge automatically. Concurrent changes to the same field and
delete-versus-edit changes create a conflict containing both recoverable values. Open
**Settings → Connection** to inspect pending/failed counts, retry synchronization, and choose the
Android or desktop value for each conflict. Tombstones are retained until the peer acknowledges a
covering snapshot.

Sync failures self-heal where possible: deleting a conversation locally also cancels any
not-yet-synced operations for its messages, and a failed operation whose parent record no longer
exists locally is discarded automatically (no user action, no notification) rather than sitting in
"failed" forever. Whatever remains genuinely failed is retried automatically rather than requiring
a manual retry for every item. Error text shown in the Connection screen and Diagnostics is
translated into plain language where the underlying cause is recognized (e.g. a change that
referenced already-deleted data); unrecognized errors still show their raw text.

Messages created on either device use stable UUIDs. Replaying an acknowledged batch is safe.
Attachments stored by standalone chat are content-addressed with SHA-256 hashes. The sync protocol
transfers attachment manifests and verified 64 KB chunks, resumes from the acknowledged byte
offset after reconnect, deduplicates by content hash, and restarts a damaged download.

## Standalone mode toggle

"Standalone" and "remote" are a user preference, separate from the connection-status indicator.
The home top bar's connection chip doubles as this toggle: tapping it flips Standalone ↔ Remote
immediately, and its label ("Connected to desktop", "Connecting…", "Searching…", "Standalone mode")
always reflects actual reachability. The toggle is disabled while a chat, generation, or sync is
active — tapping it then shows a toast explaining why, since switching modes mid-stream would pull
the connection out from under it. The same toggle, with an explanation of what each mode affects,
is also available in Settings → Connection for a slower, more deliberate path to the same setting.
Either way, remote CLI models and desktop file/git context stay hidden in Standalone mode without
implying the desktop is unreachable.

## Direct provider chat

Configure a provider under **Settings → Providers**. Anthropic uses its Messages streaming API;
OpenAI and OpenRouter use an OpenAI-compatible streaming API. User messages are persisted before
dispatch, partial assistant messages are checkpointed, and cancellation or interruption leaves a
recoverable record rather than an indefinite loading state.

Vendor-prefixed catalog model ids such as `anthropic/claude-*` are OpenRouter model ids and route
through OpenRouter, even when the OpenRouter model cache has not been refreshed. Native bare Claude
ids such as `claude-*` still route through Anthropic. This avoids misleading "OpenAI key missing"
errors when the selected model is actually an OpenRouter model.

A provider can be "configured" in two distinct senses: a real key stored locally on this device
(usable for standalone chat), or only configured on the paired desktop (visible, but not usable
standalone until a key exists locally too). The Providers screen labels these states separately —
"Connected" vs. "Desktop only" — instead of implying both are equally usable. For a desktop-only
provider, use **Request key from desktop** to ask the desktop to hand off its key: this requires an
explicit "Send Key" approval on the desktop side before anything is transmitted, and the key value
is never included in general sync, backups, or outbox records regardless.

Generic API-key and access-token credentials can also power Android direct provider chat when an
active **Automatic** access grant matches `provider:anthropic`, `provider:openai`, or
`provider:openrouter` and the current project, agent, and conversation scope. Those secrets are
resolved only in the Android request path and are never sent to the paired desktop. **Always ask**
grants are not used automatically. MCP and workspace capabilities continue to execute on the
paired desktop.

Inline image limits are 10 MB per image and 20 MB per request. Context construction is
deterministic, trims old turns to the configured budget, and stores a rolling summary when
compression is needed. Usage comes from the provider response. Cost is labeled as an estimate and
is zero/unknown when the bundled pricing catalog has no matching entry.

## Project Git and desktop-only work

The Android code panel operates on the desktop workspace and therefore requires an active desktop
connection. In standalone mode, Android keeps the panel unavailable; reconnecting restores branch,
diff, staging, commit, pull, push, stash, and conflict-management operations. AI coding work belongs
in an ordinary project conversation and does not use a separate report workflow.

Manual Workflow planning can still be used for generating and inspecting a delegation plan. The
new execution model is a prompt-chaining runner: steps are ordered by `dependsOnStepIds` when
present, otherwise by list order; each dependent step receives prior dependency outputs as context;
and execution halts on the first failed step so retry can restart that step plus downstream
dependents. In this implementation pass, the desktop execution core and tests exist, while the full
Android/desktop run-management UI remains a separate integration surface.

## Debrief

A debrief asks an AI model to read a conversation's full transcript and produce a summary, the
commands/tools/APIs used, a step-by-step reproduction guide, and the reasoning approach followed.
It's unrelated to "Mark complete" — generating a debrief doesn't change a conversation's completed
state, and marking a conversation complete doesn't generate one. Opening **Debrief** from a
conversation's menu shows which conversation it's for and lets you pick a model before generating,
rather than silently generating with a hidden default; the fallback if you don't choose one is the
conversation's own model, then the app's global default.

## Backup and recovery

Open **Settings → Backup & recovery** to create or restore a passphrase-encrypted backup. Backups
use PBKDF2-HMAC-SHA256 and AES-GCM, include local attachment bytes, and exclude API keys and pairing
secrets. A restore validates the authenticated encryption envelope, required tables, attachment
hashes, and database integrity.

Keep the passphrase separately; it cannot be recovered by Nexy. Restoring replaces the current
local standalone dataset, so create a fresh backup first when the existing database is readable.

## Troubleshooting

- "Standalone mode" in the top bar is informational, not an error state; cached data and local
  edits remain available.
- Check **Settings → Connection** for outbox failures, conflicts, and last successful sync — most
  failures clear on their own; anything still listed there needs a manual look.
- Provider authentication and rate-limit errors appear on the interrupted assistant turn.
- **Settings → Developer → Debug log** contains bounded runtime diagnostics. It does not include
  provider credentials or synchronization payload bodies.
- If Android and desktop cannot negotiate a supported protocol version, neither database is
  modified. Upgrade the older app and retry.
