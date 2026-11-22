import { describe, expect, it } from 'vitest'

import { paintsWithAny, recolour } from './recolour.ts'

/** A file painting with Streamline Plump's two blues, a colour no set swaps, and a longer colour starting with one. */
const PLUMP =
  '<svg><style>.a{fill:#2859C5}</style><path fill="#2859c5"/><path fill="#8fbffa"/><stop stop-color="#2859c5"/>' +
  '<path fill="#ffffff"/><path fill="#2859c5aa"/><path id="#2859c5"/></svg>'

describe('recolour', () => {
  it('writes the first paint as the colour and the second as the same lighter mix of it, and nothing else', () => {
    expect(recolour(PLUMP, ['#2859c5', '#8fbffa'], '#e4572e')).toBe(
      '<svg><style>.a{fill:#e4572e}</style><path fill="#e4572e"/><path fill="#f3b3a0"/><stop stop-color="#e4572e"/>' +
        '<path fill="#ffffff"/><path fill="#2859c5aa"/><path id="#2859c5"/></svg>',
    )
  })

  it('writes every way a set writes its one colour (#000, black, currentColor) as the colour, strokes too', () => {
    const text = '<svg><path fill="#000"/><path stroke="black"/><path fill="currentColor"/><path fill="#fff"/></svg>'
    expect(recolour(text, ['#000', 'black', 'currentColor'], '#1a2b3c')).toBe(
      '<svg><path fill="#1a2b3c"/><path stroke="#1a2b3c"/><path fill="#1a2b3c"/><path fill="#fff"/></svg>',
    )
  })

  it('writes the first paint, and those of its colour, as `firstAs`, the others still mixed from the colour', () => {
    expect(recolour('<a fill="#000"/><a fill="black"/>', ['#000', 'black'], '#1a2b3c', '#010203')).toBe(
      '<a fill="#010203"/><a fill="#010203"/>',
    )
    expect(recolour('<a fill="#2859c5"/><a fill="#8fbffa"/>', ['#2859c5', '#8fbffa'], '#e4572e', '#010203')).toBe(
      '<a fill="#010203"/><a fill="#f3b3a0"/>',
    )
  })

  it('refuses a colour that isn’t #rrggbb', () => {
    expect(() => recolour(PLUMP, ['#2859c5'], 'red')).toThrow()
  })
})

describe('paintsWithAny', () => {
  it('tells whether the file paints with any of the colours', () => {
    expect(paintsWithAny(PLUMP, ['#8fbffa'])).toBe(true)
    expect(paintsWithAny('<path fill="#2859c5aa"/>', ['#2859c5'])).toBe(false)
    expect(paintsWithAny(PLUMP, [])).toBe(false)
  })
})
