import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sectionTitleParts } from './section-parts.ts'
import type { ShownSections } from './sections.ts'
import { fake } from './test-overlay.ts'

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake() })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Three outlines: one on the stage, one past its end, one lit as a drop's target. */
const SHOWN: ShownSections = {
  outlines: [
    { id: 'sale', title: 'Sale', box: { x: 10, y: 20, width: 400, height: 300 } },
    { id: 'away', title: 'Away', box: { x: 2000, y: 20, width: 400, height: 300 } },
    { id: 'new', title: 'New', box: { x: 500, y: 20, width: 200, height: 300 } },
  ],
  lit: 'new',
}
const STAGE = { width: 1280, height: 760 }

describe('sectionTitleParts', () => {
  it('draws the title of each section on the stage inside its outline top left, as wide as it leaves room for, lit while picked or a target', () => {
    const parts = sectionTitleParts(SHOWN, { picked: 'sale', renaming: null, stage: STAGE })
    expect(parts.map((p) => [p.className, p.dataset, p.textContent, p.style])).toEqual([
      ['section-title', { section: 'sale', active: '' }, 'Sale', { left: '30px', top: '34px', maxWidth: '360px' }],
      ['section-title', { section: 'new', active: '' }, 'New', { left: '520px', top: '34px', maxWidth: '160px' }],
    ])
  })

  it('leaves out the title of the section being renamed', () => {
    const parts = sectionTitleParts(SHOWN, { picked: null, renaming: 'sale', stage: STAGE })
    expect(parts.map((p) => p.dataset.section)).toEqual(['new'])
  })
})
