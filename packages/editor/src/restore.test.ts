import { afterEach, describe, expect, it } from 'vitest'

import { type Design, type DesignInput, type Member, parseDesign, type RestoreMark } from '@dazbee/schema'

import { openTab } from './open-tab.ts'
import { WORDS } from './test-actions.ts'
import { type TestEditor, testEditor } from './test-editor.ts'
import { type MemorySync, memorySync } from './test-link.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const BOB: Member = { userId: 'bob', workspaceId: 'w1' }
const VIC: Member = { userId: 'vic', workspaceId: 'w1' }

const MARK: RestoreMark = {
  versionId: 'v1',
  kind: 'named',
  name: 'Sent to client',
  takenAt: '2026-11-16T14:30:00.000Z',
}

let mem: MemorySync
const editors: TestEditor[] = []
const closing: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const e of editors.splice(0)) e.end()
  for (const close of closing.splice(0)) await close()
})

/** An editor on a tab of the server in memory, as `token`'s member; its client's change sets kept to `messageBytes` when given. */
async function editorOn(token = 'ann', member = ANN, messageBytes?: number) {
  const tab = await openTab({
    designId: 'd',
    member,
    url: 'ws://s',
    token: () => Promise.resolve(token),
    socket: mem.socket,
    ...(messageBytes === undefined ? {} : { client: { limits: { messageBytes } } }),
  })
  closing.push(() => tab.close())
  const editor = await testEditor(WORDS, { tab })
  editors.push(editor)
  return editor
}

/** Lets every message on its way land, and what it set going run. */
async function settle() {
  for (let n = 0; n < 5; n++) {
    await mem.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function parsed(input: DesignInput): Design {
  const result = parseDesign(input)
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}

/**
 * WORDS as a version kept it: its page renamed, a second page with a frame of its own, the words
 * other, and the square `c` gone; under another meta, which a restore never takes.
 */
function version(pages: 'both' | 'third' = 'both'): Design {
  const design = parsed(WORDS)
  const nodes = { ...design.nodes }
  delete nodes.c
  const words = nodes.words
  if (words?.type !== 'text') throw new Error('WORDS changed')
  nodes.words = { ...words, props: { ...words.props, text: 'Kept words' } }
  const second = pages === 'both' ? 'p2' : 'p3'
  const first = pages === 'both' ? { p1: { name: 'Kept', order: 'a0' } } : {}
  const frames =
    pages === 'both'
      ? design.frames
      : Object.fromEntries(Object.entries(design.frames).map(([id, frame]) => [id, { ...frame, pageId: second }]))
  return {
    ...design,
    meta: { designId: 'elsewhere', name: 'Another name' },
    pages: { ...first, [second]: { name: 'Second', order: 'a1' } },
    frames: {
      ...frames,
      story: { pageId: second, name: 'Story', width: 1080, height: 1920, x: 0, y: 0, fills: [], order: 'a5' },
    },
    nodes,
  }
}

/** The design a restore of `kept` leaves in a tab that had `before`. */
const restored = (kept: Design, before: Design): Design => ({ ...kept, meta: before.meta })

const restoredNotices = (e: TestEditor) => e.told.filter(([notice]) => notice === 'restored')

describe('restoreVersion', () => {
  it('makes both tabs’ designs the version’s, the name kept, in one undo step of the restoring tab; the other is told who and which', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob', BOB)
    const before = a.core.design()

    await expect(a.core.restoreVersion(version(), MARK)).resolves.toBe('restored')
    await settle()

    expect(a.core.design()).toEqual(restored(version(), before))
    expect(b.core.design()).toEqual(restored(version(), before))
    expect(restoredNotices(b)).toEqual([['restored', { by: 'Ann', mark: MARK }]])
    expect(restoredNotices(a)).toEqual([])
    expect(a.core.undoName()).toBe('restore')
    a.core.perform('undo')
    await settle()
    expect(a.core.design()).toEqual(before)
    expect(b.core.design()).toEqual(before)
    a.core.perform('redo')
    await settle()
    expect(b.core.design()).toEqual(restored(version(), before))
    expect(restoredNotices(b)).toHaveLength(1)
  })

  it('tells a restore done from one put back by what it wrote, whatever defaults the version leaves out', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const kept = version()
    const story: Partial<Design['frames'][string]> = { ...kept.frames.story }
    delete story.fills
    kept.frames.story = story as Design['frames'][string]

    await expect(a.core.restoreVersion(kept, MARK)).resolves.toBe('restored')
    expect(a.core.undoName()).toBe('restore')
  })

  it('writes nothing and makes no undo step for a version the design already is, so an Undo after it takes back nothing of it', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    a.core.select(['words'])
    a.press('delete')
    const before = a.core.design()
    await expect(a.core.restoreVersion(before, MARK)).resolves.toBe('same')
    expect(a.core.design()).toEqual(before)
    // The step on top is still the delete made before it.
    expect(a.core.undoName()).toBe('delete')
  })

  it('ends the typing step first and lets the selection go', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    a.core.select(['words'])
    a.press('goIn')
    a.keys.press('End')
    a.keys.press('!')
    const typed = a.core.design()

    await a.core.restoreVersion(version(), MARK)

    expect([a.modules.typing.editing(), a.core.selection()]).toEqual([null, []])
    a.core.perform('undo')
    expect(a.core.design()).toEqual(typed)
    expect(a.core.undoName()).toBe('editText')
  })

  it('shows the page it is given when the version has it, else stays on its page when it has that, else the first', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()

    await a.core.restoreVersion(version(), MARK)
    expect(a.core.shownPage()).toBe('p1')
    await a.core.restoreVersion(version(), MARK, 'p2')
    expect(a.core.shownPage()).toBe('p2')
    await a.core.restoreVersion(version(), MARK, 'nowhere')
    expect(a.core.shownPage()).toBe('p2')
    await a.core.restoreVersion(version('third'), MARK)
    expect(a.core.shownPage()).toBe('p3')
  })

  it('writes and sends nothing from a Reviewer’s tab (C35)', async () => {
    mem = memorySync(WORDS)
    const vic = await editorOn('viewer', VIC)
    const before = vic.core.design()
    const stored = mem.state()

    const done = vic.core.restoreVersion(version(), MARK)
    expect(done).toBeInstanceOf(Promise)
    await done
    await settle()

    expect(vic.core.design()).toEqual(before)
    expect(mem.state()).toEqual(stored)
    expect(mem.sockets.flatMap((s) => s.sent).filter((m) => m.type === 'changes')).toEqual([])
  })

  it('puts back a restore past a change set’s limits: nothing sent, no step, the selection and page kept, the page told once with its step', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn('ann', ANN, 300)
    const b = await editorOn('bob', BOB)
    const before = a.core.design()
    a.core.select(['a'])

    await expect(a.core.restoreVersion(version('third'), MARK)).resolves.toBe('tooBig')
    await settle()

    expect([a.core.selection(), a.core.shownPage()]).toEqual([['a'], 'p1'])
    expect([a.core.design(), b.core.design(), a.core.canUndo()]).toEqual([before, before, false])
    expect(mem.sockets.flatMap((s) => s.sent).filter((m) => m.type === 'changes')).toEqual([])
    expect(a.told.filter(([notice]) => notice === 'putBack')).toEqual([['putBack', { step: 'restore' }]])
  })

  it('puts the restoring tab’s design back when another tab, ordered first, deleted a record the restore writes', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob', BOB)
    const kept = version()
    const square = kept.nodes.b
    if (!square) throw new Error('WORDS changed')
    kept.nodes.b = { ...square, name: 'Kept square' }

    // Bob deletes the square, and Ann restores before his change set reaches her.
    b.core.select(['b'])
    b.core.perform('delete')
    void a.core.restoreVersion(kept, MARK)
    await settle()

    expect(a.core.design()).toEqual(b.core.design())
    expect(a.core.design().nodes.b).toBeUndefined()
    expect(a.told).toContainEqual(['rejected', { kind: 'edit', reason: 'cannotApply' }])
  })
})
