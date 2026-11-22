// The notices the app lists for the icon, sticker and illustration sets it bundles: each set's name, where it comes
// from, its version and its licence in full, as `write-icons.ts` and `write-stickers.ts` copied them from the set's
// source, and as `illustration-notices.json` quotes each illustration set's licence page. Reads no file, so the web
// app can import it.
import illustrationNotices from './illustration-notices.json' with { type: 'json' }
import notices from './notices.json' with { type: 'json' }
import {
  ICON_SET_IDS,
  ICON_SETS,
  ILLUSTRATION_SET_IDS,
  ILLUSTRATION_SETS,
  pinOf,
  STICKER_SET_IDS,
  STICKER_SETS,
} from './sets.ts'
import stickerNotices from './sticker-notices.json' with { type: 'json' }

/** A bundled set's notice. */
export interface SetNotice {
  title: string
  homepage: string
  /** Who made it, and their site, for a set whose notice credits its maker. */
  creator?: { name: string; url: string }
  /** Its version: a package's version, a commit's first 7 characters, or the day its site was read. */
  version: string
  /** The licence's SPDX id, such as MIT, or its name when it has none. */
  licence: string
  /** The licence's text, as the set ships it. */
  text: string
  /** The licence's text as paragraphs, each paragraph's lines joined, for a page to flow at any width. */
  paragraphs: readonly string[]
}

/** Every bundled set's notice: the icon sets, the sticker sets, then the illustration sets, each in their order. */
export const SET_NOTICES: readonly SetNotice[] = [
  ...ICON_SET_IDS.map((id) => noticeOf(ICON_SETS[id], notices[id])),
  ...STICKER_SET_IDS.map((id) => noticeOf(STICKER_SETS[id], stickerNotices[id])),
  ...ILLUSTRATION_SET_IDS.map((id) => {
    const set = ILLUSTRATION_SETS[id]
    const notice = { version: pinOf(set), licence: set.licence.name, text: illustrationNotices[id] }
    return { ...noticeOf(set, notice), creator: set.creator }
  }),
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
