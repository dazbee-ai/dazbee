// A hand edit of a bound property, by any command, ends its binding in the command's own step: on a
// session over a plain store, each case read back from the design.
import { describe, expect, it } from 'vitest'

import type { DesignInput, Layer } from '@dazbee/schema'

import { readDesign } from '../store.ts'
import { openTestSession, testDesign } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

/** The test design with the box's fill bound to the primary colour, and the headline's colour and font bound. */
function boundDesign(): DesignInput {
  const design = testDesign()
  Object.assign(design.nodes.box as object, { bindings: { fill: 'brand:primary' } })
  Object.assign(design.nodes.headline as object, { bindings: { textColor: 'brand:ink', fontFamily: 'brand:heading' } })
  return design
}

function open(design = boundDesign()) {
  const store = openTestStore(design)
  const tab = openTestSession(store)
  const layer = (id: string) => readDesign(store).nodes[id] as Layer
  return { store, tab, layer }
}

describe('a hand edit of a bound property', () => {
  it('ends a bound fill’s binding when node.update recolours it; undo brings both back, redo ends it again', () => {
    const { tab, layer } = open()
    tab.run('node.update', { ids: ['box'], patch: { fills: [{ type: 'solid', color: '#00FF00FF' }] } })
    expect(layer('box').bindings).toBeUndefined()
    expect(layer('box').props).toMatchObject({ fills: [{ color: '#00FF00FF' }] })

    tab.undo()
    expect(layer('box').bindings).toEqual({ fill: 'brand:primary' })
    expect(layer('box').props).toMatchObject({ fills: [{ color: '#FF5A36FF' }] })

    tab.redo()
    expect(layer('box').bindings).toBeUndefined()
    expect(layer('box').props).toMatchObject({ fills: [{ color: '#00FF00FF' }] })
  })
})
