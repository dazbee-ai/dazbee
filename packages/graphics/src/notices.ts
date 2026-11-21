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
  /** The licence's text as paragraphs, each paragraph's lines joined, for a page to flow at any width. */
  paragraphs: readonly string[]
}

/** A text's paragraphs, parted by blank lines, each one's lines joined by a space. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
}

/** Every bundled set's notice, in the order the sets are listed. */
export const ICON_SET_NOTICES: readonly IconSetNotice[] = ICON_SET_IDS.map((id) => {
  const { title, homepage } = ICON_SETS[id]
  const notice = notices[id]
  return { title, homepage, ...notice, paragraphs: paragraphsOf(notice.text) }
})
