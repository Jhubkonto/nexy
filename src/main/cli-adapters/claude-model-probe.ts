import { createRequire } from 'module'
import { execFile } from 'child_process'
import type { IPty, spawn as ptySpawnType } from 'node-pty'
import type { Terminal as TerminalType } from '@xterm/headless'
import { app } from 'electron'
import { buildCliChildEnv, resolveCliPath } from './utils'
import { getDatabase } from '../database'

// Electron's embedded ESM loader can crash loading these CJS native packages directly.
const require = createRequire(import.meta.url)
const ptySpawn = (require('node-pty').spawn) as typeof ptySpawnType
const Terminal = (require('@xterm/headless').Terminal) as typeof TerminalType

const CACHE_KEY = 'claude_cli_pty_models_cache'
// Version 1 was populated by a parser for Claude Code's pre-2.1.252 terminal
// UI. Do not present that stale data as a confirmed result after its parser no
// longer reaches /model.
const SNAPSHOT_VERSION = 3
const COLS = 120
const ROWS = 40
const TIMING = { probeTimeoutMs: 15000, quietMs: 900, pollMs: 300, submenuTimeoutMs: 4000 }

export function __setProbeTimingForTests(overrides: Partial<typeof TIMING> | null): void {
  if (!overrides) Object.assign(TIMING, { probeTimeoutMs: 15000, quietMs: 900, pollMs: 300, submenuTimeoutMs: 4000 })
  else Object.assign(TIMING, overrides)
}

export type CliModelOption = { id: string; label: string }
export type ClaudeCliModelSource = 'cli-menu-confirmed' | 'legacy-candidate' | 'validated'
export type ClaudeCliModelChoice = CliModelOption & { source: ClaudeCliModelSource }

// These are full, active API IDs from Anthropic's published model-status catalogue, not an
// assertion that any particular Claude Code subscription may use them. Claude Code documents
// full IDs through --model but does not expose a structured entitlement listing, so each of
// these is verified locally before it becomes a normal selectable CLI model.
// Source: https://platform.claude.com/docs/en/about-claude/model-deprecations
const OFFICIAL_LEGACY_CANDIDATES: readonly CliModelOption[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

type LegacyValidationState = 'validated' | 'unavailable' | 'pending'
type LegacyValidationRecord = { state: LegacyValidationState; attemptedAt: string; reason?: string }
export type ClaudeCliDiscoveryResult =
  | { status: 'success'; models: CliModelOption[]; attemptedAt: string; source: 'pty-menu'; cliVersion?: string }
  | { status: 'partial'; models: CliModelOption[]; attemptedAt: string; source: 'pty-menu'; reason: string; cliVersion?: string }
  | { status: 'failed'; models: []; attemptedAt: string; source: 'pty-menu'; reason: string; cliVersion?: string }

/** Persisted independently of Anthropic BYOK data. `models` is selectable only after success. */
export type ClaudeCliModelSnapshot = {
  version: typeof SNAPSHOT_VERSION
  models: CliModelOption[]
  completedAt: string | null
  lastAttemptAt: string
  cliVersion: string | null
  lastFailure: { status: 'partial' | 'failed'; reason: string; attemptedAt: string } | null
  legacyCandidates: Record<string, LegacyValidationRecord>
}

function result(status: ClaudeCliDiscoveryResult['status'], models: CliModelOption[], reason?: string, cliVersion?: string): ClaudeCliDiscoveryResult {
  const base = { models, attemptedAt: new Date().toISOString(), source: 'pty-menu' as const }
  if (status === 'success') return { ...base, status, cliVersion }
  if (status === 'partial') return { ...base, status, reason: reason ?? 'The additional-models submenu did not finish loading', cliVersion }
  return { ...base, status: 'failed', models: [], reason: reason ?? 'Claude Code did not expose a readable model menu', cliVersion }
}

function snapshotGrid(term: TerminalType): string {
  const lines: string[] = []
  for (let i = 0; i < term.rows; i++) lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? '')
  return lines.join('\n')
}

const MORE_MODELS_PATTERN = /^\s*(?:[>❯]\s*)?(\d+)\.\s+(?:more models|show more models|additional models)\b/i

function parseModelMenu(grid: string): { models: CliModelOption[]; moreModelsRow: string | null } {
  const models: CliModelOption[] = []
  let moreModelsRow: string | null = null
  // Claude Code 2.1.252 changed the prompt and the selected-row marker from
  // `❯` to `>`, and renders a selected item as `Opus √`. Keep this deliberately
  // tolerant because the menu is a presentation surface, not an API.
  const rowPattern = /^\s*(?:[>❯]\s*)?\d+\.\s+(\S.*?)\s{2,}(.+)$/
  for (const rawLine of grid.split('\n')) {
    const line = rawLine.replace(/[✔√]/g, '').trimEnd()
    const moreMatch = MORE_MODELS_PATTERN.exec(line)
    if (moreMatch) { moreModelsRow = moreMatch[1]; continue }
    // This is an explicit non-selectable row in the current Claude Code menu,
    // e.g. "Fable 5.1 (disabled)  Update to 2.1.255+ to use Fable 5.1".
    if (/\(disabled\)/i.test(line)) continue
    const match = rowPattern.exec(line)
    if (!match) continue
    const alias = match[1].trim()
    if (/^Default\b/i.test(alias)) continue
    const label = match[2].split('·')[0]?.trim()
    if (label) models.push({ id: alias.toLowerCase(), label })
  }
  return { models, moreModelsRow }
}

let inFlightProbe: Promise<ClaudeCliDiscoveryResult> | null = null

/** Best-effort source adapter; an official structured Claude Code listing can replace it later. */
export function probeClaudeCliModels(): Promise<ClaudeCliDiscoveryResult> {
  if (inFlightProbe) return inFlightProbe
  inFlightProbe = runProbe().finally(() => { inFlightProbe = null })
  return inFlightProbe
}

async function runProbe(): Promise<ClaudeCliDiscoveryResult> {
  const claudePath = resolveCliPath('claude')
  if (!claudePath) return result('failed', [], 'Claude CLI was not found')
  return new Promise((resolve) => {
    let settled = false
    let ptyProcess: IPty | null = null
    let checker: ReturnType<typeof setInterval> | null = null
    let hardTimeout: ReturnType<typeof setTimeout> | null = null
    const finish = (discovery: ClaudeCliDiscoveryResult) => {
      if (settled) return
      settled = true
      if (checker) clearInterval(checker)
      if (hardTimeout) clearTimeout(hardTimeout)
      try { ptyProcess?.write('\x1b') } catch { /* ignored */ }
      try { ptyProcess?.kill() } catch { /* ignored */ }
      resolve(discovery)
    }
    try {
      const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true })
      ptyProcess = ptySpawn(claudePath, ['--strict-mcp-config'], {
        name: 'xterm-color', cols: COLS, rows: ROWS, cwd: app.getPath('temp'), env: buildCliChildEnv() as Record<string, string>,
      })
      let lastDataAt = Date.now()
      let stage: 'settle' | 'awaiting-menu' | 'awaiting-submenu' = 'settle'
      let topLevelModels: CliModelOption[] = []
      let moreModelsRowNum: string | null = null
      let submenuRequestedAt = 0
      let submenuRetried = false
      let cliVersion: string | undefined
      ptyProcess.onData((chunk) => { lastDataAt = Date.now(); term.write(chunk) })
      ptyProcess.onExit(() => finish(result('failed', [], 'Claude CLI exited before model discovery completed', cliVersion)))
      checker = setInterval(() => {
        if (Date.now() - lastDataAt < TIMING.quietMs) return
        const grid = snapshotGrid(term)
        cliVersion ??= /Claude Code\s+v?(\d+\.\d+\.\d+)/i.exec(grid)?.[1]
        if (stage === 'settle') {
          if (/trust this folder/i.test(grid)) ptyProcess?.write('\r')
          else if (/New MCP server found/i.test(grid)) ptyProcess?.write('\x1b')
          // Claude Code 2.1.252+ displays a conventional `>` input prompt and
          // no longer prints "for shortcuts". Older builds use `❯`.
          else if (/^\s*(?:❯|>)\s*(?:$|Try\b)/m.test(grid) || grid.includes('for shortcuts')) { stage = 'awaiting-menu'; ptyProcess?.write('/model\r') }
        } else if (stage === 'awaiting-menu' && /(?:Select model|More models)/i.test(grid)) {
          const parsed = parseModelMenu(grid)
          if (parsed.models.length === 0) finish(result('failed', [], 'Claude Code rendered an unrecognised or empty model menu', cliVersion))
          else if (!parsed.moreModelsRow) finish(result('success', parsed.models, undefined, cliVersion))
          else {
            topLevelModels = parsed.models
            moreModelsRowNum = parsed.moreModelsRow
            stage = 'awaiting-submenu'
            submenuRequestedAt = Date.now()
            ptyProcess?.write(`${moreModelsRowNum}\r`)
          }
        } else if (stage === 'awaiting-submenu') {
          if (lastDataAt > submenuRequestedAt && /(?:Select model|More models)/i.test(grid)) {
            const merged = [...topLevelModels]
            for (const model of parseModelMenu(grid).models) if (!merged.some((known) => known.id === model.id)) merged.push(model)
            if (merged.length > topLevelModels.length || submenuRetried) finish(result('success', merged, undefined, cliVersion))
            else if (Date.now() - submenuRequestedAt >= TIMING.submenuTimeoutMs) {
              submenuRetried = true; submenuRequestedAt = Date.now(); ptyProcess?.write(`${moreModelsRowNum}\r`)
            }
          } else if (Date.now() - submenuRequestedAt >= TIMING.submenuTimeoutMs) {
            if (submenuRetried) finish(result('partial', topLevelModels, undefined, cliVersion))
            else { submenuRetried = true; submenuRequestedAt = Date.now(); ptyProcess?.write(`${moreModelsRowNum}\r`) }
          }
        }
      }, TIMING.pollMs)
      hardTimeout = setTimeout(() => finish(result('failed', [], 'Timed out waiting for Claude Code model menu', cliVersion)), TIMING.probeTimeoutMs)
    } catch {
      finish(result('failed', [], 'Could not start Claude CLI model discovery'))
    }
  })
}

function normalizeModels(value: unknown): CliModelOption[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.filter((entry): entry is CliModelOption => !!entry && typeof entry === 'object'
    && typeof (entry as CliModelOption).id === 'string' && typeof (entry as CliModelOption).label === 'string')
    .filter((model) => !!model.id && !seen.has(model.id) && !!seen.add(model.id))
}

function emptySnapshot(): ClaudeCliModelSnapshot {
  return { version: SNAPSHOT_VERSION, models: [], completedAt: null, lastAttemptAt: '', cliVersion: null, lastFailure: null, legacyCandidates: {} }
}

function normalizeLegacyCandidates(value: unknown): Record<string, LegacyValidationRecord> {
  if (!value || typeof value !== 'object') return {}
  const officialIds = new Set(OFFICIAL_LEGACY_CANDIDATES.map((candidate) => candidate.id))
  const normalized: Record<string, LegacyValidationRecord> = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!officialIds.has(id) || !entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<LegacyValidationRecord>
    if ((candidate.state !== 'validated' && candidate.state !== 'unavailable' && candidate.state !== 'pending') || typeof candidate.attemptedAt !== 'string') continue
    normalized[id] = {
      state: candidate.state,
      attemptedAt: candidate.attemptedAt,
      ...(typeof candidate.reason === 'string' ? { reason: candidate.reason } : {}),
    }
  }
  return normalized
}

export function getCachedClaudeCliModelSnapshot(): ClaudeCliModelSnapshot {
  try {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(CACHE_KEY) as { value: string } | undefined
    if (!row) return emptySnapshot()
    const parsed: unknown = JSON.parse(row.value)
    // A version-1 snapshot may have been produced by the obsolete prompt
    // detector. It was never a confirmed result, so wait for this parser to
    // complete rather than keeping an inaccurate model list visible.
    if (Array.isArray(parsed)) return emptySnapshot()
    if (!parsed || typeof parsed !== 'object') return emptySnapshot()
    const value = parsed as Partial<ClaudeCliModelSnapshot>
    // Version 2 was the first trustworthy menu snapshot. Preserve it while adding the
    // validation map so an app upgrade does not briefly hide already-confirmed models before
    // the launch probe completes. Version 1 remains deliberately invalid (see above).
    const persistedVersion = (parsed as { version?: unknown }).version
    if (persistedVersion !== SNAPSHOT_VERSION && persistedVersion !== 2) return emptySnapshot()
    const failure = value.lastFailure
    return {
      version: SNAPSHOT_VERSION, models: normalizeModels(value.models),
      completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
      lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : '',
      cliVersion: typeof value.cliVersion === 'string' ? value.cliVersion : null,
      lastFailure: failure && typeof failure === 'object' && (failure.status === 'partial' || failure.status === 'failed')
        && typeof failure.reason === 'string' && typeof failure.attemptedAt === 'string' ? failure : null,
      legacyCandidates: normalizeLegacyCandidates(value.legacyCandidates),
    }
  } catch { return emptySnapshot() }
}

export function getCachedClaudeCliPtyModels(): CliModelOption[] {
  const snapshot = getCachedClaudeCliModelSnapshot()
  const validated = OFFICIAL_LEGACY_CANDIDATES.filter((candidate) => snapshot.legacyCandidates[candidate.id]?.state === 'validated')
  return [...snapshot.models, ...validated.filter((candidate) => !snapshot.models.some((model) => model.id === candidate.id))]
}

/** Models shown in the picker. Legacy choices are deliberately marked until a local CLI check succeeds. */
export function getClaudeCliModelChoices(): ClaudeCliModelChoice[] {
  const snapshot = getCachedClaudeCliModelSnapshot()
  const confirmed = snapshot.models.map((model) => ({ ...model, source: 'cli-menu-confirmed' as const }))
  const legacy = OFFICIAL_LEGACY_CANDIDATES
    .filter((candidate) => !snapshot.models.some((model) => model.id === candidate.id))
    .filter((candidate) => snapshot.legacyCandidates[candidate.id]?.state !== 'unavailable')
    .map((candidate) => ({
      ...candidate,
      source: snapshot.legacyCandidates[candidate.id]?.state === 'validated' ? 'validated' as const : 'legacy-candidate' as const,
    }))
  return [...confirmed, ...legacy]
}

export function isClaudeCliLegacyCandidate(model: string): boolean {
  const snapshot = getCachedClaudeCliModelSnapshot()
  return OFFICIAL_LEGACY_CANDIDATES.some((candidate) => candidate.id === model)
    && !snapshot.models.some((candidate) => candidate.id === model)
}

export function isClaudeCliModelOrCandidate(model: string): boolean {
  return getClaudeCliModelChoices().some((candidate) => candidate.id === model)
}

/** A complete list replaces prior entries; partial and failed attempts preserve them. */
export function cacheClaudeCliDiscovery(discovery: ClaudeCliDiscoveryResult): boolean {
  try {
    const db = getDatabase()
    const previous = getCachedClaudeCliModelSnapshot()
    const next: ClaudeCliModelSnapshot = discovery.status === 'success'
      ? { ...previous, models: normalizeModels(discovery.models), completedAt: discovery.attemptedAt, lastAttemptAt: discovery.attemptedAt, cliVersion: discovery.cliVersion ?? previous.cliVersion, lastFailure: null }
      : { ...previous, lastAttemptAt: discovery.attemptedAt, cliVersion: discovery.cliVersion ?? previous.cliVersion, lastFailure: { status: discovery.status, reason: discovery.reason, attemptedAt: discovery.attemptedAt } }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CACHE_KEY, JSON.stringify(next))
    return discovery.status === 'success' && JSON.stringify(previous.models) !== JSON.stringify(next.models)
  } catch { return false }
}

/** Compatibility helper for callers that already hold a complete list. */
export function cacheClaudeCliPtyModels(models: CliModelOption[]): boolean {
  return cacheClaudeCliDiscovery(result('success', models))
}

function shortReason(error: unknown, stdout = '', stderr = ''): string {
  const raw = [stderr, stdout, error instanceof Error ? error.message : ''].find((value) => value.trim())?.trim() ?? 'Claude Code did not confirm this model'
  return raw.replace(/\s+/g, ' ').slice(0, 280)
}

function isExplicitModelRejection(reason: string): boolean {
  return /(?:model .*?(?:not found|not available|unsupported|does not exist)|invalid model|unknown model|access (?:to )?this model|not entitled|not authorized)/i.test(reason)
}

export type ClaudeCliLegacyValidationResult = { ok: boolean; changed: boolean; reason?: string }
let legacyValidationInFlight = new Map<string, Promise<ClaudeCliLegacyValidationResult>>()

/**
 * Validates an official legacy candidate only after the user actually tries to use it. The
 * request is tool-free, runs in the temp directory, and uses Claude Code's own signed-in
 * session. This intentionally consumes one small Claude request; there is no free entitlement
 * check in Claude Code.
 */
export function validateClaudeCliLegacyCandidate(model: string): Promise<ClaudeCliLegacyValidationResult> {
  if (!isClaudeCliLegacyCandidate(model)) return Promise.resolve({ ok: true, changed: false })
  const current = legacyValidationInFlight.get(model)
  if (current) return current
  const validation = runLegacyValidation(model).finally(() => legacyValidationInFlight.delete(model))
  legacyValidationInFlight.set(model, validation)
  return validation
}

async function runLegacyValidation(model: string): Promise<ClaudeCliLegacyValidationResult> {
  const snapshot = getCachedClaudeCliModelSnapshot()
  const previous = snapshot.legacyCandidates[model]
  if (previous?.state === 'validated') return { ok: true, changed: false }
  if (previous?.state === 'unavailable') return { ok: false, changed: false, reason: previous.reason ?? 'Claude Code has marked this model unavailable for this account' }
  const claudePath = resolveCliPath('claude')
  if (!claudePath) return { ok: false, changed: false, reason: 'Claude CLI was not found' }

  const outcome = await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
    execFile(claudePath, [
      '--print', '--output-format', 'json', '--strict-mcp-config', '--model', model,
      'Reply with exactly: OK',
    ], {
      cwd: app.getPath('temp'),
      env: buildCliChildEnv(),
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (!error && typeof stdout === 'string' && stdout.trim()) resolve({ ok: true })
      else resolve({ ok: false, reason: shortReason(error, stdout ?? '', stderr ?? '') })
    })
  })
  const attemptedAt = new Date().toISOString()
  const record: LegacyValidationRecord = outcome.ok
    ? { state: 'validated', attemptedAt }
    : { state: isExplicitModelRejection(outcome.reason ?? '') ? 'unavailable' : 'pending', attemptedAt, reason: outcome.reason }
  const next: ClaudeCliModelSnapshot = {
    ...snapshot,
    legacyCandidates: { ...snapshot.legacyCandidates, [model]: record },
  }
  try {
    getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CACHE_KEY, JSON.stringify(next))
  } catch {
    return { ok: false, changed: false, reason: 'Could not save Claude Code model validation' }
  }
  return { ok: outcome.ok, changed: previous?.state !== record.state, reason: outcome.reason }
}
