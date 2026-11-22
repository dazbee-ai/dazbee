import { describe, expect, it } from 'vitest'

import type { Rect } from '@dazbee/schema'

import { buildPattern } from './catalog.ts'
import { PATTERN_STYLES } from './styles.ts'
import { CONTENT, KIT, measure, meets } from './test-input.ts'

describe('a pattern’s visual and words', () => {
  it('set an upright visual beside the words in a square, and a wide one over them', () => {
    for (const style of PATTERN_STYLES) {
      const arch = buildPattern('arch', { style, kit: KIT, content: CONTENT, width: 1080, height: 1080, measure }).nodes
      const shape = (arch.arch ?? arch.photo ?? arch['arch-line'])?.props
      const headline = arch.headline?.props
      if (!shape || !headline) throw new Error(`no arch in ${style}`)
      // Side by side: the arch's column and the words' don't share any of their width.
      const across = (box: Rect) => ({ ...box, y: 0, height: 1 })
      expect({ style, beside: !meets(across(shape), across(headline)) }).toEqual({ style, beside: true })
      const poster = buildPattern('poster', {
        style,
        kit: KIT,
        content: CONTENT,
        width: 1080,
        height: 1080,
        measure,
      }).nodes
      const photo = poster.photo?.props
      const title = poster.headline?.props
      if (!photo || !title) throw new Error(`no poster in ${style}`)
      expect({ style, under: photo.y >= title.y + title.height }).toEqual({ style, under: true })
    }
  })
})
