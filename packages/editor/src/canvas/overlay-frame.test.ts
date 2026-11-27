import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fake, harness } from './test-overlay.ts'

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editorOverlay', () => {
  describe('draw', () => {
    it('draws the four corner handles on the picked frame that shows them, and says which corners and edges a press grabs', () => {
      const { overlay, part } = harness({ selected: false, picked: true, frameHandles: true })
      overlay.draw()
      const picked = part('frame-picked')
      expect(picked?.dataset).toEqual({ frame: 'one-sq', handles: 'nw n ne e se s sw w' })
      expect(picked?.children.map((h) => [h.className, h.dataset.handle, h.style.left, h.style.top])).toEqual([
        ['handle', 'nw', '0%', '0%'],
        ['handle', 'ne', '100%', '0%'],
        ['handle', 'se', '100%', '100%'],
        ['handle', 'sw', '0%', '100%'],
      ])
    })

    it('draws a sheen over each frame in view that waits for its AI picture, and none once it waits no more', () => {
      let waiting = ['one-sq']
      const { overlay, part } = harness({ selected: false }, (deps) => ({ ...deps, aiWaiting: () => waiting }))
      overlay.draw()
      expect(part('ai-waiting')?.dataset).toEqual({ frame: 'one-sq' })
      waiting = []
      overlay.draw()
      expect(part('ai-waiting')).toBeUndefined()
    })

    it('draws a veil and each lifting piece over a frame whose pieces are being matched, in place of its sheen', () => {
      const pieces = [
        { url: 'blob:low', box: { x: 0, y: 50, width: 100, height: 20 } },
        { url: 'blob:high', box: { x: 10, y: 10, width: 30, height: 30 } },
      ]
      let lifting = [{ frameId: 'one-sq', pieces }]
      const { overlay, part, parts } = harness({ selected: false }, (deps) => ({
        ...deps,
        aiWaiting: () => ['one-sq'],
        aiLifting: () => lifting,
      }))
      overlay.draw()
      expect(part('ai-waiting')).toBeUndefined()
      expect(part('ai-lift-veil')?.dataset).toEqual({ frame: 'one-sq' })
      const lifted = parts('ai-lift')
      expect(lifted.map((el) => (el as unknown as { src: string }).src)).toEqual(['blob:low', 'blob:high'])
      // The piece higher in the frame lifts higher, by steps that follow the frame's size on the screen.
      const lifts = lifted.map((el) => Number.parseFloat((el.attributes.style ?? '').replace('--lift: ', '')))
      expect(lifts[0]).toBeGreaterThan(0)
      expect(lifts[1]).toBe(2 * (lifts[0] ?? 0))
      // Drawn again, a piece keeps its picture's element, so its picture isn't loaded twice.
      overlay.draw()
      expect(parts('ai-lift')).toEqual(lifted)
      lifting = []
      overlay.draw()
      expect(part('ai-lift-veil')).toBeUndefined()
      expect(part('ai-waiting')?.dataset).toEqual({ frame: 'one-sq' })
    })

    it('draws no handles on a picked frame that shows none', () => {
      const { overlay, part } = harness({ selected: false, picked: true })
      overlay.draw()
      expect(part('frame-picked')?.dataset).toEqual({ frame: 'one-sq' })
      expect(part('frame-picked')?.children).toEqual([])
    })
  })
})
