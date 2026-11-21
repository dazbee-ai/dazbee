// Add size keeps text readable: a 1080 × 1080 ad added at Google Display's 300 × 250 and 320 × 50 in
// the editor, with the fonts the app ships, sets no text under the readable size there, and every text
// still fits its box, as the design check reads the new frame.
import { describe, expect, it } from 'vitest'

import { testEditor } from '@dazbee/editor/test-editor'
import { type AgentWarningKind, frameWarnings } from '@dazbee/export'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { DesignInput } from '@dazbee/schema'

const ck = await loadCanvasKit()
const bytes = {
  fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
}

/** What the design check tells of a text too small, or one that doesn't fit its box or its frame. */
const UNFIT: ReadonlySet<AgentWarningKind> = new Set(['tooSmall', 'overflow', 'pastMaxLines', 'cutOff', 'outsideFrame'])
const ink = '#1F2329FF'
/** A text in the square at `box`, `fontSize` px, growing with its words unless `more` says otherwise. */
const text = (
  index: string,
  words: string,
  [x, y, width, height]: [number, number, number, number],
  fontSize: number,
  more: object = {},
) => ({
  type: 'text' as const,
  parentId: 'sq',
  link: index,
  index,
  name: index,
  props: { x, y, width, height, text: words, style: { fontFamily: 'Noto Sans', fontSize, color: ink }, ...more },
})

/**
 * An ad in the 1080 square, each text fitting its box there: a headline and a subline that grow with
 * their words, a tag that grows across with them, a price that shrinks to fit its fixed box, a button
 * label and two lines of small print in fixed boxes.
 */
const AD: DesignInput = {
  meta: { designId: 'd', name: 'Ad' },
  pages: { p1: { name: 'Page', order: 'a0' } },
  frames: {
    sq: {
      pageId: 'p1',
      name: 'Square',
      width: 1080,
      height: 1080,
      x: 0,
      y: 0,
      order: 'a0',
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
    },
  },
  nodes: {
    headline: text('a0', 'Summer sale', [90, 140, 900, 140], 96),
    subline: text('a1', 'Fresh styles for every day of the season', [90, 300, 900, 130], 44),
    price: text('a2', '$49', [640, 520, 360, 180], 120, { boxMode: 'fixed', shrinkToFit: { min: 60, max: 120 } }),
    button: text('a3', 'Shop now', [390, 860, 300, 70], 40, { boxMode: 'fixed', align: 'center' }),
    legal: text('a4', 'Offer ends Sunday. Terms apply to every order, in store and online.', [90, 960, 900, 82], 30, {
      boxMode: 'fixed',
    }),
    tag: text('a5', 'Free delivery on every order over $50', [90, 60, 560, 41], 30, { boxMode: 'autoWidth' }),
  },
}

describe('add size', () => {
  it.each([
    [300, 250],
    [320, 50],
  ])(
    'sets no text of a 1080 square ad added at %i × %i under the readable size, each still fitting its box',
    async (width, height) => {
      const e = await testEditor(AD)
      try {
        const before = e.core.session.design()
        expect(frameWarnings(ck, before, 'sq', bytes).filter((w) => w.kind === 'overflow')).toEqual([])
        const id = e.core.addSize('sq', { width, height }) ?? ''
        const warnings = frameWarnings(ck, e.core.session.design(), id, bytes)
        // Texts at the readable size may meet in a frame 50 px tall; laying the size out is left to whoever adds it.
        expect(warnings.filter((w) => UNFIT.has(w.kind))).toEqual([])
      } finally {
        e.end()
      }
    },
  )
})
