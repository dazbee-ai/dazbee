import { describe, expect, it } from 'vitest'

import type { CanvasKit } from '@dazbee/canvaskit'
import { openSession } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { loadFontFiles } from '@dazbee/fonts/node'
import { variableTestFont } from '@dazbee/fonts/test-fonts'
import { resourceCache, type Scene } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type DesignInput, parseDesign } from '@dazbee/schema'

import { pageFrames } from '../canvas/frames.ts'
import { NO_FONTS } from '../font-loads.ts'
import { editorLayerEdits } from '../layer-edits.ts'
import { measure, testBoxes } from '../layers/test-boxes.ts'
import { type EditorResources, editorResources } from '../resources.ts'
import { editorSelection } from '../selection.ts'
import { COPIES, everyCopy } from '../test-actions.ts'
import { testCatalog } from '../test-catalog.ts'
import { testEditor } from '../test-editor.ts'
import { editorTextStyles } from './text-styles.ts'
import { editorTyping } from './typing.ts'

/** A text in a family, `y` down the square; Lobster has no bold weight. */
const text = (link: string, index: string, y: number, style: Record<string, unknown> = {}) => ({
  type: 'text' as const,
  parentId: 'sq',
  link,
  index,
  name: 'Words',
  props: {
    x: 10,
    y,
    width: 400,
    height: 40,
    text: 'Fresh roast',
    boxMode: 'fixed' as const,
    style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF', ...style },
  },
})
/** A square frame holding two Noto Sans texts, the second underlined, a Lobster text and a rectangle. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    headline: text('headline', 'a0', 10),
    body: text('body', 'a1', 100, { underline: true }),
    script: text('script', 'a2', 200, { fontFamily: 'Lobster' }),
    brand: text('brand', 'a4', 300, { fontFamily: 'Brand Sans' }),
    badge: {
      type: 'graphic',
      parentId: 'sq',
      link: 'badge',
      index: 'a3',
      name: 'Badge',
      props: { x: 600, y: 600, width: 100, height: 100, shape: { kind: 'rect' } },
    },
  },
}
/** The faces the editor has files for: Noto Sans upright in Regular, Bold and Extra Bold, Lobster in Regular only. */
const FACES = [
  { family: 'Noto Sans', weight: 400, style: 'normal' as const },
  { family: 'Noto Sans', weight: 700, style: 'normal' as const },
  { family: 'Noto Sans', weight: 800, style: 'normal' as const },
  { family: 'Lobster', weight: 400, style: 'normal' as const },
]
/** Resources that have the files of `FACES` already. */
const HAVING: Pick<EditorResources, 'bytes' | 'facesOf'> = {
  bytes: () => ({ fonts: [], fallbackFamilies: [], images: {} }),
  facesOf: (family) => FACES.filter((face) => face.family === family),
}

/** The text styles over a real session, selection, typing and layer edits, with the font files `resources` has. */
function harness(resources = HAVING) {
  const parsed = parseDesign(DESIGN)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const store = openTestStore(parsed.design)
  const session = openSession(store)
  const frames = pageFrames(session.design(), 'p1').frames
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const typing = editorTyping({
    ck: {} as CanvasKit,
    store,
    session,
    resources,
    scenes: {
      shownScene: () =>
        ({
          layers: Object.entries(session.design().nodes).map(([id, node]) => ({ ...node, id, children: [] })),
        }) as unknown as Scene,
      measure: () => measure,
      layout: () => {
        throw new Error('nothing is laid out in these tests')
      },
      laidOutLayer: () => undefined,
    },
    boxes,
    frameOf: (key) => frames.find((f) => f.id === key),
    hug: () => {},
    textSelectionChanged: () => {},
    shownChanged: () => {},
  })
  const done = new AbortController()
  const layerEdits = editorLayerEdits({
    session,
    selection,
    boxes,
    resources: { loadFamilies: (families) => families.map(() => Promise.resolve()) },
    typing,
    signal: done.signal,
  })
  const styles = editorTextStyles({ session, selection, resources, typing, layerEdits })
  /** A text layer's style, and the runs over its characters. */
  const styleOf = (id: string) => {
    const node = session.design().nodes[id]
    return node?.type === 'text' ? node.props.style : undefined
  }
  const runsOf = (id: string) => {
    const node = session.design().nodes[id]
    return node?.type === 'text' ? node.props.runs : undefined
  }
  const select = (...ids: string[]) => selection.select(ids, 'sq')
  return { styles, session, typing, select, styleOf, runsOf }
}

describe('editorTextStyles', () => {
  describe('perform', () => {
    it('toggles each style on one selected text layer, Bold to the weights its family has, each one undo step', () => {
      const { styles, session, select, styleOf } = harness()
      select('headline')
      expect(styles.perform('bold')).toBe(true)
      expect(styleOf('headline')?.fontWeight).toBe(700)
      styles.perform('italic')
      styles.perform('underline')
      styles.perform('strikethrough')
      expect(styleOf('headline')).toMatchObject({ fontStyle: 'italic', underline: true, strikethrough: true })
      styles.perform('bold')
      expect(styleOf('headline')?.fontWeight).toBe(400)
      // Five presses, five undo steps.
      session.undo()
      expect(styleOf('headline')?.fontWeight).toBe(700)
      session.undo()
      expect(styleOf('headline')?.strikethrough).toBeFalsy()
      session.redo()
      expect(styleOf('headline')?.strikethrough).toBe(true)
      for (let i = 0; i < 4; i++) session.undo()
      expect(styleOf('headline')).toMatchObject({ fontWeight: 400 })
      expect(styleOf('headline')?.fontStyle).not.toBe('italic')
      expect(session.canUndo()).toBe(false)
    })

    it('turns a style on across several text layers unless every one has it, as one undo step', () => {
      const { styles, session, select, styleOf } = harness()
      select('headline', 'body')
      styles.perform('underline')
      expect([styleOf('headline')?.underline, styleOf('body')?.underline]).toEqual([true, true])
      styles.perform('underline')
      expect([styleOf('headline')?.underline, styleOf('body')?.underline]).toEqual([false, false])
      session.undo()
      expect([styleOf('headline')?.underline, styleOf('body')?.underline]).toEqual([true, true])
      session.undo()
      expect([styleOf('headline')?.underline, styleOf('body')?.underline]).toEqual([undefined, true])
    })

    it('styles the text layers of a mixed selection, the rest left as they are, and does nothing without a text layer', () => {
      const { styles, session, select, styleOf } = harness()
      const badge = session.design().nodes.badge
      select('badge', 'headline')
      expect(styles.perform('bold')).toBe(true)
      expect(styleOf('headline')?.fontWeight).toBe(700)
      expect(session.design().nodes.badge).toEqual(badge)
      session.undo()
      select('badge')
      for (const toggle of ['bold', 'italic', 'underline', 'strikethrough'] as const)
        expect(styles.perform(toggle)).toBe(false)
      select()
      expect(styles.perform('bold')).toBe(false)
      expect(session.canUndo()).toBe(false)
    })

    it('writes no Bold where a family has no bold weight, alone or beside one that has, and still writes its other styles', () => {
      const { styles, session, select, styleOf } = harness()
      const before = session.design()
      select('script')
      styles.perform('bold')
      select('script', 'headline')
      styles.perform('bold')
      expect(session.design()).toEqual(before)
      expect(session.canUndo()).toBe(false)
      styles.perform('italic')
      expect([styleOf('script')?.fontStyle, styleOf('headline')?.fontStyle]).toEqual(['italic', 'italic'])
    })

    it('styles the selected range of the text being edited by the same rule, each key its own undo step', () => {
      const { styles, session, typing, select, runsOf } = harness()
      select('headline')
      typing.start('headline', 'sq', 0)
      typing.selectText({ start: 0, end: 5 })
      styles.perform('bold')
      expect(runsOf('headline')).toEqual([{ start: 0, end: 5, style: { fontWeight: 700 } }])
      styles.perform('underline')
      expect(runsOf('headline')).toEqual([{ start: 0, end: 5, style: { fontWeight: 700, underline: true } }])
      styles.perform('bold')
      expect(runsOf('headline')).toEqual([{ start: 0, end: 5, style: { fontWeight: 400, underline: true } }])
      typing.stop()
      session.undo()
      expect(runsOf('headline')).toEqual([{ start: 0, end: 5, style: { fontWeight: 700, underline: true } }])
      session.redo()
      expect(runsOf('headline')).toEqual([{ start: 0, end: 5, style: { fontWeight: 400, underline: true } }])
      session.undo()
      session.undo()
      session.undo()
      expect(runsOf('headline')).toEqual([])
    })

    it('writes no Bold over a range in a family with no bold weight', () => {
      const { styles, session, typing, select, runsOf } = harness()
      select('script')
      typing.start('script', 'sq', 0)
      typing.selectText({ start: 0, end: 5 })
      styles.perform('bold')
      typing.stop()
      expect(runsOf('script')).toEqual([])
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('state', () => {
    it('says which styles are on, mixed or off for the selected text layers, and greys Bold where a family has no weight for it', () => {
      const { styles, select } = harness()
      expect(styles.state()).toBeNull()
      select('headline', 'body', 'badge')
      expect(styles.state()).toEqual({
        bold: { on: false, disabled: false },
        italic: { on: false, disabled: false },
        underline: { on: 'mixed', disabled: false },
        strikethrough: { on: false, disabled: false },
      })
      select('script', 'headline')
      expect(styles.state()?.bold).toEqual({ on: false, disabled: true })
      select('badge')
      expect(styles.state()).toBeNull()
    })

    it('reads the selected range while one is being typed in', () => {
      const { styles, typing, select } = harness()
      select('headline')
      typing.start('headline', 'sq', 0)
      typing.selectText({ start: 0, end: 5 })
      styles.perform('bold')
      typing.selectText({ start: 3, end: 8 })
      expect(styles.state()?.bold).toEqual({ on: 'mixed', disabled: false })
    })
  })
})

describe('editorTextStyles over the editor’s resources', () => {
  it("lets Bold write once the catalog lists a family's weights, before any of their files arrives", async () => {
    const ck = await loadCanvasKit()
    const file = (name: string) => loadFontFiles().find((f) => f.file === name)?.bytes ?? new Uint8Array()
    const done = new AbortController()
    const catalog = testCatalog([
      { family: 'Brand Sans', weight: 400, bytes: file('NotoSans-Regular.ttf') },
      { family: 'Brand Sans', weight: 700, bytes: file('NotoSans-Bold.ttf') },
    ])
    const resources = editorResources({
      ck,
      cache: resourceCache(ck),
      first: { fonts: [], fallbackFamilies: [], images: {} },
      sources: catalog.sources,
      firstFonts: NO_FONTS,
      connected: () => true,
      status: () => {},
      signal: done.signal,
    })
    const { styles, select, styleOf } = harness(resources)
    select('brand')
    expect(resources.facesOf('Brand Sans')).toEqual([])
    expect(styles.state()?.bold).toEqual({ on: false, disabled: true })
    const told: boolean[] = []
    resources.onArrive((fonts) => told.push(fonts))
    await Promise.all(resources.loadFamilies(['Brand Sans']))
    expect(told).toEqual([])
    expect(catalog.fetched).toEqual([])
    expect(resources.facesOf('Brand Sans').map((f) => f.weight)).toEqual([400, 700])
    expect(styles.state()?.bold).toEqual({ on: false, disabled: false })
    styles.perform('bold')
    expect(styleOf('brand')?.fontWeight).toBe(700)
    resources.destroy()
    done.abort()
  })
  it('lets Bold write on a variable family, whose one file draws every weight in its range', async () => {
    const ck = await loadCanvasKit()
    const done = new AbortController()
    const resources = editorResources({
      ck,
      cache: resourceCache(ck),
      first: { fonts: [], fallbackFamilies: [], images: {} },
      sources: testCatalog([
        { family: 'Brand Sans', weight: 400, weights: { min: 100, max: 900 }, bytes: variableTestFont() },
      ]).sources,
      firstFonts: NO_FONTS,
      connected: () => true,
      status: () => {},
      signal: done.signal,
    })
    const { styles, select, styleOf } = harness(resources)
    select('brand')
    await Promise.all(resources.loadFamilies(['Brand Sans']))
    expect(resources.facesOf('Brand Sans')).toEqual([
      { family: 'Brand Sans', weight: 400, weights: { min: 100, max: 900 }, style: 'normal' },
    ])
    expect(styles.state()?.bold).toEqual({ on: false, disabled: false })
    styles.perform('bold')
    expect(styleOf('brand')?.fontWeight).toBe(700)
    styles.perform('bold')
    expect(styleOf('brand')?.fontWeight).toBe(400)
    resources.destroy()
    done.abort()
  })
})

describe('a font size set on every copy with setProps, each copy refitted', () => {
  it('fits each copy of a text to a size set on all of them in its own box mode, shrink to fit keeping its box', async () => {
    const { core, press, end } = await testEditor(COPIES)
    const copies = everyCopy('headline')
    /** Each copy's box as stored. */
    const boxes = () =>
      copies.map((id) => {
        const { x, y, width, height } = core.design().nodes[id]?.props as {
          x: number
          y: number
          width: number
          height: number
        }
        return { x, y, width, height }
      })
    /** Sets a font size on every copy with the patch the Text tab's size field sends: shrink to fit's largest size goes to it too. */
    const size = (fontSize: number) =>
      core.setProps(copies, (_, now) => ({
        style: { ...(now.style as object), fontSize },
        ...(now.shrinkToFit ? { shrinkToFit: { min: 10, max: fontSize } } : {}),
      }))
    core.setProps(['story-headline'], () => ({ boxMode: 'fixed' }))
    core.setProps(['wide-headline'], () => ({ boxMode: 'autoWidth' }))
    core.select(['headline'])
    press('selectLinkedCopies')
    expect(core.selection()).toEqual(copies)
    const [height, fixed, width] = boxes()
    expect(size(60)).toBe(true)
    const [tall, kept, wide] = boxes()
    // Auto height keeps its width and takes the words' height; fixed keeps its box; auto width takes the words' width.
    expect(tall?.width).toBe(height?.width)
    expect(tall?.height).toBeLessThan(height?.height ?? 0)
    expect(kept).toEqual(fixed)
    expect(wide?.width).toBeLessThan(width?.width ?? 0)
    expect(wide?.height).toBe(tall?.height)
    core.setProps(['story-headline'], () => ({ shrinkToFit: { min: 10, max: 60 } }))
    expect(size(200)).toBe(true)
    expect(boxes()[1]).toEqual(fixed)
    end()
  })
})
