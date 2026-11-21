// Written sequences of the events browsers send the stage field as a person types through an input
// method, a dead key, the emoji panel or a key that types more than one letter, each with the
// field's value and selection after it, for tests to replay through a stand-in field. Each follows
// the UI Events and Input Events specs' examples and each browser's documented order.
import type { FieldState } from '../text/field-change.ts'

/** One event a browser sends the stage field, or the window while the field has the focus. */
export interface FieldEvent {
  type:
    'keydown' | 'keyup' | 'compositionstart' | 'compositionupdate' | 'compositionend' | 'beforeinput' | 'input' | 'blur'
  key?: string
  code?: string
  keyCode?: number
  inputType?: string
  data?: string | null
  isComposing?: boolean
  /** For a `beforeinput`, whether the page may cancel it. */
  cancelable?: boolean
  /** The field's value and selection after the event, `|` marking its caret and `[` `]` its selection. */
  field: string
  /**
   * For a key down, that the editor takes it, so the browser sends nothing more for it; for a
   * `beforeinput`, that the field cancels it, so no `input` follows.
   */
  prevented?: true
}

/** An input method's events in one browser on one system, from typing's start to its end. */
export interface InputMethodSequence {
  name: string
  /** The words and their caret or selection as typing starts, written as `FieldEvent.field` writes them. */
  start: string
  events: FieldEvent[]
  /** The words and their caret or selection after the events. */
  typed: string
}

/** The keyCode a key's key up says, by its key. */
const KEY_CODES: Readonly<Record<string, number>> = { ' ': 32, Backspace: 8, Convert: 28, Enter: 13, Escape: 27 }

/** A key going down or coming up, with the field as it stands. */
const down = (key: string, code: string, keyCode: number, isComposing: boolean, field: string): FieldEvent => ({
  type: 'keydown',
  ...{ key, code, keyCode, isComposing, field },
})
const up = (key: string, code: string, keyCode: number, isComposing: boolean, field: string): FieldEvent => ({
  type: 'keyup',
  ...{ key, code, keyCode, isComposing, field },
})
/** A composition event. */
const start = (field: string): FieldEvent => ({ type: 'compositionstart', data: '', field })
const update = (data: string, field: string): FieldEvent => ({ type: 'compositionupdate', data, field })
const end = (data: string, field: string): FieldEvent => ({ type: 'compositionend', data, field })
/** An input event; a `beforeinput` the page may cancel. */
const before = (inputType: string, data: string | null, isComposing: boolean, field: string): FieldEvent => ({
  type: 'beforeinput',
  ...{ inputType, data, isComposing, cancelable: !inputType.includes('Composition'), field },
})
const input = (inputType: string, data: string | null, isComposing: boolean, field: string): FieldEvent => ({
  type: 'input',
  ...{ inputType, data, isComposing, field },
})
const blur = (field: string): FieldEvent => ({ type: 'blur', field })

/** Microsoft Pinyin in Chrome on Windows: "nihao", its first candidate 你好 taken with Space. */
export const PINYIN_CHROME_WINDOWS: InputMethodSequence = {
  name: 'Microsoft Pinyin in Chrome on Windows',
  start: 'Hello there|',
  events: [
    ...windowsComposing('n', 'KeyN', 'n', '|', 'n|', true),
    ...windowsComposing('i', 'KeyI', 'ni', 'n|', 'ni|'),
    ...windowsComposing('h', 'KeyH', 'ni h', 'ni|', 'ni h|'),
    ...windowsComposing('a', 'KeyA', 'ni ha', 'ni h|', 'ni ha|'),
    ...windowsComposing('o', 'KeyO', 'ni hao', 'ni ha|', 'ni hao|'),
    ...windowsCommit(' ', 'Space', '你好', 'ni hao|', '你好|'),
  ],
  typed: 'Hello there你好|',
}

/** The Microsoft Japanese IME in Chrome on Windows over a selected word: "nihon", converted to 日本, taken with Enter. */
export const JAPANESE_CONVERTED_CHROME_WINDOWS: InputMethodSequence = {
  name: 'the Japanese IME converting in Chrome on Windows',
  start: 'Hello [there]',
  events: [
    ...windowsComposing('n', 'KeyN', 'ｎ', '[there]', 'ｎ|', true),
    ...windowsComposing('i', 'KeyI', 'に', 'ｎ|', 'に|'),
    ...windowsComposing('h', 'KeyH', 'にｈ', 'に|', 'にｈ|'),
    ...windowsComposing('o', 'KeyO', 'にほ', 'にｈ|', 'にほ|'),
    ...windowsComposing('n', 'KeyN', 'にほｎ', 'にほ|', 'にほｎ|'),
    ...windowsComposing('Convert', 'Space', '日本', 'にほｎ|', '日本|'),
    ...windowsCommit('Enter', 'Enter', '日本', '日本|', '日本|'),
  ],
  typed: 'Hello 日本|',
}

/** The Japanese IME in Chrome on Windows over a selected word, cancelled with Escape: the word comes back. */
export const JAPANESE_ESCAPE_CHROME_WINDOWS: InputMethodSequence = {
  name: 'the Japanese IME cancelled with Escape in Chrome on Windows',
  start: 'Hello [there]',
  events: [
    ...windowsComposing('k', 'KeyK', 'ｋ', '[there]', 'ｋ|', true),
    ...windowsComposing('a', 'KeyA', 'か', 'ｋ|', 'か|'),
    ...windowsCommit('Escape', 'Escape', '', 'か|', '|'),
  ],
  typed: 'Hello [there]',
}

/**
 * Korean (Microsoft IME, two-set) in Chrome on Windows: 한, then 국 with a Backspace inside it,
 * each syllable ended as the next starts, and Space ending the last.
 */
export const KOREAN_CHROME_WINDOWS: InputMethodSequence = {
  name: 'Korean syllable by syllable in Chrome on Windows',
  start: 'Hello there|',
  events: [
    ...windowsComposing('g', 'KeyG', 'ㅎ', '|', 'ㅎ|', true),
    ...windowsComposing('k', 'KeyK', '하', 'ㅎ|', '하|'),
    ...windowsComposing('s', 'KeyS', '한', '하|', '한|'),
    // ㄱ can't join 한: 한 ends and ㄱ starts the next syllable, on one key.
    down('Process', 'KeyR', 229, true, '한|'),
    before('insertCompositionText', '한', true, '한|'),
    update('한', '한|'),
    input('insertCompositionText', '한', true, '한|'),
    end('한', '한|'),
    start('한|'),
    before('insertCompositionText', 'ㄱ', true, '한|'),
    update('ㄱ', '한|'),
    input('insertCompositionText', 'ㄱ', true, '한ㄱ|'),
    up('r', 'KeyR', 82, true, '한ㄱ|'),
    ...windowsComposing('n', 'KeyN', '구', '한ㄱ|', '한구|'),
    ...windowsComposing('r', 'KeyR', '국', '한구|', '한국|'),
    // Backspace inside the syllable takes back its last letter.
    ...windowsComposing('Backspace', 'Backspace', '구', '한국|', '한구|'),
    ...windowsComposing('r', 'KeyR', '국', '한구|', '한국|'),
    // Space ends the syllable, then types itself.
    down('Process', 'Space', 229, true, '한국|'),
    before('insertCompositionText', '국', true, '한국|'),
    update('국', '한국|'),
    input('insertCompositionText', '국', true, '한국|'),
    end('국', '한국|'),
    before('insertText', ' ', false, '한국|'),
    input('insertText', ' ', false, '한국 |'),
    up(' ', 'Space', 32, false, '한국 |'),
  ],
  typed: 'Hello there한국 |',
}

/** A Mac's dead key, as the UI Events spec's example has it: the circumflex (U+0302) composed, then ê. */
export const DEAD_KEY_MAC: InputMethodSequence = {
  name: 'a dead key on a Mac',
  start: 'Hello there|',
  events: [
    down('Dead', 'KeyI', 229, false, '|'),
    start('|'),
    before('insertCompositionText', '̂', true, '|'),
    update('̂', '|'),
    input('insertCompositionText', '̂', true, '̂|'),
    up('Dead', 'KeyI', 73, true, '̂|'),
    down('ê', 'KeyE', 229, true, '̂|'),
    before('insertCompositionText', 'ê', true, '̂|'),
    update('ê', '̂|'),
    input('insertCompositionText', 'ê', true, 'ê|'),
    end('ê', 'ê|'),
    up('e', 'KeyE', 69, false, 'ê|'),
  ],
  typed: 'Hello thereê|',
}

/**
 * A dead key on Windows (US International) in Chrome: no composition; the key after it comes as the
 * accented letter's key, which typing types.
 */
export const DEAD_KEY_WINDOWS: InputMethodSequence = {
  name: 'a dead key on Windows',
  start: 'Hello there|',
  events: [
    down('Dead', 'Quote', 222, false, '|'),
    up('Dead', 'Quote', 222, false, '|'),
    { ...down('é', 'KeyE', 69, false, '|'), prevented: true },
    up('e', 'KeyE', 69, false, '|'),
  ],
  typed: 'Hello thereé|',
}

/** The Windows emoji panel (Win+.) in Chrome: the emoji picked lands as a composition committed at once. */
export const EMOJI_PANEL_CHROME_WINDOWS: InputMethodSequence = {
  name: 'the Windows emoji panel in Chrome',
  start: 'Hello there|',
  events: [
    start('|'),
    before('insertCompositionText', '😀', true, '|'),
    update('😀', '|'),
    input('insertCompositionText', '😀', true, '😀|'),
    end('😀', '😀|'),
  ],
  typed: 'Hello there😀|',
}

/** The Arabic (101) keyboard's B key, which types lam-alef لا: two letters, which typing leaves to the field. */
export const LAM_ALEF_KEY: InputMethodSequence = {
  name: 'the Arabic lam-alef key',
  start: 'Hello there|',
  events: [
    down('لا', 'KeyB', 66, false, '|'),
    before('insertText', 'لا', false, '|'),
    input('insertText', 'لا', false, 'لا|'),
    up('لا', 'KeyB', 66, false, 'لا|'),
  ],
  typed: 'Hello thereلا|',
}

/**
 * The Devanagari InScript key Shift+7, which types the conjunct क्ष (three code points). A segmenter
 * of Unicode 15.1 or later holds it as one grapheme, so typing types it; one that splits it leaves
 * it to the field, as the lam-alef key is.
 */
export const INSCRIPT_CONJUNCT_KEY: InputMethodSequence = {
  name: 'the Devanagari InScript key that types क्ष',
  start: 'Hello there|',
  events: [{ ...down('क्ष', 'Digit7', 55, false, '|'), prevented: true }, up('क्ष', 'Digit7', 55, false, '|')],
  typed: 'Hello thereक्ष|',
}

/** The same key in a browser whose segmenter splits क्ष: the field takes it. */
export const INSCRIPT_CONJUNCT_FIELD: InputMethodSequence = {
  name: 'the Devanagari InScript key that types क्ष, left to the field',
  start: 'Hello there|',
  events: [before('insertText', 'क्ष', false, '|'), input('insertText', 'क्ष', false, 'क्ष|')],
  typed: 'Hello thereक्ष|',
}

/** Firefox before 136 ending a composition: `compositionend`, then an `input` that is no longer composing. */
export const FIREFOX_END: InputMethodSequence = {
  name: 'the end of a composition in Firefox',
  start: 'Hello [there]',
  events: firefoxCommit('[there]', false),
  typed: 'Hello 你|',
}

/** Firefox before 136 cancelling a composition over a selected word with Escape: the late `input` says the field is empty. */
export const FIREFOX_CANCEL: InputMethodSequence = {
  name: 'a composition cancelled in Firefox',
  start: 'Hello [there]',
  events: [
    ...windowsComposing('n', 'KeyN', 'n', '[there]', 'n|', true),
    down('Process', 'Escape', 229, true, 'n|'),
    before('insertCompositionText', '', true, 'n|'),
    update('', 'n|'),
    end('', '|'),
    input('insertCompositionText', '', false, '|'),
    up('Escape', 'Escape', 27, false, '|'),
  ],
  typed: 'Hello [there]',
}

/** Firefox 136 and later: an `input` while composing before `compositionend`, and the late one after it. */
export const FIREFOX_136_END: InputMethodSequence = {
  name: 'the end of a composition in Firefox 136',
  start: 'Hello there|',
  events: firefoxCommit('|', true),
  typed: 'Hello there你|',
}

/**
 * Safari ending a composition (Input Events Level 2): the composed text deleted, the commit inserted
 * from it, `compositionend`, and then the Enter that committed it, still saying keyCode 229.
 */
export const SAFARI_END: InputMethodSequence = {
  name: 'the end of a composition in Safari',
  start: 'Hello there|',
  events: [
    start('|'),
    before('insertCompositionText', 'に', true, '|'),
    update('に', '|'),
    input('insertCompositionText', 'に', true, 'に|'),
    down('Process', 'KeyI', 229, true, 'に|'),
    up('i', 'KeyI', 73, true, 'に|'),
    before('insertCompositionText', 'にほん', true, 'に|'),
    update('にほん', 'に|'),
    input('insertCompositionText', 'にほん', true, 'にほん|'),
    ...safariCommit('にほん'),
    down('Enter', 'Enter', 229, false, 'にほん|'),
    up('Enter', 'Enter', 13, false, 'にほん|'),
  ],
  typed: 'Hello thereにほん|',
}

/** A blur that ends a composition with no `compositionend` (the window losing the focus), and a late one after it. */
export const BLUR_END: InputMethodSequence = {
  name: 'a blur that ends a composition, and a late compositionend',
  start: 'Hello there|',
  events: [
    ...windowsComposing('n', 'KeyN', 'n', '|', 'n|', true),
    ...windowsComposing('i', 'KeyI', 'ni', 'n|', 'ni|'),
    blur('ni|'),
    input('insertCompositionText', 'ni', false, 'ni|'),
    end('ni', 'ni|'),
  ],
  typed: 'Hello thereni|',
}

/** A blur that ends a composition, and nothing after it. */
export const BLUR_ALONE: InputMethodSequence = {
  name: 'a blur that ends a composition',
  start: 'Hello there|',
  events: [...windowsComposing('n', 'KeyN', 'n', '|', 'n|', true), blur('n|')],
  typed: 'Hello theren|',
}

/**
 * Safari with the window put behind and brought back mid-composition: the blur ends it for the
 * page, but the input method goes on composing in the field until its own end.
 */
export const SAFARI_BLUR_GOES_ON: InputMethodSequence = {
  name: 'a composition that goes on after a blur in Safari',
  start: 'Hello there|',
  events: [
    start('|'),
    before('insertCompositionText', 'にほ', true, '|'),
    update('にほ', '|'),
    input('insertCompositionText', 'にほ', true, 'にほ|'),
    blur('にほ|'),
    before('insertCompositionText', '日本', true, 'にほ|'),
    update('日本', 'にほ|'),
    input('insertCompositionText', '日本', true, '日本|'),
    ...safariCommit('日本'),
  ],
  typed: 'Hello there日本|',
}

/** Every written sequence. */
export const INPUT_METHOD_SEQUENCES: readonly InputMethodSequence[] = [
  PINYIN_CHROME_WINDOWS,
  JAPANESE_CONVERTED_CHROME_WINDOWS,
  JAPANESE_ESCAPE_CHROME_WINDOWS,
  KOREAN_CHROME_WINDOWS,
  DEAD_KEY_MAC,
  DEAD_KEY_WINDOWS,
  EMOJI_PANEL_CHROME_WINDOWS,
  LAM_ALEF_KEY,
  INSCRIPT_CONJUNCT_KEY,
  INSCRIPT_CONJUNCT_FIELD,
  FIREFOX_END,
  FIREFOX_CANCEL,
  FIREFOX_136_END,
  SAFARI_END,
  BLUR_END,
  BLUR_ALONE,
  SAFARI_BLUR_GOES_ON,
]

/** A field's value and selection from how `FieldEvent.field` writes them. */
export function writtenField(written: string): FieldState {
  const caret = written.indexOf('|')
  if (caret >= 0) return { value: written.replace('|', ''), start: caret, end: caret }
  const start = written.indexOf('[')
  const end = written.indexOf(']') - 1
  if (start < 0 || end < start) throw new Error(`no caret or selection in ${written}`)
  return { value: written.replace('[', '').replace(']', ''), start, end }
}

/**
 * One key a browser on Windows sends while an input method composes, the field holding `was` before it
 * and `after` after it: the key down as `Process` with keyCode 229, the composition's start for the
 * first, the composed text, and the key up.
 */
function windowsComposing(key: string, code: string, composed: string, was: string, after: string, first = false) {
  return [
    down('Process', code, 229, !first, was),
    ...(first ? [start(was)] : []),
    before('insertCompositionText', composed, true, was),
    update(composed, was),
    input('insertCompositionText', composed, true, after),
    up(key, code, keyCode(key), true, after),
  ]
}

/** The key a browser on Windows sends as an input method commits what it composed, or with nothing, cancels it. */
function windowsCommit(key: string, code: string, composed: string, was: string, after: string) {
  return [
    down('Process', code, 229, true, was),
    before('insertCompositionText', composed, true, was),
    update(composed, was),
    input('insertCompositionText', composed, true, after),
    end(composed, after),
    up(key, code, keyCode(key), false, after),
  ]
}

/** The keyCode of a key by its key: a letter's is its capital's code. */
function keyCode(key: string) {
  return KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0)
}

/**
 * Firefox committing 你 for "n" typed at `was`, with Space: `compositionend`, then an `input` no
 * longer composing; from 136 on, an `input` still composing before `compositionend` too.
 */
function firefoxCommit(was: string, from136: boolean) {
  return [
    ...windowsComposing('n', 'KeyN', 'n', was, 'n|', true),
    down('Process', 'Space', 229, true, 'n|'),
    before('insertCompositionText', '你', true, 'n|'),
    update('你', 'n|'),
    ...(from136 ? [input('insertCompositionText', '你', true, '你|')] : []),
    end('你', '你|'),
    input('insertCompositionText', '你', false, '你|'),
    up(' ', 'Space', 32, false, '你|'),
  ]
}

/** Safari committing what it composed, at the field's start: the composed text deleted, the commit inserted from it, and its end. */
function safariCommit(composed: string) {
  return [
    before('deleteCompositionText', null, true, `${composed}|`),
    input('deleteCompositionText', null, true, '|'),
    before('insertFromComposition', composed, true, '|'),
    input('insertFromComposition', composed, true, `${composed}|`),
    end(composed, `${composed}|`),
  ]
}
