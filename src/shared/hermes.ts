/**
 * Hermes profile shared primitives — single source of truth for profile-name
 * validation and profile metadata shape, used by both the main process
 * (enumeration/IPC) and the renderer (config UI).
 *
 * The Android client cannot import this TS module; it keeps a twin Kotlin
 * constant that MUST be kept in sync with HERMES_PROFILE_RE below.
 */

/**
 * Mirrors Hermes' own profile-name rule (`profiles.py`):
 * lowercase alphanumeric start, then `[a-z0-9_-]`, max 64 chars total.
 */
export const HERMES_PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** The implicit profile used when no `--profile` flag is passed to Hermes. */
export const HERMES_DEFAULT_PROFILE = 'default'

/** Returns true when `name` is a syntactically valid Hermes profile name. */
export function isValidHermesProfile(name: string): boolean {
  return HERMES_PROFILE_RE.test(name)
}

/**
 * A Hermes profile as surfaced to the config UIs. A profile is a fully
 * isolated `HERMES_HOME` (`~/.hermes/profiles/<name>`) with its own model,
 * provider, skills, memory, and SOUL.md.
 */
export interface HermesProfileInfo {
  name: string
  isDefault: boolean
  model?: string
  provider?: string
  /** Short human description, e.g. the first line of the profile's SOUL.md. */
  description?: string
}

export type HermesProfileDiscoveryRootSource = 'configured' | 'environment' | 'platform-default'

export interface HermesHomeValidation {
  path: string
  profilesDirectory: string
  valid: boolean
  reason?: 'empty' | 'not-directory' | 'profiles-directory-missing'
}

/** Diagnostics returned with the profile list; profile contents and credentials are excluded. */
export interface HermesProfileDiscovery {
  profiles: HermesProfileInfo[]
  root: string
  rootSource: HermesProfileDiscoveryRootSource
  profilesDirectory: string
  profilesDirectoryExists: boolean
  namedProfileCount: number
  ignoredEntries: Array<{
    name: string
    reason: 'invalid-name' | 'tombstone' | 'markerless' | 'not-directory' | 'inaccessible'
  }>
  error?: string
}

/** Result of probing whether the installed Hermes CLI is ready to serve ACP. */
export interface HermesAcpReadiness {
  ready: boolean
  version?: string
  /** Stable machine-readable diagnosis for routing and companion UIs. */
  status?: 'ready' | 'missing' | 'unsupported' | 'authentication' | 'error'
  /** Human-readable detail when not ready (e.g. missing credentials). */
  detail?: string
}
