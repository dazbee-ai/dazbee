// The icon sets Dazbee bundles: each one's name, its styles, the square its drawings are made in, where it comes from
// and the npm package `write-icons.ts` takes it from, pinned in this package's devDependencies.

/** An icon set's id, the first part of each of its icons' ids (`tabler/shopping-cart`). */
export type IconSetId = 'tabler' | 'phosphor'

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
