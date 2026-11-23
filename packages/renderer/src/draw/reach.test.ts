import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { TextProps } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { layoutText } from '../text/layout.ts'
import { placedBounds } from '../text/placed.ts'
import { layerReach } from './reach.ts'

const ck = await loadCanvasKit()
const resources = resourceCache(ck).resources({
  fonts: loadFontFiles(),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})

describe('layerReach', () => {
  it('reaches round a curved text’s turned glyph boxes, half its font size past them, from its box’s corner', () => {
    const props = TextProps.parse({
      x: 100,
      y: 50,
      width: 10,
      height: 10,
      text: 'ROUND BADGE',
      style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
      curve: { shape: 'circle', amount: 100 },
    })
    const laid = layoutText(ck, props, resources)
    const bounds = laid.placed && placedBounds(laid.placed.runs)
    laid.delete()
    if (!bounds) throw new Error('not placed')
    const reach = layerReach(ck, { id: 't', type: 'text', props, children: [] }, resources)
    expect(reach.x).toBeCloseTo(100 + bounds.x - 20, 4)
    expect(reach.y).toBeCloseTo(50 + bounds.y - 20, 4)
    expect(reach.width).toBeCloseTo(bounds.width + 40, 4)
    expect(reach.height).toBeCloseTo(bounds.height + 40, 4)
  })
})
