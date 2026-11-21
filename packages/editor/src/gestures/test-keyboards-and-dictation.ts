// Written sequences of the events browsers send the stage field from keyboards that read the text
// around the caret, phone keyboards composing, correcting and re-opening words and moving the
// caret, and dictation, each with the field's value and selection after it, the text around the
// caret included, for tests to replay through a stand-in field.
import {
  before,
  down,
  end,
  type FieldEvent,
  frame,
  input,
  type InputMethodSequence,
  selection,
  start,
  up,
  update,
} from './test-input-methods.ts'

/**
 * Gboard in English in Chrome for Android: a space, then "wrld" composed a letter at a time and
 * committed as its autocorrection "world" at the next space, which follows it.
 */
export const GBOARD_AUTOCORRECT: InputMethodSequence = {
  name: 'Gboard’s autocorrection at the space in Chrome for Android',
  start: 'Hello there|',
  events: [
    ...androidKey(
      false,
      'Hello there|',
      'Hello there |',
      [before('insertText', ' ', false, 'Hello there|')],
      [input('insertText', ' ', false, 'Hello there |')],
    ),
    ...androidComposing('Hello there |', ['w', 'wr', 'wrl', 'wrld']),
    ...androidKey(true, 'Hello there wrld|', 'Hello there world |', androidCommit('world', 'Hello there wrld|'), [
      before('insertText', ' ', false, 'Hello there world|'),
      input('insertText', ' ', false, 'Hello there world |'),
    ]),
  ],
  typed: 'Hello there world |',
  whole: true,
}

/**
 * Gboard in English in Chrome for Android: Backspace with no key (cancelled, so Backspace's own step
 * deletes the space), the word before the caret re-opened as a composition with no change to the
 * field, and the suggestion "these" picked, with the space Gboard puts after it.
 */
export const GBOARD_REOPEN: InputMethodSequence = {
  name: 'Gboard re-opening the word before the caret in Chrome for Android',
  start: 'Hello there |',
  events: [
    down('Unidentified', '', 229, false, 'Hello there |'),
    { ...before('deleteContentBackward', null, false, 'Hello there |'), prevented: true },
    up('Unidentified', '', 229, false, 'Hello there|'),
    start('Hello there|'),
    update('there', 'Hello there|'),
    frame('Hello there|'),
    ...androidKey(true, 'Hello there|', 'Hello these |', androidCommit('these', 'Hello there|'), [
      before('insertText', ' ', false, 'Hello these|'),
      input('insertText', ' ', false, 'Hello these |'),
    ]),
  ],
  typed: 'Hello these |',
  whole: true,
}

/** Gboard's space bar dragged in Chrome for Android: the field's caret moves back three letters, and nothing is typed. */
export const GBOARD_SPACE_CURSOR: InputMethodSequence = {
  name: 'Gboard’s space-bar cursor in Chrome for Android',
  start: 'Hello there|',
  events: [selection('Hello ther|e'), selection('Hello the|re'), selection('Hello th|ere'), frame('Hello th|ere')],
  typed: 'Hello th|ere',
  whole: true,
}

/** Gboard in Hindi (Devanagari) in Chrome for Android: नमस्ते composed a letter at a time and committed with a space. */
export const GBOARD_HINDI: InputMethodSequence = {
  name: 'Gboard composing a Hindi word in Chrome for Android',
  start: 'Hello there |',
  events: androidWord('Hello there ', ['न', 'नम', 'नमस', 'नमस्', 'नमस्त', 'नमस्ते']),
  typed: 'Hello there नमस्ते |',
  whole: true,
}

/** Gboard in Arabic in Chrome for Android: مرحبا composed a letter at a time and committed with a space. */
export const GBOARD_ARABIC: InputMethodSequence = {
  name: 'Gboard composing an Arabic word in Chrome for Android',
  start: 'Hello there |',
  events: androidWord('Hello there ', ['م', 'مر', 'مرح', 'مرحب', 'مرحبا']),
  typed: 'Hello there مرحبا |',
  whole: true,
}

/**
 * The iPhone's keyboard in Safari: "teh" corrected to "the" as Space is tapped, the correction
 * replacing the word before the caret with no key, then Space's key, which typing takes.
 */
export const IOS_AUTOCORRECT: InputMethodSequence = {
  name: 'the iPhone’s autocorrection at the space in Safari',
  start: 'Hello teh|',
  events: [
    before('insertReplacementText', 'the', false, 'Hello teh|'),
    input('insertReplacementText', 'the', false, 'Hello the|'),
    { ...down(' ', 'Space', 32, false, 'Hello the|'), prevented: true },
    up(' ', 'Space', 32, false, 'Hello the |'),
  ],
  typed: 'Hello the |',
  whole: true,
}

/** Dictation on an iPhone in Safari: a sentence inserted with no key, then its correction replacing it. */
export const IOS_DICTATION: InputMethodSequence = {
  name: 'dictation and its correction on an iPhone in Safari',
  start: 'Hello there|',
  events: [
    before('insertText', ' how are you', false, 'Hello there|'),
    input('insertText', ' how are you', false, 'Hello there how are you|'),
    frame('Hello there how are you|'),
    before('insertReplacementText', 'How are you?', false, 'Hello there how are you|'),
    input('insertReplacementText', 'How are you?', false, 'Hello there How are you?|'),
  ],
  typed: 'Hello there How are you?|',
  whole: true,
}

/** Dictation on a Mac in Chrome: the words heard so far composed, and the sentence committed once it ends. */
export const MAC_DICTATION: InputMethodSequence = {
  name: 'dictation on a Mac in Chrome',
  start: 'Hello there|',
  events: [
    start('Hello there|'),
    ...[' how', ' how are', ' how are you'].flatMap((heard, n, all) => [
      before('insertCompositionText', heard, true, `Hello there${all[n - 1] ?? ''}|`),
      update(heard, `Hello there${all[n - 1] ?? ''}|`),
      input('insertCompositionText', heard, true, `Hello there${heard}|`),
      frame(`Hello there${heard}|`),
    ]),
    end(' how are you', 'Hello there how are you|'),
  ],
  typed: 'Hello there how are you|',
  whole: true,
}

/** Every written sequence of a phone keyboard or dictation. */
export const KEYBOARD_AND_DICTATION_SEQUENCES: readonly InputMethodSequence[] = [
  GBOARD_AUTOCORRECT,
  GBOARD_REOPEN,
  GBOARD_SPACE_CURSOR,
  GBOARD_HINDI,
  GBOARD_ARABIC,
  IOS_AUTOCORRECT,
  IOS_DICTATION,
  MAC_DICTATION,
]

/**
 * One change a keyboard makes in Chrome for Android, the field holding `was` before it and `after`
 * after it: a key down and up saying only keyCode 229, around the events the change sends.
 */
function androidKey(composing: boolean, was: string, after: string, ...changes: FieldEvent[][]) {
  return [down('Unidentified', '', 229, composing, was), ...changes.flat(), up('Unidentified', '', 229, false, after)]
}

/** A keyboard in Chrome for Android composing each of `steps` in turn at the caret of `was`, the composition's start before the first. */
function androidComposing(was: string, steps: string[]) {
  const at = (typed: string) => was.replace('|', `${typed}|`)
  return steps.flatMap((composed, n) => {
    const held = at(steps[n - 1] ?? '')
    return [
      down('Unidentified', '', 229, n > 0, held),
      ...(n === 0 ? [start(held)] : []),
      before('insertCompositionText', composed, true, held),
      update(composed, held),
      input('insertCompositionText', composed, true, at(composed)),
      up('Unidentified', '', 229, true, at(composed)),
    ]
  })
}

/** A keyboard in Chrome for Android committing `word` in place of what it composes, the field holding `was` before it and `after` after it. */
function androidCommit(word: string, was: string, after = was.replace(/\S*\|/u, `${word}|`)) {
  return [
    before('insertCompositionText', word, true, was),
    update(word, was),
    input('insertCompositionText', word, true, after),
    end(word, after),
  ]
}

/** A keyboard in Chrome for Android composing each of `steps` after `typed`, and committing the last with a space. */
function androidWord(typed: string, steps: string[]) {
  const word = steps.at(-1) ?? ''
  return [
    ...androidComposing(`${typed}|`, steps),
    ...androidKey(true, `${typed}${word}|`, `${typed}${word} |`, androidCommit(word, `${typed}${word}|`), [
      before('insertText', ' ', false, `${typed}${word}|`),
      input('insertText', ' ', false, `${typed}${word} |`),
    ]),
  ]
}
