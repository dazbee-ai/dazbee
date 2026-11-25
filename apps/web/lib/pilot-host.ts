// The pilot host: the address the admin pages are served at, pilot.dazbee.com in production, set as
// PILOT_HOST (with its port, for a local run). On it, `/` shows the overview at app/pilot/, `/access` early
// access at app/pilot/access/ and `/ai` the AI section at app/pilot/ai/; on any other host, those pages are
// not found. No PILOT_HOST, no pilot host.

/** The path of the admin pages' overview, which the pilot host's `/` shows. */
export const PILOT_PATH = '/pilot'

/** The path of early access's admin page, which the pilot host's `/access` shows. */
export const PILOT_ACCESS_PATH = '/pilot/access'

/** The path of the admin page's AI section, which the pilot host's `/ai` shows. */
export const PILOT_AI_PATH = '/pilot/ai'

/** The pilot host's own paths, and the paths of the pages they show. */
const PILOT_PAGES = new Map([
  ['/', PILOT_PATH],
  ['/access', PILOT_ACCESS_PATH],
  ['/ai', PILOT_AI_PATH],
])

/** Whether `host`, a request's Host header, is the pilot host `PILOT_HOST` names. */
export function isPilotHost(host: string | null | undefined, pilotHost = process.env.PILOT_HOST): boolean {
  const wanted = pilotHost?.trim().toLowerCase()
  return Boolean(wanted && host?.trim().toLowerCase() === wanted)
}

/**
 * The path a request to `path` on `host` is served from: on the pilot host, `/` is the overview, `/access`
 * early access and `/ai` the AI section.
 */
export function pilotPath(path: string, host: string | null | undefined, pilotHost = process.env.PILOT_HOST) {
  const page = PILOT_PAGES.get(path)
  return page && isPilotHost(host, pilotHost) ? page : path
}
