import { app } from 'electron'
import { join } from 'path'
import { createWorker as tesseractCreateWorker } from 'tesseract.js'

type TesseractWorker = {
  recognize: (image: Buffer | string) => Promise<{ data: { text: string } }>
  terminate: () => Promise<void>
}

let workerInstance: TesseractWorker | null = null
let initPromise: Promise<TesseractWorker> | null = null
const OCR_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error('OCR timed out'))
    }, OCR_TIMEOUT_MS)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })
}

function getTesseractPaths(): { workerPath: string; langPath: string } {
  const langPath = join(app.getPath('userData'), 'tesseract-lang')

  if (app.isPackaged) {
    const base = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'tesseract.js')
    return {
      workerPath: join(base, 'src', 'worker-script', 'node', 'index.js'),
      langPath,
    }
  }

  // Dev mode: dist/main/ is two levels below project root
  return {
    workerPath: join(__dirname, '..', '..', 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
    langPath,
  }
}

async function createWorker(): Promise<TesseractWorker> {
  const { workerPath, langPath } = getTesseractPaths()
  const worker = await tesseractCreateWorker('eng', 1, {
    workerPath,
    langPath,
    logger: () => {},
  })
  return worker as unknown as TesseractWorker
}

async function getWorker(): Promise<TesseractWorker> {
  if (workerInstance) return workerInstance

  if (!initPromise) {
    let abandoned = false
    const pending = createWorker().then((w) => {
      if (abandoned) {
        void w.terminate().catch(() => {})
        throw new Error('OCR initialization timed out')
      }
      return w
    })
    const initialization = withTimeout(pending, () => { abandoned = true }).then((w) => {
      workerInstance = w
      return w
    }).finally(() => {
      if (initPromise === initialization) initPromise = null
    })
    initPromise = initialization
  }

  return initPromise
}

let activeJob: Promise<string> | null = null

export async function recognizeText(dataUrl: string): Promise<string> {
  // Serialize jobs — tesseract worker is single-threaded
  const run = async (): Promise<string> => {
    let worker: TesseractWorker
    try {
      worker = await getWorker()
    } catch (err) {
      throw new Error(`OCR init failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      const result = await withTimeout(worker.recognize(dataUrl))
      return result.data.text.trim()
    } catch (err) {
      // On recognition error, destroy the worker so next call re-initializes
      workerInstance = null
      void worker.terminate().catch(() => {})
      throw new Error(`OCR recognition failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const job = activeJob ? activeJob.then(run, run) : run()
  const thisJob = job.finally(() => {
    if (activeJob === thisJob) activeJob = null
  })
  activeJob = thisJob
  return thisJob
}

export async function terminateOcrWorker(): Promise<void> {
  activeJob = null
  if (workerInstance) {
    const w = workerInstance
    workerInstance = null
    initPromise = null
    await w.terminate().catch(() => {})
  }
}
