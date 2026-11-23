// Commands for text layers: editing characters and styles, replacing what matches, and fitting the
// box to the words.
import { z } from 'zod'

import { NodeId, RunStyle, type TextProps } from '@dazbee/schema'

import { replaceOps, splitsPair } from '../text-value.ts'
import { boxPlan } from './box-plan.ts'
import { lockProblem, missingLayer } from './checks.ts'
import { defineCommand, strict } from './define.ts'

/** Half of a character written as two UTF-16 units, standing alone: with the `u` flag a whole pair is one character. */
const LONE_HALF = /[\uD800-\uDFFF]/u
const AT = z.number().int().min(0).describe('Where the edit starts, as an offset into the text.')
const LENGTH = z.number().int().positive().describe('How many characters, from `at`.')
const TextOp = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('insert').describe('Inserts text.'),
    at: AT,
    text: z.string().min(1).describe('The text to insert.'),
  }),
  z.strictObject({ kind: z.literal('delete').describe('Deletes characters.'), at: AT, length: LENGTH }),
  z.strictObject({
    kind: z.literal('style').describe('Sets a style on characters.'),
    at: AT,
    length: LENGTH,
    style: strict(RunStyle).describe('The style to set: the properties given, over what the characters have.'),
  }),
])

/**
 * Edits a text layer's characters or styles. Offsets count UTF-16 units. Inserted text takes the
 * style of the character before it. Its linked copies in other frames keep their own text.
 */
export const textEdit = defineCommand({
  name: 'text.edit',
  description:
    'Inserts or deletes characters of a text layer, or styles a range of them; offsets count UTF-16 units, and inserted text takes the style of the character before it. It refuses a missing layer, a layer that is not a text, one locked against the change, a range past the end of the text, and an offset that splits a character written as two UTF-16 units, such as an emoji. In a batch, each edit is checked against the text as the batch has written it so far.',
  step: 'editText',
  batchable: true,
  input: z.strictObject({
    id: NodeId.describe('The text layer to edit.'),
    op: TextOp.describe(
      'The edit: insert text at an offset, delete a length from an offset, or set a style on a length from an offset.',
    ),
  }),
  check: ({ w, design }, { id, op }) => {
    const node = design.nodes[id]
    if (!node) return missingLayer(design, [id])
    if (node.type !== 'text') return `"${id}" is a ${node.type}, not a text layer`
    const locked = lockProblem(id, node, op.kind === 'style' ? 'style' : 'content')
    if (locked) return locked
    // The text as written so far: in a batch, earlier edits have changed it since `design` was read.
    const text = w.prop(id, 'text') as string
    const end = op.at + (op.kind === 'insert' ? 0 : op.length)
    if (end > text.length) return `the range ${op.at}–${end} runs past the end of the text (${text.length})`
    if (op.kind === 'insert' && LONE_HALF.test(op.text))
      return 'the inserted text holds half of a character written as two UTF-16 units'
    const split = [op.at, end].find((at) => splitsPair(text, at))
    if (split !== undefined)
      return `the offset ${split} falls inside a character written as two UTF-16 units, such as an emoji`
    return undefined
  },
  apply: ({ w }, { id, op }) => {
    w.editText(id, op)
  },
})

/**
 * Replaces every match of a string in text layers, whatever its case (FigCraft's find and replace).
 * The editor fits each text to its words after it, in the same undo step.
 */
export const textReplace = defineCommand({
  name: 'text.replace',
  description:
    'Replaces every match of `find`, matched whatever its case, in each text layer given with `replace`, which takes the style of the first character of what it replaces; an empty `replace` deletes each match. Its linked copies keep their own text. It refuses a missing layer, a layer that is not a text, one locked against content changes, and text holding half of a character written as two UTF-16 units.',
  step: 'editText',
  batchable: true,
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The text layers to replace in.'),
    find: z.string().min(1).describe('What to find, matched whatever its case.'),
    replace: z.string().describe('What each match becomes; empty deletes it.'),
  }),
  check: ({ design }, { ids, find, replace }) => {
    const missing = missingLayer(design, ids)
    if (missing) return missing
    for (const id of ids) {
      const node = design.nodes[id]
      if (node && node.type !== 'text') return `"${id}" is a ${node.type}, not a text layer`
      const locked = node && lockProblem(id, node, 'content')
      if (locked) return locked
    }
    if (LONE_HALF.test(find) || LONE_HALF.test(replace))
      return 'the text holds half of a character written as two UTF-16 units'
    return undefined
  },
  apply: ({ w }, { ids, find, replace }) => {
    for (const id of new Set(ids))
      for (const op of replaceOps(w.prop(id, 'text') as string, find, replace)) w.editText(id, op)
  },
})

/**
 * Sets the box of text that grows to the size it is drawn at (#47), as the caller measured it:
 * its width and height for auto width, its height for auto height. The box keeps its top left, or
 * its centre with `keep`. The editor runs it as text is typed, in the same undo step, so the box is
 * always where the words are. A fixed or auto height text a curve resizes keeps the box it had
 * straight (`straightBox`) until a fit of it straight takes that back.
 */
export const textFit = defineCommand({
  name: 'text.fit',
  description:
    'Sets the width and height of a text layer’s box to the size its words were measured at, both numbers whatever its box mode, keeping the box’s top left, or its centre with keep "centre". It refuses a missing layer and a layer that is not a text.',
  step: 'resize',
  batchable: true,
  input: z.strictObject({
    id: NodeId.describe('The text layer to fit.'),
    width: z.number().min(0).describe('The measured width of its words, in pixels.'),
    height: z.number().min(0).describe('The measured height of its words, in pixels.'),
    keep: z
      .enum(['topLeft', 'centre'])
      .optional()
      .describe('Which point of the box stays where it is as it resizes: its top left (the default) or its centre.'),
  }),
  check: ({ design }, { id }) => {
    const node = design.nodes[id]
    if (!node) return missingLayer(design, [id])
    if (node.type !== 'text') return `"${id}" is a ${node.type}, not a text layer`
    return undefined
  },
  apply: ({ w, design }, { id, width, height, keep }) => {
    const props = design.nodes[id]?.props as TextProps
    const resized = Math.abs(props.width - width) >= 0.005 || Math.abs(props.height - height) >= 0.005
    if (props.curve && props.boxMode !== 'autoWidth' && !props.straightBox && resized) {
      const em = props.style.fontSize
      w.setProp(id, 'straightBox', { width: props.width / em, height: props.height / em })
    } else if (!props.curve && props.straightBox) w.unsetProp(id, 'straightBox')
    const plan = boxPlan(design)
    const moved =
      keep === 'centre' ? { x: props.x + (props.width - width) / 2, y: props.y + (props.height - height) / 2 } : {}
    plan.set(id, { ...moved, width, height })
    plan.write(w)
  },
})
