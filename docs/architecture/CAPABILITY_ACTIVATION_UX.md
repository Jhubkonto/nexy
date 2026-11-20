# Capability activation UX and runtime design

**Status:** Phase 3 and the Android chat entry point implemented; guided MCP installation remains
an incremental follow-up. Based on the NEXY `1.3.37` desktop and Android code paths reviewed on
`2026-08-19`.

## Decision summary

NEXY should present skills and MCP servers as one user-facing concept: **capabilities**.

- A **skill** supplies instructions and activation rules.
- An **MCP server** supplies executable tools.
- An **agent** is an optional reusable persona and policy bundle.
- A **project** is an optional workspace scope.
- A **conversation capability profile** is the missing piece: it lets a user use a skill or tool
  in the current chat without creating or attaching an agent.

The user should choose *what they want to do* first. NEXY should then explain which capability
pieces are ready, which need setup, and where the configuration will apply. Importing a skill,
installing an MCP server, assigning access, and activating a capability must remain separate
operations internally, but the UI should guide the user through them as one flow.

## Current-state diagnosis

The current separation is technically defensible but exposed directly to users:

1. Skill discovery scans external folders and importing copies a package into the managed library.
2. Skill attachment is stored only in `agent_skills` and is surfaced primarily from the agent
   editor.
3. MCP servers are installed/configured globally, while server access and trust are stored per
   agent.
4. A bare-model turn deliberately resolves neither an agent nor its attached skills.
5. Android can browse the same library remotely, but its skill detail text currently tells users
   to configure tools and MCP servers on an agent.

This creates a multi-gate mental model:

```text
find a package -> import it -> create an agent -> attach the skill -> add MCP -> assign MCP
-> set trust -> select the agent -> invoke the skill
```

It also creates a false choice: users who want a one-off browser audit must either learn the
agent configuration model or run without the skill and browser tools.

## Target user model

The primary entry point is **Use capability**. It is available from:

- a skill row or skill detail page;
- an MCP catalog card or configured server card;
- the chat composer capability button;
- a missing-capability message shown when a skill is explicitly invoked.

The flow has three scopes:

| Scope | Meaning | Persistence | Typical use |
| --- | --- | --- | --- |
| This chat | Add capabilities to the selected conversation only | Conversation record | One ThingsBoard audit or one browser task |
| This project | Make capabilities available to chats in this project | Project configuration | A recurring LynxCloud workspace workflow |
| This agent | Reuse the capability bundle for every conversation using the agent | Agent configuration | A permanent account-audit agent |

The recommended default is **This chat**. It does not create an agent. If the user chooses
project or agent scope, the UI states exactly what will be changed before applying it.

### One authoritative editor per scope

Each scope has exactly one surface that owns its full set, and that surface is the only one with
replace semantics:

| Scope | Authoritative editor | Semantics |
| --- | --- | --- |
| This chat | Chat composer capabilities modal | Replace — the submitted selection is the profile |
| This project | **Project Settings → Capabilities** | Replace — removal and trust loosening happen here |
| This agent | Agent panel → Skills/MCP | Replace, backed by the agent attachment and trust tables |

The modal's "Add to project" / "Attach to agent" buttons are **additive shortcuts**, not editors.
They union the selection into the target scope and, through `mergeTrust`, can only ever tighten an
approval level. That asymmetry is deliberate: a chat must not be able to silently loosen a
restriction that a project or agent imposed. The consequence is that a grant can only be *removed*,
and an approval level only *loosened*, from the scope's authoritative editor — so every scope needs
one. Project scope had no such editor before `project:get-capabilities` /
`project:set-capabilities`, which made project grants permanent once written.

The composer opens **Chat capabilities**, using the shared modal shell with Skills, MCP tools,
Credentials, and Readiness tabs. Scope and save controls remain visible while tab content scrolls.
Skill and MCP edits are saved explicitly and survive status refreshes and tab changes. Closing,
changing scope, or following a management link asks to discard unsaved edits. Saving keeps the
modal open and refreshes readiness, which reflects saved capabilities and their provenance.
Credential Grant and Remove actions apply immediately to the active chat, regardless of scope.

## Guided activation flow

The flow should be the same on desktop and Android, with platform-specific controls only where
necessary:

1. **Choose the task**
   - Show the selected skill/capability and a plain-language description.
   - Show the expected outcome, for example “Inspect an authorized ThingsBoard instance and
     produce a redacted read-only audit bundle.”
2. **Check prerequisites**
   - Skill package: ready / needs import / invalid.
   - Required MCP capability: ready / not installed / disconnected / unsupported on this device.
   - Provider/model: ready / needs provider setup / model cannot call tools.
   - User authorization: required confirmation before an external audit starts.
3. **Choose where to use it**
   - `This chat` (recommended), `This project`, or `This agent`.
   - If there is no agent, never display “create an agent” as the only path.
4. **Configure missing pieces**
   - “Add Playwright (Chromium)” opens the catalog card, prefilled setup, test connection, and
     returns to the activation checklist.
   - “Import skill” accepts a package or individual `SKILL.md`; discovery is an optional advanced
     route, not a prerequisite the user must understand.
5. **Review permissions**
   - New MCP access defaults to **Ask before running**.
   - Show read-only versus can-change impact.
   - For a skill declaring browser access, show the exact required capabilities (navigation,
     interaction, screenshots, snapshots, and network inspection where applicable).
6. **Activate**
   - The final action says `Use in this chat`, `Add to project`, or `Attach to agent`, not
     `Import` or `Assign`.
   - The chat header shows a compact capability chip and a `Manage` action.

For `audit-thingsboard-instance`, the resulting checklist should read approximately:

```text
Audit ThingsBoard instance
✓ Skill imported
✓ Playwright (Chromium) connected
✓ Browser actions default to Ask before running
○ User must log in inside the isolated browser
→ Start audit
```

The skill remains explicitly invoked. The guided flow only prepares and explains the runtime;
it must not silently connect to an external instance or start an audit.

## Runtime model

Add a provider-neutral, secret-free capability profile. Do not create a hidden synthetic agent.

```ts
interface ConversationCapabilityProfile {
  version: 1
  skillIds: string[]
  mcp: Array<{
    serverId: string
    trust: 'auto' | 'always-ask' | 'block'
  }>
  builtInTools?: Partial<Record<'fileEdit' | 'terminal' | 'webFetch', {
    enabled: boolean
    approval: 'auto' | 'always-ask' | 'disabled'
  }>>
}
```

The profile contains references only. It never contains MCP commands, environment variables,
API keys, cookies, browser sessions, or package contents.

At runtime NEXY resolves:

```text
conversation profile
        + project profile (if enabled)
        + agent profile (if selected)
        ──────────────────────────────────
        effective capability context
```

The resolver should return both effective capabilities and provenance, so the UI and audit trail
can say “Playwright came from this chat” or “File editing came from the selected agent.” Explicit
blocks and approval restrictions always win. A conversation profile may add a capability, but it
must not weaken an explicit project/agent restriction without a visible confirmation.

The same effective context must feed all execution paths:

- BYOK provider tool definitions and the MCP tool loop;
- Claude/Codex/Hermes CLI MCP configuration and preflight approval;
- skill instruction injection and skill invocation logging;
- desktop and Android capability/status reporting.

This avoids the current split where a skill can be visible in one surface, while the tool loop
still has no corresponding server assignment.

## Persistence and synchronization

Implement the first version as a versioned capability-profile record associated with a conversation.
The record can initially be stored as a JSON column, provided it is validated at the boundary and
contains only IDs and approval policy. If project and agent profiles are generalized later, move
the same shape behind a `capability_profiles` table without changing the renderer or WebSocket
contract.

Required operations:

- `conversation:get-capabilities`
- `conversation:set-capabilities`
- `capabilities:resolve` (read-only preflight; returns status and provenance)
- `capabilities:activate` (additive write to the selected scope after confirmation)
- `project:get-capabilities` / `project:set-capabilities` (project scope, replace semantics; the
  set path normalizes, validates every skill/server reference, then broadcasts
  `project:config-changed` to mobile like any other project config write)

Android should receive the profile and preflight status through WebSocket events. In standalone
mode, Android may use skills and direct provider chat only when the selected capability is locally
available; stdio MCP remains desktop-only. The Android UI must say **Use on connected desktop**
for desktop-only capabilities rather than showing a dead enable switch.

## Desktop information architecture

Keep the existing management screens, but add a capability-oriented layer:

- **Skills pane:** primary action `Use skill`; secondary actions `Import`, `Discover`, `Create`.
- **MCP workspace:** primary action `Add capability`; server administration remains available
  under `Manage servers`.
- **Chat composer:** `Capabilities` button showing active chat capabilities and missing
  prerequisites.
- **Agent editor:** retain advanced attachment and per-tool policy controls, but label them as
  reusable defaults rather than the only way to activate a skill.
- **Project settings:** add an optional capability defaults section with an explicit inheritance
  explanation.

The capability checklist should be a reusable component, not duplicated in the skill pane, MCP
panel, and chat composer.

## Android information architecture

Android should mirror the same concepts and state labels:

- Skills detail: `Use in chat`, `Add to project`, `Attach to agent`, and `Manage package`.
- MCP catalog/server detail: `Use in chat` when paired, with `Desktop required` or `Not available
  in standalone mode` when appropriate.
- Chat composer: a compact `Capabilities` sheet with current profile, readiness, and remove/reset.
- Settings: keep MCP administration, but describe it as desktop-connected administration rather
  than the place users must visit before every task.

Android must not accept or persist MCP secrets in the capability profile. The desktop remains the
execution host for stdio servers and the authority for server connection status.

## Phased implementation plan

### Phase 1 — shared contract and preflight

- Add the shared profile and readiness/provenance types.
- Add validation and a main-process resolver with no UI mutations.
- Add desktop and WebSocket read-only preflight responses.
- Add tests for missing skill, missing MCP, disconnected MCP, unsupported model, and ready state.

Acceptance: a bare conversation can ask for a capability preflight and receive a truthful status
without creating an agent or starting a server.

### Phase 2 — chat-scoped activation

- Persist a conversation profile.
- Add `Use in this chat` to the desktop skill detail and MCP catalog.
- Feed the profile into BYOK and CLI execution paths with default `always-ask` trust.
- Record skill invocation and tool-call provenance against the conversation even when `agent_id`
  is null.

Acceptance: a user can import `audit-thingsboard-instance`, add Playwright, activate both for one
conversation, log in interactively, and run the skill without an agent.

### Phase 3 — project and agent scopes

- Add project capability defaults and guided conversion from a chat profile.
- Preserve the existing agent attachment tables as a compatibility view, or migrate them into the
  generalized profile store.
- Add clear inheritance and restriction resolution in the checklist.

Acceptance: users can promote a working chat setup to a project or agent without re-entering MCP
configuration or secrets. **Implemented:** project defaults are stored in the existing project
configuration JSON; agent promotion reuses the existing skill attachment and MCP trust tables;
the effective resolver applies the most restrictive trust across inherited scopes. Project scope is
edited in the Capabilities tab of Project Settings (`src/renderer/components/project-settings/
CapabilitiesTab.tsx`), which is the only surface that can revoke a project grant or loosen its
approval level. Profile entries whose skill or MCP server no longer exists are surfaced as
"Unavailable" with an explicit Remove control rather than being dropped silently on the next save.

### Phase 4 — Android parity

- Add the same activation and preflight events to the WebSocket contract.
- Add the capability sheet to Android chat and capability actions to skill/MCP detail screens.
- Add offline/standalone messaging for desktop-only capabilities.
- Add Android UI tests for paired, disconnected, and standalone states.

Acceptance: a user can start the setup from Android, see exactly what will run on the desktop, and
finish activation without navigating through an agent editor. **Chat entry point implemented:**
Android now exposes a capability sheet from the chat header, mirrors the three scopes, labels
desktop-only MCP execution, and provides a direct **Open MCP setup** action that navigates to the
desktop-owned MCP workspace when paired.

## Security rules

- A skill can declare required capabilities but cannot install, enable, trust, or invoke an MCP
  server by itself.
- Imported packages remain subject to package validation and content hashing.
- MCP secrets remain in the existing encrypted server configuration; never sync them to Android or
  include them in a capability profile.
- External browser audits remain explicit and read-only according to the skill contract.
- `auto` trust is never the default for a newly activated capability.
- A capability checklist is advisory; the runtime resolver and tool loop remain the enforcement
  points.

## Definition of done

The feature is complete when a new user can say “audit this ThingsBoard instance” and NEXY can:

1. find or import the named skill without requiring knowledge of skill folders;
2. identify that browser control is required;
3. add or select Playwright from a capability catalog;
4. show the connection and approval state;
5. let the user choose chat, project, or agent scope;
6. run the skill with a bare model when the user chooses chat scope;
7. explain any desktop/Android limitation in plain language; and
8. preserve the existing credential, approval, and read-only safety boundaries.
