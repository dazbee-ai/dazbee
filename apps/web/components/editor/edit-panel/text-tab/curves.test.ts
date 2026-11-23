// The Curve and bounce part's curve: the shape and amount several texts share, and what a pick of a
// shape or an amount writes, held against the editor so a pick refits the text's box in its one
// undo step and taking the curve off gives back the settings the text kept.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign } from '@dazbee/editor/test-matrix'

import { set, type Target } from '@/components/editor/edit-panel/target.ts'

import { amountMost, anyCurved, CURVE_MOST, CURVE_START, curveAmountPatch, pickCurve, sharedCurve } from './curves.ts'

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
const plain = {}

/** The selection as the edit panel reads it, each layer with its own values. */
function targetOf(ed: TestEditor, ids: string[]): Target {
  const design = ed.core.design()
  return {
    editor: ed.core as unknown as Editor,
    ids,
    props: ids.map((id) => ed.core.drawnPropsOf(id)) as Target['props'],
    types: ids.map((id) => design.nodes[id]?.type ?? ''),
    names: ids.map((id) => design.nodes[id]?.name ?? ''),
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
