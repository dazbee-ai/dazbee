import { describe, expect, it } from 'vitest'

import { imagePlacement } from '@dazbee/renderer'
import { type AiJobView, LAYERING_CALL, type MadePiece, type MadePieces } from '@dazbee/schema'

import {
  frameLayers,
  framePieces,
  layerName,
  layerPlanOf,
  onePlan,
  pieceBox,
  pieceCrop,
  pieceId,
  pieceLink,
  pieceName,
  scaleBox,
  sharedLinks,
  visibleBox,
} from './layer-pieces.ts'

const layers = (n: number) => ({
  kind: 'layers' as const,
  layers: Array.from({ length: n }, (_, i) => ({ key: `k${i}`, width: 512, height: 512 })),
  gpuSeconds: 1,
})

/** One element of a layer plan: its id, kind, name and, for a text, what it says. */
const element = (id: string, kind: string, name: string, content = '') => ({
  id,
  kind,
  name,
  content,
  text_lines: [],
  box: { x_min: 0, y_min: 0, x_max: 9, y_max: 9 },
  shadow: 'none',
  group: null,
  ming_layer: 2,
})

/** A done plan call at `index`, of `elements`. */
const planCall = (index: number, elements: unknown[]) => ({
  index,
  function: 'layer-plan',
  state: 'done' as const,
  output: {
    kind: 'text' as const,
    text: '',
    json: { ad_type: 'graphical', elements, prompt: '', notes: [], design_name: 'Sale' },
  },
})

/** A split piece of part `part`, at `x`, `y`, `width` × `height` px of the picture. */
const piece = (part: string | null, x = 0, y = 0, width = 10, height = 10): MadePiece => ({
  picture: { key: `originals/${part ?? 'loose'}`, width, height, assetId: `cut-${part ?? 'loose'}` },
  x,
  y,
  part,
  kind: part === null ? 'other' : 'text',
  layer: 1,
  turned: null,
})

/** The split pieces `items` of a 1024 px picture. */
const pieces = (...items: MadePiece[]): MadePieces => ({
  width: 1024,
  height: 1024,
  items,
  stuck: [],
  closeness: { mean: 1, off: 2 },
  seconds: 3,
})

/** A done split call at `index`, of two split layers and split pieces `cut`. */
const splitCall = (index: number, cut?: MadePieces) => ({
  index,
  function: 'layer-split',
  state: 'done' as const,
  output: { ...layers(2), ...(cut ? { pieces: cut } : {}) },
})

const JOB: Pick<AiJobView, 'calls'> = {
  calls: [
    { index: 3, function: 'layer-split', state: 'done', output: layers(3) },
    planCall(0, [element('e1', 'text', 'Headline')]),
    { index: 1, function: 'layer-split', state: 'done', output: layers(2) },
    { index: 5, function: 'layer-split', state: 'running' },
  ],
}

/**
 * A job of three frames, each with its own plan and split pieces. Every frame says "Big sale" in one text part, in
 * its own letter case and spacing; the second frame also has two shapes of one name, and the third a part of
 * another kind with the first frame's badge's name.
 */
const OWN_PLANS: Pick<AiJobView, 'id' | 'calls'> = {
  id: 'job7',
  calls: [
    planCall(LAYERING_CALL.plan(0), [
      element('a1', 'text', 'Headline', 'Big sale'),
      element('a2', 'shape', 'Price badge'),
      element('a3', 'text', 'Terms', 'Until Sunday'),
    ]),
    splitCall(LAYERING_CALL.split(0), pieces(piece('a1'), piece('a2'), piece('a3'), piece(null), piece('gone'))),
    planCall(LAYERING_CALL.plan(1), [
      element('b1', 'text', '  Title  ', ' BIG   sale\n'),
      element('b2', 'shape', 'Dot'),
      element('b3', 'shape', 'dot'),
      element('b4', 'shape', 'price  Badge'),
    ]),
    splitCall(LAYERING_CALL.split(1), pieces(piece('b1'), piece('b2'), piece('b3'), piece('b4'), piece(null))),
    planCall(LAYERING_CALL.plan(2), [
      element('c1', 'text', 'Line', 'big sale'),
      element('c2', 'graphic', 'Price badge'),
      element('c3', 'shape', 'Dot'),
    ]),
    splitCall(LAYERING_CALL.split(2), pieces(piece('c1'), piece('c2'), piece('c3'))),
  ],
}

const frame = (n: number) => ({ callIndex: LAYERING_CALL.split(n) })

describe('layerPlanOf', () => {
  it('reads the plan once its call is done', () => {
    expect(layerPlanOf(JOB, frame(0))?.elements.map((e) => e.name)).toEqual(['Headline'])
    expect(layerPlanOf({ calls: [] }, frame(0))).toBeNull()
  })

  it('reads a frame’s own plan, and the first frame’s for a frame of a job with one plan', () => {
    expect(layerPlanOf(OWN_PLANS, frame(0))?.elements[0]?.id).toBe('a1')
    expect(layerPlanOf(OWN_PLANS, frame(1))?.elements[0]?.id).toBe('b1')
    expect(layerPlanOf(OWN_PLANS, frame(2))?.elements[0]?.id).toBe('c1')
    expect(layerPlanOf(JOB, frame(1))?.elements[0]?.id).toBe('e1')
  })

  it('reads no plan for a frame with no plan call of its own, in a job that plans each frame', () => {
    expect(layerPlanOf(OWN_PLANS, frame(5))).toBeNull()
  })

  it('reads no plan for a frame whose own plan failed', () => {
    const calls: AiJobView['calls'] = [
      ...JOB.calls,
      { index: LAYERING_CALL.plan(1), function: 'layer-plan', state: 'failed', failure: 'not-made' },
    ]
    expect(layerPlanOf({ calls }, frame(1))).toBeNull()
  })
})

describe('onePlan', () => {
  it('says whether every frame of the job is planned by the first frame’s plan', () => {
    expect(onePlan(JOB)).toBe(true)
    expect(onePlan(OWN_PLANS)).toBe(false)
  })
})

describe('frameLayers', () => {
  it('finds a frame’s split layers after the layers of the splits before it, and none while its split runs', () => {
    expect(frameLayers(JOB, { callIndex: 1 })).toEqual({
      first: 0,
      layers: [
        { width: 512, height: 512 },
        { width: 512, height: 512 },
      ],
    })
    expect(frameLayers(JOB, { callIndex: 3 })?.first).toBe(2)
    expect(frameLayers(JOB, { callIndex: 5 })).toBeNull()
  })
})

describe('framePieces', () => {
  it('gives a frame’s split pieces, and none for a split that cut none or isn’t done', () => {
    expect(framePieces(OWN_PLANS, frame(2))?.items.map((p) => p.part)).toEqual(['c1', 'c2', 'c3'])
    expect(framePieces(JOB, frame(0))).toBeNull()
    expect(framePieces({ calls: [splitCall(LAYERING_CALL.split(0), pieces())] }, frame(0))).toBeNull()
    expect(framePieces(JOB, frame(2))).toBeNull()
    expect(framePieces(JOB, frame(7))).toBeNull()
  })
})

describe('layerName', () => {
  it('names a layer by the plan’s elements in it, else by its number', () => {
    const plan = layerPlanOf(JOB, frame(0))
    expect(layerName(plan, 1, 'Layer')).toBe('Headline')
    expect(layerName(plan, 0, 'Layer')).toBe('Layer 1')
    expect(layerName(null, 2, 'Layer')).toBe('Layer 3')
  })
})

describe('pieceName', () => {
  it('names a piece by its planned part in the frame’s own plan, trimmed, at most 100 characters', () => {
    expect(pieceName(layerPlanOf(OWN_PLANS, frame(0)), piece('a2'), 1, 'Layer')).toBe('Price badge')
    expect(pieceName(layerPlanOf(OWN_PLANS, frame(1)), piece('b1'), 0, 'Layer')).toBe('Title')
    const long = layerPlanOf({ calls: [planCall(0, [element('e1', 'shape', 'n'.repeat(140))])] }, frame(0))
    expect(pieceName(long, piece('e1'), 0, 'Layer')).toBe('n'.repeat(100))
  })

  it('names a piece of no part, of a part the plan doesn’t have or of a part with no name by its number', () => {
    const plan = layerPlanOf(OWN_PLANS, frame(0))
    expect(pieceName(plan, piece(null), 3, 'Layer')).toBe('Layer 4')
    expect(pieceName(plan, piece('gone'), 4, 'Layer')).toBe('Layer 5')
    expect(pieceName(null, piece('a1'), 0, 'Layer')).toBe('Layer 1')
    const blank = layerPlanOf({ calls: [planCall(0, [element('e1', 'shape', '  ')])] }, frame(0))
    expect(pieceName(blank, piece('e1'), 0, 'Layer')).toBe('Layer 1')
  })
})

describe('pieceLink', () => {
  const plan = (n: number) => layerPlanOf(OWN_PLANS, frame(n))

  it('is the job’s id and the FNV-1a hash of the part’s kind and words, a text’s words what it says', () => {
    expect(pieceLink('job7', plan(0), piece('a1'))).toBe('job7-a3e7120d')
    expect(pieceLink('job7', plan(0), piece('a2'))).toBe('job7-c3eafca2')
    const hindi = layerPlanOf({ calls: [planCall(0, [element('e1', 'text', 'Headline', 'बड़ी सेल')])] }, frame(0))
    expect(pieceLink('job7', hindi, piece('e1'))).toBe('job7-29e6b444')
  })

  it('is the same for the same kind and words in any letter case and spacing, and another for other words or kinds', () => {
    expect(pieceLink('job7', plan(1), piece('b1'))).toBe('job7-a3e7120d')
    expect(pieceLink('job7', plan(2), piece('c1'))).toBe('job7-a3e7120d')
    expect(pieceLink('job7', plan(1), piece('b4'))).toBe('job7-c3eafca2')
    expect(pieceLink('job7', plan(0), piece('a3'))).not.toBe('job7-a3e7120d')
    expect(pieceLink('job7', plan(2), piece('c2'))).not.toBe('job7-c3eafca2')
  })

  it('names a text part with no words by its name', () => {
    const named = layerPlanOf({ calls: [planCall(0, [element('e1', 'text', 'Big sale', ' ')])] }, frame(0))
    expect(pieceLink('job7', named, piece('e1'))).toBe('job7-a3e7120d')
  })

  it('is none for a part whose kind and words another part of the plan shares, a piece of no part and a part the plan doesn’t have', () => {
    expect(pieceLink('job7', plan(1), piece('b2'))).toBeNull()
    expect(pieceLink('job7', plan(1), piece('b3'))).toBeNull()
    expect(pieceLink('job7', plan(0), piece(null))).toBeNull()
    expect(pieceLink('job7', plan(0), piece('gone'))).toBeNull()
    expect(pieceLink('job7', null, piece('a1'))).toBeNull()
  })

  it('stays within an id’s 64 characters', () => {
    const link = pieceLink('j'.repeat(64), plan(0), piece('a1'))
    expect(link).toBe(`${'j'.repeat(55)}-a3e7120d`)
  })
})

describe('sharedLinks', () => {
  it('holds the link ids that pieces of two or more of the frames have', () => {
    expect([...sharedLinks(OWN_PLANS, [frame(0), frame(1), frame(2)])].sort()).toEqual([
      'job7-a3e7120d',
      'job7-c3eafca2',
    ])
    // The third frame's one Dot is linked to nothing: the second frame's two share their kind and words.
    expect(sharedLinks(OWN_PLANS, [frame(1), frame(2)])).toEqual(new Set(['job7-a3e7120d']))
    expect(sharedLinks(OWN_PLANS, [frame(0)]).size).toBe(0)
    expect(sharedLinks({ id: 'job1', calls: JOB.calls }, [frame(0), frame(1)]).size).toBe(0)
  })
})

describe('visibleBox', () => {
  it('is the box of the pixels that show, and null when none does', () => {
    const alpha = new Uint8Array(4 * 3)
    alpha[1 * 4 + 1] = 255
    alpha[2 * 4 + 2] = 40
    expect(visibleBox(alpha, 4, 3)).toEqual({ x: 1, y: 1, width: 2, height: 2 })
    expect(visibleBox(new Uint8Array(12), 4, 3)).toBeNull()
  })
})

describe('scaleBox', () => {
  it('scales a box and grows it to whole pixels around it', () => {
    expect(scaleBox({ x: 100, y: 50, width: 200, height: 100 }, 512, 1080)).toEqual({
      x: 210,
      y: 105,
      width: 423,
      height: 212,
    })
  })
})

describe('pieceCrop', () => {
  it('draws a piece at the picture’s scale, in its place, however thin it is and whatever the frame’s size', () => {
    const cases = [
      {
        piece: piece('headline', 100, 50, 600, 20),
        picture: { width: 1024, height: 1024 },
        frame: { width: 1080, height: 1080 },
      },
      {
        piece: piece('headline', 50, 25, 300, 12),
        picture: { width: 512, height: 512 },
        frame: { width: 1080, height: 1080 },
      },
      {
        piece: piece('bar', 33, 100, 8, 300),
        picture: { width: 1024, height: 1024 },
        frame: { width: 1080, height: 1080 },
      },
      {
        piece: piece('headline', 100, 51, 500, 24),
        picture: { width: 768, height: 1360 },
        frame: { width: 1080, height: 1920 },
      },
      {
        piece: piece('bg', 0, 0, 768, 1360),
        picture: { width: 768, height: 1360 },
        frame: { width: 1080, height: 1920 },
      },
    ]
    for (const { piece: cut, picture, frame: size } of cases) {
      const box = pieceBox(cut, picture, size)
      const crop = pieceCrop(cut, picture, size)
      // Where the renderer draws the piece's own picture in its box, cut to the crop.
      const drawn = imagePlacement(cut.picture, { fit: 'crop', crop }, box)
      // Where the picture's fill draws that part of the picture in a layer filling the frame.
      const whole = imagePlacement(picture, { fit: 'fill' }, { x: 0, y: 0, ...size })
      const k = whole.width / picture.width
      expect(drawn.x).toBeCloseTo(whole.x + cut.x * k, 6)
      expect(drawn.y).toBeCloseTo(whole.y + cut.y * k, 6)
      expect(drawn.width).toBeCloseTo(cut.picture.width * k, 6)
      expect(drawn.height).toBeCloseTo(cut.picture.height * k, 6)
    }
  })
})

describe('pieceBox', () => {
  it('puts a piece where the picture’s own fill draws it, grown to whole pixels', () => {
    const square = { width: 1024, height: 1024 }
    expect(pieceBox(piece('a', 100, 50, 200, 100), square, { width: 1080, height: 1080 })).toEqual({
      x: 105,
      y: 52,
      width: 212,
      height: 107,
    })
    // A wide frame cuts the picture's top and bottom: the piece moves up by what is cut above it.
    expect(pieceBox(piece('a', 0, 512, 512, 512), square, { width: 1200, height: 600 })).toEqual({
      x: 0,
      y: 300,
      width: 600,
      height: 600,
    })
  })

  it('gives a backdrop the size of the picture the box the picture is drawn in, at its own ratio and a little off it', () => {
    const cases = [
      { picture: { width: 1024, height: 1024 }, frame: { width: 1080, height: 1080 } },
      { picture: { width: 576, height: 1024 }, frame: { width: 1080, height: 1920 } },
      { picture: { width: 768, height: 1360 }, frame: { width: 1080, height: 1920 } },
      { picture: { width: 1360, height: 768 }, frame: { width: 1920, height: 1080 } },
      { picture: { width: 1424, height: 800 }, frame: { width: 1200, height: 628 } },
    ]
    const boxes = cases.map(({ picture, frame: size }) => {
      const box = pieceBox(piece('bg', 0, 0, picture.width, picture.height), picture, size)
      // The renderer's own placement of the picture's fill in a layer filling the frame, inside the box by under a pixel.
      const drawn = imagePlacement(picture, { fit: 'fill' }, { x: 0, y: 0, ...size })
      const past = [
        drawn.x - box.x,
        drawn.y - box.y,
        box.x + box.width - (drawn.x + drawn.width),
        box.y + box.height - (drawn.y + drawn.height),
      ]
      for (const edge of past) {
        expect(edge).toBeGreaterThan(-1e-6)
        expect(edge).toBeLessThan(1)
      }
      return box
    })
    expect(boxes).toEqual([
      { x: 0, y: 0, width: 1080, height: 1080 },
      { x: 0, y: 0, width: 1080, height: 1920 },
      { x: -3, y: 0, width: 1086, height: 1920 },
      { x: 0, y: -3, width: 1920, height: 1086 },
      { x: 0, y: -24, width: 1200, height: 676 },
    ])
  })
})

describe('pieceId', () => {
  it('comes from the job, the frame and the layer, at most 64 characters', () => {
    expect(pieceId('job', 'frame', 2)).toBe('job-frame-2')
    expect(pieceId('j'.repeat(40), 'f'.repeat(40), 12)).toHaveLength(64)
  })
})
