// An input generator for every command, the variants of an input the sweep runs
// (commands/sweep.test.ts): valid extremes, wrong targets and junk, and the commands with a bug
// that faults are made with.
import { afterAll, beforeAll } from 'vitest'
import { z } from 'zod'

import { type Design, frameIdOf, type Layer, NodeId } from '@dazbee/schema'

import { childrenOf, descendants } from './children.ts'
import { defineCommand } from './commands/define.ts'
import { COMMANDS } from './commands/index.ts'
import type { Session } from './session.ts'
import { badge } from './test-design.ts'

/**
 * A design the sweep runs commands on, with the id of a layer deleted from it, and the id an input
 * gives what its command makes, by what it is: the same in every input of one world.
 */
/** What an input makes under an id its caller gives. */
export type Made = 'made' | 'wrapped' | 'new-page' | 'new-frame'

export interface World {
  design: Design
  deleted: string
  made: (what: Made) => string
  /** A number from 0 up to 1, for the inputs that pick a layer, a place or a value at random. */
  random: () => number
}

/** One input the sweep runs: what it is, and whether the command has to refuse it. */
export interface Case {
  label: string
  input: unknown
  refused: boolean
}

type Json = Record<string, unknown>
type Path = (string | number)[]

/**
 * Commands with a bug, registered only for the tests that call `registerBuggyCommands`:
 * `test.throw` moves a layer and then throws, `test.orphan` puts a layer under a parent that is
 * nowhere, and `test.spoil` gives a layer a width the schema does not take.
 */
export const BUGGY = {
  'test.throw': defineCommand({
    name: 'test.throw',
    description: 'Moves a layer, then throws.',
    step: 'edit',
    batchable: true,
    input: z.strictObject({ id: NodeId }),
    apply: ({ w }, { id }) => {
      w.setProp(id, 'x', 999)
      throw new Error('boom')
    },
  }),
  'test.orphan': defineCommand({
    name: 'test.orphan',
    description: 'Puts a layer under a parent that is nowhere.',
    step: 'edit',
    input: z.strictObject({ id: NodeId }),
    apply: ({ w }, { id }) => {
      w.set('layer', id, 'parentId', 'nowhere')
    },
  }),
  'test.spoil': defineCommand({
    name: 'test.spoil',
    description: 'Gives a layer a width the schema does not take.',
    step: 'edit',
    batchable: true,
    input: z.strictObject({ id: NodeId }),
    apply: ({ w }, { id }) => {
      w.setProp(id, 'width', -5)
    },
  }),
}
export type Buggy = keyof typeof BUGGY

/** The numbers a number field is tried with: none, and the largest and smallest the schema takes. */
const NUMBERS = [0, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE]
/** A text far longer than any a person types. */
const LONG_TEXT = 'long text '.repeat(10_000)
const ABSENT = Symbol('absent')
/** What a random insert types: Latin, Devanagari, Arabic, Han and a mark. */
const TEXTS = ['a', 'ब', 'ع', '字', '!']
const MADE: readonly Made[] = ['made', 'wrapped', 'new-page', 'new-frame']

const graphic = {
  type: 'graphic',
  name: 'Shape',
  props: {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    shape: { kind: 'rect' },
    fills: [{ type: 'solid', color: '#FF5A36FF' }],
  },
}
const words = {
  type: 'text',
  name: 'Words',
  role: 'body',
  props: {
    x: 10,
    y: 20,
    width: 300,
    height: 40,
    text: 'Hello',
    style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#111111FF' },
  },
}
const style = {
  fills: [{ type: 'solid', color: '#112233FF' }],
  strokes: [{ paint: { type: 'solid', color: '#000000FF' }, width: 2 }],
  effects: [{ type: 'dropShadow', x: 1, y: 2, blur: 3, color: '#00000080' }],
  opacity: 0.5,
  blendMode: 'multiply',
  corners: 4,
  text: {
    fontFamily: 'Noto Sans',
    fontWeight: 700,
    fontStyle: 'italic',
    color: '#112233FF',
    letterSpacing: { unit: 'px', value: 1 },
    lineHeight: 1.2,
    paragraphSpacing: 4,
    outline: { width: 1, color: '#000000FF' },
  },
  bindings: { fill: 'brand:primary' },
}

/** The version the restore is swept with: a named one. */
const RESTORE_MARK = { versionId: 'v1', kind: 'named', name: 'Sent to client', takenAt: '2026-11-16T14:30:00.000Z' }

const isList = (value: unknown): value is unknown[] => Array.isArray(value)
const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !isList(value)
const layersOf = (design: Design, keep: (layer: Layer, id: string) => boolean) =>
  Object.keys(design.nodes).filter((id) => keep(design.nodes[id] as Layer, id))
/** One of a list, picked at random. */
const any = <T>(random: () => number, list: readonly T[]) => list[Math.floor(random() * list.length)] as T
/** The frames, groups and boxes a layer can go into. */
const containers = (design: Design) => [
  ...Object.keys(design.frames),
  ...layersOf(design, (layer) => layer.type === 'group' || layer.type === 'box'),
]
/** How long a text layer's text is; 0 for any other layer. */
const lengthOf = (design: Design, id: string) => {
  const layer = design.nodes[id]
  return layer?.type === 'text' ? layer.props.text.length : 0
}
const page = (design: Design) => Object.keys(design.pages)[0] as string
const frame = (design: Design) => Object.keys(design.frames)[0] as string
const parentOf = (design: Design, id: string) => design.nodes[id]?.parentId ?? id
const unlocked = (layer: Layer) => !layer.lock
/** A shape nothing holds or locks, else any layer. */
const free = (design: Design) =>
  layersOf(design, (layer) => layer.type === 'graphic' && unlocked(layer) && layer.parentId in design.frames)[0] ??
  (Object.keys(design.nodes)[0] as string)
/** A group, else a box, else any layer. */
const holder = (design: Design) =>
  layersOf(design, (layer) => layer.type === 'group')[0] ??
  layersOf(design, (layer) => layer.type === 'box')[0] ??
  free(design)
/** A Free box, else any box, else any layer. */
const box = (design: Design) =>
  layersOf(design, (layer) => layer.type === 'box' && !layer.props.layout)[0] ??
  layersOf(design, (layer) => layer.type === 'box')[0] ??
  free(design)
const laidOut = (design: Design) =>
  layersOf(design, (layer) => layer.type === 'box' && !!layer.props.layout)[0] ?? box(design)
/** A layer a box's flow places, else any layer. */
const flowed = (design: Design) =>
  layersOf(design, (layer) => {
    const parent = design.nodes[layer.parentId]
    return parent?.type === 'box' && !!parent.props.layout && !layer.props.absolute
  })[0] ?? free(design)
const typed = (design: Design) => layersOf(design, (layer) => layer.type === 'text')[0] ?? free(design)
const masking = (design: Design) => layersOf(design, (layer) => !!layer.props.mask)[0] ?? free(design)
const path = (design: Design) =>
  layersOf(design, (layer) => layer.type === 'graphic' && layer.props.shape.kind === 'path')[0] ?? free(design)
/** The layers beside a layer, under its parent. */
const beside = (design: Design, id: string) =>
  childrenOf(design, parentOf(design, id))
    .map(([sibling]) => sibling)
    .filter((sibling) => sibling !== id)
/** Two unlocked shapes that share a parent. */
const pair = (design: Design) => {
  const shapes = layersOf(design, (layer) => layer.type === 'graphic' && unlocked(layer))
  const first = shapes.find((id) =>
    shapes.some((other) => other !== id && parentOf(design, other) === parentOf(design, id)),
  )
  return shapes.filter((id) => first !== undefined && parentOf(design, id) === parentOf(design, first)).slice(0, 2)
}
/** A version of a design to restore: its first frame and that frame's page, changed, holding a shape and a text of their own. */
const version = (design: Design) => {
  const frameId = frame(design)
  const pageId = design.frames[frameId]?.pageId ?? page(design)
  const at = (index: string) => ({ parentId: frameId, link: `kept-${index}`, index })
  return {
    meta: { designId: 'version', name: 'Version' },
    pages: { [pageId]: { name: 'Kept', order: 'a0' } },
    frames: { [frameId]: { pageId, name: 'Kept', width: 300, height: 250, x: 0, y: 0, order: 'a0' } },
    nodes: { 'kept-shape': { ...graphic, ...at('a0') }, 'kept-words': { ...words, ...at('a1') } },
  }
}
/** Layers' boxes as they are stored, as a command's `drawn` takes them. */
const drawn = (design: Design, ...ids: string[]) =>
  Object.fromEntries(
    ids.flatMap((id) => {
      const props = design.nodes[id]?.props
      return props ? [[id, { x: props.x, y: props.y, width: props.width, height: props.height }]] : []
    }),
  )
/** The boxes of every layer that holds others, as a command's `holders` takes them. */
const around = (design: Design) => drawn(design, ...layersOf(design, (_, id) => childrenOf(design, id).length > 0))
/** A layer and what it holds as a tree to place. */
const tree = (design: Design, root: string) => ({
  roots: [root],
  nodes: Object.fromEntries([root, ...descendants(design, root)].map((id) => [id, design.nodes[id]])),
})

/**
 * The inputs each command is swept with on a design, by command name: ones it takes there where
 * the design has the layers for it, else the nearest it has, which the command refuses.
 */
export const COMMAND_INPUTS: Partial<Record<string, (world: World) => unknown[]>> = {
  'node.create': ({ design, made }) => [
    { parentId: frame(design), layer: graphic },
    { id: made('made'), parentId: holder(design), layer: words },
  ],
  'node.update': ({ design, random }) => [
    { ids: [free(design)], patch: { x: 5, y: 6, width: 50, height: 60, rotation: 45, opacity: 0.5 } },
    { ids: [any(random, Object.keys(design.nodes))], patch: { x: Math.round(random() * 2000) - 500 } },
    { ids: [flowed(design)], patch: { absolute: true }, drawn: drawn(design, flowed(design)), holders: around(design) },
  ],
  'node.move': ({ design, random }) => [
    { id: free(design), parentId: frame(design), before: childrenOf(design, frame(design))[0]?.[0] },
    // Any layer into any frame, group or box: into what it holds, another frame, or across another tab's move.
    { id: any(random, Object.keys(design.nodes)), parentId: any(random, containers(design)) },
    { id: flowed(design), parentId: holder(design), drawn: drawn(design, flowed(design)), holders: around(design) },
  ],
  'node.delete': ({ design }) => [{ ids: [free(design)] }, { ids: [flowed(design)], holders: around(design) }],
  'node.lock': ({ design }) => [{ ids: [free(design)], lock: { move: true, style: false } }],
  'node.rename': ({ design }) => [{ id: free(design), name: 'Renamed' }],
  'node.mask': ({ design }) => [
    { ids: [free(design)], mask: 'alpha' },
    { ids: [masking(design)], mask: null },
  ],
  'node.bind': ({ design }) => [
    { ids: [free(design)], target: 'fill', ref: 'brand:primary', value: '#112233FF' },
    { ids: [typed(design)], target: 'fontFamily', ref: 'brand:heading', value: 'Inter' },
    { ids: [free(design)], target: 'fill', ref: null },
  ],
  'node.style': ({ design }) => [
    { ids: [free(design), typed(design)], style },
    { ids: [holder(design)], style: { effects: [], opacity: 1, blendMode: 'pass-through', bindings: {} } },
  ],
  'node.reorder': ({ design }) =>
    ['forward', 'backward', 'front', 'back'].map((to) => ({ ids: [childrenOf(design, frame(design))[1]?.[0]], to })),
  'node.duplicate': ({ design }) => [
    { ids: [free(design)] },
    { ids: [holder(design)] },
    {
      ids: [holder(design)],
      places: Object.fromEntries(
        [holder(design), ...descendants(design, holder(design))].map((id) => [
          id,
          { x: (design.nodes[id]?.props.x ?? 0) + 20, y: (design.nodes[id]?.props.y ?? 0) + 20 },
        ]),
      ),
    },
  ],
  'design.place': ({ design }) => [
    { parentId: frame(design), tree: tree(design, holder(design)), dx: 10, dy: 20, keepLinksFrom: page(design) },
    { parentId: frame(design), tree: tree(design, free(design)) },
  ],
  'node.copyToFrames': ({ design }) => [{ ids: [free(design)] }, { ids: [holder(design)] }],
  'node.group': ({ design, made }) => [
    { ids: pair(design), id: made('wrapped'), name: 'Wrapped', drawn: drawn(design, ...pair(design)) },
  ],
  'node.box': ({ design, made }) => [
    { ids: pair(design), id: made('wrapped'), name: 'Wrapped', drawn: drawn(design, ...pair(design)) },
  ],
  'node.enclose': ({ design }) => [{ id: box(design), ids: beside(design, box(design)).slice(0, 2) }],
  'node.boolean': ({ design, made }) => [{ ids: pair(design), op: 'subtract', id: made('wrapped'), name: 'Cut' }],
  'node.ungroup': ({ design }) => [
    { ids: [holder(design)], drawn: drawn(design, ...descendants(design, holder(design))) },
    { ids: [parentOf(design, masking(design))] },
  ],
  'node.hug': ({ design }) => [{ ids: [childrenOf(design, holder(design))[0]?.[0] ?? free(design)] }],
  'node.reshape': ({ design }) => [{ id: path(design), d: 'M0 0L40 0L20 30Z', dx: 3, dy: 4, width: 40, height: 30 }],
  'node.flip': ({ design }) => [
    { ids: [free(design)], axis: 'horizontal' },
    {
      ids: [holder(design)],
      axis: 'vertical',
      drawn: drawn(design, holder(design), ...descendants(design, holder(design))),
    },
    { ids: [laidOut(design)], axis: 'horizontal' },
  ],
  'node.autoLayout': ({ design }) => [
    ...['auto', 'row', 'column', 'grid'].map((layout) => ({ id: box(design), layout })),
    {
      id: laidOut(design),
      layout: 'free',
      drawn: drawn(design, laidOut(design), ...descendants(design, laidOut(design))),
    },
  ],
  'text.edit': ({ design, random }) => [
    { id: typed(design), op: { kind: 'insert', at: 1, text: 'more' } },
    {
      id: typed(design),
      op: {
        kind: 'insert',
        at: Math.floor(random() * (lengthOf(design, typed(design)) + 1)),
        text: any(random, TEXTS),
      },
    },
    { id: typed(design), op: { kind: 'delete', at: 0, length: 1 } },
    { id: typed(design), op: { kind: 'style', at: 0, length: 1, style: { fontWeight: 700, color: '#112233FF' } } },
  ],
  'text.replace': ({ design, random }) => [
    { ids: [typed(design)], find: 'e', replace: 'E' },
    { ids: [typed(design)], find: any(random, TEXTS), replace: any(random, TEXTS) },
    { ids: [typed(design)], find: 'a', replace: '' },
  ],
  'text.fit': ({ design }) => [{ id: typed(design), width: 120, height: 48 }],
  'page.add': ({ made }) => [
    { name: 'Added', frame: { name: 'Frame', width: 300, height: 250 } },
    { id: made('new-page'), name: 'Added', frame: { id: made('new-frame'), name: 'Frame', width: 300, height: 250 } },
  ],
  'page.update': ({ design }) => [{ id: page(design), name: 'Renamed' }],
  'page.duplicate': ({ design, made }) => [
    { id: page(design) },
    { id: page(design), newId: made('new-page'), name: 'Copy' },
  ],
  'page.move': ({ design }) => [
    { id: page(design), before: null },
    { id: Object.keys(design.pages).at(-1), before: page(design) },
  ],
  'page.delete': ({ design }) => [{ id: Object.keys(design.pages).at(-1) }],
  'frame.add': ({ design, made }) => [
    { pageId: page(design), name: 'Added', width: 300, height: 250 },
    { id: made('new-frame'), pageId: page(design), name: 'Added', width: 300, height: 250, x: 40, y: 50 },
  ],
  'frame.update': ({ design }) => [
    {
      frameId: frame(design),
      name: 'Renamed',
      width: 600,
      height: 500,
      x: 10,
      y: 20,
      fills: [{ type: 'solid', color: '#112233FF' }],
    },
  ],
  'frame.duplicate': ({ design, made }) => [
    { frameId: frame(design) },
    { frameId: frame(design), newId: made('new-frame') },
  ],
  'frame.addSize': ({ design, made }) => [
    { frameId: frame(design), newId: made('new-frame'), width: 300, height: 600 },
  ],
  'frame.delete': ({ design }) => [{ frameId: frame(design) }],
  'guide.add': ({ design }) => [
    { frameId: frame(design), axis: 'x', at: 40 },
    { frameId: frame(design), axis: 'y', at: 0 },
  ],
  'guide.move': ({ design }) => [{ frameId: frame(design), index: 0, at: 20 }],
  'guide.remove': ({ design }) => [{ frameId: frame(design), index: 1 }],
  'guide.clear': ({ design }) => [{ frameId: frame(design) }],
  'design.restore': ({ design }) => [{ design: version(design), mark: RESTORE_MARK }],
  'frame.resize': ({ design }) => [
    { frameId: frame(design), width: 600, height: 500 },
    { frameId: frame(design), width: 400, height: 300, x: -20.5, y: 30, layers: 'follow' },
    { frameId: frame(design), width: 700, height: 650, x: 10, y: -40, layers: 'stay' },
  ],
}

/**
 * An input and every variant of it the sweep runs. Valid extremes: each number as 0 and as the
 * largest and smallest numbers, each text empty and very long, each list of layers as every layer
 * of their frame and as one layer twice. Wrong targets: each id as one that never existed, a
 * deleted layer's, an id of another kind, and a layer of another page. Junk: each field with a
 * wrong type, null and missing, and each object with a field it doesn't have, which a command has
 * to refuse outside `props` and `patch`.
 */
export function casesOf(input: unknown, world: World): Case[] {
  const cases: Case[] = [{ label: 'as given', input, refused: false }]
  const vary = (label: string, path: Path, value: unknown, refused = false) =>
    cases.push({ label: `${label} at ${path.join('.') || 'the input'}`, input: changed(input, path, value), refused })
  for (const { path, value } of sites(input)) {
    if (typeof value === 'number') for (const n of NUMBERS) vary(`the number ${n}`, path, n)
    if (typeof value === 'string') {
      if (kindOf(world.design, value)) {
        for (const [what, id] of wrongTargets(world, value)) vary(what, path, id)
      } else if (MADE.some((what) => world.made(what) === value)) {
        vary("a deleted layer's id as a new id", path, world.deleted)
        for (const [what, id] of liveIds(world.design)) vary(`${what} as a new id`, path, id, true)
      } else {
        vary('an empty text', path, '')
        vary('a very long text', path, LONG_TEXT)
      }
    }
    if (isList(value) && value.length > 0 && value.every((id) => typeof id === 'string' && id in world.design.nodes)) {
      const ids = value as string[]
      const all = descendants(world.design, frameIdOf(world.design, ids[0] as string) ?? '')
      vary('every layer of the frame', path, all)
      vary('one layer twice', path, [ids[0], ids[0]])
    }
    if (isJson(value)) {
      for (const key of Object.keys(value).filter((key) => kindOf(world.design, key))) {
        for (const [what, id] of wrongTargets(world, key)) {
          const { [key]: moved, ...rest } = value
          vary(`${what} as the key "${key}"`, path, { ...rest, [id]: moved })
        }
      }
      vary(
        'a field it does not have',
        path,
        { ...value, junk: 1 },
        !path.some((key) => key === 'props' || key === 'patch'),
      )
    }
    if (path.length === 0) continue
    vary('a wrong type', path, wrongType(value))
    vary('null', path, null)
    if (typeof path.at(-1) === 'string') vary('nothing', path, ABSENT)
  }
  return cases
}

/** Registers the commands with a bug (`BUGGY`) for the tests of the file or `describe` this is called in. */
export function registerBuggyCommands() {
  const registry = COMMANDS as Record<string, unknown>
  beforeAll(() => {
    Object.assign(registry, BUGGY)
  })
  afterAll(() => {
    for (const name of Object.keys(BUGGY)) Reflect.deleteProperty(registry, name)
  })
}

/**
 * The world the sweep's inputs are made from, written into a session's store: a deleted layer and
 * a deleted frame with its layer, untracked so nothing of it is left to undo.
 */
export function sweepWorld(session: Session, random: () => number): World {
  if (session.inGesture()) throw new Error('the sweep makes its world with no gesture open, so untracked runs at once')
  const ids = session.untracked(() => {
    const layer = session.run('node.create', {
      parentId: Object.keys(session.design().frames)[0] as string,
      layer: badge,
    })
    session.run('node.delete', { ids: [layer] })
    const pageId = Object.keys(session.design().pages)[0] as string
    const frame = session.run('frame.add', { pageId, name: 'Gone', width: 100, height: 100 })
    session.run('node.create', { parentId: frame, layer: badge })
    session.run('frame.delete', { frameId: frame })
    return layer
  })
  return { design: session.design(), deleted: ids as string, made: (what) => what, random }
}

/** An id of each part the design holds now: a new record under one is refused while it is live (C27). */
function liveIds(design: Design): [string, string][] {
  const first = (part: Readonly<Record<string, unknown>>) => Object.keys(part)[0]
  const ids: [string, string | undefined][] = [
    ["a live page's id", first(design.pages)],
    ["a live frame's id", first(design.frames)],
    ["a live layer's id", first(design.nodes)],
  ]
  return ids.filter((entry): entry is [string, string] => entry[1] !== undefined)
}

/** What an id names in the design, if anything. */
function kindOf(design: Design, id: string): 'layer' | 'frame' | 'page' | undefined {
  if (Object.hasOwn(design.nodes, id)) return 'layer'
  if (Object.hasOwn(design.frames, id)) return 'frame'
  return Object.hasOwn(design.pages, id) ? 'page' : undefined
}

/** The ids to try in place of one the design holds, each with what it is. */
function wrongTargets({ design, deleted }: World, id: string): [string, string][] {
  const kind = kindOf(design, id)
  const pageOf = (layer: string) => design.frames[frameIdOf(design, layer) ?? '']?.pageId
  const elsewhere = Object.keys(design.nodes).find((other) => kind === 'layer' && pageOf(other) !== pageOf(id))
  const targets: [string, string | undefined][] = [
    ['an id that never existed', 'never-was'],
    ["a deleted layer's id", deleted],
    ["a frame's id", kind === 'frame' ? undefined : frame(design)],
    ["a page's id", kind === 'page' ? undefined : page(design)],
    ["a layer's id", kind === 'layer' ? undefined : Object.keys(design.nodes)[0]],
    ['a layer of another page', elsewhere],
  ]
  return targets.filter((target): target is [string, string] => target[1] !== undefined)
}

/** Every value in an input with the path to it, the input itself first. */
function sites(value: unknown, path: Path = []): { path: Path; value: unknown }[] {
  const inner = isList(value)
    ? value.flatMap((item, i) => sites(item, [...path, i]))
    : isJson(value)
      ? Object.entries(value).flatMap(([key, item]) => sites(item, [...path, key]))
      : []
  return [{ path, value }, ...inner]
}

/** A value of another type than the one given. */
function wrongType(value: unknown): unknown {
  if (typeof value === 'number') return 'seven'
  if (typeof value === 'string') return 7
  if (typeof value === 'boolean') return 'yes'
  return isList(value) ? { 0: 'list' } : ['object']
}

/** A copy of an input with the value at a path replaced, or taken out when it is `ABSENT`. */
function changed(input: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value
  const [key, ...rest] = path as [string | number, ...Path]
  if (isList(input)) return input.map((item, i) => (i === key ? changed(item, rest, value) : item))
  const { [key]: was, ...others } = input as Json
  const next = changed(was, rest, value)
  return next === ABSENT ? others : { ...others, [key]: next }
}
