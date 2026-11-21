// Script fonts (the fonts ticket, step 1): a text's emoji draw in colour once the emoji font is among
// the resources, on the CPU surface and in a PDF, and as the fallbacks' empty boxes without it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { EMOJI_FAMILY } from '@dazbee/fonts'
import { emojiTestFont, TEST_EMOJI } from '@dazbee/fonts/test-fonts'
import { renderDesign, renderVector, type ResourceBytes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { fontUses, parseDesign } from '@dazbee/schema'

import { fixtureResources, OUTPUT_DIR } from './pixels.ts'

const ck = await loadCanvasKit()

const design = {
  meta: { designId: 'emoji', name: 'Emoji' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: {
      pageId: 'p1',
      name: 'Post',
      width: 480,
      height: 120,
      x: 0,
      y: 0,
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      order: 'a0',
    },
  },
  nodes: {
    t: {
      type: 'text',
      parentId: 'sq',
      link: 't',
      index: 'a0',
      name: 'Party',
      props: {
        x: 16,
        y: 24,
        width: 448,
        height: 72,
        boxMode: 'fixed',
        text: `Hi ${TEST_EMOJI}`,
        style: { fontFamily: 'Noto Sans', fontSize: 48, color: '#15121AFF' },
      },
    },
  },
}

/** The shipped fonts, with the emoji font when asked for. */
function resources(withEmoji: boolean): ResourceBytes {
  const shipped = fixtureResources()
  return withEmoji
    ? { ...shipped, fonts: [...shipped.fonts, { family: EMOJI_FAMILY, bytes: emojiTestFont() }] }
    : shipped
}

/** How many pixels are clearly coloured, not grey: the emoji, as the text is near black on white. */
function coloured(pixels: Uint8Array) {
  let count = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const [r = 0, g = 0, b = 0] = pixels.subarray(i, i + 3)
    if (Math.max(r, g, b) - Math.min(r, g, b) > 60) count++
  }
  return count
}

describe('script fonts', () => {
  beforeAll(() => mkdirSync(OUTPUT_DIR, { recursive: true }))

  it('names the emoji font among the families the design is drawn in', () => {
    const parsed = parseDesign(design)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    expect([...new Set(fontUses(parsed.design).map((use) => use.family))]).toEqual([EMOJI_FAMILY, 'Noto Sans'])
  })

  it('draws emoji in colour with the emoji font, and none without it', () => {
    const without = renderDesign(ck, design, 'sq', resources(false))
    const withEmoji = renderDesign(ck, design, 'sq', resources(true))
    writeFileSync(join(OUTPUT_DIR, 'script-fonts-boxes.png'), without.png)
    writeFileSync(join(OUTPUT_DIR, 'script-fonts-emoji.png'), withEmoji.png)
    expect(coloured(without.pixels)).toBe(0)
    expect(coloured(withEmoji.pixels)).toBeGreaterThan(2000)
  })

  it('draws emoji in outlined text without a stroke round them', () => {
    const outlined = {
      ...design,
      nodes: {
        t: {
          ...design.nodes.t,
          props: {
            ...design.nodes.t.props,
            style: { ...design.nodes.t.props.style, outline: { width: 4, color: '#2050FFFF' } },
          },
        },
      },
    }
    const plain = renderDesign(ck, design, 'sq', resources(true))
    const drawn = renderDesign(ck, outlined, 'sq', resources(true))
    writeFileSync(join(OUTPUT_DIR, 'script-fonts-emoji-outlined.png'), drawn.png)
    // Right of the outlined letters, only the emoji's soft edges differ: the outline pass draws a
    // colour glyph again, which takes no stroke. Drawing the outline under the letters ends that.
    let differ = 0
    let worst = 0
    for (let y = 0; y < 120; y++)
      for (let x = 120; x < 480; x++) {
        const at = (y * 480 + x) * 4
        const d = Math.max(...[0, 1, 2].map((c) => Math.abs((drawn.pixels[at + c] ?? 0) - (plain.pixels[at + c] ?? 0))))
        if (d > 0) differ++
        worst = Math.max(worst, d)
      }
    expect(worst).toBeLessThanOrEqual(80)
    expect(differ).toBeLessThan(coloured(plain.pixels) / 4)
  })

  it('puts the colour emoji into a PDF and an SVG', () => {
    for (const target of ['pdf', 'svg'] as const) {
      const without = renderVector(ck, design, 'sq', resources(false), target)
      const withEmoji = renderVector(ck, design, 'sq', resources(true), target)
      writeFileSync(join(OUTPUT_DIR, `script-fonts-emoji.${target}`), withEmoji)
      expect(withEmoji.length, target).toBeGreaterThan(without.length + 1000)
    }
    // SVG holds a glyph by its path alone, and a colour emoji has none: the text comes as its image.
    const svg = new TextDecoder().decode(renderVector(ck, design, 'sq', resources(true), 'svg'))
    expect(svg).toContain('<image')
  })
})
