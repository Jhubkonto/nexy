/** Detect common model-generated tool calls that arrived as text, not tool events. */
export function hasUnexecutedToolMarkup(text: string): boolean {
  return /<tool>\s*<name>[^<]+<\/name>[\s\S]*?<\/tool>/i.test(text)
    || /<(?:bash|shell)>\s*(?:<command>)?[\s\S]*?<\/(?:bash|shell)>/i.test(text)
    || /<[^>]*DSML[^>]*\|[^>]*(?:calls|invoke)\b/i.test(text)
}

export const UNEXECUTED_TOOL_MESSAGE = 'The specialist attempted to call a tool, but tools are not available in this delegated turn. No tool call was executed.'
