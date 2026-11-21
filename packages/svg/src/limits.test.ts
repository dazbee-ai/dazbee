import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { SvgError, svgToLayers } from './convert.ts'
import {
  MAX_ALL_CLIP_SHAPES,
  MAX_ALL_STOPS,
  MAX_CHARACTERS,
  MAX_CLIP_SHAPES,
  MAX_DASH_LENGTHS,
  MAX_DEPTH,
  MAX_EFFECT_AREA,
  MAX_EFFECT_DEPTH,
  MAX_EFFECTS,
  MAX_LAYER_EFFECTS,
  MAX_LAYERS,
  MAX_PATH_POINTS,
  MAX_POINTS,
  MAX_STOPS,
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

/** `count` copies of `text`. */
const times = (count: number, text: string) => text.repeat(count)
/** A gradient of `count` stops. */
const gradient = (count: number) =>
  `<linearGradient id="g">${Array.from({ length: count }, (_, i) => `<stop offset="${i / count}" stop-color="#${String((i % 9) + 1).repeat(6)}"/>`).join('')}</linearGradient>`

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

  it('refuses blurs and shadows that would draw too much offscreen for the drawing’s size, and reads ordinary ones', () => {
    const past = `its blurs and shadows draw more than ${MAX_EFFECT_AREA} times its own area`
    // Each square blurred as wide as the drawing draws 16 times the drawing's area offscreen.
    const wide = '<filter id="w"><feGaussianBlur stdDeviation="50"/></filter>'
    const squares = (count: number) => svg(wide + times(count, '<rect filter="url(#w)" width="100" height="100"/>'))
    expect(refusal(squares(MAX_EFFECT_AREA / 16))).toBe('read')
    expect(refusal(squares(MAX_EFFECT_AREA / 16 + 1))).toBe(past)
    // Four groups blurred as wide as an effect may be, nested: each widens the drawing inside it.
    const nested = `${'<g filter="url(#b)">'.repeat(4)}<rect width="100" height="100"/>${'</g>'.repeat(4)}`
    expect(refusal(svg(`<filter id="b"><feGaussianBlur stdDeviation="1000"/></filter>${nested}`))).toBe(past)
  })

  it('refuses a file of more layers than it may have, saying how many it may', () => {
    // Each square is a layer, and so is the group holding them.
    const squares = (count: number) => svg('<rect width="9" height="9"/>'.repeat(count))
    expect(refusal(squares(MAX_LAYERS - 1))).toBe('read')
    expect(refusal(squares(MAX_LAYERS))).toBe('it has more than 5,000 layers')
  })
})

describe('tally', () => {
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

  it('refuses dashed strokes that draw too many dashes within a second, through uses too, and reads ordinary ones', () => {
    const past = 'its dashed strokes draw more than 100,000 dashes'
    // A line 1000 long draws 1000 ÷ the pattern's length dashes and gaps for each length it lists.
    const line = (dashes: string) => svg(`<line x2="1000" stroke="red" stroke-dasharray="${dashes}"/>`)
    expect(refusal(line('0.02'))).toBe('read')
    expect(refusal(line('0.005'))).toBe(past)
    const fan = svg(
      `<defs><line id="l" x2="1000" stroke="red" stroke-dasharray="0.001"/><g id="row">${times(30, '<use href="#l"/>')}</g></defs>${times(30, '<use href="#row"/>')}`,
    )
    const { said, ms } = timed(fan)
    expect(said).toBe(past)
    expect(ms).toBeLessThan(1000)
  })

  it('reads a dash pattern of as many lengths as one may list, and refuses one more', () => {
    const pattern = (count: number) =>
      svg(`<line x2="100" stroke="red" stroke-dasharray="${times(count, '1 ').trim()}"/>`)
    expect(refusal(pattern(MAX_DASH_LENGTHS))).toBe('read')
    expect(refusal(pattern(MAX_DASH_LENGTHS + 1))).toBe(
      `one of its dash patterns lists more than ${MAX_DASH_LENGTHS} lengths`,
    )
  })

  it('reads a gradient of as many stops as one may have, refuses one more, and counts the stops of every shape it paints', () => {
    const painted = (stops: number, shapes: number) =>
      svg(gradient(stops) + times(shapes, '<rect fill="url(#g)" width="9" height="9"/>'))
    expect(refusal(painted(MAX_STOPS, 1))).toBe('read')
    expect(refusal(painted(MAX_STOPS + 1, 1))).toBe(`one of its gradients has more than ${MAX_STOPS} stops`)
    expect(refusal(painted(200, MAX_ALL_STOPS / 200))).toBe('read')
    expect(refusal(painted(200, MAX_ALL_STOPS / 200 + 1))).toBe('its gradients have more than 20,000 stops in all')
  })

  it('refuses a clip path of too many shapes within a second, and counts the shapes each time one clips', () => {
    const shapes = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `<rect x="${(i % 50) * 2}" y="${Math.floor(i / 50) * 2}" width="1" height="1"/>`,
      ).join('')
    const clipped = (count: number, uses = 1) =>
      svg(`<clipPath id="c">${shapes(count)}</clipPath>${times(uses, `<g clip-path="url(#c)">${square}</g>`)}`)
    expect(refusal(clipped(MAX_CLIP_SHAPES))).toBe('read')
    const { said, ms } = timed(clipped(720))
    expect(said).toBe(`one of its clip paths joins more than ${MAX_CLIP_SHAPES} shapes`)
    expect(ms).toBeLessThan(1000)
    expect(refusal(clipped(50, MAX_ALL_CLIP_SHAPES / 50))).toBe('read')
    expect(refusal(clipped(50, MAX_ALL_CLIP_SHAPES / 50 + 1))).toBe('its clip paths join more than 1,000 shapes in all')
  })

  it('reads texts of as many characters as a file may have, and refuses one more', () => {
    const text = (count: number) => svg(`<text y="20">${'a'.repeat(count)}</text>`)
    expect(refusal(text(MAX_CHARACTERS))).toBe('read')
    expect(refusal(text(MAX_CHARACTERS + 1))).toBe('its texts have more than 100,000 characters')
  })

  it('keeps 100 characters of a long name, which every use of its element copies', () => {
    const named = svg(
      `<defs><rect id="r" data-name="${'n'.repeat(900_000)}" width="9" height="9"/></defs>${times(70, '<use href="#r"/>')}`,
    )
    const names = Object.values(svgToLayers(ck, named).tree.nodes).map((n) => n.name)
    expect(Math.max(...names.map((n) => n.length))).toBe(100)
  })
})
