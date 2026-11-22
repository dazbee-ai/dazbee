import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT, readableTextSize } from '@dazbee/schema'

import { logoLeast } from './build.ts'
import { buildPattern, PATTERNS } from './catalog.ts'
import { contrast } from './palette.ts'
import { PATTERN_STYLES } from './styles.ts'
import { BOXED, CHANNEL_SIZES, CONTENT, EVERY, KIT, logo, measure, TWO_INKS, WHITE_MARK } from './test-input.ts'
import { CAP_HEIGHT } from './words.ts'

/** A brand whose primary colour is its logo's own box, as BOXED draws it, with the rest of a full kit. */
const BOX_GREEN = {
  ...KIT,
  colors: [
    { token: 'primary' as const, name: 'Primary', value: '#1F4D3AFF' },
    { token: 'secondary' as const, name: 'Secondary', value: '#E8E2D0FF' },
    { token: 'accent' as const, name: 'Accent', value: '#C8553DFF' },
    { token: 'background' as const, name: 'Background', value: '#F7F4ECFF' },
    { token: 'text' as const, name: 'Text', value: '#1B1B1BFF' },
  ],
}

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
    'draws a logo on a box of its own whole in %s in the %s style: the box’s shape and corners kept, no label round a box that shows',
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

  // A pattern that needs the logo makes it its picture, as an app's icon, so its logo isn't kept under its lead.
  it.each(EVERY.filter(([id]) => !PATTERNS.find((pattern) => pattern.id === id)?.needs.includes('logo')))(
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
          // A logo at the least it reads at is under the lead as far as it goes.
          const frame = { width, height, readable: Math.ceil(readableTextSize(width, height)) }
          const least = drawn.height <= logoLeast(frame, drawn.width / drawn.height) + 1
          const at = `${width}×${height}`
          expect({ at, under: least || area <= block * 0.5 * 1.05 }).toEqual({ at, under: true })
        }
    },
  )

  it.each(EVERY)(
    'never draws the logo of %s in the %s style smaller than it reads, whatever the lead, on display and short frames',
    (id, style) => {
      const sizes = [
        [320, 50],
        [728, 90],
        [320, 100],
        [300, 250],
        [336, 280],
        [970, 250],
        [160, 600],
        [300, 600],
      ] as const
      for (const mark of [BOXED, { ...logo, look: TWO_INKS }])
        for (const [width, height] of sizes) {
          const { nodes } = buildPattern(id, {
            style,
            kit: KIT,
            content: { ...CONTENT, logo: mark },
            width,
            height,
            measure,
          })
          const drawn = nodes.logo?.props
          if (!drawn) continue
          const readable = Math.ceil(readableTextSize(width, height))
          // A wordmark's ink 1.6 times the readable size tall; a square mark twice it, and 9% of the frame's shorter
          // side.
          const square = mark === BOXED
          const least = square ? Math.max(readable * 2, Math.min(width, height) * 0.09) : readable * 1.6
          const at = `${square ? 'mark' : 'wordmark'} ${width}×${height}`
          expect({ at, height: drawn.height, reads: drawn.height >= least - 1 }).toEqual({
            at,
            height: drawn.height,
            reads: true,
          })
        }
    },
  )

  it('sets a logo’s own box that melts into the ground on a plate of a brand colour it reads on', () => {
    const colours = BOX_GREEN.colors.map((colour) => colour.value)
    let plated = 0
    for (const id of ['big-number', 'words-only', 'quote'])
      for (const style of PATTERN_STYLES)
        for (const [width, height] of [
          [728, 90],
          [320, 50],
          [320, 100],
          [300, 250],
          [160, 600],
          [1080, 1080],
        ] as const) {
          const { nodes } = buildPattern(id, {
            style,
            kit: BOX_GREEN,
            content: { ...CONTENT, logo: BOXED },
            width,
            height,
            measure,
          })
          const groundPaint = (nodes.ground ?? nodes.background)?.props
          const fill = groundPaint && 'fills' in groundPaint ? groundPaint.fills[0] : undefined
          const ground = fill?.type === 'solid' ? fill.color : '#FFFFFFFF'
          if (contrast(ground, BOXED.look.backdrop) >= 1.1) continue
          plated++
          const label = nodes['logo-label']
          const paint = label?.type === 'graphic' ? label.props.fills[0] : undefined
          const plate = paint?.type === 'solid' ? paint.color : 'none'
          const at = `${id} ${style} ${width}×${height}`
          expect({
            at,
            brand: colours.includes(plate),
            shows: contrast(plate, ground) > 1.4,
            reads: contrast(plate, BOXED.look.backdrop) >= 3,
          }).toEqual({ at, brand: true, shows: true, reads: true })
          // The box is drawn whole on its plate, its corners kept.
          const mark = nodes.logo
          const whole = mark?.type === 'graphic' && mark.props.fills[0]?.type === 'image' && !mark.props.fills[0].crop
          expect({ at, whole }).toEqual({ at, whole: true })
        }
    expect(plated).toBeGreaterThan(0)
  })

  // It builds every pattern in every style at many sizes: longer than one test's usual time on a busy CI runner.
  it('sets a logo’s label in a colour both its inks read on at 3:1, with no brand kit', { timeout: 120_000 }, () => {
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

describe('a 9:16 frame', () => {
  it('ends in a foot under its safe room in the style’s way where no photo fills it, so it never ends in a blank field', () => {
    for (const style of PATTERN_STYLES) {
      const { nodes, roots } = buildPattern('words-only', {
        style,
        kit: KIT,
        content: CONTENT,
        width: 1080,
        height: 1920,
        measure,
      })
      const foot = nodes.foot?.props
      const button = nodes.button?.props
      if (!foot || !button) throw new Error(`no foot in ${style}`)
      // From under the button, the safe room's foot, to the frame's foot, the whole width.
      expect({ style, under: foot.y >= button.y + button.height - 1 }).toEqual({ style, under: true })
      expect({ style, reaches: foot.y + foot.height >= 1920 && foot.width >= 1080 }).toEqual({ style, reaches: true })
      // Over the ground, under everything set after it.
      expect(roots.indexOf('foot')).toBe(roots.indexOf(nodes.ground ? 'ground' : 'background') + 1)
    }
  })

  it('leaves its foot to a photo that fills it', () => {
    const { nodes } = buildPattern('full-photo', {
      style: 'bold',
      kit: KIT,
      content: CONTENT,
      width: 1080,
      height: 1920,
      measure,
    })
    expect(nodes.photo?.props.height).toBe(1920)
    expect(nodes.foot).toBeUndefined()
  })
})

describe('a billboard', () => {
  it('sizes its lead from its height and spans its width: the logo at its start, the words, the button at its end', () => {
    for (const id of ['words-only', 'big-number'])
      for (const style of PATTERN_STYLES) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content: CONTENT, width: 970, height: 250, measure })
        const mark = nodes.logo?.props
        const lead = nodes.number ?? nodes.headline
        const button = nodes.button?.props
        if (!mark || lead?.type !== 'text' || !button) throw new Error(`no billboard of ${id} in ${style}`)
        const at = `${id} ${style}`
        expect({ at, large: lead.props.style.fontSize >= 250 * 0.2 }).toEqual({ at, large: true })
        expect({ at, logoFirst: mark.x + mark.width <= lead.props.x }).toEqual({ at, logoFirst: true })
        expect({
          at,
          buttonLast: button.x >= lead.props.x + Math.min(lead.props.width, measure(lead.props, null).width),
        }).toEqual({ at, buttonLast: true })
      }
  })
})
