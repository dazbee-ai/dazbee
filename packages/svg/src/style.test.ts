import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { SvgError, svgToLayers } from './convert.ts'
import { timesAsLong } from './test-growth.ts'

const ck = await loadCanvasKit()
/** A file whose element `#t`, in `body`, is read 46,656 times through three fans of 36 uses each. */
const fanned = (head: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${head}<defs>${body}<g id="f1">${'<use href="#t"/>'.repeat(36)}</g><g id="f2">${'<use href="#f1"/>'.repeat(36)}</g></defs>${'<use href="#f2"/>'.repeat(36)}<rect width="9" height="9"/></svg>`

/** Reads the file, whether it is read or refused. */
function read(text: string) {
  try {
    svgToLayers(ck, text)
  } catch (error) {
    if (!(error instanceof SvgError)) throw error
  }
}

/** How many times longer reading `text` takes than reading `plain`. */
const timesAsLongAs = (text: string, plain: string) =>
  timesAsLong(
    () => read(text),
    () => read(plain),
  ).times

describe('styleOf', () => {
  it('reads an element of 2,000 attributes, read again through every use of a fan, in less than 3 times what one of none takes', () => {
    const attributes = Array.from({ length: 2000 }, (_, i) => `a${i}=""`).join(' ')
    expect(timesAsLongAs(fanned('', `<g id="t" ${attributes}/>`), fanned('', '<g id="t"/>'))).toBeLessThan(3)
  })

  it('reads an element against 1,000 rules of a style sheet, read again through every use of a fan, in less than 3 times what it takes with no sheet', () => {
    const rules = Array.from({ length: 1000 }, (_, i) => `.c${i}{fill:red}`).join('')
    const classes = Array.from({ length: 50 }, (_, i) => `k${i}`).join(' ')
    const body = `<g id="t" class="${classes}"/>`
    expect(timesAsLongAs(fanned(`<style>${rules}</style>`, body), fanned('', body))).toBeLessThan(3)
  })

  it('applies the rules an element matches over its attributes, and inherit takes the parent’s value or keeps its own', () => {
    const read = svgToLayers(
      ck,
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><style>.a{fill:inherit}.b{fill:#00FF00}</style><g fill="#0000FF"><rect class="a" fill="#FF0000" width="9" height="9"/><rect class="b" fill="#FF0000" x="10" width="9" height="9"/></g><rect class="a" fill="#FF0000" x="20" width="9" height="9"/></svg>',
    )
    const fills = Object.values(read.tree.nodes).flatMap((n) => ('fills' in n.props ? n.props.fills : []))
    expect(fills.map((f) => (f.type === 'solid' ? f.color : f.type))).toEqual(['#0000FFFF', '#00FF00FF', '#FF0000FF'])
  })
})
