// What a Figma link imports, by the node its `node-id` names: the whole file, a page, a top-level
// frame, a section's frames, or a layer inside a frame on its own.

import { FRAME_TYPES } from './layers.ts'
import type { FigmaNode } from './read.ts'

export type LinkTarget =
  | { kind: 'file' }
  | { kind: 'page'; page: FigmaNode }
  | { kind: 'frame'; node: FigmaNode }
  | { kind: 'section'; node: FigmaNode }
  | { kind: 'alone'; node: FigmaNode }

/**
 * What a link to `nodeId` (the API's form, `1:2`) imports from `document`; with no node, the whole
 * file. Null when the file has no such node. A frame whose parents up to its page are sections is
 * a top-level frame, as Figma shows it.
 */
export function linkTarget(document: FigmaNode, nodeId?: string): LinkTarget | null {
  if (nodeId === undefined) return { kind: 'file' }
  const node = find(document, nodeId)
  if (!node) return null
  if (node.type === 'DOCUMENT') return { kind: 'file' }
  if (node.type === 'CANVAS') return { kind: 'page', page: node }
  if (node.type === 'SECTION') return { kind: 'section', node }
  let up = node.parent
  while (up?.type === 'SECTION') up = up.parent
  return FRAME_TYPES.has(node.type) && up?.type === 'CANVAS' ? { kind: 'frame', node } : { kind: 'alone', node }
}

/** The page a node is on, or undefined for one on none. */
export function pageOf(node: FigmaNode): FigmaNode | undefined {
  let up: FigmaNode | null = node
  while (up && up.type !== 'CANVAS') up = up.parent
  return up ?? undefined
}

function find(document: FigmaNode, id: string): FigmaNode | undefined {
  const stack = [document]
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (n.id === id) return n
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as FigmaNode)
  }
  return undefined
}
