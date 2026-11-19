import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'http'

const { mockRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn()
}))

vi.mock('https', () => ({
  default: { request: mockRequest },
  request: mockRequest
}))

import { httpsGet, httpsPost, parseSseStream } from '../http-client'

function createMockResponse(): IncomingMessage & EventEmitter {
  const res = new EventEmitter() as IncomingMessage & EventEmitter
  ;(res as IncomingMessage & EventEmitter & { statusCode?: number }).statusCode = 200
  ;(res as IncomingMessage & EventEmitter & { headers?: Record<string, string> }).headers = {}
  return res
}

describe('http-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('httpsPost sends POST body and resolves response data', async () => {
    const body = JSON.stringify({ hello: 'world' })
    let capturedOptions: unknown
    let requestBody = ''
    let timeoutHandler: (() => void) | undefined

    mockRequest.mockImplementation((options: unknown, callback: (res: IncomingMessage) => void) => {
      capturedOptions = options
      const res = createMockResponse()
      const req = {
        setTimeout: vi.fn((_timeout: number, handler: () => void) => {
          timeoutHandler = handler
        }),
        on: vi.fn(),
        write: vi.fn((chunk: string) => {
          requestBody += chunk
        }),
        end: vi.fn(() => {
          callback(res)
          res.emit('data', 'ok')
          res.emit('end')
        }),
        destroy: vi.fn()
      }
      return req
    })

    const result = await httpsPost('https://example.com/api?foo=1', { Accept: 'application/json' }, body)

    expect(result).toBe('ok')
    expect(requestBody).toBe(body)
    expect(capturedOptions).toMatchObject({
      hostname: 'example.com',
      path: '/api?foo=1',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    })
    expect(timeoutHandler).toBeTypeOf('function')
  })

  it('httpsGet sends GET request without a body', async () => {
    let capturedOptions: unknown
    const write = vi.fn()

    mockRequest.mockImplementation((options: unknown, callback: (res: IncomingMessage) => void) => {
      capturedOptions = options
      const res = createMockResponse()
      return {
        setTimeout: vi.fn(),
        on: vi.fn(),
        write,
        end: vi.fn(() => {
          callback(res)
          res.emit('data', 'payload')
          res.emit('end')
        }),
        destroy: vi.fn()
      }
    })

    const result = await httpsGet('https://example.com/status', { Authorization: 'Bearer token' })

    expect(result).toBe('payload')
    expect(capturedOptions).toMatchObject({
      hostname: 'example.com',
      path: '/status',
      method: 'GET',
      headers: { Authorization: 'Bearer token' }
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('parseSseStream handles chunked data lines and resolves on [DONE]', async () => {
    const res = createMockResponse()
    const onDelta = vi.fn()

    const promise = parseSseStream(res, onDelta)

    res.emit('data', Buffer.from('data: {"id":1'))
    res.emit('data', Buffer.from('}\n\n'))
    res.emit('data', Buffer.from('data: {"id":2}\n'))
    res.emit('data', Buffer.from('\n'))
    res.emit('data', Buffer.from('data: [DO'))
    res.emit('data', Buffer.from('NE]\n\n'))

    await promise

    expect(onDelta).toHaveBeenNthCalledWith(1, '{"id":1}')
    expect(onDelta).toHaveBeenNthCalledWith(2, '{"id":2}')
    expect(onDelta).toHaveBeenCalledTimes(2)
  })

  it('parseSseStream skips empty data lines and passes through non-JSON payloads', async () => {
    const res = createMockResponse()
    const deltas: string[] = []

    const promise = parseSseStream(res, (delta) => {
      deltas.push(delta)
    })

    res.emit('data', 'data:\n\n')
    res.emit('data', 'data: plain-text\n\n')
    res.emit('data', 'data: {"ok":true}\n\n')
    res.emit('end')

    await promise

    expect(deltas).toEqual(['plain-text', '{"ok":true}'])
  })

  it('parseSseStream resolves immediately on data: [DONE]', async () => {
    const res = createMockResponse()
    const onDelta = vi.fn()

    const promise = parseSseStream(res, onDelta)

    res.emit('data', 'data: [DONE]\n\n')

    await expect(promise).resolves.toBeUndefined()
    expect(onDelta).not.toHaveBeenCalled()
  })

  it('preserves DSML delimiters and Unicode across every byte boundary', async () => {
    const payload = JSON.stringify({ content: '<｜｜DSML｜｜ calls>日本語 😀' })
    const encoded = Buffer.from(`data: ${payload}\n\ndata: [DONE]\n\n`)
    for (let split = 1; split < encoded.length; split++) {
      const res = createMockResponse()
      const deltas: string[] = []
      const done = parseSseStream(res, (delta) => deltas.push(delta))
      res.emit('data', encoded.subarray(0, split))
      res.emit('data', encoded.subarray(split))
      await done
      expect(deltas).toEqual([payload])
    }
  })

  it('preserves Unicode in non-streamed responses split into single bytes', async () => {
    const payload = '<｜｜DSML｜｜ calls>日本語 😀'
    mockRequest.mockImplementation((_options: unknown, callback: (res: IncomingMessage) => void) => ({
      setTimeout: vi.fn(), on: vi.fn(), write: vi.fn(), destroy: vi.fn(),
      end: () => {
        const res = createMockResponse()
        callback(res)
        for (const byte of Buffer.from(payload)) res.emit('data', Buffer.from([byte]))
        res.emit('end')
      },
    }))
    expect(await httpsGet('https://example.com', {})).toBe(payload)
  })
})
