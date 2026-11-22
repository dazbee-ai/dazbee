import { describe, expect, it } from 'vitest'

import { withBrandFonts } from './brand-fonts.ts'

describe('withBrandFonts', () => {
  it("leaves out the shipped files of a family the brand gives files of, and keeps the brand's after the rest", () => {
    const shipped = [
      { family: 'Noto Sans', bytes: new Uint8Array([1]) },
      { family: 'Noto Naskh Arabic', bytes: new Uint8Array([2]) },
      { family: 'Noto Naskh Arabic', bytes: new Uint8Array([3]) },
    ]
    const brand = [
      { family: 'Brand Sans', bytes: new Uint8Array([4]) },
      { family: 'Noto Naskh Arabic', bytes: new Uint8Array([5]) },
    ]
    expect(withBrandFonts(shipped, brand)).toEqual([shipped[0], ...brand])
    expect(withBrandFonts(shipped, [])).toEqual(shipped)
  })
})
