// Make editable's finish, run in one tab: when the design's AI frames say a frame's layering job has made its split
// layers, a tab claims the job's finish through the API, renews the lease every minute while it works, and lets it
// go once done. It downloads each split layer, crops it to what it shows, scaled to the frame, uploads the crops as
// hidden parts of the brand, and places them in the frame as one arrival no undo takes back: the picture layer
// hidden at the bottom, then a picture layer per split layer, bottom first, in the split's order reversed. Layer ids
// come from the job, so a second finish places nothing new. A frame whose picture changed or went meanwhile gets no
// layers, and offers Make editable again. Another tab holding the lease is waited for; a lease that lapses, as when a
// tab closes mid-way, is claimed by the next tab.
import type { CanvasKit } from '@dazbee/canvaskit'
import type { Session } from '@dazbee/doc'
import { type AiFrameView, type AiJobView, type DesignAi, type Layer, pictureLayerOf } from '@dazbee/schema'

import type { EditorAi } from './arrivals.ts'
import { frameLayers, layerName, layerPlanOf, type PieceBox, pieceId, scaleBox, visibleBox } from './layer-pieces.ts'
import { shownPicture } from './place-brief.ts'

/** A split layer cropped and uploaded: its layer's id and name, its picture and its box in the frame. */
interface Piece {
  id: string
  name: string
  assetId: string
  box: PieceBox
}

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

/** How often a held lease is renewed: well inside its 2 minutes. */
export const RENEW_MS = 60_000

export function editorLayeringFinish(deps: LayeringFinishDeps): EditorLayeringFinish {
  const { session, ai, ck, holder, read, onRead, after, signal } = deps
  /** The finishes on their way, by frame. */
  const running = new Map<string, Promise<void>>()

  function look() {
    const now = read()
    if (!now || signal.aborted || session.readOnly()) return
    for (const frame of now.frames) {
      const job = now.jobs.find((j) => j.id === frame.jobId)
      if (frame.state !== 'layering' || job?.state !== 'done' || running.has(frame.frameId)) continue
      const done = finish(frame, job)
        .catch(() => {
          // Refused, offline or a picture that wouldn't draw: the lease lapses, and a later read tries again.
        })
        .finally(() => running.delete(frame.frameId))
      running.set(frame.frameId, done)
    }
  }

  /** Claims frame `frame`'s finish and, while this tab holds it, places its layers and ends it. */
  async function finish(frame: AiFrameView, job: AiJobView) {
    if (!(await ai.claim(job.id, holder))) return
    let renewing = after(RENEW_MS, renew)
    function renew() {
      renewing = after(RENEW_MS, renew)
      void ai.claim(job.id, holder)
    }
    try {
      const pieces = await piecesOf(frame, job)
      if (signal.aborted) return
      if (pieces) {
        await deps.readyPictures(pieces.map((p) => p.assetId))
        await deps.arrive(() => place(frame, pieces))
      }
      await ai.finished(job.id, holder)
      await deps.poll()
    } finally {
      renewing()
    }
  }

  /**
   * The frame's split layers as pieces, cropped, scaled to the frame and uploaded; null when the frame or its picture
   * layer is gone, or the layer shows another picture than the one made editable.
   */
  async function piecesOf(frame: AiFrameView, job: AiJobView): Promise<Piece[] | null> {
    const own = session.design().frames[frame.frameId]
    const layers = frameLayers(job, frame)
    const picture = pictureOf(frame.frameId)
    if (!own || !layers || !picture || shownPicture(picture) !== frame.assetId) return null
    const plan = layerPlanOf(job)
    const pieces: Piece[] = []
    for (const [index, size] of layers.layers.entries()) {
      if (signal.aborted) return null
      const cropped = crop(await ai.file(job.id, layers.first + index))
      if (!cropped) continue
      pieces.push({
        id: pieceId(job.id, frame.frameId, index),
        name: layerName(plan, index, ai.layerWord),
        assetId: await ai.part(cropped.png),
        box: scaleBox(cropped.box, size.width, own.width),
      })
    }
    return pieces
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

  /** Hides the frame's picture layer and places the pieces over it, bottom first, any already placed left as they are. */
  function place(frame: AiFrameView, pieces: readonly Piece[]) {
    const pictureId = pictureLayerOf(frame.frameId)
    session.run('node.update', { ids: [pictureId], patch: { visible: false } })
    for (const piece of [...pieces].reverse()) {
      if (session.design().nodes[piece.id]) continue
      session.run('node.create', {
        id: piece.id,
        parentId: frame.frameId,
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

  /** Frame `frameId`'s picture layer, when the design has it there. */
  function pictureOf(frameId: string): Pick<Layer, 'props'> | undefined {
    const layer = session.design().nodes[pictureLayerOf(frameId)]
    return layer?.parentId === frameId ? layer : undefined
  }

  const off = onRead(look)
  signal.addEventListener('abort', off)
  look()

  return {
    finishing: () => [...running.keys()],
    async settled() {
      while (running.size > 0) await Promise.all(running.values())
    },
  }
}
