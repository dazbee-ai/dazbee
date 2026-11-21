// The notices the app lists for the icon sets it bundles: each set's name, where it comes from, its version and its
// licence in full, as `write-icons.ts` copied them from the set's package. Reads no file, so the web app can import it.
import notices from './notices.json' with { type: 'json' }
import { ICON_SET_IDS, ICON_SETS } from './sets.ts'

/** A bundled set's notice. */
export interface IconSetNotice {
  title: string
  homepage: string
  version: string
  /** The licence's SPDX id, such as MIT. */
  licence: string
  /** The licence's text, as the set ships it. */
  text: string
}

/** Every bundled set's notice, in the order the sets are listed. */
export const ICON_SET_NOTICES: readonly IconSetNotice[] = ICON_SET_IDS.map((id) => {
  const { title, homepage } = ICON_SETS[id]
  return { title, homepage, ...notices[id] }
})
