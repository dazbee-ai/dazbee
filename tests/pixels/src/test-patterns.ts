// The patterns as the pixel suite builds them: a stand-in sneaker brand with its kit, logo and photos, each pattern's
// stand-in words, the Google Fonts families the styles pair (`assets/fonts`), and a design holding a pattern at
// every size of the Meta, TikTok and YouTube, and Google Display channels, built by the same agent batch
// apply_pattern runs.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { openSession, plainStore, type Session } from '@dazbee/doc'
import { type AgentBatchWarned, runAgentBatchWithWarnings, whenWarned } from '@dazbee/export'
import {
  buildPatterns,
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

/**
 * Two more stand-in brands, so the patterns are judged on more than one logo and palette: a light-primary brand
 * whose logo is a white wordmark of one colour, and a brand whose logo is a square mark on its own solid box, with a
 * serif heading font of its own.
 */
export const OTHER_BRANDS: readonly { name: string; kit: BrandKit; logo: 'logo-white' | 'logo-boxed' }[] = [
  {
    name: 'light',
    logo: 'logo-white',
    kit: {
      colors: [
        { token: 'primary', name: 'Primary', value: '#FFD23FFF' },
        { token: 'secondary', name: 'Secondary', value: '#2E2A24FF' },
        { token: 'accent', name: 'Accent', value: '#3D5AFEFF' },
        { token: 'background', name: 'Background', value: '#FFFDF5FF' },
        { token: 'text', name: 'Text', value: '#1A1A1AFF' },
      ],
      fonts: [],
      logoAssetId: 'logo-white',
      voice: '',
      textStyles: [],
    },
  },
  {
    name: 'boxed',
    logo: 'logo-boxed',
    kit: {
      colors: [
        { token: 'primary', name: 'Primary', value: '#1F4D3AFF' },
        { token: 'secondary', name: 'Secondary', value: '#E8E2D0FF' },
        { token: 'accent', name: 'Accent', value: '#C8553DFF' },
        { token: 'background', name: 'Background', value: '#F7F4ECFF' },
        { token: 'text', name: 'Text', value: '#1B1B1BFF' },
      ],
      fonts: [{ token: 'heading', name: 'Heading', family: 'DM Serif Display' }],
      logoAssetId: 'logo-boxed',
      voice: '',
      textStyles: [],
    },
  },
]

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
  (['logo', 'logo-white', 'logo-boxed', 'sneaker', 'sneaker-cutout', 'portrait', 'app-screen'] as const).map((id) => [
    id,
    pictureOf(id, fixtureImages[id] ?? new Uint8Array()),
  ]),
) as Record<'logo' | 'logo-white' | 'logo-boxed' | 'sneaker' | 'sneaker-cutout' | 'portrait' | 'app-screen', Picture>

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
  'full-photo': {
    kicker: 'New season',
    headline: 'Made for the long way home',
    highlight: 'long way',
    subline: 'The Stride Air, cushioned for every kilometre.',
    button: 'Shop now',
    photo: PICTURES.sneaker,
    logo: PICTURES.logo,
  },
  'photo-card': {
    kicker: 'Members get 20% off',
    headline: 'Your weekend run starts here',
    subline: 'Join Stride Club for early drops and free returns.',
    button: 'Join free',
    photo: PICTURES.sneaker,
    logo: PICTURES.logo,
  },
  poster: {
    kicker: 'Stride presents',
    headline: 'The city half marathon',
    subline: 'Sunday 7 December, from 5:30 am.',
    button: 'Register now',
    photo: PICTURES.sneaker,
    logo: PICTURES.logo,
  },
  arch: {
    kicker: 'Introducing',
    headline: 'The Stride Air',
    subline: 'Our lightest runner yet, made for the city.',
    button: 'Shop now',
    photo: PICTURES['sneaker-cutout'],
    logo: PICTURES.logo,
  },
  podium: {
    kicker: 'New in',
    headline: 'Stride Air Runner',
    subline: 'Cushioned, light and made to last.',
    button: 'Shop now',
    photo: PICTURES['sneaker-cutout'],
    logo: PICTURES.logo,
  },
  spotlight: {
    kicker: 'Coming soon',
    headline: 'Meet the Stride Air 2',
    subline: 'Lighter and faster, out 1 December.',
    button: 'Get notified',
    photo: PICTURES['sneaker-cutout'],
    logo: PICTURES.logo,
  },
  'price-tag': {
    kicker: 'Best seller',
    headline: 'Stride Air Runner',
    number: '₹4,999',
    subline: 'Free delivery and returns.',
    button: 'Buy now',
    photo: PICTURES['sneaker-cutout'],
    logo: PICTURES.logo,
  },
  coupon: {
    kicker: 'This weekend only',
    badge: '−30%',
    headline: 'Off every pair',
    subline: 'Use code STRIDE30 at checkout.',
    button: 'Shop the sale',
    logo: PICTURES.logo,
  },
  'event-date': {
    kicker: 'Save the date',
    number: '28 Nov',
    headline: 'Our pop-up store opens',
    subline: 'Bandra West, 11 am to 9 pm.',
    button: 'Get directions',
    logo: PICTURES.logo,
  },
  ticket: {
    kicker: 'Stride Run Club',
    number: '28 Nov',
    headline: 'City night run',
    subline: 'Marine Drive, 6 pm. 5 km, every pace.',
    button: 'Get your place',
    logo: PICTURES.logo,
  },
  'app-phone': {
    kicker: 'New app',
    headline: 'Track every run',
    subline: 'Plans, pace and progress in the Stride app.',
    button: 'Get the app',
    photo: PICTURES['app-screen'],
    logo: PICTURES.logo,
  },
  'app-icon': {
    kicker: 'Now on iOS and Android',
    headline: 'Stride Run Club',
    subline: 'Free plans and weekly challenges.',
    button: 'Download free',
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
    const set = buildPatterns(pattern, { style, kit, content, measure }, sizes)
    const layers = sizes.map((size, i) => ({ frame: size, layers: set[i] ?? { nodes: {}, roots: [] } }))
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
