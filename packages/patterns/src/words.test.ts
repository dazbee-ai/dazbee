import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT, readableTextSize } from '@dazbee/schema'

import { usualWords } from './build.ts'
import { buildPattern } from './catalog.ts'
import { frameRoom } from './frame-shape.ts'
import { paletteOf } from './palette.ts'
import { PATTERN_STYLES, STYLES } from './styles.ts'
import { CONTENT, EVERY, KIT, measure, picture } from './test-input.ts'
import { treeBuilder } from './tree.ts'
import { stackWords } from './words.ts'

describe('a pattern’s words', () => {
  it('holds an attribution to the quote’s widest line in every style and alignment', () => {
    for (const style of PATTERN_STYLES)
      for (const [width, height] of [
        [1080, 1080],
        [1080, 1920],
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

  it.each(EVERY)(
    'leads %s in the %s style in a 9:16 frame over its subline by the style’s scale, or leaves the subline out',
    (id, style) => {
      const ratio = style === 'minimal' || style === 'premium' ? 2.5 : 2
      for (const kit of [KIT, EMPTY_BRAND_KIT]) {
        const { nodes } = buildPattern(id, { style, kit, content: CONTENT, width: 1080, height: 1920, measure })
        const lead = nodes.number ?? nodes.headline
        const subline = nodes.subline
        if (lead?.type !== 'text' || subline?.type !== 'text') continue
        // A number leads its headline, whose subline is set under the number's share.
        const over = nodes.number ? subline.props.style.fontSize : subline.props.style.fontSize * ratio
        expect({ id, scaled: lead.props.style.fontSize >= over - 1 }).toEqual({ id, scaled: true })
      }
    },
  )

  it.each(EVERY)(
    'sets the button of %s in the %s style under its lead on a social frame, never outweighing the message',
    (id, style) => {
      const quiet = style === 'minimal' || style === 'premium'
      for (const [width, height] of [
        [1080, 1080],
        [1080, 1920],
        [1280, 720],
      ] as const) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content: CONTENT, width, height, measure })
        const lead = nodes.number ?? nodes.headline
        const label = nodes['button-label']
        if (lead?.type !== 'text' || label?.type !== 'text') continue
        const tracked = label.props.style.textCase === 'upper' && label.props.style.letterSpacing.value > 0
        const weight = label.props.style.fontSize * (tracked ? 1.15 : 1)
        const floor = label.props.style.fontSize <= Math.ceil(readableTextSize(width, height))
        const at = `${width}×${height}`
        expect({ at, under: floor || lead.props.style.fontSize >= weight * (quiet ? 2.6 : 2.2) - 1 }).toEqual({
          at,
          under: true,
        })
      }
    },
  )

  it.each(EVERY)(
    'keeps the words of %s in the %s style together down a display tower, its spare height round them',
    (id, style) => {
      for (const [width, height] of [
        [160, 600],
        [300, 600],
      ] as const) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content: CONTENT, width, height, measure })
        const lead = nodes.number ?? nodes.headline
        if (lead?.type !== 'text') continue
        const headline = nodes.headline
        const headlineSize = headline?.type === 'text' ? headline.props.style.fontSize : lead.props.style.fontSize
        const parts = ['kicker', 'number', 'headline', 'subline', 'attribution', 'button']
          .flatMap((key) => (nodes[key] ? [{ key, ...nodes[key].props }] : []))
          .sort((a, b) => a.y - b.y)
        // A picture between two parts, such as a product over its button, parts them as it should.
        const pictures = Object.values(nodes).filter((node) => node.name === 'Photo' || node.name === 'Product')
        // Words in boxes of their own, such as a ticket's stub and its main part, are apart as they should be.
        const box = (key: string) => {
          let at = key
          while (nodes[at] && nodes[nodes[at]?.parentId ?? '']) at = nodes[at]?.parentId ?? ''
          return at
        }
        for (const [i, part] of parts.entries()) {
          const next = parts[i + 1]
          if (!next) break
          const foot = part.y + part.height
          if (box(part.key) !== box(next.key)) continue
          // The style's room between the parts: a share of the headline's size, a quarter of a number's over them.
          const number = nodes.number
          const numbered = number?.type === 'text' && box('number') === box(part.key)
          const base = numbered ? number.props.style.fontSize * 0.25 : headlineSize
          const most = Math.ceil(base * STYLES[style].gap) + 1
          if (pictures.some(({ props }) => props.y >= foot - 1 && props.y + props.height <= next.y + 1)) continue
          const at = `${width}×${height} ${part.key} to ${next.key}`
          expect({ at, together: next.y - foot <= most }).toEqual({ at, together: true })
        }
      }
    },
  )

  it.each(PATTERN_STYLES)(
    'sets a wide frame’s button beside its words in the %s style only where the lead keeps the size it takes stacked',
    (style) => {
      // A wide photo, which goes on top of a wide frame's words, so they take a wide, low room under it.
      const photo = { ...picture, look: { subject: { x: 200, y: 300, width: 1200, height: 350 }, inks: [] } }
      const content = { ...CONTENT, photo }
      for (const id of ['photo-band', 'split']) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content, width: 1280, height: 720, measure })
        const headline = nodes.headline
        const button = nodes.button
        const words = nodes.words
        if (headline?.type !== 'text' || !button || !words) continue
        const beside = button.props.x >= headline.props.x + headline.props.width
        if (!beside) continue
        // The same words stacked over the button in the room the row took.
        const look = STYLES[style]
        const setting = {
          style: look,
          palette: paletteOf(KIT, look),
          frame: frameRoom(1280, 720, look.margin),
          measure,
        }
        const stacked = stackWords(treeBuilder(), setting, {
          parts: usualWords(CONTENT),
          button: CONTENT.button ?? '',
          room: words.props,
          surface: '#FFFFFFFF',
        })
        const at = `${id} ${style}`
        expect({ at, keeps: headline.props.style.fontSize >= stacked.size }).toEqual({ at, keeps: true })
      }
    },
  )
})
