// The icon and sticker sets Dazbee bundles: each one's name, its styles, where it comes from and how it is pinned.
// An icon set is taken from an npm package pinned in this package's devDependencies (`write-icons.ts`); a sticker
// set from a GitHub repository at a commit, or from files on its makers' site pinned by their SHA-256 in
// `sticker-sources.json` (`write-stickers.ts`).

/** An icon set's id, the first part of each of its icons' ids (`tabler/shopping-cart`). */
export type IconSetId = 'tabler' | 'phosphor'

/** A sticker set's id, the first part of each of its stickers' ids (`fluent-emoji/rocket`). */
export type StickerSetId = 'fluent-emoji' | 'open-peeps' | 'humaaans' | 'open-doodles'

/** Any bundled set's id. */
export type GraphicSetId = IconSetId | StickerSetId

/** What a bundled graphic is: an icon, placed in one colour, or a sticker, placed as it is drawn. */
export type GraphicKind = 'icon' | 'sticker'

/**
 * How a sticker style is placed: a picture (a PNG file) joins the brand's asset library and is placed as an image; a
 * drawing (an SVG file) is placed as editable layers.
 */
export type StickerFormat = 'picture' | 'drawing'

/** What a set is and how its drawings are made. */
export interface IconSet {
  /** The set's name as its makers write it. */
  title: string
  /** Its styles, the one placed when none is asked for first. */
  styles: readonly string[]
  /** The side of the square every drawing is made in. */
  size: number
  /** The style whose drawings are lines of this width, outlined when placed; none when every style is filled. */
  lines?: { style: string; width: number }
  homepage: string
  /** The npm package the drawings, tags and licence are taken from. */
  npm: string
}

/** A sticker set: what it is, its styles and where its files come from. */
export interface StickerSet {
  /** The set's name as its makers write it. */
  title: string
  /** Its styles, each with how it is placed, the one placed when none is asked for first. */
  styles: readonly { name: string; format: StickerFormat }[]
  homepage: string
  /** A GitHub repository at a commit, or the makers' site as read on a day (YYYY-MM-DD). */
  source: { repository: string; commit: string } | { read: string }
  /** The licence's SPDX id. */
  licence: 'MIT' | 'CC0-1.0'
  /** For a set that ships no licence file: who made it and what their site says, written above the CC0 legal code. */
  dedication?: string
  /** The words every sticker of the set is found by, beside its own. */
  tags: readonly string[]
}

export const ICON_SETS: Readonly<Record<IconSetId, IconSet>> = {
  tabler: {
    title: 'Tabler Icons',
    styles: ['outline', 'filled'],
    size: 24,
    lines: { style: 'outline', width: 2 },
    homepage: 'https://tabler.io/icons',
    npm: '@tabler/icons',
  },
  phosphor: {
    title: 'Phosphor Icons',
    styles: ['regular', 'thin', 'light', 'bold', 'fill', 'duotone'],
    size: 256,
    homepage: 'https://phosphoricons.com',
    npm: '@phosphor-icons/core',
  },
}

export const ICON_SET_IDS = Object.keys(ICON_SETS) as IconSetId[]

export const STICKER_SETS: Readonly<Record<StickerSetId, StickerSet>> = {
  'fluent-emoji': {
    title: 'Fluent Emoji',
    styles: [
      { name: '3d', format: 'picture' },
      { name: 'flat', format: 'drawing' },
    ],
    homepage: 'https://github.com/microsoft/fluentui-emoji',
    source: { repository: 'microsoft/fluentui-emoji', commit: '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc' },
    licence: 'MIT',
    tags: ['emoji'],
  },
  'open-peeps': {
    title: 'Open Peeps',
    styles: [{ name: 'drawing', format: 'drawing' }],
    homepage: 'https://www.openpeeps.com',
    source: { read: '2026-11-22' },
    licence: 'CC0-1.0',
    dedication:
      'Open Peeps by Pablo Stanley. Its site, openpeeps.com, says: “Free for commercial and personal use under CC0 License.” Dazbee bundles the Peeps the site offers as SVG files, as read on 2026-11-22.',
    tags: ['person', 'people', 'human', 'character', 'peep', 'hand-drawn', 'illustration'],
  },
  humaaans: {
    title: 'Humaaans',
    styles: [{ name: 'drawing', format: 'drawing' }],
    homepage: 'https://www.humaaans.com',
    source: { read: '2026-11-22' },
    licence: 'CC0-1.0',
    dedication:
      'Humaaans by Pablo Stanley. Its site, humaaans.com, says: “Free for commercial or personal use. CC0 Public Domain License.” Dazbee bundles the illustrations the site shows as SVG files, as read on 2026-11-22.',
    tags: ['person', 'people', 'human', 'character', 'humaaan', 'flat', 'illustration'],
  },
  'open-doodles': {
    title: 'Open Doodles',
    styles: [{ name: 'drawing', format: 'drawing' }],
    homepage: 'https://www.opendoodles.com',
    source: { read: '2026-11-22' },
    licence: 'CC0-1.0',
    dedication:
      'Open Doodles by Pablo Stanley. Its site, opendoodles.com, says: “Free for Commercial and Personal Use. No need to credit, license, or anything.” and marks the doodles CC0 Public Domain. Dazbee bundles the doodles the site offers as SVG files, as read on 2026-11-22.',
    tags: ['doodle', 'person', 'people', 'character', 'hand-drawn', 'illustration'],
  },
}

export const STICKER_SET_IDS = Object.keys(STICKER_SETS) as StickerSetId[]

/** Every bundled set's id, the icon sets first. */
export const GRAPHIC_SET_IDS: readonly GraphicSetId[] = [...ICON_SET_IDS, ...STICKER_SET_IDS]

/** What kind of graphic a set holds. */
export function kindOf(set: GraphicSetId): GraphicKind {
  return Object.hasOwn(ICON_SETS, set) ? 'icon' : 'sticker'
}

/** What a sticker set's files are pinned to, as its notice names the version: a commit's first 7 characters, or the day its site was read. */
export function stickerPin({ source }: StickerSet): string {
  return 'commit' in source ? source.commit.slice(0, 7) : source.read
}

/** How a sticker set's style is placed; undefined when the set has no such style. */
export function stickerFormat(set: StickerSetId, style: string): StickerFormat | undefined {
  return STICKER_SETS[set].styles.find(({ name }) => name === style)?.format
}
