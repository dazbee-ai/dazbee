// Fetching for the record script: downloads of image fills and frame renders from Figma's storage,
// and reading any answer's body within a cap. Nothing here is given the token, so no request it
// makes can carry it.

export type Downloaded = { bytes: Uint8Array; extension: string } | { reason: string }

const DOWNLOAD_MS = 60_000
const MAX_REDIRECTS = 3

/**
 * Downloads `url` with no token, cookie or credential, up to `cap` bytes as decoded. A failure is a
 * reason the recording lists, never an error. Only https, unless `allowHttp` (a test's stub server);
 * at most three redirects, each checked again.
 */
export async function download(url: unknown, cap: number, allowHttp = false): Promise<Downloaded> {
  if (typeof url !== 'string') return { reason: 'Figma gave no URL' }
  let at: URL
  try {
    at = new URL(url)
  } catch {
    return { reason: 'not a URL' }
  }
  if (!allowed(at, allowHttp)) return { reason: 'not an https URL' }
  for (let hop = 0; ; hop++) {
    let response: Response
    try {
      response = await fetch(at, { credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(DOWNLOAD_MS) })
    } catch (error) {
      return { reason: isTimeout(error) ? `took longer than ${DOWNLOAD_MS / 1000} s` : 'could not be reached' }
    }
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
    if (location !== null) {
      await response.body?.cancel()
      if (hop === MAX_REDIRECTS) return { reason: `more than ${MAX_REDIRECTS} redirects` }
      const next = URL.parse(location, at.href)
      if (!next || !allowed(next, allowHttp)) return { reason: 'redirected to a URL that is not https' }
      at = next
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      return { reason: `Figma’s storage answered ${response.status}` }
    }
    const bytes = await readCapped(response, cap).catch(() => null)
    if (!bytes) return { reason: `larger than ${cap / 1024 / 1024} MB` }
    const extension = imageExtension(bytes)
    return extension ? { bytes, extension } : { reason: 'not a PNG, JPEG, GIF or WebP' }
  }
}

/** The body's bytes, or a rejection past `cap` bytes as decoded. */
export async function readCapped(response: Response, cap: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    total += next.value.byteLength
    if (total > cap) {
      await reader.cancel()
      throw new Error('too large')
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

/** Whether a fetch failed by its time running out. */
export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

function allowed(url: URL, allowHttp: boolean): boolean {
  return url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
}

function imageExtension(b: Uint8Array): string | undefined {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp'
  return undefined
}
