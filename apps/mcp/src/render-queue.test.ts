import { describe, expect, it } from 'vitest'

import { testDesign } from '@dazbee/doc/test-design'
import { type Design, parseDesign } from '@dazbee/schema'

import { MAX_RENDER_PIXELS } from './limits.ts'
import { type FrameRender, renderQueue, type RenderThread } from './render-queue.ts'
import type { RenderAnswer, RenderJob } from './render-worker.ts'
import { ToolRefusal } from './tools/define-tool.ts'

/** A stand-in worker: what it was posted, whether it was ended, and how the test answers or fails it. */
interface FakeWorker {
  thread: RenderThread
  posted: RenderJob[]
  ended: boolean
  answer(answer: RenderAnswer): void
  fail(error: Error): void
}

/** The test design, parsed. */
function design(): Design {
  const parsed = parseDesign(testDesign())
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

/** A render of the square at `maxSize`, made at once. */
function squareAt(maxSize: number): () => Promise<FrameRender> {
  return async () => ({ design: design(), frameId: 'sq', maxSize, fonts: [], images: {} })
}

/** Lets the queue make what waits: a render is made in a promise's turn. */
const made = () => new Promise((resolve) => setImmediate(resolve))

/** A queue whose workers are stand-ins, each kept in `workers` as it starts. */
function fakeQueue(timeoutMs = 60_000) {
  const workers: FakeWorker[] = []
  const queue = renderQueue({
    waiting: 8,
    timeoutMs,
    start: () => {
      const listeners = new Map<string, ((value: never) => void)[]>()
      const tell = (event: string, value: unknown) => {
        for (const listener of listeners.get(event) ?? []) (listener as (value: unknown) => void)(value)
      }
      const worker: FakeWorker = {
        posted: [],
        ended: false,
        answer: (answer) => tell('message', answer),
        fail: (error) => tell('error', error),
        thread: {
          postMessage: (job) => void worker.posted.push(job),
          on(event: string, listener: (value: never) => void) {
            listeners.set(event, [...(listeners.get(event) ?? []), listener])
            return worker.thread
          },
          ref() {},
          unref() {},
          terminate: async () => {
            worker.ended = true
            tell('exit', 1)
            return 1
          },
        },
      }
      workers.push(worker)
      return worker.thread
    },
  })
  return { queue, workers }
}

/** The answer drawing `job` gives. */
function drawn(job: RenderJob | undefined, drawMs = 5): RenderAnswer {
  return { id: job?.id ?? -1, png: new Uint8Array([1]), width: 4, height: 4, scale: 1, drawMs }
}

describe('renderQueue', () => {
  it('makes and posts one render at a time, the next once the one before is answered', async () => {
    const { queue, workers } = fakeQueue()
    let makes = 0
    const counted = (maxSize: number) => () => {
      makes++
      return squareAt(maxSize)()
    }
    const first = queue.draw('ann', counted(100))
    const second = queue.draw('bob', counted(200))
    await made()
    const [worker] = workers
    expect(makes).toBe(1)
    expect(worker?.posted.map((job) => job.maxSize)).toEqual([100])
    worker?.answer(drawn(worker.posted[0]))
    expect(await first).toMatchObject({ width: 4, ms: 5 })
    await made()
    expect(worker?.posted.map((job) => job.maxSize)).toEqual([100, 200])
    worker?.answer(drawn(worker.posted[1]))
    await second
    expect(workers).toHaveLength(1)
  })

  it('gives the time the worker spent drawing, not the time it took to start or to answer', async () => {
    const { queue, workers } = fakeQueue()
    const render = queue.draw('ann', squareAt(100))
    await made()
    await new Promise((resolve) => setTimeout(resolve, 30))
    const [worker] = workers
    worker?.answer(drawn(worker.posted[0], 2))
    expect((await render).ms).toBe(2)
  })

  it('refuses a second render of one access while its first waits or is drawn, with the seconds to wait', async () => {
    const { queue, workers } = fakeQueue()
    const first = queue.draw('ann', squareAt(100))
    expect(queue.busy('ann')).toBeGreaterThan(0)
    expect(queue.busy('bob')).toBe(0)
    await expect(queue.draw('ann', squareAt(100))).rejects.toThrow(
      /^Dazbee is drawing other renders; try again in \d+ seconds$/,
    )
    await made()
    workers[0]?.answer(drawn(workers[0].posted[0]))
    await first
    expect(queue.busy('ann')).toBe(0)
  })

  it('draws a frame past MAX_RENDER_PIXELS smaller, and ends the worker after a big render', async () => {
    const { queue, workers } = fakeQueue()
    const big = queue.draw('ann', squareAt(8192))
    await made()
    const [worker] = workers
    const asked = worker?.posted[0]?.maxSize ?? 0
    expect(asked * asked).toBeLessThanOrEqual(MAX_RENDER_PIXELS)
    expect(asked).toBeGreaterThan(4000)
    worker?.answer(drawn(worker.posted[0]))
    await big
    expect(worker?.ended).toBe(false)
    const small = queue.draw('ann', squareAt(100))
    await made()
    worker?.answer(drawn(worker.posted[1]))
    await small
    expect(worker?.ended).toBe(false)
  })

  it('ends the worker after a render whose surface and images pass BIG_RENDER_PIXELS', async () => {
    const { queue, workers } = fakeQueue()
    // A PNG header of 6,000 × 6,000 pixels: 36 million decoded.
    const header = Uint8Array.from(
      Buffer.from('89504e470d0a1a0a0000000d49484452000017700000177008060000001f15c489', 'hex'),
    )
    const heavy = queue.draw('ann', async () => ({ ...(await squareAt(100)()), images: { photo: header } }))
    await made()
    workers[0]?.answer(drawn(workers[0].posted[0]))
    await heavy
    expect(workers[0]?.ended).toBe(true)
    const next = queue.draw('ann', squareAt(100))
    await made()
    expect(workers).toHaveLength(2)
    workers[1]?.answer(drawn(workers[1].posted[0]))
    await next
  })

  it('refuses a render that takes too long, ends its worker, and draws the next on a fresh one', async () => {
    const { queue, workers } = fakeQueue(20)
    const slow = queue.draw('ann', squareAt(100))
    const next = queue.draw('bob', squareAt(100))
    await expect(slow).rejects.toThrow(ToolRefusal)
    await expect(slow).rejects.toThrow('The frame took more than 0.02 seconds to draw; ask for a smaller maxSize')
    expect(workers[0]?.ended).toBe(true)
    await made()
    expect(workers).toHaveLength(2)
    workers[1]?.answer(drawn(workers[1].posted[0]))
    expect(await next).toMatchObject({ width: 4 })
  })

  it('refuses a render whose making takes too long, without a worker, and makes the next', async () => {
    const { queue, workers } = fakeQueue(20)
    const never = queue.draw('ann', () => new Promise<FrameRender>(() => {}))
    const next = queue.draw('bob', squareAt(100))
    await expect(never).rejects.toThrow('The frame took more than 0.02 seconds to draw')
    await made()
    workers[0]?.answer(drawn(workers[0].posted[0]))
    expect(await next).toMatchObject({ width: 4 })
  })

  it('refuses a render whose making failed, and makes the next', async () => {
    const { queue, workers } = fakeQueue()
    const refused = queue.draw('ann', () => Promise.reject(new ToolRefusal('too many images')))
    const next = queue.draw('bob', squareAt(100))
    await expect(refused).rejects.toThrow('too many images')
    await made()
    workers[0]?.answer(drawn(workers[0].posted[0]))
    expect(await next).toMatchObject({ width: 4 })
  })

  it('refuses the render of a worker that fails, and draws the next on a fresh one', async () => {
    const { queue, workers } = fakeQueue()
    const failing = queue.draw('ann', squareAt(100))
    const next = queue.draw('bob', squareAt(100))
    await made()
    workers[0]?.fail(new Error('out of memory'))
    await expect(failing).rejects.toThrow('out of memory')
    await made()
    workers[1]?.answer(drawn(workers[1].posted[0]))
    expect(await next).toMatchObject({ width: 4 })
  })

  it('refuses a frame no PNG of which fits; ends the worker that answers an error', async () => {
    const { queue, workers } = fakeQueue()
    const tooBig = queue.draw('ann', squareAt(100))
    await made()
    workers[0]?.answer({ id: workers[0].posted[0]?.id ?? -1, tooBig: true })
    await expect(tooBig).rejects.toThrow('No picture of the frame “sq” is small enough to send')
    expect(workers[0]?.ended).toBe(false)
    const failed = queue.draw('ann', squareAt(100))
    await made()
    workers[0]?.answer({ id: workers[0].posted[1]?.id ?? -1, error: 'RuntimeError: Aborted()' })
    await expect(failed).rejects.toThrow('RuntimeError: Aborted()')
    expect(workers[0]?.ended).toBe(true)
  })

  it('refuses what waits once closed, and anything after', async () => {
    const { queue, workers } = fakeQueue()
    const drawing = queue.draw('ann', squareAt(100))
    const waiting = queue.draw('bob', squareAt(100))
    await made()
    queue.close()
    await expect(drawing).rejects.toThrow('This server is stopping')
    await expect(waiting).rejects.toThrow('This server is stopping')
    await expect(queue.draw('cat', squareAt(100))).rejects.toThrow('This server is stopping')
    expect(workers[0]?.ended).toBe(true)
  })
})
