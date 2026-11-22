import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT, readableTextSize, SIZE_PRESETS } from '@dazbee/schema'

import { buildPattern, findPattern, PATTERNS } from './catalog.ts'
import { PATTERN_STYLES } from './styles.ts'
import {
  CHANNEL_SIZES,
  CONTENT,
  EVERY,
  KIT,
  logo,
  measure,
  meets,
  picture,
  SIZES,
  texts,
  within,
} from './test-input.ts'

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
        // A short frame sets its number beside its words, where it needn't be twice the headline.
        if (nodes.number && height > 100)
          expect({ width, height, ok: size('number') >= size('headline') * 2 }).toEqual({ width, height, ok: true })
      }
    },
  )

  // It builds every pattern in every style at many sizes: longer than one test's usual time on a busy CI runner.
  it(
    'crops the photo to its subject at every channel size: the subject shows whole, and the logo is clear of it',
    { timeout: 120_000 },
    () => {
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
            if (!layer || fill?.type !== 'image' || !fill.crop)
              throw new Error(`${id} ${style} ${width}x${height} has no cropped photo`)
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
    },
  )

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

  // It builds every pattern in every style at many sizes: longer than one test's usual time on a busy CI runner.
  it(
    'keeps the subline at the main social sizes in every style wherever the bold style keeps it',
    { timeout: 120_000 },
    () => {
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
    },
  )

  it.each(PATTERN_STYLES)(
    'tells what a short big number is of in the %s style with a whole unit of the words, never cut mid-phrase',
    (style) => {
      const plain = 'Off every pair this weekend'
      const clause = 'Off every pair, in store and online this weekend'
      const cases = [
        { kicker: 'Weekend sale', headline: plain, units: ['Weekend sale', plain] },
        { headline: clause, units: ['Off every pair', clause] },
        { headline: plain, units: [plain] },
      ]
      for (const { kicker, headline, units } of cases)
        for (const [width, height] of [
          [320, 50],
          [320, 100],
          [728, 90],
        ] as const) {
          const content = { ...CONTENT, number: '50%', headline, kicker: kicker ?? '' }
          const { nodes } = buildPattern('big-number', { style, kit: KIT, content, width, height, measure })
          const words = nodes.headline
          const text = words?.type === 'text' ? words.props.text.replaceAll(' ', ' ') : 'none'
          const size = words?.type === 'text' ? words.props.style.fontSize : 0
          const at = `${width}×${height} ${headline}`
          expect({ at, text, whole: units.includes(text) }).toEqual({ at, text, whole: true })
          expect(size).toBeGreaterThanOrEqual(Math.ceil(readableTextSize(width, height)))
        }
    },
  )

  it('refuses a pattern there isn’t and content a pattern needs', () => {
    const input = { style: 'bold' as const, kit: KIT, width: 1080, height: 1080, measure }
    expect(() => buildPattern('nope', { ...input, content: CONTENT })).toThrow('no pattern "nope"')
    expect(() => buildPattern('big-number', { ...input, content: { headline: 'Sale' } })).toThrow('needs number')
  })

  // It builds every pattern in every style at many sizes: longer than one test's usual time on a busy CI runner.
  it('builds at every channel size the app offers', { timeout: 120_000 }, () => {
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
