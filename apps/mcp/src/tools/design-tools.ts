// The tools that open a design and read it: open_design opens the session's agent tab on a design, and the others
// read what that tab shows, the design as the editor holds it.
import { z } from 'zod'

import { childrenOf, compactTree, DEFAULT_TREE_BYTES } from '@dazbee/doc'
import { frameWarnings } from '@dazbee/export'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { brandRef, type Design, framesOf, Id, inOrder, RecordId } from '@dazbee/schema'

import { inMiB, MAX_TREE_BYTES, MIN_TREE_BYTES } from '../limits.ts'
import type { OpenDesign } from '../open-design.ts'
import { answerBytes, defineTool, type Tool, type ToolContext, ToolRefusal, WithNotes } from './define-tool.ts'

/** A frame's id, as read_design gives it. */
export const FrameId = Id.describe('The frame’s id, as read_design gives it')

export const DESIGN_TOOLS: Tool[] = [
  defineTool({
    name: 'open_design',
    title: 'Open a design',
    description:
      'Opens a brand’s design in this session’s agent tab, closing the one open before, and answers what read_design gives, with `mayEdit`: whether this agent may change it. One design is open at a time; the other design tools work on it.',
    readOnly: true,
    input: z.object({
      brand: RecordId.describe('The brand’s id, as list_brands gives it'),
      design: RecordId.describe('The design’s id, as list_designs gives it'),
    }),
    run: ({ brand, design }, { api, agent, design: session }) =>
      session.open(brand, design, { api, agent }, answered(designAnswer)),
  }),
  defineTool({
    name: 'read_design',
    title: 'Read the open design',
    description:
      'Gives the open design: its name, whether this agent may change it, its pages in order, each with its frames (id, name, width, height, and x and y on the page, in design pixels), the brand kit’s tokens (brand:<token>) with their values, and what happened to the design since the last answer, such as a change the server refused.',
    readOnly: true,
    input: z.object({}),
    run: (_input, context) => onDesign(context, designAnswer),
  }),
  defineTool({
    name: 'read_frame',
    title: 'Read a frame',
    description: `Gives a frame of the open design and the layers it holds, back to front, as a compact tree: each layer’s id, name, type, whether it shows, and a text’s first words. \`fields\` adds the props named, such as x, y, width, height, fills or role, to each layer that has them. Long lists of layers are cut to fit \`maxBytes\` (${DEFAULT_TREE_BYTES} unless given), and \`notShown\` says how many were left out; read_layer reads one layer in full.`,
    readOnly: true,
    input: z.object({
      frame: FrameId,
      fields: z.array(z.string().max(64)).max(100).optional().describe('Props to add to each layer that has them'),
      maxBytes: z
        .number()
        .int()
        .min(MIN_TREE_BYTES)
        .max(MAX_TREE_BYTES)
        .optional()
        .describe(
          `The most bytes the tree may take, ${MIN_TREE_BYTES} to ${MAX_TREE_BYTES} (${inMiB(MAX_TREE_BYTES)})`,
        ),
    }),
    run: ({ frame, fields, maxBytes }, context) =>
      onDesign(context, ({ tab }) => {
        const design = tab.design()
        frameOf(design, frame)
        return treeWithin(design, frame, fields ?? [], maxBytes ?? DEFAULT_TREE_BYTES)
      }),
  }),
  defineTool({
    name: 'read_layer',
    title: 'Read a layer',
    description:
      'Gives one layer of the open design in full, as the design holds it: its type, name, frame or layer it is in, its props and bindings, with `children`, the ids of the layers it holds, back to front. A frame’s id gives the frame’s record and its layers’ ids.',
    readOnly: true,
    input: z.object({ id: Id.describe('The layer’s or frame’s id, as read_frame gives it') }),
    run: ({ id }, context) =>
      onDesign(context, ({ tab }) => {
        const design = tab.design()
        const children = childrenOf(design, id).map(([child]) => child)
        const layer = Object.hasOwn(design.nodes, id) ? design.nodes[id] : undefined
        if (layer) return { id, ...layer, children }
        const frame = Object.hasOwn(design.frames, id) ? design.frames[id] : undefined
        if (frame) return { id, type: 'frame', ...frame, children }
        throw new ToolRefusal(`The open design has no layer or frame “${id}”; read_frame lists a frame’s layers`)
      }),
  }),
  defineTool({
    name: 'check_frame',
    title: 'Check a frame',
    description:
      'Lists what in a frame of the open design won’t look as designed, each a sentence about one layer with its id and kind: a font with no file, characters no font has, text that overflows its fixed box or passes its line limit, a layer wholly outside the frame, or text inside a platform’s safe-zone edge on a 9:16 frame. Fix these before saying a frame is done.',
    readOnly: true,
    input: z.object({ frame: FrameId }),
    run: ({ frame }, context) =>
      onDesign(context, async ({ tab }) => {
        frameOf(tab.design(), frame)
        await tab.fontsLoaded()
        return frameWarnings(await loadCanvasKit(), tab.design(), frame, tab.bytes(), { cache: tab.cache })
      }),
  }),
]

/** Runs `read` on the session's open design, answering what it gives with the design's notes. */
export function onDesign({ api, agent, design }: ToolContext, read: (open: OpenDesign) => unknown): Promise<unknown> {
  return design.use({ api, agent }, answered(read))
}

/** Refuses a frame the design doesn't have. */
export function frameOf(design: Design, frameId: string) {
  if (!Object.hasOwn(design.frames, frameId))
    throw new ToolRefusal(`The open design has no frame “${frameId}”; read_design lists its frames`)
}

/** `read`, its answer given with the design's notes after it, when there are any. */
function answered(read: (open: OpenDesign) => unknown) {
  return async (open: OpenDesign) => {
    const value = await read(open)
    return open.notes.length > 0 ? new WithNotes(value, open.notes) : value
  }
}

/** What read_design answers: the design's name, whether the tab may edit, its pages and frames, the kit's tokens and the tab's notices. */
function designAnswer({ tab, name, kit }: OpenDesign) {
  const design = tab.design()
  return {
    name,
    mayEdit: !tab.readOnly(),
    pages: inOrder(design.pages).map(([id, page]) => ({
      id,
      name: page.name,
      frames: framesOf(design, id).map(([frameId, frame]) => ({
        id: frameId,
        name: frame.name,
        width: frame.width,
        height: frame.height,
        x: frame.x,
        y: frame.y,
      })),
    })),
    tokens: [
      ...kit.colors.map((color) => ({ token: brandRef(color.token), name: color.name, value: color.value })),
      ...kit.fonts.map((font) => ({ token: brandRef(font.token), name: font.name, value: font.family })),
    ],
    notices: tab.takeNotices().map(([notice, detail]) => ({ notice, ...detail })),
  }
}

/**
 * The frame's compact tree in `maxBytes`, cut further where its JSON, written as the answer's text, would pass
 * what an answer may hold. A field no layer has is refused.
 */
function treeWithin(design: Design, frameId: string, fields: readonly string[], maxBytes: number) {
  for (let budget = maxBytes; ;) {
    let tree
    try {
      tree = compactTree(design, frameId, { fields, maxBytes: budget })
    } catch (error) {
      throw new ToolRefusal(error instanceof Error ? error.message : String(error))
    }
    const bytes = answerBytes(JSON.stringify(tree))
    if (bytes <= MAX_TREE_BYTES || budget <= MIN_TREE_BYTES) return tree
    budget = Math.max(MIN_TREE_BYTES, Math.floor((budget * MAX_TREE_BYTES) / bytes) - 1)
  }
}
