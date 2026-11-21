import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { svgToLayers } from './convert.ts'

const ck = await loadCanvasKit()

describe('nameOf', () => {
  it('keeps 100 characters of a long name, which every use of its element copies', () => {
    const named = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><rect id="r" data-name="${'n'.repeat(900_000)}" width="9" height="9"/></defs>${'<use href="#r"/>'.repeat(70)}</svg>`
    const names = Object.values(svgToLayers(ck, named).tree.nodes).map((n) => n.name)
    expect(Math.max(...names.map((n) => n.length))).toBe(100)
  })
})
