package io.nexy.android.data.model

/**
 * Hermes profile primitives — the Kotlin twin of `src/shared/hermes.ts`.
 *
 * Android is a companion and cannot run `hermes` locally, so the profile list and
 * ACP readiness arrive over WebSocket from desktop (see the `hermes` block on the
 * `app:cli-status` event). A profile is a fully isolated `HERMES_HOME`
 * (`~/.hermes/profiles/<name>`) with its own model, provider, skills, memory, and
 * SOUL.md — Nexy-launched sessions inherit that home.
 *
 * HERMES_PROFILE_RE MUST be kept in sync with HERMES_PROFILE_RE in shared/hermes.ts.
 */
val HERMES_PROFILE_RE = Regex("^[a-z0-9][a-z0-9_-]{0,63}$")

/** The implicit profile used when no `--profile` flag is passed to Hermes. */
const val HERMES_DEFAULT_PROFILE = "default"

/** Returns true when [name] is a syntactically valid Hermes profile name. */
fun isValidHermesProfile(name: String): Boolean = HERMES_PROFILE_RE.matches(name)

// Model picker profile grouping — twins of the helpers in shared/hermes.ts.

/** Source-key prefix for per-profile Hermes model groups (`hermes-cli:<profile>`). */
const val HERMES_CLI_SOURCE_KEY = "hermes-cli"

/** Builds a picker group source key for [profile], e.g. `hermes-cli:localllm`. */
fun hermesSourceKey(profile: String): String = "$HERMES_CLI_SOURCE_KEY:$profile"

/** Returns the profile from a group source key, or null for non-Hermes or bare `hermes-cli` keys. */
fun parseHermesSourceKey(sourceKey: String?): String? {
    if (sourceKey == null || !sourceKey.startsWith("$HERMES_CLI_SOURCE_KEY:")) return null
    return sourceKey.substring(HERMES_CLI_SOURCE_KEY.length + 1).trim().takeIf { it.isNotEmpty() }
}

/** Human-readable picker label for a profile group. */
fun hermesProfileLabel(profile: String, isDefault: Boolean = false): String =
    if (isDefault) "Hermes · Default" else "Hermes · $profile"

/** Effective profile for a chat turn: conversation override → agent profile → `default`. */
fun resolveEffectiveHermesProfile(conversationOverride: String?, agentProfile: String?): String =
    conversationOverride?.trim()?.takeIf { it.isNotEmpty() }
        ?: agentProfile?.trim()?.takeIf { it.isNotEmpty() }
        ?: HERMES_DEFAULT_PROFILE

/** A Hermes profile as surfaced to the config UI (mirrors shared `HermesProfileInfo`). */
data class HermesProfileInfo(
    val name: String,
    val isDefault: Boolean,
    val model: String? = null,
    val provider: String? = null,
    /** Short human description, e.g. the first line of the profile's SOUL.md. */
    val description: String? = null,
)

/** Hermes profile list + ACP readiness, delivered alongside `app:cli-status`. */
data class HermesCliInfo(
    val profiles: List<HermesProfileInfo> = emptyList(),
    val acpReady: Boolean = false,
    val version: String? = null,
    val acpStatus: String? = null,
    val acpDetail: String? = null,
    val profileRoot: String? = null,
    val profilesDirectory: String? = null,
    val namedProfileCount: Int = 0,
    val profileDiscoveryError: String? = null,
)
