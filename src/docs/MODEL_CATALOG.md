# Model Catalog Sources

Nexy derives all "known model" metadata (labels, billing multipliers, and the
fallback catalog seed) from a **single canonical list**, `KNOWN_MODELS` in
`src/shared/models.ts`:

- `MODEL_LABELS` and the multiplier map are generated from `KNOWN_MODELS`.
- `getStaticCatalogSeed()` projects `KNOWN_MODELS` into `CatalogModel[]`, which
  `src/main/model-catalog.ts` re-exports as `STATIC_SEED` (cached in settings as
  `model_catalog_snapshot`, exposed through `model:list-catalog`).

Add or update a model in `KNOWN_MODELS` once and labels, multipliers, and the
catalog seed all move together — they can no longer drift apart.

Which provider *offers* which model is a separate concern, defined by the
per-provider `models` arrays in `src/main/provider-registry.ts`. The authoritative
dropdown list for a configured provider comes from `getProviderModelIds()` (same
file), which **merges the static array with the provider's live `/models` cache**
(deduped by a normalized ID key so dotted/dashed/dated spellings collapse to one
entry). Both the desktop dropdowns (`model-availability.ts`) and the Android
companion (`ws-handlers.ts` `model:list`) call this one function, so they stay in
sync.

Other sources:

- `src/main/cli-detection.ts`: Codex has offline fallback models and prefers `~/.codex/models_cache.json` when available (a file Codex itself maintains). Claude CLI's OAuth subscription entitlement is separate from BYOK Anthropic credentials. Its normal choices come only from the last complete Claude Code menu probe; it also shows a short list of active, official full-ID legacy candidates from Anthropic's model-status catalogue. A legacy candidate is explicitly labelled **Verify on first use** and is promoted into the normal CLI list only after a tool-free local Claude Code request succeeds. Explicit model/entitlement rejections are remembered and removed from the picker; transient failures remain retryable. The API `/v1/models` cache is never used to imply Claude Code entitlement.

These lists appear in model dropdowns when the live/cached catalog is empty, in Settings default-model selection, the chat composer model selector, regenerate-with-model menus, `/models`, and the `Continue with...` fork dialog. CLI fallback lists appear in CLI-specific model selectors and are also used by main-process fork validation.

Best practice is to treat hardcoded models as offline fallbacks only. The preferred order is:

1. Backend-specific live discovery or cached provider/CLI data.
2. Persisted catalog snapshots from prior discovery.
3. Static seed/fallback lists only when discovery is unavailable.

All model sources now follow this hierarchy end-to-end:

- **OpenRouter**: `fetchAndCacheOpenRouterModels()` / `getOpenRouterModels()` in `src/main/provider-secrets.ts`, cached under the `openrouter_models_cache` settings key.
- **BYOK Anthropic**: `fetchAndCacheAnthropicModels()` / `getCachedAnthropicModels()` in `src/main/anthropic-models.ts`, cached under the `anthropic_models_cache` settings key. Triggered on BYOK key save (`provider:set-key`), on successful key test (`testProviderKey`), and via a startup backfill in `registerModelAvailabilityHandlers()` if a key is configured but the cache is empty. It feeds only the BYOK Anthropic dropdown group (via `getProviderModelIds`).
- **Claude CLI**: one non-blocking Claude Code PTY menu probe runs on application launch. `claude_cli_pty_models_cache` stores a versioned snapshot: complete menu parses replace the confirmed list (so retired models disappear); partial/failed parses keep that list and record attempt diagnostics. The probe understands both the pre-2.1.252 `❯` prompt and the current `>` prompt/menu markers, accepts both `Select model` and `More models` submenu headings, and excludes rows Claude Code explicitly marks disabled. It additionally stores per-ID legacy validation status (`legacy-candidate`, `validated`, or unavailable). No snapshot on a first launch means no menu-confirmed Claude model until discovery completes. The PTY adapter is intentionally isolated in `cli-adapters/claude-model-probe.ts` for replacement when Claude Code provides a structured listing.
- **BYOK OpenAI / Gemini / Azure**: `fetchAndCacheOpenAIModels()` / `fetchAndCacheGeminiModels()` / `fetchAndCacheAzureModels()` and `getCachedProviderModels()` in `src/main/provider-secrets.ts`, cached under `openai_models_cache` / `gemini_models_cache` / `azure_models_cache`. Same triggers as Anthropic (key save, key test, startup backfill). Gemini's OpenAI-shim `models/` id prefix is stripped so ids match registry spelling; Azure requires the endpoint to be configured before its deployments can be listed.
- **Codex CLI**: passive read of `~/.codex/models_cache.json`, refreshed by Codex itself — Nexy does not trigger this refresh.

Do not let hardcoded fallbacks bypass backend compatibility checks. Forking now validates selected agent/backend/model combinations in the main process and the renderer filters model options by selected backend.
