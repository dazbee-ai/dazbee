// The stage field sends what changes in it to the text being edited: each input method's written
// sequence, replayed through a stand-in field and window on a test core, types its commit once,
// the field is never given text while composing, and it stands at the overlay's caret.

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type FieldEvent,
  INPUT_METHOD_SEQUENCES,
  JAPANESE_ESCAPE_CHROME_WINDOWS,
  PINYIN_CHROME_WINDOWS,
} from './test-input-methods.ts'
import {
  GBOARD_AUTOCORRECT,
  GBOARD_REOPEN,
  GBOARD_SPACE_CURSOR,
  IOS_AUTOCORRECT,
  KEYBOARD_AND_DICTATION_SEQUENCES,
} from './test-keyboards-and-dictation.ts'
import { bareField, endStandIns, fire, page, typingWith } from './test-stage-field.ts'

afterEach(endStandIns)

describe('editorStageField', () => {
  for (const sequence of [...INPUT_METHOD_SEQUENCES, ...KEYBOARD_AND_DICTATION_SEQUENCES]) {
    it(`types ${sequence.name} once, and gives the field no text while composing`, async () => {
      const { field, replay, typed } = await typingWith(sequence.start)
      replay(sequence)
      expect(field.forced).toEqual([])
      expect(typed()).toBe(sequence.typed)
    })
  }

  it('makes one undo step of what an input method typed, and redoes it', async () => {
    const { e, replay, words } = await typingWith(PINYIN_CHROME_WINDOWS.start)
    replay(PINYIN_CHROME_WINDOWS)
    e.core.stopEditing()
    e.core.session.undo()
    expect(words()).toBe('Hello there')
    e.core.session.redo()
    expect(words()).toBe('Hello there你好')
  })

  it('holds the text around the selected range as typing starts, and moves its selection with a key', async () => {
    const { e, fieldNow } = await typingWith('Hello [there]')
    expect(fieldNow()).toBe('Hello [there]')
    e.keys.press('ArrowLeft')
    expect(fieldNow()).toBe('Hello |there')
  })

  it('keeps what an input method committed, which the text holds at its place, for the next composition', async () => {
    const { replay, fieldNow } = await typingWith(PINYIN_CHROME_WINDOWS.start)
    replay(PINYIN_CHROME_WINDOWS)
    expect(fieldNow()).toBe('Hello there你好|')
  })

  it('is given the selected word back once the input method cancels over it', async () => {
    const { replay, fieldNow } = await typingWith(JAPANESE_ESCAPE_CHROME_WINDOWS.start)
    replay(JAPANESE_ESCAPE_CHROME_WINDOWS)
    expect(fieldNow()).toBe('Hello [there]')
  })

  it('stands at the caret the overlay draws inside the composition, at the caret’s height', async () => {
    const { e, field, send, around, frame } = await typingWith('Hello there|')
    // "ni hao" composed, the input method's cursor at its end, then moved back one letter inside it.
    for (const event of PINYIN_CHROME_WINDOWS.events.slice(0, 26)) send(around(event))
    frame()
    const atEnd = e.modules.typing.shown()?.caret
    const composed = 'Hello thereni hao|'
    send({ type: 'keydown', key: 'Process', code: 'ArrowLeft', keyCode: 229, isComposing: true, field: composed })
    send({
      type: 'beforeinput',
      inputType: 'insertCompositionText',
      data: 'ni hao',
      isComposing: true,
      field: composed,
    })
    send({ type: 'compositionupdate', data: 'ni hao', field: composed })
    send({
      type: 'input',
      inputType: 'insertCompositionText',
      data: 'ni hao',
      isComposing: true,
      field: 'Hello thereni ha|o',
    })
    frame()
    const caret = e.modules.typing.shown()?.caret
    if (!atEnd || !caret) throw new Error('no caret shown')
    expect(caret.x).toBeLessThan(atEnd.x)
    expect(field.style).toMatchObject({
      left: `${caret.x}px`,
      top: `${caret.y}px`,
      height: `${caret.height}px`,
      fontSize: `${caret.height * 0.8}px`,
    })
  })

  it('keeps its font at 16 px or more, which iOS doesn’t zoom the page into, scaled down to a small caret’s height', async () => {
    const { e, field, frame } = await typingWith('Hello there|')
    expect(field.style.fontSize).toBe('16px')
    e.modules.typing.styleRange({ id: 'words', range: { start: 0, end: 11 } }, { fontSize: 12 })
    frame()
    const caret = e.modules.typing.shown()?.caret
    if (!caret) throw new Error('no caret shown')
    expect(caret.height * 0.8).toBeLessThan(16)
    const scale = (caret.height * 0.8) / 16
    expect(field.style).toMatchObject({ fontSize: '16px', transform: `scale(${scale})`, transformOrigin: '0 0' })
    expect(Number.parseFloat(field.style.height ?? '') * scale).toBeCloseTo(caret.height, 6)
  })

  it('deletes back once in the text for a delete that came with no key, and nothing while composing', async () => {
    const { send, typed } = await typingWith('Hello there|')
    const deleted = { inputType: 'deleteContentBackward', data: null, cancelable: true, prevented: true } as const
    send({ type: 'beforeinput', ...deleted, field: 'Hello there|' })
    send({ type: 'compositionstart', data: '', field: 'Hello ther|' })
    send({ type: 'beforeinput', ...deleted, field: 'Hello ther|' })
    send({ type: 'compositionend', data: '', field: 'Hello ther|' })
    expect(typed()).toBe('Hello ther|')
  })

  it('reads a delete the browser makes anyway from the field, once', async () => {
    const { send, typed } = await typingWith('Hello [there]')
    const deleted = { inputType: 'deleteContentBackward', data: null } as const
    send({ type: 'beforeinput', ...deleted, cancelable: false, field: 'Hello [there]' })
    send({ type: 'input', ...deleted, field: 'Hello |' })
    expect(typed()).toBe('Hello |')
  })

  it('cancels the browser’s own undo and redo, and gives the field its text again after one made anyway', async () => {
    const { send, frame, typed, fieldNow } = await typingWith('Hello [there]')
    send({ type: 'beforeinput', inputType: 'insertText', data: '!', cancelable: true, field: 'Hello [there]' })
    send({ type: 'input', inputType: 'insertText', data: '!', field: 'Hello !|' })
    const undo = { inputType: 'historyUndo', data: null, cancelable: true, prevented: true } as const
    send({ type: 'beforeinput', ...undo, field: 'Hello !|' })
    send({ type: 'beforeinput', ...undo, inputType: 'historyRedo', field: 'Hello !|' })
    send({ type: 'input', inputType: 'historyUndo', data: null, field: 'Hello [there]' })
    frame()
    expect(fieldNow()).toBe('Hello !|')
    expect(typed()).toBe('Hello !|')
  })

  it('commits the composition where it was composed before a press on the stage moves the caret', async () => {
    const { field, overlay, send, around, typed } = await typingWith('Hello there|')
    for (const event of PINYIN_CHROME_WINDOWS.events.slice(0, 12)) send(around(event))
    fire(page.window, 'pointerdown', { pointerType: 'mouse', target: overlay })
    expect(field.forced).toEqual([])
    expect(page.document.activeElement).toBe(field)
    expect(typed()).toBe('Hello thereni|')
  })

  it('keeps a bold word bold when the iPhone’s keyboard corrects it', async () => {
    const { e, replay, words } = await typingWith(IOS_AUTOCORRECT.start)
    e.modules.typing.styleRange({ id: 'words', range: { start: 6, end: 9 } }, { fontWeight: 700 })
    replay(IOS_AUTOCORRECT)
    expect(words()).toBe('Hello the ')
    expect((e.core.design().nodes.words?.props as { runs: unknown[] }).runs).toEqual([
      { start: 6, end: 10, style: { fontWeight: 700 } },
    ])
  })

  it('composes over the word a keyboard re-opens once no input follows in its task, and not before', async () => {
    const { e, send } = await typingWith(GBOARD_REOPEN.start)
    const reopened = GBOARD_REOPEN.events.findIndex((event) => event.type === 'frame')
    for (const event of GBOARD_REOPEN.events.slice(0, reopened)) send(event)
    expect(e.modules.typing.composition().composed).toBeNull()
    send(GBOARD_REOPEN.events[reopened] as FieldEvent)
    expect(e.modules.typing.composition().composed?.layer.props).toMatchObject({ text: 'Hello there' })
    expect(e.modules.typing.shown()?.composition).toHaveLength(1)
  })

  it('moves the text’s caret with the keyboard’s space-bar cursor, and writes nothing', async () => {
    const { e, replay } = await typingWith(GBOARD_SPACE_CURSOR.start)
    const design = e.core.session.design()
    replay(GBOARD_SPACE_CURSOR)
    expect(e.core.session.design()).toBe(design)
  })

  it('lands each correction as one change of the text', async () => {
    const cases = [
      [IOS_AUTOCORRECT, ['Hello teh', 'Hello the', 'Hello the ']],
      [GBOARD_AUTOCORRECT, ['Hello there', 'Hello there ', 'Hello there world', 'Hello there world ']],
      [GBOARD_REOPEN, ['Hello there ', 'Hello there', 'Hello these', 'Hello these ']],
    ] as const
    for (const [sequence, seen] of cases) {
      const { send, frame, words } = await typingWith(sequence.start)
      const texts = [words()]
      for (const event of sequence.events) {
        send(event)
        if (event.type === 'keyup') frame()
        if (texts.at(-1) !== words()) texts.push(words())
      }
      expect(texts, sequence.name).toEqual(seen)
    }
  })

  it('is given new text at once when its own caret comes near an edge of what it holds', async () => {
    const { send, fieldNow, typed } = await typingWith(`${'a'.repeat(5_000)}|`)
    expect(fieldNow()).toBe(`${'a'.repeat(1_000)}|`)
    send({ type: 'selectionchange', field: `${'a'.repeat(30)}|${'a'.repeat(970)}` })
    expect(fieldNow()).toBe(`${'a'.repeat(1_000)}|${'a'.repeat(970)}`)
    expect(typed()).toBe(`${'a'.repeat(4_030)}|${'a'.repeat(970)}`)
  })

  it('sends a selection the field moved before the next event reads it, though its selectionchange is still to come', async () => {
    const composed = await typingWith('Hello there|')
    composed.e.modules.typing.styleRange({ id: 'words', range: { start: 9, end: 11 } }, { fontWeight: 700 })
    composed.field.hold('Hello th|ere')
    composed.send({ type: 'compositionstart', data: '', field: 'Hello th|ere' })
    composed.send({
      type: 'input',
      inputType: 'insertCompositionText',
      data: 'x',
      isComposing: true,
      field: 'Hello thx|ere',
    })
    composed.send({ type: 'compositionend', data: 'x', field: 'Hello thx|ere' })
    expect(composed.words()).toBe('Hello thxere')
    expect((composed.e.core.design().nodes.words?.props as { runs: unknown[] }).runs).toEqual([
      { start: 10, end: 12, style: { fontWeight: 700 } },
    ])
    const deleted = await typingWith('Hello there|')
    deleted.field.hold('Hello th|ere')
    const backspace = { inputType: 'deleteContentBackward', data: null, cancelable: true, prevented: true } as const
    deleted.send({ type: 'beforeinput', ...backspace, field: 'Hello th|ere' })
    expect(deleted.typed()).toBe('Hello t|ere')
  })

  it('holds a line break written as \\r or \\r\\n as the text area does, one unit for each, and types at the caret', async () => {
    const { e, send, fieldNow, frame, typed } = await typingWith('a\r\nb|\rc')
    e.modules.typing.styleRange({ id: 'words', range: { start: 3, end: 4 } }, { fontWeight: 700 })
    frame()
    expect(fieldNow()).toBe('a\n\nb|\nc')
    send({ type: 'input', inputType: 'insertText', data: 'x', field: 'a\n\nbx|\nc' })
    frame()
    expect(fieldNow()).toBe('a\n\nbx|\nc')
    expect((e.core.design().nodes.words?.props as { runs: unknown[] }).runs).toEqual([
      { start: 3, end: 5, style: { fontWeight: 700 } },
    ])
    expect(typed()).toBe('a\r\nbx|\rc')
  })

  it('is out of the accessibility tree once typing stops, and in it while a text is edited', async () => {
    const { e, field } = await typingWith('Hello there|')
    expect(field.getAttribute('aria-hidden')).toBe(null)
    e.keys.press('Escape')
    expect(field.getAttribute('aria-hidden')).toBe('true')
  })

  it('leaves suggestions, autocorrect and capitals to the keyboard’s own settings, and turns off spellchecking', async () => {
    const { field } = await typingWith('Hello there|')
    expect(['autocomplete', 'autocorrect', 'autocapitalize'].filter((name) => field.hasAttribute(name))).toEqual([])
    expect([field.getAttribute('spellcheck'), field.getAttribute('data-gramm')]).toEqual(['false', 'false'])
  })

  it('moves the field’s selection with an arrow key typing takes, and sends nothing back', async () => {
    const { e, field, fieldNow } = await typingWith('Hello there|')
    const sent = vi.spyOn(e.core.input, 'fieldChanged')
    const given = field.value
    e.keys.press('ArrowLeft')
    expect(fieldNow()).toBe('Hello ther|e')
    fire(field, 'selectionchange')
    expect(field.value).toBe(given)
    expect(sent).not.toHaveBeenCalled()
  })

  it('keeps a selection made with Shift running backward, in the field and in the text', async () => {
    const { e, field, frame, typed } = await typingWith('Hello there|')
    e.keys.press('Shift+ArrowLeft')
    e.keys.press('Shift+ArrowLeft')
    expect(field.selectionDirection).toBe('backward')
    fire(field, 'selectionchange')
    frame()
    e.keys.press('Shift+ArrowLeft')
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([8, 11, 'backward'])
    expect(typed()).toBe('Hello th[ere]')
  })

  it('still takes a Hindi vowel sign alone for a delete that came with no key', async () => {
    const { send, typed } = await typingWith('Hello नमस्ते|')
    const deleted = { inputType: 'deleteContentBackward', data: null, cancelable: true, prevented: true } as const
    send({ type: 'beforeinput', ...deleted, field: 'Hello नमस्ते|' })
    expect(typed()).toBe('Hello नमस्त|')
  })

  it('deletes back in the text being edited for a delete that came with no key, and puts nothing in the field, on a bare page', () => {
    const { sent, fire } = bareField()
    expect(fire('beforeinput', { inputType: 'deleteContentBackward', cancelable: true })).toBe(true)
    expect(sent).toEqual(['delete back'])
  })

  it('deletes nothing while an input method composes, on a bare page', () => {
    const { sent, fire } = bareField()
    fire('compositionstart')
    expect(fire('beforeinput', { inputType: 'deleteContentBackward', cancelable: true })).toBe(true)
    expect(sent).toEqual([])
  })
})
