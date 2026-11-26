// #630's crossings of two tabs' edits and undos, each tab a plain store on the sync core's
// simulator: what a tab writes reaches the other only when everything is delivered (`deliver`).
// Each case ends with the end checks: once every tab has undone everything it can, the read leaves
// nothing out, repairs nothing, and every page, frame and layer the tabs started with is there.
import { afterEach, describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { badge, kindsDesign, linkedDesign, sectionedDesign, testDesign } from './test-design.ts'
import {
  closeTabs,
  endChecks,
  quiesce,
  readChecks,
  redoEverything,
  type SimTab,
  type Tabs,
  tabsOn,
  type TabsOptions,
  undoEverything,
} from './test-tabs.ts'

/** What the end checks find when nothing is lost. */
const CLEAN = { leftOut: [], repaired: [], missing: [] }

/** The tabs each test opened, closed after it. */
const opened: Tabs[] = []
afterEach(() => {
  for (const world of opened.splice(0)) closeTabs(world)
})

/** Two tabs on `design`, closed after the test. */
async function openTwo(design: DesignInput, options?: TabsOptions) {
  const world = await tabsOn(design, 2, options)
  opened.push(world)
  return world
}

/** Two tabs, A and B, on `design`. */
async function twoTabs(design: DesignInput = testDesign()) {
  const world = await openTwo(design)
  const [a, b] = world.tabs as [SimTab, SimTab]
  return { world, a: a.session, b: b.session, deliver: () => quiesce(world) }
}

describe('a rename undone after its frame went with its page in the other tab', () => {
  it('throw nowhere: the rename B undoes last waits for its frame, and the tabs go on together', async () => {
    const { world, a, b, deliver } = await twoTabs(kindsDesign())
    a.run('page.add', { id: 'p2', name: 'Two', frame: { id: 'p2-f', name: 'Frame', width: 300, height: 250 } })
    b.run('frame.update', { frameId: 'f', name: 'One' })
    b.run('frame.delete', { frameId: 'f' })
    b.undo()
    await deliver()
    b.run('frame.update', { frameId: 'f', name: 'Two' })
    b.undo()
    b.run('page.duplicate', { id: 'p1', newId: 'p3', name: 'Copy' })
    await deliver()
    a.run('page.delete', { id: 'p1' })
    await deliver()
    b.undo()
    // B's rename of f is next, and f went with its page: it waits.
    b.undo()
    await deliver()
    expect(Object.keys(b.design().pages)).toEqual(['p2'])
    expect(b.canUndo()).toBe(false)
    // A's undo brings the page back, rewriting every value of f: B's rename has nothing left to undo.
    a.undo()
    await deliver()
    expect(b.design().frames.f?.name).toBe('One')
    b.undo()
    expect(b.canUndo()).toBe(false)
    b.run('node.create', { id: 'next', parentId: 'p2-f', layer: badge })
    await deliver()
    expect(a.design().nodes.next).toBeDefined()
    b.undo()
    await deliver()
    expect(a.design().nodes.next).toBeUndefined()
    expect(await endChecks(world)).toEqual(CLEAN)
  })
})

describe('crossings of two tabs', () => {
  it('1a. a box of two shapes, a boolean of them inside it in the other tab, each tab undoing before it hears of the other', async () => {
    const { world, a, b, deliver } = await twoTabs(kindsDesign())
    a.run('node.box', { ids: ['r-abs', 'r1'], id: 'wrapped-A' })
    await deliver()
    b.run('node.boolean', { ids: ['r1', 'r-abs'], op: 'subtract', id: 'wrapped-B' })
    a.undo()
    b.undo()
    await undoEverything(world)
    expect(await readChecks(world)).toEqual(CLEAN)
    expect(a.design()).toEqual(world.start)
    await redoEverything(world)
  })

  for (const order of ['B then A', 'A then B'] as const)
    it(`1b. B makes a boolean of two shapes, A one of the same two inside it, both undo (${order})`, async () => {
      const { world, a, b, deliver } = await twoTabs(kindsDesign())
      b.run('node.boolean', { ids: ['r1', 'r2'], op: 'union', id: 'gb' })
      await deliver()
      a.run('node.boolean', { ids: ['r1', 'r2'], op: 'union', id: 'ga' })
      await deliver()
      const [first, second] = order === 'B then A' ? [b, a] : [a, b]
      first.undo()
      await deliver()
      second.undo()
      await undoEverything(world)
      expect(await readChecks(world)).toEqual(CLEAN)
      // A's undo wrote r1 and r2 back into B's boolean, after B's step: B's undo leaves them, and the boolean that holds them.
      expect([a.design().nodes.r1?.parentId, a.design().nodes.r2?.parentId]).toEqual(['gb', 'gb'])
      await redoEverything(world)
    })

  it('1c. a box of two shapes that the other tab ungroups, both undone', async () => {
    const { world, a, b, deliver } = await twoTabs(kindsDesign())
    a.run('node.box', { ids: ['mask', 'masked'], id: 'wrapped-A' })
    await deliver()
    b.run('node.ungroup', { ids: ['wrapped-A'] })
    a.undo()
    b.undo()
    await undoEverything(world)
    expect(await readChecks(world)).toEqual(CLEAN)
    expect(a.design()).toEqual(world.start)
    await redoEverything(world)
  })

  it('2. a page one tab deletes while the other changes a frame on it, the delete undone', async () => {
    const { world, a, b, deliver } = await twoTabs(linkedDesign())
    a.run('page.delete', { id: 'p1' })
    b.run('frame.update', { frameId: 'story', name: 'Renamed', width: 600, height: 500, x: 10, y: 20 })
    await deliver()
    a.undo()
    b.undo()
    await undoEverything(world)
    expect(await readChecks(world)).toEqual(CLEAN)
    expect(a.design()).toEqual(world.start)
    await redoEverything(world)
  })

  it('3. a page one tab copies, a frame of the copy the other deletes, both undone before they hear of it', async () => {
    const { world, a, b, deliver } = await twoTabs(kindsDesign())
    b.run('page.duplicate', { id: 'p1', newId: 'p2' })
    await deliver()
    const [copy] = Object.entries(a.design().frames).find(([, frame]) => frame.pageId === 'p2') ?? []
    a.run('frame.delete', { frameId: copy as string })
    a.undo()
    b.undo()
    await undoEverything(world)
    expect(await readChecks(world)).toEqual(CLEAN)
    expect(a.design()).toEqual(world.start)
    await redoEverything(world)
  })

  it('4. the view follows another tab moving a group a layer was put into after its maker undid it', async () => {
    const { world, a, b, deliver } = await twoTabs(kindsDesign())
    a.run('node.group', { ids: ['r1', 'r2'], id: 'G' })
    await deliver()
    b.run('node.move', { id: 'turned', parentId: 'G' })
    await deliver()
    // B's layer is in the group: A's undo leaves the group, and puts r1 and r2 back.
    a.undo()
    await deliver()
    expect(a.design().nodes.turned?.parentId).toBe('G')
    b.run('node.move', { id: 'G', parentId: 'f' })
    await deliver()
    expect(a.design().nodes.G?.parentId).toBe('f')
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('5. pages deleted by both tabs at once leave one, which a rename and a new frame keep', async () => {
    const { world, a, b, deliver } = await twoTabs()
    a.run('page.add', { id: 'p2', name: 'Two', frame: { id: 'p2-sq', name: 'Square', width: 1080, height: 1080 } })
    await deliver()
    a.run('page.delete', { id: 'p1' })
    b.run('page.delete', { id: 'p2' })
    await deliver()
    // The server refuses the delete ordered second: a design keeps a page.
    const [page = ''] = Object.keys(a.design().pages)
    expect(Object.keys(b.design().pages)).toEqual([page])
    a.run('page.update', { id: page, name: 'Cover' })
    b.run('frame.add', { id: 'late', pageId: page, name: 'Late', width: 300, height: 250 })
    await deliver()
    a.undo()
    await deliver()
    expect(Object.keys(a.design().pages)).toEqual([page])
    expect(a.design().frames.late?.pageId).toBe(page)
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  for (const order of ['the delete after the making arrives', 'the delete at once with the making'] as const)
    it(`6. A undoes making a layer in a frame B deleted, B undoes the delete, A redoes (${order})`, async () => {
      const { world, a, b, deliver } = await twoTabs()
      a.run('node.update', { ids: ['box'], patch: { x: 7 } })
      a.run('node.create', { id: 'L', parentId: 'banner', layer: badge })
      if (order === 'the delete after the making arrives') await deliver()
      b.run('frame.delete', { frameId: 'banner' })
      await deliver()
      a.undo()
      await deliver()
      b.undo()
      await deliver()
      expect(a.design().frames.banner).toBeDefined()
      a.redo()
      await deliver()
      expect(await endChecks(world)).toEqual(CLEAN)
    })

  it('7. a tab cut off while the server forgets what it missed undoes and redoes everything it has', async () => {
    const world = await openTwo(testDesign(), { limits: { logChangeSets: 1 } })
    const [a, b] = world.tabs as [SimTab, SimTab]
    a.session.run('node.create', { id: 'L', parentId: 'sq', layer: badge })
    a.session.run('frame.delete', { frameId: 'banner' })
    await quiesce(world)
    world.sim.disconnect(0)
    b.session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    b.session.run('node.update', { ids: ['headline'], patch: { y: 5 } })
    await world.sim.settle()
    while (a.session.canUndo()) a.session.undo()
    while (a.session.canRedo()) a.session.redo()
    await quiesce(world)
    expect(world.sim.counts.wholeDesigns).toBe(1)
    expect(a.session.design().nodes.L).toBeDefined()
    expect(a.session.design().frames.banner).toBeUndefined()
  })
})

describe('crossings of deletes', () => {
  it('A deletes a frame while B deletes a layer in it; A undoes, then B undoes', async () => {
    const { world, a, b, deliver } = await twoTabs()
    a.run('frame.delete', { frameId: 'banner' })
    b.run('node.delete', { ids: ['banner-box'] })
    await deliver()
    a.undo()
    await deliver()
    b.undo()
    await deliver()
    expect([a.design().frames.banner, a.design().nodes['banner-box']].every(Boolean)).toBe(true)
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('A deletes a frame while B adds a layer to it; A undoes', async () => {
    const { world, a, b, deliver } = await twoTabs()
    a.run('frame.delete', { frameId: 'banner' })
    b.run('node.create', { id: 'dot', parentId: 'banner', layer: badge })
    await deliver()
    a.undo()
    await deliver()
    expect(a.design().frames.banner).toBeDefined()
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('A deletes a page while B renames a frame on it and moves a layer inside it; A undoes', async () => {
    const { world, a, b, deliver } = await twoTabs()
    a.run('page.add', { id: 'p2', name: 'Two', frame: { id: 'p2-sq', name: 'Square', width: 1080, height: 1080 } })
    const group = { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } } as const
    a.run('node.create', { id: 'g', parentId: 'p2-sq', layer: group })
    a.run('node.create', { id: 'dot', parentId: 'p2-sq', layer: badge })
    await deliver()
    a.run('page.delete', { id: 'p2' })
    b.run('frame.update', { frameId: 'p2-sq', name: 'Renamed' })
    b.run('node.move', { id: 'dot', parentId: 'g' })
    await deliver()
    a.undo()
    await deliver()
    expect(a.design().pages.p2).toBeDefined()
    expect(await endChecks(world)).toEqual(CLEAN)
  })
})

describe('crossings of makings', () => {
  it('a layer made, undone and redone twice is there', async () => {
    const { world, a } = await twoTabs()
    a.run('node.create', { id: 'n', parentId: 'sq', layer: badge })
    for (const press of [a.undo, a.redo, a.undo, a.redo]) press()
    expect(a.design().nodes.n).toBeDefined()
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('A makes L, B deletes L, A undoes the making, B undoes the delete, A redoes', async () => {
    const { world, a, b, deliver } = await twoTabs()
    a.run('node.create', { id: 'L', parentId: 'sq', layer: badge })
    await deliver()
    b.run('node.delete', { ids: ['L'] })
    await deliver()
    a.undo()
    await deliver()
    b.undo()
    await deliver()
    a.redo()
    await deliver()
    expect(a.design().nodes.L).toBeDefined()
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('A makes L and undoes it, B (not yet told) moves L, A redoes', async () => {
    const { world, a, b, deliver } = await twoTabs()
    a.run('node.create', { id: 'L', parentId: 'sq', layer: badge })
    await deliver()
    a.undo()
    b.run('node.update', { ids: ['L'], patch: { x: 333 } })
    await deliver()
    a.redo()
    await deliver()
    expect(a.design().nodes.L).toBeDefined()
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('A groups r1 and r2 into G, B moves another layer into G, A undoes and redoes', async () => {
    const { world, a, b, deliver } = await twoTabs(kindsDesign())
    a.run('node.group', { ids: ['r1', 'r2'], id: 'G' })
    await deliver()
    b.run('node.move', { id: 'turned', parentId: 'G' })
    await deliver()
    a.undo()
    await deliver()
    a.redo()
    await deliver()
    expect(a.design().nodes.turned?.parentId).toBe('G')
    expect(await endChecks(world)).toEqual(CLEAN)
  })
})

describe('guides two tabs add to one frame at once', () => {
  it('keep the list of the add the server orders later, whole, and each undo writes back what its step replaced', async () => {
    const { world, a, b, deliver } = await twoTabs()
    a.run('guide.add', { frameId: 'sq', axis: 'x', at: 100 })
    b.run('guide.add', { frameId: 'sq', axis: 'y', at: 200 })
    await deliver()
    // A's add is ordered first: B's list, one value, replaces it rather than joining it.
    for (const tab of [a, b]) expect(tab.design().frames.sq?.guides).toEqual([{ axis: 'y', at: 200 }])
    // B wrote the list after A's step, so A's undo leaves it.
    a.undo()
    await deliver()
    expect(b.design().frames.sq?.guides).toEqual([{ axis: 'y', at: 200 }])
    b.undo()
    await deliver()
    expect(a.design().frames.sq?.guides).toEqual([{ axis: 'x', at: 100 }])
    expect(await endChecks(world)).toEqual(CLEAN)
  })
})

/** Frame F, 1000 × 1000, holding a 100 × 100 badge, `c`, at its bottom right, set to right and bottom. */
const resizeDesign = (): DesignInput => ({
  meta: { designId: 'd1', name: 'Resize' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { F: { pageId: 'p1', name: 'F', width: 1000, height: 1000, x: 0, y: 0, order: 'a0' } },
  nodes: {
    c: {
      type: 'graphic',
      parentId: 'F',
      index: 'a0',
      link: 'c',
      name: 'Badge',
      props: {
        x: 850,
        y: 850,
        width: 100,
        height: 100,
        shape: { kind: 'rect' },
        constraints: { horizontal: 'right', vertical: 'bottom' },
      },
    },
  },
})

/**
 * Two tabs on the resize design, A resizing F to 1200 × 1200 while `edit` runs in B, with the tab
 * named by `later` offline until both have run, so the server orders its change set after the other's.
 */
async function resizeCrossing(later: 'A' | 'B', edit: (b: SimTab['session']) => void) {
  const { world, a, b } = await twoTabs(resizeDesign())
  world.sim.disconnect(later === 'A' ? 0 : 1)
  a.run('frame.resize', { frameId: 'F', width: 1200, height: 1200 })
  edit(b)
  await world.sim.settle()
  await quiesce(world)
  return { world, a, b }
}

/** The frame's size and the badge's place and constraints, as a tab holds them. */
function held(tab: SimTab['session']) {
  const design = tab.design()
  const props = design.nodes.c?.props
  return {
    frame: [design.frames.F?.width, design.frames.F?.height],
    badge: props && { x: props.x, y: props.y, constraints: props.constraints },
  }
}

describe('a frame resize crossing the other tab’s edit of a layer it moves (G9)', () => {
  const right = { horizontal: 'right', vertical: 'bottom' }

  it('the move ordered later keeps its x, the resize its y', async () => {
    const { world, a, b } = await resizeCrossing('B', (tab) =>
      tab.run('node.update', { ids: ['c'], patch: { x: 100 } }),
    )
    for (const tab of [a, b])
      expect(held(tab)).toEqual({ frame: [1200, 1200], badge: { x: 100, y: 1050, constraints: right } })
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('the resize ordered later puts the badge where it says', async () => {
    const { world, a, b } = await resizeCrossing('A', (tab) =>
      tab.run('node.update', { ids: ['c'], patch: { x: 100 } }),
    )
    for (const tab of [a, b])
      expect(held(tab)).toEqual({ frame: [1200, 1200], badge: { x: 1050, y: 1050, constraints: right } })
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('a re-pin keeps its new constraints and the place the old ones gave', async () => {
    const leftTop = { horizontal: 'left', vertical: 'top' }
    const { world, a, b } = await resizeCrossing('A', (tab) =>
      tab.run('node.update', { ids: ['c'], patch: { constraints: leftTop } }),
    )
    for (const tab of [a, b])
      expect(held(tab)).toEqual({ frame: [1200, 1200], badge: { x: 1050, y: 1050, constraints: leftTop } })
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('a delete ordered first rejects the resize whole: the frame keeps its size, both tabs agreeing', async () => {
    const { world, a, b } = await resizeCrossing('A', (tab) => tab.run('node.delete', { ids: ['c'] }))
    expect(world.sim.counts.rejected).toBe(1)
    for (const tab of [a, b]) expect(held(tab)).toEqual({ frame: [1000, 1000], badge: undefined })
    expect(await endChecks(world)).toEqual(CLEAN)
  })
})

describe('sections, connectors and stars written through the store', () => {
  it('reach the other tab: a section, a connector, and a frame joining a section and starred', async () => {
    const world = await openTwo(sectionedDesign())
    const [a, b] = world.tabs as [SimTab, SimTab]
    a.store.transact(() => {
      a.store.create('section', 'more', { pageId: 'p1', title: 'More', order: 'a2' })
      a.store.create('connector', 'tall-more', { pageId: 'p1', from: 'tall', to: 'more', order: 'a2' })
      a.store.set('frame', 'tall', 'sectionId', 'more')
      a.store.set('frame', 'tall', 'starred', true)
      a.store.unset('frame', 'story', 'starred')
    })
    await quiesce(world)
    const design = b.session.design()
    expect(design.sections.more).toEqual({ pageId: 'p1', title: 'More', order: 'a2' })
    expect(design.connectors['tall-more']).toEqual({ pageId: 'p1', from: 'tall', to: 'more', order: 'a2' })
    expect(design.frames.tall).toMatchObject({ sectionId: 'more', starred: true })
    expect(design.frames.story).not.toHaveProperty('starred')
    expect(b.session.design()).toEqual(a.session.design())
  })

  it("go with their page when a tab deletes it, and come back with the page's undo", async () => {
    const design = sectionedDesign()
    const far = { pageId: 'p2', from: 'far', to: 'far-section', order: 'a0' }
    const { world, a, b, deliver } = await twoTabs({ ...design, connectors: { ...design.connectors, 'far-link': far } })
    b.run('page.delete', { id: 'p2' })
    await deliver()
    expect(Object.keys(a.design().sections)).toEqual(['ads', 'banners'])
    expect(Object.keys(a.design().connectors)).toEqual(['sq-story', 'ads-wide'])
    b.undo()
    await deliver()
    expect(a.design().sections['far-section']).toEqual({ pageId: 'p2', title: 'Far', order: 'a0' })
    expect(a.design().connectors['far-link']).toEqual(far)
    expect(a.design().frames.far?.sectionId).toBe('far-section')
    expect(await endChecks(world)).toEqual(CLEAN)
  })
})
