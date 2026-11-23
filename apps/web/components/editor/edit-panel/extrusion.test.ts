// The Effects panel's 3D: the extrusion several texts share, and what a pick of 3D, a depth, an
// angle or a side colour writes, held against the editor so a pick refits the text's box in its
// one undo step and taking 3D off removes the extrusion.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign } from '@dazbee/editor/test-matrix'
import { shadedColour } from '@dazbee/renderer'

import { set, type Target, targetOf } from '@/components/editor/edit-panel/target.ts'

import {
  anglePatch,
  depthPatch,
  EXTRUSION_START,
  pickExtrusion,
  sharedExtrusion,
  sideColourPatch,
  sidesPatch,
} from './extrusion.ts'

const RED = '#E53935FF'
const STYLE = { fontFamily: 'Noto Sans', fontSize: 40, color: RED }
/** An auto width text and a fixed box one, with no extrusion. */
const DESIGN = frameDesign({
  name: '3D',
  nodes: {
    wide: {
      type: 'text',
      parentId: 'sq',
      index: 'a0',
      name: 'Wide',
      props: { x: 100, y: 100, width: 200, height: 60, text: 'SALE', boxMode: 'autoWidth', style: STYLE },
    },
    kept: {
      type: 'text',
      parentId: 'sq',
      index: 'a1',
      name: 'Kept',
      props: { x: 100, y: 400, width: 240, height: 120, text: 'Summer hats', boxMode: 'fixed', style: STYLE },
    },
  },
})

const SHADE = { style: STYLE, extrusion: { depth: 15, angle: 45 } }
const BLUE = { style: STYLE, extrusion: { depth: 20, angle: 135, color: '#1E88E5FF' } }
const plain = { style: STYLE }

/** The texts `ids` as the edit panel reads them. */
function target(ed: TestEditor, ids: string[]): Target {
  const found = targetOf(ed.core as unknown as Editor, ids, ed.core.design())
  if (!found) throw new Error('no such texts')
  return found
}

describe('sharedExtrusion', () => {
  it('reads the depth, angle and sides the texts share, and the colour only while every one has a chosen colour', () => {
    expect(sharedExtrusion([SHADE, SHADE])).toEqual({ depth: 15, angle: 45, sides: 'shade', color: undefined })
    expect(sharedExtrusion([BLUE])).toEqual({ depth: 20, angle: 135, sides: 'colour', color: '#1E88E5FF' })
  })

  it('reads mixed where the texts differ', () => {
    expect(sharedExtrusion([SHADE, BLUE])).toEqual({ depth: 'mixed', angle: 'mixed', sides: 'mixed', color: undefined })
    const red = { extrusion: { ...BLUE.extrusion, color: RED } }
    expect(sharedExtrusion([BLUE, red])).toMatchObject({ depth: 20, sides: 'colour', color: 'mixed' })
  })

  it('is null unless every text has an extrusion', () => {
    expect(sharedExtrusion([plain])).toBeNull()
    expect(sharedExtrusion([SHADE, plain])).toBeNull()
  })
})

describe('pickExtrusion', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN)
  })
  afterAll(() => ed.end())

  it('starts a text with none at EXTRUSION_START: depth 15, angle 45, in the shade', () => {
    expect(EXTRUSION_START).toEqual({ depth: 15, angle: 45 })
    expect(pickExtrusion(plain, true)).toEqual({ extrusion: EXTRUSION_START })
  })

  it('keeps an extrusion a text has, takes it off, and writes nothing where nothing changes', () => {
    expect(pickExtrusion(BLUE, true)).toBeNull()
    expect(pickExtrusion(BLUE, false)).toEqual({ extrusion: undefined })
    expect(pickExtrusion(plain, false)).toBeNull()
  })

  it('gives every selected text 3D and grows an auto width box in one undo step, and taking it off removes it', () => {
    const before = { wide: ed.core.drawnPropsOf('wide'), kept: ed.core.drawnPropsOf('kept') }
    expect(set(target(ed, ['wide', 'kept']), (now) => pickExtrusion(now, true))).toBe(true)
    const wide = ed.core.drawnPropsOf('wide')
    expect(wide.extrusion).toEqual(EXTRUSION_START)
    expect(ed.core.drawnPropsOf('kept').extrusion).toEqual(EXTRUSION_START)
    // A fixed box stays as set.
    expect(ed.core.drawnPropsOf('kept').width).toEqual(before.kept.width)
    expect(sharedExtrusion(target(ed, ['wide', 'kept']).props)).toEqual({
      depth: 15,
      angle: 45,
      sides: 'shade',
      color: undefined,
    })

    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('wide')).toEqual(before.wide)
    expect(ed.core.drawnPropsOf('kept')).toEqual(before.kept)

    ed.core.session.redo()
    expect(set(target(ed, ['wide', 'kept']), (now) => pickExtrusion(now, false))).toBe(true)
    expect(ed.core.design().nodes.wide?.props).not.toHaveProperty('extrusion')
    expect(ed.core.design().nodes.kept?.props).not.toHaveProperty('extrusion')
    // The sides reached right and down past the letters, so the auto width box was larger both ways with them.
    const off = ed.core.drawnPropsOf('wide')
    expect(Number(wide.width)).toBeGreaterThan(Number(off.width))
    expect(Number(wide.height)).toBeGreaterThan(Number(off.height))
  })
})

describe('depthPatch', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN)
  })
  afterAll(() => ed.end())

  it('changes a text’s depth from its own, held between 0 and 100', () => {
    expect(depthPatch(SHADE, (d) => d + 5)).toEqual({ extrusion: { depth: 20, angle: 45 } })
    expect(depthPatch(SHADE, () => 140)).toEqual({ extrusion: { depth: 100, angle: 45 } })
    expect(depthPatch(SHADE, () => -3)).toEqual({ extrusion: { depth: 0, angle: 45 } })
    expect(depthPatch(BLUE, (d) => d + 1.234)).toEqual({ extrusion: { ...BLUE.extrusion, depth: 21.23 } })
  })

  it('leaves a text with no extrusion, and a depth that doesn’t change, alone', () => {
    expect(depthPatch(plain, (d) => d + 5)).toBeNull()
    expect(depthPatch(SHADE, (d) => d)).toBeNull()
  })

  it('moves each selected text’s depth from its own, refitting its box, in one undo step', () => {
    set(target(ed, ['wide']), () => ({ extrusion: { depth: 10, angle: 45 } }))
    set(target(ed, ['kept']), () => ({ extrusion: { depth: 30, angle: 45 } }))
    const before = ed.core.drawnPropsOf('wide')
    expect(set(target(ed, ['wide', 'kept']), (now) => depthPatch(now, (d) => d + 10))).toBe(true)
    expect(ed.core.drawnPropsOf('wide').extrusion).toEqual({ depth: 20, angle: 45 })
    expect(ed.core.drawnPropsOf('kept').extrusion).toEqual({ depth: 40, angle: 45 })
    expect(Number(ed.core.drawnPropsOf('wide').width)).toBeGreaterThan(Number(before.width))

    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('wide')).toEqual(before)
    expect(ed.core.drawnPropsOf('kept').extrusion).toEqual({ depth: 30, angle: 45 })
  })
})

describe('anglePatch', () => {
  it('changes a text’s angle from its own, wrapping round at 360', () => {
    expect(anglePatch(SHADE, (a) => a + 90)).toEqual({ extrusion: { depth: 15, angle: 135 } })
    expect(anglePatch(SHADE, (a) => a + 320)).toEqual({ extrusion: { depth: 15, angle: 5 } })
    expect(anglePatch(SHADE, () => -30)).toEqual({ extrusion: { depth: 15, angle: 330 } })
    expect(anglePatch(SHADE, () => 360)).toEqual({ extrusion: { depth: 15, angle: 0 } })
  })

  it('keeps the side colour, and leaves a text with no extrusion, and an angle that doesn’t change, alone', () => {
    expect(anglePatch(BLUE, () => 200)).toEqual({ extrusion: { ...BLUE.extrusion, angle: 200 } })
    expect(anglePatch(plain, () => 90)).toBeNull()
    expect(anglePatch(SHADE, () => 405)).toBeNull()
  })
})

describe('sidesPatch', () => {
  it('starts a chosen colour at the shade the sides show now, so the pick alone changes nothing drawn', () => {
    expect(sidesPatch(SHADE, 'colour')).toEqual({ extrusion: { depth: 15, angle: 45, color: shadedColour(RED) } })
  })

  it('keeps a colour the sides have, and takes it off for the shade', () => {
    expect(sidesPatch(BLUE, 'colour')).toBeNull()
    expect(sidesPatch(BLUE, 'shade')).toEqual({ extrusion: { depth: 20, angle: 135 } })
    expect(sidesPatch(SHADE, 'shade')).toBeNull()
    expect(sidesPatch(plain, 'colour')).toBeNull()
  })
})

describe('sideColourPatch', () => {
  it('sets the side colour, built from the one the text has', () => {
    expect(sideColourPatch(BLUE, () => '#FDD835FF')).toEqual({ extrusion: { ...BLUE.extrusion, color: '#FDD835FF' } })
    expect(sideColourPatch(BLUE, (now) => `${now?.slice(0, 7)}80`)).toEqual({
      extrusion: { ...BLUE.extrusion, color: '#1E88E580' },
    })
  })

  it('leaves a text with no extrusion, and a colour that doesn’t change, alone', () => {
    expect(sideColourPatch(plain, () => RED)).toBeNull()
    expect(sideColourPatch(BLUE, (now) => now ?? RED)).toBeNull()
  })
})
