// The links and icon sizes a website's page and manifest give.
import { MAX_URL_LENGTH } from '@dazbee/schema'

/** `href` read against `base` as an https link no longer than a link may be, without its fragment, or null. */
export function linkOf(href: string | undefined, base: URL): string | null {
  const text = href?.trim()
  if (!text) return null
  const url = URL.parse(text, base.href)
  if (!url || url.protocol !== 'https:' || url.href.length > MAX_URL_LENGTH) return null
  url.hash = ''
  return url.href
}

/** The largest side an icon's sizes name, such as 192 for "48x48 192x192"; 0 when they name none. */
export function largestSide(sizes: string): number {
  let largest = 0
  for (const [, width, height] of sizes.slice(0, 1_000).matchAll(/(\d{1,5})x(\d{1,5})/gi))
    largest = Math.max(largest, Number(width), Number(height))
  return largest
}
