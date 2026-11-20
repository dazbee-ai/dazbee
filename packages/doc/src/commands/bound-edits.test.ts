// A hand edit of a bound property, by any command, ends its binding in the command's own step: on a
// session over a plain store, each case read back from the design.
import { describe, expect, it } from 'vitest'

import {
  BINDABLE_PROPERTIES,
  type BindableProperty,
  canBind,
  type Design,
  type DesignInput,
  type Layer,
  type Paint,
  styleOf,
} from '@dazbee/schema'

import { openSession } from '../session.ts'
import { type DesignStore, readDesign } from '../store.ts'
import { casesOf, COMMAND_INPUTS, sweepWorld } from '../test-commands.ts'
import { kindsDesign, linkedDesign, openTestSession, testDesign } from '../test-design.ts'
import { forkTestStore, openTestStore } from '../test-store.ts'
import { seeded } from '../test-walk.ts'
import { COMMANDS } from './index.ts'

const PRIMARY = '#FF5A36FF'
const IMAGE: Paint = { type: 'image', assetId: 'photo', fit: 'fill', opacity: 1 }
const GRADIENT: Paint = {
  type: 'linear',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
  stops: [
    { offset: 0, color: PRIMARY },
    { offset: 1, color: '#000000FF' },
  ],
}
const MARK = { versionId: 'v1', kind: 'named', name: 'Sent to client', takenAt: '2026-11-16T14:30:00.000Z' } as const

/** The test design with the box's fill bound to the primary colour, and the headline's colour and font bound. */
function boundDesign(): DesignInput {
  const design = testDesign()
  Object.assign(design.nodes.box as object, { bindings: { fill: 'brand:primary' } })
  Object.assign(design.nodes.headline as object, { bindings: { textColor: 'brand:ink', fontFamily: 'brand:heading' } })
  return design
}

/** A design with every bindable property of every layer that holds a value for it bound. */
function boundEverywhere(design: DesignInput): DesignInput {
  for (const node of Object.values(design.nodes)) {
    const props = node.props as Record<string, unknown>
    const bindings = Object.fromEntries(
      Object.entries(BINDABLE_PROPERTIES)
        .filter(([property, entry]) => canBind(node.type, property as BindableProperty) && entry.read(props))
        .map(([property]) => [property, `brand:${property.toLowerCase()}`]),
    )
    if (Object.keys(bindings).length > 0) Object.assign(node, { bindings })
  }
  return design
}

function open(design = boundDesign()) {
  const store = openTestStore(design)
  const tab = openTestSession(store)
  const layer = (id: string) => readDesign(store).nodes[id] as Layer
  const style = (id: string) => (layer(id).props as { style: Record<string, unknown> }).style
  const fill = (fills: Paint[]) => tab.run('node.update', { ids: ['box'], patch: { fills } })
  return { store, tab, layer, style, fill }
}

/**
 * Each binding of the layers in `before` the design `after` still holds, whose bound value it
 * changed: a problem for a command that sets no bindings.
 */
function changedUnderBinding(before: Design, after: Design): string[] {
  return Object.entries(before.nodes).flatMap(([id, was]) => {
    const now = after.nodes[id]
    if (!now) return []
    return Object.entries(now.bindings ?? {}).flatMap(([property, ref]) => {
      const { read } = BINDABLE_PROPERTIES[property as BindableProperty]
      if (was.bindings?.[property as BindableProperty] !== ref || read(was.props) === read(now.props)) return []
      return [`${id}'s ${property} went from ${read(was.props)} to ${read(now.props)}, still bound to ${ref}`]
    })
  })
}

describe('a hand edit of a bound property', () => {
  it('ends a bound fill’s binding when node.update recolours it; undo brings both back, redo ends it again', () => {
    const { tab, layer, fill } = open()
    fill([{ type: 'solid', color: '#00FF00FF' }])
    expect(layer('box').bindings).toBeUndefined()
    expect(layer('box').props).toMatchObject({ fills: [{ color: '#00FF00FF' }] })

    tab.undo()
    expect(layer('box').bindings).toEqual({ fill: 'brand:primary' })
    expect(layer('box').props).toMatchObject({ fills: [{ color: PRIMARY }] })

    tab.redo()
    expect(layer('box').bindings).toBeUndefined()
    expect(layer('box').props).toMatchObject({ fills: [{ color: '#00FF00FF' }] })
  })

  it('ends only a text’s colour binding when its colour changes, and only its font binding when its font does', () => {
    const { tab, layer, style } = open()
    tab.run('node.update', { ids: ['headline'], patch: { style: { ...style('headline'), color: '#00AA00FF' } } })
    expect(layer('headline').bindings).toEqual({ fontFamily: 'brand:heading' })
    tab.undo()
    expect(layer('headline').bindings).toEqual({ textColor: 'brand:ink', fontFamily: 'brand:heading' })
    expect(style('headline').color).toBe('#111111FF')

    tab.run('node.update', { ids: ['headline'], patch: { style: { ...style('headline'), fontFamily: 'Inter' } } })
    expect(layer('headline').bindings).toEqual({ textColor: 'brand:ink' })
    tab.undo()
    expect(layer('headline').bindings).toEqual({ textColor: 'brand:ink', fontFamily: 'brand:heading' })
    expect(style('headline').fontFamily).toBe('Noto Sans')
    tab.redo()
    expect(layer('headline').bindings).toEqual({ textColor: 'brand:ink' })
  })

  it('keeps the linked copies’ bindings', () => {
    const store = openTestStore(boundEverywhere(testDesign()))
    const tab = openTestSession(store)
    tab.run('node.update', { ids: ['box'], patch: { fills: [{ type: 'solid', color: '#00FF00FF' }] } })
    expect(readDesign(store).nodes.box?.bindings).toBeUndefined()
    expect(readDesign(store).nodes['banner-box']?.bindings).toEqual({ fill: 'brand:fill' })
  })
})

describe('an edit that leaves the bound value as it was keeps the binding', () => {
  const kept: [string, Paint[]][] = [
    ['the fill paint’s own opacity changed', [{ type: 'solid', color: PRIMARY, opacity: 0.5 }]],
    ['an image fill added under it', [IMAGE, { type: 'solid', color: PRIMARY }]],
    ['an image fill added over it', [{ type: 'solid', color: PRIMARY }, IMAGE]],
    [
      'a solid fill added under it, then the fills reordered back',
      [
        { type: 'solid', color: '#000000FF' },
        { type: 'solid', color: PRIMARY },
      ],
    ],
    ['the same colour set again', [{ type: 'solid', color: PRIMARY }]],
    ['the same colour in small letters', [{ type: 'solid', color: PRIMARY.toLowerCase() }]],
  ]
  it.each(kept)('%s', (_, fills) => {
    const { layer, fill } = open()
    fill(fills)
    expect(layer('box').bindings).toEqual({ fill: 'brand:primary' })
  })

  it('a text resized, its font size scaled', () => {
    const { tab, layer, style } = open()
    tab.run('node.update', {
      ids: ['headline'],
      patch: { width: 1920, height: 200, style: { ...style('headline'), fontSize: 168 } },
    })
    expect(style('headline').fontSize).toBe(168)
    expect(layer('headline').bindings).toEqual({ textColor: 'brand:ink', fontFamily: 'brand:heading' })
  })

  it('a range of its characters recoloured and given another font', () => {
    const { tab, layer } = open()
    tab.run('text.edit', {
      id: 'headline',
      op: { kind: 'style', at: 0, length: 6, style: { color: '#00AA00FF', fontFamily: 'Inter' } },
    })
    expect((layer('headline').props as { runs: unknown[] }).runs[0]).toMatchObject({
      start: 0,
      end: 6,
      style: { color: '#00AA00FF' },
    })
    expect(layer('headline').bindings).toEqual({ textColor: 'brand:ink', fontFamily: 'brand:heading' })
  })

  it('a layer made with bindings, by a duplicate', () => {
    const { tab, store } = open()
    const [copy] = tab.run('node.duplicate', { ids: ['box'] }) as string[]
    expect(readDesign(store).nodes[copy ?? '']?.bindings).toEqual({ fill: 'brand:primary' })
  })
})

describe('an edit that changes the bound value ends the binding', () => {
  const ended: [string, Paint[]][] = [
    ['the bound fill hidden', [{ type: 'solid', color: PRIMARY, visible: false }]],
    ['the bound fill removed', []],
    ['the bound fill repainted as a gradient', [GRADIENT]],
    ['the bound fill repainted as an image', [IMAGE]],
    [
      'the colour’s alpha changed, as the Colour panel’s opacity field writes it',
      [{ type: 'solid', color: '#FF5A3680' }],
    ],
  ]
  it.each(ended)('%s, adding no fill back', (_, fills) => {
    const { layer, fill } = open()
    fill(fills)
    expect(layer('box').bindings).toBeUndefined()
    expect((layer('box').props as { fills: Paint[] }).fills).toEqual(fills)
  })
})

describe('the rule in a batch and a gesture', () => {
  it('ends a binding the batch made when a later command of it edits the property', () => {
    const { tab, layer, style } = open(testDesign())
    tab.batch(() => {
      tab.run('node.bind', { ids: ['headline'], property: 'textColor', ref: 'brand:ink', value: '#222222FF' })
      tab.run('node.update', { ids: ['headline'], patch: { style: { ...style('headline'), color: '#00AA00FF' } } })
    })
    expect(layer('headline').bindings).toBeUndefined()
    expect(style('headline').color).toBe('#00AA00FF')
    tab.undo()
    expect(layer('headline').bindings).toBeUndefined()
    expect(style('headline').color).toBe('#111111FF')
  })

  it('ends a binding as part of a gesture’s step, which one undo takes back whole', () => {
    const { tab, layer } = open()
    tab.gesture(() => {
      tab.run('node.update', { ids: ['box'], patch: { x: 120 } })
      tab.run('node.update', { ids: ['box'], patch: { fills: [{ type: 'solid', color: '#00FF00FF' }] } })
      tab.run('node.update', { ids: ['box'], patch: { x: 140 } })
    })
    expect(layer('box').bindings).toBeUndefined()
    tab.undo()
    expect(layer('box').bindings).toEqual({ fill: 'brand:primary' })
    expect(layer('box').props).toMatchObject({ x: 100, fills: [{ color: PRIMARY }] })
    expect(tab.canUndo()).toBe(false)
  })
})

describe('the commands that set bindings', () => {
  it('node.bind binds a bound fill to another token, with its colour', () => {
    const { tab, layer } = open()
    tab.run('node.bind', { ids: ['box'], property: 'fill', ref: 'brand:accent', value: '#00AA00FF' })
    expect(layer('box').bindings).toEqual({ fill: 'brand:accent' })
    expect(layer('box').props).toMatchObject({ fills: [{ color: '#00AA00FF' }] })
  })

  it('node.style sets a style whose fill colour differs, with its binding', () => {
    const { tab, layer } = open()
    const style = { ...styleOf(layer('box')), fills: [{ type: 'solid' as const, color: '#14213DFF' }] }
    tab.run('node.style', { ids: ['box'], style })
    expect(layer('box').bindings).toEqual({ fill: 'brand:primary' })
    expect(layer('box').props).toMatchObject({ fills: [{ color: '#14213DFF' }] })
  })

  it('a version restore writes the version’s bindings as they were', () => {
    const { tab, layer, store } = open()
    const version = structuredClone(readDesign(store))
    Object.assign(version.nodes.box as object, {
      props: { ...version.nodes.box?.props, fills: [{ type: 'solid', color: '#14213DFF' }] },
    })
    tab.run('design.restore', { design: version, mark: MARK })
    expect(layer('box').bindings).toEqual({ fill: 'brand:primary' })
    expect(layer('box').props).toMatchObject({ fills: [{ color: '#14213DFF' }] })
  })
})

describe('every command that sets no bindings', () => {
  const DESIGNS: Record<string, () => DesignInput> = {
    'one frame of every layer type and state': kindsDesign,
    'linked frames': testDesign,
    'two pages': linkedDesign,
  }
  const names = Object.keys(COMMANDS).filter(
    (name) => !(COMMANDS as Record<string, { setsBindings?: true }>)[name]?.setsBindings,
  )

  it.each(names)('%s leaves each binding gone, or its value as it was', (name) => {
    const problems: string[] = []
    for (const [title, make] of Object.entries(DESIGNS)) {
      const store = openTestStore(boundEverywhere(make()))
      const session = openSession(store)
      const world = sweepWorld(session, seeded(1))
      session.destroy()
      for (const input of COMMAND_INPUTS[name]?.(world) ?? []) {
        for (const one of casesOf(input, world)) {
          const fork: DesignStore = forkTestStore(store)
          const tab = openSession(fork)
          const before = readDesign(fork)
          try {
            tab.run(name as never, one.input as never)
          } catch {
            // A refusal or a fault writes nothing, which the sweep checks.
          }
          for (const problem of changedUnderBinding(before, readDesign(fork)))
            problems.push(`on ${title}, with ${one.label}: ${problem}`)
          tab.destroy()
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([])
  })
})
