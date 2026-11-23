// The Curve and bounce part: the curve, bounce and letter turn several texts share, and what a pick
// of a shape, a bounce, an amount, Shuffle or a letter turn writes, held against the editor so a
// pick refits the text's box in its one undo step, taking the curve off gives back the settings the
// text kept, and a turn typed while editing turns only the selected run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign } from '@dazbee/editor/test-matrix'

import { set, type Style, type Target, textStyle } from '@/components/editor/edit-panel/target.ts'

import {
  amountMost,
  anyCurved,
  BOUNCE_START,
  bounceAmountPatch,
  CURVE_MOST,
  CURVE_START,
  curveAmountPatch,
  pickBounce,
  pickCurve,
  sharedBounce,
  sharedCurve,
  sharedTurn,
  shufflePatch,
  turnAllPatch,
  turnEachPatch,
} from './curves.ts'

const STYLE = { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' }
/** A fixed box text that wraps, with a list, shrink to fit and most lines, and an auto width one. */
const DESIGN = frameDesign({
  name: 'Curves',
  nodes: {
    kept: {
      type: 'text',
      parentId: 'sq',
      index: 'a0',
      name: 'Kept',
      props: {
        x: 100,
        y: 100,
        width: 240,
        height: 200,
        text: 'Summer sale on every hat',
        boxMode: 'fixed',
        list: 'bullet',
        align: 'justify',
        wrapStyle: 'balance',
        maxLines: 2,
        shrinkToFit: { min: 20, max: 40 },
        style: STYLE,
      },
    },
    wide: {
      type: 'text',
      parentId: 'sq',
      index: 'a1',
      name: 'Wide',
      props: { x: 100, y: 400, width: 200, height: 60, text: 'Badge', boxMode: 'autoWidth', style: STYLE },
    },
  },
})

const ARC = { curve: { shape: 'arcUp', amount: 30 } }
const WAVE = { curve: { shape: 'wave', amount: 30 } }
const WAVY = { bounce: { style: 'wavy', amount: 30, seed: 1 } }
const RANDOM = { bounce: { style: 'random', amount: 60, seed: 4 } }
const plain = {}
/** A text turned 10°, its second letter −20° in a run of its own and its third 10° in a bold one. */
const TURNED = {
  text: 'Hats',
  style: { ...STYLE, turn: 10 },
  runs: [
    { start: 1, end: 2, style: { turn: -20 } },
    { start: 2, end: 3, style: { turn: 10, fontWeight: 700 } },
  ],
}
/** TURNED as a layer of a frame. */
const TURNED_DESIGN = frameDesign({
  name: 'Turned',
  nodes: {
    turned: {
      type: 'text',
      parentId: 'sq',
      index: 'a0',
      name: 'Turned',
      props: { x: 100, y: 100, width: 200, height: 60, boxMode: 'autoWidth', ...TURNED },
    },
  },
})

/** The selection as the edit panel reads it, each layer with its own values, and the selected run's styles while one is edited. */
function targetOf(ed: TestEditor, ids: string[]): Target {
  const design = ed.core.design()
  return {
    editor: ed.core as unknown as Editor,
    ids,
    props: ids.map((id) => ed.core.drawnPropsOf(id)) as Target['props'],
    types: ids.map((id) => design.nodes[id]?.type ?? ''),
    names: ids.map((id) => design.nodes[id]?.name ?? ''),
    range: (ed.core.textSelectionStyles() as Style[] | null) ?? undefined,
  }
}

describe('CURVE_MOST', () => {
  it('stops an arc down and a wave short of 100, where their letters crowd, and lets an arc up and a circle reach it', () => {
    expect(CURVE_MOST).toEqual({ arcUp: 100, arcDown: 50, circle: 100, wave: 40 })
  })
})

describe('sharedCurve', () => {
  it('reads the shape and amount the texts share', () => {
    expect(sharedCurve([ARC, ARC])).toEqual({ choice: 'arcUp', amount: 30 })
    expect(sharedCurve([plain, plain])).toEqual({ choice: 'none', amount: null })
  })

  it('reads mixed where the texts differ, and an amount only while every one is curved', () => {
    expect(sharedCurve([ARC, WAVE])).toEqual({ choice: 'mixed', amount: 30 })
    expect(sharedCurve([ARC, { curve: { shape: 'arcUp', amount: 60 } }])).toEqual({ choice: 'arcUp', amount: 'mixed' })
    expect(sharedCurve([ARC, plain])).toEqual({ choice: 'mixed', amount: null })
  })
})

describe('pickCurve', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN)
  })
  afterAll(() => ed.end())

  it('starts a straight text’s shape at CURVE_START, or at the shape’s most where that is lower', () => {
    expect(pickCurve(plain, 'circle')).toEqual({ curve: { shape: 'circle', amount: CURVE_START } })
    expect(pickCurve(plain, 'wave')).toEqual({ curve: { shape: 'wave', amount: CURVE_MOST.wave } })
  })

  it('keeps the amount for another shape, held at its most', () => {
    expect(pickCurve(ARC, 'circle')).toEqual({ curve: { shape: 'circle', amount: 30 } })
    expect(pickCurve({ curve: { shape: 'arcUp', amount: 90 } }, 'arcDown')).toEqual({
      curve: { shape: 'arcDown', amount: CURVE_MOST.arcDown },
    })
  })

  it('takes the curve off for none, and writes nothing where nothing changes', () => {
    expect(pickCurve(ARC, 'none')).toEqual({ curve: undefined })
    expect(pickCurve(plain, 'none')).toBeNull()
    expect(pickCurve(ARC, 'arcUp')).toBeNull()
  })

  it('curves every selected text and fits its box in one undo step, and none gives back the settings it kept', () => {
    const before = { kept: ed.core.drawnPropsOf('kept'), wide: ed.core.drawnPropsOf('wide') }
    const target = targetOf(ed, ['kept', 'wide'])
    expect(set(target, (now) => pickCurve(now, 'circle'))).toBe(true)
    const kept = ed.core.drawnPropsOf('kept')
    expect(kept.curve).toEqual({ shape: 'circle', amount: CURVE_START })
    expect(ed.core.drawnPropsOf('wide').curve).toEqual({ shape: 'circle', amount: CURVE_START })
    // A circle is about as tall as it is wide, unlike the straight text's box.
    expect(Math.abs(Number(kept.width) - Number(kept.height))).toBeLessThan(Number(kept.width) * 0.2)
    expect(sharedCurve(targetOf(ed, ['kept', 'wide']).props)).toEqual({ choice: 'circle', amount: CURVE_START })

    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('kept')).toEqual(before.kept)
    expect(ed.core.drawnPropsOf('wide')).toEqual(before.wide)

    ed.core.session.redo()
    expect(set(targetOf(ed, ['kept', 'wide']), (now) => pickCurve(now, 'none'))).toBe(true)
    const off = ed.core.drawnPropsOf('kept')
    expect(off.curve).toBeUndefined()
    for (const key of ['boxMode', 'list', 'align', 'wrapStyle', 'maxLines', 'shrinkToFit'] as const)
      expect(off[key]).toEqual(before.kept[key])
  })
})

describe('a curve picked in the panel', () => {
  it('keeps each box’s centre as the curve changes, and none gives a fixed box its straight size back', async () => {
    const ed = await testEditor(DESIGN)
    try {
      const centreOf = () => {
        const { x, y, width, height } = ed.core.drawnPropsOf('kept') as Record<string, number>
        return [(x ?? 0) + (width ?? 0) / 2, (y ?? 0) + (height ?? 0) / 2]
      }
      const [cx = 0, cy = 0] = centreOf()
      const steps = [
        (now: Record<string, unknown>) => pickCurve(now, 'arcUp'),
        (now: Record<string, unknown>) => curveAmountPatch(now, () => 90),
        (now: Record<string, unknown>) => pickCurve(now, 'circle'),
        (now: Record<string, unknown>) => pickCurve(now, 'none'),
      ]
      for (const step of steps) {
        expect(set(targetOf(ed, ['kept']), step)).toBe(true)
        const [x = 0, y = 0] = centreOf()
        expect(Math.abs(x - cx)).toBeLessThan(1)
        expect(Math.abs(y - cy)).toBeLessThan(1)
      }
      expect(ed.core.drawnPropsOf('kept')).toMatchObject({ width: 240, height: 200 })
    } finally {
      ed.end()
    }
  })
})

describe('amountMost', () => {
  it('stops the field at the highest of the texts’ shapes’ most, or an amount set past it', () => {
    expect(amountMost([WAVE])).toBe(CURVE_MOST.wave)
    expect(amountMost([WAVE, ARC, plain])).toBe(CURVE_MOST.arcUp)
    expect(amountMost([{ curve: { shape: 'arcDown', amount: 90 } }])).toBe(90)
  })
})

describe('curveAmountPatch', () => {
  it('changes a curved text’s amount from its own, held between 0 and its shape’s most', () => {
    expect(curveAmountPatch(ARC, (a) => a + 5)).toEqual({ curve: { shape: 'arcUp', amount: 35 } })
    expect(curveAmountPatch(WAVE, () => 90)).toEqual({ curve: { shape: 'wave', amount: CURVE_MOST.wave } })
    expect(curveAmountPatch(ARC, () => -4)).toEqual({ curve: { shape: 'arcUp', amount: 0 } })
  })

  it('steps an amount an agent set past its shape’s most from where it is, never higher', () => {
    const high = { curve: { shape: 'wave', amount: 80 } }
    expect(curveAmountPatch(high, (a) => a - 1)).toEqual({ curve: { shape: 'wave', amount: 79 } })
    expect(curveAmountPatch(high, (a) => a + 1)).toBeNull()
  })

  it('leaves a straight text, and an amount that doesn’t change, alone', () => {
    expect(curveAmountPatch(plain, () => 40)).toBeNull()
    expect(curveAmountPatch(ARC, (a) => a)).toBeNull()
  })
})

describe('anyCurved', () => {
  it('is true while any of the texts is curved', () => {
    expect(anyCurved([plain, ARC])).toBe(true)
    expect(anyCurved([plain, plain])).toBe(false)
  })
})

describe('sharedBounce', () => {
  it('reads the style and amount the texts share', () => {
    expect(sharedBounce([WAVY, WAVY])).toEqual({ choice: 'wavy', amount: 30 })
    expect(sharedBounce([plain, ARC])).toEqual({ choice: 'none', amount: null })
  })

  it('reads mixed where the texts differ, and an amount only while every one bounces', () => {
    expect(sharedBounce([WAVY, RANDOM])).toEqual({ choice: 'mixed', amount: 'mixed' })
    expect(sharedBounce([RANDOM, { bounce: { style: 'random', amount: 60, seed: 9 } }])).toEqual({
      choice: 'random',
      amount: 60,
    })
    expect(sharedBounce([WAVY, plain])).toEqual({ choice: 'mixed', amount: null })
  })
})

describe('pickBounce', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN)
  })
  afterAll(() => ed.end())

  it('starts a text with no bounce at BOUNCE_START: amount 30, seed 1', () => {
    expect(BOUNCE_START).toEqual({ amount: 30, seed: 1 })
    expect(pickBounce(plain, 'wavy')).toEqual({ bounce: { style: 'wavy', amount: 30, seed: 1 } })
    expect(pickBounce(ARC, 'random')).toEqual({ bounce: { style: 'random', amount: 30, seed: 1 } })
  })

  it('keeps the amount and seed for the other style', () => {
    expect(pickBounce(RANDOM, 'wavy')).toEqual({ bounce: { style: 'wavy', amount: 60, seed: 4 } })
  })

  it('takes the bounce off for none, and writes nothing where nothing changes', () => {
    expect(pickBounce(WAVY, 'none')).toEqual({ bounce: undefined })
    expect(pickBounce(plain, 'none')).toBeNull()
    expect(pickBounce(WAVY, 'wavy')).toBeNull()
  })

  it('bounces every selected text and grows an auto width box in one undo step, and none takes it off', () => {
    const before = { kept: ed.core.drawnPropsOf('kept'), wide: ed.core.drawnPropsOf('wide') }
    expect(set(targetOf(ed, ['kept', 'wide']), (now) => pickBounce(now, 'wavy'))).toBe(true)
    const wide = ed.core.drawnPropsOf('wide')
    expect(wide.bounce).toEqual({ style: 'wavy', amount: 30, seed: 1 })
    expect(ed.core.drawnPropsOf('kept').bounce).toEqual(wide.bounce)
    // The raised and lowered letters reach past the straight line's height.
    expect(Number(wide.height)).toBeGreaterThan(Number(before.wide.height))

    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('kept')).toEqual(before.kept)
    expect(ed.core.drawnPropsOf('wide')).toEqual(before.wide)

    ed.core.session.redo()
    expect(set(targetOf(ed, ['kept', 'wide']), (now) => pickBounce(now, 'none'))).toBe(true)
    expect(ed.core.drawnPropsOf('wide').bounce).toBeUndefined()
    expect(Number(ed.core.drawnPropsOf('wide').height)).toBeLessThan(Number(wide.height))
  })
})

describe('bounceAmountPatch', () => {
  it('changes a bounced text’s amount from its own, held between 0 and 100', () => {
    expect(bounceAmountPatch(WAVY, (a) => a + 5)).toEqual({ bounce: { style: 'wavy', amount: 35, seed: 1 } })
    expect(bounceAmountPatch(RANDOM, () => 140)).toEqual({ bounce: { style: 'random', amount: 100, seed: 4 } })
    expect(bounceAmountPatch(WAVY, () => -3)).toEqual({ bounce: { style: 'wavy', amount: 0, seed: 1 } })
  })

  it('leaves a text with no bounce, and an amount that doesn’t change, alone', () => {
    expect(bounceAmountPatch(plain, () => 40)).toBeNull()
    expect(bounceAmountPatch(WAVY, (a) => a)).toBeNull()
  })
})

describe('shufflePatch', () => {
  it('gives a random bounce the next whole number after its seed, keeping its amount', () => {
    expect(shufflePatch(RANDOM)).toEqual({ bounce: { style: 'random', amount: 60, seed: 5 } })
  })

  it('leaves a wavy text and one with no bounce alone', () => {
    expect(shufflePatch(WAVY)).toBeNull()
    expect(shufflePatch(plain)).toBeNull()
  })
})

describe('sharedTurn', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN)
  })
  afterAll(() => ed.end())

  it('reads the turn every character of the texts shares, 0 where none sets one', () => {
    expect(sharedTurn([{ style: STYLE }, { text: 'Hi', style: STYLE, runs: [] }])).toBe(0)
    expect(sharedTurn([{ ...TURNED, runs: TURNED.runs.slice(1) }])).toBe(10)
  })

  it('reads mixed where characters differ, in a run or in another text', () => {
    expect(sharedTurn([TURNED])).toBe('mixed')
    expect(sharedTurn([{ style: { turn: 10 } }, { style: STYLE }])).toBe('mixed')
  })

  it('reads the runs’ turns alone where they cover every character', () => {
    const covered = { text: 'Hi', style: { turn: 5 }, runs: [{ start: 0, end: 2, style: { turn: 30 } }] }
    expect(sharedTurn([covered])).toBe(30)
  })

  it('reads and turns only the selected run while a text is being edited, in one undo step', () => {
    ed.core.select(['wide'])
    ed.core.perform('goIn')
    ed.modules.typing.selectText({ start: 1, end: 3 })
    const target = targetOf(ed, ['wide'])
    expect(sharedTurn(target.props, target.range)).toBe(0)
    expect(textStyle(target).setStyle('turn', 25)).toBe(true)

    const turned = targetOf(ed, ['wide'])
    expect(sharedTurn(turned.props, turned.range)).toBe(25)
    expect(turned.props[0].runs).toEqual([{ start: 1, end: 3, style: { turn: 25 } }])
    expect((turned.props[0].style as Style).turn).toBeUndefined()
    expect(sharedTurn(turned.props)).toBe('mixed')

    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('wide').runs).toEqual([])
  })
})

describe('turnAllPatch', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(TURNED_DESIGN)
  })
  afterAll(() => ed.end())

  it('turns the base style and every run that sets its own turn by the one turn', () => {
    expect(turnAllPatch(TURNED, 45)).toEqual({
      style: { ...STYLE, turn: 45 },
      runs: [
        { start: 1, end: 2, style: { turn: 45 } },
        { start: 2, end: 3, style: { turn: 45 } },
      ],
    })
  })

  it('takes the base turn off at 0, and writes nothing where nothing changes', () => {
    expect(turnAllPatch({ style: { ...STYLE, turn: 10 }, runs: [] }, 0)).toEqual({ style: STYLE })
    expect(turnAllPatch({ style: STYLE, runs: [] }, 0)).toBeNull()
  })

  it('levels letters turned on their own with the rest of the text in one undo step, keeping what else their runs set', () => {
    const before = ed.core.drawnPropsOf('turned')
    expect(set(targetOf(ed, ['turned']), (now) => turnAllPatch(now, 45))).toBe(true)
    const after = targetOf(ed, ['turned'])
    expect(sharedTurn(after.props)).toBe(45)
    expect(
      (after.props[0].runs as { style: { fontWeight?: number } }[]).some((run) => run.style.fontWeight === 700),
    ).toBe(true)

    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('turned')).toEqual(before)
  })
})

describe('turnEachPatch', () => {
  it('changes each character’s turn from its own, held between −180 and 180', () => {
    expect(turnEachPatch(TURNED, (turn) => turn + 5)).toEqual({
      style: { ...STYLE, turn: 15 },
      runs: [
        { start: 1, end: 2, style: { turn: -15 } },
        { start: 2, end: 3, style: { turn: 15 } },
      ],
    })
    expect(turnEachPatch({ style: STYLE }, (turn) => turn + 200)).toEqual({ style: { ...STYLE, turn: 180 } })
  })

  it('writes nothing where no turn changes', () => {
    expect(turnEachPatch(TURNED, (turn) => turn)).toBeNull()
  })
})
