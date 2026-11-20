// Per-person undo and redo across the server, as FigCraft's undo_tests.rs pins it: an undo reverts
// only the person's own writes, creates and deletes invert with the same ids and order keys, and
// work the server refuses leaves the history.
import { describe, expect, it } from 'vitest'

import type { Change, DesignRecords, Target } from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { linkedDesign, testDesign } from '../test-design.ts'
import { openClient } from './client.ts'
import { BACK, Step, Touches } from './history.ts'
import { openServer } from './server.ts'
import { DesignState } from './state.ts'
import { comeBack, down, edit, exchange, joinClient, testServer, testServerOptions, up, wire } from './test-session.ts'

const badgeProps = { x: 900, y: 40, width: 120, height: 120, shape: { kind: 'ellipse' } }
const layerKey = (id: string, key: string): Target => ({ part: 'layer', id, key })
const prop = (id: string, name: string): Target => ({ part: 'layer', id, key: 'props', prop: name })
const binding = (id: string, property: string): Target => ({ part: 'layer', id, key: 'bindings', prop: property })
const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })

/** A server and two clients, a and b. */
function session() {
  const server = testServer()
  const a = joinClient(server)
  const b = joinClient(server)
  return { server, a, b, everyone: [a, b] }
}

describe('Step', () => {
  it('undoes only your own writes, and redo does too', () => {
    const { server, a, b, everyone } = session()
    exchange(server, a, edit(a, 'edit', set(layerKey('box', 'name'), 'Mine'), set(prop('box', 'x'), 10)), everyone)
    // Someone else moves the box after that.
    exchange(server, b, edit(b, 'move', set(prop('box', 'x'), 99)), everyone)
    expect(a.undoName()).toBe('edit')
    exchange(server, a, a.undo(), everyone)
    const box = () => server.state().get('layer', 'box') as { name: string; props: { x: number } }
    expect(box().name).toBe('Box')
    expect(box().props.x).toBe(99)
    exchange(server, a, a.redo(), everyone)
    expect([box().name, box().props.x]).toEqual(['Mine', 99])
    // Batches from others never enter the history.
    expect(a.canRedo()).toBe(false)
    expect(b.canUndo()).toBe(true)
  })

  it('leaves a binding as another tab’s change of the layer’s bindings whole wrote it since', () => {
    const { server, a, b, everyone } = session()
    exchange(server, a, edit(a, 'bind', set(binding('box', 'fill'), 'brand:primary')), everyone)
    // B's change set holds the bindings whole, as a queue saved before they were set one by one does.
    const whole = set(layerKey('box', 'bindings'), { fill: 'brand:accent' })
    const sent = edit(b, 'bind all', whole).map((m) => (m.type === 'changes' ? { ...m, changes: [whole] } : m))
    exchange(server, b, sent, everyone)
    exchange(server, a, a.undo(), everyone)
    expect(server.state().get('layer', 'box')?.bindings).toEqual({ fill: 'brand:accent' })
  })

  it('leaves alone, in a step that set a layer’s bindings whole, a binding another tab set since', () => {
    const state = DesignState.fromRecords(testDesign() as unknown as DesignRecords)
    const target = layerKey('headline', 'bindings')
    const step = Step.restore({
      name: 'bind',
      confirmed: true,
      settledForward: true,
      writes: [{ target, after: { textColor: 'brand:ink' } }],
      records: [],
      taken: [],
      takenRecords: [],
    })
    state.apply(set(target, { textColor: 'brand:ink' }), 'strict')
    const theirs = set(binding('headline', 'fontFamily'), 'brand:heading')
    state.apply(theirs, 'strict')
    step.othersWrote(Touches.of([theirs]))
    expect(step.toward(BACK, state)).toEqual([])
  })

  it('inverts creates and deletes with the same ids and order keys', () => {
    const { server, a, b, everyone } = session()
    const start = server.state().toRecords()
    const badge = { type: 'graphic', parentId: 'sq', link: 'badge', index: 'a0V', name: 'Badge', props: badgeProps }
    exchange(server, a, edit(a, 'add', { op: 'create', part: 'layer', id: 'badge', record: badge }), everyone)
    const created = server.state().toRecords()
    exchange(server, a, a.undo(), everyone)
    expect(sameValue(server.state().toRecords(), start)).toBe(true)
    exchange(server, a, a.redo(), everyone)
    expect(sameValue(server.state().toRecords(), created)).toBe(true)
    // Deleting a frame with layers: undo brings the frame and its layers back whole, in place.
    exchange(server, b, edit(b, 'delete', { op: 'delete', part: 'frame', id: 'sq' }), everyone)
    expect(server.state().get('layer', 'badge')).toBeUndefined()
    exchange(server, b, b.undo(), everyone)
    expect(sameValue(server.state().toRecords(), created)).toBe(true)
    exchange(server, b, b.redo(), everyone)
    expect(server.state().get('frame', 'sq')).toBeUndefined()
  })

  it('swaps a layer for one with its link in its frame, and back, with undo and redo', () => {
    const { server, a, everyone } = session()
    const start = server.state().toRecords()
    const box = server.state().get('layer', 'box')
    const swap = edit(
      a,
      'swap',
      { op: 'delete', part: 'layer', id: 'box' },
      { op: 'create', part: 'layer', id: 'swapped', record: { ...box, name: 'Swapped' } },
    )
    exchange(server, a, swap, everyone)
    const swapped = server.state().toRecords()
    // Both sides hold the link once in the frame; midway, a step would hold it twice.
    exchange(server, a, a.undo(), everyone)
    expect(sameValue(server.state().toRecords(), start)).toBe(true)
    exchange(server, a, a.redo(), everyone)
    expect(sameValue(server.state().toRecords(), swapped)).toBe(true)
  })

  it('keeps a frame you created that someone has since put layers into', () => {
    const { server, a, b, everyone } = session()
    const frame = { pageId: 'p1', name: 'Mine', width: 100, height: 100, x: 2000, y: 0, order: 'a2' }
    exchange(server, a, edit(a, 'add frame', { op: 'create', part: 'frame', id: 'mine', record: frame }), everyone)
    const theirs = { type: 'graphic', parentId: 'mine', link: 'theirs', index: 'a0', name: 'Theirs', props: badgeProps }
    exchange(server, b, edit(b, 'add', { op: 'create', part: 'layer', id: 'theirs', record: theirs }), everyone)
    // Nothing of a's step can be undone without deleting b's layer: the step is skipped.
    expect(a.undo()).toEqual([])
    expect(a.canUndo()).toBe(false)
    expect([...server.state().childrenOf('mine')]).toEqual(['theirs'])
  })

  it('keeps a step whose layer has nothing to come back into waiting, and undoes it once its frame is back', () => {
    const { server, a, b, everyone } = session()
    const start = server.state().toRecords()
    exchange(server, a, edit(a, 'delete', { op: 'delete', part: 'layer', id: 'box' }), everyone)
    exchange(server, b, edit(b, 'delete frame', { op: 'delete', part: 'frame', id: 'sq' }), everyone)
    // The box's frame is gone: a's undo has nothing it can write, and its step waits.
    expect(a.undo()).toEqual([])
    expect([a.canUndo(), a.undoName()]).toEqual([false, undefined])
    // A step a opens and puts back leaves it waiting.
    a.open()
    a.write(set({ part: 'meta', id: 'meta', key: 'name' }, 'Put back'))
    a.cancel()
    expect(a.canUndo()).toBe(false)
    // So does another tab's edit that brings nothing back: asked again, the step still has nothing it can write.
    exchange(server, b, edit(b, 'rename', set({ part: 'meta', id: 'meta', key: 'name' }, 'Renamed')), everyone)
    expect(a.canUndo()).toBe(false)
    exchange(server, b, b.undo(), everyone)
    // b's undo brings the frame back as b deleted it, without the box.
    exchange(server, b, b.undo(), everyone)
    expect(server.state().get('layer', 'box')).toBeUndefined()
    expect([a.canUndo(), a.undoName()]).toEqual([true, 'delete'])
    exchange(server, a, a.undo(), everyone)
    expect(sameValue(server.state().toRecords(), start)).toBe(true)
  })

  it('splits a step it takes back only in part: the part taken goes to redo, and the rest waits', () => {
    const { server, a, b, everyone } = session()
    const start = server.state().toRecords()
    const both = edit(
      a,
      'delete',
      { op: 'delete', part: 'layer', id: 'box' },
      { op: 'delete', part: 'layer', id: 'banner-box' },
    )
    exchange(server, a, both, everyone)
    exchange(server, b, edit(b, 'delete frame', { op: 'delete', part: 'frame', id: 'sq' }), everyone)
    // The banner's box comes back; the other's frame is gone, and what is left of the step waits for it.
    exchange(server, a, a.undo(), everyone)
    expect(server.state().get('layer', 'banner-box')).toBeDefined()
    expect([a.undoName(), a.redoName()]).toEqual([undefined, 'delete'])
    exchange(server, b, b.undo(), everyone)
    expect(a.undoName()).toBe('delete')
    exchange(server, a, a.undo(), everyone)
    expect(sameValue(server.state().toRecords(), start)).toBe(true)
    exchange(server, a, a.redo(), everyone)
    exchange(server, a, a.redo(), everyone)
    expect([server.state().get('layer', 'box'), server.state().get('layer', 'banner-box')]).toEqual([
      undefined,
      undefined,
    ])
  })

  it('gives a layer it brings back a link of its own when its frame holds the link in a layer of someone else', () => {
    const { server, a, b, everyone } = session()
    const box = server.state().get('layer', 'box')
    exchange(server, a, edit(a, 'delete', { op: 'delete', part: 'layer', id: 'box' }), everyone)
    const copy = { ...box, name: 'Copy' }
    exchange(server, b, edit(b, 'copy', { op: 'create', part: 'layer', id: 'copy', record: copy }), everyone)
    exchange(server, a, a.undo(), everyone)
    expect(server.state().get('layer', 'box')).toEqual({ ...box, link: 'box-2' })
    expect(server.state().get('layer', 'copy')?.link).toBe('box')
  })

  it('brings a layer back into its frame when the group it was in is gone for good', () => {
    const { server, a, b, everyone } = session()
    const group = {
      type: 'group',
      parentId: 'sq',
      link: 'g',
      index: 'a5',
      name: 'G',
      props: { x: 0, y: 0, width: 1, height: 1 },
    }
    const wrap = edit(
      b,
      'group',
      { op: 'create', part: 'layer', id: 'g', record: group },
      set(layerKey('box', 'parentId'), 'g'),
    )
    exchange(server, b, wrap, everyone)
    expect(server.state().get('layer', 'box')?.parentId).toBe('g')
    exchange(server, a, edit(a, 'delete', { op: 'delete', part: 'layer', id: 'box' }), everyone)
    // b takes its group back: nothing will bring it back now.
    exchange(server, b, b.undo(), everyone)
    expect(server.state().get('layer', 'g')).toBeUndefined()
    exchange(server, a, a.undo(), everyone)
    expect(server.state().get('layer', 'box')?.parentId).toBe('sq')
  })

  it('keeps a step whose own batch, still on its way, writes nothing for now', () => {
    const { server, a, b, everyone } = session()
    const deleteBanner: Change = { op: 'delete', part: 'frame', id: 'banner' }
    const deletedByA = up(server, a, edit(a, 'delete frame', deleteBanner))
    down(a, deletedByA)
    // b deletes the banner too, before it hears of a's delete, and sends it later.
    const deletedByB = edit(b, 'delete frame', deleteBanner)
    const undoneByA = up(server, a, a.undo())
    down(a, undoneByA)
    // b hears of a's delete only: its own delete writes nothing on that, and b presses undo then.
    down(b, deletedByA)
    expect(b.undo()).toEqual([])
    down(b, undoneByA)
    // b's delete lands on the frame a brought back: b's undo brings it back again.
    const landed = up(server, b, deletedByB)
    down(a, landed)
    exchange(server, b, down(b, landed), everyone)
    expect(server.state().get('frame', 'banner')).toBeUndefined()
    exchange(server, b, b.undo(), everyone)
    expect(server.state().get('frame', 'banner')).toBeDefined()
  })

  it('refuses an undo whose delete would take a layer another tab put in its group after it', () => {
    const { server, a, b, everyone } = session()
    const group = {
      type: 'group',
      parentId: 'sq',
      link: 'g',
      index: 'a5',
      name: 'G',
      props: { x: 0, y: 0, width: 1, height: 1 },
    }
    const wrap = edit(
      a,
      'group',
      { op: 'create', part: 'layer', id: 'g', record: group },
      set(layerKey('box', 'parentId'), 'g'),
    )
    exchange(server, a, wrap, everyone)
    exchange(server, b, edit(b, 'delete', { op: 'delete', part: 'layer', id: 'box' }), everyone)
    // Both undo before they hear of each other: b's brings the box back into the group, then a's,
    // which deletes the group as a saw it, empty, arrives.
    const undoA = a.undo()
    const outB = up(server, b, b.undo())
    const outA = up(server, a, undoA)
    for (const c of everyone) down(c, [...outB, ...outA])
    expect(a.takeNotices()).toEqual([
      { kind: 'rejected', changeSetId: 2, changeSetKind: 'undo', reason: 'placedSince' },
    ])
    expect(server.state().get('layer', 'box')?.parentId).toBe('g')
    // Made again on the group holding the box, a's undo keeps the group: nothing of it is left to do.
    exchange(server, a, a.undo(), everyone)
    expect(server.state().get('layer', 'box')?.parentId).toBe('g')
  })

  it('brings a layer back into its frame when its undo was refused because its group went first', () => {
    const { server, a, b, everyone } = session()
    const group = {
      type: 'group',
      parentId: 'sq',
      link: 'g',
      index: 'a5',
      name: 'G',
      props: { x: 0, y: 0, width: 1, height: 1 },
    }
    const wrap = edit(
      a,
      'group',
      { op: 'create', part: 'layer', id: 'g', record: group },
      set(layerKey('box', 'parentId'), 'g'),
    )
    exchange(server, a, wrap, everyone)
    exchange(server, b, edit(b, 'delete', { op: 'delete', part: 'layer', id: 'box' }), everyone)
    // a's undo takes the group away before b's undo, made where the group was, reaches the server.
    const undoB = b.undo()
    const outA = up(server, a, a.undo())
    const outB = up(server, b, undoB)
    for (const c of everyone) down(c, [...outA, ...outB])
    exchange(server, b, b.undo(), everyone)
    expect(server.state().get('layer', 'box')?.parentId).toBe('sq')
  })

  it('puts an undo the server refuses back on the stack, to wait there', () => {
    const { server, a, b, everyone } = session()
    const start = server.state().toRecords()
    exchange(server, a, edit(a, 'delete', { op: 'delete', part: 'layer', id: 'box' }), everyone)
    const undo = a.undo()
    // b deletes the box's frame, and the server has it before a's undo, which it refuses.
    const outB = up(server, b, edit(b, 'delete frame', { op: 'delete', part: 'frame', id: 'sq' }))
    const outA = up(server, a, undo)
    for (const c of everyone) down(c, [...outB, ...outA])
    // Rejected for a structure rule, the undo still waits (D5, 4).
    expect(a.takeNotices()).toEqual([{ kind: 'rejected', changeSetId: 2, changeSetKind: 'undo', reason: 'structure' }])
    expect([a.canUndo(), a.undoName()]).toEqual([false, undefined])
    exchange(server, b, b.undo(), everyone)
    expect(a.undoName()).toBe('delete')
    exchange(server, a, a.undo(), everyone)
    expect(sameValue(server.state().toRecords(), start)).toBe(true)
  })

  it('puts an undo made again with nothing it can write back on the stack, to wait there', () => {
    const { server, a, b, everyone } = session()
    const start = server.state().toRecords()
    exchange(server, a, edit(a, 'delete', { op: 'delete', part: 'layer', id: 'box' }), everyone)
    const rename = edit(a, 'rename', set({ part: 'meta', id: 'meta', key: 'name' }, 'Renamed'))
    // Both undos wait behind the rename, which the server has not had yet; the box shows again.
    expect([...a.undo(), ...a.undo()]).toEqual([])
    expect(a.working().get('layer', 'box')).toBeDefined()
    // b deletes the box's frame before the rename arrives: made again then, the undo of the delete has nothing it can write.
    exchange(server, b, edit(b, 'delete frame', { op: 'delete', part: 'frame', id: 'sq' }), everyone)
    exchange(server, a, rename, everyone)
    expect(server.state().get('layer', 'box')).toBeUndefined()
    expect([a.canUndo(), a.undoName()]).toEqual([false, undefined])
    exchange(server, b, b.undo(), everyone)
    expect(a.undoName()).toBe('delete')
    exchange(server, a, a.undo(), everyone)
    expect(sameValue(server.state().toRecords(), start)).toBe(true)
  })

  it('takes a refused edit out of the history with a reason', () => {
    const { server, a, b } = session()
    const deleteFrame = edit(b, 'delete', { op: 'delete', part: 'frame', id: 'sq' })
    const rename = edit(a, 'rename', set(layerKey('box', 'name'), 'Too late'))
    expect(a.canUndo()).toBe(true)
    const outB = up(server, b, deleteFrame)
    const outA = up(server, a, rename)
    down(a, [...outB, ...outA])
    expect(a.canUndo()).toBe(false)
    expect(a.takeNotices()).toEqual([
      { kind: 'rejected', changeSetId: 1, changeSetKind: 'edit', reason: 'cannotApply' },
    ])
    expect(a.takeNotices()).toEqual([])
    expect(sameValue(a.working().toRecords(), server.state().toRecords())).toBe(true)
  })

  it('drops an undo waiting behind an edit the server refuses', () => {
    const { server, a, b } = session()
    const outB = up(server, b, edit(b, 'delete', { op: 'delete', part: 'layer', id: 'box' }))
    down(b, outB)
    // a renames the box (refused: b deleted it) and the banner's box, and undoes before hearing back.
    const rename = edit(a, 'rename', set(layerKey('box', 'name'), 'Gone'), set(layerKey('banner-box', 'name'), 'Kept?'))
    // The undo shows at once and waits behind the edit.
    expect(a.undo()).toEqual([])
    expect(a.working().get('layer', 'banner-box')?.name).toBe('Box')
    const outA = up(server, a, rename)
    expect(outA[0]).toEqual({ to: a.tabId(), message: { type: 'reject', changeSetId: 1, reason: 'cannotApply' } })
    expect(down(a, [...outB, ...outA])).toEqual([])
    expect(server.state().get('layer', 'banner-box')?.name).toBe('Box')
    expect(a.working().get('layer', 'banner-box')?.name).toBe('Box')
    expect([a.canUndo(), a.canRedo(), a.queued()]).toEqual([false, false, 0])
  })

  it('makes an undo again from the confirmed state after a new edit cleared its step from redo', () => {
    const { server, a, b, everyone } = session()
    const frame = { pageId: 'p1', name: 'Mine', width: 100, height: 100, x: 2000, y: 0, order: 'a2' }
    exchange(server, a, edit(a, 'add frame', { op: 'create', part: 'frame', id: 'mine', record: frame }), everyone)
    exchange(server, a, edit(a, 'move', set(layerKey('box', 'parentId'), 'mine')), everyone)
    const outB = up(server, b, edit(b, 'delete', { op: 'delete', part: 'frame', id: 'sq' }))
    down(b, outB)
    // a undoes the move (refused: the square it goes back to is gone), then the frame, which shows
    // empty, then edits: the edit clears both steps from redo while their undos wait.
    const undoMove = a.undo()
    expect(a.undo()).toEqual([])
    expect(a.working().get('frame', 'mine')).toBeUndefined()
    expect(edit(a, 'rename', set({ part: 'page', id: 'p1', key: 'name' }, 'Next'))).toEqual([])
    exchange(server, a, down(a, [...outB, ...up(server, a, undoMove)]), everyone)
    // Made again, the undo of the frame finds the box in it, which isn't a's: nothing is left to undo.
    expect(server.state().get('layer', 'box')?.parentId).toBe('mine')
    expect(server.state().get('page', 'p1')?.name).toBe('Next')
  })

  it('leaves a layer moved out of a page it deleted, when it redoes after a snapshot catch-up', () => {
    const server = testServer(linkedDesign(), { limits: { logChangeSets: 1 } })
    const [a, b] = [joinClient(server), joinClient(server)]
    const removePage = edit(a, 'delete page', { op: 'delete', part: 'page', id: 'p2' })
    // b takes far-bg out of the page before a's delete is ordered; a never hears either.
    const outB = up(server, b, edit(b, 'move', set(layerKey('far-bg', 'parentId'), 'other')))
    a.disconnect()
    down(b, [...outB, ...up(server, a, removePage)])
    for (const n of [1, 2]) exchange(server, b, edit(b, 'rename', set(layerKey('bg', 'name'), `bg ${n}`)), [b])
    expect(comeBack(server, a)).toEqual([])
    exchange(server, a, a.undo(), [a, b])
    expect(server.state().get('frame', 'far')).toBeDefined()
    exchange(server, a, a.redo(), [a, b])
    expect(server.state().get('page', 'p2')).toBeUndefined()
    expect(server.state().get('layer', 'far-bg')?.parentId).toBe('other')
  })

  it('brings back what its accepted delete took on the server, when a step before it was rejected and it catches up with the whole design', () => {
    const server = testServer(linkedDesign(), { limits: { logChangeSets: 1 } })
    const [a, b] = [joinClient(server), joinClient(server)]
    // a deletes far-bg (and renames other-x, which b deletes first: the server rejects that step),
    // then the page far-bg is on, and hears nothing back. On the server the page takes far-bg with it.
    const removeLayer = edit(
      a,
      'delete',
      { op: 'delete', part: 'layer', id: 'far-bg' },
      set(layerKey('other-x', 'name'), 'Mine'),
    )
    const removePage = edit(a, 'delete page', { op: 'delete', part: 'page', id: 'p2' })
    a.disconnect()
    exchange(server, b, edit(b, 'delete', { op: 'delete', part: 'layer', id: 'other-x' }), [b])
    down(b, up(server, a, [...removeLayer, ...removePage]))
    for (const n of [1, 2]) exchange(server, b, edit(b, 'rename', set(layerKey('bg', 'name'), `bg ${n}`)), [b])
    expect(server.state().get('layer', 'far-bg')).toBeUndefined()
    exchange(server, a, comeBack(server, a), [a, b])
    expect(a.undoName()).toBe('delete page')
    exchange(server, a, a.undo(), [a, b])
    expect(server.state().get('layer', 'far-bg')?.parentId).toBe('far')
  })
})

describe('What is left of a step taken in part', () => {
  it('leaves alone what others write after it, though the step it came from had a batch on its way', () => {
    const name = (id: string, value: string): Change => set(layerKey(id, 'name'), value)
    const pre = DesignState.fromRecords(testDesign() as unknown as DesignRecords)
    const post = pre.overlay()
    const mine = [name('box', 'Mine'), name('headline', 'Mine')]
    for (const change of mine) post.apply(change, 'strict')
    // The step's own batch is on its way: it is not settled yet.
    const step = Step.of('rename', pre, post, mine)
    const view = post.overlay()
    view.apply({ op: 'delete', part: 'layer', id: 'headline' }, 'strict')
    const undo = step.toward(BACK, view)
    expect(undo).toEqual([name('box', 'Box')])
    const after = view.overlay()
    for (const change of undo) after.apply(change, 'strict')
    const rest = step.split(BACK, after) as Step
    // Someone brings the headline back with a name of their own: the rest leaves it.
    const theirs: Change = {
      op: 'create',
      part: 'layer',
      id: 'headline',
      record: { ...pre.get('layer', 'headline'), name: 'Theirs' },
    }
    rest.othersWrote(Touches.of([theirs]))
    after.apply(theirs, 'strict')
    expect(rest.toward(BACK, after)).toEqual([])
  })
})

describe('A waiting step', () => {
  const deleteBox: Change = { op: 'delete', part: 'layer', id: 'box' }
  const deleteSquare: Change = { op: 'delete', part: 'frame', id: 'sq' }

  it('comes back from a reload with the undo that needs it, and waits again', () => {
    const { server, a, b, everyone } = session()
    const start = server.state().toRecords()
    exchange(server, a, edit(a, 'delete', deleteBox), everyone)
    const rename = edit(a, 'rename', set({ part: 'meta', id: 'meta', key: 'name' }, 'Renamed'))
    expect([...a.undo(), ...a.undo()]).toEqual([])
    // a reloads with both undos waiting behind the rename it sent; b deletes the box's frame meanwhile.
    const reloaded = openClient(wire(a.save()))
    exchange(server, b, edit(b, 'delete frame', deleteSquare), [b])
    down(b, up(server, a, rename))
    exchange(server, reloaded, comeBack(server, reloaded), [reloaded, b])
    expect([reloaded.canUndo(), reloaded.undoName()]).toEqual([false, undefined])
    exchange(server, b, b.undo(), [reloaded, b])
    expect(reloaded.undoName()).toBe('delete')
    exchange(server, reloaded, reloaded.undo(), [reloaded, b])
    expect(sameValue(server.state().toRecords(), start)).toBe(true)
  })

  it('is tried again after a catch-up with the whole design', () => {
    const server = testServer(undefined, { limits: { logChangeSets: 1 } })
    const [a, b] = [joinClient(server), joinClient(server)]
    exchange(server, a, edit(a, 'delete', deleteBox), [a, b])
    exchange(server, b, edit(b, 'delete frame', deleteSquare), [a, b])
    expect(a.undo()).toEqual([])
    a.disconnect()
    exchange(server, b, b.undo(), [b])
    exchange(server, b, edit(b, 'rename', set({ part: 'meta', id: 'meta', key: 'name' }, 'Renamed')), [b])
    exchange(server, a, comeBack(server, a), [a, b])
    expect(a.canUndo()).toBe(true)
    exchange(server, a, a.undo(), [a, b])
    expect(server.state().get('layer', 'box')?.parentId).toBe('sq')
  })

  it('keeps an undo the server refused before it restarted, what others wrote meanwhile theirs', () => {
    let server = testServer()
    const [a, b] = [joinClient(server), joinClient(server)]
    const start = server.state().toRecords()
    exchange(server, a, edit(a, 'delete', deleteBox), [a, b])
    const undo = a.undo()
    // b's delete of the box's frame is stored first; a's undo is refused, stored, and the server
    // stops before a hears.
    down(b, up(server, b, edit(b, 'delete frame', deleteSquare)))
    up(server, a, undo)
    const saved = server.save()
    server = openServer({ saved, journal: [], lastEntry: saved.entry }, testServerOptions())
    exchange(server, a, comeBack(server, a), [a])
    exchange(server, b, comeBack(server, b), [a, b])
    expect([a.canUndo(), a.undoName()]).toEqual([false, undefined])
    exchange(server, b, b.undo(), [a, b])
    expect(a.undoName()).toBe('delete')
    exchange(server, a, a.undo(), [a, b])
    expect(sameValue(server.state().toRecords(), start)).toBe(true)
  })
})
