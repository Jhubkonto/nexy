# Hermes ACP usage contract

Nexy treats ACP `session/update` messages with `sessionUpdate: "usage_update"` as authoritative
only when they include explicit numeric `inputTokens`/`outputTokens` fields (snake_case aliases
are accepted for wire compatibility). The optional USD cost is read from `cost.amount` when
`cost.currency` is `USD`.

The legacy `used` field is intentionally ignored because ACP does not define it as input tokens;
it may represent a context budget or another provider-specific total. Until Hermes emits the
explicit fields, Nexy displays its local estimate before sending and does not fabricate a
provider-reported usage total afterward.

## Runtime and configuration boundary

Nexy launches one `hermes acp` process per active conversation and reuses that process only while
the conversation's profile, model, working directory, system prompt, MCP set, and permission
boundary are unchanged. A changed boundary closes the old process before creating the new one.

Hermes remains the owner of authentication, provider credentials, profile configuration, memory,
skills, hooks, and its internal state. Nexy never imports or displays those credentials. The
operator changes them in a terminal with Hermes commands such as `hermes setup` or `hermes auth`,
then uses Nexy's Recheck action. Nexy owns the project cwd, additional directories, approved MCP
servers, permission decisions, conversation transcript, and normalized desktop/Android events.

Profile discovery follows Hermes's active home exactly. Nexy first uses the optional Hermes home
override saved in **Settings → CLI Tools**, then `HERMES_HOME` when present, otherwise the platform
default (`%LOCALAPPDATA%\\hermes` on Windows and `~/.hermes` on POSIX). The selected root must
contain `<home>/profiles`; Nexy scans only that directory. It shows the synthetic `default` profile
plus named directories that have a valid Hermes profile name and at least one Hermes
identity/configuration marker (`config.yaml`, `profile.yaml`, `.env`, `SOUL.md`, or `auth.json`).
Tombstoned, invalid, markerless, and non-directory entries are ignored and reported in discovery
diagnostics. Nexy does not copy or link profiles automatically. If profiles live in another
repository, choose that repository root in **Settings → CLI Tools**, or point `HERMES_HOME` at it
before launching Nexy, or create an operator-managed junction or symlink; never copy the
credential-bearing files into the Nexy project. The setting stores only the path, and Nexy never
reads or edits Hermes credentials.

Nexy routes to Hermes only after the asynchronous `hermes acp --check` readiness probe succeeds.
The probe distinguishes a missing executable, unsupported ACP installation, authentication or
provider configuration failure, and an undifferentiated runtime error. An installed binary alone
is not sufficient for selection.

In the Android chat model picker, the Hermes profile control is a dropdown, not a free-text CLI
input. It is shown only when the active model target is Hermes and lists the profiles discovered
on the connected desktop, plus **Default profile**. A selection made in a brand-new draft chat is
held locally and included with the first message, because the desktop conversation row does not
exist until that message is sent. Selecting **Default profile** explicitly uses Hermes' normal
profile rather than silently changing the choice back to the global default.

Permission requests are fail-closed: Nexy's ordinary approval resolves to Hermes's `allow_once`
option, while deny, timeout, cancellation, stale UI, and disconnected clients select Hermes's
deny option when available. Full-auto approval is an explicit trusted-agent policy and does not
broaden the session's filesystem or MCP boundary.

Session processes are closed on cancellation escalation, emergency stop, idle expiry, and Electron
shutdown. A failed or cancelled turn is never automatically retried through the legacy
`hermes -z` adapter. That adapter exists only behind the development-only
`NEXY_DEV_HERMES_LEGACY=1` flag with `NODE_ENV=development` for rollback diagnostics.
