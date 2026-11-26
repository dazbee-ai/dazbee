import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectorParts } from './connector-parts.ts'
import { type Fake, fake } from './test-overlay.ts'

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('connectorParts', () => {
  it('draws nothing while nothing shows', () => {
    expect(connectorParts({ dots: [], preview: null, lit: null })).toEqual([])
  })

  it('draws each dot centred where it is, by its side', () => {
    const parts = connectorParts({
      dots: [
        { x: 50, y: -12 },
        { x: 112, y: 50 },
      ],
      preview: null,
      lit: null,
    }) as unknown as Fake[]
    expect(parts.map((p) => [p.className, p.dataset.side, p.style.left, p.style.top])).toEqual([
      ['connector-dot', '0', '50px', '-12px'],
      ['connector-dot', '1', '112px', '50px'],
    ])
  })

  it('lights a section round its outline’s corners, and draws the curve a drag draws with its arrowhead', () => {
    const curve = { from: { x: 0, y: 0 }, c1: { x: 50, y: 0 }, c2: { x: 50, y: 40 }, to: { x: 100, y: 40 } }
    const [lit, preview] = connectorParts({
      dots: [],
      preview: curve,
      lit: { box: { x: 100, y: 10, width: 200, height: 60 }, section: true },
    }) as unknown as Fake[]
    expect([lit?.className, lit?.dataset.section, lit?.style.borderRadius, lit?.style.width]).toEqual([
      'connector-target',
      '',
      '22px',
      '200px',
    ])
    expect(preview?.attributes.class).toBe('connector-preview')
    const [line, head] = (preview?.children ?? []) as Fake[]
    expect(line?.attributes.d).toBe('M 0 0 C 50 0 50 40 100 40')
    expect(head?.attributes.d).toMatch(/^M 100 40 L 91 44.5 L 91 35.5 Z$/)
  })
})
