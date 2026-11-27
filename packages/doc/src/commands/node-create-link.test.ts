// node.create with a link id: a layer linked to the layers of that id in the page's other frames.
import { describe, expect, it } from 'vitest'

import { readDesign } from '../index.ts'
import { badge, openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

describe('node.create', () => {
  it('links the layer to another frame’s by the link id given, and refuses one its frame holds already', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const a = tab.run('node.create', { parentId: 'sq', link: 'shared', layer: badge })
    const b = tab.run('node.create', { parentId: 'banner', link: 'shared', layer: badge })
    const design = readDesign(store)
    expect([design.nodes[a]?.link, design.nodes[b]?.link]).toEqual(['shared', 'shared'])
    expect(() => tab.run('node.create', { parentId: 'sq', link: 'shared', layer: badge })).toThrow(
      /frame "sq" holds link "shared" already/,
    )
  })

  it('refuses a link id of another page’s layer', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.create', { parentId: 'sq', link: 'shared', layer: badge })
    tab.run('page.add', { id: 'p2', name: 'Two', frame: { id: 'far', name: 'Far', width: 300, height: 300 } })
    expect(() => tab.run('node.create', { parentId: 'far', link: 'shared', layer: badge })).toThrow(/on another page/)
  })
})
