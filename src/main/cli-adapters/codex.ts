import { spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { UserInputQuestion } from '../../shared/chat-turn-types'
import type { CliAgentAdapter, CliAdapterRequest } from './types'
import { resolveCliPath, killProcess, stripAnsi, createLineBuffer, buildCliChildEnv, createInactivityWatchdog, CLI_INACTIVITY_TIMEOUT_MS } from './utils'
import { extractCitations } from '../../shared/citations'

type TextResult = { text: string; isDelta: boolean; blockId?: string; done?: boolean }
type ThinkingResult = { text: string; done?: boolean; isDelta: boolean }

function extractText(line: string): TextResult | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    const eventBlockId = (...values: unknown[]): string | undefined =>
      values.find((value): value is string => typeof value === 'string' && value.length > 0)

    // Streaming text delta (Responses API style)
    if (obj.type === 'response.content_part.delta') {
      const delta = obj.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text' && typeof delta.text === 'string') {
        return {
          text: delta.text,
          isDelta: true,
          blockId: eventBlockId(obj.item_id, obj.itemId, delta.item_id, delta.itemId),
        }
      }
    }
    if (obj.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
      return {
        text: obj.delta,
        isDelta: true,
        blockId: eventBlockId(obj.item_id, obj.itemId),
      }
    }

    // Complete assistant message (Responses API style)
    if (obj.type === 'response.output_item.done') {
      const item = obj.item as Record<string, unknown> | undefined
      if (item?.role === 'assistant' && Array.isArray(item.content)) {
        const text = (item.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('')
        if (text) return {
          text,
          isDelta: false,
          blockId: eventBlockId(item.id, obj.item_id, obj.itemId),
          done: true,
        }
      }
    }

    // Codex exec JSONL: agent_message_delta
    if (obj.type === 'agent_message_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined
      if (typeof delta?.text === 'string' && delta.text) {
        return {
          text: delta.text,
          isDelta: true,
          blockId: eventBlockId(obj.item_id, obj.itemId, delta.item_id, delta.itemId),
        }
      }
    }

    // Codex exec JSONL: final agent_message
    if (obj.type === 'agent_message') {
      const msg = obj.message as Record<string, unknown> | undefined
      if (Array.isArray(msg?.content)) {
        const text = (msg!.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('')
        if (text) return {
          text,
          isDelta: false,
          blockId: eventBlockId(msg.id, obj.item_id, obj.itemId),
          done: true,
        }
      }
      if (typeof msg?.text === 'string' && msg.text) {
        return {
          text: msg.text,
          isDelta: false,
          blockId: eventBlockId(msg.id, obj.item_id, obj.itemId),
          done: true,
        }
      }
    }

    // Codex exec JSONL: item.completed with an agent_message payload.
    if (obj.type === 'item.completed') {
      const item = obj.item as Record<string, unknown> | undefined
      if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text) {
        return {
          text: item.text,
          isDelta: false,
          blockId: eventBlockId(item.id),
          done: true,
        }
      }
      if (item?.role === 'assistant' && Array.isArray(item.content)) {
        const text = (item.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('')
        if (text) return {
          text,
          isDelta: false,
          blockId: eventBlockId(item.id),
          done: true,
        }
      }
    }

    // Generic: any object with role=assistant
    if (obj.role === 'assistant') {
      if (typeof obj.text === 'string' && obj.text) {
        return { text: obj.text, isDelta: false, blockId: eventBlockId(obj.id), done: true }
      }
      if (Array.isArray(obj.content)) {
        const text = (obj.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('')
        if (text) return { text, isDelta: false, blockId: eventBlockId(obj.id), done: true }
      }
    }
  } catch {
    // not JSON
  }
  return null
}

function extractError(line: string): string | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (obj.type === 'turn.failed') {
      const err = obj.error as Record<string, unknown> | undefined
      return typeof err?.message === 'string' ? normalizeErrorMessage(err.message) : 'Codex turn failed'
    }
    if (obj.type === 'error' && typeof obj.message === 'string') {
      return normalizeErrorMessage(obj.message)
    }
  } catch { /* non-JSON line — skip */ }
  return null
}

// Known API format variants for reasoning summary delta events (M2).
// Listed in priority order — first match wins.
const REASONING_DELTA_TYPES = new Set([
  'response.reasoning_summary_text.delta', // Responses API latest
  'response.reasoning_summary.delta',       // Responses API earlier
  'reasoning_summary_delta',                // Codex exec JSONL
])
const REASONING_DONE_TYPES = new Set([
  'response.reasoning_summary_text.done',
  'response.reasoning_summary.done',
  'reasoning_summary_done',
])

function extractThinking(line: string): ThinkingResult | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    const type = typeof obj.type === 'string' ? obj.type : ''

    if (REASONING_DELTA_TYPES.has(type)) {
      const delta = obj.delta
      if (typeof delta === 'string' && delta) return { text: delta, isDelta: true }
      const deltaRecord = asRecord(delta)
      if (typeof deltaRecord?.text === 'string' && deltaRecord.text) {
        return { text: deltaRecord.text, isDelta: true }
      }
    }

    if (REASONING_DONE_TYPES.has(type)) {
      return { text: '', done: true, isDelta: true }
    }

    if (type === 'item.completed') {
      const item = asRecord(obj.item)
      if (item?.type === 'reasoning' || item?.type === 'reasoning_summary') {
        const text = textFromUnknown(item.summary ?? item.content ?? item.text ?? '')
        // Consolidated (non-delta) reasoning payload — the caller only emits this when
        // no reasoning_summary deltas already streamed the same text, to avoid duplicating it.
        if (text) return { text, done: true, isDelta: false }
      }
    }
  } catch {
    // not JSON
  }
  return null
}

// A transient status line — never persisted, just surfaces as the live "Thinking…"
// indicator. Item lifecycle narration (item.started/item.completed) is deliberately
// excluded here: every non-reasoning, non-agent_message item is now a formal
// tool_start/tool_end event (see extractToolEvent) so it renders as a persistent
// ToolCallBlock instead of a transient line that vanishes once the turn ends.
function extractActivity(line: string): { text: string } | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    const type = typeof obj.type === 'string' ? obj.type : ''

    if (type === 'thread.started') return { text: 'Started Codex session.' }
    if (type === 'turn.started') return { text: 'Started Codex turn.' }
    if (type === 'turn.completed') return { text: 'Codex turn completed.' }
    if (type === 'turn.failed') {
      const err = obj.error as Record<string, unknown> | undefined
      const message = typeof err?.message === 'string' ? normalizeErrorMessage(err.message) : 'Codex turn failed'
      return { text: `Codex turn failed: ${message}` }
    }
    if (type === 'error') {
      const message = typeof obj.message === 'string' ? normalizeErrorMessage(obj.message) : 'Codex reported an error'
      return { text: `Codex error: ${message}` }
    }
  } catch {
    // not JSON
  }
  return null
}

// Human-friendly labels for Codex's native (non-MCP) item types. Anything not
// listed falls back to the raw itemType string.
const ITEM_TYPE_LABELS: Record<string, string> = {
  command_execution: 'Run Command',
  local_shell_call: 'Run Command',
  file_change: 'Edit File',
  patch_apply: 'Edit File',
  web_search_call: 'Web Search',
  web_search: 'Web Search',
}

// Fields that describe the item's identity/outcome rather than its input — everything
// else on the item (command, cwd, path, diff, query, arguments, ...) is surfaced as the
// tool call's input so the ToolCallBlock shows whatever Codex actually reported.
const ITEM_NON_INPUT_KEYS = new Set(['id', 'type', 'status', 'output', 'result', 'error', 'content', 'name', 'tool_name', 'tool'])

function normalizeErrorMessage(message: string): string {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>
    const nestedError = parsed.error as Record<string, unknown> | undefined
    if (typeof nestedError?.message === 'string') return nestedError.message
    if (typeof parsed.message === 'string') return parsed.message
  } catch { /* not nested JSON */ }
  return message
}

function extractCost(line: string): { inputTokens: number; outputTokens: number; requestId?: string } | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (obj.type === 'response.done') {
      const response = obj.response as Record<string, unknown> | undefined
      const usage = response?.usage as Record<string, unknown> | undefined
      if (usage) {
        return {
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
          ...(typeof response?.id === 'string' ? { requestId: response.id } : {}),
        }
      }
    }
    if (obj.type === 'turn.completed') {
      const usage = obj.usage as Record<string, unknown> | undefined
      if (usage) {
        return {
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
          ...(typeof obj.id === 'string' ? { requestId: obj.id } : {}),
        }
      }
    }
  } catch { /* non-JSON line — skip */ }
  return null
}

function extractTurnTerminal(line: string): 'completed' | 'failed' | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (obj.type === 'turn.completed') return 'completed'
    if (obj.type === 'turn.failed') return 'failed'
  } catch { /* non-JSON line — skip */ }
  return null
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key)
    ? key
    : tomlString(key)
}

function buildCodexMcpConfigArgs(req: CliAdapterRequest): string[] {
  if (!req.mcpServers || req.mcpServers.length === 0) return []

  const args: string[] = []
  for (const server of req.mcpServers) {
    const prefix = `mcp_servers.${tomlKey(server.key)}`
    args.push('-c', `${prefix}.command=${tomlString(server.command)}`)
    if (server.args.length > 0) {
      args.push('-c', `${prefix}.args=${tomlStringArray(server.args)}`)
    }
    if (server.cwd) {
      args.push('-c', `${prefix}.cwd=${tomlString(server.cwd)}`)
    }
    if (server.env && Object.keys(server.env).length > 0) {
      for (const [key, value] of Object.entries(server.env)) {
        args.push('-c', `${prefix}.env.${tomlKey(key)}=${tomlString(value)}`)
      }
    }

    const enabledTools = (req.allowedTools ?? [])
      .flatMap((toolName) => {
        const mcpPrefix = `mcp__${server.key}__`
        return toolName.startsWith(mcpPrefix) ? [toolName.slice(mcpPrefix.length)] : []
      })
    if (enabledTools.length > 0) {
      args.push('-c', `${prefix}.enabled_tools=${tomlStringArray(enabledTools)}`)
    }
    // Nexy filters mcpServers to servers approved for this turn before invoking the
    // adapter. Codex treats the tool allow-list and the server's approval policy as
    // separate controls, so carry that approval across explicitly. Without this,
    // headless `codex exec` cancels the MCP call because it has no UI in which to ask.
    args.push('-c', `${prefix}.default_tools_approval_mode=${tomlString('approve')}`)
  }

  return args
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(textFromUnknown).filter(Boolean).join('\n')
  }
  const record = asRecord(value)
  if (!record) return ''
  if (typeof record.text === 'string') return record.text
  if (typeof record.content === 'string') return record.content
  if (typeof record.output === 'string') return record.output
  if (typeof record.result === 'string') return record.result
  return JSON.stringify(value)
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  if (record) return record
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return asRecord(parsed) ?? { value }
    } catch {
      return { value }
    }
  }
  return {}
}

function extractToolEvent(line: string):
  | { phase: 'start'; id: string; name: string; input: Record<string, unknown> }
  | { phase: 'end'; id: string; content: string; isError: boolean }
  | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (obj.type !== 'item.started' && obj.type !== 'item.completed') return null

    const item = asRecord(obj.item)
    if (!item) return null
    const itemType = typeof item.type === 'string' ? item.type : ''
    // agent_message (final text) and reasoning (thinking blocks) have their own handlers
    // above — every other item type (command_execution, file_change, mcp_tool_call,
    // web_search_call, ...) is a formal tool call so it renders as a persistent
    // ToolCallBlock instead of disappearing once the turn ends.
    if (!itemType || itemType === 'agent_message' || itemType === 'reasoning' || itemType === 'reasoning_summary') {
      return null
    }

    const id = typeof item.id === 'string' ? item.id : `${itemType}-${Date.now()}`
    if (obj.type === 'item.started') {
      const name =
        typeof item.name === 'string' ? item.name
          : typeof item.tool_name === 'string' ? item.tool_name
          : typeof item.tool === 'string' ? item.tool
          : ITEM_TYPE_LABELS[itemType] ?? itemType

      const explicitInput = objectFromUnknown(item.arguments ?? item.input ?? item.args)
      const input = Object.keys(explicitInput).length > 0
        ? explicitInput
        : Object.fromEntries(Object.entries(item).filter(([key]) => !ITEM_NON_INPUT_KEYS.has(key)))

      return { phase: 'start', id, name, input }
    }

    return {
      phase: 'end',
      id,
      content: textFromUnknown(item.output ?? item.result ?? item.content ?? item.aggregated_output ?? item.error ?? ''),
      isError: item.status === 'failed' || item.status === 'error' || Boolean(item.error),
    }
  } catch {
    return null
  }
}

type AppServerMessage = {
  id?: string | number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { message?: string }
}

function codexSandboxMode(permissionMode?: string): 'read-only' | 'workspace-write' | 'danger-full-access' | undefined {
  return permissionMode === 'read-only' || permissionMode === 'workspace-write' || permissionMode === 'danger-full-access'
    ? permissionMode
    : undefined
}

// The app-server JSONL protocol has no built-in liveness signal: if Codex never emits
// another message (stuck on an approval round-trip, a stalled model call, etc.) the
// promise below would otherwise never settle and the chat UI spins forever. Kill the
// process and reject once this much time passes with no stdout activity at all.
const PLAN_INACTIVITY_TIMEOUT_MS = 4 * 60 * 1000

/**
 * `codex exec` does not expose collaboration modes. Explicit Plan turns therefore use the
 * app-server JSONL protocol while ordinary turns stay on the stable exec path below.
 */
function sendCodexPlanViaAppServer(
  req: CliAdapterRequest,
  onChunk: (chunk: string, blockId?: string) => void,
  onEvent?: Parameters<CliAgentAdapter['send']>[3],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempFiles: string[] = []
    const input: Array<Record<string, unknown>> = []
    const lastMsg = req.messages[req.messages.length - 1]
    let prompt = typeof lastMsg?.content === 'string'
      ? lastMsg.content
      : JSON.stringify(lastMsg?.content ?? '')
    if (req.systemPrompt) {
      prompt = `[System]: ${req.systemPrompt}\n\n${prompt}`
    }
    input.push({ type: 'text', text: prompt })

    for (const image of req.images ?? []) {
      const comma = image.dataUrl.indexOf(',')
      if (comma === -1) continue
      const ext = image.dataUrl.startsWith('data:image/png') ? 'png'
        : image.dataUrl.startsWith('data:image/webp') ? 'webp'
        : image.dataUrl.startsWith('data:image/gif') ? 'gif'
        : 'jpg'
      try {
        const tempPath = join(tmpdir(), `codex-plan-img-${randomUUID()}.${ext}`)
        writeFileSync(tempPath, Buffer.from(image.dataUrl.slice(comma + 1), 'base64'))
        tempFiles.push(tempPath)
        input.push({ type: 'localImage', path: tempPath })
      } catch {
        // Keep the text turn usable when an individual image cannot be materialized.
      }
    }

    const cleanup = () => {
      for (const file of tempFiles) {
        try { unlinkSync(file) } catch { /* best-effort cleanup */ }
      }
    }

    const appServerArgs = ['app-server', '--stdio', ...buildCodexMcpConfigArgs(req)]
    const isWin = process.platform === 'win32'
    const [executable, spawnArgs] = isWin
      ? [process.env.ComSpec || 'cmd.exe', ['/c', 'codex', ...appServerArgs]]
      : [resolveCliPath('codex') ?? 'codex', appServerArgs]
    const proc = spawn(executable, spawnArgs, {
      cwd: req.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: buildCliChildEnv(),
    })

    let stderrText = ''
    let fullText = ''
    let protocolError: string | null = null
    let turnCompleted = false
    let settled = false
    let awaitingUserInput = false
    const streamedTextItems = new Set<string>()
    const openToolIds = new Set<string>()
    const openReasoningIds = new Set<string>()

    const writeMessage = (message: Record<string, unknown>) => {
      proc.stdin?.write(`${JSON.stringify(message)}\n`, 'utf8')
    }
    let lastActivityAt = Date.now()
    const touchActivity = () => { lastActivityAt = Date.now() }
    const watchdog = setInterval(() => {
      if (settled || awaitingUserInput) return
      if (Date.now() - lastActivityAt < PLAN_INACTIVITY_TIMEOUT_MS) return
      onEvent?.({ type: 'activity', label: 'Codex Plan turn timed out (no response).' })
      killProcess(proc)
      finish(new Error('Codex Plan turn timed out: no response from Codex for 4 minutes'))
    }, 10_000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearInterval(watchdog)
      cleanup()
      if (error) reject(error)
      else resolve(fullText)
    }
    const closeInput = () => {
      if (!proc.stdin?.destroyed) proc.stdin?.end()
    }

    const emitToolStart = (item: Record<string, unknown>) => {
      const id = typeof item.id === 'string' ? item.id : `codex-plan-tool-${Date.now()}`
      if (openToolIds.has(id)) return
      const type = typeof item.type === 'string' ? item.type : 'tool'
      if (type === 'agentMessage' || type === 'plan' || type === 'reasoning' || type === 'userMessage') return
      const name =
        type === 'commandExecution' ? 'Run Command'
          : type === 'fileChange' ? 'Edit File'
          : type === 'mcpToolCall' && typeof item.tool === 'string' ? item.tool
          : type
      openToolIds.add(id)
      onEvent?.({
        type: 'tool_start',
        id,
        name,
        input: objectFromUnknown(item.arguments ?? {
          command: item.command,
          cwd: item.cwd,
          changes: item.changes,
        }),
      })
    }

    const emitToolEnd = (item: Record<string, unknown>) => {
      const id = typeof item.id === 'string' ? item.id : ''
      if (!id || !openToolIds.has(id)) return
      openToolIds.delete(id)
      onEvent?.({
        type: 'tool_end',
        id,
        content: textFromUnknown(item.aggregatedOutput ?? item.result ?? item.error ?? ''),
        isError: item.status === 'failed' || item.status === 'error' || Boolean(item.error),
      })
    }

    const handleMessage = (message: AppServerMessage) => {
      if (message.error) {
        protocolError = message.error.message ?? 'Codex app-server request failed'
        closeInput()
        return
      }

      if (message.id === 1 && message.result) {
        writeMessage({ method: 'initialized' })
        writeMessage({
          id: 2,
          method: 'thread/start',
          params: {
            model: req.model && req.model !== 'default' ? req.model : null,
            cwd: req.cwd,
            approvalPolicy: req.skipPermissions === true ? 'never' : 'on-request',
            sandbox: codexSandboxMode(req.permissionMode) ?? null,
            ephemeral: true,
          },
        })
        return
      }

      if (message.id === 2 && message.result) {
        const thread = asRecord(message.result.thread)
        const threadId = typeof thread?.id === 'string' ? thread.id : ''
        const resolvedModel = typeof message.result.model === 'string'
          ? message.result.model
          : req.model
        if (!threadId || !resolvedModel) {
          protocolError = 'Codex app-server did not return a thread id or model'
          closeInput()
          return
        }
        writeMessage({
          id: 3,
          method: 'turn/start',
          params: {
            threadId,
            input,
            collaborationMode: {
              mode: 'plan',
              settings: {
                model: resolvedModel,
                reasoning_effort: req.thinkingEffort === 'disabled' ? null : (req.thinkingEffort ?? null),
                developer_instructions: null,
              },
            },
          },
        })
        return
      }

      const method = message.method ?? ''
      const params = message.params ?? {}

      if (message.id !== undefined && method === 'item/tool/requestUserInput') {
        const requestId = message.id
        const rawQuestions = Array.isArray(params.questions) ? params.questions : []
        const questions: UserInputQuestion[] = rawQuestions.flatMap((raw, index) => {
          const question = asRecord(raw)
          if (!question) return []
          const id = typeof question.id === 'string' ? question.id : `question-${index + 1}`
          const prompt = typeof question.question === 'string'
            ? question.question
            : typeof question.prompt === 'string' ? question.prompt : ''
          if (!prompt) return []
          const options = Array.isArray(question.options)
            ? question.options.flatMap((rawOption, optionIndex) => {
                const option = asRecord(rawOption)
                if (!option || typeof option.label !== 'string') return []
                return [{
                  id: typeof option.id === 'string' ? option.id : option.label || `option-${optionIndex + 1}`,
                  label: option.label,
                  ...(typeof option.description === 'string' ? { description: option.description } : {}),
                }]
              })
            : undefined
          return [{
            id,
            ...(typeof question.header === 'string' ? { header: question.header } : {}),
            prompt,
            ...(options?.length ? { options } : {}),
            selection: question.multiple === true ? 'multiple' : 'single',
            allowFreeText: question.allowFreeText !== false,
          }]
        })
        if (!req.requestUserInput || questions.length === 0) {
          writeMessage({ id: requestId, error: { code: -32601, message: 'Structured user input is unavailable' } })
          return
        }
        awaitingUserInput = true
        touchActivity()
        req.requestUserInput(questions).then((answers) => {
          awaitingUserInput = false
          touchActivity()
          const resultAnswers: Record<string, { answers: string[] }> = {}
          for (const answer of answers) {
            const question = questions.find((candidate) => candidate.id === answer.questionId)
            const selectedLabels = answer.selectedOptionIds.map((optionId) =>
              question?.options?.find((option) => option.id === optionId)?.label ?? optionId)
            resultAnswers[answer.questionId] = {
              answers: [...selectedLabels, ...(answer.text ? [answer.text] : [])],
            }
          }
          writeMessage({ id: requestId, result: { answers: resultAnswers } })
        }).catch(() => {
          awaitingUserInput = false
          touchActivity()
          writeMessage({ id: requestId, error: { code: -32800, message: 'User input cancelled' } })
        })
        return
      }
      if (message.id !== undefined && method === 'mcpServer/elicitation/request') {
        const request = asRecord(params.request) ?? params
        const meta = asRecord(request.meta ?? request._meta ?? params.meta ?? params._meta)
        if (meta?.codex_approval_kind === 'mcp_tool_call') {
          const requestId = message.id
          const serverName = typeof request.serverName === 'string'
            ? request.serverName
            : typeof params.serverName === 'string' ? params.serverName : ''
          const toolName = serverName ? `mcp__${serverName}` : 'mcp'
          const respond = (approved: boolean) => writeMessage({
            id: requestId,
            result: { action: approved ? 'accept' : 'decline', content: null },
          })
          if (req.requestPermission) {
            touchActivity()
            req.requestPermission(toolName, request)
              .then((approved) => { touchActivity(); respond(approved) })
              .catch(() => { touchActivity(); respond(false) })
          } else {
            respond(req.skipPermissions === true)
          }
        }
        return
      }
      if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
        const delta = typeof params.delta === 'string' ? params.delta : ''
        const itemId = typeof params.itemId === 'string' ? params.itemId : method
        if (delta) {
          streamedTextItems.add(itemId)
          onChunk(delta, `codex-plan-${itemId}`)
          fullText += delta
        }
        return
      }
      if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
        const delta = typeof params.delta === 'string' ? params.delta : ''
        const itemId = typeof params.itemId === 'string' ? params.itemId : 'reasoning'
        openReasoningIds.add(itemId)
        if (delta) onEvent?.({ type: 'thinking_chunk', blockId: `codex-plan-reasoning-${itemId}`, chunk: delta })
        return
      }
      if (method === 'item/started') {
        const item = asRecord(params.item)
        if (item) emitToolStart(item)
        return
      }
      if (method === 'item/completed') {
        const item = asRecord(params.item)
        if (!item) return
        const citations = extractCitations(item)
        if (citations.length > 0) onEvent?.({ type: 'citations', citations })
        const itemId = typeof item.id === 'string' ? item.id : ''
        if ((item.type === 'agentMessage' || item.type === 'plan') && !streamedTextItems.has(itemId)) {
          const text = typeof item.text === 'string' ? item.text : ''
          if (text) {
            onChunk(text, `codex-plan-${itemId || 'text'}`)
            fullText += text
          }
        }
        if (item.type === 'agentMessage' || item.type === 'plan') {
          onEvent?.({ type: 'text_end', blockId: `codex-plan-${itemId || 'text'}` })
          if (item.type === 'plan') {
            onEvent?.({ type: 'plan_ready', plan: typeof item.text === 'string' ? item.text : '' })
          }
        } else if (item.type === 'reasoning' && itemId) {
          onEvent?.({ type: 'thinking_end', blockId: `codex-plan-reasoning-${itemId}` })
          openReasoningIds.delete(itemId)
        } else {
          emitToolEnd(item)
        }
        return
      }
      if (method === 'thread/tokenUsage/updated') {
        const tokenUsage = asRecord(params.tokenUsage)
        const last = asRecord(tokenUsage?.last)
        if (last) {
          onEvent?.({
            type: 'cost',
            totalCostUsd: 0,
            inputTokens: typeof last.inputTokens === 'number' ? last.inputTokens : 0,
            outputTokens: typeof last.outputTokens === 'number' ? last.outputTokens : 0,
          })
        }
        return
      }
      if (method === 'error') {
        const error = asRecord(params.error)
        if (params.willRetry !== true) {
          protocolError = typeof error?.message === 'string' ? error.message : 'Codex Plan turn failed'
        }
        return
      }
      if (method === 'turn/completed') {
        const turn = asRecord(params.turn)
        turnCompleted = true
        if (turn?.status === 'failed') {
          const error = asRecord(turn.error)
          protocolError = typeof error?.message === 'string' ? error.message : 'Codex Plan turn failed'
        }
        for (const itemId of openReasoningIds) {
          onEvent?.({ type: 'thinking_end', blockId: `codex-plan-reasoning-${itemId}` })
        }
        openReasoningIds.clear()
        closeInput()
        finish()
        killProcess(proc)
        return
      }

      // App-server approval requests must always receive a response. When Nexy has a live
      // permission bridge wired up (see requestPermission on CliAdapterRequest), route the
      // request through it and let the user answer in real time instead of silently
      // auto-accepting/declining based on the coarse skipPermissions flag.
      if (message.id !== undefined && (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval')) {
        const requestId = message.id
        const toolName = method === 'item/commandExecution/requestApproval' ? 'commandExecution' : 'fileChange'
        const respond = (decision: 'accept' | 'decline') => writeMessage({ id: requestId, result: { decision } })
        if (req.requestPermission) {
          touchActivity()
          req.requestPermission(toolName, params)
            .then((approved) => { touchActivity(); respond(approved ? 'accept' : 'decline') })
            .catch(() => { touchActivity(); respond('decline') })
        } else {
          respond(req.skipPermissions ? 'accept' : 'decline')
        }
      }
    }

    const lineBuffer = createLineBuffer((line) => {
      if (!line.trim()) return
      try {
        handleMessage(JSON.parse(line) as AppServerMessage)
      } catch {
        protocolError = `Invalid Codex app-server response: ${line.slice(0, 200)}`
        closeInput()
      }
    })

    proc.stdout?.on('data', (chunk: Buffer) => { touchActivity(); lineBuffer.push(chunk) })
    proc.stderr?.on('data', (chunk: Buffer) => { stderrText = (stderrText + chunk.toString('utf8')).slice(-16384) })
    proc.on('error', (error) => finish(error))
    proc.on('close', (code) => {
      if (lineBuffer.remainder().trim()) {
        try { handleMessage(JSON.parse(lineBuffer.remainder()) as AppServerMessage) } catch { /* handled below */ }
      }
      for (const id of openToolIds) {
        onEvent?.({ type: 'tool_end', id, content: '', isError: code !== 0 })
      }
      if (protocolError) {
        finish(new Error(`Codex Plan error: ${protocolError}`))
      } else if (!turnCompleted && code !== 0) {
        const detail = stderrText.trim() ? `: ${stderrText.trim()}` : ''
        finish(new Error(`codex app-server exited with code ${code}${detail}`))
      } else {
        finish()
      }
    })

    if (signal) {
      signal.addEventListener('abort', () => {
        killProcess(proc)
        finish(new Error('Codex Plan turn aborted'))
      }, { once: true })
    }

    onEvent?.({ type: 'activity', label: 'Starting Codex Plan mode.' })
    writeMessage({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'nexy', title: 'Nexy', version: '1' },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    })
  })
}

/** Read the configured model from ~/.codex/config.toml if present. */
export function readCodexConfigModel(): string | null {
  try {
    const { readFileSync } = require('fs') as typeof import('fs')
    const tomlPath = join(homedir(), '.codex', 'config.toml')
    const content = readFileSync(tomlPath, 'utf8')
    const match = /^\s*model\s*=\s*["']?([^"'\s\n]+)["']?/m.exec(content)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export const CODEX_DEFAULT_MODELS: { id: string; label: string }[] = [
  { id: 'codex-mini-latest', label: 'Codex Mini (latest)' },
  { id: 'o4-mini', label: 'o4-mini' },
  { id: 'o3', label: 'o3' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
]

export const CodexAdapter: CliAgentAdapter = {
  name: 'codex-cli',

  isAvailable(): boolean {
    return resolveCliPath('codex') !== null
  },

  send(
    _window: BrowserWindow | undefined,
    req: CliAdapterRequest,
    onChunk: (chunk: string, blockId?: string) => void,
    onEvent?: Parameters<CliAgentAdapter['send']>[3],
    signal?: AbortSignal
  ): Promise<string> {
    if (req.executionMode === 'plan') {
      return sendCodexPlanViaAppServer(req, onChunk, onEvent, signal)
    }
    return new Promise((resolve, reject) => {
      if (!CodexAdapter.isAvailable()) {
        reject(new Error('codex CLI not found'))
        return
      }

      // Write images to temp files; codex accepts -i <filepath>
      const tempFiles: string[] = []
      const imageArgs: string[] = []

      if (req.images && req.images.length > 0) {
        for (const img of req.images) {
          const ext = img.dataUrl.startsWith('data:image/png') ? 'png'
            : img.dataUrl.startsWith('data:image/webp') ? 'webp'
            : img.dataUrl.startsWith('data:image/gif') ? 'gif'
            : 'jpg'
          const comma = img.dataUrl.indexOf(',')
          if (comma === -1) continue
          try {
            const tempPath = join(tmpdir(), `codex-img-${randomUUID()}.${ext}`)
            writeFileSync(tempPath, Buffer.from(img.dataUrl.slice(comma + 1), 'base64'))
            tempFiles.push(tempPath)
            imageArgs.push('-i', tempPath)
          } catch {
            // skip image if write fails
          }
        }
      }

      let cleanedUp = false
      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        for (const f of tempFiles) {
          try { unlinkSync(f) } catch { /* best-effort cleanup */ }
        }
      }

      const lastMsg = req.messages[req.messages.length - 1]
      let prompt = typeof lastMsg?.content === 'string'
        ? lastMsg.content
        : JSON.stringify(lastMsg?.content ?? '')

      // Per-conversation Codex sandbox override — real CLI flag, unlike the prompt directive below.
      const CODEX_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access']
      const sandboxMode = req.permissionMode && CODEX_SANDBOX_MODES.includes(req.permissionMode)
        ? req.permissionMode
        : null

      // Embed system prompt as a text prefix to avoid CLI flag escaping issues.
      const effectiveSystemPrompt = req.systemPrompt ?? ''
      if (effectiveSystemPrompt) {
        prompt = `[System]: ${effectiveSystemPrompt}\n\n${prompt}`
      }

      // codex exec: non-interactive subcommand with JSONL output. The prompt is
      // written to stdin below so multi-line chat history never crosses cmd.exe.
      const execArgs = [
        'exec',
        '--json',
        '--ephemeral',
        '--skip-git-repo-check',
        ...buildCodexMcpConfigArgs(req),
        '-C',
        req.cwd,
        ...imageArgs,
      ]
      if (req.summaryOnly) execArgs.push('--config', 'tools.shell=false', '--config', 'web_search="disabled"')
      if (req.model && req.model !== 'default') {
        execArgs.push('--model', req.model)
      }
      if (sandboxMode) {
        execArgs.push('--sandbox', sandboxMode)
      }
      // Approval policy and filesystem sandbox are separate Codex controls. Keep the selected
      // sandbox level intact while disabling approval prompts through Codex's real config,
      // rather than the former advisory system-prompt directive.
      if (req.skipPermissions === true) {
        execArgs.push('--config', 'approval_policy="never"')
      }

      // On Windows, npm global CLIs (.cmd) can't be spawned directly with shell:false.
      // Explicitly invoke cmd.exe so each arg is passed as a proper argv element,
      // and pass the large prompt through stdin to avoid command-line parsing.
      const isWin = process.platform === 'win32'
      const [executable, spawnArgs] = isWin
        ? [process.env.ComSpec || 'cmd.exe', ['/c', 'codex', ...execArgs]]
        : [resolveCliPath('codex') ?? 'codex', execArgs]

      const proc = spawn(executable, spawnArgs, {
        cwd: req.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: buildCliChildEnv(),
      })
      proc.stdin?.end(prompt, 'utf8')

      // `codex exec --json` has no heartbeat: if it wedges (network stall, deadlocked tool)
      // it emits nothing and the turn would hang forever. Settle it after a long total
      // silence — long enough that an honest slow tool run is never mistaken for a hang.
      const watchdog = createInactivityWatchdog(CLI_INACTIVITY_TIMEOUT_MS, () => {
        onEvent?.({ type: 'activity', label: 'Codex CLI timed out (no output).' })
        killProcess(proc)
        settle(null, new Error(`Codex produced no output for ${Math.round(CLI_INACTIVITY_TIMEOUT_MS / 60000)} minutes and was stopped`))
      })

      if (signal) {
        signal.addEventListener('abort', () => { killProcess(proc) }, { once: true })
      }

      let fullText = ''
      let rawStdout = ''
      let stderrText = ''
      let parsedAnyJson = false
      let turnError: string | null = null
      let settled = false
      const endedThinkingBlocks = new Set<string>()
      // The model can reason, call a tool, then reason again — 'codex-reasoning-summary'
      // used to be one fixed blockId for the entire turn, silently merging every burst
      // into a single bubble. Track it as an "open block" instead: reused across
      // consecutive reasoning deltas, but a done signal or an unrelated tool/text event
      // closes it, so the next burst gets a fresh id and its own bubble.
      let reasoningSeq = 0
      let openReasoningBlockId: string | null = null
      let receivedReasoningDeltas = false
      // Codex's approval flow can re-announce the same command_execution/file_change item
      // via a second item.started once the user (or auto-approve) accepts it — without this
      // guard that produced two identical "Run Command" blocks in the timeline for one call.
      const openToolIds = new Set<string>()
      // Codex emits the final answer as several separate agent_message/agent_message_delta
      // bursts — one per stretch of narration between tool calls — rather than one
      // continuous stream. Naively concatenating them runs two sentences together with
      // no space ("...content.The file is missing..."). Track whether a tool call
      // interrupted the text since the last chunk and, if so, insert a paragraph break
      // before the next burst resumes.
      let needsParagraphBreak = false
      let textSeq = 0
      let openTextBlockId: string | null = null
      const textBlocksWithDeltas = new Set<string>()
      const normalizeTextBlockId = (id: string): string =>
        id.startsWith('codex-text-') ? id : `codex-text-${id}`
      const closeOpenTextBlock = () => {
        if (!openTextBlockId) return
        onEvent?.({ type: 'text_end', blockId: openTextBlockId })
        openTextBlockId = null
      }
      const resolveTextBlockId = (eventBlockId?: string): string => {
        const explicitId = eventBlockId ? normalizeTextBlockId(eventBlockId) : null
        if (explicitId && openTextBlockId && explicitId !== openTextBlockId) closeOpenTextBlock()
        if (!openTextBlockId) {
          openTextBlockId = explicitId ?? `codex-text-${textSeq++}`
        }
        return openTextBlockId
      }
      const nextReasoningBlockId = (): string => {
        if (!openReasoningBlockId) openReasoningBlockId = `codex-reasoning-summary-${reasoningSeq++}`
        return openReasoningBlockId
      }

      const emitThinking = (blockId: string, chunk: string, done = false) => {
        if (chunk) {
          onEvent?.({ type: 'thinking_chunk', blockId, chunk })
        }
        if (done && !endedThinkingBlocks.has(blockId)) {
          onEvent?.({ type: 'thinking_end', blockId })
          endedThinkingBlocks.add(blockId)
        }
      }

      onEvent?.({ type: 'activity', label: 'Starting Codex CLI.' })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrText = (stderrText + chunk.toString('utf8')).slice(-16384)
      })

      const parseLine = (line: string) => {
        if (settled) return
        if (!line.trim()) return
        try {
          const parsed = JSON.parse(line)
          const citations = extractCitations(parsed)
          if (citations.length > 0) onEvent?.({ type: 'citations', citations })
          parsedAnyJson = true
        } catch {
          // raw text fallback still applies if the stream never produced JSON
        }

        const errMsg = extractError(line)
        if (errMsg) {
          turnError = errMsg
          onEvent?.({ type: 'activity', label: `Codex error: ${errMsg}` })
          return
        }

        const thinking = extractThinking(line)
        if (thinking) {
          if (thinking.text) {
            closeOpenTextBlock()
            if (fullText) needsParagraphBreak = true
          }
          if (thinking.isDelta) {
            receivedReasoningDeltas = true
            const blockId = nextReasoningBlockId()
            emitThinking(blockId, thinking.text, thinking.done === true)
            if (thinking.done) openReasoningBlockId = null
          } else if (!receivedReasoningDeltas) {
            // Consolidated reasoning item and no deltas streamed this burst already —
            // safe to emit without duplicating text a delta already sent.
            const blockId = nextReasoningBlockId()
            emitThinking(blockId, thinking.text, true)
            openReasoningBlockId = null
          }
          if (thinking.text || thinking.done) return
        }

        const activity = extractActivity(line)
        if (activity) {
          onEvent?.({ type: 'activity', label: activity.text })
        }

        const costData = extractCost(line)
        if (costData) {
          onEvent?.({ type: 'cost', totalCostUsd: 0, ...costData })
          return
        }

        const toolEvent = extractToolEvent(line)
        if (toolEvent) {
          closeOpenTextBlock()
          openReasoningBlockId = null
          if (fullText) needsParagraphBreak = true
          if (toolEvent.phase === 'start') {
            if (!openToolIds.has(toolEvent.id)) {
              openToolIds.add(toolEvent.id)
              onEvent?.({
                type: 'tool_start',
                id: toolEvent.id,
                name: toolEvent.name,
                input: toolEvent.input,
              })
            }
          } else {
            openToolIds.delete(toolEvent.id)
            onEvent?.({
              type: 'tool_end',
              id: toolEvent.id,
              content: toolEvent.content,
              isError: toolEvent.isError,
            })
          }
          return
        }

        const result = extractText(line)
        if (result !== null) {
          parsedAnyJson = true
          turnError = null
          openReasoningBlockId = null
          // Some delta formats omit the item id and only reveal it on the consolidated
          // completion event. In that case the completion still belongs to the currently
          // open block; re-keying it would replay the entire consolidated text.
          const blockId = !result.isDelta && openTextBlockId
            ? openTextBlockId
            : resolveTextBlockId(result.blockId)
          const separator = needsParagraphBreak && result.text && fullText ? '\n\n' : ''
          if (separator) needsParagraphBreak = false
          if (result.isDelta) {
            textBlocksWithDeltas.add(blockId)
            onChunk(result.text, blockId)
            fullText += separator + result.text
          } else if (!textBlocksWithDeltas.has(blockId)) {
            // Keep paragraph spacing in the aggregate response only. A separately rendered
            // segment should start with its first real character, not two synthetic newlines.
            onChunk(result.text, blockId)
            fullText += separator + result.text
          }
          if (result.done) closeOpenTextBlock()
        }
      }

      const settle = (code: number | null, spawnError?: Error) => {
        if (settled) return
        settled = true
        watchdog.clear()
        cleanup()

        if (openReasoningBlockId) {
          emitThinking(openReasoningBlockId, '', true)
          openReasoningBlockId = null
        }
        closeOpenTextBlock()

        const isError = Boolean(spawnError || turnError || (code !== null && code !== 0))
        for (const id of openToolIds) {
          onEvent?.({ type: 'tool_end', id, content: '', isError })
        }
        openToolIds.clear()

        if (!parsedAnyJson && !turnError && rawStdout.trim()) {
          const cleaned = stripAnsi(rawStdout).trim()
          if (cleaned) {
            const blockId = resolveTextBlockId()
            onChunk(cleaned, blockId)
            fullText = cleaned
            closeOpenTextBlock()
          }
        }

        if (spawnError) {
          reject(spawnError)
        } else if (turnError) {
          reject(new Error(`Codex error: ${turnError}`))
        } else if (fullText) {
          resolve(fullText)
        } else if (code !== null && code !== 0) {
          const detail = stderrText.trim() ? `: ${stderrText.trim()}` : ''
          onEvent?.({ type: 'activity', label: `Codex exited with code ${code}${detail}` })
          reject(new Error(`codex exited with code ${code}${detail}`))
        } else {
          resolve(fullText)
        }
      }

      const lineBuffer = createLineBuffer((line) => {
        parseLine(line)
        const terminal = extractTurnTerminal(line)
        if (terminal) settle(terminal === 'completed' ? 0 : 1)
      })
      proc.stdout.on('data', (chunk: Buffer) => {
        watchdog.touch()
        // rawStdout only feeds the raw-text fallback used when the stream never produced
        // any JSON. Once JSON has parsed it is dead weight, so stop accumulating then —
        // that naturally bounds it to the (small) pre-JSON preamble instead of a full copy
        // of every byte the CLI emits.
        if (!parsedAnyJson) rawStdout = (rawStdout + chunk.toString('utf8')).slice(-65536)
        lineBuffer.push(chunk)
      })

      proc.on('error', (err) => {
        settle(null, err)
      })

      proc.on('close', (code) => {
        if (lineBuffer.remainder().trim()) parseLine(lineBuffer.remainder())
        settle(code)
      })
    })
  },
}
