import https from 'https'
import { StringDecoder } from 'string_decoder'
import type { RequestOptions } from 'https'
import type { IncomingMessage } from 'http'
import type { ClientRequest } from 'http'

import { activeStreamingRequests } from './provider-stream-state'

export interface HttpsResponse {
  status: number
  headers: IncomingMessage['headers']
  data: string
}

const activeHttpsRequests = new Set<ClientRequest>()

export function abortAllHttpsRequests(): void {
  for (const request of activeHttpsRequests) request.destroy(new Error('Emergency stop activated'))
  activeHttpsRequests.clear()
}

/**
 * `abortKey` (a conversation id) registers this in-flight non-streaming request against
 * `activeStreamingRequests` so `abortActiveStream(conversationId)` can cancel it — this is what
 * lets "Stop" interrupt a BYOK tool-loop round mid-request (the streaming helpers already register
 * themselves; the non-streaming *WithTools calls previously did not). Only one request per
 * conversation is in flight at a time, so reusing the same map key is safe.
 */
function requestWithResponse(options: RequestOptions, body?: string, abortKey?: string): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (req: ClientRequest) => {
      activeHttpsRequests.delete(req)
      if (abortKey && activeStreamingRequests.get(abortKey) === req) activeStreamingRequests.delete(abortKey)
    }
    const req = https.request(options, (res) => {
      let data = ''
      const decoder = new StringDecoder('utf8')
      res.on('data', (chunk) => {
        data += typeof chunk === 'string' ? chunk : decoder.write(chunk)
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        cleanup(req)
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          data: data + decoder.end()
        })
      })
      res.on('error', (error) => { if (settled) return; settled = true; cleanup(req); reject(error) })
    })

    activeHttpsRequests.add(req)
    if (abortKey) activeStreamingRequests.set(abortKey, req)
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'))
    })
    req.on('error', (error) => { if (settled) return; settled = true; cleanup(req); reject(error) })
    // A bare req.destroy() (as abortActiveStream issues on Stop) may emit only 'close', not
    // 'error'. Reject on close-before-settle so the request promise never hangs on abort.
    req.on('close', () => {
      if (settled) return
      settled = true
      cleanup(req)
      reject(new Error('Request aborted'))
    })
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** General https request returning raw response body */
export async function httpsRequest(options: RequestOptions, body?: string): Promise<string> {
  return (await requestWithResponse(options, body)).data
}

export async function httpsRequestWithResponse(options: RequestOptions, body?: string): Promise<HttpsResponse> {
  return requestWithResponse(options, body)
}

/** URL-based https request returning status + raw body (shared by the provider layer).
 *  Pass `abortKey` (a conversation id) to make the request cancellable via abortActiveStream. */
export function httpsRequestUrl(
  url: string,
  options: RequestOptions,
  body?: string,
  abortKey?: string,
): Promise<HttpsResponse> {
  const urlObj = new URL(url)
  return requestWithResponse(
    { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, ...options },
    body,
    abortKey,
  )
}

/**
 * Builds the Error for a >=400 provider response: uses the API's own
 * `error.message` when the body parses, otherwise a labeled HTTP fallback.
 */
export function providerHttpError(label: string, status: number | undefined, data: string): Error {
  let message = `${label} API error (HTTP ${status})`
  try {
    const parsed = JSON.parse(data)
    if (parsed.error?.message) message = parsed.error.message
  } catch { /* use default */ }
  const err = new Error(message)
  // Attach the HTTP status so callers (e.g. the tool loop's retry/backoff) can classify
  // retryable failures (429/5xx) without brittle string matching on the message.
  ;(err as Error & { status?: number }).status = status
  return err
}

/** Low-level POST returning raw response body */
export function httpsPost(url: string, headers: Record<string, string | number>, body: string): Promise<string> {
  const urlObj = new URL(url)
  return httpsRequest(
    {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body)
      }
    },
    body
  )
}

/** Low-level GET returning raw response body */
export function httpsGet(url: string, headers: Record<string, string | number>): Promise<string> {
  const urlObj = new URL(url)
  return httpsRequest({
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers
  })
}

/** Parse an SSE stream, calling onDelta for each non-empty delta string.
 *  Returns when the stream ends or [DONE] is received. */
export function parseSseStream(res: IncomingMessage, onDelta: (delta: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const decoder = new StringDecoder('utf8')
    let finished = false

    const cleanup = () => {
      res.off('data', handleData)
      res.off('end', handleEnd)
      res.off('error', handleError)
    }

    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    const handleLine = (line: string) => {
      if (finished) return
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const data = trimmed.slice(5).trimStart()
      if (data === '[DONE]') {
        finish()
        return
      }
      if (data) onDelta(data)
    }

    const processBuffer = (flush = false) => {
      const lines = buffer.split('\n')
      const trailing = flush ? '' : (lines.pop() ?? '')
      for (const rawLine of lines) {
        handleLine(rawLine.replace(/\r$/, ''))
        if (finished) return
      }
      if (flush && trailing) {
        handleLine(trailing.replace(/\r$/, ''))
        if (finished) return
      }
      buffer = trailing
    }

    const handleData = (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)
      processBuffer(false)
    }

    const handleEnd = () => {
      buffer += decoder.end()
      processBuffer(true)
      finish()
    }

    const handleError = (error: Error) => {
      if (finished) return
      finished = true
      cleanup()
      reject(error)
    }

    res.on('data', handleData)
    res.on('end', handleEnd)
    res.on('error', handleError)
  })
}
