// The imports from Figma the placing tests place, on a design of two pages, and what they read of the outcome.
import { NotSaved } from '@dazbee/doc'
import { type DesignInput, FigmaImport } from '@dazbee/schema'

import type { PlacedFigma } from './place-figma.ts'
import { DESIGN } from './test-actions.ts'

/** The actions' design with a second page, `p2`, holding a square frame of its own. */
export const PAGES: DesignInput = {
  ...DESIGN,
  pages: { ...DESIGN.pages, p2: { name: 'Two', order: 'a1' } },
  frames: {
    ...DESIGN.frames,
    'p2-sq': { pageId: 'p2', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
  },
}

/** A rectangle layer of an import's frame, by its key, holder and order. */
export const rect = (parentId: string, index: string, x = 10, y = 10) => ({
  type: 'graphic',
  parentId,
  link: `l-${index}`,
  index,
  name: 'Rect',
  props: { x, y, width: 40, height: 30, shape: { kind: 'rect' } },
})

/** A text layer of an import's frame whose box is `width` × `height` as Figma gave it. */
export const text = (parentId: string, index: string, boxMode: string, width = 10, height = 10) => ({
  type: 'text',
  parentId,
  link: `t-${index}`,
  index,
  name: 'Text',
  props: {
    x: 20,
    y: 20,
    width,
    height,
    text: 'Hello from Figma',
    boxMode,
    style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
  },
})

/** A frame of an import: its layers under keys made from Figma ids, each key's Figma id beside it. */
export const frame = (
  figmaId: string,
  x: number,
  y: number,
  layers: Record<string, unknown> | null,
  roots: string[] = [],
) => ({
  name: `Frame ${figmaId}`,
  figmaId,
  x,
  y,
  width: 400,
  height: 300,
  fills: [{ type: 'solid', color: '#FFCC00FF' }],
  layers: layers && { nodes: layers, roots },
  figmaIds: Object.fromEntries(Object.keys(layers ?? {}).map((key) => [key, key.replace('-', ':')])),
})

export const NO_REPORT = { fonts: [], items: [] }

/**
 * A file import of two pages: the first with two frames, one holding a group of a rectangle and an
 * autoWidth text; the second with a frame holding an autoHeight text and a fixed one.
 */
export const FILE = FigmaImport.parse({
  name: 'Brand file',
  target: 'pages',
  report: NO_REPORT,
  pages: [
    {
      name: 'Covers',
      figmaId: '0:1',
      frames: [
        frame(
          '1:1',
          -200,
          40,
          {
            '1-2': {
              ...rect('', 'a0'),
              type: 'group',
              parentId: 'root',
              name: 'Card',
              props: { x: 10, y: 10, width: 60, height: 50 },
            },
            '1-3': rect('1-2', 'a0'),
            '1-4': text('1-2', 'a1', 'autoWidth'),
          },
          ['1-2'],
        ),
        frame('1:5', 600, 40, null),
      ],
    },
    {
      name: 'Posts',
      figmaId: '0:2',
      frames: [
        frame(
          '2:1',
          0,
          0,
          { '2-2': text('root', 'a0', 'autoHeight', 300, 5), '2-3': text('root', 'a1', 'fixed', 77, 33) },
          ['2-2', '2-3'],
        ),
      ],
    },
  ],
})

/** A frame link's import: one frame onto the shown page, holding one rectangle. */
export const LINK = FigmaImport.parse({
  name: 'Brand file',
  target: 'shown-page',
  report: NO_REPORT,
  pages: [
    { name: 'Covers', figmaId: '0:1', frames: [frame('3:1', 5000, 5000, { '3-2': rect('root', 'a0') }, ['3-2'])] },
  ],
})

/** What placing gave, when it placed. */
export function placedOf(result: PlacedFigma) {
  if (!result.placed) throw new Error(`not placed: ${JSON.stringify(result)}`)
  return result
}

/** How `promise` has settled once the microtasks and timers waiting have run: 'saved', why it failed, or 'waiting'. */
export async function settled(promise: Promise<unknown>) {
  let state: unknown = 'waiting'
  promise.then(
    (value) => (state = value),
    (error: unknown) => (state = error instanceof NotSaved ? error.why : error),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return state
}
