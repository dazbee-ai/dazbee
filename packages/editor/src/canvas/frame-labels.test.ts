import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { frameLabel, type FrameLabelDeps } from './frame-labels.ts'
import type { Frame } from './frames.ts'
import { fake, SQUARE } from './test-overlay.ts'

/** What a label reads with nothing selected, typed into, picked or lit, at zoom 1 with the square 100 px down. */
const deps = (more: Partial<FrameLabelDeps> = {}): FrameLabelDeps => ({
  selection: { current: () => null, pickedFrame: () => null, litFrame: () => null, renamingFrame: () => null },
  typing: { editing: () => null },
  camera: { x: 0, y: 100, zoom: 1 },
  starOffered: null,
  editable: new Set(),
  ...more,
})
const STARRED: Frame = { ...SQUARE, starred: true }
/** The parts of a label's title, the name and the star after it, each by its class and attributes. */
const titleOf = (label: ReturnType<typeof frameLabel>) =>
  (label as unknown as ReturnType<typeof fake>).children[0]?.children.map((part) => ({
    name: part.className,
    text: part.textContent,
    attributes: part.attributes,
  }))

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('frameLabel', () => {
  it("puts a starred frame's star after its name in the label's title, filled, whether or not its label offers it", () => {
    for (const starOffered of [null, 'one-sq']) {
      expect(titleOf(frameLabel(STARRED, deps({ starOffered })))).toEqual([
        { name: 'frame-name', text: 'Sale', attributes: {} },
        {
          name: 'svg',
          text: '',
          attributes: {
            class: 'frame-star',
            viewBox: '0 0 12 12',
            'aria-hidden': 'true',
            'data-frame': 'one-sq',
            'data-starred': '',
          },
        },
      ])
    }
  })

  it("puts an unstarred frame's star after its name, hollow, only while its label offers it", () => {
    expect(titleOf(frameLabel(SQUARE, deps({ starOffered: 'one-sq' })))?.[1]).toEqual({
      name: 'svg',
      text: '',
      attributes: { class: 'frame-star', viewBox: '0 0 12 12', 'aria-hidden': 'true', 'data-frame': 'one-sq' },
    })
    expect(titleOf(frameLabel(SQUARE, deps()))).toHaveLength(1)
    expect(titleOf(frameLabel(SQUARE, deps({ starOffered: 'one-story' })))).toHaveLength(1)
  })

  it('marks the label of a picked frame picked, and of a frame only holding the selection active alone', () => {
    const picked = frameLabel(SQUARE, deps({ selection: { ...deps().selection, pickedFrame: () => 'one-sq' } }))
    expect(picked?.dataset).toEqual({ frame: 'one-sq', active: '', picked: '' })
    const holding = frameLabel(
      SQUARE,
      deps({ selection: { ...deps().selection, current: () => [{ id: 'a', frameId: 'one-sq' }] } }),
    )
    expect(holding?.dataset).toEqual({ frame: 'one-sq', active: '' })
  })

  it('shows the layers icon before an editable AI frame’s name', () => {
    const label = frameLabel(SQUARE, deps({ editable: new Set([SQUARE.id]) }))
    expect(titleOf(label)?.map((part) => part.attributes.class ?? part.name)).toEqual(['frame-layers', 'frame-name'])
    expect(titleOf(frameLabel(SQUARE, deps()))?.map((part) => part.name)).toEqual(['frame-name'])
  })
})
