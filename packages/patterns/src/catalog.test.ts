import { describe, expect, it } from 'vitest'

import {
  type BrandKit,
  EMPTY_BRAND_KIT,
  type Layer,
  readableTextSize,
  type Rect,
  SIZE_PRESETS,
  type TextProps,
} from '@dazbee/schema'

import { buildPattern, findPattern, PATTERNS } from './catalog.ts'
import { UNDERLINED_LEADING } from './headline-runs.ts'
import { contrast } from './palette.ts'
import { PATTERN_STYLES } from './styles.ts'
import type { Measure, PatternContent } from './types.ts'

/** Lays text out as a font whose every character is 0.55 of the size wide would: words wrap at the width. */
const measure: Measure = (props: TextProps, width: number | null) => {
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

const picture = { assetId: 'photo', width: 1600, height: 1000 }
const logo = { assetId: 'logo', width: 600, height: 160 }
/** Content every pattern can be built from. */
const CONTENT: PatternContent = {
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
const KIT: BrandKit = {
  ...EMPTY_BRAND_KIT,
  colors: [{ token: 'primary', name: 'Primary', value: '#0A7A3FFF' }],
  fonts: [{ token: 'heading', name: 'Heading', family: 'Brand Sans' }],
  logoAssetId: 'logo',
}
/** A size of each shape a pattern arranges itself for. */
/** Every size of the Meta, TikTok and YouTube, and Google Display channels, each once. */
const CHANNEL_SIZES = SIZE_PRESETS.filter((preset) =>
  ['meta', 'tiktok-youtube', 'google'].includes(preset.channel),
).filter(
  (preset, i, all) => all.findIndex((other) => other.width === preset.width && other.height === preset.height) === i,
)
/** A logo's look: a bright mark and a dark wordmark, as read from its pixels. */
const TWO_INKS = {
  subject: { x: 0, y: 0, width: 600, height: 160 },
  inks: [
    { colour: '#FF5A36FF', share: 0.5 },
    { colour: '#14213DFF', share: 0.42 },
  ],
}
/** Every pattern in every style. */
const EVERY = PATTERNS.flatMap((pattern) => PATTERN_STYLES.map((style) => [pattern.id, style] as const))
const SIZES = [
  [1080, 1080],
  [1080, 1920],
  [1280, 720],
  [970, 250],
  [728, 90],
  [160, 600],
] as const

/** Whether `inner` lies inside `outer`, to a pixel. */
const within = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1

/** The area two boxes share. */
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/** Whether two boxes share any area. */
const meets = (a: Rect, b: Rect) => overlap(a, b) > 0

/** The text layers of a tree. */
const texts = (nodes: Record<string, Layer>) =>
  Object.entries(nodes).flatMap(([key, node]) => (node.type === 'text' ? [[key, node] as const] : []))

describe('buildPattern', () => {
  it.each(PATTERNS.flatMap((pattern) => PATTERN_STYLES.map((style) => [pattern.id, style] as const)))(
    'builds %s in the %s style at every shape with its texts inside the frame, none under the readable size',
    (id, style) => {
      for (const [width, height] of SIZES) {
        const { nodes, roots } = buildPattern(id, { style, kit: KIT, content: CONTENT, width, height, measure })
        expect(roots.length).toBeGreaterThan(0)
        for (const [key, node] of texts(nodes)) {
          const { x, y, width: w, height: h, style: look } = node.props
          expect({ key, x: x >= 0, y: y >= 0, right: x + w <= width, bottom: y + h <= height }).toEqual({
            key,
            x: true,
            y: true,
            right: true,
            bottom: true,
          })
          expect(look.fontSize).toBeGreaterThanOrEqual(Math.floor(readableTextSize(width, height)))
        }
      }
    },
  )

  it('binds the colours, fonts and logo to the brand roles, with the kit’s values where it sets them', () => {
    const { nodes } = buildPattern('words-only', {
      style: 'bold',
      kit: KIT,
      content: CONTENT,
      width: 1080,
      height: 1080,
      measure,
    })
    expect(nodes.ground?.bindings).toEqual({ fill: 'brand:primary' })
    expect(nodes.ground?.props).toMatchObject({ fills: [{ type: 'solid', color: '#0A7A3FFF' }] })
    expect(nodes.headline?.bindings).toMatchObject({ fontFamily: 'brand:heading' })
    expect(nodes.headline?.props).toMatchObject({ style: { fontFamily: 'Brand Sans' } })
    // The body font isn't set in the kit: the style's own is used, still bound to the brand role.
    expect(nodes.subline?.bindings).toMatchObject({ fontFamily: 'brand:body' })
    expect(nodes.subline?.props).toMatchObject({ style: { fontFamily: 'Outfit' } })
    expect(nodes.logo).toMatchObject({ role: 'logo', bindings: { image: 'brand:logo' } })
  })

  it('binds a logo to the Logo brand role only when it is the kit’s logo', () => {
    const { nodes } = buildPattern('words-only', {
      style: 'bold',
      kit: KIT,
      content: { ...CONTENT, logo: { ...logo, assetId: 'other' } },
      width: 1080,
      height: 1080,
      measure,
    })
    expect(nodes.logo?.role).toBe('logo')
    expect(nodes.logo?.bindings).toBeUndefined()
  })

  it('sets a split’s photo beside its words in a wide frame, where photo with a band sets it on top', () => {
    const photo = { ...picture, look: { subject: { x: 300, y: 450, width: 1000, height: 400 }, inks: [] } }
    for (const style of PATTERN_STYLES) {
      const at = (id: string) =>
        buildPattern(id, { style, kit: KIT, content: { ...CONTENT, photo }, width: 1280, height: 720, measure }).nodes
      const split = at('split')
      const shown = split.photo?.props
      const words = split.headline?.props
      expect({ style, beside: Boolean(shown && words && shown.x + shown.width <= words.x) }).toEqual({
        style,
        beside: true,
      })
      expect({ style, top: (at('photo-band').photo?.props.height ?? 720) < 720 }).toEqual({ style, top: true })
    }
  })

  it('arranges each size for its shape: the photo beside the band in a wide frame, under it in a square', () => {
    const at = (width: number, height: number) =>
      buildPattern('photo-band', { style: 'minimal', kit: KIT, content: CONTENT, width, height, measure }).nodes
    const square = at(1080, 1080)
    const wide = at(1280, 720)
    expect(square.photo?.props).toMatchObject({ x: 0, y: 0, width: 1080 })
    expect((square.photo?.props.height ?? 0) < 1080).toBe(true)
    expect(wide.photo?.props).toMatchObject({ y: 0, height: 720 })
    expect((wide.photo?.props.x ?? 0) > 0).toBe(true)
  })

  it('names its layers by what they hold, never by the pattern', () => {
    for (const pattern of PATTERNS) {
      const { nodes } = buildPattern(pattern.id, {
        style: 'playful',
        kit: EMPTY_BRAND_KIT,
        content: CONTENT,
        width: 1080,
        height: 1350,
        measure,
      })
      // The parts' keys become new ids and link ids when they are placed; the names and roles stay.
      const kept = JSON.stringify(Object.values(nodes).map(({ name, role }) => [name, role]))
      expect(kept).not.toContain(pattern.id)
      expect(kept).not.toContain(pattern.name)
    }
  })

  it.each(PATTERNS.flatMap((pattern) => PATTERN_STYLES.map((style) => [pattern.id, style] as const)))(
    'sets %s in the %s style with its lead over its button and a number over its headline, at every shape',
    (id, style) => {
      // A headline is at least 1.5 times its button label's size, 1.3 times in a style that slants its highlight.
      const over = style === 'premium' ? 1.3 : 1.5
      for (const [width, height] of SIZES) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content: CONTENT, width, height, measure })
        const size = (key: string) => {
          const node = nodes[key]
          return node?.type === 'text' ? node.props.style.fontSize : 0
        }
        const label = size('button-label')
        const lead = Math.max(size('headline'), size('number'))
        if (label > 0) expect({ width, height, ok: lead >= label * over - 1 }).toEqual({ width, height, ok: true })
        // A short frame sets its number beside its words, where it needn't be twice the headline.
        if (nodes.number && height > 100)
          expect({ width, height, ok: size('number') >= size('headline') * 2 }).toEqual({ width, height, ok: true })
      }
    },
  )

  it('crops the photo to its subject at every channel size: the subject shows whole, and the logo is clear of it', () => {
    const photo = { ...picture, look: { subject: { x: 300, y: 450, width: 1000, height: 400 }, inks: [] } }
    for (const { width, height } of CHANNEL_SIZES)
      for (const id of ['photo-band', 'split'])
        for (const style of PATTERN_STYLES) {
          const { nodes } = buildPattern(id, {
            style,
            kit: KIT,
            content: { ...CONTENT, photo },
            width,
            height,
            measure,
          })
          const layer = nodes.photo
          const fill = layer?.type === 'graphic' ? layer.props.fills[0] : undefined
          // A frame that can't show the subject whole leaves the photo out; the square, story and wide ones show it.
          if (!layer && height <= 100) continue
          if (!layer || fill?.type !== 'image' || !fill.crop) throw new Error(`${id} has no cropped photo`)
          const { crop } = fill
          const scale = layer.props.width / crop.width
          const subject = {
            x: layer.props.x + (photo.look.subject.x - crop.x) * scale,
            y: layer.props.y + (photo.look.subject.y - crop.y) * scale,
            width: photo.look.subject.width * scale,
            height: photo.look.subject.height * scale,
          }
          const at = `${id} ${style} ${width}×${height}`
          expect({ at, inside: within(subject, layer.props) }).toEqual({ at, inside: true })
          const mark = nodes.logo?.props
          if (mark) expect({ at, clear: !meets(mark, subject) }).toEqual({ at, clear: true })
        }
  })

  it('puts the product badge on the product’s corner, over no more than a share of it and none of its middle', () => {
    for (const [width, height] of SIZES)
      for (const style of PATTERN_STYLES) {
        const { nodes } = buildPattern('product-badge', { style, kit: KIT, content: CONTENT, width, height, measure })
        const product = nodes.product?.props
        const badge = nodes['badge-shape']?.props
        if (!product || !badge) continue
        const shared = overlap(product, badge)
        const middle = { ...product, x: product.x + product.width / 3, width: product.width / 3 }
        const at = `${style} ${width}×${height}`
        expect({ at, share: shared <= product.width * product.height * 0.2 }).toEqual({ at, share: true })
        expect({ at, middle: overlap(middle, badge) }).toEqual({ at, middle: 0 })
      }
  })

  it('sets the headline’s highlight apart without a slant its font hasn’t got', () => {
    // A kit whose colours don't read on the ground, with the style's own Anton, which has no italic.
    const kit = { ...EMPTY_BRAND_KIT, colors: [{ token: 'accent', name: 'Accent', value: '#FFFFFFFF' }] }
    const { nodes } = buildPattern('words-only', {
      style: 'bold',
      kit: kit as BrandKit,
      content: { headline: 'Free delivery on every order', highlight: 'Free delivery' },
      width: 1080,
      height: 1080,
      measure,
    })
    const headline = nodes.headline
    if (headline?.type !== 'text') throw new Error('no headline')
    expect(headline.props.runs.map((run) => run.style.fontStyle)).not.toContain('italic')
    expect(headline.props.runs).toHaveLength(1)
    // The words set apart stay on one line: the space between them doesn't break.
    expect(headline.props.text).toBe('Free delivery on every order')
  })

  it('draws a logo of one colour in the ground’s ink, and one with its own box on a label of the box’s colour', () => {
    const ink = { subject: { x: 0, y: 0, width: 600, height: 160 }, inks: [{ colour: '#111111FF', share: 1 }] }
    const boxed = { ...ink, backdrop: '#FFFFFFFF', inks: [{ colour: '#FF0000FF', share: 1 }] }
    const at = (look: typeof ink) =>
      buildPattern('words-only', {
        style: 'premium',
        kit: KIT,
        content: { ...CONTENT, logo: { ...logo, look } },
        width: 1080,
        height: 1080,
        measure,
      }).nodes
    const mono = at(ink)
    expect(mono.logo).toMatchObject({ type: 'box', role: 'logo' })
    expect(mono['logo-shape']?.props).toMatchObject({ mask: 'alpha' })
    expect(mono['logo-label']).toBeUndefined()
    const label = at(boxed)['logo-label']
    expect(label?.props).toMatchObject({ fills: [{ type: 'solid', color: '#FFFFFFFF' }] })
  })

  it.each(EVERY)(
    'keeps the logo in %s in the %s style at every channel size, the smallest banners too',
    (id, style) => {
      for (const { width, height } of CHANNEL_SIZES) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content: CONTENT, width, height, measure })
        expect({ width, height, logo: nodes.logo?.role }).toEqual({ width, height, logo: 'logo' })
      }
    },
  )

  it.each(EVERY)(
    'sets %s in the %s style in a short frame in two lines a text at most, clear of the edges by a tenth of the height',
    (id, style) => {
      for (const { width, height } of CHANNEL_SIZES.filter((size) => size.height <= 100)) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content: CONTENT, width, height, measure })
        for (const [key, node] of texts(nodes)) {
          if (node.role === 'decoration' || key === 'button-label' || key === 'badge') continue
          const { y, height: h, style: look } = node.props
          const lines = Math.round(h / (look.fontSize * (look.lineHeight ?? 1.2)))
          const at = `${key} ${width}×${height}`
          expect({ at, lines: lines <= 2 }).toEqual({ at, lines: true })
          const clear = y >= height * 0.1 - 0.5 && y + h <= height * 0.9 + 0.5
          expect({ at, clear }).toEqual({ at, clear: true })
        }
      }
    },
  )

  it.each(EVERY)(
    'leads %s in the %s style on a display size with its message: 1.6 times the button label, over a larger block',
    (id, style) => {
      const display = CHANNEL_SIZES.filter(({ width, height }) => width < 1000 && height < 1000 && height > 100)
      for (const { width, height } of display) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content: CONTENT, width, height, measure })
        const lead = nodes.number ?? nodes.headline
        const label = nodes['button-label']
        const button = nodes.button?.props
        if (lead?.type !== 'text' || label?.type !== 'text' || !button) continue
        const at = `${width}×${height}`
        const leadSize = lead.props.style.fontSize
        expect({ at, over: leadSize >= label.props.style.fontSize * 1.6 - 1 }).toEqual({ at, over: true })
        const block = Math.min(lead.props.width, measure(lead.props, null).width) * lead.props.height
        expect({ at, larger: block > button.width * button.height }).toEqual({ at, larger: true })
      }
    },
  )

  it.each(PATTERN_STYLES)('marks a quote as a quote in the %s style at every channel size', (style) => {
    for (const { width, height } of CHANNEL_SIZES) {
      const { nodes } = buildPattern('quote', { style, kit: KIT, content: CONTENT, width, height, measure })
      const marked = texts(nodes).some(([, node]) => node.props.text.includes('“'))
      expect({ width, height, marked }).toEqual({ width, height, marked: true })
    }
  })

  it('keeps the subline at the main social sizes in every style wherever the bold style keeps it', () => {
    // A photo whose subject was read from its pixels, as apply_pattern gives it.
    const READ = {
      ...CONTENT,
      photo: { ...picture, look: { subject: { x: 300, y: 450, width: 1000, height: 400 }, inks: [] } },
    }
    for (const [width, height] of [
      [1080, 1080],
      [1080, 1350],
      [1280, 720],
    ] as const)
      for (const pattern of PATTERNS) {
        const has = (style: (typeof PATTERN_STYLES)[number]) =>
          Boolean(buildPattern(pattern.id, { style, kit: KIT, content: READ, width, height, measure }).nodes.subline)
        if (!has('bold')) continue
        for (const style of PATTERN_STYLES)
          expect([pattern.id, style, width, has(style)]).toEqual([pattern.id, style, width, true])
      }
  })

  it('holds a tracked attribution to the quote’s widest line', () => {
    for (const style of ['minimal', 'premium'] as const)
      for (const [width, height] of [
        [1080, 1080],
        [1280, 720],
      ] as const) {
        const content = { ...CONTENT, headline: 'Light and quick', attribution: 'Priya Nair, marathon runner' }
        const { nodes } = buildPattern('quote', { style, kit: KIT, content, width, height, measure })
        const quote = nodes.headline
        const by = nodes.attribution
        if (quote?.type !== 'text') throw new Error('no quote')
        if (by?.type !== 'text') continue
        const lines = Math.round(
          quote.props.height / (quote.props.style.fontSize * (quote.props.style.lineHeight ?? 1.2)),
        )
        const line = Math.min(quote.props.width, measure(quote.props, null).width / lines)
        const set = Math.min(by.props.width, measure(by.props, null).width)
        expect({ style, width, held: set <= line + 1 }).toEqual({ style, width, held: true })
      }
  })

  it('sets an underlined highlight with the leading its rule needs to clear the next line', () => {
    // A ground no colour of the kit reads on as small text, at a size where the headline is small text.
    const kit = {
      ...EMPTY_BRAND_KIT,
      colors: [
        { token: 'primary', name: 'Primary', value: '#7A7A7AFF' },
        { token: 'accent', name: 'Accent', value: '#8A8A8AFF' },
        { token: 'secondary', name: 'Secondary', value: '#6F6F6FFF' },
        { token: 'text', name: 'Text', value: '#000000FF' },
        { token: 'background', name: 'Background', value: '#7F7F7FFF' },
      ],
    }
    const { nodes } = buildPattern('words-only', {
      style: 'bold',
      kit: kit as BrandKit,
      content: { headline: 'Free delivery on every order and more', highlight: 'Free delivery' },
      width: 300,
      height: 600,
      measure,
    })
    const headline = nodes.headline
    if (headline?.type !== 'text') throw new Error('no headline')
    expect(headline.props.runs.some((run) => run.style.underline)).toBe(true)
    expect(headline.props.style.lineHeight).toBeGreaterThanOrEqual(UNDERLINED_LEADING)
  })

  it('sets a highlight in a colour that reads on the ground as large text does, before an underline', () => {
    const { nodes } = buildPattern('words-only', {
      style: 'bold',
      kit: KIT,
      content: { headline: 'Free delivery on every order', highlight: 'Free delivery' },
      width: 1080,
      height: 1080,
      measure,
    })
    const headline = nodes.headline
    if (headline?.type !== 'text') throw new Error('no headline')
    expect(headline.props.runs.some((run) => run.style.underline)).toBe(false)
    expect(headline.props.runs.some((run) => run.style.color)).toBe(true)
  })

  it('sets a logo’s label in a colour both its inks read on at 3:1, with no brand kit', () => {
    for (const id of PATTERNS.map((pattern) => pattern.id))
      for (const style of PATTERN_STYLES)
        for (const { width, height } of CHANNEL_SIZES) {
          const { nodes } = buildPattern(id, {
            style,
            kit: EMPTY_BRAND_KIT,
            content: { ...CONTENT, logo: { ...logo, look: TWO_INKS } },
            width,
            height,
            measure,
          })
          const label = nodes['logo-label']
          if (label?.type !== 'graphic') continue
          const paint = label.props.fills[0]
          const colour = paint?.type === 'solid' ? paint.color : '#000000FF'
          const at = `${id} ${style} ${width}×${height}`
          for (const ink of TWO_INKS.inks)
            expect({ at, ink: ink.colour, reads: contrast(ink.colour, colour) >= 3 }).toEqual({
              at,
              ink: ink.colour,
              reads: true,
            })
        }
  })

  it('draws a logo of two inks as it is on a ground a shade off white, as on white', () => {
    for (const background of ['#FFFFFFFF', '#FAF8F4FF']) {
      const kit = { ...KIT, colors: [{ token: 'background' as const, name: 'Background', value: background }] }
      const { nodes } = buildPattern('words-only', {
        style: 'minimal',
        kit,
        content: { ...CONTENT, logo: { ...logo, look: TWO_INKS } },
        width: 1080,
        height: 1080,
        measure,
      })
      expect({ background, label: nodes['logo-label'] }).toEqual({ background, label: undefined })
    }
  })

  it('sets a product badge’s offer at the headline’s size at least, in a heavy face, a sixth of the frame wide', () => {
    for (const style of PATTERN_STYLES) {
      const { nodes } = buildPattern('product-badge', {
        style,
        kit: EMPTY_BRAND_KIT,
        content: CONTENT,
        width: 1080,
        height: 1080,
        measure,
      })
      const badge = nodes.badge
      const headline = nodes.headline
      const shape = nodes['badge-shape']?.props
      if (badge?.type !== 'text' || headline?.type !== 'text' || !shape) throw new Error('no badge')
      expect({ style, size: badge.props.style.fontSize >= headline.props.style.fontSize }).toEqual({
        style,
        size: true,
      })
      expect({ style, heavy: badge.props.style.fontWeight >= (style === 'bold' ? 400 : 700) }).toEqual({
        style,
        heavy: true,
      })
      expect({ style, wide: shape.width >= 1080 * 0.16 - 1 }).toEqual({ style, wide: true })
    }
  })

  it('sets a short frame’s offer as a chip beside its words, with the product whole inside the frame', () => {
    for (const style of PATTERN_STYLES)
      for (const [width, height] of [
        [320, 50],
        [728, 90],
      ] as const) {
        const { nodes } = buildPattern('product-badge', { style, kit: KIT, content: CONTENT, width, height, measure })
        const chip = nodes['badge-shape']?.props
        if (!chip) throw new Error('no chip')
        expect({ style, width, before: chip.x + chip.width <= (nodes.words?.props.x ?? 0) + 1 }).toEqual({
          style,
          width,
          before: true,
        })
        const product = nodes.product?.props
        if (product) expect(within(product, { x: 0, y: 0, width, height })).toBe(true)
      }
  })

  it('refuses a pattern there isn’t and content a pattern needs', () => {
    const input = { style: 'bold' as const, kit: KIT, width: 1080, height: 1080, measure }
    expect(() => buildPattern('nope', { ...input, content: CONTENT })).toThrow('no pattern "nope"')
    expect(() => buildPattern('big-number', { ...input, content: { headline: 'Sale' } })).toThrow('needs number')
  })

  it('builds at every channel size the app offers', () => {
    for (const { width, height } of SIZE_PRESETS)
      expect(() =>
        buildPattern('split', { style: 'premium', kit: KIT, content: CONTENT, width, height, measure }),
      ).not.toThrow()
  })
})

describe('findPattern', () => {
  it('finds a pattern by its id', () => {
    expect(findPattern('quote')?.name).toBe('Quote')
    expect(findPattern('nope')).toBeUndefined()
  })
})
