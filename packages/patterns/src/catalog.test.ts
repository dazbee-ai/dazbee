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
        if (nodes.number)
          expect({ width, height, ok: size('number') >= size('headline') * 2 }).toEqual({ width, height, ok: true })
      }
    },
  )

  it('crops the photo to its subject: the subject shows whole, and the logo is clear of it', () => {
    const photo = { ...picture, look: { subject: { x: 300, y: 450, width: 1000, height: 400 }, inks: [] } }
    for (const [width, height] of [
      [1080, 1080],
      [1080, 1920],
      [1280, 720],
    ] as const)
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
