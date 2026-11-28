import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MadePiece, type MadePieces, type MatchAnswer, MatchJob } from '@dazbee/schema'

import type { MatchOptions } from '../matching/match-client.ts'
import { hiddenBits, type MatchSources, pieceMatcher } from './piece-matcher.ts'

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
 * A matcher over `images`, with what its match client and its sources were asked, the pictures it decoded, the
 * signal its calls are given, the editor's end, and whether its match client was ended.
 */
function matcherOver(images: Record<string, Uint8Array>) {
  const jobs: MatchJob[] = []
  const options: MatchOptions[] = []
  const decodes: Uint8Array[] = []
  let sourced = 0
  let destroyed = false
  const editor = new AbortController()
  const call = new AbortController()
  const counting = new Proxy(ck, {
    get: (target, key) =>
      key === 'MakeImageFromEncoded'
        ? (bytes: Uint8Array) => {
            decodes.push(bytes)
            return target.MakeImageFromEncoded(bytes)
          }
        : (Reflect.get(target, key) as unknown),
  })
  const asked = pieceMatcher({
    ck: counting,
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
    decodes,
    sourced: () => sourced,
    signal: call.signal,
    call,
    editor,
    destroyed: () => destroyed,
  }
}

const decoded = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

/**
 * What a job says is hidden of its picture of `count` pixels, a number a pixel, read as the shape matcher reads it:
 * one bit a pixel, row by row, the first pixel of a byte in its highest bit.
 */
function hiddenIn(job: MatchJob | undefined, count: number): number[] {
  const bits = decoded(job?.hidden ?? '')
  return Array.from({ length: count }, (_, at) => ((bits[at >> 3] ?? 0) >> (7 - (at & 7))) & 1)
}

describe('pieceMatcher', () => {
  it('asks the matchers of each text, shape and graphic piece as a job of its own picture, a text’s with the colour behind it', async () => {
    const cut = cutOf(
      piece('e1', 'text', 8, 30, 40, 20),
      piece('e3', 'graphic', 0, 0, 16, 16),
      piece('e4', 'photo', 20, 0, 16, 16),
      piece('e2', 'shape', 40, 4, 16, 16),
    )
    const images = { pic: PICTURE, 'cut-e1': HEADLINE, 'cut-e2': BADGE, 'cut-e3': BADGE, 'cut-e4': BADGE }
    const { matcher, jobs, options, sourced, signal } = matcherOver(images)
    const answers = await matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })

    expect(sourced()).toBe(1)
    expect(jobs).toHaveLength(3)
    expect(jobs[0]).toEqual({
      picture: expect.any(String),
      pieces: [{ kind: 'text', words: 'Big sale', rect: { x: 0, y: 0, width: 40, height: 20 } }],
      kit: SOURCES.kit,
      setting: 'hybrid',
      backgrounds: [[10, 20, 200]],
    })
    expect(decoded(jobs[0]?.picture ?? '')).toEqual(HEADLINE)
    // An opaque piece no piece in front covers: no colour shows behind it, and nothing of it is hidden.
    for (const job of jobs.slice(1)) {
      expect(job).toEqual({
        picture: expect.any(String),
        pieces: [{ kind: 'shape', rect: { x: 0, y: 0, width: 16, height: 16 } }],
        kit: SOURCES.kit,
        setting: 'hybrid',
      })
      expect(decoded(job.picture)).toEqual(BADGE)
    }
    expect(options).toEqual([
      { fonts: SOURCES.fonts, signal },
      { fonts: SOURCES.fonts, signal },
      { fonts: SOURCES.fonts, signal },
    ])
    // By the piece's number among the frame's pieces: the photo between them is asked of no matcher.
    expect([...answers]).toEqual([
      [0, { kind: 'picture', why: 'failed', scores: SCORES }],
      [1, { kind: 'picture', why: 'photo' }],
      [3, { kind: 'picture', why: 'photo' }],
    ])
  })

  it('gives a shape the colour the picture shows behind it, and the backdrop none', async () => {
    const cut = cutOf(piece('e2', 'shape', 8, 30, 40, 20), piece('e5', 'background', 0, 0, 64, 64))
    const { matcher, jobs } = matcherOver({ pic: PICTURE, 'cut-e2': HEADLINE, 'cut-e5': PICTURE })
    await matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })

    expect(jobs.map((job) => job.pieces[0]?.kind)).toEqual(['shape', 'shape'])
    expect(jobs[0]?.backgrounds).toEqual([[10, 20, 200]])
    expect(jobs[1]).not.toHaveProperty('backgrounds')
    const none = matcherOver({ 'cut-e2': HEADLINE })
    await none.matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })
    expect(none.jobs[0]).not.toHaveProperty('backgrounds')
  })

  it('tells a shape what the pieces in front of it cover of it, where they are at least half opaque', async () => {
    // The headline's black box lies over the picture's pixels 18 to 37 across and 35 to 44 down; the rest of it is clear.
    const cut = cutOf(piece('e1', 'text', 8, 30, 40, 20), piece('e2', 'shape', 30, 40, 16, 16))
    const { matcher, jobs } = matcherOver({ pic: PICTURE, 'cut-e1': HEADLINE, 'cut-e2': BADGE })
    await matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })

    expect(jobs[0]).not.toHaveProperty('hidden')
    // The badge's first 8 pixels across and first 5 down lie under the box.
    const partly = Array.from({ length: 16 * 16 }, (_, at) => (at % 16 < 8 && at < 5 * 16 ? 1 : 0))
    expect(hiddenIn(jobs[1], 16 * 16)).toEqual(partly)
    expect(MatchJob.safeParse(jobs[1]).success).toBe(true)
  })

  it('tells a shape wholly covered that every pixel of it is hidden, by a piece no matcher is asked of too', async () => {
    const small = png(8, 4, [255, 0, 0, 1])
    const cut = cutOf(piece('e4', 'photo', 8, 30, 40, 20), piece('e2', 'shape', 20, 36, 8, 4))
    const { matcher, jobs } = matcherOver({ 'cut-e4': HEADLINE, 'cut-e2': small })
    await matcher({ cut, plan: PLAN, reading: null, pictureAssetId: null })

    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.hidden).toBe('/////w==')
    expect(MatchJob.safeParse(jobs[0]).success).toBe(true)
  })

  it('tells a shape nothing is hidden when no piece in front covers it', async () => {
    // In front of the headline; behind it but beside its box; and behind a piece whose picture isn't here.
    const front = cutOf(piece('e2', 'shape', 30, 40, 16, 16), piece('e1', 'text', 8, 30, 40, 20))
    const beside = cutOf(piece('e1', 'text', 8, 30, 40, 20), piece('e2', 'shape', 40, 4, 16, 16))
    for (const cut of [front, beside]) {
      const { matcher, jobs } = matcherOver({ pic: PICTURE, 'cut-e1': HEADLINE, 'cut-e2': BADGE })
      await matcher({ cut, plan: PLAN, reading: null, pictureAssetId: 'pic' })
      expect(jobs).toHaveLength(2)
      for (const job of jobs) expect(job).not.toHaveProperty('hidden')
    }
    const unread = matcherOver({ pic: PICTURE, 'cut-e2': BADGE })
    await unread.matcher({
      cut: cutOf(piece('e4', 'photo', 8, 30, 40, 20), piece('e2', 'shape', 30, 40, 16, 16)),
      plan: PLAN,
      reading: null,
      pictureAssetId: 'pic',
    })
    expect(unread.jobs[0]).not.toHaveProperty('hidden')
  })

  it('decodes each piece’s picture once, however many shapes it lies in front of, and none behind the last shape', async () => {
    const [logo, first, second, last] = [1, 2, 3, 4].map((shade) => png(16, 16, [shade, 0, 0, 1]))
    const cut = cutOf(
      piece('e4', 'logo', 0, 0, 16, 16),
      piece('e2', 'shape', 4, 4, 16, 16),
      piece('e3', 'graphic', 8, 8, 16, 16),
      piece('e6', 'photo', 0, 0, 16, 16),
    )
    const images = { 'cut-e4': logo, 'cut-e2': first, 'cut-e3': second, 'cut-e6': last } as Record<string, Uint8Array>
    const { matcher, jobs, decodes } = matcherOver(images)
    await matcher({ cut, plan: PLAN, reading: null, pictureAssetId: null })

    expect(jobs.map((job) => job.hidden !== undefined)).toEqual([true, true])
    // The last shape covers no shape and no colour is read behind it, so its picture isn't decoded either.
    expect(decodes).toEqual([logo, first])
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
      cut: cutOf(piece('e3', 'photo', 0, 0, 16, 16)),
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

describe('hiddenBits', () => {
  it('packs a byte a pixel into one bit a pixel, the first pixel of a byte in its highest bit, as base64', () => {
    // A 3 × 3 picture hidden along its diagonal: 10001000 1, the last byte filled out with zeros.
    const hidden = Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(hiddenBits(hidden)).toBe('iIA=')
    expect([...decoded(hiddenBits(hidden))]).toEqual([0b10001000, 0b10000000])
  })

  it('is read back by the shape matcher’s layout as the pixels it was given, any value but 0 as hidden', () => {
    const hidden = Uint8Array.from({ length: 5 * 7 }, (_, at) => (at % 3 === 0 || at === 34 ? 255 : 0))
    const bits = decoded(hiddenBits(hidden))
    expect(bits).toHaveLength(Math.ceil((5 * 7) / 8))
    const read = Array.from({ length: hidden.length }, (_, at) => ((bits[at >> 3] ?? 0) >> (7 - (at & 7))) & 1)
    expect(read).toEqual([...hidden].map((covered) => (covered ? 1 : 0)))
    expect(hiddenBits(new Uint8Array(16))).toBe('AAA=')
  })
})
