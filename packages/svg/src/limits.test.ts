import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { SvgError, svgToLayers } from './convert.ts'
import {
  MAX_DEPTH,
  MAX_EFFECT_DEPTH,
  MAX_EFFECTS,
  MAX_LAYER_EFFECTS,
  MAX_LAYERS,
  MAX_PATH_POINTS,
  MAX_POINTS,
} from './limits.ts'
import { hugePath, NESTED_BLURS } from './test-hostile-files.ts'

const ck = await loadCanvasKit()
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`
const blur = '<filter id="b"><feGaussianBlur stdDeviation="2"/></filter>'
/** A filter that casts `count` drop shadows, each moved one pixel further down. */
const shadows = (count: number) =>
  `<filter id="s">${Array.from({ length: count }, (_, i) => `<feOffset in="SourceAlpha" dy="${i + 1}" result="r${i}"/>`).join('')}<feMerge>${Array.from({ length: count }, (_, i) => `<feMergeNode in="r${i}"/>`).join('')}<feMergeNode in="SourceGraphic"/></feMerge></filter>`
/** A path of `count` points. */
const path = (count: number, y = 0) =>
  `<path d="M0 ${y}${Array.from({ length: count - 1 }, (_, i) => `L${(i % 99) + 1} ${y + (i % 2)}`).join('')}"/>`

/** A square: an outline of 4 points. */
const square = '<rect width="9" height="9"/>'

/** Why svgToLayers refuses the file as too big, or 'read' when it reads it. */
function refusal(text: string): string {
  try {
    svgToLayers(ck, text)
  } catch (error) {
    if (error instanceof SvgError && error.problem === 'too-big') return error.detail ?? ''
    throw error
  }
  return 'read'
}

/** What `refusal` says of the file, and how long it took, in milliseconds. */
function timed(text: string) {
  const started = performance.now()
  const said = refusal(text)
  return { said, ms: performance.now() - started }
}

describe('layersPast', () => {
  it('refuses 50 nested blurs within a second, saying the blurs nest too deep', () => {
    const { said, ms } = timed(NESTED_BLURS)
    expect(said).toBe(`its blurs and shadows nest more than ${MAX_EFFECT_DEPTH} deep`)
    expect(ms).toBeLessThan(1000)
  })

  it('reads blurs and shadows nested as deep as they may be, and refuses one more', () => {
    const nested = (depth: number) =>
      svg(`${blur}${'<g filter="url(#b)">'.repeat(depth)}<rect width="9" height="9"/>${'</g>'.repeat(depth)}`)
    expect(refusal(nested(MAX_EFFECT_DEPTH))).toBe('read')
    expect(refusal(nested(MAX_EFFECT_DEPTH + 1))).toBe(`its blurs and shadows nest more than ${MAX_EFFECT_DEPTH} deep`)
  })

  it('reads layers nested as deep as they may be, and refuses one more', () => {
    // The outermost group is the root, a layer like the rest, and the square inside them is one more.
    const nested = (depth: number) =>
      svg(`${'<g>'.repeat(depth - 1)}<rect width="9" height="9"/>${'</g>'.repeat(depth - 1)}`)
    expect(refusal(nested(MAX_DEPTH))).toBe('read')
    expect(refusal(nested(MAX_DEPTH + 1))).toBe(`its layers nest more than ${MAX_DEPTH} deep`)
  })

  it('reads a layer with as many blurs and shadows as one may have, and refuses one more', () => {
    const cast = (count: number) => svg(`${shadows(count)}<rect filter="url(#s)" width="9" height="9"/>`)
    const read = svgToLayers(ck, cast(MAX_LAYER_EFFECTS))
    expect(Object.values(read.tree.nodes).map((n) => n.props.effects.length)).toContain(MAX_LAYER_EFFECTS)
    expect(refusal(cast(MAX_LAYER_EFFECTS + 1))).toBe(
      `one of its layers has more than ${MAX_LAYER_EFFECTS} blurs and shadows`,
    )
  })

  it('reads as many blurs and shadows as a file may have, and refuses one more', () => {
    const blurred = (count: number) => svg(`${blur}${'<rect filter="url(#b)" width="9" height="9"/>'.repeat(count)}`)
    expect(refusal(blurred(MAX_EFFECTS))).toBe('read')
    expect(refusal(blurred(MAX_EFFECTS + 1))).toBe(`it has more than ${MAX_EFFECTS} blurs and shadows`)
  })

  it('refuses a file of more layers than it may have, saying how many it may', () => {
    // Each square is a layer, and so is the group holding them.
    const squares = (count: number) => svg('<rect width="9" height="9"/>'.repeat(count))
    expect(refusal(squares(MAX_LAYERS - 1))).toBe('read')
    expect(refusal(squares(MAX_LAYERS))).toBe('it has more than 5,000 layers')
  })
})

describe('pointsPast', () => {
  it('refuses one path of 630,000 points within a second, saying a path has too many points', () => {
    const { said, ms } = timed(hugePath())
    expect(said).toBe('one of its paths has more than 250,000 points')
    expect(ms).toBeLessThan(1000)
  })

  it('reads a path of as many points as one may have, and refuses one more', () => {
    expect(refusal(svg(path(MAX_PATH_POINTS)))).toBe('read')
    expect(refusal(svg(path(MAX_PATH_POINTS + 1)))).toBe('one of its paths has more than 250,000 points')
  })

  it('reads paths of as many points in all as a file may have, and refuses one more', () => {
    const half = MAX_POINTS / 2
    expect(refusal(svg(path(half) + path(half, 50)))).toBe('read')
    expect(refusal(svg(`${path(half)}${path(half, 50)}${square}`))).toBe(
      'its paths have more than 500,000 points in all',
    )
  })

  it('counts the points of the outlines a clip path cuts with', () => {
    const clipped = (clip: string) =>
      svg(`<clipPath id="c">${clip}</clipPath><g clip-path="url(#c)">${path(MAX_POINTS / 2 - 1, 50)}${square}</g>`)
    expect(refusal(clipped(square))).toBe('read')
    expect(refusal(clipped(path(MAX_POINTS / 2)))).toBe('its paths have more than 500,000 points in all')
  })
})
