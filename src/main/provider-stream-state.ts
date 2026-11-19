import http from 'http'

export const activeStreamingRequests = new Map<string, http.ClientRequest>()
export const activeCliAbortControllers = new Map<string, AbortController>()
let fallbackStreamingRequestCounter = 0
const cancellationGuards = new Set<{ conversationId: string; cancelled: boolean }>()

/** Tracks stops even between two HTTP requests; disposed when dispatch finishes. */
export function createProviderCancellationGuard(conversationId: string): { assertActive: () => void; dispose: () => void } {
  const guard = { conversationId, cancelled: false }
  cancellationGuards.add(guard)
  return {
    assertActive: () => { if (guard.cancelled) throw new Error('The provider turn was cancelled.') },
    dispose: () => { cancellationGuards.delete(guard) },
  }
}

export function incrementFallbackCounter(): number {
  return fallbackStreamingRequestCounter++
}

export function abortActiveStream(conversationId?: string): void {
  for (const guard of cancellationGuards) {
    if (!conversationId || guard.conversationId === conversationId || guard.conversationId.startsWith(`${conversationId}:`)) guard.cancelled = true
  }
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
