import { afterEach, describe, expect, it, vi } from 'vitest'

import { inField, isControl, labelTextAt, onMac, stageHasKeys, starAt } from './dom-input.ts'
import { BODY, Element, harness, keyEvent, mouseEvent, Part, part, pointerEvent } from './test-dom-input.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editorDomInput', () => {
  describe("the canvas's pointer events", () => {
    it('sends each of the nine as a pointer input of its type, at its stage point', () => {
      const types = [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
        'lostpointercapture',
        'pointerleave',
        'click',
        'dblclick',
        'wheel',
      ]
      const { log, pointers, send } = harness()
      for (const type of types) send(type, pointerEvent(log))
      expect(pointers.map((e) => e.type)).toEqual(types)
      for (const e of pointers) expect(e.at).toEqual({ x: 100, y: 200 })
      expect(log).toEqual([])
    })

    it('carries the button, the click count and each of the four keys held', () => {
      const { log, pointers, send } = harness()
      send('pointerdown', pointerEvent(log, { button: 1 }))
      expect(pointers[0]).toMatchObject({ button: 1, detail: 0 })
      send('click', pointerEvent(log, { detail: 3 }))
      expect(pointers[1]).toMatchObject({ button: 0, detail: 3 })
      for (const held of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) {
        send('pointermove', pointerEvent(log, { [held]: true }))
        expect(pointers.at(-1)).toMatchObject({
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          [held]: true,
        })
      }
    })

    it("carries the pointer's type, a mouse's for an event that names none", () => {
      const { log, pointers, send } = harness()
      send('pointerdown', pointerEvent(log, { pointerType: 'touch' }))
      send('pointerdown', pointerEvent(log, { pointerType: 'pen' }))
      send('dblclick', mouseEvent(log))
      expect(pointers.map((e) => e.pointerType)).toEqual(['touch', 'pen', 'mouse'])
    })

    it("carries the frame whose label's text is under a press and a double click, and under no other event", () => {
      const { log, pointers, send } = harness()
      const onLabel = { clientX: 20, clientY: 86 }
      for (const type of ['pointerdown', 'dblclick', 'pointermove', 'pointerup', 'click'])
        send(type, pointerEvent(log, onLabel))
      expect(pointers.map((e) => e.label)).toEqual(['sq', 'sq', undefined, undefined, undefined])
      send('pointerdown', pointerEvent(log, { clientX: 120, clientY: 86 }))
      expect(pointers.at(-1)).not.toHaveProperty('label')
    })

    it("carries the frame whose label's star is under a press and a double click, and under no other event", () => {
      const { log, pointers, send } = harness()
      const onStar = { clientX: 50, clientY: 86 }
      for (const type of ['pointerdown', 'dblclick', 'pointermove', 'pointerup', 'click'])
        send(type, pointerEvent(log, onStar))
      expect(pointers.map((e) => e.star)).toEqual(['sq', 'sq', undefined, undefined, undefined])
      send('pointerdown', pointerEvent(log, { clientX: 20, clientY: 86 }))
      expect(pointers.at(-1)).not.toHaveProperty('star')
    })

    it('carries a label on a press on its star, and none on a double click there, which renames nothing', () => {
      const { log, pointers, send } = harness()
      const onStar = { clientX: 50, clientY: 86 }
      send('pointerdown', pointerEvent(log, onStar))
      send('dblclick', mouseEvent(log, onStar))
      expect(pointers.map((e) => [e.label, e.title])).toEqual([
        ['sq', undefined],
        [undefined, undefined],
      ])
    })

    it('carries how far a wheel turned in each of its modes, and no turn on any other event', () => {
      const { log, pointers, send } = harness()
      for (const deltaMode of [0, 1, 2]) send('wheel', mouseEvent(log, { deltaX: 3, deltaY: -4, deltaMode }))
      expect(pointers.map((e) => [e.deltaX, e.deltaY, e.deltaMode])).toEqual([
        [3, -4, 0],
        [3, -4, 1],
        [3, -4, 2],
      ])
      send('pointermove', pointerEvent(log))
      expect(pointers.at(-1)).not.toHaveProperty('deltaMode')
    })

    it('keeps the browser from an event the editor answers was its own, and from no other', () => {
      const own = harness({ handled: true })
      own.send('wheel', mouseEvent(own.log, { deltaX: 0, deltaY: 1, deltaMode: 0 }))
      own.send('pointerdown', pointerEvent(own.log))
      expect(own.log).toEqual(['prevent', 'prevent'])
      const other = harness()
      other.send('pointerdown', pointerEvent(other.log))
      expect(other.log).toEqual([])
    })

    it('captures the pointer of an event the editor answers to hold, and of no other', () => {
      const held = harness({ hold: true })
      held.send('pointerdown', pointerEvent(held.log))
      expect(held.log).toEqual(['capture 7'])
      const free = harness()
      free.send('pointerdown', pointerEvent(free.log))
      expect(free.log).toEqual([])
      // A double click and a wheel name no pointer to capture.
      held.log.length = 0
      held.send('dblclick', mouseEvent(held.log))
      held.send('wheel', mouseEvent(held.log, { deltaX: 0, deltaY: 1, deltaMode: 0 }))
      expect(held.log).toEqual([])
    })

    it('listens to the wheel as one whose scroll the editor may keep from the browser', () => {
      const { canvasOptions } = harness()
      expect(canvasOptions.get('wheel')).toMatchObject({ passive: false })
    })

    it('sends a lost capture as it comes, capturing nothing for it', () => {
      const { log, pointers, send } = harness()
      send('lostpointercapture', pointerEvent(log))
      expect(pointers).toMatchObject([{ type: 'lostpointercapture', at: { x: 100, y: 200 } }])
      expect(log).toEqual([])
    })
  })

  describe('the cursor', () => {
    it('shows on the canvas the cursor the editor shows as it starts', () => {
      const { cursor } = harness({ cursor: 'crosshair' })
      expect(cursor()).toBe('crosshair')
    })

    it('shows on the canvas the cursor the editor tells of, each time it changes', () => {
      const { cursor, showCursor } = harness()
      expect(cursor()).toBe('')
      showCursor()('grab')
      expect(cursor()).toBe('grab')
      showCursor()('')
      expect(cursor()).toBe('')
    })
  })

  describe("the window's keys", () => {
    it('sends each key pressed and let go as a key input, with its code, its key, the keys held and whether it repeats', () => {
      const { log, keys, hear, press } = harness()
      press('KeyA', BODY, { key: 'a', repeat: true })
      for (const held of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) press('KeyA', BODY, { key: 'a', [held]: true })
      hear('keyup', keyEvent(log, 'KeyA', BODY, { key: 'a' }))
      expect(keys[0]).toMatchObject({ type: 'keydown', code: 'KeyA', key: 'a', repeat: true, shiftKey: false })
      expect(keys.slice(1, 5).map((e) => [e.shiftKey, e.altKey, e.ctrlKey, e.metaKey].indexOf(true))).toEqual([
        0, 1, 2, 3,
      ])
      expect(keys.at(-1)).toMatchObject({ type: 'keyup', code: 'KeyA', repeat: false })
      expect(log).toEqual([])
    })

    it('keeps the browser from a key the editor answers was its own, and from no other', () => {
      const own = harness({ handled: true })
      own.press('Space')
      expect(own.log).toEqual(['prevent'])
      const other = harness()
      other.press('Space')
      expect(other.log).toEqual([])
    })

    it('keeps the browser from a key the editor answers was its own, then throws on what the editor threw doing it', () => {
      const thrown = new Error('the command could not be applied')
      const { log, press } = harness({ handled: true, thrown })
      expect(() => press('KeyZ', BODY, { key: 'z', ctrlKey: true })).toThrow(thrown)
      expect(log).toEqual(['prevent'])
    })

    it('says a key pressed with nothing focused is on the stage, in no field, dialog or toolbar and on no button', () => {
      const { press } = harness()
      const stage = {
        field: false,
        control: false,
        dialog: 'none',
        toolbarArrow: false,
        buttonEnter: false,
        stage: true,
      }
      expect(press('Enter')?.target).toEqual(stage)
      expect(press('Enter', null)?.target).toEqual(stage)
    })

    it('sends a key event that names no key, as a browser fills a field in with, and asks nothing of the missing key', () => {
      const { press } = harness()
      const filled = press('', new Element('INPUT'), { key: undefined })
      expect(filled?.target).toMatchObject({ field: true, toolbarArrow: false, buttonEnter: false })
    })

    it('says a key is pressed in a field', () => {
      const { press } = harness()
      expect(press('KeyA', new Element('INPUT'))?.target).toMatchObject({ field: true, dialog: 'none', stage: false })
      expect(press('KeyA', new Element('TEXTAREA'))?.target).toMatchObject({ field: true })
      expect(press('KeyA', new Element('DIV'))?.target).toMatchObject({ field: false, stage: false })
    })

    it('says a key is pressed in a modal dialog, a popover or a menu, or in what they hold', () => {
      const { press } = harness()
      const dialog = new Element('DIV', { role: 'dialog' })
      expect(press('Escape', dialog)?.target.dialog).toBe('modal')
      expect(press('Escape', new Element('INPUT', {}, dialog))?.target).toMatchObject({ dialog: 'modal', field: true })
      expect(press('Escape', new Element('DIV', {}, new Element('DIV', { role: 'menu' })))?.target.dialog).toBe('modal')
      expect(press('Escape', new Element('DIALOG'))?.target.dialog).toBe('modal')
      expect(press('Escape', new Element('DIV', { role: 'dialog', 'aria-modal': 'true' }))?.target.dialog).toBe('modal')
    })

    it('says a key is pressed in a dialog that is not modal, as the edit panel says it is not', () => {
      const { press } = harness()
      const panel = new Element('SECTION', { role: 'dialog', 'aria-modal': 'false' })
      expect(press('Space', panel)?.target.dialog).toBe('modeless')
      expect(press('Space', new Element('DIV', {}, panel))?.target.dialog).toBe('modeless')
    })

    it('says a key is pressed on a control that space presses when the focus reached it after a key, as Tab moves it', () => {
      const { hear, press } = harness()
      const button = new Element('BUTTON')
      const item = new Element('DIV', { role: 'treeitem' })
      // Nothing has moved the focus yet.
      expect(press('Space', button)?.target.control).toBe(false)
      press('Tab')
      hear('focusin', { type: 'focusin' }, true)
      expect(press('Space', button)?.target.control).toBe(true)
      expect(press('Space', item)?.target.control).toBe(true)
      // The edit panel takes the focus as it opens and is no control, and a field is its own fact.
      expect(press('Space', new Element('SECTION', { role: 'dialog' }))?.target.control).toBe(false)
      expect(press('Space', new Element('INPUT'))?.target).toMatchObject({ control: false, field: true })
    })

    it('says a control is none when the focus reached it after a pointer press, as a menu gives its button back after a pick', () => {
      const { hear, press } = harness()
      const button = new Element('BUTTON')
      press('Tab')
      hear('focusin', { type: 'focusin' }, true)
      hear('pointerdown', { type: 'pointerdown' }, true)
      hear('focusin', { type: 'focusin' }, true)
      // A key pressed since does not move the focus.
      press('ShiftLeft')
      expect(press('Space', button)?.target.control).toBe(false)
    })

    it('says an arrow is pressed in a toolbar, and no other key there nor an arrow elsewhere', () => {
      const { press } = harness()
      const item = new Element('BUTTON', {}, new Element('DIV', { role: 'toolbar' }))
      expect(press('ArrowRight', item)?.target.toolbarArrow).toBe(true)
      expect(press('KeyA', item)?.target.toolbarArrow).toBe(false)
      expect(press('ArrowRight', new Element('BUTTON'))?.target.toolbarArrow).toBe(false)
    })

    it('says Enter is pressed on a button or in one, and no other key there nor Enter elsewhere', () => {
      const { press } = harness()
      const button = new Element('BUTTON')
      expect(press('Enter', button)?.target.buttonEnter).toBe(true)
      expect(press('Enter', new Element('SPAN', {}, button))?.target.buttonEnter).toBe(true)
      expect(press('Space', button)?.target.buttonEnter).toBe(false)
      expect(press('Enter', new Element('DIV', { role: 'button' }))?.target.buttonEnter).toBe(false)
    })
  })

  describe('paused', () => {
    it('hands the editor no key while paused, Escape included, and keeps the browser from none; then all again', () => {
      let paused = true
      const { log, keys, escapes, hear, press } = harness({ handled: true, escape: true, paused: () => paused })
      press('Delete')
      press('KeyZ', BODY, { key: 'z', ctrlKey: true })
      press('Escape')
      hear('keyup', keyEvent(log, 'Delete'))
      expect([keys, escapes, log]).toEqual([[], [], []])
      paused = false
      press('Delete')
      expect(keys.map((k) => k.code)).toEqual(['Delete'])
      expect(log).toEqual(['prevent'])
    })
  })

  describe('Escape during a drag', () => {
    it("asks the editor of each key going down the page, before the page's own listeners hear it", () => {
      const { log, escapes, keys, hear } = harness()
      hear('keydown', keyEvent(log, 'Escape'), true)
      expect(escapes).toMatchObject([{ type: 'keydown', code: 'Escape' }])
      expect(keys).toEqual([])
      expect(log).toEqual([])
    })

    it('keeps the key from the browser and from every other listener when the editor answers it dropped a drag', () => {
      const { log, hear } = harness({ escape: true })
      hear('keydown', keyEvent(log, 'Escape'), true)
      expect(log).toEqual(['prevent', 'stop'])
    })

    it('never counts an Escape that dropped a drag as a key that moved the focus', () => {
      const { hear, press } = harness({ escape: true })
      const button = new Element('BUTTON')
      hear('pointerdown', { type: 'pointerdown' }, true)
      press('Escape')
      hear('focusin', { type: 'focusin' }, true)
      expect(press('Space', button)?.target.control).toBe(false)
    })
  })

  describe('the window losing the focus', () => {
    it('tells the editor', () => {
      const { log, hear } = harness()
      hear('blur', {})
      expect(log).toEqual(['blur'])
    })
  })
})

describe('inField', () => {
  it('says a key is typed into a field: an input, a text area, a select or what can be edited in place', () => {
    vi.stubGlobal('HTMLElement', Part)
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) expect(inField(part(tag))).toBe(true)
    expect(inField(part('DIV', null, true))).toBe(true)
    expect(inField(part('BUTTON'))).toBe(false)
    expect(inField(part('DIV'))).toBe(false)
    expect(inField(null)).toBe(false)
  })
})

describe('onMac', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("says the computer is Apple's by the platform the browser names: a Mac, an iPhone or an iPad", () => {
    for (const platform of ['MacIntel', 'iPhone', 'iPad']) {
      vi.stubGlobal('navigator', { platform })
      expect(onMac()).toBe(true)
    }
    for (const platform of ['Win32', 'Linux x86_64']) {
      vi.stubGlobal('navigator', { platform })
      expect(onMac()).toBe(false)
    }
  })

  it('says it is not where there is no browser', () => {
    vi.stubGlobal('navigator', undefined)
    expect(onMac()).toBe(false)
  })
})

describe('isControl', () => {
  it('says an element is a control that space presses or ticks, by its tag or its role, and a field is none', () => {
    for (const tag of ['A', 'BUTTON', 'SUMMARY']) expect(isControl(part(tag))).toBe(true)
    for (const role of ['button', 'checkbox', 'menuitem', 'option', 'slider', 'switch', 'tab', 'treeitem'])
      expect(isControl(part('DIV', role))).toBe(true)
    expect(isControl(part('SECTION', 'dialog'))).toBe(false)
    expect(isControl(part('INPUT'))).toBe(false)
    expect(isControl(part('DIV'))).toBe(false)
    expect(isControl(null)).toBe(false)
  })
})

describe('stageHasKeys', () => {
  it('says the stage has the keys while nothing on the page has the focus', () => {
    const page: { body?: object } = {}
    const body = { tagName: 'BODY', ownerDocument: page }
    page.body = body
    const button = { tagName: 'BUTTON', ownerDocument: page }
    expect(stageHasKeys(body as unknown as EventTarget)).toBe(true)
    expect(stageHasKeys(null)).toBe(true)
    expect(stageHasKeys(button as unknown as EventTarget)).toBe(false)
  })
})

describe('labelTextAt', () => {
  /** A box in client pixels, as getBoundingClientRect gives it. */
  const box = (left: number, top: number, width: number, height = 20) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  })
  /** A label as the overlay draws one: its row, then its name and its size, each where it shows. */
  const label = (frame: string, row: ReturnType<typeof box>, ...texts: ReturnType<typeof box>[]) => ({
    dataset: { frame },
    getBoundingClientRect: () => row,
    children: texts.map((text) => ({ getBoundingClientRect: () => text })),
  })
  /** An overlay holding labels, in the order it drew them. */
  const overlay = (...labels: ReturnType<typeof label>[]) =>
    ({ querySelectorAll: () => labels }) as unknown as ParentNode
  // A over B's start: A's name at 0–40 and its size at 220–300; B's name at 200–230, its size wrapped
  // onto the hidden second line.
  const a = label('a', box(0, 76, 300), box(0, 76, 40), box(220, 76, 80))
  const b = label('b', box(200, 76, 300), box(200, 76, 30), box(200, 96, 80))

  it('finds the frame whose name or size is under a client point, the last drawn where labels overlap', () => {
    expect(labelTextAt(overlay(a, b), { x: 20, y: 86 })).toBe('a')
    expect(labelTextAt(overlay(a, b), { x: 260, y: 86 })).toBe('a')
    expect(labelTextAt(overlay(a, b), { x: 210, y: 86 })).toBe('b')
  })

  it("finds none beside the text on the label's row, under a size that wrapped out of sight, or off the row", () => {
    expect(labelTextAt(overlay(a, b), { x: 120, y: 86 })).toBeUndefined()
    expect(labelTextAt(overlay(a, b), { x: 450, y: 86 })).toBeUndefined()
    expect(labelTextAt(overlay(a, b), { x: 20, y: 100 })).toBeUndefined()
    expect(labelTextAt(overlay(), { x: 20, y: 86 })).toBeUndefined()
  })
})

describe('starAt', () => {
  /** A star as the overlay draws one, after its frame's name: 12 px square at `left`, 80 down. */
  const star = (frame: string, left: number) => ({
    getAttribute: (name: string) => (name === 'data-frame' ? frame : null),
    getBoundingClientRect: () => ({ left, top: 80, right: left + 12, bottom: 92, width: 12, height: 12 }),
  })
  /** An overlay holding stars, in the order it drew them. */
  const overlay = (...stars: ReturnType<typeof star>[]) => ({ querySelectorAll: () => stars }) as unknown as ParentNode

  it('finds the frame whose star is under a client point, the last drawn where stars overlap', () => {
    expect(starAt(overlay(star('a', 40), star('b', 200)), { x: 45, y: 86 })).toBe('a')
    expect(starAt(overlay(star('a', 40), star('b', 200)), { x: 212, y: 92 })).toBe('b')
    expect(starAt(overlay(star('a', 40), star('b', 46)), { x: 50, y: 86 })).toBe('b')
  })

  it('finds none beside a star, or with none drawn', () => {
    expect(starAt(overlay(star('a', 40)), { x: 30, y: 86 })).toBeUndefined()
    expect(starAt(overlay(star('a', 40)), { x: 45, y: 95 })).toBeUndefined()
    expect(starAt(overlay(), { x: 45, y: 86 })).toBeUndefined()
  })
})
