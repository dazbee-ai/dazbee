import { describe, expect, it } from 'vitest'

import { buildPattern } from '../catalog.ts'
import { PATTERN_STYLES } from '../styles.ts'
import { CONTENT, KIT, logo, measure, picture } from '../test-input.ts'

describe('the split', () => {
  it('sets a split’s photo beside its words in a wide frame, where photo with a band sets it on top', () => {
    const photo = { ...picture, look: { subject: { x: 300, y: 450, width: 1000, height: 400 }, inks: [] } }
    for (const style of PATTERN_STYLES) {
      const at = (id: string) =>
        buildPattern(id, { style, kit: KIT, content: { ...CONTENT, photo }, width: 1280, height: 720, measure }).nodes
      const split = at('split')
      const shown = split.photo?.props
      const words = split.headline?.props
      expect({ style, beside: Boolean(shown && words && shown.x + shown.width <= words.x) }).toEqual({
        style,
        beside: true,
      })
      expect({ style, top: (at('photo-band').photo?.props.height ?? 720) < 720 }).toEqual({ style, top: true })
    }
  })

  it('splits a square into even halves where the photo’s subject shows whole there and the words fit under it', () => {
    const photo = { ...picture, look: { subject: { x: 300, y: 300, width: 1000, height: 400 }, inks: [] } }
    for (const style of PATTERN_STYLES) {
      const { nodes } = buildPattern('split', {
        style,
        kit: KIT,
        content: { headline: 'The Stride Air', button: 'Shop now', photo, logo },
        width: 1080,
        height: 1080,
        measure,
      })
      const panel = nodes.panel?.props
      expect({ style, seam: panel && Math.abs(panel.y + (style === 'playful' ? 130 : 0) - 540) <= 1 }).toEqual({
        style,
        seam: true,
      })
    }
  })
})
