// The stage field takes the focus as typing starts, from a touch too, in the touch's own event, so a
// phone's keyboard opens; a touch that only selects or pans leaves it where it was, and a key after
// a touch or a mouse's press takes it as they do apart from touches.

import { afterEach, describe, expect, it } from 'vitest'

import { endStandIns, fire, page, typingWith } from './test-stage-field.ts'

afterEach(endStandIns)

describe('editorStageField and the focus', () => {
  it('takes the focus in the event a touch double tap starts typing in a text, and a keyboard’s letter lands in it', async () => {
    const { e, field, touch, focused, words } = await typingWith('Hello there|')
    e.keys.press('Escape')
    expect(focused()).toBe('body')
    // The text the field holds as it takes the focus, which a keyboard opening reads.
    const atFocus: string[] = []
    const focus = field.focus.bind(field)
    field.focus = () => atFocus.push(field.value) && focus()
    touch(e.core.stagePoint(180, 850, 'sq'), { count: 2 })
    expect(e.modules.typing.editing()?.id).toBe('words')
    expect(focused()).toBe('stage field')
    expect(atFocus).toEqual(['Hello there'])
    const at = field.selectionStart
    field.hold(`${field.value.slice(0, at)}x|${field.value.slice(at)}`)
    fire(field, 'input', { inputType: 'insertText', data: 'x', isComposing: false })
    expect(words()).toBe(`${'Hello there'.slice(0, at)}x${'Hello there'.slice(at)}`)
  })

  it('takes the focus for the text tool’s tap and a double tap on another text, from the field it holds or a field of the page’s', async () => {
    const { e, pageField, touch, focused } = await typingWith('Hello there|')
    e.keys.press('Escape')
    page.document.activeElement = pageField
    e.core.setTool('text')
    touch(e.core.stagePoint(500, 250, 'sq'))
    expect(e.modules.typing.editing()?.id).not.toBe('words')
    expect(focused()).toBe('stage field')
    touch(e.core.stagePoint(180, 850, 'sq'), { count: 2 })
    expect([e.modules.typing.editing()?.id, focused()]).toEqual(['words', 'stage field'])
    e.keys.press('Escape')
    page.document.activeElement = pageField
    touch(e.core.stagePoint(180, 850, 'sq'), { count: 2 })
    expect([e.modules.typing.editing()?.id, focused()]).toEqual(['words', 'stage field'])
  })

  it('leaves the focus where it was for a touch that selects a layer or pans, and after a touch for a key that starts typing', async () => {
    const { e, touch, pressKey, focused } = await typingWith('Hello there|')
    e.keys.press('Escape')
    touch(e.core.stagePoint(150, 150, 'sq'))
    expect(e.core.selection()).toEqual(['a'])
    expect(focused()).toBe('body')
    e.core.setTool('hand')
    const camera = e.core.camera()
    touch(e.core.stagePoint(500, 250, 'sq'), { to: e.core.stagePoint(600, 350, 'sq') })
    expect(e.core.camera()).not.toEqual(camera)
    expect(focused()).toBe('body')
    e.core.setTool('select')
    touch(e.core.stagePoint(180, 850, 'sq'))
    pressKey('Enter')
    expect([e.modules.typing.editing()?.id, focused()]).toEqual(['words', 'body'])
  })

  it('keeps the focus for a tap in the text being edited, and takes it back for one once the keyboard went away with it, but not for a tap that stops typing', async () => {
    const { e, field, touch, focused } = await typingWith('Hello there|')
    e.keys.press('Escape')
    touch(e.core.stagePoint(180, 850, 'sq'), { count: 2 })
    touch(e.core.stagePoint(300, 850, 'sq'))
    expect([e.modules.typing.editing()?.id, focused()]).toEqual(['words', 'stage field'])
    // The keyboard's Done, or a panel's button taking the focus.
    field.blur()
    touch(e.core.stagePoint(400, 850, 'sq'))
    expect([e.modules.typing.editing()?.id, focused()]).toEqual(['words', 'stage field'])
    field.blur()
    touch(e.core.stagePoint(150, 150, 'sq'))
    expect([e.modules.typing.editing(), focused()]).toEqual([null, 'body'])
    expect(field.forced).toEqual([])
  })

  it('takes the focus for a mouse double click from the page’s body, and not from a field of the page’s', async () => {
    const { e, pageField, focused } = await typingWith('Hello there|')
    e.keys.press('Escape')
    const on = e.core.stagePoint(180, 850, 'sq')
    fire(page.window, 'pointerdown', { pointerType: 'mouse', target: page.document.body })
    e.mouse.dblclick(on.x, on.y)
    expect(focused()).toBe('stage field')
    e.keys.press('Escape')
    page.document.activeElement = pageField
    e.mouse.dblclick(on.x, on.y)
    expect([e.modules.typing.editing()?.id, focused()]).toEqual(['words', 'page field'])
  })
})
