import { describe, expect, it } from 'vitest'

import { buildPattern } from './catalog.ts'
import { PATTERN_STYLES } from './styles.ts'
import { CONTENT, KIT, measure } from './test-input.ts'

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
