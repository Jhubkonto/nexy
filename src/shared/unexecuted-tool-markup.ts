/** Detect common model-generated tool calls that arrived as text, not tool events. */
export function hasUnexecutedToolMarkup(text: string): boolean {
  return /<tool>\s*<name>[^<]+<\/name>[\s\S]*?<\/tool>/i.test(text)
    || /<(?:bash|shell)>\s*(?:<command>)?[\s\S]*?<\/(?:bash|shell)>/i.test(text)
    || /<[^>]*DSML[^>]*[|｜][^>]*(?:calls|invoke)\b/i.test(text)
}

export interface DsmlToolCall {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Decode a complete terminal DSML block, never a quoted example or partial call.
 * Strings are literal; other values use strict JSON, as specified by DeepSeek:
 * https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/encoding/README.md
 * A malformed member rejects the whole batch so no partial batch can execute.
 */
export function parseDsmlToolCalls(text: string): { content: string | null; toolCalls: DsmlToolCall[] } | null {
  const marker = '[|｜]{1,2}DSML[|｜]{1,2}\\s*'
  const opening = new RegExp(`<${marker}(calls|tool_calls)>`).exec(text)
  if (!opening) return null
  const content = text.slice(0, opening.index)
  // Do not interpret code, blockquotes, HTML, or earlier protocol text as calls.
  if (/[`<>]|~~~|^ {4}|^\t/m.test(content)) return null
  let position = opening.index + opening[0].length
  const consume = (pattern: string): RegExpExecArray | null => {
    const match = new RegExp(`\\s*${pattern}`, 'y')
    match.lastIndex = position
    const found = match.exec(text)
    if (found) position = match.lastIndex
    return found
  }
  const toolCalls: DsmlToolCall[] = []
  while (!consume(`</${marker}${opening[1]}>`)) {
    const invoke = consume(`<${marker}invoke\\s+name="([^"<>]+)"\\s*>`)
    if (!invoke) return null
    const entries: [string, unknown][] = []
    const names = new Set<string>()
    while (!consume(`</${marker}invoke>`)) {
      const parameter = consume(`<${marker}parameter\\s+name="([^"<>]+)"\\s+string="(true|false)"\\s*>`)
      if (!parameter || names.has(parameter[1])) return null
      names.add(parameter[1])
      const end = new RegExp(`</${marker}parameter>`, 'g')
      end.lastIndex = position
      const closing = end.exec(text)
      if (!closing) return null
      const value = text.slice(position, closing.index)
      // DSML provides no escaping for nested delimiters; reject ambiguous input.
      if (new RegExp(`</?${marker}`).test(value)) return null
      try {
        entries.push([parameter[1], parameter[2] === 'true' ? value : JSON.parse(value)])
      } catch { return null }
      position = end.lastIndex
    }
    toolCalls.push({ name: invoke[1], arguments: Object.fromEntries(entries) })
  }
  if (!toolCalls.length || text.slice(position).trim()) return null
  return { content: content || null, toolCalls }
}

/** Hold tag-like text across stream chunks so protocol markup cannot reach chat. */
export function createToolMarkupBuffer(emit: (chunk: string) => void) {
  let pending = ''
  let buffering = false
  return {
    write(chunk: string) {
      if (buffering) { pending += chunk; return }
      const start = chunk.indexOf('<')
      if (start < 0) { emit(chunk); return }
      if (start > 0) emit(chunk.slice(0, start))
      buffering = true
      pending = chunk.slice(start)
    },
    flush(): boolean {
      if (hasUnexecutedToolMarkup(pending)) return false
      if (pending) emit(pending)
      pending = ''
      return true
    },
  }
}

export const UNEXECUTED_TOOL_MESSAGE = 'The specialist attempted to call a tool, but tools are not available in this delegated turn. No tool call was executed.'
