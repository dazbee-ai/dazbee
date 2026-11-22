// The notices the app lists for the icon, sticker, illustration and artwork sets it bundles: each set's name, where it
// comes from, its version and its licence in full, as `write-icons.ts` and `write-stickers.ts` copied them from the
// set's source, as `illustration-notices.json` quotes each illustration set's licence page, and as `write-artwork.ts`
// copied each artwork set's licence, with the Creative Commons legal code for a CC set. Reads no file, so the web app
// can import it.
import artworkNotices from './artwork-notices.json' with { type: 'json' }
import { ARTWORK_SET_IDS, ARTWORK_SETS, artworkPinOf } from './artwork-sets.ts'
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

/** Every bundled set's notice: the icon, sticker, illustration and artwork sets, each in their order. */
export const SET_NOTICES: readonly SetNotice[] = [
  ...ICON_SET_IDS.map((id) => noticeOf(ICON_SETS[id], notices[id])),
  ...STICKER_SET_IDS.map((id) => noticeOf(STICKER_SETS[id], stickerNotices[id])),
  ...ILLUSTRATION_SET_IDS.map((id) => {
    const set = ILLUSTRATION_SETS[id]
    const notice = { version: pinOf(set), licence: set.licence.name, text: illustrationNotices[id] }
    return { ...noticeOf(set, notice), creator: set.creator }
  }),
  ...ARTWORK_SET_IDS.map((id) => {
    const set = ARTWORK_SETS[id]
    const text = (artworkNotices as Partial<Record<string, string>>)[id] ?? ''
    const notice = { version: artworkPinOf(set), licence: set.licence.name, text }
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

/** A text's paragraphs, parted by blank lines, each one's lines joined by a space and its runs of spaces made one. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim().replaceAll(/\s+/g, ' '))
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
}
