import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT, readableTextSize } from '@dazbee/schema'

import { buildPattern } from './catalog.ts'
import { PATTERN_STYLES } from './styles.ts'
import { CHANNEL_SIZES, CONTENT, EVERY, KIT, measure } from './test-input.ts'

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
    'fills %s in the %s style down every display frame, with no empty band across it over a quarter of its height',
    (id, style) => {
      const display = CHANNEL_SIZES.filter(({ width, height }) => width < 1000 && height < 1000 && height > 100)
      for (const { width, height } of display) {
        const { nodes } = buildPattern(id, { style, kit: KIT, content: CONTENT, width, height, measure })
        // What is drawn in the frame, but the grounds, panels and lines its content sits on.
        const grounds = new Set([
          'Background',
          'Ground',
          'Band',
          'Panel',
          'Stripe',
          'Sheen',
          'Frame line',
          'Foot',
          'Seam',
        ])
        const boxes = Object.values(nodes)
          .filter((node) => node.type !== 'box' && !grounds.has(node.name))
          .map((node) => node.props)
        const margin = Math.round(Math.min(width, height) * 0.14)
        let longest = 0
        let run = 0
        for (let y = margin; y < height - margin; y++) {
          const filled = boxes.some((box) => box.y <= y && y < box.y + box.height)
          run = filled ? 0 : run + 1
          longest = Math.max(longest, run)
        }
        const at = `${width}×${height}`
        expect({ at, longest, band: longest <= height * 0.25 }).toEqual({ at, longest, band: true })
      }
    },
  )
})
