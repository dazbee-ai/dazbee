// What the API's files at permanent addresses, which anyone may read, share: the answer that keeps a file for good,
// the one that keeps nothing, and the network an address's asks are counted by.

/** The Google files and previews one address may ask the API for in a minute; Cloudflare answers repeats itself. */
export const GOOGLE_FONT_FILES_PER_ADDRESS_PER_MINUTE = 600
/**
 * What every answer at a Google address that is a file or the list says: keep it for good, and only the app's own
 * pages load it, so another site can't put it in its pages.
 */
export const KEEP_FOR_GOOD = {
  'cache-control': 'public, max-age=31536000, immutable',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
}
/** What every answer at a Google address that is not the file says: keep it nowhere, so a face added later shows. */
export const KEEP_NOTHING = { 'cache-control': 'no-store' }

/** The address a limit counts: an IPv4 address as it is, an IPv6 address by its /64, one customer's network. */
export function networkOf(address: string): string {
  if (!address.includes(':')) return address
  const [head = '', tail] = address.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups =
    tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(':')}::/64`
}
