// Backspace after a Hindi syllable takes its vowel sign first, as Indic keyboards do, while emoji,
// flags and Hangul go whole; Left and Right move the caret the way they point on screen in Arabic
// with Latin words in it.
import { afterEach, describe, expect, it } from 'vitest'

import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'

let editor: TestEditor | undefined
afterEach(() => editor?.end())

/** An editor typing in the words, which say `text`, the caret at their end; their text. */
async function typingIn(text: string) {
  const words = WORDS.nodes.words
  if (words?.type !== 'text') throw new Error('no words')
  editor = await testEditor({
    ...WORDS,
    nodes: { ...WORDS.nodes, words: { ...words, props: { ...words.props, text } } },
  })
  const opened = editor
  opened.core.select(['words'])
  opened.press('goIn')
  const textNow = () => {
    const node = opened.core.design().nodes.words
    return node?.type === 'text' ? node.props.text : undefined
  }
  /** Presses keys in turn. */
  const press = (...keys: string[]) => {
    for (const key of keys) opened.keys.press(key)
  }
  return { core: opened.core, press, textNow }
}

describe('Backspace', () => {
  it('takes a Hindi syllable’s vowel sign first: कि becomes क', async () => {
    const { press, textNow } = await typingIn('')
    press('क', 'ि')
    expect(textNow()).toBe('कि')
    press('Backspace')
    expect(textNow()).toBe('क')
  })

  it('takes a conjunct’s vowel sign, then the conjunct whole', async () => {
    const { press, textNow } = await typingIn('')
    press('क', '्', 'ष', 'ि')
    expect(textNow()).toBe('क्षि')
    press('Backspace')
    expect(textNow()).toBe('क्ष')
    press('Backspace')
    expect(textNow()).toBe('')
  })

  it('takes emoji, flags and Hangul whole, a syllable of conjoining letters too', async () => {
    const { core, press, textNow } = await typingIn('')
    press('👨‍👩‍👧', '🇮🇳', '한')
    core.input.text('\u1112\u1161\u11AB')
    press('Backspace')
    expect(textNow()).toBe('👨‍👩‍👧🇮🇳한')
    press('Backspace')
    expect(textNow()).toBe('👨‍👩‍👧🇮🇳')
    press('Backspace')
    expect(textNow()).toBe('👨‍👩‍👧')
    press('Backspace')
    expect(textNow()).toBe('')
  })
})

describe('a delete that came with no key', () => {
  it('takes the same step as Backspace, and nothing while no text is edited', async () => {
    const { core, press, textNow } = await typingIn('')
    press('क', 'ि')
    expect(core.input.deleteBackward()).toBe(true)
    expect(textNow()).toBe('क')
    press('Escape')
    expect(core.input.deleteBackward()).toBe(false)
    expect(textNow()).toBe('क')
  })
})

describe('Delete', () => {
  it('still takes one whole grapheme forward, a Hindi syllable with its vowel sign', async () => {
    const { press, textNow } = await typingIn('किसान')
    press('Home', 'Delete')
    expect(textNow()).toBe('सान')
  })
})

describe('Left and Right', () => {
  // "خصم Nike" reads from the right: خصم at the right end, then Nike to its left, left to right.
  it('move the caret the way they point on screen, through Latin words in Arabic', async () => {
    const { press, textNow } = await typingIn('خصم Nike')
    // End goes to the right end, where Arabic text starts.
    press('End', 'ArrowLeft', 'X')
    expect(textNow()).toBe('خXصم Nike')
    press('Backspace', 'ArrowRight', 'Y')
    expect(textNow()).toBe('Yخصم Nike')
  })

  it('stop on each side of a Latin phrase in Arabic, and a letter typed there goes where the caret is drawn', async () => {
    // Reading from the right: خصم, then "Ab", then كل at the left end.
    const { press, textNow } = await typingIn('خصم Ab كل')
    // From the right end over خصم to its left, then over the space to just right of the b.
    press('End', ...Array<string>(4).fill('ArrowLeft'), 'X')
    expect(textNow()).toBe('خصم AbX كل')
    // Over the b and the A to just left of the A.
    press('Backspace', 'ArrowLeft', 'ArrowLeft', 'Y')
    expect(textNow()).toBe('خصم YAb كل')
  })

  it('take the caret to the end of a selected range the arrow points to on screen', async () => {
    const text = 'خصم Ab كل'
    const { press, textNow } = await typingIn(text)
    const selectAll = () => editor?.modules.typing.selectText({ start: 0, end: text.length })
    // The Arabic text reads from the right: its end is at the left end.
    selectAll()
    press('ArrowLeft', 'X')
    expect(textNow()).toBe('خصم Ab كلX')
    selectAll()
    press('ArrowRight', 'Y')
    expect(textNow()).toBe('Yخصم Ab كلX')
  })

  it('take the caret to the edge of a selected Latin word in Arabic the arrow points to', async () => {
    const { press, textNow } = await typingIn('خصم Ab كل')
    const selectAb = () => editor?.modules.typing.selectText({ start: 4, end: 6 })
    selectAb()
    press('ArrowLeft', 'X')
    expect(textNow()).toBe('خصم XAb كل')
    press('Backspace')
    selectAb()
    press('ArrowRight', 'Y')
    expect(textNow()).toBe('خصم AbY كل')
  })

  it('step through a Latin word in Arabic right to left with Left, and left to right with Right', async () => {
    const { press, textNow } = await typingIn('خصم Nike')
    // Over خصم and the space, then back over the e and the k.
    press('End', ...Array<string>(6).fill('ArrowLeft'), 'X')
    expect(textNow()).toBe('خصم NiXke')
    press('ArrowRight', 'Y')
    expect(textNow()).toBe('خصم NiXkYe')
  })
})
