// The input the patterns' unit tests build with: a measure as a font of even width sets text, a stand-in photo,
// logos and kit, every channel size, and helpers that read the boxes a pattern builds.
import { type BrandKit, EMPTY_BRAND_KIT, type Layer, type Rect, SIZE_PRESETS, type TextProps } from '@dazbee/schema'

import { PATTERNS } from './catalog.ts'
import { PATTERN_STYLES } from './styles.ts'
import type { Measure, PatternContent } from './types.ts'

/** Lays text out as a font whose every character is 0.55 of the size wide would: words wrap at the width. */
export const measure: Measure = (props: TextProps, width: number | null) => {
  const size = props.style.fontSize
  const lineHeight = size * (props.style.lineHeight ?? 1.2)
  const natural = Math.ceil(props.text.length * size * 0.55)
  if (width === null) return { width: natural, height: lineHeight }
  let lines = 1
  let line = 0
  for (const word of props.text.split(/\s+/)) {
    const wide = (word.length + 1) * size * 0.55
    if (line > 0 && line + wide > width) {
      lines++
      line = 0
    }
    line += wide
  }
  return { width, height: lines * lineHeight }
}

export const picture = { assetId: 'photo', width: 1600, height: 1000 }
export const logo = { assetId: 'logo', width: 600, height: 160 }
/** Content every pattern can be built from. */
export const CONTENT: PatternContent = {
  kicker: 'New season',
  headline: 'Run further in lighter shoes',
  highlight: 'lighter',
  subline: 'Light and springy.',
  button: 'Shop now',
  badge: '−30%',
  number: '50%',
  attribution: 'Priya, runner',
  photo: picture,
  logo,
}
export const KIT: BrandKit = {
  ...EMPTY_BRAND_KIT,
  colors: [{ token: 'primary', name: 'Primary', value: '#0A7A3FFF' }],
  fonts: [{ token: 'heading', name: 'Heading', family: 'Brand Sans' }],
  logoAssetId: 'logo',
}
/** A size of each shape a pattern arranges itself for. */
/** Every size of the Meta, TikTok and YouTube, and Google Display channels, each once. */
export const CHANNEL_SIZES = SIZE_PRESETS.filter((preset) =>
  ['meta', 'tiktok-youtube', 'google'].includes(preset.channel),
).filter(
  (preset, i, all) => all.findIndex((other) => other.width === preset.width && other.height === preset.height) === i,
)
/** A logo's look: a bright mark and a dark wordmark, as read from its pixels. */
export const TWO_INKS = {
  subject: { x: 0, y: 0, width: 600, height: 160 },
  inks: [
    { colour: '#FF5A36FF', share: 0.5 },
    { colour: '#14213DFF', share: 0.42 },
  ],
}
/** A white wordmark of one ink, as read from its pixels. */
export const WHITE_MARK = {
  assetId: 'logo-white',
  width: 430,
  height: 135,
  look: { subject: { x: 10, y: 10, width: 410, height: 115 }, inks: [{ colour: '#FFFFFFFF', share: 1 }] },
}
/** A square mark on a box of its own, as read from its pixels. */
export const BOXED = {
  assetId: 'logo-boxed',
  width: 400,
  height: 400,
  look: {
    subject: { x: 104, y: 100, width: 196, height: 200 },
    backdrop: '#1F4D3AFF',
    edge: '#1F4D3AFF',
    inks: [{ colour: '#F7F4ECFF', share: 1 }],
  },
}
/** Every pattern in every style. */
export const EVERY = PATTERNS.flatMap((pattern) => PATTERN_STYLES.map((style) => [pattern.id, style] as const))
export const SIZES = [
  [1080, 1080],
  [1080, 1920],
  [1280, 720],
  [970, 250],
  [728, 90],
  [160, 600],
] as const

/** Whether `inner` lies inside `outer`, to a pixel. */
export const within = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1

/** The area two boxes share. */
export const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/** Whether two boxes share any area. */
export const meets = (a: Rect, b: Rect) => overlap(a, b) > 0

/** The text layers of a tree. */
export const texts = (nodes: Record<string, Layer>) =>
  Object.entries(nodes).flatMap(([key, node]) => (node.type === 'text' ? [[key, node] as const] : []))
