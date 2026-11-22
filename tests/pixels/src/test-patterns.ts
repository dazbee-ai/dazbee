// The patterns as the pixel suite builds them: a stand-in sneaker brand with its kit, logo and photos, each pattern's
// stand-in words, the Google Fonts families the styles pair (`assets/fonts`), and a design holding a pattern at
// every size of the Meta, TikTok and YouTube, and Google Display channels, built by the same agent batch
// apply_pattern runs.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { openSession, plainStore, type Session } from '@dazbee/doc'
import { type AgentBatchWarned, runAgentBatchWithWarnings, whenWarned } from '@dazbee/export'
import {
  buildPattern,
  type PatternContent,
  patternSteps,
  type PatternStyle,
  type Picture,
  pictureLook,
} from '@dazbee/patterns'
import { type ResourceBytes, resourceCache, textMeasure } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type BrandKit, brandVariables, type DesignInput, SIZE_PRESETS } from '@dazbee/schema'

import { ASSETS_DIR, fixtureResources } from './pixels.ts'

export const ck = await loadCanvasKit()

/** The channels every pattern is drawn at each size of. */
const CHANNELS = ['meta', 'tiktok-youtube', 'google'] as const

/** Every size of the channels, each once, in the order the channels list them. */
export const CHANNEL_SIZES: readonly { width: number; height: number }[] = SIZE_PRESETS.filter((preset) =>
  (CHANNELS as readonly string[]).includes(preset.channel),
).filter(
  (preset, i, all) => all.findIndex((other) => other.width === preset.width && other.height === preset.height) === i,
)

/** A stand-in brand: a sneaker maker with an orange, navy and yellow kit and its logo, and no fonts of its own. */
export const STRIDE_KIT: BrandKit = {
  colors: [
    { token: 'primary', name: 'Primary', value: '#FF5A36FF' },
    { token: 'secondary', name: 'Secondary', value: '#14213DFF' },
    { token: 'accent', name: 'Accent', value: '#FFC233FF' },
    { token: 'background', name: 'Background', value: '#FFFFFFFF' },
    { token: 'text', name: 'Text', value: '#14213DFF' },
  ],
  fonts: [],
  logoAssetId: 'logo',
  voice: '',
  textStyles: [],
}

/** A stand-in picture, as apply_pattern gives it: its size, and what it shows read from its pixels. */
export function pictureOf(assetId: string, bytes: Uint8Array): Picture {
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) throw new Error(`no picture in "${assetId}"`)
  try {
    const width = image.width()
    const height = image.height()
    const info = {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    }
    const rgba = image.readPixels(0, 0, info)
    if (!(rgba instanceof Uint8Array)) throw new Error(`no pixels in "${assetId}"`)
    return { assetId, width, height, look: pictureLook(rgba, width, height) }
  } finally {
    image.delete()
  }
}

const fixtureImages = fixtureResources().images

/** The stand-in pictures, as apply_pattern gives them. */
export const PICTURES = Object.fromEntries(
  (['logo', 'sneaker', 'sneaker-cutout', 'portrait'] as const).map((id) => [
    id,
    pictureOf(id, fixtureImages[id] ?? new Uint8Array()),
  ]),
) as Record<'logo' | 'sneaker' | 'sneaker-cutout' | 'portrait', Picture>

/** Each pattern's stand-in words and pictures, as a marketer would give them. */
export const CONTENT: Record<string, PatternContent> = {
  'photo-band': {
    kicker: 'New season',
    headline: 'Run further in lighter shoes',
    highlight: 'lighter',
    subline: 'The Stride Air weighs 210 g and cushions every step.',
    button: 'Shop now',
    photo: PICTURES.sneaker,
    logo: PICTURES.logo,
  },
  split: {
    kicker: 'Just landed',
    headline: 'The Stride Air is here',
    subline: 'Light, springy and made for the city.',
    button: 'Shop the drop',
    photo: PICTURES.sneaker,
    logo: PICTURES.logo,
  },
  'product-badge': {
    kicker: 'Summer sale',
    headline: 'Stride Air',
    subline: 'Lighter than ever, now in four colours.',
    badge: '−30%',
    button: 'Shop now',
    photo: PICTURES['sneaker-cutout'],
    logo: PICTURES.logo,
  },
  'big-number': {
    kicker: 'Weekend sale',
    number: '50%',
    headline: 'Off every pair this weekend',
    subline: 'In store and online, Friday to Sunday.',
    button: 'Shop the sale',
    logo: PICTURES.logo,
  },
  quote: {
    headline: 'The lightest shoes I’ve ever run in.',
    attribution: 'Priya Nair, marathon runner',
    photo: PICTURES.portrait,
    button: 'Read reviews',
    logo: PICTURES.logo,
  },
  'words-only': {
    kicker: 'Members only',
    headline: 'Free delivery on every order',
    highlight: 'Free delivery',
    subline: 'Join Stride Club today. It takes a minute.',
    button: 'Join free',
    logo: PICTURES.logo,
  },
}

/** The family each font file in `assets/fonts` is registered as. */
const FAMILIES: Record<string, string> = {
  'Anton-Regular.ttf': 'Anton',
  'Outfit[wght].ttf': 'Outfit',
  'Fredoka[wdth,wght].ttf': 'Fredoka',
  'DMSerifDisplay-Regular.ttf': 'DM Serif Display',
  'DMSerifDisplay-Italic.ttf': 'DM Serif Display',
  'Jost[wght].ttf': 'Jost',
}

/** The shipped fonts, the styles' families, every stand-in picture and the kit's values. */
export function patternBytes(kit: BrandKit = STRIDE_KIT): ResourceBytes {
  const shipped = fixtureResources()
  const dir = join(ASSETS_DIR, 'fonts')
  const families = readdirSync(dir)
    .filter((file) => file.endsWith('.ttf'))
    .map((file) => ({ family: FAMILIES[file] ?? file, bytes: new Uint8Array(readFileSync(join(dir, file))) }))
  return {
    ...shipped,
    fonts: [...shipped.fonts, ...families],
    variables: brandVariables(kit, kit.logoAssetId ? { id: kit.logoAssetId, contentType: 'image/png' } : undefined),
  }
}

/** A design with one empty page, which a pattern's batch adds its frames to. */
export function emptyDesign(): DesignInput {
  return {
    meta: { designId: 'patterns', name: 'Patterns' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: {},
    nodes: {},
  }
}

/**
 * Builds a pattern in a style at `sizes` in a new design, as apply_pattern does: one frame a size, in one agent
 * batch, with the warnings the batch's frames are told.
 */
export async function builtPattern(
  pattern: string,
  style: PatternStyle,
  sizes: readonly { width: number; height: number }[],
  { kit = STRIDE_KIT, content = CONTENT[pattern] ?? { headline: '' }, bytes = patternBytes(kit) } = {},
): Promise<{ session: Session; result: AgentBatchWarned; bytes: ResourceBytes }> {
  const cache = resourceCache(ck)
  try {
    const measure = textMeasure(ck, cache.resources(bytes))
    const layers = sizes.map((size) => ({
      frame: size,
      layers: buildPattern(pattern, { style, kit, content, ...size, measure }),
    }))
    let next = 0
    const steps = patternSteps('p1', layers, () => `id${(next++).toString(36)}`)
    const session = openSession(plainStore(emptyDesign()))
    const fonts = { fontsLoaded: async () => {}, bytes: () => bytes }
    const result = await whenWarned(runAgentBatchWithWarnings(ck, session, steps, fonts, cache))
    return { session, result, bytes }
  } finally {
    cache.delete()
  }
}
