import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { MadePiece, MadePieces, MatchAnswer, MatchJob } from '@dazbee/schema'

import type { MatchOptions } from '../matching/match-client.ts'
import { type MatchSources, pieceMatcher } from './piece-matcher.ts'

const ck = await loadCanvasKit()

/** A `width` × `height` PNG of one colour, with an opaque black box at `box` when given, over it. */
function png(
  width: number,
  height: number,
  colour: [number, number, number, number],
  box?: [number, number, number, number],
): Uint8Array {
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.Color(...colour))
  if (box) {
    const paint = new ck.Paint()
    paint.setColor(ck.BLACK)
    canvas.drawRect(ck.XYWHRect(...box), paint)
    paint.delete()
  }
  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!bytes) throw new Error('no PNG')
  return bytes
}

/** A split piece of part `part`, at `x`, `y`, `width` × `height` px of the picture, recorded as asset `cut-<part>`. */
const piece = (part: string, kind: MadePiece['kind'], x: number, y: number, width: number, height: number) => ({
  picture: { key: `originals/cut-${part}`, width, height, assetId: `cut-${part}` },
  x,
  y,
  part,
  kind,
  layer: 1,
  turned: null,
})

const cutOf = (...items: MadePiece[]): MadePieces => ({
  width: 64,
  height: 64,
  items,
  stuck: [],
  closeness: { mean: 1, off: 2 },
  seconds: 3,
})

const element = (id: string, kind: string, content = '') => ({
  id,
  kind,
  name: id,
  content,
  text_lines: [],
  box: { x_min: 0, y_min: 0, x_max: 999, y_max: 999 },
  shadow: 'none',
  group: null,
  ming_layer: 1,
})

const PLAN = {
  ad_type: 'graphical' as const,
  elements: [element('e1', 'text', 'Big sale'), element('e2', 'shape'), element('e3', 'graphic')] as never,
  prompt: '',
  notes: [],
  design_name: 'Sale',
}

const SOURCES: MatchSources = {
  kit: { colors: { primary: '#102030FF' }, fonts: {}, textStyles: [] },
  fonts: { catalog: [], uploadPath: '/fonts/' },
}

/** A blue picture, and a headline piece clear but for a black box in its middle. */
const PICTURE = png(64, 64, [10, 20, 200, 1])
const HEADLINE = png(40, 20, [0, 0, 0, 0], [10, 5, 20, 10])
const BADGE = png(16, 16, [255, 0, 0, 1])

const SCORES = { ssim: 0.9, inkMissed: 0, far: 0 }
const answerFor = (job: MatchJob): MatchAnswer =>
  job.pieces[0]?.kind === 'text'
    ? { kind: 'picture', why: 'failed', scores: SCORES }
    : { kind: 'picture', why: 'photo' }

/**
 * A matcher over `images`, with what its match client and its sources were asked, the signal its calls are given,
 * the editor's end, and whether its match client was ended.
 */
function matcherOver(images: Record<string, Uint8Array>) {
  const jobs: MatchJob[] = []
  const options: MatchOptions[] = []
  let sourced = 0
  let destroyed = false
  const editor = new AbortController()
  const call = new AbortController()
  const asked = pieceMatcher({
    ck,
    imageBytes: (assetId) => images[assetId],
    sources: () => {
      sourced++
      return Promise.resolve(SOURCES)
    },
    makeClient: () => ({
      match: (job, with_) => {
        jobs.push(job)
        options.push(with_)
        return Promise.resolve(job.pieces.map(() => answerFor(job)))
      },
      destroy: () => {
        destroyed = true
      },
    }),
    signal: editor.signal,
  })
  const matcher = (frame: Parameters<typeof asked>[0]) => asked(frame, call.signal)
  return {
    matcher,
    jobs,
    options,
    sourced: () => sourced,
    signal: call.signal,
    call,
    editor,
    destroyed: () => destroyed,
  }
}

const decoded = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

describe('pieceMatcher', () => {
  it('asks the matchers of each text and shape piece as a job of its own picture, a text’s with the colour behind it', async () => {
    const cut = cutOf(
      piece('e1', 'text', 8, 30, 40, 20),
      piece('e3', 'graphic', 0, 0, 16, 16),
      piece('e2', 'shape', 40, 4, 16, 16),
    )
    const images = { pic: PICTURE, 'cut-e1': HEADLINE, 'cut-e2': BADGE, 'cut-e3': BADGE }
    const { matcher, jobs, options, sourced, signal } = matcherOver(images)
    const answers = await matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })

    expect(sourced()).toBe(1)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toEqual({
      picture: expect.any(String),
      pieces: [{ kind: 'text', words: 'Big sale', rect: { x: 0, y: 0, width: 40, height: 20 } }],
      kit: SOURCES.kit,
      setting: 'hybrid',
      backgrounds: [[10, 20, 200]],
    })
    expect(decoded(jobs[0]?.picture ?? '')).toEqual(HEADLINE)
    expect(jobs[1]).toEqual({
      picture: expect.any(String),
      pieces: [{ kind: 'shape', rect: { x: 0, y: 0, width: 16, height: 16 } }],
      kit: SOURCES.kit,
      setting: 'hybrid',
    })
    expect(decoded(jobs[1]?.picture ?? '')).toEqual(BADGE)
    expect(options).toEqual([
      { fonts: SOURCES.fonts, signal },
      { fonts: SOURCES.fonts, signal },
    ])
    // By the piece's number among the frame's pieces: the graphic between them is asked of no matcher.
    expect([...answers]).toEqual([
      [0, { kind: 'picture', why: 'failed', scores: SCORES }],
      [2, { kind: 'picture', why: 'photo' }],
    ])
  })

  it('gives a text no colour behind it when the picture isn’t here, or isn’t the size the pieces’ places are in', async () => {
    const cut = cutOf(piece('e1', 'text', 8, 30, 40, 20))
    const none = matcherOver({ 'cut-e1': HEADLINE })
    await none.matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })
    expect(none.jobs[0]).not.toHaveProperty('backgrounds')
    const unknown = matcherOver({ pic: PICTURE, 'cut-e1': HEADLINE })
    await unknown.matcher({ cut, plan: PLAN, reading: null, pictureAssetId: null })
    expect(unknown.jobs[0]).not.toHaveProperty('backgrounds')
    const small = matcherOver({ pic: png(32, 32, [10, 20, 200, 1]), 'cut-e1': HEADLINE })
    await small.matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })
    expect(small.jobs[0]).not.toHaveProperty('backgrounds')
  })

  it('asks no matcher of a piece whose picture isn’t here, and asks for nothing when no piece is matched', async () => {
    const cut = cutOf(piece('e1', 'text', 8, 30, 40, 20), piece('e2', 'shape', 40, 4, 16, 16))
    const missing = matcherOver({ pic: PICTURE, 'cut-e2': BADGE })
    const answers = await missing.matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })
    expect(missing.jobs.map((job) => job.pieces[0]?.kind)).toEqual(['shape'])
    expect([...answers.keys()]).toEqual([1])

    const pictures = matcherOver({ pic: PICTURE, 'cut-e3': BADGE })
    const kept = await pictures.matcher({
      cut: cutOf(piece('e3', 'graphic', 0, 0, 16, 16)),
      plan: PLAN,
      reading: null,
      pictureAssetId: 'pic',
    })
    expect(kept.size).toBe(0)
    expect(pictures.sourced()).toBe(0)
    expect(pictures.jobs).toEqual([])
  })

  it('asks no matcher once its call is stopped, and ends its match client with the editor', async () => {
    const cut = cutOf(piece('e2', 'shape', 40, 4, 16, 16))
    const stopped = matcherOver({ pic: PICTURE, 'cut-e2': BADGE })
    stopped.call.abort(new Error('too long'))
    await expect(stopped.matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })).rejects.toThrow('too long')
    expect(stopped.jobs).toEqual([])
    expect(stopped.destroyed()).toBe(false)
    stopped.editor.abort()
    expect(stopped.destroyed()).toBe(true)
  })
})
