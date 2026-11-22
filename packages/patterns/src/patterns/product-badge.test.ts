import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT } from '@dazbee/schema'

import { buildPattern } from '../catalog.ts'
import { apart } from '../palette.ts'
import { PATTERN_STYLES } from '../styles.ts'
import { CONTENT, KIT, measure, overlap, picture, SIZES, within } from '../test-input.ts'

describe('the product with a badge', () => {
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

  it('sets a product badge’s offer at the headline’s size at least, in a heavy face, a sixth of the frame wide, never outgrowing the product', () => {
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
      const product = nodes.product?.props
      if (badge?.type !== 'text' || headline?.type !== 'text' || !shape || !product) throw new Error('no badge')
      // As large as the headline, but where that would cover more than 40% of the product's box.
      const capped = shape.width * shape.height >= product.width * product.height * 0.4 * 0.95
      expect({ style, size: capped || badge.props.style.fontSize >= headline.props.style.fontSize }).toEqual({
        style,
        size: true,
      })
      expect({ style, under: shape.width * shape.height <= product.width * product.height * 0.4 + 1 }).toEqual({
        style,
        under: true,
      })
      expect({ style, heavy: badge.props.style.fontWeight >= (style === 'bold' ? 400 : 700) }).toEqual({
        style,
        heavy: true,
      })
      expect({ style, wide: capped || shape.width >= 1080 * 0.16 - 1 }).toEqual({ style, wide: true })
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

  it.each(PATTERN_STYLES)(
    'keeps a product’s silhouette in the %s style: its disc and badge plainly apart from its own main colour',
    (style) => {
      const kit = {
        ...EMPTY_BRAND_KIT,
        colors: [
          { token: 'primary' as const, name: 'Primary', value: '#FFD23FFF' },
          { token: 'secondary' as const, name: 'Secondary', value: '#2E2A24FF' },
          { token: 'accent' as const, name: 'Accent', value: '#3D5AFEFF' },
          { token: 'background' as const, name: 'Background', value: '#FFFDF5FF' },
          { token: 'text' as const, name: 'Text', value: '#1A1A1AFF' },
        ],
      }
      for (const { value } of kit.colors) {
        const look = { subject: { x: 0, y: 0, width: 1600, height: 1000 }, inks: [{ colour: value, share: 0.8 }] }
        const content = { ...CONTENT, photo: { ...picture, look } }
        const { nodes } = buildPattern('product-badge', { style, kit, content, width: 1080, height: 1080, measure })
        const fill = (key: string) => {
          const node = nodes[key]
          const paint = node?.type === 'graphic' ? node.props.fills[0] : undefined
          return paint?.type === 'solid' ? { colour: paint.color, opacity: paint.opacity ?? 1 } : undefined
        }
        const disc = fill('light')
        if (disc && disc.opacity === 1)
          expect({ value, disc: apart(disc.colour, value, 1.6, 25) }).toEqual({ value, disc: true })
        const badge = fill('badge-shape')
        const shape = nodes['badge-shape']
        const keyline = shape?.type === 'graphic' && shape.props.strokes.length > 0
        if (badge)
          expect({ value, badge: keyline || apart(badge.colour, value, 2, 25) }).toEqual({ value, badge: true })
        if (badge && disc && disc.opacity === 1)
          expect({ value, apart: keyline || apart(badge.colour, disc.colour, 2, 25) }).toEqual({ value, apart: true })
      }
    },
  )
})
