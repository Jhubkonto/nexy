import type { BrowserWindow } from 'electron'
import { AcpStdioConnection } from './acp-stdio'
import type { CliAdapterRequest, CliAgentAdapter, CliStreamEvent } from './types'
import { buildCliChildEnv, createOpenBlockTracker, resolveCliPath } from './utils'
import { debugLog } from '../debug-mode'
import { recordErrorLogEntry } from '../error-log-handlers'
import { listHermesProfiles, resolveHermesRoot } from '../cli-detection'
import { extractCitations } from '../../shared/citations'

// Local-model Hermes profiles run vision/aux capability probes against the configured endpoint
// during session bootstrap, so `session/new` legitimately takes tens of seconds (observed ~28s
// against a local vLLM). The stdio default of 30s is far too tight for that and produces spurious
// "Hermes ACP request timed out: session/new" failures. Give bootstrap a generous ceiling; the
// actual turn (`session/prompt`) keeps its own 10-minute budget below.
const HERMES_INITIALIZE_TIMEOUT_MS = 60 * 1000
const HERMES_SESSION_NEW_TIMEOUT_MS = 5 * 60 * 1000
const HERMES_CANCEL_GRACE_MS = 1_000
const HERMES_IDLE_SESSION_TTL_MS = 30 * 60 * 1000

/**
 * Always-on persistent diagnostic for the Hermes ACP lifecycle. Unlike {@link debugLog} (gated
 * behind debug mode and lost on restart), this writes to the `error_log` table so a user reporting
 * "Hermes does nothing" has a durable, retention-pruned trail of spawn/handshake/timeout events —
 * on desktop and, via the relayed error message, visible on the Android companion too.
 */
function logHermes(level: 'info' | 'error', message: string): void {
  debugLog('cli', message)
  recordErrorLogEntry({ source: 'main', level, message: `[hermes-acp] ${message}` })
}

type Session = {
  id: string
  cwd: string
  model: string
  profile: string
  connection: AcpStdioConnection
  onChunk?: (chunk: string, blockId?: string) => void
  onEvent?: (event: CliStreamEvent) => void
  chunks: string[]
  lastTextBlockId?: string
  lastThinkingBlockId?: string
  trackers: Map<string, ReturnType<typeof createOpenBlockTracker>>
  busy: boolean
  lastUsedAt: number
}
type ContentBlock = { type?: string; text?: string; data?: string; mimeType?: string }

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(textFromContent).join('')
  if (content && typeof content === 'object') {
    const block = content as ContentBlock
    return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
  }
  return ''
}

function imageContent(dataUrl: string): ContentBlock | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  return match ? { type: 'image', mimeType: match[1], data: match[2] } : null
}

export class HermesAcpAdapter implements CliAgentAdapter {
  readonly name = 'hermes-cli'
  private readonly sessions = new Map<string, Session>()
  private readonly conversationKeys = new Map<string, string>()
  private readonly idleCleanupTimer: NodeJS.Timeout

  constructor() {
    this.idleCleanupTimer = setInterval(() => this.closeIdleSessions(), 60_000)
    if (typeof this.idleCleanupTimer.unref === 'function') this.idleCleanupTimer.unref()
  }

  isAvailable(): boolean { return resolveCliPath('hermes') !== null }

  async send(
    _window: BrowserWindow | undefined,
    req: CliAdapterRequest,
    onChunk: (chunk: string, blockId?: string) => void,
    onEvent?: (event: CliStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    this.closeIdleSessions()
    const executable = resolveCliPath('hermes')
    if (!executable) throw new Error('hermes CLI not found')
    const requestedProfile = req.hermesProfile?.trim()
    let profile = requestedProfile || 'default'
    // 4.1 — Graceful unknown profile: if a specific profile was requested but no longer
    // exists on disk (deleted/renamed in the Hermes CLI after it was set on the agent),
    // warn and fall back to `default` rather than letting the ACP spawn fail with a raw,
    // unexplained error. `default` is always synthesized by listHermesProfiles().
    if (requestedProfile && requestedProfile !== 'default') {
      const known = listHermesProfiles().some((p) => p.name === requestedProfile)
      if (!known) {
        onEvent?.({ type: 'activity', label: `Hermes profile "${requestedProfile}" not found — using default` })
        debugLog('cli', `hermes ACP: profile "${requestedProfile}" not found on disk, falling back to default`)
        profile = 'default'
      }
    }
    const useProfileFlag = profile !== 'default'
    const fingerprint = this.sessionFingerprint(req, profile)
    const key = `${req.conversationId}:${fingerprint}`
    // A conversation may have only one live Hermes process.  Closing the old one here is
    // important: a changed system prompt, MCP set, or approval mode is a hard boundary,
    // not merely a different cache key that can leave privileged state running in the back.
    const previousKey = this.conversationKeys.get(req.conversationId)
    if (previousKey && previousKey !== key) {
      const previous = this.sessions.get(previousKey)
      if (previous) this.invalidateSession(previousKey, previous)
    }
    let session = this.sessions.get(key)
    if (!session) {
      const args = useProfileFlag ? ['--profile', profile, 'acp'] : ['acp']
      // Do not put project paths into the durable diagnostic log. Profile and argument details
      // are enough to diagnose launch selection without leaking the user's workspace location.
      logHermes('info', `spawn Hermes ACP (profile=${profile}, args=${args.join(' ')})`)
      // Assigned after bootstrap completes, but captured by the notification callback below
      // (which only fires later), so it is intentionally forward-declared.
      let activeSession: Session | undefined
      const connection = new AcpStdioConnection(
        executable,
        args,
        req.cwd,
        (message) => this.handleNotification(message, activeSession),
        (message) => this.handleRequest(message, req),
        // Discovery, model lookup, and the child must resolve the same Hermes root. This
        // matters when HERMES_HOME was inherited as a profile directory.
        buildCliChildEnv({ HERMES_HOME: resolveHermesRoot(), HERMES_ACP_SKIP_CONFIGURED_MCP: '1' }),
      )
      const bootstrapStartedAt = Date.now()
      try {
        const init = await connection.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'nexy', title: 'Nexy', version: '1.0.0' },
        }, HERMES_INITIALIZE_TIMEOUT_MS) as { protocolVersion?: number }
        if (init.protocolVersion !== 1) {
          throw new Error(`Hermes ACP protocol version ${init.protocolVersion ?? 'unknown'} is unsupported`)
        }
        const mcpServers = (req.mcpServers ?? []).map((server) => ({
          name: server.key || server.id,
          command: server.command,
          args: server.args,
          env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
        }))
        const created = await connection.request('session/new', {
          cwd: req.cwd,
          model: req.model,
          mcpServers,
          ...(req.extraAllowedDirs?.length ? { additionalDirectories: req.extraAllowedDirs } : {}),
        }, HERMES_SESSION_NEW_TIMEOUT_MS) as { sessionId?: string }
        if (!created.sessionId) {
          throw new Error('Hermes ACP did not return a session ID')
        }
        logHermes('info', `session/new ok in ${Date.now() - bootstrapStartedAt}ms (profile=${profile}, id=${created.sessionId})`)
        session = {
          id: created.sessionId,
          cwd: req.cwd,
          model: req.model,
          profile,
          connection,
          chunks: [],
          trackers: new Map(),
          busy: false,
          lastUsedAt: Date.now(),
        }
        activeSession = session
        this.sessions.set(key, session)
        this.conversationKeys.set(req.conversationId, key)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const stderr = connection.recentStderr()
        logHermes('error', `session bootstrap failed after ${Date.now() - bootstrapStartedAt}ms (profile=${profile}): ${detail}${stderr ? ` | stderr: ${stderr.slice(-1500)}` : ''}`)
        connection.close()
        throw error
      }
    }

    if (session.busy) {
      throw new Error('Hermes is already processing a message in this conversation')
    }
    session.busy = true
    session.lastUsedAt = Date.now()
    session.lastTextBlockId = undefined
    session.lastThinkingBlockId = undefined
    session.trackers.clear()
    const text = this.promptText(req)
    const prompt: ContentBlock[] = [{ type: 'text', text }]
    if (req.images) for (const image of req.images) {
      const content = imageContent(image.dataUrl)
      if (content) prompt.push(content)
    }
    session.onChunk = onChunk
    session.onEvent = onEvent
    session.chunks = []
    const sessionConnection = session.connection
    let cancelTimer: NodeJS.Timeout | undefined
    const abort = () => {
      // ACP cancellation is cooperative.  If Hermes (or a tool it launched) ignores it,
      // force-close the process tree and make this session permanently unusable.
      sessionConnection.notify('session/cancel', { sessionId: session!.id })
      this.detachSession(key, session!)
      cancelTimer = setTimeout(() => sessionConnection.close(), HERMES_CANCEL_GRACE_MS)
      if (typeof cancelTimer.unref === 'function') cancelTimer.unref()
    }
    if (signal?.aborted) throw new Error('Hermes ACP turn cancelled')
    signal?.addEventListener('abort', abort, { once: true })
    try {
      await sessionConnection.request('session/prompt', { sessionId: session.id, prompt }, 10 * 60 * 1000)
      if (signal?.aborted) throw new Error('Hermes ACP turn cancelled')
      if (session.lastTextBlockId) session.onEvent?.({ type: 'text_end', blockId: session.lastTextBlockId })
      if (session.lastThinkingBlockId) session.onEvent?.({ type: 'thinking_end', blockId: session.lastThinkingBlockId })
      return session.chunks.join('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const stderr = session.connection.recentStderr()
      logHermes('error', `session/prompt failed (profile=${profile}): ${detail}${stderr ? ` | stderr: ${stderr.slice(-1500)}` : ''}`)
      this.invalidateSession(key, session)
      throw error
    } finally {
      if (cancelTimer) clearTimeout(cancelTimer)
      signal?.removeEventListener('abort', abort)
      session.onChunk = undefined
      session.onEvent = undefined
      session.busy = false
      session.lastUsedAt = Date.now()
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.connection.close()
    this.sessions.clear()
    this.conversationKeys.clear()
  }

  private closeIdleSessions(): void {
    const cutoff = Date.now() - HERMES_IDLE_SESSION_TTL_MS
    for (const [key, session] of this.sessions) {
      if (!session.busy && session.lastUsedAt < cutoff) this.invalidateSession(key, session)
    }
  }

  private promptText(req: CliAdapterRequest): string {
    const last = req.messages[req.messages.length - 1]
    const prompt = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '')
    return req.systemPrompt ? `[System]: ${req.systemPrompt}\n\n${prompt}` : prompt
  }

  private handleNotification(
    message: { method?: string; params?: Record<string, unknown> },
    session: Session | undefined,
  ): void {
    if (message.method !== 'session/update') return
    const update = message.params?.update as Record<string, unknown> | undefined
    if (!update) return
    const citations = extractCitations(update)
    if (citations.length > 0) session?.onEvent?.({ type: 'citations', citations })
    const kind = update.sessionUpdate
    const tracker = session ? this.getTracker(session, update) : undefined
    if (kind === 'agent_message_chunk') {
      const text = textFromContent(update.content)
      if (text && session?.onChunk && tracker) {
        const blockId = tracker.next()
        session.chunks.push(text)
        session.lastTextBlockId = blockId
        session.onChunk(text, blockId)
      }
    } else if (kind === 'agent_thought_chunk') {
      const text = textFromContent(update.content)
      if (text && session && tracker) {
        const blockId = tracker.next()
        session.lastThinkingBlockId = blockId
        session.onEvent?.({ type: 'thinking_chunk', blockId, chunk: text })
      }
    } else if (kind === 'tool_call') {
      tracker?.interrupt()
      session?.onEvent?.({ type: 'tool_start', id: String(update.toolCallId ?? `tool-${Date.now()}`), name: String(update.title ?? 'Hermes tool'), input: (update.rawInput as Record<string, unknown>) ?? {} })
    } else if (kind === 'tool_call_update') {
      const content = textFromContent(update.content)
      const status = String(update.status ?? '')
      if (content) session?.onEvent?.({ type: 'activity', label: content.slice(-500) })
      if (status === 'completed' || status === 'failed') session?.onEvent?.({ type: 'tool_end', id: String(update.toolCallId ?? ''), content, isError: status === 'failed' })
    } else if (kind === 'usage_update') {
      const cost = update.cost as { amount?: number; currency?: string } | undefined
      // ACP's historical `used` field is not defined as input tokens; it may represent a
      // context budget, a running total, or provider-specific accounting. Only accept the
      // explicit fields proposed by the Hermes ACP usage contract.
      const inputTokens = typeof update.inputTokens === 'number'
        ? update.inputTokens
        : typeof update.input_tokens === 'number' ? update.input_tokens : undefined
      const outputTokens = typeof update.outputTokens === 'number'
        ? update.outputTokens
        : typeof update.output_tokens === 'number' ? update.output_tokens : undefined
      if (inputTokens != null && outputTokens != null) {
        session?.onEvent?.({
          type: 'cost',
          totalCostUsd: cost?.currency === 'USD' && typeof cost.amount === 'number' ? cost.amount : 0,
          inputTokens,
          outputTokens,
        })
      }
    }
  }

  private getTracker(session: Session, update: Record<string, unknown>) {
    const id = String(update.messageId ?? update.toolCallId ?? 'turn')
    let tracker = session.trackers.get(id)
    if (!tracker) { tracker = createOpenBlockTracker(`hermes-${id}`); session.trackers.set(id, tracker) }
    return tracker
  }

  private sessionFingerprint(req: CliAdapterRequest, profile: string): string {
    // Do not use this value for logs: it can contain MCP environment values. It only becomes an
    // in-memory map key that prevents state crossing a changed security/context boundary.
    return JSON.stringify({
      profile,
      hermesRoot: resolveHermesRoot(),
      cwd: req.cwd,
      model: req.model,
      systemPrompt: req.systemPrompt ?? '',
      permissionMode: req.permissionMode ?? '',
      skipPermissions: Boolean(req.skipPermissions),
      extraAllowedDirs: req.extraAllowedDirs ?? [],
      mcpServers: (req.mcpServers ?? []).map(({ id, key: serverKey, command, args, env, cwd }) => ({ id, serverKey, command, args, env, cwd })),
    })
  }

  private invalidateSession(key: string, session: Session): void {
    this.detachSession(key, session)
    session.connection.close()
  }

  private detachSession(key: string, session: Session): void {
    if (this.sessions.get(key) === session) this.sessions.delete(key)
    // Session IDs are vendor-opaque, not conversation IDs. Clear the owner by map value.
    for (const [conversationId, conversationKey] of this.conversationKeys) {
      if (conversationKey === key) this.conversationKeys.delete(conversationId)
    }
  }

  private async handleRequest(message: { method?: string; params?: Record<string, unknown> }, req: CliAdapterRequest): Promise<unknown> {
    if (message.method !== 'session/request_permission') throw new Error(`Unsupported Hermes ACP request: ${message.method ?? 'unknown'}`)
    const params = message.params ?? {}
    const toolCall = (params.toolCall ?? {}) as Record<string, unknown>
    const options = Array.isArray(params.options) ? params.options as Array<Record<string, unknown>> : []
    const allow = options.find((option) => String(option.kind ?? '') === 'allow_once')
    const deny = options.find((option) => String(option.kind ?? '') === 'deny')
    const input = (toolCall.rawInput ?? toolCall.input ?? {}) as Record<string, unknown>
    const allowed = req.skipPermissions
      ? true
      : req.requestPermission ? await req.requestPermission(String(toolCall.title ?? 'Hermes tool'), input) : false
    // A boolean Nexy approval can grant a single action only. Never widen it to an
    // allow-session/allow-always option supplied by an agent.
    if (allowed && allow) return { outcome: { outcome: 'selected', optionId: String(allow.optionId) } }
    if (deny) return { outcome: { outcome: 'selected', optionId: String(deny.optionId) } }
    return { outcome: { outcome: 'cancelled' } }
  }
}

export const HermesAcpAdapterInstance = new HermesAcpAdapter()
