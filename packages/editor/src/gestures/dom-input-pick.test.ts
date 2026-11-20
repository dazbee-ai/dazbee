// The page's side of picking a colour: a press made on the canvas while picking
// keeps its release and click from bubbling past it, so a pop-up open on the page counts the press as
// taken and stays open, and a touch's ends with no click; a press anywhere else on the page but an
// eyedropper ends picking.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { editorDomInput, KEEPS_PICKING } from './dom-input.ts'

/** An element of the page with its attributes and parent, which `closest` walks up from. */
class Element {
  private readonly attributes: Record<string, string>
  private readonly parent: Element | null
  constructor(attributes: Record<string, string> = {}, parent: Element | null = null) {
    this.attributes = attributes
    this.parent = parent
  }
  /** The nearest of this element and those it is in with the attribute a selector names. */
  closest(selector: string): Element | null {
    const name = /^\[(.+)\]$/.exec(selector)?.[1] ?? ''
    return name in this.attributes ? this : (this.parent?.closest(selector) ?? null)
  }
}

/** The stage's page, with an editor picking a colour while `picking.on` is. */
function harness() {
  const picking = { on: false, stops: 0 }
  const onCanvas = new Map<string, (e: unknown) => void>()
  const onWindow: { type: string; listener: (e: unknown) => void; capture: boolean }[] = []
  const canvas = {
    style: { cursor: '' },
    addEventListener: (type: string, listener: (e: unknown) => void) => onCanvas.set(type, listener),
    setPointerCapture: () => {},
  }
  vi.stubGlobal('Element', Element)
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (e: unknown) => void, options?: { capture?: boolean }) =>
      onWindow.push({ type, listener, capture: options?.capture ?? false }),
  })
  vi.stubGlobal('document', { addEventListener: () => {} })
  editorDomInput({
    canvas: canvas as unknown as HTMLCanvasElement,
    overlay: { querySelectorAll: () => [] } as unknown as ParentNode,
    surface: { onStage: (client) => client },
    input: {
      pointer: (e) => {
        // A release picks, which ends picking.
        if (e.type === 'pointerup') picking.on = false
        return { handled: true, hold: false }
      },
      key: () => ({ handled: false }),
      text: () => false,
      deleteBackward: () => false,
      cancelOnEscape: () => false,
      blur: () => {},
      hidden: () => {},
      cursor: () => '',
      onCursor: () => () => {},
    },
    picking: {
      picking: () => picking.on,
      stop: () => {
        picking.stops += 1
        picking.on = false
      },
    },
    signal: new AbortController().signal,
  })
  /** The types of the canvas's events whose default was cancelled, of those the pointer takes none. */
  const cancelled: string[] = []
  /** Sends an event of a type the way the browser does, down the window, then to its target; says whether it went on bubbling. */
  const send = (type: string, target: unknown) => {
    let bubbles = true
    const e = {
      type,
      target,
      clientX: 10,
      clientY: 10,
      button: 0,
      detail: 1,
      pointerId: 1,
      pointerType: 'mouse',
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => {
        if (type === 'mouseup' || type === 'touchend') cancelled.push(type)
      },
      stopPropagation: () => {
        bubbles = false
      },
    }
    for (const on of onWindow) if (on.type === type && on.capture) on.listener(e)
    if (target === canvas) onCanvas.get(type)?.(e)
    return bubbles
  }
  /** A press on the canvas, down to click; what bubbled past the canvas, by type. */
  const press = () => ['pointerdown', 'pointerup', 'mouseup', 'touchend', 'click'].filter((type) => send(type, canvas))
  return { picking, canvas, send, press, cancelled }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editorDomInput while a colour is picked', () => {
  it('keeps the release and the click of a press made while picking from bubbling past the canvas, though it picked', () => {
    const { picking, press } = harness()
    picking.on = true
    expect(press()).toEqual(['pointerdown'])
    // The next press is made with picking ended, and bubbles as any does.
    expect(press()).toEqual(['pointerdown', 'pointerup', 'mouseup', 'touchend', 'click'])
  })

  it('cancels the touchend of a press made while picking, so the tap ends with no click for what shows once it ends', () => {
    const { picking, press, cancelled } = harness()
    picking.on = true
    press()
    expect(cancelled).toEqual(['touchend'])
    // The next press is made with picking ended, and ends as any does.
    press()
    expect(cancelled).toEqual(['touchend'])
  })

  it('lets a press made before picking started bubble whole', () => {
    const { picking, canvas, send } = harness()
    send('pointerdown', canvas)
    picking.on = true
    expect(['pointerup', 'mouseup', 'touchend', 'click'].filter((type) => send(type, canvas))).toEqual([
      'pointerup',
      'mouseup',
      'touchend',
      'click',
    ])
  })

  it('ends picking at a press anywhere on the page but the canvas and an eyedropper', () => {
    const { picking, canvas, send } = harness()
    picking.on = true
    send('pointerdown', canvas)
    const eyedropper = new Element({ [KEEPS_PICKING]: '' })
    send('pointerdown', new Element({}, eyedropper))
    expect(picking).toEqual({ on: true, stops: 0 })
    send('pointerdown', new Element({ role: 'button' }))
    expect(picking).toEqual({ on: false, stops: 1 })
    // Not picking, a press ends nothing.
    send('pointerdown', new Element())
    expect(picking.stops).toBe(1)
  })
})
