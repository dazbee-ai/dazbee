// The overlay over the text being typed into while an input method composes in it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOX, fake, harness, SQUARE } from './test-overlay.ts'

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the overlay while composing', () => {
  it('outlines the text being typed into round the box its composition draws', () => {
    const composed = { ...BOX, x: 5, y: 5, width: 300, height: 25 }
    const { overlay, part } = harness({ editing: { id: 'a', frameId: 'one-sq' } }, (deps) => ({
      ...deps,
      typing: { ...deps.typing, shown: () => ({ frame: SQUARE, range: [], caret: null, box: composed }) },
    }))
    overlay.draw()
    const stored = harness({ box: composed })
    stored.overlay.draw()
    expect(part('selection')?.style).toEqual(stored.part('selection')?.style)
    expect(part('selection')?.style.width).toBe('300px')
  })
})
