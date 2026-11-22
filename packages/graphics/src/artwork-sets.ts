// The artwork sets Dazbee bundles beside its icons, stickers and illustrations: objects, 3D objects, shapes,
// hand-drawn accents, effects and backgrounds. Each set's name, kind, styles, licence and where its files come from:
// a GitHub repository's folder at a commit, read from its archive; files at links under one prefix, listed from a
// repository at a commit or on a day; or a zip file its makers offer, pinned by its SHA-256. `write-artwork.ts` lists
// every file with its SHA-256 in `artwork.json`, and the API's `artwork:upload` stores the files.

/** An artwork set's id, the first part of each of its graphics' ids (`coolshapes/star-1`). */
export type ArtworkSetId =
  | 'streamline-kameleon'
  | 'streamline-plump'
  | 'streamline-freehand'
  | 'streamline-stickies'
  | '3dicons'
  | 'coolshapes'
  | 'dddoodle'
  | 'kenney-particles'
  | 'kenney-smoke'
  | 'pattern-monster'

/**
 * What an artwork set holds: objects (colour drawings of things), 3D objects (rendered pictures), shapes, hand-drawn
 * accents (arrows, underlines, circles), effects (light, sparks and smoke pictures) and backgrounds (patterns).
 */
export type ArtworkKind = 'object' | '3d' | 'shape' | 'accent' | 'effect' | 'background'

/** Where an artwork set's files come from. */
export type ArtworkSource =
  /** A repository's folder at a commit, read from its GitHub archive; for a pattern set, the file its patterns are in. */
  | { repository: string; commit: string; folder: string }
  /** Files at links that start with `files`, listed from a repository at a commit, or on the day they were read. */
  | { files: string; listed: { repository: string; commit: string } | { read: string } }
  /** A zip file at a link, pinned by its SHA-256, its files in `folder`, read on a day. */
  | { zip: string; sha256: string; folder: string; read: string }

/** An artwork set: what it is, how its files are placed, its licence and where its files come from. */
export interface ArtworkSet {
  /** The set's name as its makers write it, with the style when they draw in several. */
  title: string
  /** Who made the set, and their site, which the notices page credits. */
  creator: { name: string; url: string }
  kind: ArtworkKind
  /** An SVG file, placed as editable layers, or a PNG picture, placed as an image. */
  format: 'svg' | 'png'
  /** Its styles, the one placed when none is asked for first. */
  styles: readonly string[]
  homepage: string
  source: ArtworkSource
  /** The licence's name as a notice names it, its SPDX id, and the page its text is read from. */
  licence: { name: string; spdx: 'CC-BY-4.0' | 'CC0-1.0' | 'MIT'; url: string }
  /** For a set whose source ships no licence file: where its makers give its licence, which its notice quotes. */
  statement?: string
  /**
   * For a set drawn in one or a few colours, the colours a colour given takes the place of (as its files write them,
   * any case): the first is written as the colour given, and each other as the same mix of it with white or black as
   * it is of the first. A set without them keeps its own colours.
   */
  paints?: readonly string[]
  /**
   * Whether the set's filters only roughen a drawing's edges, so a file is placed without them; a file of another set
   * whose filters the SVG reader can't read is left out.
   */
  roughEdges?: boolean
  /** The words every graphic of the set is found by, beside its own. */
  tags: readonly string[]
}

/** The kinds an artwork set may hold, each once. */
export const ARTWORK_KINDS = Object.keys({
  object: true,
  '3d': true,
  shape: true,
  accent: true,
  effect: true,
  background: true,
} satisfies Record<ArtworkKind, true>) as ArtworkKind[]
/** 3dicons' colour styles and camera angles; each picture is one of each (`color-dynamic`). */
export const THREE_D_COLOURS = ['color', 'gradient', 'clay', 'premium'] as const
export const THREE_D_ANGLES = ['dynamic', 'front', 'iso'] as const

/** Streamline's repository of free sets, at the commit every Streamline set is pinned to. */
const STREAMLINE = { repository: 'webalys-hq/streamline-vectors', commit: '52d750c9ce051e51cb181b7a78932120c48541d0' }
const STREAMLINE_CREATOR = { name: 'Streamline', url: 'https://www.streamlinehq.com' }
const CC_BY = { name: 'CC BY 4.0', spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } as const
const CC0 = { name: 'CC0 1.0', spdx: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } as const
const KENNEY = { name: 'Kenney', url: 'https://kenney.nl' }

export const ARTWORK_SETS: Readonly<Record<ArtworkSetId, ArtworkSet>> = {
  'streamline-kameleon': {
    title: 'Streamline Kameleon',
    creator: STREAMLINE_CREATOR,
    kind: 'object',
    format: 'svg',
    styles: ['colour'],
    homepage: 'https://www.streamlinehq.com/icons/kameleon',
    source: { ...STREAMLINE, folder: 'kameleon/colors' },
    licence: CC_BY,
    tags: ['object', 'colour', 'flat', 'circle'],
  },
  'streamline-plump': {
    title: 'Streamline Plump',
    creator: STREAMLINE_CREATOR,
    kind: 'object',
    format: 'svg',
    styles: ['colour'],
    homepage: 'https://www.streamlinehq.com/icons/plump',
    source: { ...STREAMLINE, folder: 'plump/flat' },
    licence: CC_BY,
    paints: ['#2859c5', '#8fbffa'],
    tags: ['object', 'colour', 'rounded'],
  },
  'streamline-freehand': {
    title: 'Streamline Freehand',
    creator: STREAMLINE_CREATOR,
    kind: 'object',
    format: 'svg',
    styles: ['colour'],
    homepage: 'https://www.streamlinehq.com/icons/freehand-sets',
    source: { ...STREAMLINE, folder: 'freehand/duotone' },
    licence: CC_BY,
    paints: ['#0c6fff'],
    tags: ['object', 'colour', 'hand-drawn', 'sketch'],
  },
  'streamline-stickies': {
    title: 'Streamline Stickies',
    creator: STREAMLINE_CREATOR,
    kind: 'object',
    format: 'svg',
    styles: ['colour'],
    homepage: 'https://www.streamlinehq.com/icons/stickies',
    source: { ...STREAMLINE, folder: 'stickies/colors' },
    licence: CC_BY,
    tags: ['object', 'colour', 'playful', 'outline'],
  },
  '3dicons': {
    title: '3dicons',
    creator: { name: 'Vijay Verma', url: 'https://3dicons.co' },
    kind: '3d',
    format: 'png',
    styles: THREE_D_COLOURS.flatMap((colour) => THREE_D_ANGLES.map((angle) => `${colour}-${angle}`)),
    homepage: 'https://3dicons.co',
    source: {
      files: 'https://pub-821312cfd07a4061bf7b99c1f23ed29b.r2.dev/v1/',
      listed: { repository: 'realvjy/3dicons', commit: '8884d59e68a7bae0e0e2163af5b6c2ad992c01c8' },
    },
    licence: CC0,
    tags: ['3d', 'render', 'object'],
  },
  coolshapes: {
    title: 'Coolshapes',
    creator: { name: 'Coolshapes', url: 'https://coolshap.es' },
    kind: 'shape',
    format: 'svg',
    styles: ['solid'],
    homepage: 'https://coolshap.es',
    source: {
      repository: 'realvjy/coolshapes',
      commit: 'de6c8f97ff8dac8e56cb9560c119f443645c7a3f',
      folder: 'public/shapes/svg',
    },
    licence: { name: 'MIT', spdx: 'MIT', url: 'https://github.com/realvjy/coolshapes/blob/main/LICENSE.md' },
    paints: ['white'],
    tags: ['shape', 'abstract', 'geometric'],
  },
  dddoodle: {
    title: 'dddoodle',
    creator: { name: 'fffuel', url: 'https://www.fffuel.co' },
    kind: 'accent',
    format: 'svg',
    styles: ['hand-drawn'],
    homepage: 'https://www.fffuel.co/dddoodle/',
    source: {
      zip: 'https://www.fffuel.co/files/dddoodle-pack.zip',
      sha256: '4c1c07c5f583c303ed398e41a2e12bb7816d0b284b8c7e4f1fefde39f1bb82cc',
      folder: 'dddoodle-pack',
      read: '2026-11-22',
    },
    licence: CC_BY,
    paints: ['#000', 'black', 'currentColor', '#000000'],
    roughEdges: true,
    tags: ['accent', 'doodle', 'hand-drawn', 'scribble', 'sketch'],
  },
  'kenney-particles': {
    title: 'Kenney Particle Pack',
    creator: KENNEY,
    kind: 'effect',
    format: 'png',
    styles: ['light'],
    homepage: 'https://kenney.nl/assets/particle-pack',
    source: {
      repository: 'Calinou/kenney-particle-pack',
      commit: 'ab7086639ee73be31abd87feb21bf1402d4e8144',
      folder: 'addons/kenney_particle_pack',
    },
    licence: CC0,
    tags: ['effect', 'particle', 'glow', 'light'],
  },
  'kenney-smoke': {
    title: 'Kenney Smoke Particles',
    creator: KENNEY,
    kind: 'effect',
    format: 'png',
    styles: ['smoke'],
    homepage: 'https://kenney.nl/assets/smoke-particles',
    statement:
      'Kenney’s page for the pack, https://kenney.nl/assets/smoke-particles, read on 2026-11-22, gives its licence as “Creative Commons CC0”. The copy Dazbee takes the files from ships no licence file.',
    source: {
      files:
        'https://raw.githubusercontent.com/Poipoise/Deadly-Faith/ea19f5b3ce8c4c01027b2fb9389f82cf293779c1/kenney_smoke-particles/PNG/',
      listed: { repository: 'Poipoise/Deadly-Faith', commit: 'ea19f5b3ce8c4c01027b2fb9389f82cf293779c1' },
    },
    licence: CC0,
    tags: ['effect', 'particle', 'smoke', 'cloud'],
  },
  'pattern-monster': {
    title: 'Pattern Monster',
    creator: { name: 'Pattern Monster', url: 'https://pattern.monster' },
    kind: 'background',
    format: 'svg',
    styles: ['pattern'],
    homepage: 'https://pattern.monster',
    source: {
      repository: 'catchspider2002/svelte-svg-patterns',
      commit: '803e30bfde106cf094581aabfc80ced2062c5ab7',
      folder: 'src/routes/_index.js',
    },
    licence: {
      name: 'MIT',
      spdx: 'MIT',
      url: 'https://github.com/catchspider2002/svelte-svg-patterns/blob/master/LICENSE.md',
    },
    tags: ['background', 'pattern', 'seamless', 'texture'],
  },
}

export const ARTWORK_SET_IDS = Object.keys(ARTWORK_SETS) as ArtworkSetId[]

/** Whether a set is an artwork set. */
export function isArtworkSet(set: string): set is ArtworkSetId {
  return Object.hasOwn(ARTWORK_SETS, set)
}

/**
 * What an artwork set's files are pinned to, as its notice names the version: a commit's first 7 characters, or the
 * day its pack or links were read.
 */
export function artworkPinOf({ source }: Pick<ArtworkSet, 'source'>): string {
  if ('repository' in source) return source.commit.slice(0, 7)
  if ('zip' in source) return source.read
  return 'commit' in source.listed ? source.listed.commit.slice(0, 7) : source.listed.read
}
