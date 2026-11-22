import { describe, expect, it } from 'vitest'

import { buildPattern } from '../catalog.ts'
import { PATTERN_STYLES } from '../styles.ts'
import { CHANNEL_SIZES, CONTENT, KIT, measure, within } from '../test-input.ts'

describe('the product with a price tag', () => {
  it('shows the price in its tag at every channel size, as a chip before the words in a short frame, one linked part', () => {
    for (const style of PATTERN_STYLES)
      for (const { width, height } of CHANNEL_SIZES) {
        const { nodes } = buildPattern('price-tag', { style, kit: KIT, content: CONTENT, width, height, measure })
        const at = `${style} ${width}×${height}`
        // One part at every size, so the price is a linked copy across them.
        const price = nodes.price
        const holder = (height <= 100 ? nodes.stub : nodes.tag)?.props
        if (price?.type !== 'text' || !holder) throw new Error(`no price at ${at}`)
        expect({ at, text: price.props.text }).toEqual({ at, text: CONTENT.number })
        // The price's words sit across its tag or chip.
        const middle = {
          x: price.props.x + price.props.width / 2,
          y: price.props.y + price.props.height / 2,
          width: 0,
          height: 0,
        }
        expect({ at, inside: within(middle, holder) }).toEqual({ at, inside: true })
      }
  })
})
