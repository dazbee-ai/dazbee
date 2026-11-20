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
    core.input.text('한')
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

  it('step through a Latin word in Arabic right to left with Left, and left to right with Right', async () => {
    const { press, textNow } = await typingIn('خصم Nike')
    // Over خصم and the space, then back over the e and the k.
    press('End', ...Array<string>(6).fill('ArrowLeft'), 'X')
    expect(textNow()).toBe('خصم NiXke')
    press('ArrowRight', 'Y')
    expect(textNow()).toBe('خصم NiXkYe')
  })
})
