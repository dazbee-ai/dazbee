import { describe, expect, it } from 'vitest'

import { svgMarkup } from './sniff.ts'
import { growth, MAX_GROWTH, timesAsLong } from './test-growth.ts'

describe('svgMarkup', () => {
  it('takes markup that opens with <svg after a declaration, comments and a doctype', () => {
    expect(svgMarkup('<svg/>')).toBe('<svg/>')
    expect(
      svgMarkup(
        '\uFEFF  <?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg [<!ENTITY a "b">]>\n<svg width="1"></svg>',
      ),
    ).toMatch(/^<\?xml/)
    expect(svgMarkup('<SVG>')).toBe('<SVG>')
  })

  it('refuses anything else', () => {
    for (const text of [
      '',
      'hello',
      '<html><svg></svg></html>',
      '<svgx/>',
      '<!-- open',
      '<!DOCTYPE svg [ <svg/>',
      undefined,
    ]) {
      expect(svgMarkup(text)).toBeNull()
    }
  })

  it('checks a flood of comments in linear time', () => {
    const floods = [
      { name: 'a flood of comments before text', after: 'x', isSvg: false },
      { name: 'a flood of comments before <svg/>', after: '<svg/>', isSvg: true },
    ]
    for (const flood of floods) {
      const file = (n: number) => `${'<!--a-->'.repeat(n)}${flood.after}`
      const grown = growth(svgMarkup, file(1_000), file(10_000))
      expect(grown.result !== null, flood.name).toBe(flood.isSvg)
      expect(grown.times, flood.name).toBeLessThan(MAX_GROWTH)
      expect(svgMarkup(file(100_000)) !== null, flood.name).toBe(flood.isSvg)
    }
  })

  it('checks 4.9 MB of white space in a prolog in less than 3 times what a loop over its characters takes', () => {
    const file = `<?x?>${' '.repeat(4_900_000)}<svg/>`
    const loop = () => {
      let spaces = 0
      for (let at = 0; at < file.length; at++) if (file.charCodeAt(at) === 32) spaces++
      return spaces
    }
    const checked = timesAsLong(() => svgMarkup(file), loop)
    expect(checked.result).not.toBeNull()
    expect(checked.times).toBeLessThan(3)
  })
})
