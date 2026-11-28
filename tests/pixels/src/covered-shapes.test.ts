// What Make editable's finish tells the shape matcher is hidden of a split piece, read by the shape matcher itself:
// the editor's piece matcher builds the match job of a piece drawn in two flat colours, one half under an opaque
// piece in front, and the shape matcher rebuilds only the half that is seen. The same piece with nothing in front
// comes back as both halves. The piece is 250 px wide and its halves meet at 125, neither a multiple of 8, so a
// mask packed in another order, or with its rows filled out to whole bytes, would show some of the covered half.
import { describe, expect, it } from 'vitest'

import { pieceMatcher } from '@dazbee/editor/piece-matcher'
import { matchShapes } from '@dazbee/matchers'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MadePiece, type MadePieces, type MatchAnswer, MatchJob, type UnplacedLayer } from '@dazbee/schema'

import { encodePng } from './pixels.ts'

/** A graphic of an answer. */
type Graphic = Extract<UnplacedLayer, { type: 'graphic' }>

const ck = await loadCanvasKit()

const WIDTH = 250
const HEIGHT = 160
const NAVY = { rgb: [30, 58, 138], hex: '#1E3A8AFF' }
const CORAL = { rgb: [242, 118, 90], hex: '#F2765AFF' }
const GREY = [128, 128, 128]

/** A `width` × `height` PNG, opaque, of the colour `colour(x)` gives each column. */
function png(width: number, height: number, colour: (x: number) => number[]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) pixels.set([...colour(i % width), 255], i * 4)
  return encodePng(ck, { width, height, pixels })
}

/** The piece: its left half navy, its right half coral. */
const TWO_HALVES = png(WIDTH, HEIGHT, (x) => (x < WIDTH / 2 ? NAVY.rgb : CORAL.rgb))
/** A piece as big as one half, which it covers when it lies in front of it. */
const COVER = png(WIDTH / 2, HEIGHT, () => GREY)

/** A split piece of kind `kind` at `x`, `width` px wide and as tall as the picture, recorded as asset `assetId`. */
const piece = (assetId: string, kind: MadePiece['kind'], x: number, width: number): MadePiece => ({
  picture: { key: `originals/${assetId}`, width, height: HEIGHT, assetId },
  x,
  y: 0,
  part: null,
  kind,
  layer: 1,
  turned: null,
})

const cutOf = (...items: MadePiece[]): MadePieces => ({
  width: WIDTH,
  height: HEIGHT,
  items,
  stuck: [],
  closeness: { mean: 0, off: 0 },
  seconds: 0,
})

/** The editor's piece matcher over the two pictures, its jobs answered by the shape matcher, and the jobs it sent. */
function matching() {
  const jobs: MatchJob[] = []
  const images: Record<string, Uint8Array> = { halves: TWO_HALVES, cover: COVER }
  const matcher = pieceMatcher({
    ck,
    imageBytes: (assetId) => images[assetId],
    sources: () =>
      Promise.resolve({
        kit: { colors: {}, fonts: {}, textStyles: [] },
        fonts: { catalog: [], uploadPath: '/fonts/' },
      }),
    signal: new AbortController().signal,
    makeClient: () => ({
      match: (job) => {
        const parsed = MatchJob.parse(job)
        jobs.push(parsed)
        return Promise.resolve(parsed.pieces.map((one) => matchShapes(ck, parsed, one)))
      },
      destroy: () => {},
    }),
  })
  return { jobs, matcher }
}

/** An answer's graphics, back to front; fails a picture's answer. */
function graphicsOf(answer: MatchAnswer | undefined): Graphic[] {
  if (answer?.kind !== 'layers') throw new Error(`no layers: ${JSON.stringify(answer)}`)
  return answer.layers.flatMap((layer) => (layer.type === 'graphic' ? [layer] : []))
}

/** The colours a graphic is filled with. */
const fillsOf = (graphic: Graphic) =>
  (graphic.props.fills ?? []).flatMap((fill) => (fill.type === 'solid' ? [fill.color] : []))

/** The colours of the graphics the shape matcher rebuilds the piece as, with the pieces `inFront` lying in front of it. */
async function rebuiltColours(...inFront: MadePiece[]): Promise<string[]> {
  const { jobs, matcher } = matching()
  const cut = cutOf(...inFront, piece('halves', 'shape', 0, WIDTH))
  const answers = await matcher({ cut, plan: null, reading: null, pictureAssetId: null }, new AbortController().signal)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.hidden !== undefined).toBe(inFront.length > 0)
  return graphicsOf(answers.get(inFront.length)).flatMap(fillsOf)
}

describe('the shape matcher on a piece Make editable says is half hidden', () => {
  it('rebuilds both halves of the piece when nothing lies in front of it', async () => {
    expect(await rebuiltColours()).toEqual([NAVY.hex, CORAL.hex])
  })

  it('rebuilds no graphic of the half an opaque piece in front covers', async () => {
    expect(await rebuiltColours(piece('cover', 'photo', WIDTH / 2, WIDTH / 2))).toEqual([NAVY.hex])
    expect(await rebuiltColours(piece('cover', 'photo', 0, WIDTH / 2))).toEqual([CORAL.hex])
  })
})
