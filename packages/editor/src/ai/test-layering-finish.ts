// The finish's tests' fixtures: split layers drawn as PNG bytes, layer plans and split pieces, a plan with a badge,
// the layers the matchers answer and matchers that answer by the piece, a tab with its finish and the timers it
// waits on, a draft and two sizes made editable, and the layers a finish placed.
import { expect } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MadePiece, type MadePieces, type MatchAnswer, pictureLayerOf, UnplacedLayer } from '@dazbee/schema'

import type { EditorAi } from './arrivals.ts'
import { type EditorLayeringFinish, editorLayeringFinish } from './layering-finish.ts'
import type { FramePieces, PieceMatcher } from './piece-matcher.ts'
import type { FakeAi } from './test-ai.ts'
import { BRIEF, pollAll, settle, type Tab, tabOn } from './test-arrivals.ts'

/** A split layer's file that is no picture: a finish that reads it fails. */
export const NO_PICTURE = new Uint8Array([1, 2, 3])

const SIZES = [
  { width: 1080, height: 1920, name: 'Story' },
  { width: 1200, height: 628, name: 'Link image' },
]

const ck = await loadCanvasKit()

/** A 512 px split layer, clear but for an opaque box at `x`, `y`, `width` × `height`, as PNG bytes. */
export function splitLayer(x: number, y: number, width: number, height: number): Uint8Array {
  const surface = ck.MakeSurface(512, 512)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  const paint = new ck.Paint()
  paint.setColor(ck.Color(20, 120, 200, 1))
  canvas.drawRect(ck.XYWHRect(x, y, width, height), paint)
  paint.delete()
  const image = surface.makeImageSnapshot()
  const png = image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!png) throw new Error('no PNG')
  return png
}

/** One element of the layer plan, in split layer `layer`, a text saying `content`. */
export const element = (id: string, kind: string, name: string, layer: number, content = '') => ({
  id,
  kind,
  name,
  content,
  text_lines: [],
  box: { x_min: 0, y_min: 0, x_max: 999, y_max: 999 },
  shadow: 'none',
  group: null,
  ming_layer: layer,
})

/** A layer plan of `elements`. */
export const planOf = (...elements: ReturnType<typeof element>[]) => ({
  ad_type: 'graphical',
  elements,
  prompt: 'p',
  notes: [],
  design_name: 'Sale',
})

export const PLAN = planOf(element('e1', 'text', 'Headline', 1), element('e2', 'background', 'Backdrop', 2))

/** A split piece of planned part `part`, at `x`, `y`, `width` × `height` px of the picture, recorded as asset `cut-<part>`. */
export const cut = (
  part: string | null,
  kind: MadePiece['kind'],
  x: number,
  y: number,
  width: number,
  height: number,
) => ({
  picture: { key: `originals/cut-${part ?? 'loose'}`, width, height, assetId: `cut-${part ?? 'loose'}` },
  x,
  y,
  part,
  kind,
  layer: 1,
  turned: null,
})

/** The split pieces `items` of a picture `width` × `height` px, front to back. */
export const cutOf = (width: number, height: number, ...items: MadePiece[]): MadePieces => ({
  width,
  height,
  items,
  stuck: [],
  closeness: { mean: 1, off: 2 },
  seconds: 3,
})

/** A headline, a badge and the backdrop: the plan, its reading and its split pieces of a 1024 px picture. */
export const BADGE_PLAN = planOf(
  element('e1', 'text', 'Headline', 1, 'Big sale'),
  element('e2', 'shape', 'Badge', 1),
  element('e3', 'background', 'Backdrop', 2),
)
export const BADGE_READING = {
  blocks: [
    {
      id: 'e1',
      text: 'Big sale!',
      corrections: [],
      lettering: 'font',
      style: 'sans-serif',
      italic: false,
      rounded: false,
      mixed_styles: false,
      mixed_note: '',
    },
  ],
}
export const BADGE_PIECES = cutOf(
  1024,
  1024,
  cut('e1', 'text', 100, 50, 200, 100),
  cut('e2', 'shape', 512, 512, 128, 128),
  cut('e3', 'background', 0, 0, 1024, 1024),
)
const SCORES = { ssim: 0.9, inkMissed: 0, far: 0 }

/** A text as the text matcher answers it, in its piece's pixels, bound to the brand kit as `bindings` say. */
export const liveText = (bindings?: Record<string, string>) =>
  UnplacedLayer.parse({
    type: 'text',
    name: 'Big sale!',
    props: {
      x: 8,
      y: 16,
      width: 180,
      height: 60,
      text: 'Big sale!',
      boxMode: 'autoWidth',
      style: { fontFamily: 'Noto Sans', fontWeight: 700, fontSize: 64, color: '#102030FF' },
    },
    ...(bindings ? { bindings } : {}),
  })

/** A rectangle as the shape matcher answers it, in its piece's pixels. */
export const redRect = (x: number, y: number, width: number, height: number) =>
  UnplacedLayer.parse({
    type: 'graphic',
    name: 'Rectangle',
    props: { x, y, width, height, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#FF0000FF' }] },
  })

/** A matcher's answer that rebuilds a piece as `layers`, looking the same. */
export const layersAnswer = (...layers: UnplacedLayer[]): MatchAnswer => ({
  kind: 'layers',
  layers,
  scores: SCORES,
  approximate: false,
})

/** Matchers that answer each piece as `answers` say, by its number, and keep what they were asked. */
export function matchers(answers: Record<number, MatchAnswer>) {
  const asked: FramePieces[] = []
  const matcher: PieceMatcher = (frame) => {
    asked.push(frame)
    return Promise.resolve(new Map(Object.entries(answers).map(([n, answer]) => [Number(n), answer])))
  }
  return { asked, matcher }
}

/**
 * A tab of `token`'s with its finish, the timers it waits on and what ends its editor; what its arrivals give back
 * as stored, the AI its finish asks, when not the tab's, and the matchers it asks, when it has any.
 */
export async function finishing(
  ai: FakeAi,
  token = 'ann',
  {
    arrive,
    finishAi,
    matcher,
  }: { arrive?: () => Promise<'saved' | 'none'>; finishAi?: EditorAi; matcher?: PieceMatcher } = {},
): Promise<{ tab: Tab; finish: EditorLayeringFinish; timers: (() => void)[]; end: () => void }> {
  const tab = await tabOn(ai, token)
  const stop = new AbortController()
  const timers: (() => void)[] = []
  const finish = editorLayeringFinish({
    session: tab.editor.session,
    ai: finishAi ?? ai,
    ck,
    holder: `${token}-holder`,
    read: tab.arrivals.read,
    onRead: tab.arrivals.onRead,
    after: (_ms, run) => {
      timers.push(run)
      return () => {
        const at = timers.indexOf(run)
        if (at >= 0) timers.splice(at, 1)
      }
    },
    readyPictures: tab.editor.modules.resources.prepareImages,
    imageBytes: (assetId) => tab.editor.modules.resources.bytes().images[assetId],
    matcher,
    readyFonts: tab.editor.modules.resources.loadUses,
    fitText: tab.editor.modules.typing.fitText,
    arrive: arrive ?? tab.arrivals.land,
    poll: tab.arrivals.poll,
    signal: stop.signal,
  })
  return { tab, finish, timers, end: () => stop.abort(new Error('the editor ended')) }
}

/** Lets what the tabs and their finishes set going land. */
export async function settleAll(...tabs: { tab: Tab; finish: EditorLayeringFinish }[]) {
  for (let n = 0; n < 3; n++) {
    await settle(...tabs.map((t) => t.tab.arrivals))
    await Promise.all(tabs.map((t) => t.finish.settled()))
  }
}

/** A brief whose Draft 1 shows picture `pic1`, made editable as job2. */
export async function madeEditable(ai: FakeAi, first: { tab: Tab; finish: EditorLayeringFinish }, ...others: Tab[]) {
  await first.tab.arrivals.startBrief(BRIEF)
  await settleAll(first)
  ai.make('job1', 0, 'pic1')
  await pollAll(first.tab, ...others)
  expect((await first.tab.arrivals.makeEditable('ann-1')).ok).toBe(true)
}

/**
 * A brief whose Draft 1, picture `pic1`, is redrawn as a Story (frame ann-6, 1080 × 1920) and a Link image (ann-7,
 * 1200 × 628), both made editable as job3.
 */
export async function sizesMadeEditable(ai: FakeAi, first: { tab: Tab; finish: EditorLayeringFinish }) {
  await first.tab.arrivals.startBrief(BRIEF)
  await settleAll(first)
  ai.make('job1', 0, 'pic1')
  await pollAll(first.tab)
  await first.tab.arrivals.otherSizes({ frameId: 'ann-1', sizes: SIZES, title: 'Draft 1 sizes' })
  await settleAll(first)
  ai.makeCall('job2', 0, 'tall')
  ai.makeCall('job2', 1, 'wide')
  await pollAll(first.tab)
  expect((await first.tab.arrivals.makeAllEditable(['ann-6', 'ann-7'])).ok).toBe(true)
}

/** Reads the frames, lets the finish they start run, and reads again. */
export async function finished(first: { tab: Tab; finish: EditorLayeringFinish }) {
  await pollAll(first.tab)
  await settleAll(first)
  await pollAll(first.tab)
}

/**
 * The layers placed in frame `frameId` over its picture layer, bottom first: each one's name, box, and the link id
 * the finish gave it; none for a layer left with a link id of its own, as a layer created without one has.
 */
export function placed(tab: Tab, frameId: string) {
  return childrenOf(tab.editor.session.design(), frameId)
    .filter(([id]) => id !== pictureLayerOf(frameId))
    .map(([, layer]) => {
      const { x, y, width, height } = layer.props as Record<string, unknown>
      const link = layer.link.startsWith('job') ? layer.link : undefined
      return { name: layer.name, link, box: { x, y, width, height } }
    })
}
