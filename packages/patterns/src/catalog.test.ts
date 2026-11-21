import { describe, expect, it } from 'vitest'

import {
  type BrandKit,
  EMPTY_BRAND_KIT,
  type Layer,
  readableTextSize,
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
    // The body font isn't set in the kit: the style's own is used, still bound to the role.
    expect(nodes.subline?.bindings).toMatchObject({ fontFamily: 'brand:body' })
    expect(nodes.subline?.props).toMatchObject({ style: { fontFamily: 'Outfit' } })
    expect(nodes.logo).toMatchObject({ role: 'logo', bindings: { image: 'brand:logo' } })
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
