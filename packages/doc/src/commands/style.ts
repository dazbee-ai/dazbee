// Setting a style on layers: what Paste style and Copy to other frames ▸ Style write.
import { z } from 'zod'

import { BindableProperty, LayerStyle, NodeId, restyle } from '@dazbee/schema'

import { lockProblem, missingLayer } from './checks.ts'
import { defineCommand, strict } from './define.ts'

/**
 * Sets a style (fill, outline, effects, transparency, corners, the text's look and their brand
 * bindings) on layers, each in what it has; font size, place, size and turn stay. Layers that have
 * it already are left as they are. Their linked copies in other frames keep their own style.
 */
export const nodeStyle = defineCommand({
  name: 'node.style',
  description:
    'Sets a style, such as the fills, outlines, effects, transparency, corners and the text’s look, on layers, each taking what applies to it; the place, size, turn and font size stay. It refuses a missing layer and one with its style locked.',
  step: 'style',
  batchable: true,
  setsBindings: true,
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to style.'),
    style: strict(LayerStyle).describe('The style to set, as copied from a layer.'),
  }),
  check: ({ design }, { ids }) => {
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return missingLayer(design, [id])
      const locked = lockProblem(id, node, 'style')
      if (locked) return locked
    }
    return undefined
  },
  apply: ({ w, design }, { ids, style }) => {
    for (const id of ids) {
      const node = design.nodes[id]
      const change = node && restyle(node, style)
      if (!change) continue
      for (const [key, value] of Object.entries(change.patch)) {
        if (value === undefined) w.unsetProp(id, key)
        else w.setProp(id, key, value)
      }
      if (!change.bindings) continue
      for (const property of BindableProperty.options) {
        const ref = change.bindings[property]
        if (ref === w.binding(id, property)) continue
        if (ref) w.setBinding(id, property, ref)
        else w.unsetBinding(id, property)
      }
    }
  },
})
