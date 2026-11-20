// A composition in the text being edited, driven through the editor's input as the stage field
// drives it: drawn in the frame's picture but never written, sent or undone, and its commit typed
// in as one edit in the typing step.
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesignInput, Member } from '@dazbee/schema'

import { openTab } from '../open-tab.ts'
import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'
import { type MemorySync, memorySync } from '../test-link.ts'
import type { FieldState } from './field-change.ts'
import { TYPING_PAUSE_MS } from './typing.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const BOB: Member = { userId: 'bob', workspaceId: 'w1' }

let mem: MemorySync
const editors: TestEditor[] = []
const closing: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const e of editors.splice(0)) e.end()
  for (const close of closing.splice(0)) await close()
})

/** An editor on a tab of the server in memory, as Ann or Bob. */
async function editorOn(token: 'ann' | 'bob' = 'ann') {
  const tab = await openTab({
    designId: 'd',
    member: token === 'ann' ? ANN : BOB,
    url: 'ws://s',
    token: () => Promise.resolve(token),
    socket: mem.socket,
    random: () => 0,
  })
  closing.push(() => tab.close())
  const editor = await testEditor(WORDS, { tab })
  editors.push(editor)
  return editor
}

/** Lets every message on its way land, and what it set going run. */
async function settle() {
  for (let n = 0; n < 5; n++) {
    await mem.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Waits past the time a tab sends its open step's preview in. */
async function previewsLand() {
  await new Promise((resolve) => setTimeout(resolve, 80))
  await settle()
}

const textOf = (e: TestEditor, id = 'words') => (e.core.design().nodes[id]?.props as { text: string }).text

/** Goes into the words with the caret at their end. */
function typingAtEnd(e: TestEditor) {
  e.core.select(['words'])
  e.press('goIn')
  e.keys.press('End')
}

/**
 * The field as an input method leaves it, from what it was given: `composed` in place of its
 * selection, the field's caret after it.
 */
function composedIn(given: FieldState, composed: string): FieldState {
  const value = given.value.slice(0, given.start) + composed + given.value.slice(given.end)
  const caret = given.start + composed.length
  return { value, start: caret, end: caret }
}

/**
 * Composes each of `steps` in turn into what the field was given, as an input method does, and
 * commits `commit` (cancels with ''), drawing after each; gives what the field then holds.
 */
function compose(e: TestEditor, given: FieldState, steps: string[], commit: string) {
  for (const typed of steps) {
    e.core.input.fieldChanged(composedIn(given, typed), typed)
    e.core.redraw()
  }
  const held = composedIn(given, commit)
  e.core.input.fieldChanged(held, null)
  e.core.redraw()
  return held
}

/** The field's text for the text being edited, as the stage field takes it; with `start`, typing starts at the words' end first. */
function fieldOf(e: TestEditor, start = false) {
  if (start) typingAtEnd(e)
  const given = e.core.input.fieldText()
  if (!given) throw new Error('no text is edited')
  return given
}

/** The text of a layer as the frame's picture draws it now. */
const drawnText = (e: TestEditor, id = 'words') =>
  (e.modules.view.previewed().nodes[id]?.props as { text: string }).text

/** What a tab sent its server of the kinds given. */
const sentOf = (kinds: string[]) => mem.sockets.flatMap((s) => s.sent).filter((message) => kinds.includes(message.type))

describe('a composition', () => {
  it('writes, sends and undoes nothing while composing, and types its commit once', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob')
    const given = fieldOf(a, true)
    await settle()
    const sentBefore = sentOf(['changes', 'preview']).length
    const design = a.core.session.design()
    const changes = a.core.session.changes()
    for (const typed of ['n', 'ni', 'nih', 'niha', 'nihao']) {
      expect(a.core.input.fieldChanged(composedIn(given, typed), typed)).toBe(true)
      a.core.redraw()
    }
    expect(a.core.session.design()).toBe(design)
    expect(a.core.session.changes()).toBe(changes)
    expect(a.core.session.canUndo()).toBe(false)
    await previewsLand()
    expect(sentOf(['changes', 'preview'])).toHaveLength(sentBefore)
    expect(textOf(b)).toBe('Hello there')

    a.core.input.fieldChanged(composedIn(given, '你好'), null)
    // A late end of the same composition types nothing more.
    a.core.input.fieldChanged(composedIn(given, '你好'), null)
    expect(textOf(a)).toBe('Hello there你好')
    a.keys.press('Escape')
    await settle()
    expect(textOf(b)).toBe('Hello there你好')
  })

  it('is drawn in the frame’s picture while composing, and then as written', async () => {
    const e = await testEditor(WORDS)
    editors.push(e)
    const given = fieldOf(e, true)
    e.core.input.fieldChanged(composedIn(given, 'nihao'), 'nihao')
    e.core.redraw()
    expect(drawnText(e)).toBe('Hello therenihao')
    expect(e.modules.view.previewedFrames()).toEqual(new Set(['sq']))
    expect(e.modules.view.design()).toBe(e.core.session.design())
    compose(e, given, [], '你好')
    expect(drawnText(e)).toBe('Hello there你好')
    expect(e.modules.view.previewed()).toBe(e.modules.view.design())
  })

  it('draws nothing more once the input method empties it at the caret', async () => {
    const e = await testEditor(WORDS)
    editors.push(e)
    const given = fieldOf(e, true)
    e.core.input.fieldChanged(composedIn(given, 'n'), 'n')
    e.core.redraw()
    e.core.input.fieldChanged(composedIn(given, ''), '')
    e.core.redraw()
    expect(drawnText(e)).toBe('Hello there')
    expect(e.modules.typing.shown()?.composition).toBeUndefined()
  })

  it('types what the field takes in at the caret a key or an arrow moved it to since', async () => {
    const e = await testEditor(WORDS)
    editors.push(e)
    const given = fieldOf(e, true)
    e.keys.press('Home')
    e.core.input.fieldChanged(composedIn(given, 'x'), null)
    expect(textOf(e)).toBe('xHello there')
    e.keys.press('End')
    e.core.input.fieldChanged(composedIn(given, 'xy'), null)
    expect(textOf(e)).toBe('xHello therey')
  })

  describe('in the typing step', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('makes commits and keys inside the pause one undo step, and a pause while composing writes nothing', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const e = await testEditor(WORDS)
      editors.push(e)
      const { session } = e.core
      compose(e, fieldOf(e, true), ['ni'], '你')
      e.keys.press('!')
      compose(e, fieldOf(e), ['hao'], '好')
      compose(e, fieldOf(e), ['ma'], '吗')
      e.keys.press('?')
      const given = fieldOf(e)
      e.core.input.fieldChanged(composedIn(given, 'a'), 'a')
      const changes = session.changes()
      vi.advanceTimersByTime(TYPING_PAUSE_MS)
      expect(session.changes()).toBe(changes)
      compose(e, given, ['a'], '啊')
      expect(textOf(e)).toBe('Hello there你!好吗?啊')
      e.core.stopEditing()
      session.undo()
      expect(textOf(e)).toBe('Hello there你!好吗?')
      session.undo()
      expect(textOf(e)).toBe('Hello there')
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('over a selected range', () => {
    /** Typing in the words, "there" bold and selected, with the field given its text. */
    async function overBoldWord() {
      const e = await testEditor(WORDS)
      editors.push(e)
      typingAtEnd(e)
      e.modules.typing.styleRange({ id: 'words', range: { start: 6, end: 11 } }, { fontWeight: 700 })
      e.modules.typing.selectText({ start: 6, end: 11 })
      const runs = () => (e.core.design().nodes.words?.props as { runs: unknown[] }).runs
      return { e, runs, given: fieldOf(e) }
    }

    it('draws it replaced and leaves it in the design; the commit replaces it in one edit, in its run', async () => {
      const { e, runs, given } = await overBoldWord()
      expect(given).toEqual({ value: 'there', start: 0, end: 5 })
      e.core.input.fieldChanged(composedIn(given, 'wo'), 'wo')
      e.core.redraw()
      expect(drawnText(e)).toBe('Hello wo')
      expect(textOf(e)).toBe('Hello there')
      expect(e.modules.typing.selectedText()?.range).toEqual({ start: 6, end: 11 })
      compose(e, given, [], '我们')
      expect(textOf(e)).toBe('Hello 我们')
      expect(runs()).toEqual([{ start: 6, end: 8, style: { fontWeight: 700 } }])
      e.core.stopEditing()
      e.core.session.undo()
      expect(textOf(e)).toBe('Hello there')
      expect(runs()).toEqual([{ start: 6, end: 11, style: { fontWeight: 700 } }])
    })

    it('moves the range and writes nothing when only the field’s selection moves', async () => {
      const { e, runs, given } = await overBoldWord()
      const changes = e.core.session.changes()
      e.core.input.fieldChanged({ ...given, end: 2 }, null)
      expect(e.core.session.changes()).toBe(changes)
      expect(runs()).toEqual([{ start: 6, end: 11, style: { fontWeight: 700 } }])
      expect(e.modules.typing.selectedText()?.range).toEqual({ start: 6, end: 8 })
    })

    it('gives back the text and the range as they were when the input method cancels', async () => {
      const { e, given } = await overBoldWord()
      const design = e.core.session.design()
      compose(e, given, ['wo', 'wom'], '')
      expect(e.core.session.design()).toBe(design)
      expect(drawnText(e)).toBe('Hello there')
      expect(e.modules.typing.selectedText()?.range).toEqual({ start: 6, end: 11 })
      // What the field holds after the cancel still stands for the range.
      e.core.input.fieldChanged({ value: 'x', start: 1, end: 1 }, null)
      expect(textOf(e)).toBe('Hello x')
    })
  })

  describe('with another tab', () => {
    it('keeps an edit the other tab makes before the composition, drawing it where the text moved it', async () => {
      mem = memorySync(WORDS)
      const a = await editorOn()
      const b = await editorOn('bob')
      const given = fieldOf(a, true)
      a.core.input.fieldChanged(composedIn(given, 'nihao'), 'nihao')
      b.core.select(['words'])
      b.press('goIn')
      b.keys.press('Home')
      for (const key of ['H', 'o', 't', ' ']) b.keys.press(key)
      b.keys.press('Escape')
      await settle()
      a.core.redraw()
      expect(drawnText(a)).toBe('Hot Hello therenihao')
      compose(a, given, [], '你好')
      a.keys.press('Escape')
      await settle()
      expect(textOf(a)).toBe('Hot Hello there你好')
      expect(textOf(b)).toBe('Hot Hello there你好')
    })

    it('keeps what the other tab types right after the range a composition replaces', async () => {
      mem = memorySync(WORDS)
      const a = await editorOn()
      const b = await editorOn('bob')
      typingAtEnd(a)
      a.modules.typing.selectText({ start: 0, end: 5 })
      const given = fieldOf(a)
      a.core.input.fieldChanged(composedIn(given, 'ni'), 'ni')
      b.core.select(['words'])
      b.press('goIn')
      b.modules.typing.caretTo(5)
      b.keys.press('!')
      b.keys.press('Escape')
      await settle()
      compose(a, given, [], '你')
      a.keys.press('Escape')
      await settle()
      expect(textOf(a)).toBe('你! there')
      expect(textOf(b)).toBe('你! there')
    })

    it('ends typing with nothing landed when the other tab deletes the text', async () => {
      mem = memorySync(WORDS)
      const a = await editorOn()
      const b = await editorOn('bob')
      const given = fieldOf(a, true)
      a.core.input.fieldChanged(composedIn(given, 'nihao'), 'nihao')
      b.core.select(['words'])
      b.press('delete')
      await settle()
      a.core.redraw()
      expect(a.modules.typing.editing()).toBeNull()
      expect(a.core.input.fieldChanged(composedIn(given, '你好'), null)).toBe(false)
      expect(a.core.design().nodes.words).toBeUndefined()
      expect(a.modules.view.previewed()).toBe(a.modules.view.design())
    })
  })

  describe('its box', () => {
    /** One text in the square, growing with its words or in a fixed box, alone or in a row that centres it. */
    const oneText = (boxMode: 'autoWidth' | 'fixed', inRow = false): DesignInput => ({
      ...WORDS,
      nodes: {
        ...(inRow
          ? {
              row: {
                type: 'box',
                parentId: 'sq',
                link: 'row',
                index: 'a0',
                name: 'Row',
                props: { x: 100, y: 100, width: 800, height: 200, layout: { direction: 'row', justify: 'center' } },
              },
            }
          : {}),
        words: {
          type: 'text',
          parentId: inRow ? 'row' : 'sq',
          link: 'words',
          index: 'a0',
          name: 'Words',
          props: {
            x: 100,
            y: 100,
            width: 400,
            height: 120,
            text: 'Hello',
            boxMode,
            style: { fontFamily: 'Noto Sans', fontSize: 80, color: '#000000FF' },
          },
        },
      },
    })

    /** Composes "nihao" at the end of the text, and gives what is shown then and the composed width. */
    async function composing(design: DesignInput) {
      const e = await testEditor(design)
      editors.push(e)
      const given = fieldOf(e, true)
      e.core.input.fieldChanged(composedIn(given, 'nihao'), 'nihao')
      e.core.redraw()
      const width = (e.modules.view.previewed().nodes.words?.props as { width: number }).width
      return { e, shown: e.modules.typing.shown(), width }
    }

    it('grows an auto-width text by the composition, and the box shown with it', async () => {
      const { e, shown, width } = await composing(oneText('autoWidth'))
      const stored = (e.core.design().nodes.words?.props as { width: number }).width
      expect(width).toBeGreaterThan(stored)
      expect(shown?.box?.width).toBe(width)
      expect(shown?.composition).toHaveLength(1)
      expect(shown?.caret?.x).toBeCloseTo((shown?.box?.x ?? 0) + width, 0)
    })

    it('keeps a fixed box its size', async () => {
      const { shown, width } = await composing(oneText('fixed'))
      expect(width).toBe(400)
      expect(shown?.box?.width).toBe(400)
    })

    it('puts the caret where a row that centres the grown text lays it out', async () => {
      const { shown, width } = await composing(oneText('autoWidth', true))
      expect(shown?.box?.x).toBeCloseTo(100 + (800 - width) / 2, 0)
      expect(shown?.caret?.x).toBeCloseTo(100 + (800 + width) / 2, 0)
    })
  })
})
