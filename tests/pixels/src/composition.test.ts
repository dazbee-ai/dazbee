// A composition is drawn as the same text typed would be: the stage's picture of a frame while an
// input method composes equals, pixel for pixel, its picture with the same text committed. And the
// lines under a composition lie under exactly the graphemes composed, on each line they cover.
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import type { SkPicture } from '@dazbee/canvaskit'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { compositionLines, layoutText, makeResources, selectionBoxes, type TextLayout } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type DesignInput, type RunStyle, TextProps } from '@dazbee/schema'

import { comparePixels, type Pixels } from './pixels.ts'

const ck = await loadCanvasKit()
const resources = makeResources(ck, { fonts: loadFontFiles(), fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })
afterAll(() => resources.delete())

const editors: TestEditor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.end()
})

/** The frame every case is drawn in. */
const FRAME = { id: 'sq', width: 600, height: 400 }

/** A text to compose in: its text, box, style and runs, and the range or caret the composition replaces. */
interface Case {
  text: string
  boxMode: 'autoWidth' | 'fixed'
  width: number
  fontFamily: string
  runs?: { start: number; end: number; style: RunStyle }[]
  range: { start: number; end: number }
  /** What the input method composes, in turn; the last is what is drawn and committed. */
  composed: string[]
}

/** The design of a case: one text in a frame. */
function designOf(c: Case): DesignInput {
  return {
    meta: { designId: 'd', name: 'D' },
    pages: { p1: { name: 'One', order: 'a0' } },
    frames: { sq: { pageId: 'p1', name: 'Square', width: FRAME.width, height: FRAME.height, x: 0, y: 0, order: 'a0' } },
    nodes: {
      words: {
        type: 'text',
        parentId: 'sq',
        link: 'words',
        index: 'a0',
        name: 'Words',
        props: {
          x: 40,
          y: 40,
          width: c.width,
          height: 300,
          text: c.text,
          boxMode: c.boxMode,
          runs: c.runs ?? [],
          style: { fontFamily: c.fontFamily, fontSize: 48, color: '#000000FF' },
        },
      },
    },
  }
}

/** A frame's picture drawn on the CPU surface, and read back. */
function pixelsOf(picture: SkPicture): Pixels {
  const surface = ck.MakeSurface(FRAME.width, FRAME.height)
  if (!surface) throw new Error('no surface')
  try {
    surface.getCanvas().drawPicture(picture)
    const image = surface.makeImageSnapshot()
    const pixels = image.readPixels(0, 0, {
      width: FRAME.width,
      height: FRAME.height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    })
    image.delete()
    if (!(pixels instanceof Uint8Array)) throw new Error('no pixels')
    return { width: FRAME.width, height: FRAME.height, pixels }
  } finally {
    surface.dispose()
  }
}

/** The frame's picture as the stage draws it now, after a redraw pass. */
function framePixels(e: TestEditor): Pixels {
  let drawn: Pixels | null = null
  e.core.redraw((pictures) => {
    const picture = pictures.find((p) => p.frame.id === FRAME.id)?.picture
    if (picture) drawn = pixelsOf(picture)
    return true
  })
  if (!drawn) throw new Error('the frame was not drawn')
  return drawn
}

/**
 * The frame drawn while a case's text is composed, or with it committed: typing starts in the text,
 * the case's range is selected and the field given it, then the input method composes each step and,
 * with `commit`, commits the last.
 */
async function drawn(c: Case, commit: boolean): Promise<Pixels> {
  const e = await testEditor(designOf(c))
  editors.push(e)
  e.core.select(['words'])
  e.press('goIn')
  e.modules.typing.selectText(c.range)
  const given = e.core.input.fieldText()
  if (!given) throw new Error('no text is edited')
  const state = (value: string) => ({ value, start: value.length, end: value.length })
  for (const typed of c.composed) e.core.input.fieldChanged(state(typed), typed)
  if (commit) e.core.input.fieldChanged(state(c.composed.at(-1) ?? ''), null)
  // A font a script needs settles before the frame is drawn.
  framePixels(e)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return framePixels(e)
}

const CASES: [string, Case][] = [
  [
    'Latin in a text that grows with its words',
    {
      text: 'Fresh',
      boxMode: 'autoWidth',
      width: 100,
      fontFamily: 'Noto Sans',
      range: { start: 5, end: 5 },
      composed: [' r', ' ro', ' roast'],
    },
  ],
  [
    'Japanese wrapping in a fixed box',
    {
      text: 'セール',
      boxMode: 'fixed',
      width: 260,
      fontFamily: 'Noto Sans',
      range: { start: 3, end: 3 },
      composed: ['き', 'きょう', 'きょうはとてもいいてんき'],
    },
  ],
  [
    'a composition over a bold word after plain text',
    {
      text: 'Hello there',
      boxMode: 'fixed',
      width: 500,
      fontFamily: 'Noto Sans',
      runs: [{ start: 6, end: 11, style: { fontWeight: 700 } }],
      range: { start: 6, end: 11 },
      composed: ['w', 'world'],
    },
  ],
  [
    'an Arabic letter composed between two Arabic letters',
    {
      text: 'بب',
      boxMode: 'autoWidth',
      width: 100,
      fontFamily: 'Noto Naskh Arabic',
      range: { start: 1, end: 1 },
      composed: ['ي'],
    },
  ],
  [
    'a Devanagari vowel sign composed after a consonant',
    {
      text: 'क',
      boxMode: 'autoWidth',
      width: 100,
      fontFamily: 'Noto Sans Devanagari',
      range: { start: 1, end: 1 },
      composed: ['ि'],
    },
  ],
]

describe('a composition drawn in the frame', () => {
  it.each(CASES)('is drawn as the same text committed: %s', async (_name, c) => {
    const composing = await drawn(c, false)
    const committed = await drawn(c, true)
    const before = await drawn({ ...c, composed: [] }, false)
    // The composition shows: the picture is not the text as it was.
    expect(comparePixels(before, composing).differing).toBeGreaterThan(0)
    expect(comparePixels(committed, composing).differing).toBe(0)
  })
})

/** A text laid out in a family, `width` wide (growing with its words with none). */
function laidOut(text: string, fontFamily: string, width?: number): TextLayout {
  const props = TextProps.parse({
    x: 0,
    y: 0,
    width: width ?? 0,
    height: 0,
    boxMode: width ? 'autoHeight' : 'autoWidth',
    text,
    style: { fontFamily, fontSize: 48, color: '#000000FF' },
  })
  return layoutText(ck, props, resources)
}

/**
 * Checks that the lines under `start`–`end` lie under exactly what a selection of it highlights:
 * one line under each of its boxes, as wide, between the line's baseline and its bottom.
 */
function expectUnder(laid: TextLayout, start: number, end: number, lines: number) {
  const under = compositionLines(ck, laid, start, end)
  const boxes = selectionBoxes(ck, laid, start, end)
  expect(under).toHaveLength(lines)
  expect(boxes).toHaveLength(lines)
  for (const [i, box] of boxes.entries()) {
    const line = under[i]
    expect(line?.x).toBeCloseTo(box.x, 3)
    expect(line?.width).toBeCloseTo(box.width, 3)
    // Below the letters' baseline, above the line's bottom.
    expect(line?.y).toBeGreaterThan(box.y + box.height / 2)
    expect(line?.y).toBeLessThan(box.y + box.height)
  }
}

describe('compositionLines', () => {
  it('lies under exactly the composed graphemes of one line', () => {
    const laid = laidOut('Fresh roast daily', 'Noto Sans')
    expectUnder(laid, 6, 11, 1)
  })

  it('lies under each line a composition wraps across, and each paragraph', () => {
    const wrapped = laidOut('one two three four five six', 'Noto Sans', 200)
    expectUnder(wrapped, 4, 18, 3)
    const paragraphs = laidOut('one two\nthree four', 'Noto Sans')
    expectUnder(paragraphs, 4, 13, 2)
  })

  it('lies under Arabic letters composed between Arabic letters, and a composition that ends a line', () => {
    const arabic = laidOut('بيب مرحبا', 'Noto Naskh Arabic')
    expectUnder(arabic, 1, 2, 1)
    expectUnder(arabic, 4, 9, 1)
  })

  it('gives nothing for an empty composition', () => {
    expect(compositionLines(ck, laidOut('Fresh', 'Noto Sans'), 2, 2)).toEqual([])
  })
})
