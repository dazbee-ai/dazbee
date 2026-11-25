// Paces calls to a seller under its per-minute limit, so they wait for a free place instead of failing.
// There is one worker, so the pacing lives in its process.
import { setTimeout as sleep } from 'node:timers/promises'

/** How long a call counts against a per-minute limit. */
const WINDOW_MS = 60_000

/** When each pacing key's calls of the last minute started. */
const starts = new Map<string, number[]>()
/** The call waiting last for each pacing key, so callers take their turn in order. */
const queues = new Map<string, Promise<void>>()

/**
 * Waits until a call under `key` may start with at most `perMinute` started in the last minute; at once
 * when there is no limit. Rejects with the signal's reason when `signal` aborts while it waits.
 */
export function pace(key: string, perMinute: number | undefined, signal: AbortSignal): Promise<void> {
  if (!perMinute) return Promise.resolve()
  const turn = (queues.get(key) ?? Promise.resolve()).then(() => waitForPlace(key, perMinute, signal))
  queues.set(
    key,
    turn.catch(() => undefined),
  )
  return turn
}

async function waitForPlace(key: string, perMinute: number, signal: AbortSignal): Promise<void> {
  const started = starts.get(key) ?? []
  starts.set(key, started)
  for (;;) {
    signal.throwIfAborted()
    const now = Date.now()
    while (started.length > 0 && (started[0] ?? 0) <= now - WINDOW_MS) started.shift()
    if (started.length < perMinute) {
      started.push(now)
      return
    }
    await sleep((started[0] ?? now) + WINDOW_MS - now, undefined, { signal }).catch((error: unknown) => {
      throw signal.aborted ? signal.reason : error
    })
  }
}
