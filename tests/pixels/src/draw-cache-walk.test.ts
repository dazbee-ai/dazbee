// The draw-cache walk: the walker of @dazbee/doc edits a design that the editor's scenes draw, their
// caches kept from step to step (pictures, paragraphs, scenes, outlines, thumbnails). After every
// step each frame drawn from the caches equals, pixel for pixel, a draw with every cache empty. Then
// the same with a second tab's open steps drawn as previews (D7): each frame equals a fresh draw of
// the previewed design, and a click still hits what the working design has there.
import { resolveObjectURL } from 'node:buffer'

import { afterAll, describe, expect, it, vi } from 'vitest'

import type { SkPicture } from '@dazbee/canvaskit'
import { ScratchRejected } from '@dazbee/doc'
import { kindsDesign } from '@dazbee/doc/test-design'
import { twoTabs } from '@dazbee/doc/test-store'
import {
  openTab,
  seeded,
  SESSION_STEPS,
  type Tab,
  takeSessionStep,
  type Walk,
  walk,
  walkSeeds,
  walkSteps,
} from '@dazbee/doc/test-walk'
import { type Frame, pageFrames } from '@dazbee/editor/frames'
import { type EditorResources, editorResources } from '@dazbee/editor/resources'
import { type FrameScenes, frameScenes } from '@dazbee/editor/scenes'
import { type ThumbnailCache, thumbnailCache } from '@dazbee/editor/thumbnails'
import { type EditorView, editorView } from '@dazbee/editor/view'
import { FONT_FACES } from '@dazbee/fonts'
import { resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Design } from '@dazbee/schema'

import { comparePixels, decodePng, fixtureResources, type Pixels } from './pixels.ts'

vi.mock('nanoid', () => import('@dazbee/doc/test-ids'))

/** A design the editor's scenes draw, and those scenes and thumbnails, their caches kept between steps. */
interface Drawn {
  tab: Tab
  resources: EditorResources
  scenes: FrameScenes
  thumbnails: ThumbnailCache
  done: AbortController
}

/** Frames are compared at a quarter of their size: a cache that kept an old picture shows there as well. */
const SCALE = 0.25
/** How many layers' thumbnails each check compares; every layer's is asked for, so the cache holds them. */
const THUMBNAILS_COMPARED = 4
/** A walk records every frame twice a step; a cold CI runner needs more than vitest's 5 s. */
const WALK_TIMEOUT = 120_000
/** The families the brand kit's heading font changes between. */
const FAMILIES = [...new Set(FONT_FACES.map((face) => face.family))]

const ck = await loadCanvasKit()
const cache = resourceCache(ck)
afterAll(() => cache.delete())

/** The frames of every page, as the canvas shows them. */
const framesOf = (design: Design) => Object.keys(design.pages).flatMap((pageId) => pageFrames(design, pageId).frames)

/** A picture of a frame drawn on the CPU surface at SCALE, and read back. */
function pixelsOf(picture: SkPicture, frame: Frame): Pixels {
  const width = Math.max(1, Math.ceil(frame.width * SCALE))
  const height = Math.max(1, Math.ceil(frame.height * SCALE))
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  try {
    const canvas = surface.getCanvas()
    canvas.scale(SCALE, SCALE)
    canvas.drawPicture(picture)
    const image = surface.makeImageSnapshot()
    const pixels = image.readPixels(0, 0, {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    })
    image.delete()
    if (!(pixels instanceof Uint8Array)) throw new Error('no pixels')
    return { width, height, pixels }
  } finally {
    surface.dispose()
  }
}

/** A thumbnail's pixels, from the PNG its object URL holds. */
async function thumbnailPixels(url: string | null): Promise<Pixels | null> {
  if (url === null) return null
  const blob = resolveObjectURL(url)
  if (!blob) throw new Error(`no thumbnail at ${url}`)
  return decodePng(ck, new Uint8Array(await blob.arrayBuffer()))
}

/**
 * Checks that what the kept caches draw equals a draw with every cache empty: each frame's
 * picture, the layer a point of it hits, and the thumbnails of some layers and of each page.
 */
async function expectSameDraw({ tab, resources, scenes, thumbnails }: Drawn, random: () => number) {
  const design = tab.session.design()
  const frames = framesOf(design)
  const screen = resources.screen(design)
  const fresh = frameScenes({ ck, resources, drawn: () => design, changes: () => tab.session.changes() })
  const freshThumbnails = thumbnailCache({ ck, scenes: fresh, resources, current: () => design, drawn: () => design })
  try {
    const kept = scenes.pictures(frames, frames, screen).pictures
    const empty = fresh.pictures(frames, frames, screen).pictures
    for (const [i, { frame, picture }] of kept.entries()) {
      const { differing } = comparePixels(pixelsOf(empty[i]?.picture as SkPicture, frame), pixelsOf(picture, frame))
      if (differing > 0) throw new Error(`frame "${frame.id}" drawn from the caches differs in ${differing} pixels`)
      for (let x = 0.05; x < 1; x += 0.1)
        for (let y = 0.05; y < 1; y += 0.1) {
          const point = { x: frame.width * x, y: frame.height * y }
          const [hit, expected] = [scenes.hit(frame, point)?.id, fresh.hit(frame, point)?.id]
          if (hit !== expected)
            throw new Error(`a click at ${point.x}, ${point.y} in frame "${frame.id}" hits ${hit}, not ${expected}`)
        }
    }
    const layers = Object.keys(design.nodes)
    const urls = layers.map((id) => thumbnails.layer(id))
    for (let n = 0; n < THUMBNAILS_COMPARED && layers.length > 0; n++) {
      const at = Math.floor(random() * layers.length)
      const [mine, expected] = await Promise.all([
        thumbnailPixels(urls[at] ?? null),
        thumbnailPixels(freshThumbnails.layer(layers[at] as string)),
      ])
      const differing = mine && expected ? comparePixels(expected, mine).differing : mine === expected ? 0 : 1
      if (differing > 0) throw new Error(`the thumbnail of layer "${layers[at]}" differs in ${differing} pixels`)
    }
    for (const pageId of Object.keys(design.pages)) {
      const [mine, expected] = await Promise.all([
        thumbnailPixels(thumbnails.page(pageId)),
        thumbnailPixels(freshThumbnails.page(pageId)),
      ])
      const differing = mine && expected ? comparePixels(expected, mine).differing : mine === expected ? 0 : 1
      if (differing > 0) throw new Error(`the thumbnail of page "${pageId}" differs in ${differing} pixels`)
    }
  } finally {
    freshThumbnails.destroy()
    fresh.destroy()
  }
}

/** The resources the walks draw with: the fixtures' fonts and images, and no brand kit. */
function walkResources(signal: AbortSignal, variables: Record<string, string> = {}) {
  return editorResources({
    ck,
    cache,
    first: { ...fixtureResources(), variables },
    firstFaces: [],
    sources: {},
    connected: () => true,
    status: () => {},
    signal,
  })
}

const drawCaches: Walk<Drawn> = {
  kinds: { ...SESSION_STEPS, brand: 1 },
  open: () => {
    const tab = openTab(kindsDesign())
    // A linked frame, and a fill and a font that follow the brand kit, which no one undoes.
    tab.session.untracked(() => {
      tab.session.run('frame.duplicate', { frameId: 'f' })
      tab.session.run('node.bind', {
        ids: ['turned', 'r1'],
        property: 'fill',
        ref: 'brand:primary',
        value: '#112233FF',
      })
      tab.session.run('node.bind', { ids: ['words'], property: 'fontFamily', ref: 'brand:heading', value: 'Noto Sans' })
    })
    const done = new AbortController()
    const resources = walkResources(done.signal, { 'brand:primary': '#FF5A36FF', 'brand:heading': 'Noto Sans' })
    const scenes = frameScenes({
      ck,
      resources,
      drawn: () => tab.session.design(),
      changes: () => tab.session.changes(),
    })
    const design = () => tab.session.design()
    const thumbnails = thumbnailCache({ ck, scenes, resources, current: design, drawn: design })
    return { tab, resources, scenes, thumbnails, done }
  },
  take: async (world, step, say) => {
    const random = seeded(step.seed)
    if (step.kind === 'brand') {
      const primary = `#${Math.floor(random() * 0xffffff)
        .toString(16)
        .padStart(6, '0')
        .toUpperCase()}FF`
      const heading = FAMILIES[Math.floor(random() * FAMILIES.length)] as string
      say(`the brand kit's primary colour becomes ${primary} and its heading font ${heading}`)
      world.resources.setVariables({ 'brand:primary': primary, 'brand:heading': heading })
    } else takeSessionStep(world.tab, step, say)
    await expectSameDraw(world, random)
  },
  close: ({ tab, resources, scenes, thumbnails, done }) => {
    thumbnails.destroy()
    scenes.destroy()
    resources.destroy()
    done.abort()
    tab.session.destroy()
  },
}

/** Two tabs on one design: the first draws, with the second's open step as a preview. */
interface Previewed {
  a: Tab
  b: Tab & { store: { preview(): void } }
  /** Delivers the second tab's ended steps to the first. */
  sync: () => void
  /** The second tab's open step, if it has one. */
  open: { end(): void } | null
  view: EditorView
  resources: EditorResources
  scenes: FrameScenes
  done: AbortController
}

/**
 * Checks that the first tab's kept caches draw each frame as a fresh draw of the previewed design,
 * and that a click hits what a fresh draw of the working design has there.
 */
function expectPreviewDrawn({ a, view, resources, scenes }: Previewed) {
  view.update()
  const design = view.design()
  const shown = view.previewed()
  const frames = framesOf(design)
  const screen = resources.screen(shown)
  const fresh = frameScenes({ ck, resources, drawn: () => shown, changes: () => a.session.changes() })
  const working = frameScenes({ ck, resources, drawn: () => design, changes: () => a.session.changes() })
  try {
    const kept = scenes.pictures(frames, frames, screen).pictures
    const empty = fresh.pictures(frames, frames, screen).pictures
    for (const [i, { frame, picture }] of kept.entries()) {
      const { differing } = comparePixels(pixelsOf(empty[i]?.picture as SkPicture, frame), pixelsOf(picture, frame))
      if (differing > 0) throw new Error(`frame "${frame.id}" drawn with the previews differs in ${differing} pixels`)
      for (let x = 0.1; x < 1; x += 0.2)
        for (let y = 0.1; y < 1; y += 0.2) {
          const point = { x: frame.width * x, y: frame.height * y }
          const [hit, expected] = [scenes.hit(frame, point)?.id, working.hit(frame, point)?.id]
          if (hit !== expected)
            throw new Error(`a click at ${point.x}, ${point.y} in frame "${frame.id}" hits ${hit}, not ${expected}`)
        }
    }
  } finally {
    working.destroy()
    fresh.destroy()
  }
}

const drawPreviews: Walk<Previewed> = {
  kinds: { ...SESSION_STEPS, preview: 6, land: 2 },
  open: () => {
    const two = twoTabs(kindsDesign())
    const a: Tab = { store: two.a, session: two.tabA, name: 'a' }
    const b = { store: two.b, session: two.tabB, name: 'b' }
    const done = new AbortController()
    const resources = walkResources(done.signal)
    const view = editorView({ session: two.tabA, previews: two.a.previews, onZoom: () => {} })
    const scenes = frameScenes({
      ck,
      resources,
      drawn: view.design,
      changes: () => two.tabA.changes(),
      previewed: () => ({ design: view.previewed(), frames: view.previewedFrames() }),
    })
    return { a, b, sync: two.sync, open: null, view, resources, scenes, done }
  },
  take: (world, step, say) => {
    if (step.kind === 'preview') {
      // The second tab runs a command in its open step and sends what it has so far.
      world.open ??= world.b.session.beginGesture()
      takeSessionStep(world.b, { ...step, kind: 'command' }, (words) =>
        say(`the second tab, in its open step: ${words}`),
      )
      world.b.store.preview()
    } else if (step.kind === 'land') {
      say('the second tab ends its step, which reaches the first')
      world.open?.end()
      world.open = null
      // A step the first tab's edits made impossible is rejected, and taken back on the second.
      try {
        world.sync()
      } catch (error) {
        if (!(error instanceof ScratchRejected)) throw error
        say('the server rejects it')
      }
    } else takeSessionStep(world.a, step, say)
    expectPreviewDrawn(world)
  },
  close: ({ a, b, scenes, resources, done }) => {
    scenes.destroy()
    resources.destroy()
    done.abort()
    a.session.destroy()
    b.session.destroy()
  },
}

describe('the draw-cache walk', () => {
  it(
    'fails on a thumbnail cache that keeps a layer’s first picture whatever changes',
    async () => {
      const stale: Walk<Drawn> = {
        ...drawCaches,
        open: async (seed) => {
          const world = await drawCaches.open(seed)
          const first = new Map<string, string | null>()
          const layer = (id: string, size?: number, outlined?: boolean) => {
            if (!first.has(id)) first.set(id, world.thumbnails.layer(id, size, outlined))
            return first.get(id) ?? null
          }
          return { ...world, thumbnails: { ...world.thumbnails, layer } }
        },
      }
      await expect(walk(stale, 1, 20)).rejects.toThrow(/the thumbnail of layer "[^"]+" differs/)
    },
    WALK_TIMEOUT,
  )

  it.each(walkSeeds([1, 2]))(
    'draws every frame, hit and thumbnail from the caches kept between steps as with every cache empty (seed %i)',
    (seed) => walk(drawCaches, seed, walkSteps(30)),
    WALK_TIMEOUT,
  )

  it.each(walkSeeds([1]))(
    "draws another tab's open steps as a fresh draw of the previewed design, clicks hitting the working one (seed %i)",
    (seed) => walk(drawPreviews, seed, walkSteps(30)),
    WALK_TIMEOUT,
  )
})
