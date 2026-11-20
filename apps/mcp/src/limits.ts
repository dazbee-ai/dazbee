// What the MCP server holds each agent to, so that one busy agent can't slow the one server. The capacity limits
// are server settings, read from the environment at start; the rest are rules kept in code.

/** The capacity limits the server runs with, each read from its environment variable by `limitSettings`. */
export interface LimitSettings {
  /** The calls an access may make at once, `MCP_CALLS_BURST`. */
  callsBurst: number
  /** The calls an access gets back each second, `MCP_CALLS_PER_SECOND`. */
  callsPerSecond: number
  /** The new designs an access may make in an hour, `MCP_DESIGNS_PER_HOUR`. */
  designsPerHour: number
  /** The renders an access may ask for at once, `MCP_RENDERS_BURST`. */
  rendersBurst: number
  /** How many seconds an access waits for each render after those, `MCP_RENDER_EVERY_SECONDS`. */
  renderEverySeconds: number
  /** The renders that may wait in the process for the one being drawn, `MCP_RENDERS_WAITING`. */
  rendersWaiting: number
}

/** Each key's bucket: takes one, refilled at a steady pace up to its size. */
export interface RateBuckets {
  /** Takes one from `key`'s bucket, giving 0; or, when it is empty, the whole seconds until one is back. */
  take(key: string): number
  /** Takes `count` more from `key`'s bucket, below empty if need be: what it took that cost more than one. */
  charge(key: string, count: number): void
}

/** At most so many in an hour, per access: one more counted, or the seconds to wait. */
export interface HourRate {
  /**
   * Counts one for the access, giving what takes it back again, such as for a design the API refused; past the
   * limit, counts none and gives the whole seconds to wait.
   */
  take(accessId: string): number | (() => void)
}

/** A setting's environment variable, its value when unset, and the least and most it may be. */
interface Setting {
  name: string
  value: number
  least: number
  most: number
}

/** The largest request body taken: a bigger one is refused (413) before any of it is parsed. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

/** The largest answer sent: the usual MCP client reads at most 10 MiB, and the rest is room for the JSON-RPC envelope. */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024

/** Room kept in an answer for what wraps a tool's text: its content block, `isError` and the JSON-RPC envelope. */
export const ANSWER_ENVELOPE_BYTES = 2 * 1024

/** How long a session lasts without a call. */
export const MCP_SESSION_IDLE_MS = 30 * 60 * 1000

/** The most sessions an agent access holds at once; a new one ends the oldest. */
export const MAX_MCP_SESSIONS_PER_ACCESS = 4

/** The most sessions held at once, of all accesses; past it, a new one is refused as busy. */
export const MAX_MCP_SESSIONS = 200

/**
 * The most agent tabs open at once in the process, each the editor's core on one design; past it, open_design
 * answers busy. One tab takes about 10 MiB on the big carousel benchmark, and about 30 MiB with its images decoded
 * (`tests/pixels/src/agent-tab-cost.ts`): 20 keep the process under 1 GiB beside what every tab shares.
 */
export const MAX_AGENT_TABS = 20

/** The most agent tabs one agent access holds open at once, across its sessions; past it, open_design answers busy. */
export const MAX_AGENT_TABS_PER_ACCESS = 2

/** The most calls on a session's design running or waiting at once; past it, a call is refused. */
export const MAX_DESIGN_CALLS_WAITING = 4

/** How long open_design waits for the sync server's welcome. */
export const OPEN_DESIGN_TIMEOUT_MS = 30_000

/** The least `maxBytes` read_frame takes. */
export const MIN_TREE_BYTES = 1024

/** The most `maxBytes` read_frame takes: what an answer may hold. */
export const MAX_TREE_BYTES = MAX_ANSWER_BYTES - ANSWER_ENVELOPE_BYTES

/** How long a request may take before it is answered 503, so no client waits on a call that never ends. */
export const CALL_TIMEOUT_MS = 60_000

/** How long a writing tool waits for the sync server to store its step before answering that it isn't confirmed yet. */
export const STORE_WAIT_MS = 30_000

/**
 * The time kept at the end of a call for its answer: a writing tool waits for the store only until this long before
 * `CALL_TIMEOUT_MS`, so it never answers late while its step goes on.
 */
export const ANSWER_MARGIN_MS = 5_000

/** The most steps an agent batch takes. */
export const MAX_BATCH_STEPS = 1000

/** The largest body an OAuth endpoint takes: a registration or a token request is a few hundred bytes. */
export const MAX_OAUTH_BODY_BYTES = 64 * 1024

/**
 * The most pixels a render is drawn at: a bigger frame is drawn smaller, as if a smaller `maxSize` were asked. A
 * surface takes 4 bytes a pixel, so one render holds at most 64 MiB of pixels besides its PNG.
 */
export const MAX_RENDER_PIXELS = 4096 * 4096

/** The most bytes of image files one render may send the worker; a frame drawing more is refused. */
export const MAX_RENDER_IMAGE_BYTES = 64 * 1024 * 1024

/**
 * The most pixels the images one render draws may take decoded, 4 bytes each; a frame drawing more is refused. The
 * worker decodes each image whole: one 12-megapixel photo takes 48 MB.
 */
export const MAX_RENDER_IMAGE_PIXELS = 48_000_000

/**
 * A render whose surface and images take more than this many pixels ends the render worker once done: CanvasKit's
 * wasm memory grows to fit the most a render held and never shrinks, so the next render starts a fresh worker, which
 * takes about 2 seconds of CPU to start.
 */
export const BIG_RENDER_PIXELS = 32_000_000

/**
 * How long one render may take, its images read and its frame drawn; past it the worker is ended, the render refused,
 * and the next starts a fresh worker.
 */
export const RENDER_TIMEOUT_MS = 20_000

/** The worker time one render from an access's bucket pays for: each more it takes costs the access another render. */
export const RENDER_MS_PER_RENDER = 2000

/** The capacity limits read from the environment, with the value each takes when unset. */
const LIMIT_SETTINGS: Readonly<Record<keyof LimitSettings, Setting>> = {
  callsBurst: { name: 'MCP_CALLS_BURST', value: 60, least: 1, most: 100_000 },
  callsPerSecond: { name: 'MCP_CALLS_PER_SECOND', value: 2, least: 1, most: 10_000 },
  designsPerHour: { name: 'MCP_DESIGNS_PER_HOUR', value: 30, least: 1, most: 100_000 },
  rendersBurst: { name: 'MCP_RENDERS_BURST', value: 10, least: 1, most: 1000 },
  renderEverySeconds: { name: 'MCP_RENDER_EVERY_SECONDS', value: 6, least: 1, most: 3600 },
  rendersWaiting: { name: 'MCP_RENDERS_WAITING', value: 8, least: 0, most: 100 },
}

/** An hour, which new designs are counted over. */
const HOUR_MS = 60 * 60 * 1000

/** `bytes` in MiB, as the limits are told to an agent: "8 MiB", "8.5 MiB". */
export function inMiB(bytes: number): string {
  return `${Number((bytes / 1024 / 1024).toFixed(1))} MiB`
}

/**
 * The capacity limits `env` sets, each its default when unset or empty. Throws, naming the variable, on a value that
 * isn't a whole number in its range, so the server refuses to start on it.
 */
export function limitSettings(env: Readonly<Record<string, string | undefined>>): LimitSettings {
  const read = ({ name, value, least, most }: Setting) => {
    const given = env[name]?.trim()
    if (!given) return value
    const number = /^\d+$/.test(given) ? Number(given) : NaN
    if (!(number >= least && number <= most))
      throw new Error(`${name} must be a whole number from ${least} to ${most}, not “${given}”`)
    return number
  }
  return {
    callsBurst: read(LIMIT_SETTINGS.callsBurst),
    callsPerSecond: read(LIMIT_SETTINGS.callsPerSecond),
    designsPerHour: read(LIMIT_SETTINGS.designsPerHour),
    rendersBurst: read(LIMIT_SETTINGS.rendersBurst),
    renderEverySeconds: read(LIMIT_SETTINGS.renderEverySeconds),
    rendersWaiting: read(LIMIT_SETTINGS.rendersWaiting),
  }
}

/** A bucket of `size` for each key, refilling one every `everyMs` by `now`; a key whose bucket is full is forgotten. */
export function rateBuckets(size: number, everyMs: number, now: () => number): RateBuckets {
  /** Each key's bucket not yet full: what it held at `at`. */
  const buckets = new Map<string, { held: number; at: number }>()

  /** What `bucket` holds at `time`. */
  const heldAt = (bucket: { held: number; at: number }, time: number) =>
    Math.min(size, bucket.held + (time - bucket.at) / everyMs)

  function take(key: string): number {
    const time = now()
    for (const [other, bucket] of buckets) if (heldAt(bucket, time) >= size) buckets.delete(other)
    const held = heldAt(buckets.get(key) ?? { held: size, at: time }, time)
    if (held < 1) return Math.max(1, Math.ceil(((1 - held) * everyMs) / 1000))
    buckets.set(key, { held: held - 1, at: time })
    return 0
  }

  function charge(key: string, count: number) {
    const time = now()
    const held = heldAt(buckets.get(key) ?? { held: size, at: time }, time)
    buckets.set(key, { held: held - count, at: time })
  }

  return { take, charge }
}

/** Per access, at most `perHour` in any hour, by the clock `now`. */
export function hourRate(perHour: number, now: () => number): HourRate {
  /** When each access's counts of the last hour were taken, oldest first. Accesses with none are let go. */
  const taken = new Map<string, number[]>()

  function take(accessId: string): number | (() => void) {
    const at = now()
    for (const [id, times] of taken) {
      const left = times.filter((time) => time > at - HOUR_MS)
      if (left.length === 0) taken.delete(id)
      else taken.set(id, left)
    }
    const times = taken.get(accessId) ?? []
    const oldest = times[0]
    if (times.length >= perHour && oldest !== undefined) return Math.ceil((oldest + HOUR_MS - at) / 1000)
    taken.set(accessId, [...times, at])
    let counted = true
    return () => {
      const times = taken.get(accessId) ?? []
      const place = times.indexOf(at)
      if (!counted || place < 0) return
      counted = false
      taken.set(accessId, times.toSpliced(place, 1))
    }
  }

  return { take }
}

/** `seconds` as the limits tell them to an agent: "1 second", "30 seconds". */
export function inSeconds(seconds: number): string {
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}
