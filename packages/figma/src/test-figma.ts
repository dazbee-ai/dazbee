// Builds Figma file JSON for tests, in the shapes Figma's REST API documents: a file's document of
// pages, and nodes with their ids, types, names, boxes, matrices, geometry and children.

import { apply, invert, type Matrix, multiply } from '@dazbee/svg'

/** A Figma node as the file holds it: any fields beside its id and type. */
export type TestNode = { id: string; type: string; name?: string; children?: TestNode[] } & Record<string, unknown>

/** A mirror left to right, as a matrix flipping x. */
export const MIRROR_X: Matrix = [-1, 0, 0, 1, 0, 0]
/** A mirror top to bottom, as a matrix flipping y. */
export const MIRROR_Y: Matrix = [1, 0, 0, -1, 0, 0]

export const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

/** A node of `type` at `at` (its absoluteBoundingBox), named after its type unless `extra` names it. */
export const node = (
  type: string,
  id: string,
  at: ReturnType<typeof box>,
  extra: Record<string, unknown> = {},
): TestNode => ({ id, type, name: type.toLowerCase(), absoluteBoundingBox: at, ...extra })

export const frame = (id: string, at: ReturnType<typeof box>, children: TestNode[] = [], extra = {}) =>
  node('FRAME', id, at, { name: `Frame ${id}`, clipsContent: true, children, ...extra })

export const group = (id: string, children: TestNode[], extra = {}) =>
  node('GROUP', id, box(0, 0, 0, 0), { name: `Group ${id}`, children, ...extra })

export const rectangle = (id: string, at: ReturnType<typeof box>, extra = {}) =>
  node('RECTANGLE', id, at, { name: `Rect ${id}`, ...extra })

export const page = (id: string, name: string, children: TestNode[]): TestNode => ({
  id,
  type: 'CANVAS',
  name,
  children,
})

/** A file holding `pages`, as `GET /v1/files/:key` answers, before it is turned into text. */
export const figmaDocument = (pages: TestNode[], extra: Record<string, unknown> = {}) => ({
  name: 'Spring launch',
  editorType: 'figma',
  document: { id: '0:0', type: 'DOCUMENT', name: 'Document', children: pages },
  ...extra,
})

/** The text of a file holding `pages`. */
export const figmaFile = (pages: TestNode[], extra: Record<string, unknown> = {}) =>
  JSON.stringify(figmaDocument(pages, extra))

/** The text of a file of one page holding `children`. */
export const onePage = (children: TestNode[]) => figmaFile([page('0:1', 'Page 1', children)])

/** A turn by `degrees` (clockwise on screen) about the origin, then a move to (`x`, `y`). */
export const turned = (degrees: number, x = 0, y = 0): Matrix => {
  const t = (degrees * Math.PI) / 180
  return [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), x, y]
}

/**
 * The fields that place a node of `width` × `height` whose own pixels `world` takes to the page's,
 * in a parent whose own pixels `parent` takes there: `size`, `relativeTransform` and
 * `absoluteBoundingBox`, as Figma writes them.
 */
export function placedAt(world: Matrix, width: number, height: number, parent: Matrix = [1, 0, 0, 1, 0, 0]) {
  const rel = multiply(invert(parent) ?? [1, 0, 0, 1, 0, 0], world)
  return {
    size: { x: width, y: height },
    relativeTransform: [
      [rel[0], rel[2], rel[4]],
      [rel[1], rel[3], rel[5]],
    ],
    absoluteBoundingBox: aabb(world, width, height),
  }
}

/** The box around a box of `width` × `height` as `m` places it. */
export function aabb(m: Matrix, width: number, height: number) {
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x = 0, y = 0]) => apply(m, x, y))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return box(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}

/** A solid Figma paint of `hex` (#rrggbb). */
export const solid = (hex: string) => ({
  type: 'SOLID',
  color: {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
    a: 1,
  },
})

/** One entry of a node's `fillGeometry` or `strokeGeometry`. */
export const outline = (path: string, windingRule = 'NONZERO', extra: Record<string, unknown> = {}) => ({
  path,
  windingRule,
  ...extra,
})

/** A vector of `width` × `height` that `world` places, with `extra` fields such as its geometry and paints. */
export const vector = (
  id: string,
  world: Matrix,
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
  parent?: Matrix,
): TestNode => ({ id, type: 'VECTOR', name: `Vector ${id}`, ...placedAt(world, width, height, parent), ...extra })
