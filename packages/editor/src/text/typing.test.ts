import { describe, expect, it } from 'vitest'

import type { CanvasKit } from '@dazbee/canvaskit'
import { openSession } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { loadFontFiles } from '@dazbee/fonts/node'
import { caretPosition, makeResources, type Scene, selectionBoxes, type TextLayout } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type DesignInput, parseDesign } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import { frameScenes } from '../canvas/scenes.ts'
import { keyInput } from '../gestures/test-inputs.ts'
import type { EditorResources, ResourceSources } from '../resources.ts'
import { shippedOnly, testCatalog } from '../test-catalog.ts'
import { testEditor } from '../test-editor.ts'
import type { RunStyle } from './text-edit.ts'
import { editorTyping, type TypingDeps } from './typing.ts'

const STYLE = { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' }
const TITLE = { x: 10, y: 10, width: 200, height: 40, text: 'Hello', boxMode: 'fixed' as const, style: STYLE }
const LABEL = { x: 10, y: 80, width: 20, height: 24, text: 'Hi', boxMode: 'autoWidth' as const, style: STYLE }
/**
 * One page with a square frame and a wide one, each with its copy of a text in a fixed box and of
 * one that grows with its words, twice as big in the wide frame.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    title: { type: 'text', parentId: 'sq', link: 'title', index: 'a0', name: 'Title', props: TITLE },
    label: { type: 'text', parentId: 'sq', link: 'label', index: 'a1', name: 'Label', props: LABEL },
    'wide-title': { type: 'text', parentId: 'wide', link: 'title', index: 'a0', name: 'Title', props: TITLE },
    'wide-label': {
      type: 'text',
      parentId: 'wide',
      link: 'label',
      index: 'a1',
      name: 'Label',
      props: { ...LABEL, style: { ...STYLE, fontSize: 40 } },
    },
  },
}
const FRAMES: Frame[] = [
  { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 },
  { id: 'wide', pageId: 'p1', name: 'Wide', x: 1280, y: 0, width: 1200, height: 628 },
]

/** A key as the keyboard sends it, which records whether the editor took it. */
function keyEvent(key: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {}) {
  return keyInput('', { key, ctrlKey: mods.mod ?? false, shiftKey: mods.shift ?? false, altKey: mods.alt ?? false })
}

/** Typing over the design on a real session, its scenes the document's layers, logging what it tells. */
function harness() {
  const parsed = parseDesign(DESIGN)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const store = openTestStore(parsed.design)
  const session = openSession(store)
  const log: string[] = []
  const deps: TypingDeps = {
    ck: {} as CanvasKit,
    store,
    session,
    resources: { bytes: () => ({ fonts: [], fallbackFamilies: [], images: {} }) },
    scenes: {
      shownScene: () =>
        ({
          layers: Object.entries(session.design().nodes).map(([id, node]) => ({ ...node, id, children: [] })),
        }) as unknown as Scene,
      // Half the font size a character, a line 1.2 times it.
      measure: () => (props) => ({
        width: (props.text.length * props.style.fontSize) / 2,
        height: props.style.fontSize * 1.2,
      }),
      // No paragraphs: the arrows step in reading order, and nothing else here reads the layout.
      layout: () => ({ blocks: [] }) as unknown as TextLayout,
      // Nothing is composed in these tests.
      laidOutLayer: () => undefined,
    },
    // Nothing is laid out in these tests, so no box holds a layer in a flow.
    boxes: { drawnHolders: () => undefined },
    frameOf: (key) => FRAMES.find((f) => f.id === key),
    hug: (ids) => log.push(`hug ${ids.join(',')}`),
    textSelectionChanged: () => log.push('text selection'),
    shownChanged: () => log.push('draw'),
  }
  const typing = editorTyping(deps)
  const textOf = (id: string) => {
    const node = session.design().nodes[id]
    return node?.type === 'text' ? node.props.text : undefined
  }
  /** Presses keys in turn. */
  const type = (...keys: string[]) => keys.map((key) => typing.key(keyEvent(key)))
  return { typing, session, log, textOf, type }
}

/** A family the app does not ship, whose files are the shipped extra bold Noto Sans, wider than the regular. */
const LATE_FAMILY = 'Brand Sans'
/** One line of text in a family, in a box wider than its words. */
const headline = (fontFamily: string): DesignInput => ({
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    headline: {
      type: 'text',
      parentId: 'sq',
      link: 'headline',
      index: 'a0',
      name: 'Headline',
      props: {
        x: 80,
        y: 100,
        width: 920,
        height: 160,
        text: 'Fresh roast',
        style: { fontFamily, fontSize: 96, fontWeight: 400, color: '#15121AFF' },
      },
    },
  },
})
/** The files of the late family, as a font source gives them. */
const lateBytes = () => loadFontFiles().find((f) => f.file === 'NotoSans-ExtraBold.ttf')?.bytes ?? new Uint8Array()

describe('editorTyping', () => {
  it('types into nothing until typing starts', () => {
    const { typing, log } = harness()
    expect(typing.editing()).toBeNull()
    expect(typing.selectedText()).toBeNull()
    expect(typing.selectionStyles()).toBeNull()
    expect(typing.styleSelectedText({ fontWeight: 700 })).toBe(false)
    expect(log).toEqual([])
  })

  describe('start and stop', () => {
    it('starts typing into a text layer in a frame, and tells the text selection listeners', () => {
      const { typing, log } = harness()
      typing.start('title', 'sq', 2)
      expect(typing.editing()).toMatchObject({ id: 'title', frameId: 'sq' })
      // The caret alone selects nothing.
      expect(typing.selectedText()).toBeNull()
      expect(log).toEqual(['text selection'])
      typing.stop()
      expect(typing.editing()).toBeNull()
      expect(log).toEqual(['text selection', 'text selection'])
    })

    it('makes everything typed until typing stops one undo step', () => {
      const { typing, session, textOf, type } = harness()
      typing.start('title', 'sq', 5)
      type('!', '!', '?')
      expect(textOf('title')).toBe('Hello!!?')
      typing.stop()
      session.undo()
      expect(textOf('title')).toBe('Hello')
      expect(session.canUndo()).toBe(false)
    })

    it('takes away an empty text the text tool made, in the same undo step, and keeps any other', () => {
      const { typing, session, textOf } = harness()
      const { end } = session.beginGesture()
      const id = session.run('node.create', {
        parentId: 'sq',
        layer: { type: 'text', name: 'New', props: { x: 0, y: 0, width: 100, height: 24, text: '', style: STYLE } },
      })
      typing.start(id, 'sq', 0, end, true)
      typing.stop()
      expect(session.design().nodes[id]).toBeUndefined()
      session.run('text.edit', { id: 'title', op: { kind: 'delete', at: 0, length: 5 } })
      typing.start('title', 'sq', 0)
      typing.stop()
      expect(textOf('title')).toBe('')
    })

    it('keeps an empty text the text tool made out of the steps a pause ends, and ends them once it holds a word (C47)', () => {
      const { typing, session, textOf, type } = harness()
      const { end } = session.beginGesture()
      const id = session.run('node.create', {
        parentId: 'sq',
        layer: { type: 'text', name: 'New', props: { x: 0, y: 0, width: 100, height: 24, text: '', style: STYLE } },
      })
      typing.start(id, 'sq', 0, end, true)
      typing.pause()
      type('H', 'i')
      typing.pause()
      type('!')
      typing.stop()
      session.undo()
      expect(textOf(id)).toBe('Hi')
      session.undo()
      expect(session.design().nodes[id]).toBeUndefined()
    })

    it('stops when the text being edited is gone, and not while it is there', () => {
      const { typing, session } = harness()
      typing.start('title', 'sq', 0)
      typing.stopWhenGone()
      expect(typing.editing()).not.toBeNull()
      session.run('node.delete', { ids: ['title'] })
      typing.stopWhenGone()
      expect(typing.editing()).toBeNull()
    })

    it('stops when the frame typed in is gone', () => {
      const { typing } = harness()
      typing.start('title', 'story', 0)
      typing.stopWhenGone()
      expect(typing.editing()).toBeNull()
    })
  })

  describe('the caret and the range', () => {
    it('selects a range, which a caret moved with extend changes and one moved without lets go', () => {
      const { typing, log } = harness()
      typing.start('title', 'sq', 0)
      typing.selectText({ start: 1, end: 4 })
      expect(typing.selectedText()).toEqual({ id: 'title', range: { start: 1, end: 4 } })
      typing.caretTo(2, true)
      expect(typing.selectedText()).toEqual({ id: 'title', range: { start: 1, end: 2 } })
      typing.caretTo(3)
      expect(typing.selectedText()).toBeNull()
      expect(log.filter((l) => l === 'text selection')).toHaveLength(4)
    })

    it('follows edits made elsewhere in the text', () => {
      const { typing, session } = harness()
      typing.start('title', 'sq', 0)
      typing.selectText({ start: 1, end: 3 })
      session.run('text.edit', { id: 'title', op: { kind: 'insert', at: 0, text: 'Oh ' } })
      expect(typing.selectedText()).toEqual({ id: 'title', range: { start: 4, end: 6 } })
    })

    it("reads each character's style in the range of the layer typed into, not its copy's", () => {
      const { typing, session } = harness()
      session.run('node.update', { ids: ['wide-title'], patch: { style: { ...STYLE, fontSize: 30 } } })
      typing.start('wide-title', 'wide', 0)
      typing.selectText({ start: 0, end: 2 })
      expect(typing.selectionStyles()?.map((s) => s.fontSize)).toEqual([30, 30])
      typing.start('title', 'sq', 0)
      typing.selectText({ start: 0, end: 2 })
      expect(typing.selectionStyles()?.map((s) => s.fontSize)).toEqual([20, 20])
    })
  })

  describe('styleRange', () => {
    it('styles a range as one undo step of its own, between the typing before and after it', () => {
      const { typing, session, textOf, type } = harness()
      typing.start('title', 'sq', 5)
      type('!')
      typing.selectText({ start: 0, end: 2 })
      expect(typing.styleSelectedText({ fontWeight: 700 })).toBe(true)
      typing.caretTo(6)
      type('?')
      typing.stop()
      const weights = () => {
        const node = session.design().nodes.title
        return node?.type === 'text' ? node.props.runs.map((r) => r.style.fontWeight) : []
      }
      expect(textOf('title')).toBe('Hello!?')
      expect(weights()).toEqual([700])
      session.undo()
      expect(textOf('title')).toBe('Hello!')
      expect(weights()).toEqual([700])
      session.undo()
      expect(weights()).toEqual([])
      session.undo()
      expect(textOf('title')).toBe('Hello')
    })

    it('names the step of a styled range style, as on a layer, inside a step opened while typing too', () => {
      const { typing, session, type } = harness()
      typing.start('title', 'sq', 5)
      type('!')
      typing.selectText({ start: 0, end: 2 })
      session.gesture('style', () => typing.styleSelectedText({ fontWeight: 700 }))
      expect(session.undoName()).toBe('style')
      typing.stop()
      typing.styleRange({ id: 'title', range: { start: 0, end: 1 } }, { fontStyle: 'italic' })
      expect(session.undoName()).toBe('style')
    })

    it('styles a text that is not being typed into, and changes nothing with no style', () => {
      const { typing, session, log } = harness()
      // A panel can leave a key it doesn't set undefined.
      const unset = { fontWeight: undefined } as unknown as RunStyle
      typing.styleRange({ id: 'title', range: { start: 0, end: 1 } }, unset)
      expect(session.canUndo()).toBe(false)
      expect(log).toEqual([])
      typing.styleRange({ id: 'title', range: { start: 0, end: 1 } }, { fontWeight: 700 })
      expect(session.canUndo()).toBe(true)
      expect(log).toEqual(['draw'])
    })
  })

  describe('fitText', () => {
    it('sizes text that grows with its words, and the groups around it; its copy keeps its own size', () => {
      const { typing, session, log } = harness()
      session.run('text.edit', { id: 'label', op: { kind: 'insert', at: 2, text: '!' } })
      typing.fitText('label')
      const design = session.design()
      expect(design.nodes.label?.props).toMatchObject({ width: 30, height: 24 })
      expect(design.nodes['wide-label']?.props).toMatchObject({ width: 20, height: 24 })
      expect(log).toEqual(['hug label'])
    })

    it('sizes the copy in its own style, and leaves a fixed box be', () => {
      const { typing, session, log } = harness()
      typing.fitText('wide-label')
      expect(session.design().nodes['wide-label']?.props).toMatchObject({ width: 40, height: 48 })
      expect(session.design().nodes.label?.props).toMatchObject({ width: 20, height: 24 })
      typing.fitText('title')
      expect(log).toEqual(['hug wide-label'])
    })
  })

  describe('key', () => {
    it('types at the caret, deletes either side of it, and breaks lines', () => {
      const { typing, textOf, type } = harness()
      typing.start('title', 'sq', 5)
      type('!')
      expect(textOf('title')).toBe('Hello!')
      type('Backspace', 'Backspace')
      expect(textOf('title')).toBe('Hell')
      typing.caretTo(0)
      type('Delete', 'Enter')
      expect(textOf('title')).toBe('\nell')
    })

    it('moves the caret by a character, Shift extending the range, and to the near end of a range', () => {
      const { typing, type } = harness()
      typing.start('title', 'sq', 2)
      typing.key(keyEvent('ArrowRight', { shift: true }))
      typing.key(keyEvent('ArrowRight', { shift: true }))
      expect(typing.selectedText()?.range).toEqual({ start: 2, end: 4 })
      type('ArrowLeft')
      expect(typing.selectedText()).toBeNull()
      typing.key(keyEvent('ArrowLeft', { shift: true }))
      expect(typing.selectedText()?.range).toEqual({ start: 1, end: 2 })
    })

    it('moves and deletes a word at a time with Ctrl, or Alt as on a Mac, Shift extending the range by words', () => {
      const { typing, textOf, type } = harness()
      const press = (key: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean }) =>
        typing.key(keyEvent(key, mods))
      typing.start('title', 'sq', 5)
      type(' ', 'b', 'i', 'g', ' ', 's', 'a', 'l', 'e')
      press('Backspace', { mod: true })
      expect(textOf('title')).toBe('Hello big ')
      press('ArrowLeft', { mod: true })
      press('ArrowLeft', { alt: true })
      expect(typing.selectedText()).toBeNull()
      press('ArrowRight', { mod: true, shift: true })
      press('ArrowRight', { alt: true, shift: true })
      expect(typing.selectedText()?.range).toEqual({ start: 0, end: 9 })
      // From the caret, at the range's end: back to the start of the word before it.
      press('ArrowLeft', { mod: true })
      expect(typing.selectedText()).toBeNull()
      press('Delete', { alt: true })
      expect(textOf('title')).toBe('Hello  ')
      press('Backspace', { alt: true })
      expect(textOf('title')).toBe(' ')
    })

    it('selects all with Mod+A, and typing replaces the range', () => {
      const { typing, textOf, type } = harness()
      typing.start('title', 'sq', 0)
      typing.key(keyEvent('a', { mod: true }))
      expect(typing.selectedText()?.range).toEqual({ start: 0, end: 5 })
      type('X')
      expect(textOf('title')).toBe('X')
      expect(typing.selectedText()).toBeNull()
    })

    it('fits the text after a key that changed it, then draws; leaves the page its other keys', () => {
      const { typing, textOf, log } = harness()
      typing.start('label', 'sq', 2)
      expect(typing.key(keyEvent('!'))).toBe(true)
      expect(textOf('label')).toBe('Hi!')
      expect(log.slice(-2)).toEqual(['hug label', 'draw'])
      expect(typing.key(keyEvent('c', { mod: true }))).toBe(false)
    })

    it('stops typing with Escape', () => {
      const { typing, type } = harness()
      typing.start('title', 'sq', 0)
      type('Escape')
      expect(typing.editing()).toBeNull()
    })
  })

  describe('copy, cut and paste', () => {
    it('gives the range as a payload of plain text, and none with a caret alone or while nothing is typed in', () => {
      const { typing } = harness()
      expect(typing.copy()).toBeNull()
      typing.start('title', 'sq', 1)
      expect(typing.copy()).toBeNull()
      typing.selectText({ start: 1, end: 4 })
      expect(typing.copy()).toEqual({ text: 'ell' })
    })

    it('cuts the range, giving it as a payload of plain text, the caret where it was; nothing with a caret alone', () => {
      const { typing, textOf, type } = harness()
      expect(typing.cut()).toBeNull()
      typing.start('title', 'sq', 1)
      expect(typing.cut()).toBeNull()
      expect(textOf('title')).toBe('Hello')
      typing.selectText({ start: 1, end: 4 })
      expect(typing.cut()).toEqual({ text: 'ell' })
      expect(textOf('title')).toBe('Ho')
      type('i')
      expect(textOf('title')).toBe('Hio')
    })

    it('pastes a payload’s plain text over the range, its line breaks as paragraphs, and says it took it', () => {
      const { typing, textOf, type } = harness()
      expect(typing.paste({ text: 'A' })).toBe(false)
      typing.start('title', 'sq', 0)
      typing.selectText({ start: 0, end: 4 })
      expect(typing.paste({ text: 'A\r\nB' })).toBe(true)
      expect(textOf('title')).toBe('A\nBo')
      type('!')
      expect(textOf('title')).toBe('A\nB!o')
    })

    it('leaves a payload with no plain text untaken, the text as it was', () => {
      const { typing, textOf } = harness()
      typing.start('title', 'sq', 0)
      typing.selectText({ start: 0, end: 4 })
      expect(typing.paste({ data: { 'image/svg+xml': '<svg/>' } }) || typing.paste({ text: '' })).toBe(false)
      expect(textOf('title')).toBe('Hello')
    })
  })
})

describe('editorTyping over text laid out with a font', () => {
  /** Typing over the design with its scenes laid out by CanvasKit in Noto Sans, as the screen lays them out. */
  async function laidOut() {
    const ck = await loadCanvasKit()
    const parsed = parseDesign(DESIGN)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const store = openTestStore(parsed.design)
    const session = openSession(store)
    const bytes = loadFontFiles().find((f) => f.file === 'NotoSans-Regular.ttf')?.bytes ?? new Uint8Array()
    const decoded = makeResources(ck, {
      fonts: [{ family: 'Noto Sans', bytes }],
      fallbackFamilies: ['Noto Sans'],
      images: {},
    })
    const resources = {
      resources: () => decoded,
      bytes: () => ({ fonts: [], fallbackFamilies: [], images: {} }),
      alpha: () => undefined,
      onArrive: () => () => true,
    } as unknown as EditorResources
    const scenes = frameScenes({ ck, resources, drawn: () => session.design(), changes: () => session.changes() })
    const typing = editorTyping({
      ck,
      store,
      session,
      resources,
      scenes,
      boxes: { drawnHolders: () => undefined },
      frameOf: (key) => FRAMES.find((f) => f.id === key),
      hug: () => {},
      textSelectionChanged: () => {},
      shownChanged: () => {},
    })
    return { ck, typing, laid: scenes.layout(parsed.design.nodes.title?.props as never) }
  }

  describe('shown', () => {
    it('shows the caret where the family puts it once its files arrive after the text was drawn, the arrival asking for the redraw', async () => {
      /** Opens the headline in a family, types into it with the caret after its last word, and gives the caret's left. */
      const typedAtEnd = async (fontFamily: string, sources: ResourceSources) => {
        const editor = await testEditor(headline(fontFamily), { sources })
        editor.core.select(['headline'])
        editor.press('goIn')
        editor.keys.press('End')
        return { editor, caretX: () => editor.modules.typing.shown()?.caret?.x }
      }
      // Where the caret ends in the family when its files were there from the start.
      const there = await typedAtEnd(LATE_FAMILY, testCatalog([{ family: LATE_FAMILY, bytes: lateBytes() }]).sources)
      const inFamily = there.caretX()
      there.editor.end()

      // The family's files are held back: the redraw that asks for them draws the text without them.
      let release = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      const catalog = testCatalog([{ family: LATE_FAMILY, bytes: lateBytes() }])
      const asked: string[][] = []
      const fontFaces = async (families: string[]) => {
        if (shippedOnly(families)) return []
        asked.push(families)
        await held
        return catalog.sources.fontFaces(families)
      }
      const { editor, caretX } = await typedAtEnd('Noto Sans', { ...catalog.sources, fontFaces })
      const { core, modules } = editor
      expect(caretX()).toBeGreaterThan(0)
      expect(caretX()).not.toBe(inFamily)
      const style = { fontFamily: LATE_FAMILY, fontSize: 96, fontWeight: 400, color: '#15121AFF' }
      core.session.run('node.update', { ids: ['headline'], patch: { style } })
      core.redraw()
      expect(asked).toEqual([[LATE_FAMILY]])
      expect(caretX()).not.toBe(inFamily)

      // They arrive: a redraw is asked for though nothing was pressed, and it puts the caret where the family does.
      const redraws: string[] = []
      modules.view.onRedraw(() => redraws.push('redraw'))
      release()
      await held
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(redraws).toEqual(['redraw'])
      core.redraw()
      expect(caretX()).toBe(inFamily)
      editor.end()
    })

    it('shows nothing until typing starts', async () => {
      const { typing } = await laidOut()
      expect(typing.shown()).toBeNull()
    })

    it("shows the caret where the text's layout puts its offset, in the frame's design pixels, and no range", async () => {
      const { ck, typing, laid } = await laidOut()
      typing.start('title', 'sq', 2)
      const at = caretPosition(ck, laid, 2)
      expect(at.x).toBeGreaterThan(0)
      expect(typing.shown()).toEqual({
        frame: FRAMES[0],
        range: [],
        caret: { x: TITLE.x + at.x, y: TITLE.y + laid.dy + at.y, height: at.height },
      })
    })

    it('shows the selected range as its boxes, and no caret', async () => {
      const { ck, typing, laid } = await laidOut()
      typing.start('title', 'sq', 0)
      typing.selectText({ start: 1, end: 4 })
      const boxes = selectionBoxes(ck, laid, 1, 4)
      expect(boxes[0]?.width).toBeGreaterThan(0)
      expect(typing.shown()).toEqual({
        frame: FRAMES[0],
        range: boxes.map((box) => ({
          x: TITLE.x + box.x,
          y: TITLE.y + laid.dy + box.y,
          width: box.width,
          height: box.height,
        })),
        caret: null,
      })
    })
  })
})
