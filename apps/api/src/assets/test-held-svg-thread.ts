// The SVG thread with a start held as long as a test wants, standing in for a slow one: it says
// `starting` on the HELD_SVG_THREAD channel, waits there for `go`, then runs svg-worker.ts and says
// `ready`.
import { BroadcastChannel, isMainThread } from 'node:worker_threads'

/** The channel held threads and their test talk on. */
export const HELD_SVG_THREAD = 'held-svg-thread'

if (!isMainThread) {
  const channel = new BroadcastChannel(HELD_SVG_THREAD)
  const go = new Promise<void>((resolve) => {
    channel.onmessage = (event) => {
      if ((event as MessageEvent).data === 'go') resolve()
    }
  })
  channel.postMessage('starting')
  await go
  await import('./svg-worker.ts')
  channel.postMessage('ready')
  channel.close()
}
