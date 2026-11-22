// The notices the app lists for the icon and sticker sets it bundles: each set's name, where it comes from, its
// version and its licence in full, as `write-icons.ts` and `write-stickers.ts` copied them from the set's source.
// Reads no file, so the web app can import it.
import notices from './notices.json' with { type: 'json' }
import { ICON_SET_IDS, ICON_SETS, STICKER_SET_IDS, STICKER_SETS } from './sets.ts'
import stickerNotices from './sticker-notices.json' with { type: 'json' }

/** A bundled set's notice. */
export interface SetNotice {
  title: string
  homepage: string
  /** Its version: a package's version, a commit's first 7 characters, or the day its site was read. */
  version: string
  /** The licence's SPDX id, such as MIT. */
  licence: string
  /** The licence's text, as the set ships it. */
  text: string
  /** The licence's text as paragraphs, each paragraph's lines joined, for a page to flow at any width. */
  paragraphs: readonly string[]
}

/** Every bundled set's notice, the icon sets first, in the order the sets are listed. */
export const SET_NOTICES: readonly SetNotice[] = [
  ...ICON_SET_IDS.map((id) => noticeOf(ICON_SETS[id], notices[id])),
  ...STICKER_SET_IDS.map((id) => noticeOf(STICKER_SETS[id], stickerNotices[id])),
]

/** A set's notice, from what its writer copied. */
function noticeOf(
  { title, homepage }: { title: string; homepage: string },
  notice: Pick<SetNotice, 'version' | 'licence' | 'text'>,
): SetNotice {
  return { title, homepage, ...notice, paragraphs: paragraphsOf(notice.text) }
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
