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

/** A render of the square at `maxSize`. */
function squareAt(maxSize: number): FrameRender {
  return { design: design(), frameId: 'sq', maxSize, fonts: [], images: {} }
}

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
function drawn(job: RenderJob | undefined): RenderAnswer {
  return { id: job?.id ?? -1, png: new Uint8Array([1]), width: 4, height: 4, scale: 1 }
}

describe('renderQueue', () => {
  it('posts one render at a time, the next once the one before is answered', async () => {
    const { queue, workers } = fakeQueue()
    const first = queue.draw(squareAt(100))
    const second = queue.draw(squareAt(200))
    const [worker] = workers
    expect(worker?.posted.map((job) => job.maxSize)).toEqual([100])
    worker?.answer(drawn(worker.posted[0]))
    expect(await first).toMatchObject({ width: 4 })
    expect(worker?.posted.map((job) => job.maxSize)).toEqual([100, 200])
    worker?.answer(drawn(worker.posted[1]))
    await second
    expect(workers).toHaveLength(1)
  })

  it('draws a frame past MAX_RENDER_PIXELS smaller, and ends the worker after a big render', async () => {
    const { queue, workers } = fakeQueue()
    const big = queue.draw(squareAt(8192))
    const [worker] = workers
    const asked = worker?.posted[0]?.maxSize ?? 0
    expect(asked * asked).toBeLessThanOrEqual(MAX_RENDER_PIXELS)
    expect(asked).toBeGreaterThan(4000)
    worker?.answer(drawn(worker.posted[0]))
    await big
    expect(worker?.ended).toBe(true)
    const next = queue.draw(squareAt(100))
    expect(workers).toHaveLength(2)
    workers[1]?.answer(drawn(workers[1].posted[0]))
    await next
    expect(workers[1]?.ended).toBe(false)
  })

  it('refuses a render that takes too long, ends its worker, and draws the next on a fresh one', async () => {
    const { queue, workers } = fakeQueue(20)
    const slow = queue.draw(squareAt(100))
    const next = queue.draw(squareAt(100))
    await expect(slow).rejects.toThrow(ToolRefusal)
    await expect(slow).rejects.toThrow('The frame took more than 0.02 seconds to draw; ask for a smaller maxSize')
    expect(workers[0]?.ended).toBe(true)
    expect(workers).toHaveLength(2)
    workers[1]?.answer(drawn(workers[1].posted[0]))
    expect(await next).toMatchObject({ width: 4 })
  })

  it('refuses the render of a worker that fails, and draws the next on a fresh one', async () => {
    const { queue, workers } = fakeQueue()
    const failing = queue.draw(squareAt(100))
    const next = queue.draw(squareAt(100))
    workers[0]?.fail(new Error('out of memory'))
    await expect(failing).rejects.toThrow('out of memory')
    workers[1]?.answer(drawn(workers[1].posted[0]))
    expect(await next).toMatchObject({ width: 4 })
  })

  it('refuses a frame no PNG of which fits, and an error the worker answers', async () => {
    const { queue, workers } = fakeQueue()
    const tooBig = queue.draw(squareAt(100))
    workers[0]?.answer({ id: workers[0].posted[0]?.id ?? -1, tooBig: true })
    await expect(tooBig).rejects.toThrow('No picture of the frame “sq” is small enough to send')
    const failed = queue.draw(squareAt(100))
    workers[0]?.answer({ id: workers[0].posted[1]?.id ?? -1, error: 'no image for asset "x"' })
    await expect(failed).rejects.toThrow('no image for asset "x"')
    expect(workers).toHaveLength(1)
  })

  it('refuses what waits once closed, and anything after', async () => {
    const { queue, workers } = fakeQueue()
    const drawing = queue.draw(squareAt(100))
    const waiting = queue.draw(squareAt(100))
    queue.close()
    await expect(drawing).rejects.toThrow('This server is stopping')
    await expect(waiting).rejects.toThrow('This server is stopping')
    await expect(queue.draw(squareAt(100))).rejects.toThrow('This server is stopping')
    expect(workers[0]?.ended).toBe(true)
  })
})
