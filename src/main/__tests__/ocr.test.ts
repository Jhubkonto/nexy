import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApp, mockCreateWorker } = vi.hoisted(() => ({
  mockApp: {
    getPath: vi.fn(() => '/tmp/userData'),
    isPackaged: false,
  },
  mockCreateWorker: vi.fn(),
}))

vi.mock('electron', () => ({ app: mockApp }))
vi.mock('tesseract.js', () => ({ createWorker: mockCreateWorker }))

import { recognizeText, terminateOcrWorker } from '../ocr'

function makeMockWorker() {
  return {
    recognize: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
  }
}

describe('recognizeText', () => {
  let mockWorker: ReturnType<typeof makeMockWorker>

  beforeEach(async () => {
    vi.clearAllMocks()
    await terminateOcrWorker()
    mockApp.isPackaged = false
    mockWorker = makeMockWorker()
    mockCreateWorker.mockResolvedValue(mockWorker)
    mockWorker.recognize.mockResolvedValue({ data: { text: '  hello world  ' } })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await terminateOcrWorker()
  })

  it('times out a stuck initialization and disposes a worker that arrives late', async () => {
    vi.useFakeTimers()
    let finish!: (worker: ReturnType<typeof makeMockWorker>) => void
    mockCreateWorker.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const result = recognizeText('image')
    const failure = expect(result).rejects.toThrow('OCR init failed: OCR timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await failure
    finish(mockWorker)
    await vi.waitFor(() => expect(mockWorker.terminate).toHaveBeenCalledOnce())
    const freshWorker = makeMockWorker()
    freshWorker.recognize.mockResolvedValue({ data: { text: 'recovered' } })
    mockCreateWorker.mockResolvedValueOnce(freshWorker)
    await expect(recognizeText('image')).resolves.toBe('recovered')
  })

  it('times out stuck recognition and releases the queue for the next image', async () => {
    vi.useFakeTimers()
    mockWorker.recognize.mockReturnValueOnce(new Promise(() => {}))
    const freshWorker = makeMockWorker()
    freshWorker.recognize.mockResolvedValue({ data: { text: 'recovered' } })
    mockCreateWorker.mockResolvedValueOnce(mockWorker).mockResolvedValueOnce(freshWorker)
    const first = recognizeText('first')
    const failure = expect(first).rejects.toThrow('OCR recognition failed: OCR timed out')
    const second = recognizeText('second')
    await vi.advanceTimersByTimeAsync(15_000)
    await failure
    await expect(second).resolves.toBe('recovered')
    expect(mockWorker.terminate).toHaveBeenCalledOnce()
  })

  it('initializes worker lazily and returns trimmed text', async () => {
    const result = await recognizeText('data:image/png;base64,abc')
    expect(mockCreateWorker).toHaveBeenCalledOnce()
    expect(result).toBe('hello world')
  })

  it('reuses the singleton worker on subsequent calls', async () => {
    await recognizeText('data:image/png;base64,abc')
    await recognizeText('data:image/png;base64,def')
    expect(mockCreateWorker).toHaveBeenCalledOnce()
    expect(mockWorker.recognize).toHaveBeenCalledTimes(2)
  })

  it('serializes concurrent calls — second recognize only starts after first finishes', async () => {
    const order: number[] = []
    let resolveFirst: ((v: { data: { text: string } }) => void) | undefined

    mockWorker.recognize
      .mockImplementationOnce(
        () =>
          new Promise<{ data: { text: string } }>((resolve) => {
            order.push(1)
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(() => {
        order.push(2)
        return Promise.resolve({ data: { text: 'second' } })
      })

    const p1 = recognizeText('data:image/png;base64,first')
    const p2 = recognizeText('data:image/png;base64,second')

    // Flush enough microtask ticks for getWorker (createWorker mock + .then chain)
    // to complete and for recognize to be called on the first job
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(order).toEqual([1])
    expect(mockWorker.recognize).toHaveBeenCalledOnce()

    resolveFirst!({ data: { text: 'first' } })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe('first')
    expect(r2).toBe('second')
    expect(order).toEqual([1, 2])
  })

  it('destroys worker on recognition failure and re-creates on next call', async () => {
    mockWorker.recognize
      .mockRejectedValueOnce(new Error('GPU crash'))
      .mockResolvedValueOnce({ data: { text: 'recovered' } })

    await expect(recognizeText('data:image/png;base64,fail')).rejects.toThrow('OCR recognition failed')
    expect(mockWorker.terminate).toHaveBeenCalledOnce()

    // Next call should create a fresh worker
    const newWorker = makeMockWorker()
    newWorker.recognize.mockResolvedValue({ data: { text: 'recovered' } })
    mockCreateWorker.mockResolvedValueOnce(newWorker)

    const result = await recognizeText('data:image/png;base64,retry')
    expect(mockCreateWorker).toHaveBeenCalledTimes(2)
    expect(result).toBe('recovered')
  })

  it('propagates init failures with a descriptive error message', async () => {
    mockCreateWorker.mockRejectedValue(new Error('worker init failed'))
    await expect(recognizeText('data:image/png;base64,test')).rejects.toThrow('OCR init failed')
  })

  it('uses the development worker path when app.isPackaged is false', async () => {
    await recognizeText('data:image/png;base64,abc')
    const [, , opts] = mockCreateWorker.mock.calls[0] as [unknown, unknown, { workerPath: string; langPath: string }]
    expect(opts.workerPath).toContain('node_modules')
    expect(opts.workerPath).toContain('tesseract.js')
    expect(opts.langPath).toContain('userData')
    expect(opts.workerPath).not.toContain('app.asar.unpacked')
  })

  it('uses the production ASAR-unpacked path when app.isPackaged is true', async () => {
    mockApp.isPackaged = true
    ;(process as NodeJS.Process & { resourcesPath: string }).resourcesPath = '/mock/resources'
    await recognizeText('data:image/png;base64,abc')
    const [, , opts] = mockCreateWorker.mock.calls[0] as [unknown, unknown, { workerPath: string; langPath: string }]
    expect(opts.workerPath).toContain('app.asar.unpacked')
    expect(opts.workerPath).toContain('tesseract.js')
  })
})

describe('terminateOcrWorker', () => {
  let mockWorker: ReturnType<typeof makeMockWorker>

  beforeEach(async () => {
    vi.clearAllMocks()
    await terminateOcrWorker()
    mockApp.isPackaged = false
    mockWorker = makeMockWorker()
    mockCreateWorker.mockResolvedValue(mockWorker)
  })

  it('terminates the worker and causes re-initialization on the next call', async () => {
    mockWorker.recognize.mockResolvedValue({ data: { text: 'initial' } })
    await recognizeText('data:image/png;base64,abc')
    expect(mockCreateWorker).toHaveBeenCalledOnce()

    await terminateOcrWorker()
    expect(mockWorker.terminate).toHaveBeenCalledOnce()

    const freshWorker = makeMockWorker()
    freshWorker.recognize.mockResolvedValue({ data: { text: 'fresh' } })
    mockCreateWorker.mockResolvedValueOnce(freshWorker)

    const result = await recognizeText('data:image/png;base64,xyz')
    expect(mockCreateWorker).toHaveBeenCalledTimes(2)
    expect(result).toBe('fresh')
  })

  it('is safe to call when no worker has been initialized', async () => {
    await expect(terminateOcrWorker()).resolves.not.toThrow()
    expect(mockWorker.terminate).not.toHaveBeenCalled()
  })
})
