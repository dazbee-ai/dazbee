// The finish's tests' fixtures: split layers drawn as PNG bytes, layer plans and split pieces, a tab with its finish
// and the timers it waits on, a draft and two sizes made editable, and the layers a finish placed.
import { expect } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MadePiece, type MadePieces, pictureLayerOf } from '@dazbee/schema'

import type { EditorAi } from './arrivals.ts'
import { type EditorLayeringFinish, editorLayeringFinish } from './layering-finish.ts'
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

/**
 * A tab of `token`'s with its finish, the timers it waits on, what its arrivals give back as stored, and the AI its
 * finish asks, when not the tab's.
 */
export async function finishing(
  ai: FakeAi,
  token = 'ann',
  { arrive, finishAi }: { arrive?: () => Promise<'saved' | 'none'>; finishAi?: EditorAi } = {},
): Promise<{ tab: Tab; finish: EditorLayeringFinish; timers: (() => void)[] }> {
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
    arrive: arrive ?? tab.arrivals.land,
    poll: tab.arrivals.poll,
    signal: stop.signal,
  })
  return { tab, finish, timers }
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
  expect((await first.tab.arrivals.makeAllEditable(['ann-6', 'ann-7'], 'pic1')).ok).toBe(true)
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
