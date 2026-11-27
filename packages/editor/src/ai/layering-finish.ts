// Make editable's finish, run in one tab: when the design's AI frames say a frame's layering job has made its split
// layers, a tab claims the job's finish through the API, renews the lease every minute while it works, and lets it
// go once done. A frame whose split cut split pieces, each recorded as an asset, gets a layer per piece, named after
// its planned part, with nothing downloaded or uploaded: a text piece the text matcher rebuilds becomes a live text,
// fitted to its words and bound to the brand kit where the matcher bound it, a shape piece the shape matcher
// rebuilds becomes its graphics, and every other piece a picture layer, where the picture's own fill draws the
// piece (`piece-rebuild.ts`, which also tells the frame's pieces as lifting while the matchers work). For any other
// frame it downloads each split layer, crops it to what it shows, scaled to the frame, and uploads the crops as
// hidden parts of the brand, a picture layer per split layer. Either way the layers are placed in the frame
// (`place-layers.ts`) as one arrival no undo takes back: the picture layer hidden at the bottom, then the layers,
// bottom first, in the split's order reversed. Layer ids come from the job, so a second finish places nothing new. A frame whose picture changed
// or went meanwhile gets no layers, and offers Make editable again; so does a frame whose picture layer no longer
// fills it as drawn, and a split that shows nothing. Another tab holding the lease is waited for; a lease that
// lapses, as when a tab closes mid-way, is claimed by the next tab, and a tab that lost its lease places nothing. A
// finish that fails is tried again after a minute, its parts uploaded once, and ended with nothing placed after three
// tries; on the last try, matchers that fail leave their pieces pictures, and so do rebuilt layers the design refuses.
import type { CanvasKit } from '@dazbee/canvaskit'
import type { Session } from '@dazbee/doc'
import type { FontUse } from '@dazbee/fonts'
import { type AiFrameView, type AiJobView, type DesignAi, type MadePieces } from '@dazbee/schema'

import type { EditorAi } from './arrivals.ts'
import {
  frameLayers,
  framePieces,
  layerName,
  layerPlanOf,
  onePlan,
  type PieceBox,
  pieceBox,
  pieceCrop,
  pieceId,
  pieceLink,
  pieceName,
  readingOf,
  scaleBox,
  sharedLinks,
  visibleBox,
} from './layer-pieces.ts'
import type { PieceMatcher } from './piece-matcher.ts'
import { type LiftedFrame, pieceRebuild } from './piece-rebuild.ts'
import { asPicture, fontUses, type PlacedLayer, placeLayers } from './place-layers.ts'

export interface LayeringFinishDeps {
  session: Session
  ai: EditorAi
  ck: CanvasKit
  /** This tab's own id, which holds a finish's lease. */
  holder: string
  /** The design's AI frames as last read, and when that changes. */
  read: () => DesignAi | null
  onRead: (listener: () => void) => () => void
  /** Runs `run` after `ms`, giving what cancels it. */
  after: (ms: number, run: () => void) => () => void
  /** Gets pictures ready to draw; settles once they are, or can't be. */
  readyPictures: (assetIds: readonly string[]) => Promise<void>
  /** The encoded bytes the editor holds of an image, by its asset; none for one not loaded. */
  imageBytes: (assetId: string) => Uint8Array | undefined
  /** The matchers' answers for a frame's split pieces; without it every piece stays a picture. */
  matcher?: PieceMatcher | undefined
  /** Gets the fonts of these uses ready to draw; settles once they are, or can't be. */
  readyFonts: (uses: readonly FontUse[]) => Promise<void>
  /** Fits a text that grows with its words to them, in the step it is written in. */
  fitText: (id: string) => void
  /** Runs `steps` as one arrival; resolves whether the server stored it. */
  arrive: (steps: () => void) => Promise<'saved' | 'none'>
  /** Reads the design's AI frames again. */
  poll: () => Promise<void>
  /** Aborted when the editor ends: no claim, download or write starts after it. */
  signal: AbortSignal
}

export interface EditorLayeringFinish {
  /** The frames this tab is finishing now. */
  finishing(): string[]
  /** The frames whose split pieces the matchers are working on now, with their pieces lifting apart. */
  lifting(): readonly LiftedFrame[]
  /** Calls back when `lifting()` changes; gives what stops it. */
  onLifting(listener: () => void): () => void
  /** Settles once every finish started so far is done or given up. */
  settled(): Promise<void>
}

type Size = Pick<PieceBox, 'width' | 'height'>

/** What a job's frames link their layers by. */
interface Links {
  /** The link ids that split pieces of two or more of the job's frames have. */
  shared: ReadonlySet<string>
  /** Whether split layers link by their number: several frames split by one layer plan. */
  byLayer: boolean
}

/** How often a held lease is renewed: well inside its 2 minutes. */
export const RENEW_MS = 60_000
/** How long a tab waits before trying a failed finish again. */
export const RETRY_MS = 60_000
/** How many times a tab tries a finish before ending it with nothing placed. */
export const TRIES = 3

export function editorLayeringFinish(deps: LayeringFinishDeps): EditorLayeringFinish {
  const { session, ai, ck, holder, read, onRead, after, signal } = deps
  /** The finishes on their way, by job: one job's frames are finished together. */
  const running = new Map<string, Promise<void>>()
  /** How many times each job's finish failed in this tab, and the jobs waiting a minute before the next try. */
  const failures = new Map<string, number>()
  const resting = new Set<string>()
  /** The parts uploaded, by job, frame and split layer, so a finish tried again uploads none twice. */
  const uploaded = new Map<string, string>()
  /** The matchers' rebuild of a frame's pieces, which holds the frames lifting meanwhile. */
  const rebuild = pieceRebuild(deps)
  const { fits, place } = placeLayers(deps)

  function look() {
    const now = read()
    if (!now || signal.aborted || session.readOnly()) return
    for (const job of now.jobs) {
      const frames = now.frames.filter((f) => f.jobId === job.id && f.state === 'layering')
      const key = job.id
      if (frames.length === 0 || job.state !== 'done' || running.has(key) || resting.has(key)) continue
      const done = finish(frames, job)
        .catch(() => {
          // Refused, offline or a picture that wouldn't draw: tried again after a minute, ended after three tries.
          const tries = (failures.get(key) ?? 0) + 1
          failures.set(key, tries)
          resting.add(key)
          after(RETRY_MS, () => {
            resting.delete(key)
            look()
          })
          if (tries >= TRIES) void giveUp(job.id)
        })
        .finally(() => running.delete(key))
      running.set(key, done)
    }
  }

  /** Ends a finish that kept failing, nothing placed, so its frames offer Make editable again. */
  async function giveUp(jobId: string) {
    try {
      if (await ai.claim(jobId, holder)) await ai.finished(jobId, holder)
      await deps.poll()
    } catch {
      // Offline: the lease lapses, and a later tab tries.
    }
  }

  /**
   * Claims the finish of job `job`, whose `frames` are being made editable, and, while this tab holds it, places each
   * frame's layers in one arrival and ends it. A frame with nothing to place gets nothing; places nothing and leaves
   * the finish when the tab lost its lease or ended. A frame whose layers won't read fails the whole finish, to be
   * tried again, except on the last try, when the frames that did read are placed. Several sizes of one ad share
   * link ids: a split piece's layer with the pieces of the same planned part in the other sizes, and a split
   * layer's by the split layer's place when one layer plan split every size.
   */
  async function finish(frames: readonly AiFrameView[], job: AiJobView) {
    if (!(await ai.claim(job.id, holder))) return
    let lost = false
    let renewing = after(RENEW_MS, renew)
    function renew() {
      renewing = after(RENEW_MS, renew)
      ai.claim(job.id, holder).then(
        (held) => {
          if (!held) lost = true
        },
        () => {
          lost = true
        },
      )
    }
    try {
      const last = (failures.get(job.id) ?? 0) >= TRIES - 1
      const links = { shared: sharedLinks(job, frames), byLayer: frames.length > 1 && onePlan(job) }
      const placing: [AiFrameView, PlacedLayer[]][] = []
      let failed: unknown = null
      for (const frame of frames) {
        let layers: PlacedLayer[] | null
        try {
          layers = await layersOf(frame, job, links, last)
        } catch (e) {
          if (!last) throw e
          failed = e
          continue
        }
        if (signal.aborted || lost) return
        if (layers) placing.push([frame, layers])
      }
      if (placing.length === 0 && failed !== null) throw failed
      if (placing.length > 0) {
        const placed = placing.flatMap(([, layers]) => layers)
        await Promise.all([
          deps.readyPictures(placed.flatMap((layer) => (layer.matched ? [] : [layer.assetId]))),
          deps.readyFonts(placed.flatMap((layer) => (layer.matched ?? []).flatMap((made) => fontUses(made.layer)))),
        ])
        if (signal.aborted || lost) return
        const outcome = await landed(placing, last)
        // Nothing ran, as when the editor ended or turned view-only: the finish is left for a later try.
        if (outcome !== 'saved') return
      }
      await ai.finished(job.id, holder)
      await deps.poll()
    } finally {
      renewing()
      for (const frame of frames) rebuild.settle(frame.frameId)
    }
  }

  /**
   * Places each frame's layers as one arrival; whether the server stored it. On the `last` try, an arrival holding
   * rebuilt layers that the design refuses is placed again with every piece a picture.
   */
  async function landed(placing: readonly [AiFrameView, PlacedLayer[]][], last: boolean) {
    const land = (pictures: boolean) =>
      deps.arrive(() => {
        for (const [frame, layers] of placing) if (fits(frame)) place(frame, pictures ? layers.map(asPicture) : layers)
      })
    try {
      return await land(false)
    } catch (e) {
      if (!last || !placing.some(([, layers]) => layers.some((layer) => layer.matched))) throw e
      return land(true)
    }
  }

  /**
   * The layers to place in the frame: its split pieces', those the matchers rebuild as their live layers, or else
   * its split layers', cropped, scaled to the frame and uploaded; null when there is nothing to place: the frame or
   * its picture layer is gone, the layer no longer shows the picture made editable as it was drawn, or the split
   * shows nothing. On the `last` try, matchers that fail leave every piece a picture.
   */
  async function layersOf(
    frame: AiFrameView,
    job: AiJobView,
    links: Links,
    last: boolean,
  ): Promise<PlacedLayer[] | null> {
    const own = session.design().frames[frame.frameId]
    if (!own || !fits(frame)) return null
    const cut = framePieces(job, frame)
    const ofPieces = cut && pieceLayers(frame, job, cut, own, links.shared)
    if (cut && ofPieces) return rebuilt(frame, job, cut, own, ofPieces, last)
    const layers = frameLayers(job, frame)
    if (!layers) return null
    const plan = layerPlanOf(job, frame)
    const placed: PlacedLayer[] = []
    for (const [index, size] of layers.layers.entries()) {
      if (signal.aborted) return null
      const cropped = crop(await ai.file(job.id, layers.first + index))
      if (!cropped) continue
      const key = `${job.id}/${frame.frameId}/${index}`
      const assetId = uploaded.get(key) ?? (await ai.part(cropped.png))
      uploaded.set(key, assetId)
      placed.push({
        id: pieceId(job.id, frame.frameId, index),
        link: links.byLayer ? `${job.id}-${index}` : null,
        name: layerName(plan, index, ai.layerWord),
        assetId,
        box: scaleBox(cropped.box, size.width, own.width),
      })
    }
    return placed.length > 0 ? placed : null
  }

  /**
   * A layer per split piece `cut` of the frame, of size `own`: the piece's recorded asset where the picture's fill
   * draws the piece, named after its planned part in the frame's plan, with its link id when it is among `shared`.
   * Null when one of the pieces has no recorded asset.
   */
  function pieceLayers(
    frame: AiFrameView,
    job: AiJobView,
    cut: MadePieces,
    own: Size,
    shared: ReadonlySet<string>,
  ): PlacedLayer[] | null {
    const plan = layerPlanOf(job, frame)
    const layers: PlacedLayer[] = []
    for (const [n, piece] of cut.items.entries()) {
      const { assetId } = piece.picture
      if (assetId === undefined) return null
      const link = pieceLink(job.id, plan, piece)
      layers.push({
        id: pieceId(job.id, frame.frameId, n),
        link: link !== null && shared.has(link) ? link : null,
        name: pieceName(plan, piece, n, ai.layerWord),
        assetId,
        box: pieceBox(piece, cut, own),
        crop: pieceCrop(piece, cut, own),
      })
    }
    return layers
  }

  /**
   * The frame's piece layers `layers`, one per split piece of `cut`, with those the matchers rebuild given their
   * live layers, placed in the frame of size `own`, each with its id. On the `last` try, a rebuild that fails leaves
   * every piece a picture.
   */
  async function rebuilt(
    frame: AiFrameView,
    job: AiJobView,
    cut: MadePieces,
    own: Size,
    layers: PlacedLayer[],
    last: boolean,
  ): Promise<PlacedLayer[]> {
    const pieces = { cut, plan: layerPlanOf(job, frame), reading: readingOf(job, frame), pictureAssetId: frame.assetId }
    let made: Awaited<ReturnType<typeof rebuild.layers>>
    try {
      made = await rebuild.layers(frame.frameId, pieces, own, layers)
    } catch (e) {
      if (!last) throw e
      return layers
    }
    return layers.map((layer, n) => {
      const matched = made.get(n)?.map((one, nth) => ({ id: pieceId(job.id, frame.frameId, n, nth), layer: one }))
      return matched ? { ...layer, matched } : layer
    })
  }

  /** A split layer cropped to what it shows, as a PNG, and its box in the layer's pixels; null when it shows nothing. */
  function crop(bytes: Uint8Array): { png: Uint8Array; box: PieceBox } | null {
    const image = ck.MakeImageFromEncoded(bytes)
    if (!image) throw new Error('a split layer is not a picture')
    try {
      const width = image.width()
      const height = image.height()
      const pixels = image.readPixels(0, 0, {
        width,
        height,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB,
      })
      if (!pixels) throw new Error('a split layer could not be read')
      const alpha = new Uint8Array(width * height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3] ?? 0
      const box = visibleBox(alpha, width, height)
      if (!box) return null
      const surface = ck.MakeSurface(box.width, box.height)
      if (!surface) throw new Error('no surface for a split layer')
      try {
        const canvas = surface.getCanvas()
        canvas.clear(ck.TRANSPARENT)
        canvas.drawImage(image, -box.x, -box.y)
        const snapshot = surface.makeImageSnapshot()
        const png = snapshot.encodeToBytes()
        snapshot.delete()
        if (!png) throw new Error('a split layer could not be encoded')
        return { png, box }
      } finally {
        surface.delete()
      }
    } finally {
      image.delete()
    }
  }

  async function settled() {
    while (running.size > 0) await Promise.all(running.values())
  }

  const off = onRead(look)
  signal.addEventListener('abort', off)
  look()

  return {
    finishing: () => (read()?.frames ?? []).filter((f) => running.has(f.jobId)).map((f) => f.frameId),
    lifting: rebuild.lifting,
    onLifting: rebuild.onLifting,
    settled,
  }
}
