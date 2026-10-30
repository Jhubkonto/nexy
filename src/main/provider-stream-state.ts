import http from 'http'

export const activeStreamingRequests = new Map<string, http.ClientRequest>()
export const activeCliAbortControllers = new Map<string, AbortController>()
let fallbackStreamingRequestCounter = 0

export function incrementFallbackCounter(): number {
  return fallbackStreamingRequestCounter++
}

export function abortActiveStream(conversationId?: string): void {
  if (conversationId) {
    // Delegated provider turns intentionally use `${conversationId}:${stepId}` so
    // siblings can stream in parallel. A conversation stop must fan out to those
    // child keys as well as the leader key.
    const keys = [
      ...new Set([
        ...[...activeStreamingRequests.keys()].filter((key) => key === conversationId || key.startsWith(`${conversationId}:`)),
        ...[...activeCliAbortControllers.keys()].filter((key) => key === conversationId || key.startsWith(`${conversationId}:`)),
      ]),
    ]
    for (const key of keys) {
      const req = activeStreamingRequests.get(key)
      if (req) {
        req.destroy()
        activeStreamingRequests.delete(key)
      }
      const ctrl = activeCliAbortControllers.get(key)
      if (ctrl) {
        ctrl.abort()
        activeCliAbortControllers.delete(key)
      }
    }
    return
  }

  for (const req of activeStreamingRequests.values()) req.destroy()
  activeStreamingRequests.clear()
  for (const ctrl of activeCliAbortControllers.values()) ctrl.abort()
  activeCliAbortControllers.clear()
}
