# Hermes Profiles in the Chat Model Picker

**Status:** Complete
**Follows:** [`HERMES_PROFILE_PICKER_UNIFICATION--COMPLETE.md`](./HERMES_PROFILE_PICKER_UNIFICATION--COMPLETE.md) (agent-level profile picker and discovery)

## Goal

Choose a Hermes profile directly from the chat model picker on desktop and Android, instead of selecting a model and then a profile in a separate control. The plan-approval card also shows the full plan.

## Design

- One picker group per discovered profile, keyed `hermes-cli:<profile>`, `default` first, then alphabetical. Labels are `Hermes · Default` / `Hermes · <profile>`; the profile's configured model and description are muted subtext.
- Model IDs inside a group stay bare. The profile is persisted beside the model (`conversations.conversation_hermes_profile`), never encoded into the model ID, because `getProviderForAgent()` splits on the first `:`.
- Profile groups are opt-in (`model:list-available` option `hermesProfileGroups`; WS `model:list` flag `hermesProfileGroups`). Generators, settings, schedules and older Android clients keep the single `hermes-cli` group they store as `hermes-cli:<model>`.
- An agent whose backend is Hermes pins its own profile; its picker shows only that profile's group.

## Delivered

### Plan-approval card
- [x] `ToolApproval.tsx` renders the full `args.plan` as markdown for plan decisions; ordinary tool arguments keep the 120-character truncation.
- [x] Scrollable `max-h-[50vh]` body, wider card, Expand/Collapse control, backend-neutral subtitle.

### Shared and main process
- [x] `src/shared/hermes.ts`: `hermesSourceKey()`, `parseHermesSourceKey()`, `hermesProfileLabel()`, `resolveEffectiveHermesProfile()`.
- [x] `model-availability.ts`: `getHermesProfileModelGroups()`; always yields `default` even when discovery fails; skips empty profiles.
- [x] `backend-routing.ts`: `inferCliBackendFromModel()` probes every profile; `resolveEffectiveBackend()` uses the effective profile.
- [x] `ws-handlers.ts`: per-profile groups for clients that request them; Hermes-locked agents receive only their profile's group.
- [x] Persistence reuses the existing `conversation_hermes_profile` column and `conversation:set-model` setter (model, backend and profile in one write).

### Desktop renderer
- [x] `ModelPicker.tsx`: `selectedSourceKey` disambiguates a bare model offered by several profiles; group subtext; profile disclosure on hover; profile groups nest under one Hermes row (Hermes → profile → model).
- [x] `ChatWindow.tsx`: requests profile groups, writes profile + model + `hermes-cli` together, keeps the optimistic selection until the profile write is confirmed; the separate profile-scoped refetch is removed.
- [x] `useChatWindowActions.ts`: `pendingHermesProfileRef` carries a draft chat's profile into the first send.
- [x] `ChatComposer.tsx`: standalone profile dropdown removed.

### Android
- [x] `HermesProfile.kt`: Kotlin twins of the shared helpers.
- [x] `ModelOption.hermesProfile`; the parser maps `hermes-cli:<profile>` groups to backend `hermes-cli` with the profile attached.
- [x] Chat requests profile groups; the model sheet selects profile + model together and no longer shows a profile dropdown. Connected-only guard unchanged.

### Tests and docs
- [x] Main: profile groups ordering/keys, no-profiles and failed-discovery fallback, empty-profile skip, legacy shape, IPC option; routing of a model unique to a non-default profile. Unknown-profile fallback remains covered by `hermes-acp.test.ts`.
- [x] Renderer: picker profile groups and search, persistence of profile + model, default-group selection, draft-chat first send, no composer profile control, untruncated plan card.
- [x] Android: helper twins, group parsing, profile + model write.
- [x] `docs/HERMES_ACP_USAGE_CONTRACT.md`, `src/docs/MODEL_CATALOG.md`.
