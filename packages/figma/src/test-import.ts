// Imports test files and checks what every import holds to, for the converter's tests.
import { expect } from 'vitest'

import { boundsOf, centreOf, type Point, turn } from '@dazbee/doc'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { FigmaImport, type FigmaReportLine, type Layer } from '@dazbee/schema'

import { newLayerBuild } from './build.ts'
import { figmaToImport } from './index.ts'
import { convertLayers, treeOf } from './layers.ts'
import { boxOf, readFigmaFile } from './read.ts'
import { newReport } from './report.ts'

export const ck = await loadCanvasKit()

export const imported = (text: string, nodeId?: string) => {
  const result = figmaToImport(ck, text, nodeId === undefined ? {} : { nodeId })
  if ('error' in result) throw new Error(result.error)
  checkInvariants(text, result.converted)
  return result
}

export const onlyFrame = (text: string, nodeId?: string) => {
  const { converted } = imported(text, nodeId)
  const f = converted.pages[0]?.frames[0]
  if (!f) throw new Error('no frame')
  return f
}

export const layersOf = (f: { layers: { nodes: Record<string, Layer>; roots: string[] } | null }) =>
  f.layers?.nodes ?? {}

export const childrenOf = (nodes: Record<string, Layer>, parentId: string) =>
  Object.entries(nodes)
    .filter(([, n]) => n.parentId === parentId)
    .sort(([, a], [, b]) => (a.index < b.index ? -1 : 1))
    .map(([id]) => id)

export const linesOf = (text: string, nodeId?: string) =>
  imported(text, nodeId).converted.report.items.map((i) => i.line)

export const countOf = (text: string, line: FigmaReportLine) =>
  imported(text).converted.report.items.find((i) => i.line === line)?.count ?? 0

/** What every import holds to: it parses, its groups fit their layers, and its keys name the file's nodes. */
export function checkInvariants(text: string, converted: FigmaImport) {
  expect(FigmaImport.safeParse(converted).success).toBe(true)
  const ids = new Set<string>()
  const stack = [JSON.parse(text).document]
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (typeof n?.id === 'string') ids.add(n.id)
    if (Array.isArray(n?.children)) stack.push(...n.children)
  }
  for (const f of converted.pages.flatMap((p) => p.frames)) {
    for (const figmaId of Object.values(f.figmaIds)) expect(ids.has(figmaId)).toBe(true)
    const nodes = layersOf(f)
    for (const [id, layer] of Object.entries(nodes)) {
      if (layer.type !== 'group' && layer.type !== 'boolean') continue
      const kids = childrenOf(nodes, id).map((k) => {
        const p = (nodes[k] as Layer).props
        return { x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation }
      })
      const fit = boundsOf(kids)
      const { x, y, width, height } = layer.props
      expect({ x, y, width, height }).toEqual({ x: fit.x, y: fit.y, width: fit.width, height: fit.height })
    }
  }
}

/** The build of the first frame's layers on the file's first page, with the paints each layer takes. */
export function built(text: string) {
  const file = readFigmaFile(text)
  if ('error' in file) throw new Error(file.error)
  const f = file.document.children[0]?.children[0]
  const at = f && boxOf(f.fields)
  if (!f || !at) throw new Error('no frame')
  const build = newLayerBuild(f.children, newReport(), ck)
  treeOf(build, convertLayers(build, f.children, at, false).pieces)
  return build
}

/**
 * Where the point `r` of a layer's own box (its top left at 0, 0) is drawn in its frame: mirrored
 * by the layer's flips, turned about its centre, then about each container's centre in turn.
 */
export function drawnAt(nodes: Record<string, Layer>, id: string, r: Point): Point {
  const layer = nodes[id] as Layer
  const { x, y, width, height } = layer.props
  const flips = layer.props as { flipX?: boolean; flipY?: boolean }
  let p = { x: x + (flips.flipX ? width - r.x : r.x), y: y + (flips.flipY ? height - r.y : r.y) }
  for (let at: Layer | undefined = layer; at; at = nodes[at.parentId]) {
    p = turn(p, centreOf({ ...at.props, rotation: at.props.rotation }), at.props.rotation)
  }
  return p
}
