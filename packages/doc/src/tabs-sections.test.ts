// Two tabs racing on sections and connectors (ADR-0024), each a plain store on the sync core's
// simulator: loose references let both change sets through, and an undo brings back what a delete
// took, as the end checks find.
import { afterEach, describe, expect, it } from 'vitest'

import { connectorsOf, type Design, type DesignInput, sectionOf } from '@dazbee/schema'

import { sectionedDesign } from './test-design.ts'
import { closeTabs, endChecks, quiesce, type SimTab, type Tabs, tabsOn } from './test-tabs.ts'

/** What the end checks find when nothing is lost. */
const CLEAN = { leftOut: [], repaired: [], missing: [] }

/** The tabs each test opened, closed after it. */
const opened: Tabs[] = []
afterEach(() => {
  for (const world of opened.splice(0)) closeTabs(world)
})

/** Two tabs, A and B, on `design`, closed after the test. */
async function twoTabs(design: DesignInput) {
  const world = await tabsOn(design, 2)
  opened.push(world)
  const [a, b] = world.tabs as [SimTab, SimTab]
  return { world, a: a.session, b: b.session, deliver: () => quiesce(world) }
}

describe('crossings of section and connector commands', () => {
  it.each(['section.ungroup', 'section.delete'] as const)(
    'A runs %s while B puts a frame into that section: both are accepted, and the frame ends in no section',
    async (command) => {
      const { world, a, b, deliver } = await twoTabs(sectionedDesign())
      a.run(command, { sectionId: 'ads' })
      b.run('frame.setSection', { frameIds: ['tall'], sectionId: 'ads' })
      await deliver()
      expect(world.sim.counts.rejected).toBe(0)
      for (const tab of [a, b]) {
        expect(sectionOf(tab.design(), 'tall')).toBeUndefined()
        expect(tab.design().sections.ads).toBeUndefined()
      }
      expect(b.design()).toEqual(a.design())
      expect(await endChecks(world)).toEqual(CLEAN)
    },
  )

  it('A deletes a frame while B draws a connector to it: both are accepted, it stays hidden, and A’s undo draws it again', async () => {
    const { world, a, b, deliver } = await twoTabs(sectionedDesign())
    a.run('frame.delete', { frameId: 'tall' })
    b.run('connector.add', { pageId: 'p1', from: 'other', to: 'tall', id: 'other-tall' })
    await deliver()
    expect(world.sim.counts.rejected).toBe(0)
    expect(a.design().connectors['other-tall']).toBeDefined()
    expect(connectorsOf(a.design(), 'p1').map(([id]) => id)).toEqual(['sq-story', 'ads-wide'])
    // Another command on the page leaves it as it is.
    a.run('frame.setSection', { frameIds: ['other'], sectionId: 'banners' })
    await deliver()
    for (const tab of [a, b]) expect(tab.design().connectors['other-tall']).toBeDefined()
    a.undo()
    a.undo()
    await deliver()
    for (const tab of [a, b]) expect(connectorsOf(tab.design(), 'p1').map(([id]) => id)).toContain('other-tall')
    expect(world.sim.counts.rejected).toBe(0)
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  /**
   * A deletes, B (not yet told) moves a layer of the story frame, and A undoes once B's move has
   * arrived. Gives the design both tabs end with, how B's move fared, and the end checks.
   */
  async function deleteCrossingAnEdit(remove: (tab: SimTab['session']) => void) {
    const { world, a, b, deliver } = await twoTabs(sectionedDesign())
    remove(a)
    b.run('node.update', { ids: ['story-bg'], patch: { x: 50 } })
    await deliver()
    const rejectedBeforeUndo = world.sim.counts.rejected
    a.undo()
    await deliver()
    expect(b.design()).toEqual(a.design())
    const tabB = world.tabs[1] as SimTab
    return {
      // The end checks redo A's delete: the design is read before them.
      design: JSON.parse(JSON.stringify(a.design())) as Design,
      edit: {
        x: a.design().nodes['story-bg']?.props.x,
        rejected: [rejectedBeforeUndo, world.sim.counts.rejected],
        notices: tabB.store.takeNotices().map(({ kind }) => kind),
      },
      checks: await endChecks(world),
    }
  }

  it('A deletes a section with its frames while B edits a layer in one; A’s undo brings everything back, B’s edit as after a frame delete', async () => {
    const { start } = (await twoTabs(sectionedDesign())).world
    const section = await deleteCrossingAnEdit((a) => a.run('section.delete', { sectionId: 'ads' }))
    const frame = await deleteCrossingAnEdit((a) => a.run('frame.delete', { frameId: 'story' }))
    expect(section.design).toEqual({
      ...start,
      nodes: { ...start.nodes, 'story-bg': section.design.nodes['story-bg'] },
    })
    expect(section.edit).toEqual(frame.edit)
    expect(section.checks).toEqual(CLEAN)
  })
})

describe('an undo of what another tab has since connected to', () => {
  /** The connector B drew to section "mine" is drawn on both tabs, which agree. */
  function expectDrawn(a: SimTab['session'], b: SimTab['session']) {
    for (const tab of [a, b]) {
      expect(tab.design().sections.mine).toBeDefined()
      expect(connectorsOf(tab.design(), 'p1').map(([id]) => id)).toContain('to-mine')
    }
    expect(b.design()).toEqual(a.design())
  }

  it('A undoes making a section B connected to, B runs another command on the page, A redoes: the connector is back', async () => {
    const { world, a, b, deliver } = await twoTabs(sectionedDesign())
    a.run('section.add', { pageId: 'p1', id: 'mine', frameIds: ['tall'] })
    await deliver()
    b.run('connector.add', { pageId: 'p1', from: 'other', to: 'mine', id: 'to-mine' })
    await deliver()
    a.undo()
    await deliver()
    b.run('frame.setSection', { frameIds: ['other'], sectionId: 'banners' })
    await deliver()
    a.redo()
    await deliver()
    expect(sectionOf(a.design(), 'tall')).toBe('mine')
    expectDrawn(a, b)
    expect(world.sim.counts.rejected).toBe(0)
    expect(await endChecks(world)).toEqual(CLEAN)
  })

  it('A undoes making a frame and a section of it that B connected to, B runs another command, A redoes both: the connector is back', async () => {
    const { world, a, b, deliver } = await twoTabs(sectionedDesign())
    a.run('frame.add', { id: 'nf', pageId: 'p1', name: 'New', width: 300, height: 250 })
    a.run('section.add', { pageId: 'p1', id: 'mine', frameIds: ['nf'] })
    await deliver()
    b.run('connector.add', { pageId: 'p1', from: 'other', to: 'mine', id: 'to-mine' })
    await deliver()
    a.undo()
    a.undo()
    await deliver()
    expect(a.design().frames.nf).toBeUndefined()
    b.run('frame.setSection', { frameIds: ['other'], sectionId: 'banners' })
    await deliver()
    a.redo()
    a.redo()
    await deliver()
    expect(sectionOf(a.design(), 'nf')).toBe('mine')
    expectDrawn(a, b)
    expect(world.sim.counts.rejected).toBe(0)
    expect(await endChecks(world)).toEqual(CLEAN)
  })
})
