// Reads a Figma file's JSON, as Figma's REST API answers `GET /v1/files/:key`, without trusting it:
// a value of the wrong type reads as missing and never throws, only a map's own keys are read, and
// a file past the node or depth limit is refused.

import { isRecord, type Rect } from '@dazbee/schema'

/** A Figma node's fields, read only through `field`. */
export type FigmaFields = Readonly<Record<string, unknown>>

/**
 * A node of the file. A node whose id or type isn't a string has `''` for it. `children` holds
 * only nodes, in the file's order, bottom to top.
 */
export interface FigmaNode {
  id: string
  type: string
  name: string
  children: FigmaNode[]
  parent: FigmaNode | null
  fields: FigmaFields
}

export interface FigmaFile {
  name: string
  document: FigmaNode
}

export type FigmaReadError = 'not-json' | 'not-design-file' | 'too-many-nodes' | 'too-deep'

/** A file of more nodes than this, the document and its pages among them, is refused. */
export const MAX_FIGMA_NODES = 50_000
/** A file whose nodes nest deeper than this, the document being level 0, is refused. */
export const MAX_FIGMA_DEPTH = 256

/** Reads a file's text into its nodes, or the reason it can't be imported. */
export function readFigmaFile(text: string): FigmaFile | { error: FigmaReadError } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { error: 'not-json' }
  }
  const top = record(json)
  const document = record(field(top, 'document'))
  if (!top || !document || field(top, 'editorType') !== 'figma') return { error: 'not-design-file' }
  const root = nodeOf(document, null)
  let count = 1
  const stack: [FigmaFields, FigmaNode, number][] = [[document, root, 0]]
  for (let next = stack.pop(); next; next = stack.pop()) {
    const [fields, parent, depth] = next
    for (const child of list(field(fields, 'children'))) {
      if (++count > MAX_FIGMA_NODES) return { error: 'too-many-nodes' }
      if (depth + 1 > MAX_FIGMA_DEPTH) return { error: 'too-deep' }
      const childFields = record(child) ?? {}
      const node = nodeOf(childFields, parent)
      parent.children.push(node)
      stack.push([childFields, node, depth + 1])
    }
  }
  return { name: str(field(top, 'name')) ?? '', document: root }
}

/** The value `key` names in `value`, when `value` is a plain object that has it as its own; else undefined. */
export function field(value: unknown, key: string): unknown {
  const r = record(value)
  return r && Object.hasOwn(r, key) ? r[key] : undefined
}

/** A finite number, or undefined. */
export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** A plain object (no array, no null), or undefined. */
export function record(value: unknown): FigmaFields | undefined {
  return isRecord(value) ? value : undefined
}

/** An array, or an empty one for anything else. */
export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** A map the file holds, by its own keys only, so no key reaches Object.prototype. */
export function ownMap(value: unknown): Map<string, unknown> {
  const r = record(value)
  return new Map(r ? Object.keys(r).map((key) => [key, r[key]]) : [])
}

/** A node's `absoluteBoundingBox`, when it is four finite numbers with no negative side. */
export function boxOf(fields: FigmaFields): Rect | undefined {
  const b = field(fields, 'absoluteBoundingBox')
  const [x, y, width, height] = (['x', 'y', 'width', 'height'] as const).map((k) => num(field(b, k)))
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined
  return width >= 0 && height >= 0 ? { x, y, width, height } : undefined
}

function nodeOf(fields: FigmaFields, parent: FigmaNode | null): FigmaNode {
  return {
    id: str(field(fields, 'id')) ?? '',
    type: str(field(fields, 'type')) ?? '',
    name: str(field(fields, 'name')) ?? '',
    children: [],
    parent,
    fields,
  }
}
