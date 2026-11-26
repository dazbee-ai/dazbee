// What the panels that follow the design are told as a page of 200 layers is edited, on the
// editor's core opened in Node with nothing stubbed: one count per change, or, held, none for the
// moves of a drag until it ends.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign, type Seeded } from '@dazbee/editor/test-matrix'
import type { Point } from '@dazbee/schema'

import { type Follows, liveDesignStore } from './use-live-design.ts'

/** 200 rectangles of 100 × 40 in a grid of 10 columns, `n0` at 10, 10 and `n1` beside it. */
const PAGE = frameDesign({
  name: 'Two hundred layers',
  nodes: Object.fromEntries(
    Array.from({ length: 200 }, (_, i): [string, Seeded] => [
      `n${i}`,
      {
        type: 'graphic',
        parentId: 'sq',
        index: `a${String(i).padStart(4, '0')}`,
        name: `Item ${i}`,
        props: {
          x: (i % 10) * 105 + 10,
          y: Math.floor(i / 10) * 50 + 10,
          width: 100,
          height: 40,
          shape: { kind: 'rect' },
          fills: [{ type: 'solid', color: '#3366FFFF' }],
        },
      },
    ]),
  ),
})
/** The pointer moves of each drag. */
const MOVES = 60

/** Follows the design with a store, counting what it tells, until `stop`. */
function follow(e: TestEditor, follows: Follows) {
  const store = liveDesignStore(e.core, follows)
  let told = 0
  const stop = store.subscribe(() => told++)
  return { told: () => told, read: store.read, stop }
}

describe('liveDesignStore', () => {
  let e: TestEditor
  /** Where `n1`'s middle is on the stage. */
  let n1: Point
  beforeAll(async () => {
    e = await testEditor(PAGE)
    n1 = e.core.stagePoint(165, 30, 'sq')
  })
  afterAll(() => e.end())

  /**
   * Selects `n1` and drags it by 120, 80 in `MOVES` moves, keeping what each store has told after
   * each move, and counting the moves that moved it: snapping holds it still for some.
   */
  function dragN1(stores: ReturnType<typeof follow>[], keys: { alt?: boolean } = {}) {
    e.core.select(['n1'])
    e.core.redraw()
    const before = stores.map((s) => s.told())
    const during: number[][] = []
    const placeOf = () => JSON.stringify(e.core.drawnPropsOf('n1'))
    let place = placeOf()
    let moved = 0
    e.mouse.move(n1.x, n1.y)
    if (keys.alt) e.keys.down('Alt')
    e.mouse.down()
    for (let k = 1; k <= MOVES; k++) {
      e.mouse.move(n1.x + (120 * k) / MOVES, n1.y + (80 * k) / MOVES)
      during.push(stores.map((s, i) => s.told() - (before[i] ?? 0)))
      if (placeOf() !== place) moved++
      place = placeOf()
    }
    e.mouse.up()
    if (keys.alt) e.keys.up('Alt')
    return { during, moved, after: stores.map((s, i) => s.told() - (before[i] ?? 0)) }
  }

  it('tells a follower of every change once per move of a drag that moves the layer', () => {
    const every = follow(e, 'every change')
    const { during, moved } = dragN1([every])
    e.press('undo')
    every.stop()
    expect([during.at(-1), moved > MOVES / 2]).toEqual([[moved], true])
  })

  it('holds a drag’s moves back from a held follower, and tells it once as the drag ends', () => {
    const held = follow(e, 'held places')
    const { during, moved, after } = dragN1([held])
    const version = held.read()
    e.press('undo')
    held.stop()
    expect([during.at(-1), moved > MOVES / 2, after, version]).toEqual([[0], true, [1], 1])
  })

  it('tells a held follower at once of a copy an Alt-drag makes', () => {
    const held = follow(e, 'held places')
    const { during } = dragN1([held], { alt: true })
    e.press('undo')
    held.stop()
    expect(during.at(-1)?.[0]).toBeGreaterThan(0)
  })

  it('tells a held follower at once of a change outside a gesture: a rename, and a nudge', () => {
    const held = follow(e, 'held places')
    e.core.select(['n1'])
    e.core.renameLayer('n1', 'Renamed')
    e.core.redraw()
    const renamed = held.told()
    e.press('nudgeRight')
    const nudged = held.told()
    e.press('undo')
    e.press('undo')
    held.stop()
    expect([renamed, nudged]).toEqual([1, 2])
  })

  it('tells a held follower once as Escape drops a drag', () => {
    const held = follow(e, 'held places')
    e.core.select(['n1'])
    e.core.redraw()
    e.mouse.move(n1.x, n1.y)
    e.mouse.down()
    e.mouse.move(n1.x + 100, n1.y + 60, { steps: 10 })
    const during = held.told()
    e.keys.press('Escape')
    e.mouse.up()
    held.stop()
    expect([during, held.told()]).toEqual([0, 1])
  })

  it('tells a held follower once as a panel’s scrub ends, with no redraw after it', () => {
    const held = follow(e, 'held places')
    const end = e.core.beginGesture()
    for (const x of [200, 210, 220]) {
      e.core.setProps(['n1'], () => ({ x }))
      e.core.redraw()
    }
    const during = held.told()
    end()
    const after = held.told()
    e.press('undo')
    held.stop()
    expect([during, after]).toEqual([0, 1])
  })

  it('tells a held follower at once of a section or connector change in a gesture', () => {
    const held = follow(e, 'held places')
    e.core.session.run('section.add', { pageId: 'p1', id: 'group', frameIds: ['sq'] })
    e.core.redraw()
    const before = held.told()
    const end = e.core.beginGesture()
    e.core.setProps(['n1'], () => ({ x: 200 }))
    e.core.redraw()
    e.core.session.run('section.update', { sectionId: 'group', title: 'Renamed' })
    e.core.redraw()
    const during = held.told() - before
    end()
    e.press('undo')
    e.press('undo')
    held.stop()
    expect(during).toBe(1)
  })

  it('tells each follower of new brand kit values, which change what layers bound to them show, and not of a redraw alone', async () => {
    const every = follow(e, 'every change')
    const held = follow(e, 'held places')
    await e.core.setVariables({ 'brand:primary': '#FF0000FF' })
    e.core.redraw()
    const told = [every.told(), held.told()]
    e.core.redraw()
    every.stop()
    held.stop()
    expect([told, [every.told(), held.told()]]).toEqual([
      [1, 1],
      [1, 1],
    ])
  })

  it('lets go of the editor when the last follower stops', () => {
    const held = follow(e, 'held places')
    held.stop()
    e.core.renameLayer('n1', 'Gone')
    e.core.redraw()
    e.press('undo')
    expect(held.told()).toBe(0)
  })
})
