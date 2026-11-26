import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { type Design, type DesignInput, parseDesign, type RestoreMark } from '@dazbee/schema'

import { CommandFault } from '../session.ts'
import { readDesign } from '../store.ts'
import { shapesDesign, testDesign } from '../test-design.ts'
import { twoTabs } from '../test-store.ts'
import { defineCommand } from './define.ts'
import { COMMANDS } from './index.ts'

const MARK: RestoreMark = {
  versionId: 'v1',
  kind: 'named',
  name: 'Sent to client',
  takenAt: '2026-11-16T14:30:00.000Z',
}

/** Marks its step as a restore, then throws: a restore that faults. */
const markThenThrow = defineCommand({
  name: 'test.markThenThrow',
  description: 'Marks its step as a restore, then throws.',
  step: 'restore',
  input: z.strictObject({}),
  apply: ({ w }) => {
    w.markRestore(MARK)
    throw new Error('a bug after the mark')
  },
})

function parsed(input: DesignInput): Design {
  const result = parseDesign(input)
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}

/** The test design as a version kept it: a page added, a frame's layers changed, a layer moved and one gone. */
function olderTest(): Design {
  const design = parsed(testDesign())
  const nodes = { ...design.nodes }
  delete nodes['banner-box']
  const headline = nodes.headline
  const box = nodes.box
  if (headline?.type !== 'text' || box?.type !== 'graphic') throw new Error('the test design changed')
  return {
    ...design,
    meta: { designId: 'elsewhere', name: 'Another name' },
    pages: { ...design.pages, p1: { name: 'First', order: 'a0' }, p2: { name: 'Second', order: 'a1' } },
    frames: {
      ...design.frames,
      banner: {
        ...(design.frames.banner as Design['frames'][string]),
        name: 'Old banner',
        guides: [{ axis: 'x', at: 4 }],
      },
      story: { pageId: 'p2', name: 'Story', width: 1080, height: 1920, x: 0, y: 0, fills: [], order: 'a0' },
    },
    nodes: {
      ...nodes,
      headline: {
        ...headline,
        parentId: 'banner',
        link: 'old-headline',
        index: 'a2',
        props: { ...headline.props, text: 'Old words', runs: [] },
      },
      box: { ...box, name: 'Old box', props: { ...box.props, x: 5, opacity: 0.5 } },
      'story-box': { ...box, parentId: 'story', link: 'story-box', index: 'a0' },
    },
  }
}

/** The design as a restore leaves it: the version's records under the design's own meta. */
const restored = (version: Design, meta: Design['meta']): Design => ({ ...version, meta })

describe('design.restore', () => {
  it.each([
    ['another design whose ids are all new', () => parsed(shapesDesign())],
    ['an older state of the design, sharing its ids', olderTest],
  ])('makes the pages, frames and layers those of %s, the meta kept, in one undo step', (_, version) => {
    const { a, tabA, tabB, b } = twoTabs()
    const before = readDesign(a)

    tabA.run('design.restore', { design: version(), mark: MARK })

    const after = restored(parsed(version()), before.meta)
    expect(readDesign(a)).toEqual(after)
    expect(readDesign(b)).toEqual(after)
    expect(tabA.undoName()).toBe('restore')
    tabA.undo()
    expect(readDesign(a)).toEqual(before)
    expect(readDesign(b)).toEqual(before)
    expect(tabA.canUndo()).toBe(false)
    tabA.redo()
    expect(readDesign(a)).toEqual(after)
    expect(readDesign(b)).toEqual(after)
    expect(tabB.canUndo()).toBe(false)
  })

  it('carries its mark to the other tabs, who hear who restored which version; its undo and redo carry none', () => {
    const { a, b, tabA } = twoTabs()

    tabA.run('design.restore', { design: olderTest(), mark: MARK })

    expect(b.takeNotices()).toEqual([{ kind: 'restored', by: 'local', mark: MARK }])
    expect(a.takeNotices()).toEqual([])
    tabA.undo()
    tabA.redo()
    expect(b.takeNotices()).toEqual([])
  })

  it("gives back on undo a linked copy it deleted with its own link, though it moved the copy's original into that frame", () => {
    const { a, b, tabA } = twoTabs()
    const before = readDesign(a)
    // The version has the square's headline in the banner, and no banner headline.
    const nodes = Object.fromEntries(Object.entries(before.nodes).filter(([id]) => id !== 'banner-headline'))
    const version = { ...before, nodes: { ...nodes, headline: { ...before.nodes.headline, parentId: 'banner' } } }

    tabA.run('design.restore', { design: version as Design, mark: MARK })
    expect(readDesign(a).nodes['banner-headline']).toBeUndefined()
    tabA.undo()

    expect(readDesign(a).nodes['banner-headline']?.link).toBe('headline')
    expect(readDesign(a)).toEqual(before)
    expect(readDesign(b)).toEqual(before)
  })

  it('gives a deleted linked copy back on undo with a link of its own when its original cannot leave its frame', () => {
    const { a, tabA, tabB, sync } = twoTabs()
    const before = readDesign(a)
    const nodes = Object.fromEntries(Object.entries(before.nodes).filter(([id]) => id !== 'banner-headline'))
    const version = { ...before, nodes: { ...nodes, headline: { ...before.nodes.headline, parentId: 'banner' } } }
    tabA.run('design.restore', { design: version as Design, mark: MARK })
    // The frame the headline would go back to is gone, so it stays in the banner.
    tabB.run('frame.delete', { frameId: 'sq' })
    sync()
    tabA.undo()
    const copy = readDesign(a).nodes['banner-headline']
    expect(copy?.parentId).toBe('banner')
    expect(copy?.link).not.toBe('headline')
  })

  it('makes no step and sends no mark when the design is the version already', () => {
    const { a, b, tabA } = twoTabs()

    tabA.run('design.restore', { design: readDesign(a), mark: MARK })

    expect(tabA.canUndo()).toBe(false)
    expect(b.takeNotices()).toEqual([])
  })

  it('refuses a version that gives an id the design holds as another part, or a layer of another type', () => {
    const { tabA } = twoTabs()
    const version = olderTest()
    const asPage = { ...version, pages: { ...version.pages, sq: { name: 'Clash', order: 'a5' } } }
    const box = version.nodes.box
    if (box?.type !== 'graphic') throw new Error('the test design changed')
    const retyped = {
      ...version,
      nodes: { ...version.nodes, box: { ...box, type: 'group', props: { x: 0, y: 0, width: 10, height: 10 } } },
    }

    expect(() => tabA.run('design.restore', { design: asPage, mark: MARK })).toThrow(/page "sq" is a frame/)
    expect(() => tabA.run('design.restore', { design: retyped as unknown as Design, mark: MARK })).toThrow(
      /layer "box" is a group, the design's a graphic/,
    )
    expect(tabA.canUndo()).toBe(false)
  })

  describe('faulting after its mark', () => {
    const registry = COMMANDS as Record<string, unknown>
    beforeAll(() => {
      registry['test.markThenThrow'] = markThenThrow
    })
    afterAll(() => {
      Reflect.deleteProperty(registry, 'test.markThenThrow')
    })

    it('leaves no mark: the next step carries none', () => {
      const { b, tabA } = twoTabs()

      expect(() => tabA.run('test.markThenThrow' as never, {} as never)).toThrow(CommandFault)
      tabA.run('page.update', { id: 'p1', name: 'Renamed' })

      expect(b.takeNotices()).toEqual([])
      expect(readDesign(b).pages.p1?.name).toBe('Renamed')
    })
  })
})
