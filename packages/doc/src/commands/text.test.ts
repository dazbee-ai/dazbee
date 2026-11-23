import { describe, expect, it } from 'vitest'

import { fittedText, type MeasureText } from '../fitted-text.ts'
import { readDesign } from '../index.ts'
import type { PlainStore } from '../plain-store.ts'
import type { Session } from '../session.ts'
import { openTestSession } from '../test-design.ts'
import { testMeasure } from '../test-measure.ts'
import { openTestStore } from '../test-store.ts'

/** A curved text measured as a box that grows with its amount; a straight one with the test measure. */
const curveMeasure: MeasureText = (props, width) =>
  props.curve
    ? { width: 400 + 4 * props.curve.amount, height: 150 + 3 * props.curve.amount }
    : testMeasure(props, width)

/** The headline's props as stored. */
const headline = (store: PlainStore) => readDesign(store).nodes.headline?.props as Record<string, unknown>

/** The headline changed by `patch`, then fitted as the editor fits it, keeping `keep`. */
function updateAndFit(tab: Session, store: PlainStore, patch: Record<string, unknown>, keep?: 'centre') {
  tab.run('node.update', { ids: ['headline'], patch })
  const size = fittedText(readDesign(store).nodes.headline, curveMeasure)
  if (size) tab.run('text.fit', { id: 'headline', ...size, ...(keep ? { keep } : {}) })
}

/** The middle of the headline's box. */
function centreOf(store: PlainStore): [number, number] {
  const { x, y, width, height } = headline(store) as Record<string, number>
  return [(x ?? 0) + (width ?? 0) / 2, (y ?? 0) + (height ?? 0) / 2]
}

describe('text.edit', () => {
  it('inserts, deletes and styles ranges of a text layer; its linked copy keeps its own text', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const copy = readDesign(store).nodes['banner-headline']

    tab.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 11, text: '!' } })
    tab.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 0, length: 7 } })
    tab.run('text.edit', { id: 'headline', op: { kind: 'style', at: 0, length: 4, style: { color: '#FF0000FF' } } })

    const text = readDesign(store).nodes.headline
    if (text?.type !== 'text') throw new Error('not text')
    expect(text.props.text).toBe('sale!')
    // Typed text takes the style of the character before it, as in any editor.
    expect(text.props.runs).toEqual([
      { start: 0, end: 4, style: { fontWeight: 800, color: '#FF0000FF' } },
      { start: 4, end: 5, style: { fontWeight: 800 } },
    ])
    expect(readDesign(store).nodes['banner-headline']).toEqual(copy)

    expect(() => tab.run('text.edit', { id: 'box', op: { kind: 'delete', at: 0, length: 1 } })).toThrow(
      /"box" is a graphic, not a text layer/,
    )
    expect(() => tab.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 3, length: 9 } })).toThrow(
      /runs past the end/,
    )
  })

  it('checks each edit in a batch against the text as the batch has written it so far (C38)', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    expect(() =>
      tab.gesture(() => {
        tab.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 0, length: 7 } })
        tab.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 10, text: '!' } })
      }),
    ).toThrow(/runs past the end of the text \(4\)/)
    expect(readDesign(store).nodes.headline?.props).toMatchObject({ text: 'Summer sale' })
  })

  it('refuses an offset inside a character written as two UTF-16 units, such as an emoji (C38)', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 6, text: '\u{1F600}' } })
    const inside = /the offset 7 falls inside a character/
    expect(() => tab.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 7, text: 'x' } })).toThrow(inside)
    expect(() => tab.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 7, length: 2 } })).toThrow(inside)
    expect(() => tab.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 5, length: 2 } })).toThrow(inside)
    expect(() =>
      tab.run('text.edit', { id: 'headline', op: { kind: 'style', at: 0, length: 7, style: { fontWeight: 400 } } }),
    ).toThrow(inside)
    tab.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 6, length: 2 } })
    expect(readDesign(store).nodes.headline?.props).toMatchObject({ text: 'Summer sale' })
  })

  it('edits a linked copy on its own, and each edit is one undo step', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('text.edit', { id: 'banner-headline', op: { kind: 'insert', at: 4, text: '!' } })
    expect(readDesign(store).nodes['banner-headline']?.props).toMatchObject({ text: 'Sale!' })
    expect(readDesign(store).nodes.headline?.props).toMatchObject({ text: 'Summer sale' })
    tab.undo()
    expect(readDesign(store).nodes['banner-headline']?.props).toMatchObject({ text: 'Sale' })
  })
})

describe('text.fit', () => {
  it('sizes a text box, rounded, in one undo step; its linked copy stays as it was', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const copy = readDesign(store).nodes['banner-headline']
    tab.run('text.fit', { id: 'headline', width: 300.004, height: 90.456 })
    expect(readDesign(store).nodes.headline?.props).toMatchObject({ width: 300, height: 90.46 })
    expect(readDesign(store).nodes['banner-headline']).toEqual(copy)
    tab.undo()
    expect(readDesign(store).nodes.headline?.props).toMatchObject({ width: 960, height: 100 })
    expect(() => tab.run('text.fit', { id: 'box', width: 1, height: 1 })).toThrow(
      /"box" is a graphic, not a text layer/,
    )
    expect(() => tab.run('text.fit', { id: 'headline', width: -1, height: 1 })).toThrow(/width/)
  })

  it('keeps the box’s centre with keep centre, as a curve changed in the edit panel does, and its top left without', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.update', { ids: ['headline'], patch: { align: 'center' } })
    const [cx, cy] = centreOf(store)
    for (const curve of [
      { shape: 'arcUp', amount: 30 },
      { shape: 'arcUp', amount: 80 },
      { shape: 'circle', amount: 80 },
      null,
    ]) {
      updateAndFit(tab, store, { curve }, 'centre')
      const [x, y] = centreOf(store)
      expect(Math.abs(x - cx)).toBeLessThan(1)
      expect(Math.abs(y - cy)).toBeLessThan(1)
    }
    const { x, y } = headline(store)
    updateAndFit(tab, store, { curve: { shape: 'wave', amount: 20 } })
    expect(headline(store)).toMatchObject({ x, y, width: 480, height: 210 })
  })

  it('gives a fixed or auto height box the size it had straight back when its curve is taken off, scaled with its text', () => {
    for (const boxMode of ['fixed', 'autoHeight'] as const) {
      const store = openTestStore()
      const tab = openTestSession(store)
      tab.run('node.update', { ids: ['headline'], patch: { boxMode, width: 509, height: 130 } })
      updateAndFit(tab, store, { curve: { shape: 'circle', amount: 50 } })
      expect(headline(store)).toMatchObject({ width: 600, height: 300 })
      updateAndFit(tab, store, { curve: { shape: 'arcUp', amount: 20 } })
      updateAndFit(tab, store, { curve: null })
      const straight = headline(store)
      expect(straight).toMatchObject({ width: 509, height: boxMode === 'fixed' ? 130 : 100.8 })
      expect(straight).not.toHaveProperty('straightBox')

      // A corner drag scales the curved text's sizes, and the straight box with them.
      updateAndFit(tab, store, { curve: { shape: 'circle', amount: 50 } })
      tab.run('node.update', { ids: ['headline'], patch: { style: { ...(straight.style as object), fontSize: 168 } } })
      updateAndFit(tab, store, { curve: null })
      expect(headline(store)).toMatchObject({ width: 1018, ...(boxMode === 'fixed' ? { height: 260 } : {}) })
    }
  })

  it('keeps a size set as the curve comes off, or after, in place of the straight box', () => {
    for (const patches of [[{ curve: null, width: 700 }], [{ curve: null }, { width: 700 }]]) {
      const store = openTestStore()
      const tab = openTestSession(store)
      tab.run('node.update', { ids: ['headline'], patch: { boxMode: 'fixed', width: 509, height: 130 } })
      updateAndFit(tab, store, { curve: { shape: 'circle', amount: 50 } })
      tab.gesture(() => {
        for (const patch of patches) tab.run('node.update', { ids: ['headline'], patch })
        const size = fittedText(readDesign(store).nodes.headline, curveMeasure)
        if (size) tab.run('text.fit', { id: 'headline', ...size })
      })
      expect(headline(store)).toMatchObject({ width: 700 })
      expect(headline(store)).not.toHaveProperty('straightBox')
    }
  })

  it('writes nothing when the box already fits', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('text.fit', { id: 'headline', width: 960, height: 100.001 })
    expect(tab.canUndo()).toBe(false)
  })
})

describe('text.replace', () => {
  it('replaces every match in each text given, whatever its case, as one step that undoes whole', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const before = readDesign(store)
    tab.run('text.replace', { ids: ['headline', 'banner-headline'], find: 'SALE', replace: 'deals' })
    const text = (id: string) => {
      const node = readDesign(store).nodes[id]
      return node?.type === 'text' ? node.props : null
    }
    expect(text('headline')).toMatchObject({
      text: 'Summer deals',
      runs: [{ start: 7, end: 12, style: { fontWeight: 800 } }],
    })
    expect(text('banner-headline')).toMatchObject({ text: 'deals', runs: [] })
    expect(tab.undoName()).toBe('editText')
    tab.undo()
    expect(readDesign(store).nodes).toEqual(before.nodes)
    // A text named twice is replaced in once.
    tab.run('text.replace', { ids: ['headline', 'headline'], find: 'sale', replace: 'sale sale' })
    expect(text('headline')?.text).toBe('Summer sale sale')
  })

  it('refuses a missing layer, a layer that is not a text, a text locked against content changes, and half an emoji', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const half = String.fromCharCode(0xd83d)
    expect(() => tab.run('text.replace', { ids: ['gone'], find: 'a', replace: 'b' })).toThrow(/no layer "gone"/)
    expect(() => tab.run('text.replace', { ids: ['box'], find: 'a', replace: 'b' })).toThrow(/not a text layer/)
    expect(() => tab.run('text.replace', { ids: ['headline'], find: '', replace: 'b' })).toThrow()
    expect(() => tab.run('text.replace', { ids: ['headline'], find: 'a', replace: half })).toThrow(
      /half of a character/,
    )
    tab.run('node.lock', { ids: ['headline'], lock: { content: true } })
    expect(() => tab.run('text.replace', { ids: ['headline'], find: 'sale', replace: 'b' })).toThrow(
      /"headline" is locked \(content\)/,
    )
  })
})
