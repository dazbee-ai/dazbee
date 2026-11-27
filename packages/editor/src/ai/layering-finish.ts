// Make editable's finish, run in one tab: when the design's AI frames say a frame's layering job has made its split
// layers, a tab claims the job's finish through the API, renews the lease every minute while it works, and lets it
// go once done. It downloads each split layer, crops it to what it shows, scaled to the frame, uploads the crops as
// hidden parts of the brand, and places them in the frame as one arrival no undo takes back: the picture layer
// hidden at the bottom, then a picture layer per split layer, bottom first, in the split's order reversed. Layer ids
// come from the job, so a second finish places nothing new. A frame whose picture changed or went meanwhile gets no
// layers, and offers Make editable again; so does a frame whose picture layer no longer fills it as drawn, and a split
// that shows nothing. Another tab holding the lease is waited for; a lease that lapses, as when a tab closes mid-way,
// is claimed by the next tab, and a tab that lost its lease places nothing. A finish that fails is tried again after a
// minute, its parts uploaded once, and ended with nothing placed after three tries.
import type { CanvasKit } from '@dazbee/canvaskit'
import type { Session } from '@dazbee/doc'
import { type AiFrameView, type AiJobView, type DesignAi, frameIdOf, type Layer, pictureLayerOf } from '@dazbee/schema'

import type { EditorAi } from './arrivals.ts'
import { frameLayers, layerName, layerPlanOf, type PieceBox, pieceId, scaleBox, visibleBox } from './layer-pieces.ts'
import { shownPicture } from './place-brief.ts'

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
  /** Settles once every finish started so far is done or given up. */
  settled(): Promise<void>
}

/** A split layer cropped and uploaded: its layer's id and name, its picture and its box in the frame. */
interface SplitLayer {
  id: string
  /** The link id it shares with the same split layer of the job's other sizes. */
  link: string
  name: string
  assetId: string
  box: PieceBox
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
   * their layers' link ids by the split layer's place, which is the place of its element in the one layer plan.
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
      const placing: [AiFrameView, SplitLayer[]][] = []
      let failed: unknown = null
      for (const frame of frames) {
        let pieces: SplitLayer[] | null
        try {
          pieces = await piecesOf(frame, job)
        } catch (e) {
          if (!last) throw e
          failed = e
          continue
        }
        if (signal.aborted || lost) return
        if (pieces) placing.push([frame, pieces])
      }
      if (placing.length === 0 && failed !== null) throw failed
      if (placing.length > 0) {
        await deps.readyPictures(placing.flatMap(([, pieces]) => pieces.map((p) => p.assetId)))
        if (signal.aborted || lost) return
        const linked = frames.length > 1
        const outcome = await deps.arrive(() => {
          for (const [frame, pieces] of placing) if (fits(frame)) place(frame, pieces, linked)
        })
        // Nothing ran, as when the editor ended or turned view-only: the finish is left for a later try.
        if (outcome !== 'saved') return
      }
      await ai.finished(job.id, holder)
      await deps.poll()
    } finally {
      renewing()
    }
  }

  /**
   * The frame's split layers as pieces, cropped, scaled to the frame and uploaded; null when there is nothing to place:
   * the frame or its picture layer is gone, the layer no longer shows the picture made editable as it was drawn, or
   * the split shows nothing.
   */
  async function piecesOf(frame: AiFrameView, job: AiJobView): Promise<SplitLayer[] | null> {
    const own = session.design().frames[frame.frameId]
    const layers = frameLayers(job, frame)
    if (!own || !layers || !fits(frame)) return null
    const plan = layerPlanOf(job)
    const pieces: SplitLayer[] = []
    for (const [index, size] of layers.layers.entries()) {
      if (signal.aborted) return null
      const cropped = crop(await ai.file(job.id, layers.first + index))
      if (!cropped) continue
      const key = `${job.id}/${frame.frameId}/${index}`
      const assetId = uploaded.get(key) ?? (await ai.part(cropped.png))
      uploaded.set(key, assetId)
      pieces.push({
        id: pieceId(job.id, frame.frameId, index),
        link: `${job.id}-${index}`,
        name: layerName(plan, index, ai.layerWord),
        assetId,
        box: scaleBox(cropped.box, size.width, own.width),
      })
    }
    return pieces.length > 0 ? pieces : null
  }

  /**
   * Whether frame `frame`'s picture layer still shows the picture made editable as the split saw it: that picture,
   * filling the whole frame, at the frame's size when the job was asked for.
   */
  function fits(frame: AiFrameView): boolean {
    const own = session.design().frames[frame.frameId]
    const picture = pictureOf(frame.frameId)
    if (!own || !picture || shownPicture(picture) !== frame.assetId) return false
    const props = picture.props as {
      x?: number
      y?: number
      width?: number
      height?: number
      fills?: { fit?: string }[]
    }
    const fill = props.fills?.find((f) => 'fit' in f)
    return (
      props.x === 0 &&
      props.y === 0 &&
      props.width === own.width &&
      props.height === own.height &&
      (fill?.fit === undefined || fill.fit === 'fill')
    )
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

  /**
   * Hides the frame's picture layer and places the pieces over it, bottom first, any already placed left as they
   * are, each sharing its link id with the job's other sizes when `linked` and the frame doesn't hold it already.
   */
  function place(frame: AiFrameView, pieces: readonly SplitLayer[], linked: boolean): void {
    const pictureId = pictureLayerOf(frame.frameId)
    session.run('node.update', { ids: [pictureId], patch: { visible: false } })
    for (const piece of [...pieces].reverse()) {
      if (session.design().nodes[piece.id]) continue
      session.run('node.create', {
        id: piece.id,
        parentId: frame.frameId,
        ...(linked && !holdsLink(frame.frameId, piece.link) ? { link: piece.link } : {}),
        layer: {
          type: 'graphic',
          name: piece.name,
          props: {
            ...piece.box,
            shape: { kind: 'rect' },
            fills: [{ type: 'image', assetId: piece.assetId, fit: 'fill' }],
          },
        },
      })
    }
  }

  /** Whether frame `frameId` holds a layer of link id `link` already, as a pasted copy can. */
  function holdsLink(frameId: string, link: string): boolean {
    const { nodes } = session.design()
    return Object.values(nodes).some(
      (node) => node.link === link && frameIdOf(session.design(), node.parentId) === frameId,
    )
  }

  /** Frame `frameId`'s picture layer, when the design has it there. */
  function pictureOf(frameId: string): Pick<Layer, 'props'> | undefined {
    const layer = session.design().nodes[pictureLayerOf(frameId)]
    return layer?.parentId === frameId ? layer : undefined
  }

  async function settled() {
    while (running.size > 0) await Promise.all(running.values())
  }

  const off = onRead(look)
  signal.addEventListener('abort', off)
  look()

  return {
    finishing: () => (read()?.frames ?? []).filter((f) => running.has(f.jobId)).map((f) => f.frameId),
    settled,
  }
}
