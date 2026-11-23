import { describe, expect, it } from 'vitest'

import type { Change, Design, DesignInput, DesignRecords } from '@dazbee/schema'

import { ancestorsOf } from './children.ts'
import { boxPlan } from './commands/box-plan.ts'
import { planHug } from './commands/groups.ts'
import { derivedValues, type FitText } from './derived-values.ts'
import { fittedText } from './fitted-text.ts'
import { repair } from './repair.ts'
import { type RecordKey, recordKey } from './sync/changes.ts'
import { touchedBy } from './sync/follow-up.ts'
import { DesignState, type ReadState } from './sync/state.ts'
import { kindsDesign, linkedDesign, testDesign } from './test-design.ts'
import { testMeasure } from './test-measure.ts'
import { seeded } from './test-walk.ts'

const fit: FitText = (layer) => fittedText(layer, testMeasure)
const derived = derivedValues(fit)
const layers = (...ids: string[]): Set<RecordKey> => new Set(ids.map((id) => recordKey('layer', id)))
const boxOf = (state: ReadState, id: string) => {
  const { x, y, width, height } = state.get('layer', id)?.props as Record<string, number>
  return { x, y, width, height }
}

type Nodes = Record<string, { parentId: string; props: Record<string, unknown> }>

/** The linked design as the sync core holds it, with `edit` made to its layers. */
function stateOf(edit: (nodes: Nodes) => void = () => {}) {
  const design = linkedDesign() as unknown as DesignRecords
  edit(design.nodes as unknown as Nodes)
  return DesignState.fromRecords(design)
}

/** `state` with the changes `recompute` works out over `touched` on it. */
function after(state: DesignState, touched: ReadonlySet<RecordKey>, recompute = derived) {
  const next = state.overlay()
  const changes = recompute(state, touched)
  if (changes === 'wait') throw new Error('the recompute waits')
  for (const change of changes) next.apply(change, 'strict')
  return next
}

/** Changes in one order, to compare. */
const sorted = (changes: Change[]) => changes.map((change) => JSON.stringify(change)).sort()

/** `state` read through, throwing when anything reads a layer not in `readable`. */
function readingOnly(state: ReadState, readable: ReadonlySet<string>): ReadState {
  const check = (id: string) => {
    if (state.partOf(id) === 'layer' && !readable.has(id)) throw new Error(`read "${id}"`)
  }
  return {
    get: (part, id) => (check(id), state.get(part, id)),
    getKey: (key) => state.getKey(key),
    partOf: (id) => state.partOf(id),
    childrenOf: (holder) => (check(holder), state.childrenOf(holder)),
    linkHolders: () => {
      throw new Error('read the links')
    },
    ids: () => {
      throw new Error('read every id')
    },
    count: (part) => state.count(part),
    valueOf: (target) => (check(target.id), state.valueOf(target)),
    subtree: (id) => (check(id), state.subtree(id)),
    toRecords: () => {
      throw new Error('read the whole design')
    },
  }
}

/**
 * The derived values as the prototype worked them out, over the whole design as the read gives it:
 * what the recompute on the chains must equal.
 */
function overTheWholeDesign(state: ReadState, touched: ReadonlySet<RecordKey>): Change[] {
  const { design } = repair(state.toRecords())
  const ids = [...touched].map((key) => key.slice('layer/'.length)).filter((id) => design.nodes[id])
  const far = (box: Readonly<Record<string, unknown>>) =>
    (['x', 'y', 'width', 'height'] as const).some((key) => !(Math.abs(Number(box[key] ?? 0)) <= 2 ** 53 / 100))
  const leave = new Set(
    Object.entries(design.nodes).flatMap(([id, layer]) => (far(layer.props) ? ancestorsOf(design, id) : [])),
  )
  const plan = boxPlan(design)
  for (const id of ids) {
    const size = leave.has(id) ? undefined : fittedText(design.nodes[id], testMeasure)
    if (size && !far(size)) plan.set(id, size)
  }
  planHug(design as Design, plan, ids, leave)
  const changes: Change[] = []
  plan.write({
    setProp: (id, prop, to) => void changes.push({ op: 'set', value: { part: 'layer', id, key: 'props', prop }, to }),
  })
  return changes
}

describe('derived values', () => {
  it('fit each text touched to its words, then the group holding it to what it holds', () => {
    const state = stateOf()
    // Each title and price is one line of 60 px type: 72 px tall in its box's width.
    const next = after(state, layers('title', 'price'))
    expect(boxOf(next, 'title')).toEqual({ x: 100, y: 100, width: 600, height: 72 })
    expect(boxOf(next, 'price')).toEqual({ x: 100, y: 300, width: 200, height: 72 })
    expect(boxOf(next, 'grp')).toEqual({ x: 100, y: 100, width: 600, height: 272 })
    // Worked out again, they are current: nothing changes.
    expect(derived(next, layers('title', 'price', 'grp'))).toEqual([])
  })

  it('leave texts and groups nothing touched, and a text of a fixed box, as they are', () => {
    const state = stateOf((nodes) => {
      Object.assign(nodes.title?.props ?? {}, { boxMode: 'fixed' })
    })
    expect(derived(state, layers('title', 'badge'))).toEqual([])
  })

  it('fit a curved text of a fixed box to its curve', () => {
    const state = stateOf((nodes) => {
      Object.assign(nodes.title?.props ?? {}, { boxMode: 'fixed', curve: { shape: 'arcUp', amount: 50 } })
    })
    const curved: FitText = (layer) =>
      fittedText(layer, (props, width) => (props.curve ? { width: 240, height: 90 } : testMeasure(props, width)))
    const next = after(state, layers('title'), derivedValues(curved))
    expect(boxOf(next, 'title')).toEqual({ x: 100, y: 100, width: 240, height: 90 })
  })

  it('fit the group a layer moved out of, as the change set that moved it touched it', () => {
    const before = stateOf()
    const moved = before.overlay()
    moved.apply({ op: 'set', value: { part: 'layer', id: 'price', key: 'parentId' }, to: 'sq' }, 'strict')
    const next = after(moved, touchedBy(before, moved, layers('price')))
    expect(boxOf(next, 'grp')).toEqual({ x: 100, y: 100, width: 600, height: 100 })
  })

  it('keep every box of a group as it is where it would be wider than a number holds', () => {
    const state = stateOf((nodes) => {
      Object.assign(nodes.title?.props ?? {}, { x: 1.5e308 })
      Object.assign(nodes.price?.props ?? {}, { x: -1.5e308 })
    })
    expect(derived(state, layers('price'))).toEqual([])
  })

  it('keep the box of a layer past where a number holds its hundredths, and of the groups it is in', () => {
    // Fitted at such a place, a box would come out a little otherwise each time: it is never current.
    const state = stateOf((nodes) => {
      Object.assign(nodes.price?.props ?? {}, { x: -1.5e306 })
    })
    const next = after(state, layers('price', 'title'))
    expect(boxOf(next, 'title')).toEqual({ x: 100, y: 100, width: 600, height: 72 })
    expect(boxOf(next, 'grp')).toEqual(boxOf(state, 'grp'))
    expect(boxOf(next, 'price')).toEqual(boxOf(state, 'price'))
  })

  it('fit a box whose numbers are at most 2^53/100, as D6 draws the line', () => {
    const far = 2 ** 53 / 200
    const state = stateOf((nodes) => {
      Object.assign(nodes.price?.props ?? {}, { x: far })
    })
    const next = after(state, layers('price'))
    expect(boxOf(next, 'price')).toEqual({ x: far, y: 300, width: 200, height: 72 })
    expect(boxOf(next, 'grp').width).toBe(far + 200 - 100)
  })

  it('keep the box of a text whose words would measure past where a number holds its hundredths', () => {
    const state = stateOf((nodes) => {
      Object.assign(nodes.price?.props ?? {}, {
        boxMode: 'autoWidth',
        text: 'x'.repeat(10),
        style: { fontFamily: 'Noto Sans', fontSize: 1e17, color: '#111111FF' },
      })
    })
    expect(derived(state, layers('price'))).toEqual([])
  })

  it('fit groups in groups, reading what each one up the chain holds', () => {
    const state = stateOf()
    const nested = state.overlay()
    nested.apply(
      {
        op: 'create',
        part: 'layer',
        id: 'inner',
        record: {
          type: 'group',
          parentId: 'grp',
          index: 'a2',
          link: 'inner',
          name: 'Group',
          props: { x: 0, y: 0, width: 1, height: 1 },
        },
      },
      'strict',
    )
    nested.apply({ op: 'set', value: { part: 'layer', id: 'price', key: 'parentId' }, to: 'inner' }, 'strict')
    const next = after(nested, layers('price'))
    expect(boxOf(next, 'inner')).toEqual({ x: 100, y: 300, width: 200, height: 72 })
    // The outer group holds the title as it is (100 tall) and the inner group.
    expect(boxOf(next, 'grp')).toEqual({ x: 100, y: 100, width: 600, height: 272 })
    expect(sorted(derived(nested, layers('price')) as Change[])).toEqual(
      sorted(overTheWholeDesign(nested, layers('price'))),
    )
  })

  it('wait while a text it fits waits, such as for its font', () => {
    const waiting = derivedValues((layer) => (layer?.type === 'text' ? 'wait' : undefined))
    expect(waiting(stateOf(), layers('title'))).toBe('wait')
    // Nothing touched is a text it fits: nothing to wait for.
    expect(waiting(stateOf(), layers('badge'))).toEqual([])
  })

  it('read only the layers touched, the groups they are in and what those hold', () => {
    const state = stateOf()
    const readable = new Set(['title', 'price', 'grp'])
    const changes = derived(readingOnly(state, readable), layers('title'))
    expect(changes).toEqual(derived(state, layers('title')))
    expect(changes).not.toEqual([])
  })

  it('work out what the whole design read gives, over random designs and touched layers', () => {
    const designs: readonly (() => DesignInput)[] = [kindsDesign, linkedDesign, testDesign]
    let compared = 0
    for (let seed = 1; seed <= 300; seed++) {
      const random = seeded(seed)
      const design = (designs[seed % designs.length] as () => DesignInput)() as unknown as DesignRecords
      const ids = Object.keys(design.nodes)
      // Boxes and words made stale, turned, placed at either side of 2^53/100, and layers (groups
      // too) moved into groups, never into themselves.
      type Raw = { type: string; parentId: string; props: Record<string, unknown> }
      const raw = (id: string) => design.nodes[id] as Raw
      const inside = (id: string, holder: string) => {
        for (let up: string | undefined = holder; up !== undefined && design.nodes[up]; up = raw(up).parentId) {
          if (up === id) return true
        }
        return false
      }
      const groups = ids.filter((id) => raw(id).type === 'group')
      for (const id of ids) {
        const layer = raw(id)
        if (random() < 0.3) layer.props.height = Math.round(random() * 500)
        if (random() < 0.2) layer.props.x = Math.round(random() * 1000 - 500)
        if (random() < 0.15) layer.props.rotation = Math.round(random() * 360)
        if (random() < 0.03) layer.props.y = random() < 0.5 ? 2 ** 53 / 100 : (2 ** 53 / 100) * (1 + 2 ** -50)
        if (layer.type === 'text' && random() < 0.3) layer.props.text = 'word '.repeat(1 + Math.floor(random() * 20))
        const group = groups[Math.floor(random() * groups.length)]
        if (group && random() < 0.15 && !inside(id, group)) layer.parentId = group
      }
      const state = DesignState.fromRecords(design)
      const touched = layers(...ids.filter(() => random() < 0.4))
      expect(sorted(derived(state, touched) as Change[]), `seed ${seed}`).toEqual(
        sorted(overTheWholeDesign(state, touched)),
      )
      compared += touched.size
    }
    expect(compared).toBeGreaterThan(1000)
  })

  it('fit a text inside groups that hold each other, keeping theirs, as the working design can hold them until the server rejects them', () => {
    const state = stateOf()
    const looped = state.overlay()
    looped.apply(
      {
        op: 'create',
        part: 'layer',
        id: 'g2',
        record: {
          type: 'group',
          parentId: 'grp',
          index: 'a9',
          link: 'g2',
          name: 'Group',
          props: { x: 0, y: 0, width: 1, height: 1 },
        },
      },
      'lenient',
    )
    looped.apply({ op: 'set', value: { part: 'layer', id: 'grp', key: 'parentId' }, to: 'g2' }, 'lenient')
    const next = after(looped, layers('title'))
    expect(boxOf(next, 'title')).toEqual({ x: 100, y: 100, width: 600, height: 72 })
    expect(boxOf(next, 'grp')).toEqual(boxOf(looped, 'grp'))
    expect(boxOf(next, 'g2')).toEqual(boxOf(looped, 'g2'))
    // Touched themselves, they keep their boxes too.
    expect(derived(looped, layers('grp', 'g2'))).toEqual([])
  }, 2_000)
})
