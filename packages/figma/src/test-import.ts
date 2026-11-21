// Imports test files and checks what every import holds to, for the converter's tests.
import { expect } from 'vitest'

import { boundsOf } from '@dazbee/doc'
import { FigmaImport, type FigmaReportLine, type Layer } from '@dazbee/schema'

import { figmaToImport } from './index.ts'

export const imported = (text: string, nodeId?: string) => {
  const result = figmaToImport(text, nodeId === undefined ? {} : { nodeId })
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
