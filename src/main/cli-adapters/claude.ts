import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { createServer } from 'http'
import type { BrowserWindow } from 'electron'
import { startUserInputMcpBridge } from '../user-input-mcp-bridge'
import { startDeferMcpBridge } from '../defer-mcp-bridge'
import { startPlanMcpBridge } from '../plan-mcp-bridge'
import { consumeChainDepthHint } from '../deferred-callbacks'
import type { CliAgentAdapter, CliAdapterRequest } from './types'
import { resolveCliPath, killProcess, createLineBuffer, createOpenBlockTracker, buildCliChildEnv, createInactivityWatchdog, CLI_INACTIVITY_TIMEOUT_MS } from './utils'
import { extractCitations } from '../../shared/citations'
import { isClaudeCliLegacyCandidate, validateClaudeCliLegacyCandidate } from './claude-model-probe'

type ClaudeContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'thinking'; thinking?: string; text?: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id?: string; content?: unknown; is_error?: boolean }
  | { type: string; text?: string; content?: unknown; tool_use_id?: string; is_error?: boolean }

function textFromClaudeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'text' &&
        typeof (block as Record<string, unknown>).text === 'string'
      ) {
        return [(block as { text: string }).text]
      }
      return []
    })
    .join('')
}

function buildConversationText(req: CliAdapterRequest): string {
  const parts: string[] = []
  for (const msg of req.messages) {
    const role = msg.role === 'user' ? '[User]' : '[Assistant]'
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    parts.push(`${role}: ${content}`)
  }
  return parts.join('\n\n')
}

function buildConversationJson(req: CliAdapterRequest): string {
  const lines: string[] = []

  for (let i = 0; i < req.messages.length; i++) {
    const msg = req.messages[i]
    if (msg.role === 'system') continue
    const role = msg.role === 'user' ? 'user' : 'assistant'
    const isLast = i === req.messages.length - 1

    const textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

    const contentBlocks: unknown[] = [{ type: 'text', text: textContent }]

    // Attach images to the last user message
    if (isLast && role === 'user' && req.images && req.images.length > 0) {
      for (const img of req.images) {
        const mediaType = img.dataUrl.startsWith('data:image/png') ? 'image/png'
          : img.dataUrl.startsWith('data:image/webp') ? 'image/webp'
          : img.dataUrl.startsWith('data:image/gif') ? 'image/gif'
          : 'image/jpeg'
        const comma = img.dataUrl.indexOf(',')
        if (comma === -1) continue
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: img.dataUrl.slice(comma + 1) },
        })
      }
    }

    lines.push(JSON.stringify({ type: role, message: { role, content: contentBlocks } }))
  }

  return lines.join('\n')
}

async function startPermissionHookServer(
  requestPermission: NonNullable<CliAdapterRequest['requestPermission']>,
): Promise<{ url: string; close: () => void }> {
  const hookPath = `/permission/${randomUUID()}`
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== hookPath) {
      response.writeHead(404).end()
      return
    }

    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      // Permission payloads are tiny. Cap input so a malformed/local caller cannot
      // make the desktop process retain an unbounded request body.
      if (body.length <= 1024 * 1024) body += chunk
    })
    request.on('end', () => {
      void (async () => {
        let approved = false
        let toolName = 'Claude CLI tool'
        try {
          const payload = JSON.parse(body) as { tool_name?: unknown; tool_input?: unknown }
          if (typeof payload.tool_name === 'string' && payload.tool_name.trim()) {
            toolName = payload.tool_name
          }
          const input = payload.tool_input && typeof payload.tool_input === 'object'
            ? payload.tool_input as Record<string, unknown>
            : {}
          approved = await requestPermission(toolName, input)
        } catch {
          // Invalid hook input or a failed UI bridge is denied safely.
          approved = false
        }

        const decision = approved
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: 'The user did not approve this action in Nexy.' }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision,
          },
        }))
      })()
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to start Claude permission bridge'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${address.port}${hookPath}`,
        close: () => server.close(),
      })
    })
  })
}

export const ClaudeAdapter: CliAgentAdapter = {
  name: 'claude-cli',

  isAvailable(): boolean {
    return resolveCliPath('claude') !== null
  },

  async send(
    _window: BrowserWindow | undefined,
    req: CliAdapterRequest,
    onChunk: (chunk: string, blockId?: string) => void,
    onEvent?: Parameters<CliAgentAdapter['send']>[3],
    signal?: AbortSignal
  ): Promise<string> {
    // Claude Code has no machine-readable entitlement endpoint for full legacy IDs. The picker
    // labels these official candidates clearly; the user's first real use opts into this small,
    // tool-free verification request. Only a success promotes the candidate into the normal
    // Claude CLI model cache, and an explicit rejection removes it from future picker results.
    if (req.model && isClaudeCliLegacyCandidate(req.model)) {
      const validation = await validateClaudeCliLegacyCandidate(req.model)
      if (validation.changed) _window?.webContents.send('model:cli-models-updated')
      if (!validation.ok) {
        throw new Error(`Claude Code could not verify ${req.model}: ${validation.reason ?? 'this model is unavailable for your account'}`)
      }
    }
    // Bypass mode must not install Nexy's PermissionRequest hook: Claude invokes hooks as
    // policy gates, so retaining one here can reintroduce an approval/denial path even though
    // the user explicitly selected "Bypass".
    const bypassPermissions = req.permissionMode === 'bypassPermissions'
    const permissionHook = req.requestPermission && !bypassPermissions
      ? await startPermissionHookServer(req.requestPermission)
      : null
    let awaitingUserInput = false
    const userInputBridge = req.requestUserInput
      ? await startUserInputMcpBridge(req.requestUserInput, (waiting) => { awaitingUserInput = waiting })
      : null
    // Gives the turn a Nexy-owned alternative to a raw background shell command: a long job
    // started through it is tracked in `deferred_callbacks` and reported into this conversation
    // whenever it finishes, rather than only being visible to a session that may have already
    // ended. `consumeChainDepthHint` carries the depth forward when this turn is itself the
    // follow-up to an earlier fired/orphaned callback, so a self-resolving loop still hits
    // MAX_CHAIN_DEPTH instead of arming indefinitely. Opt-in (like the other bridges above) so a
    // caller that hasn't wired a conversation up for this — direct adapter tests, for one — isn't
    // forced to pay for a loopback server it has no use for.
    const deferBridge = req.deferredJobsEnabled
      ? await startDeferMcpBridge({
          conversationId: req.conversationId,
          cwd: req.cwd,
          chainDepth: consumeChainDepthHint(req.conversationId),
        })
      : null
    const planBridge = req.permissionMode === 'plan' && req.requestPlanApproval
      ? await startPlanMcpBridge(req.requestPlanApproval)
      : null
    return new Promise((resolve, reject) => {
      const claudePath = resolveCliPath('claude')
      if (!claudePath) {
        permissionHook?.close()
        userInputBridge?.close()
        deferBridge?.close()
        planBridge?.close()
        reject(new Error('claude CLI not found'))
        return
      }

      const hasImages = (req.images?.length ?? 0) > 0
      const useJsonInput = hasImages
      // Always pass --strict-mcp-config so the CLI ignores any MCP servers registered
      // in the user's global ~/.claude.json. We control exactly which servers are
      // available via --mcp-config (or none at all when no servers are permitted).
      const args = ['--output-format', 'stream-json', '--print', '--verbose', '--strict-mcp-config']
      if (req.systemPrompt || userInputBridge || deferBridge || planBridge) {
        const userInputInstruction = userInputBridge
          ? '\n\nWhen essential information is missing, call nexy_user_input.ask_user and wait for the answer. Do not use AskUserQuestion because Nexy cannot render that native tool in --print mode.'
          : ''
        const deferInstruction = deferBridge
          ? '\n\nFor any shell command that might run longer than this reply (a build, a long test run, a slow install), ' +
            'call nexy_defer.run_and_notify instead of waiting on it directly. It starts the command and returns immediately; ' +
            'Nexy reports the result into this conversation when it finishes, even after this session ends or Nexy restarts. ' +
            "Do not promise to 'check back later' yourself — you cannot keep that promise, only nexy_defer can."
          : ''
        const planInstruction = planBridge
          ? '\n\nWhen you have completed the implementation plan, call nexy_plan.exit_plan_mode with the complete Markdown plan. Do not attempt to use the native ExitPlanMode tool: it is unavailable in this non-interactive session. Do not call this tool for clarifying questions or an incomplete plan.'
          : ''
        args.push('--system-prompt', `${req.systemPrompt ?? ''}${userInputInstruction}${deferInstruction}${planInstruction}`)
      }
      if (req.agents && Object.keys(req.agents).length > 0) {
        args.push('--agents', JSON.stringify(req.agents))
      }
      if (req.model && req.model !== 'default') {
        args.push('--model', req.model)
      }
      if (req.thinkingEffort && req.thinkingEffort !== 'disabled') {
        const effortMap: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'max' }
        const cliEffort = effortMap[req.thinkingEffort]
        if (cliEffort) args.push('--effort', cliEffort)
      }
      const effectiveMcpServers = [...(req.mcpServers ?? []), ...(userInputBridge ? [userInputBridge.server] : []), ...(deferBridge ? [deferBridge.server] : []), ...(planBridge ? [planBridge.server] : [])]
      if (effectiveMcpServers.length > 0) {
        const mcpConfig = {
          mcpServers: Object.fromEntries(effectiveMcpServers.map((server) => {
            const config: Record<string, unknown> = {
              command: server.command,
              args: server.args,
            }
            if (server.env && Object.keys(server.env).length > 0) config.env = server.env
            if (server.cwd) config.cwd = server.cwd
            return [server.key, config]
          })),
        }
        args.push('--mcp-config', JSON.stringify(mcpConfig))
      }
      const effectiveAllowedTools = [...(req.allowedTools ?? []), ...(userInputBridge ? [userInputBridge.allowedTool] : []), ...(deferBridge ? [deferBridge.allowedTool] : []), ...(planBridge ? [planBridge.allowedTool] : [])]
      if (effectiveAllowedTools.length > 0) {
        args.push('--allowedTools', effectiveAllowedTools.join(','))
      }
      if (userInputBridge) {
        args.push('--disallowedTools', 'AskUserQuestion')
      }
      if (req.extraAllowedDirs && req.extraAllowedDirs.length > 0) {
        for (const dir of req.extraAllowedDirs) {
          args.push('--add-dir', dir)
        }
      }
      if (permissionHook) {
        args.push('--settings', JSON.stringify({
          hooks: {
            PermissionRequest: [{
              matcher: '.*',
              hooks: [{
                type: 'http',
                url: permissionHook.url,
                timeout: 65,
                statusMessage: 'Waiting for approval in Nexy',
              }],
            }],
          },
        }))
      }
      // Explicit per-conversation permission mode wins over the coarse skipPermissions boolean —
      // e.g. a chat put in plan mode must stay read-only even if the agent default auto-approves.
      const CLAUDE_PERMISSION_MODES = ['plan', 'acceptEdits', 'bypassPermissions']
      if (req.permissionMode && CLAUDE_PERMISSION_MODES.includes(req.permissionMode)) {
        args.push('--permission-mode', req.permissionMode)
        if (req.permissionMode === 'bypassPermissions') {
          // Use Claude's explicit non-interactive bypass flag as well as the named mode.
          // This keeps `--print` sessions from falling back to an unavailable terminal
          // approval prompt on CLI versions that distinguish selection from activation.
          args.push('--dangerously-skip-permissions')
          console.warn(`[WARN] Agent is running with --permission-mode bypassPermissions. All file and shell operations will execute without confirmation.`)
        }
      } else if (req.skipPermissions === true) {
        args.push('--dangerously-skip-permissions')
        console.warn(`[WARN] Agent is running with --dangerously-skip-permissions. All file and shell operations will execute without confirmation.`)
      }
      if (useJsonInput) {
        args.push('--input-format', 'stream-json')
      }

      // --verbose is required when combining --output-format stream-json with --print
      let proc: ReturnType<typeof spawn>
      try {
        proc = spawn(claudePath, args, {
          cwd: req.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          env: buildCliChildEnv(),
        })
      } catch (error) {
        permissionHook?.close()
        userInputBridge?.close()
        deferBridge?.close()
        planBridge?.close()
        reject(error)
        return
      }

      // Single-settle plumbing: the watchdog, abort, spawn error and close paths can all
      // race to end the turn. Guard so the promise resolves/rejects once and the permission
      // hook server (and its port) is reclaimed exactly once — a hung turn must not orphan it.
      let settled = false
      let hookClosed = false
      const closeHook = () => { if (!hookClosed) { hookClosed = true; permissionHook?.close(); userInputBridge?.close(); deferBridge?.close(); planBridge?.close() } }
      const watchdog = createInactivityWatchdog(CLI_INACTIVITY_TIMEOUT_MS, () => {
        if (awaitingUserInput) {
          watchdog.touch()
          return
        }
        onEvent?.({ type: 'activity', label: 'Claude CLI timed out (no output).' })
        killProcess(proc)
        settle(() => reject(new Error(`claude produced no output for ${Math.round(CLI_INACTIVITY_TIMEOUT_MS / 60000)} minutes and was stopped`)))
      })
      function settle(run: () => void): void {
        if (settled) return
        settled = true
        watchdog.clear()
        closeHook()
        run()
      }

      const stdinContent = useJsonInput ? buildConversationJson(req) : buildConversationText(req)
      proc.stdin!.end(stdinContent, 'utf8')

      if (signal) {
        signal.addEventListener('abort', () => { killProcess(proc) }, { once: true })
      }

      let fullText = ''
      let stderrText = ''
      // Track whether the current assistant message received per-token delta events.
      // Claude follows those deltas with a consolidated `assistant` event carrying the
      // same content. These flags are reset after that event so a later assistant message
      // (for example after a tool call) can independently use batch or delta delivery.
      let receivedDeltas = false
      // Same per-assistant-message duplication risk for streamed thinking blocks.
      let receivedThinkingDeltas = false
      const openToolIds = new Set<string>()
      // The Anthropic content-block index resets to 0 for every new `assistant` message,
      // and one CLI turn can emit several such messages as it works through tool calls —
      // so a later, unrelated reasoning burst that happens to land at index 0 again would
      // otherwise collide with an earlier one under the same blockId (`claude-reasoning-0`) and
      // silently merge into it. Track reasoning as an "open block" instead: it's reused
      // across consecutive thinking events, but any other event in between (text, a tool
      // call) or an explicit end closes it, so the next reasoning burst gets a fresh id.
      // Keep the provider in the ID because Claude CLI models can emit visible thinking
      // blocks selectively (Haiku does this more often than Sonnet). The renderer uses
      // this identity to keep Claude CLI reasoning in the compact CLI-style timeline.
      const reasoningBlocks = createOpenBlockTracker('claude-reasoning')
      const nextReasoningBlockId = (): string => reasoningBlocks.next()
      const interruptReasoning = () => reasoningBlocks.interrupt()

      // Same "open block" tracking as reasoning, but for plain response text — a turn
      // that says something, calls a tool, then says more, produces two separate text
      // bursts so the caller can position them on either side of the tool call instead
      // of concatenating them into one blob shown only once the whole turn is done.
      const textBlocks = createOpenBlockTracker('text')
      const nextTextBlockId = (): string => textBlocks.next()
      // Unlike reasoning, the caller actually needs to know a text block just closed —
      // without an explicit signal, a renderer watching the live stream can't tell "this
      // is the only segment so far, but it's finished" from "this is still being typed",
      // and would wrongly keep deferring an already-closed lead-in sentence to the very
      // end of the turn instead of showing it ahead of the tool call that interrupted it.
      const interruptText = () => {
        if (!textBlocks.current) return
        onEvent?.({ type: 'text_end', blockId: textBlocks.current })
        textBlocks.interrupt()
      }

      proc.stderr?.on('data', (chunk: Buffer) => {
        // Keep only the tail — stderr is used for error detail, not accumulated wholesale,
        // so a chatty CLI cannot grow this without bound.
        stderrText = (stderrText + chunk.toString('utf8')).slice(-16384)
      })

      const parseLine = (line: string) => {
        if (!line.trim()) return
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          const citations = extractCitations(obj)
          if (citations.length > 0) onEvent?.({ type: 'citations', citations })
          // Claude CLI stream-json: complete assistant message.
          // Only emit chunks here when no content_block_delta events arrived
          // (i.e. CLI is operating in batch mode). When deltas are streaming
          // this event duplicates the same text so we skip the onChunk call
          // but still fire tool_start events from it.
          if (obj.type === 'assistant' && obj.message) {
            const content = ((obj.message as { content?: ClaudeContentBlock[] }).content ?? []) as ClaudeContentBlock[]
            for (let i = 0; i < content.length; i++) {
              const block = content[i]
              if (block.type === 'thinking') {
                // Only emit here when no thinking_delta events streamed this burst already
                // (batch mode) — otherwise this consolidated block duplicates the same text.
                if (!receivedThinkingDeltas) {
                  const blockId = nextReasoningBlockId()
                  const thinkingText = (block as { type: 'thinking'; thinking?: string; text?: string }).thinking ?? block.text ?? ''
                  // Emit chunk before end — no async boundary between them (H6).
                  if (thinkingText) onEvent?.({ type: 'thinking_chunk', blockId, chunk: thinkingText })
                  onEvent?.({ type: 'thinking_end', blockId })
                }
                // This block resolved atomically (chunk + end emitted together above), so
                // any further thinking — even later in this same message — is a new burst.
                interruptReasoning()
                interruptText()
              }
              if (block.type === 'text' && block.text) {
                if (!receivedDeltas) {
                  // Same atomic-block reasoning as thinking above: each batch text block
                  // is a complete, standalone burst.
                  const blockId = nextTextBlockId()
                  onChunk(block.text, blockId)
                  fullText += block.text
                  interruptText()
                }
                interruptReasoning()
              }
              if (block.type === 'tool_use' && 'id' in block && 'name' in block) {
                openToolIds.add(block.id)
                onEvent?.({
                  type: 'tool_start',
                  id: block.id,
                  name: block.name,
                  input: 'input' in block ? (block.input ?? {}) : {},
                })
                interruptReasoning()
                interruptText()
              }
            }
            // The consolidated event closes the delta/batch deduplication scope. A single
            // CLI process can emit more assistant messages after tool calls or plan-mode
            // transitions, and those messages must choose their delivery mode independently.
            receivedDeltas = false
            receivedThinkingDeltas = false
          }
          if (obj.type === 'user' && obj.message) {
            const content = ((obj.message as { content?: ClaudeContentBlock[] }).content ?? []) as ClaudeContentBlock[]
            for (const block of content) {
              if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
              openToolIds.delete(block.tool_use_id)
              onEvent?.({
                type: 'tool_end',
                id: block.tool_use_id,
                content: textFromClaudeContent(block.content),
                isError: !!block.is_error,
              })
              interruptReasoning()
              interruptText()
            }
          }
          if (obj.type === 'tool_result') {
            if (typeof obj.tool_use_id === 'string') {
              openToolIds.delete(obj.tool_use_id)
              onEvent?.({
                type: 'tool_end',
                id: obj.tool_use_id,
                content: textFromClaudeContent(obj.content),
                isError: !!obj.is_error,
              })
              interruptReasoning()
              interruptText()
            }
          }
          if (obj.type === 'result') {
            const usage = typeof obj.usage === 'object' && obj.usage !== null
              ? (obj.usage as Record<string, unknown>)
              : null
            onEvent?.({
              type: 'cost',
              totalCostUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : 0,
              inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0,
              outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0,
              ...(typeof obj.uuid === 'string' ? { requestId: obj.uuid } : {}),
            })
          }
          // Per-token streaming delta format (used when --verbose outputs raw API events)
          if (obj.type === 'content_block_delta' && obj.delta) {
            const delta = obj.delta as Record<string, unknown>
            if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              receivedThinkingDeltas = true
              const blockId = nextReasoningBlockId()
              onEvent?.({ type: 'thinking_chunk', blockId, chunk: delta.thinking })
              interruptText()
            } else if (typeof delta.text === 'string') {
              receivedDeltas = true
              const blockId = nextTextBlockId()
              onChunk(delta.text, blockId)
              fullText += delta.text
              interruptReasoning()
            }
          }
          if (obj.type === 'content_block_stop') {
            // Only fires thinking_end when a reasoning block is actually open — the old
            // index-based lookup fired a (harmless but spurious) thinking_end for every
            // content block's stop event, including text/tool blocks that never opened one.
            if (reasoningBlocks.current) {
              onEvent?.({ type: 'thinking_end', blockId: reasoningBlocks.current })
              interruptReasoning()
            }
            // Whatever content block just stopped — text or otherwise — any open text
            // burst is done; the next text delta (if any) starts a new one.
            interruptText()
          }
        } catch {
          // non-JSON lines — ignore
        }
      }

      const lineBuffer = createLineBuffer(parseLine)
      proc.stdout!.on('data', (chunk: Buffer) => {
        watchdog.touch()
        lineBuffer.push(chunk)
      })

      proc.on('error', (error) => {
        settle(() => reject(error))
      })
      proc.on('close', (code) => {
        if (settled) return
        if (lineBuffer.remainder().trim()) {
          const trimmed = lineBuffer.remainder().trim()
          try {
            JSON.parse(trimmed)
            parseLine(trimmed)
          } catch {
            // Unterminated non-JSON line — emit as raw text fallback (M1).
            onChunk(trimmed)
            fullText += trimmed
          }
        }
        if (reasoningBlocks.current) {
          onEvent?.({ type: 'thinking_end', blockId: reasoningBlocks.current })
          interruptReasoning()
        }
        interruptText()
        for (const id of openToolIds) {
          onEvent?.({
            type: 'tool_end',
            id,
            content: '',
            isError: code !== 0,
          })
        }
        openToolIds.clear()
        if (fullText === '' && planBridge?.submittedPlan()) {
          settle(() => resolve(planBridge.submittedPlan()!))
        } else if (fullText === '') {
          const detail = stderrText.trim() ? `: ${stderrText.trim()}` : ''
          const codeNote = code !== 0 ? ` (exit ${code})` : ''
          settle(() => reject(new Error(`claude returned an empty response${codeNote}${detail}`)))
        } else {
          settle(() => resolve(fullText))
        }
      })
    })
  },
}
