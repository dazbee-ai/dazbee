import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { svgToLayers } from '@dazbee/svg'

import { type PatternEntry, patternsOf, patternTile, tiledPattern } from './pattern-tile.ts'

const ck = await loadCanvasKit()

/** A pattern of lines across a 20 × 10 tile, one path, stroked. */
const LINES: PatternEntry = {
  title: 'Lines - 1',
  slug: 'lines-1',
  mode: 'stroke',
  width: 20,
  height: 10,
  tags: ['lines'],
  path: "<path d='M0 5h20'/>",
}
/** A pattern of two dots in a 10 × 10 tile, each path filled in its own colour. */
const DOTS: PatternEntry = {
  title: 'Circles - 1',
  slug: 'circles-1',
  mode: 'fill',
  width: 10,
  height: 10,
  tags: ['circles'],
  path: "<path d='M2 2h2v2h-2z'/>~<path d='M6 6h2v2h-2z'/>",
}

describe('patternsOf', () => {
  it('reads the patterns the site’s index file lists', () => {
    const index = `const index = ${JSON.stringify([LINES, DOTS])}; export default index;`
    expect(patternsOf(index).map(({ slug }) => slug)).toEqual(['lines-1', 'circles-1'])
  })
})

describe('patternTile', () => {
  it('writes the tile as the site’s download writes it in its default light colours', () => {
    expect(patternTile(DOTS)).toBe(
      "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'>" +
        "<rect x='0' y='0' width='100%' height='100%' fill='hsla(0,0%,100%,1)'/>" +
        "<path d='M2 2h2v2h-2z'  stroke-width='1' stroke='none' fill='hsla(258.5,59.4%,59.4%,1)'/>" +
        "<path d='M6 6h2v2h-2z'  stroke-width='1' stroke='none' fill='hsla(339.6,82.2%,51.6%,1)'/></svg>",
    )
    expect(patternTile(LINES)).toContain("stroke-width='1' stroke='hsla(258.5,59.4%,59.4%,1)' fill='none'/>")
  })
})

describe('tiledPattern', () => {
  it('repeats the tile over the box as one filled shape per path, cut to the box, over its backdrop', () => {
    const svg = tiledPattern(ck, patternTile(DOTS), { width: 108, height: 54 })
    const read = svgToLayers(ck, svg, { name: 'Dots' })
    expect([read.width, read.height]).toEqual([108, 54])
    expect(read.skipped).toEqual([])
    const shapes = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"\/>/g)]
    expect(shapes.map(([, , fill]) => fill)).toEqual(['hsla(258.5,59.4%,59.4%,1)', 'hsla(339.6,82.2%,51.6%,1)'])
    // Its repeats fill the box from edge to edge, and none reaches past it.
    const path = ck.Path.MakeFromSVGString(shapes[0]?.[1] ?? '')
    const [left = 0, top = 0, right = 0, bottom = 0] = path?.getBounds() ?? []
    expect([left >= 0, top >= 0, left < 8, top < 8]).toEqual([true, true, true, true])
    expect([right <= 108, bottom <= 54, right > 100, bottom > 46]).toEqual([true, true, true, true])
    path?.delete()
    expect(svg).toContain('<rect width="108" height="54" fill="hsla(0,0%,100%,1)"/>')
  })

  it('draws the paths in the colour given, the backdrop in its own, another or none', () => {
    const tile = patternTile(LINES)
    const coloured = tiledPattern(ck, tile, { width: 100, height: 100 }, { paths: '#e4572e', backdrop: '#102030' })
    expect(coloured).toContain('fill="#e4572e"')
    expect(coloured).toContain('<rect width="100" height="100" fill="#102030"/>')
    const bare = tiledPattern(ck, tile, { width: 100, height: 100 }, { backdrop: null })
    expect(bare).not.toContain('<rect width="100" height="100" fill=')
    expect(bare).toContain('fill="hsla(258.5,59.4%,59.4%,1)"')
  })

  it('draws a small tile larger on a big box, so the repeats stay within the limits', () => {
    const tile = patternTile(DOTS)
    const svg = tiledPattern(ck, tile, { width: 8000, height: 8000 })
    const points = [...svg.matchAll(/<path d="([^"]+)"/g)].reduce((sum, [, d = '']) => {
      const path = ck.Path.MakeFromSVGString(d)
      const count = path?.countPoints() ?? 0
      path?.delete()
      return sum + count
    }, 0)
    expect(points).toBeLessThanOrEqual(200_000)
  })

  it('keeps a very thin box’s repeats within the limits, drawing the tile larger', () => {
    const tile = patternTile(LINES)
    for (const box of [
      { width: 0.001, height: 100_000 },
      { width: 100_000, height: 0.001 },
    ]) {
      const svg = tiledPattern(ck, tile, box)
      expect(svg.length).toBeLessThan(1_000_000)
    }
  })

  it('refuses a colour given that isn’t #rrggbb', () => {
    expect(() => tiledPattern(ck, patternTile(LINES), { width: 10, height: 10 }, { paths: 'red"/><x a="' })).toThrow(
      /#rrggbb/,
    )
  })

  it('refuses a file that isn’t a pattern’s tile, or a tile that paints with what isn’t a colour', () => {
    expect(() => tiledPattern(ck, '<svg xmlns="http://www.w3.org/2000/svg"/>', { width: 10, height: 10 })).toThrow()
    const injected = patternTile(DOTS).replace("fill='hsla(0,0%,100%,1)'", 'fill=\'red"/><script>x</script><x a="\'')
    expect(() => tiledPattern(ck, injected, { width: 10, height: 10 })).toThrow(/isn’t a colour/)
  })
})
