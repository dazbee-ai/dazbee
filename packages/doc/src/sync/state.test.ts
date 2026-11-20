import { describe, expect, it } from 'vitest'

import { type Change, parseDesign, type Target } from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { linkedDesign, testDesign } from '../test-design.ts'
import { ChangeRejected, DesignState } from './state.ts'

const state = (design = testDesign()) => DesignState.fromRecords(design)
const nameOf = (id: string): Target => ({ part: 'layer', id, key: 'name' })
const textOf = (id: string): Target => ({ part: 'layer', id, key: 'props', prop: 'text' })
const bindingOf = (id: string, prop: string): Target => ({ part: 'layer', id, key: 'bindings', prop })

describe('DesignState', () => {
  it('gives back the records it holds', () => {
    const records = state(linkedDesign()).toRecords()
    expect(sameValue(records, linkedDesign())).toBe(true)
    expect(parseDesign(records).success).toBe(true)
  })

  it('reads a text and its runs as one value and writes them together', () => {
    const s = state()
    expect(s.valueOf(textOf('headline'))).toEqual({
      text: 'Summer sale',
      runs: [{ start: 7, end: 11, style: { fontWeight: 800 } }],
    })
    s.apply({ op: 'set', value: textOf('headline'), to: { text: 'Hi' } }, 'strict')
    const props = s.get('layer', 'headline')?.props as Record<string, unknown>
    expect(props.text).toBe('Hi')
    expect(Object.hasOwn(props, 'runs')).toBe(false)
  })

  describe('bindings', () => {
    const set = (prop: string, to?: string): Change => ({
      op: 'set',
      value: bindingOf('headline', prop),
      ...(to === undefined ? {} : { to }),
    })

    it('sets and takes out one binding, making the bindings with the first and taking them out with the last', () => {
      const s = state()
      s.apply(set('textColor', 'brand:ink'), 'strict')
      expect(s.get('layer', 'headline')?.bindings).toEqual({ textColor: 'brand:ink' })
      expect(s.valueOf(bindingOf('headline', 'textColor'))).toBe('brand:ink')
      s.apply(set('textColor'), 'strict')
      expect(Object.hasOwn(s.get('layer', 'headline') as object, 'bindings')).toBe(false)
      expect(s.valueOf(bindingOf('headline', 'textColor'))).toBeUndefined()
    })

    it('leaves the layer’s other bindings as they are when it sets one', () => {
      const s = state()
      s.apply(set('fontFamily', 'brand:heading'), 'strict')
      s.apply(set('textColor', 'brand:ink'), 'strict')
      s.apply(set('fontFamily', 'brand:body'), 'strict')
      expect(s.get('layer', 'headline')?.bindings).toEqual({ fontFamily: 'brand:body', textColor: 'brand:ink' })
      s.apply(set('fontFamily'), 'strict')
      expect(s.get('layer', 'headline')?.bindings).toEqual({ textColor: 'brand:ink' })
    })

    it('still takes a layer’s bindings set whole', () => {
      const s = state()
      const whole = { fontFamily: 'brand:heading', textColor: 'brand:ink' }
      s.apply({ op: 'set', value: { part: 'layer', id: 'headline', key: 'bindings' }, to: whole }, 'strict')
      expect(s.get('layer', 'headline')?.bindings).toEqual(whole)
      s.apply(set('textColor'), 'strict')
      expect(s.get('layer', 'headline')?.bindings).toEqual({ fontFamily: 'brand:heading' })
      s.apply({ op: 'set', value: { part: 'layer', id: 'headline', key: 'bindings' } }, 'strict')
      expect(Object.hasOwn(s.get('layer', 'headline') as object, 'bindings')).toBe(false)
    })

    it('refuses a binding with a name that is no bindable property', () => {
      const s = state()
      for (const prop of ['stroke', 'constructor']) {
        expect(() => s.apply(set(prop, 'brand:ink'), 'strict')).toThrow(ChangeRejected)
        expect(s.apply(set(prop, 'brand:ink'), 'lenient')).toEqual([])
      }
    })

    it('copies the bindings once in an owning overlay, and leaves the base’s as they were', () => {
      const base = state()
      base.apply(set('fontFamily', 'brand:heading'), 'strict')
      const before = base.get('layer', 'headline')?.bindings
      const owning = base.overlay(true)
      owning.apply(set('textColor', 'brand:ink'), 'strict')
      const copy = owning.get('layer', 'headline')?.bindings
      owning.apply(set('fontFamily', 'brand:body'), 'strict')
      expect(owning.get('layer', 'headline')?.bindings).toBe(copy)
      expect(copy).toEqual({ fontFamily: 'brand:body', textColor: 'brand:ink' })
      expect(base.get('layer', 'headline')?.bindings).toBe(before)
      expect(before).toEqual({ fontFamily: 'brand:heading' })
    })
  })

  it('rejects a key a record has no place for, and a change to a record that is gone', () => {
    const s = state()
    const bad: Change[] = [
      { op: 'set', value: { part: 'layer', id: 'box', key: 'props' }, to: {} },
      { op: 'set', value: { part: 'layer', id: 'headline', key: 'props', prop: 'runs' }, to: [] },
      { op: 'set', value: { part: 'layer', id: 'box', key: '__proto__' }, to: {} },
      { op: 'set', value: nameOf('nothing'), to: 'x' },
      { op: 'create', part: 'layer', id: 'sq', record: {} },
    ]
    for (const change of bad) {
      expect(() => s.apply(change, 'strict')).toThrow(ChangeRejected)
      expect(s.apply(change, 'lenient')).toEqual([])
    }
  })

  it('deletes a page with its frames and their layers, and deleting what is gone does nothing', () => {
    const s = state(linkedDesign())
    const written = s.apply({ op: 'delete', part: 'page', id: 'p1' }, 'strict')
    expect(written).toHaveLength(1 + 5 + 13)
    expect(s.ids('frame')).toEqual(['far'])
    expect(s.ids('layer')).toEqual(['far-bg'])
    expect(s.count('layer')).toBe(1)
    expect(s.apply({ op: 'delete', part: 'page', id: 'p1' }, 'strict')).toEqual([])
  })

  it('keeps what each holder holds and who holds each link as layers move', () => {
    const s = state(linkedDesign())
    s.apply({ op: 'set', value: { part: 'layer', id: 'badge', key: 'parentId' }, to: 'grp' }, 'strict')
    expect([...s.childrenOf('grp')]).toEqual(['title', 'price', 'badge'])
    expect(s.childrenOf('sq').has('badge')).toBe(false)
    s.apply({ op: 'set', value: { part: 'layer', id: 'badge', key: 'link' }, to: 'bg' }, 'strict')
    expect([...s.linkHolders('bg')]).toContain('badge')
    expect(s.linkHolders('badge').size).toBe(0)
  })

  describe('overlay', () => {
    it('reads through to its base and writes into it only on commit', () => {
      const base = state()
      const over = base.overlay()
      over.apply({ op: 'set', value: nameOf('box'), to: 'Over' }, 'strict')
      over.apply({ op: 'delete', part: 'frame', id: 'banner' }, 'strict')
      expect(over.get('layer', 'box')?.name).toBe('Over')
      expect(over.get('layer', 'banner-box')).toBeUndefined()
      expect(over.ids('layer').sort()).toEqual(['box', 'headline'])
      expect(base.get('layer', 'box')?.name).toBe('Box')
      expect(base.get('layer', 'banner-box')).toBeDefined()
      expect(over.ownKeys().sort()).toEqual(['frame/banner', 'layer/banner-box', 'layer/banner-headline', 'layer/box'])
      over.commit()
      expect(base.get('layer', 'box')?.name).toBe('Over')
      expect(base.ids('layer').sort()).toEqual(['box', 'headline'])
      expect(base.count('frame')).toBe(1)
      expect(base.childrenOf('banner').size).toBe(0)
    })
  })

  it('copies a record once per change set in an owning overlay, keeping what holds it and its link right', () => {
    const base = state(linkedDesign())
    const before = base.get('layer', 'badge')
    const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })
    const x = { part: 'layer', id: 'badge', key: 'props', prop: 'x' } as const
    const writes = [
      set(x, 1),
      set(nameOf('badge'), 'B'),
      set(x, 2),
      set({ part: 'layer', id: 'badge', key: 'parentId' }, 'grp'),
    ]
    const owning = base.overlay(true)
    const copies = new Set(writes.map((change) => (owning.apply(change, 'strict'), owning.get('layer', 'badge'))))
    expect(copies.size).toBe(1)
    expect([owning.childrenOf('grp').has('badge'), owning.childrenOf('sq').has('badge')]).toEqual([true, false])
    // A plain overlay (a tab's view, whose records its listeners keep) copies at every write.
    const plain = base.overlay()
    expect(new Set(writes.map((change) => (plain.apply(change, 'strict'), plain.get('layer', 'badge')))).size).toBe(4)
    expect(sameValue(owning.toRecords(), plain.toRecords())).toBe(true)
    // The base keeps its record as it was until the overlay commits, props included when a key's
    // set copied the record first.
    expect(base.get('layer', 'badge')).toBe(before)
    const bg = JSON.stringify(base.get('layer', 'bg'))
    owning.apply(set(nameOf('bg'), 'Background'), 'strict')
    owning.apply(set({ part: 'layer', id: 'bg', key: 'props', prop: 'x' }, 7), 'strict')
    expect([JSON.stringify(base.get('layer', 'bg')), (owning.get('layer', 'bg')?.props as { x: number }).x]).toEqual([
      bg,
      7,
    ])
    owning.commit()
    expect([base.get('layer', 'badge')?.name, base.childrenOf('grp').has('badge')]).toEqual(['B', true])
    // Once committed, its copies are the base's: a later set copies them again.
    const committed = base.get('layer', 'badge')
    owning.apply(set(nameOf('badge'), 'C'), 'strict')
    expect([committed?.name, owning.get('layer', 'badge')?.name]).toEqual(['B', 'C'])
  })

  describe('placements', () => {
    it('places what a change set created or moved to another holder, and drops what it deleted (C46)', () => {
      const base = state(linkedDesign())
      const first = base.overlay(true)
      first.apply({ op: 'set', value: { part: 'layer', id: 'badge', key: 'parentId' }, to: 'grp' }, 'strict')
      first.apply({ op: 'set', value: nameOf('bg'), to: 'Background' }, 'strict')
      first.apply({ op: 'set', value: { part: 'layer', id: 'title', key: 'index' }, to: 'a9' }, 'strict')
      first.commit({ seq: 1, author: 7 })
      expect(base.placements()).toEqual({ badge: { seq: 1, author: 7 } })
      const second = base.overlay(true)
      second.apply({ op: 'delete', part: 'layer', id: 'grp' }, 'strict')
      // A record deleted and made again, under the same holder, is placed by the change set that made it.
      second.apply({ op: 'delete', part: 'layer', id: 'bg' }, 'strict')
      const bg = linkedDesign().nodes.bg as unknown as Record<string, unknown>
      second.apply({ op: 'create', part: 'layer', id: 'bg', record: bg }, 'strict')
      expect(second.placedAt('badge')).toEqual({ seq: 1, author: 7 })
      second.commit({ seq: 2, author: 8 })
      expect(base.placements()).toEqual({ bg: { seq: 2, author: 8 } })
      expect(base.placedAt('badge')).toBeUndefined()
    })

    it('places a record made with the id of one deleted in the same change set, whatever their parts', () => {
      const base = state(linkedDesign())
      const over = base.overlay(true)
      over.apply({ op: 'delete', part: 'layer', id: 'badge' }, 'strict')
      const frame = { pageId: 'p1', name: 'Badge', width: 10, height: 10, x: 0, y: 0, order: 'a9' }
      over.apply({ op: 'create', part: 'frame', id: 'badge', record: frame }, 'strict')
      over.commit({ seq: 3, author: 1 })
      expect(base.placedAt('badge')).toEqual({ seq: 3, author: 1 })
    })

    it('opens with the placements saved with the records, and an overlay committed without a change set places nothing', () => {
      const base = DesignState.fromRecords(linkedDesign(), { badge: { seq: 4, author: 2 } })
      expect(base.placedAt('badge')).toEqual({ seq: 4, author: 2 })
      const over = base.overlay()
      over.apply({ op: 'set', value: { part: 'layer', id: 'bg', key: 'parentId' }, to: 'grp' }, 'strict')
      over.commit()
      expect(base.placements()).toEqual({ badge: { seq: 4, author: 2 } })
    })
  })
})
