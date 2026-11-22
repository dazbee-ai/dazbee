import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT, readableTextSize } from '@dazbee/schema'

import { buildPattern, PATTERNS } from './catalog.ts'
import { contrast } from './palette.ts'
import { PATTERN_STYLES } from './styles.ts'
import { BOXED, CHANNEL_SIZES, CONTENT, EVERY, KIT, logo, measure, TWO_INKS, WHITE_MARK } from './test-input.ts'
import { CAP_HEIGHT } from './words.ts'

describe('a pattern’s logo', () => {
  it('draws a logo of one colour in the ground’s ink', () => {
    const ink = { subject: { x: 0, y: 0, width: 600, height: 160 }, inks: [{ colour: '#111111FF', share: 1 }] }
    const { nodes } = buildPattern('words-only', {
      style: 'premium',
      kit: KIT,
      content: { ...CONTENT, logo: { ...logo, look: ink } },
      width: 1080,
      height: 1080,
      measure,
    })
    expect(nodes.logo).toMatchObject({ type: 'box', role: 'logo' })
    expect(nodes['logo-shape']?.props).toMatchObject({ mask: 'alpha' })
    expect(nodes['logo-label']).toBeUndefined()
  })

  it.each(EVERY)(
    'draws a logo on a box of its own whole in %s in the %s style: the box’s shape and corners kept, no label round it',
    (id, style) => {
      for (const { width, height } of CHANNEL_SIZES) {
        const { nodes } = buildPattern(id, {
          style,
          kit: KIT,
          content: { ...CONTENT, logo: BOXED },
          width,
          height,
          measure,
        })
        const mark = nodes.logo
        if (mark?.type !== 'graphic') throw new Error(`no logo at ${width}×${height}`)
        const at = `${width}×${height}`
        const paint = mark.props.fills[0]
        // Drawn whole, never cropped to the mark's ink inside its box.
        expect({ at, whole: paint?.type === 'image' && paint.fit === 'fit' }).toEqual({ at, whole: true })
        const aspect = mark.props.width / mark.props.height / (BOXED.width / BOXED.height)
        expect({ at, aspect: Math.abs(aspect - 1) <= 0.02 }).toEqual({ at, aspect: true })
        const shape = mark.props.shape
        expect({ at, corners: shape.kind === 'rect' && shape.cornerRadius === 0 && !shape.corners }).toEqual({
          at,
          corners: true,
        })
        expect({ at, label: nodes['logo-label'] }).toEqual({ at, label: undefined })
      }
    },
  )

  it.each(EVERY)(
    'keeps the logo under the lead in %s in the %s style at every channel size, for a wordmark, a white one and a boxed mark',
    (id, style) => {
      for (const look of [TWO_INKS, WHITE_MARK.look, BOXED.look])
        for (const { width, height } of CHANNEL_SIZES) {
          const mark = look === BOXED.look ? BOXED : look === WHITE_MARK.look ? WHITE_MARK : { ...logo, look }
          const { nodes } = buildPattern(id, {
            style,
            kit: KIT,
            content: { ...CONTENT, logo: mark },
            width,
            height,
            measure,
          })
          const lead = nodes.number ?? nodes.headline
          const drawn = nodes.logo?.props
          if (lead?.type !== 'text' || !drawn) continue
          const size = lead.props.style.fontSize
          const lineHeight = size * (lead.props.style.lineHeight ?? 1.2)
          const lines = Math.max(1, Math.round(lead.props.height / lineHeight))
          const line = Math.min(lead.props.width, measure(lead.props, null).width / lines)
          const block = line * ((lines - 1) * lineHeight + size * CAP_HEIGHT)
          const round = nodes['logo-label'] ? drawn.height * 0.7 : 0
          const area = (drawn.width + round) * (drawn.height + round)
          // A logo already at the readable size, the least it is drawn at, is under the lead as far as it goes.
          const least = drawn.height <= readableTextSize(width, height) + 1
          const at = `${width}×${height}`
          expect({ at, under: least || area <= block * 0.5 * 1.05 }).toEqual({ at, under: true })
        }
    },
  )

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

  it.each(EVERY)('never runs the logo’s label down a %s banner 120 px tall or more, in the %s style', (id, style) => {
    const label = buildPattern(id, {
      style,
      kit: KIT,
      content: { ...CONTENT, logo: { ...logo, look: TWO_INKS } },
      width: 970,
      height: 250,
      measure,
    }).nodes['logo-label']
    if (label) expect(label.props.height).toBeLessThan(250 * 0.6)
  })
})
