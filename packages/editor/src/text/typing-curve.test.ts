// Typing on a curved text: keys, a click and a composition edit the characters of the placed letters
// they are on (ADR-0021), the caret and range are shown turned with those letters, Up and Down move
// by the straight lines, and the box fits the curve as the text grows.
import { afterEach, describe, expect, it } from 'vitest'

import { caretPosition, letterBoxes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { TextCurve, TextProps } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'

const ck = await loadCanvasKit()
const ARC: TextCurve = { shape: 'arcUp', amount: 80 }

let editor: TestEditor | undefined
afterEach(() => editor?.end())

/** An editor typing in the words, which say `text` on `curve`, the caret at their end. */
async function typingIn(text: string, curve: TextCurve = ARC) {
  const words = WORDS.nodes.words
  if (words?.type !== 'text') throw new Error('no words')
  editor = await testEditor({
    ...WORDS,
    nodes: { ...WORDS.nodes, words: { ...words, props: { ...words.props, text, curve } } },
  })
  const opened = editor
  opened.core.select(['words'])
  opened.press('goIn')
  opened.keys.press('End')
  const props = () => opened.core.design().nodes.words?.props as TextProps
  const press = (...keys: string[]) => {
    for (const key of keys) opened.keys.press(key)
  }
  return { editor: opened, typing: opened.modules.typing, press, props }
}

describe('typing on a curved text', () => {
  it('types and deletes at the caret, the box fitting the curve as the text grows', async () => {
    const { press, props } = await typingIn('Fresh')
    press('X')
    const before = props()
    press('Y', 'Z')
    expect(props().text).toBe('FreshXYZ')
    expect(props().curve).toEqual(ARC)
    expect(props().width).toBeGreaterThan(before.width)
    expect(props().height).toBeGreaterThan(before.height)
    press('Backspace')
    expect(props().text).toBe('FreshXY')
    press('Home', 'Delete')
    expect(props().text).toBe('reshXY')
  })

  it('selects with Shift and the arrows, and typing replaces what is selected', async () => {
    const { press, props, typing } = await typingIn('Fresh baked')
    press('Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowLeft')
    expect(typing.selectedText()?.range).toEqual({ start: 8, end: 11 })
    press('o', 'n')
    expect(props().text).toBe('Fresh baon')
    press('Home', 'Shift+ArrowRight', 'Shift+ArrowRight', 'Backspace')
    expect(props().text).toBe('esh baon')
  })

  it('moves the caret up and down by the lines as laid out straight', async () => {
    const { press, props, typing } = await typingIn('Fresh\nbaked')
    typing.caretTo(2)
    press('ArrowDown', 'X')
    expect(props().text).toBe('Fresh\nbaXked')
    typing.caretTo(2)
    press('ArrowDown', 'ArrowUp', 'Y')
    expect(props().text).toBe('FrYesh\nbaXked')
  })

  it('shows the caret and the range turned with the letters they are on', async () => {
    const { editor: e, typing, props } = await typingIn('Fresh baked')
    typing.caretTo(1)
    const laid = e.modules.scenes.layout(props())
    const at = caretPosition(ck, laid, 1)
    expect(Math.abs(at.turn ?? 0)).toBeGreaterThan(10)
    expect(typing.shown()?.caret).toEqual({
      x: props().x + at.x,
      y: props().y + laid.dy + at.y,
      height: at.height,
      turn: at.turn,
    })
    typing.selectText({ start: 0, end: 5 })
    const range = typing.shown()?.range ?? []
    expect(range).toHaveLength(5)
    expect(new Set(range.map((box) => Math.round(box.turn ?? 0))).size).toBe(5)
  })

  it('puts the caret before or after the curved letter a click lands on, by its half', async () => {
    const { editor: e, typing, props, press } = await typingIn('Fresh baked')
    const placed = e.modules.scenes.layout(props()).placed
    if (!placed) throw new Error('not placed')
    // The "s" is the fourth letter: a point a quarter and three quarters along its turned box.
    const s = letterBoxes(placed)[3]
    if (!s) throw new Error('no fourth letter')
    const at = (along: number) => {
      const angle = ((s.turn ?? 0) * Math.PI) / 180
      const [x, y] = [s.width * along, s.height / 2]
      return {
        x: props().x + s.x + Math.cos(angle) * x - Math.sin(angle) * y,
        y: props().y + s.y + Math.sin(angle) * x + Math.cos(angle) * y,
      }
    }
    expect(typing.caretFromPoint(at(0.25))).toBe(3)
    expect(typing.caretFromPoint(at(0.75))).toBe(4)
    typing.caretTo(typing.caretFromPoint(at(0.75)))
    press('!')
    expect(props().text).toBe('Fres!h baked')
  })

  it('types a composition at the caret on the curve, drawn turned and committed once', async () => {
    const { editor: e, props, typing } = await typingIn('Fresh')
    const given = e.core.input.fieldText()
    if (!given) throw new Error('no text is edited')
    const composed = (value: string) => ({
      value: given.value.slice(0, given.start) + value + given.value.slice(given.end),
      start: given.start + value.length,
      end: given.start + value.length,
    })
    e.core.input.fieldChanged(composed('ni'), 'ni')
    e.core.redraw()
    const shown = typing.shown()
    expect(shown?.composition).toHaveLength(2)
    expect(shown?.composition?.every((line) => line.turn !== undefined)).toBe(true)
    expect(shown?.caret?.turn).toBeDefined()
    expect(props().text).toBe('Fresh')
    e.core.input.fieldChanged(composed('你好'), null)
    expect(props().text).toBe('Fresh你好')
  })
})
