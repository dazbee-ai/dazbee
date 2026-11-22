// The editor's one way to the matchers. It checks whether this browser can run them: one that lacks
// WebAssembly or module workers, or says it has under 2 GB of memory, keeps every piece a picture
// with `unsupported`, and nothing is started or sent anywhere. Otherwise it hands a job's text
// pieces to the pool of workers, made with the first job, tells each piece's step as it begins, and
// cancels a job when its signal aborts.
import type { TextStep } from '@dazbee/matchers'
import type { MatchAnswer, MatchJob } from '@dazbee/schema'

import {
  type Device,
  documentShown,
  type MatchFonts,
  type MatchPool,
  matchPool,
  type MatchWorker,
} from './match-pool.ts'
import { compileMatcherModules } from './matcher-files.ts'

/** What the client reads of the browser: whether it has WebAssembly and module workers, and the device. */
export interface Browser extends Device {
  webAssembly: boolean
  moduleWorkers: boolean
}

/** What a job is matched with: its fonts, who hears each piece's step, and a signal that cancels it. */
export interface MatchOptions {
  fonts: MatchFonts
  step?: (index: number, step: TextStep) => void
  signal?: AbortSignal
}

/**
 * The match client: `match` answers each piece of a job, in the job's order, null for a piece of a
 * kind it doesn't match.
 */
export interface MatchClient {
  match(job: MatchJob, options: MatchOptions): Promise<(MatchAnswer | null)[]>
  destroy(): void
}

/** The least memory, in GB, a device the matchers run on says it has. */
const LEAST_MEMORY_GB = 2

/** Whether a browser can run the matchers, as far as it says before a worker is started. */
export function canMatch(browser: Browser): boolean {
  return (
    browser.webAssembly &&
    browser.moduleWorkers &&
    (browser.memoryGb === undefined || browser.memoryGb >= LEAST_MEMORY_GB)
  )
}

/** This browser: its WebAssembly, its module workers, its cores and its memory, when it says. */
export function thisBrowser(): Browser {
  const { hardwareConcurrency, deviceMemory } = navigator as Navigator & { deviceMemory?: number }
  return {
    webAssembly: typeof WebAssembly === 'object' && typeof WebAssembly.compile === 'function',
    moduleWorkers: hasModuleWorkers(),
    cores: hardwareConcurrency || 1,
    memoryGb: deviceMemory,
  }
}

export function matchClient({
  browser = thisBrowser(),
  makePool = (device: Device) =>
    matchPool({
      start: () =>
        new Worker(new URL('../editor-worker.ts', import.meta.url), { type: 'module' }) as unknown as MatchWorker,
      device,
      compile: () => compileMatcherModules(),
      page: documentShown(),
    }),
}: { browser?: Browser; makePool?: (device: Device) => MatchPool } = {}): MatchClient {
  const able = canMatch(browser)
  let pool: MatchPool | undefined
  let nextJob = 0

  return {
    match(job, { fonts, step, signal }) {
      const answers: (MatchAnswer | null)[] = job.pieces.map(() => null)
      const text = job.pieces.flatMap((piece, index) => (piece.kind === 'text' ? [index] : []))
      if (!able || pool?.unsupported) {
        for (const index of text) answers[index] = { kind: 'picture', why: 'unsupported' }
        return Promise.resolve(answers)
      }
      if (signal?.aborted) return Promise.reject(signal.reason)
      if (text.length === 0) return Promise.resolve(answers)
      const id = nextJob++
      const running = (pool ??= makePool(browser))
      return new Promise((resolve, reject) => {
        let left = text.length
        const cancel = () => {
          running.cancel(id)
          reject(signal?.reason)
        }
        signal?.addEventListener('abort', cancel, { once: true })
        running.add({ id, job, fonts }, text, {
          step: (index, told) => step?.(index, told),
          answer(index, answer) {
            answers[index] = answer
            if (--left > 0) return
            signal?.removeEventListener('abort', cancel)
            resolve(answers)
          },
        })
      })
    },
    destroy() {
      pool?.destroy()
      pool = undefined
    },
  }
}

/** Whether the browser starts workers from modules: it reads a worker's `type` only then. */
function hasModuleWorkers(): boolean {
  if (typeof Worker === 'undefined') return false
  let read = false
  const options = {
    get type() {
      read = true
      return 'module' as const
    },
  }
  try {
    // An address no worker starts from: the browser reads the options, then refuses it.
    new Worker('blob://', options).terminate()
  } catch {
    // Refused, as expected.
  }
  return read
}
