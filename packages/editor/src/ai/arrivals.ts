// AI results arriving in the design (ADR-0004): a brief the tab starts, placed once its job is saved, and each
// picture made, written into its frame's picture layer. Each is an arrival: commands run untracked, one change set
// that no undo of any tab takes back, so Ctrl+Z never removes paid work. Every open tab reads the design's AI
// frames as it opens, then every 10 s while it is shown, or every 3 s while a frame of the design waits for its
// picture, so a tab opened before a colleague's brief fills it too. Once a picture's arrival is stored, the tab
// marks its call written in the API, and a call marked written is never written again: a version put back over
// it, or a picture dropped on it, stays.
import { NotSaved, type Session } from '@dazbee/doc'
import {
  type AiFrameView,
  type AiFrameWritten,
  type AiJobRefusal,
  type AiMode,
  type AiSize,
  belowAll,
  type DesignAi,
  type StartAiJob,
} from '@dazbee/schema'

import { type BriefPlan, pictureLayerOf, placeBrief, planBrief, WAITING_FILL } from './place-brief.ts'

/** How a job a tab starts came out: saved, or refused with why, the refusal named when saving it was refused. */
export type AiStart = { ok: true; job: string } | { ok: false; refusal: AiJobRefusal | null; message: string }

/** What the editor asks of the API for the AI flow, through the app's routes. */
export interface EditorAi {
  /** The design's AI frames, with their jobs and briefs. */
  read(): Promise<DesignAi>
  /** Starts a job on the design; a refusal comes back as the answer, never thrown. */
  start(job: StartAiJob): Promise<AiStart>
  /** Marks a call written into the design's frame `frameId`. */
  written(frameId: string, written: AiFrameWritten): Promise<void>
}

/** A brief the tab starts on a page: its words, the brand's pictures it names, one size and a mode. */
export interface BriefRequest {
  pageId: string
  words: string
  pictures: string[]
  size: AiSize
  mode: AiMode
  /** Each draft's name, by its place from 0. */
  draftName: (n: number) => string
}

/** A brief started: its job and its section, placed below everything on its page; or why it was refused. */
export type BriefStarted = { ok: true; job: string; sectionId: string } | Extract<AiStart, { ok: false }>

export interface ArrivalsDeps {
  session: Session
  ai: EditorAi
  designId: string
  /** Makes the ids of a brief's section, frames and picture layers. */
  newId: () => string
  /** Runs `run` after `ms`, giving what cancels it. */
  after: (ms: number, run: () => void) => () => void
  /** Whether the tab is shown now, and when that changes. */
  shown: { now(): boolean; onChange(listener: () => void): () => void }
  /** Aborted when the editor ends: no read, write or mark starts after it. */
  signal: AbortSignal
}

export interface EditorArrivals {
  /**
   * Starts a round from a brief: makes its ids, starts the job with them, and only once it is saved places the
   * section and its frames below everything on the page, as one arrival. A refused job places nothing.
   */
  startBrief(request: BriefRequest): Promise<BriefStarted>
  /** Reads the design's AI frames now and writes the pictures that arrived; the next read is 3 s or 10 s after. */
  poll(): Promise<void>
  /** The AI frames of the design that wait for their picture, as last read, among the frames the design has. */
  waiting(): string[]
  /** Settles once every arrival of a picture started so far is stored and marked written, or given up. */
  settled(): Promise<void>
}

/** How long a shown tab waits between reads of the design's AI frames. */
export const POLL_MS = 10_000
/** How long it waits while a frame of the design waits for its picture. */
export const POLL_WAITING_MS = 3_000

/**
 * Runs `steps` as one arrival: their commands as one gesture, untracked, so no undo of any tab takes them back.
 * After a gesture of the tab's own still open, it runs once that ends, as `untracked` does. Resolves 'saved' once
 * the sync server has stored it, at once when it changed nothing; 'none' when it ran nothing, in a tab that may
 * only view the design, or once `signal` aborts first. Fails with what `steps` threw, its commands' writes put
 * back, and with `NotSaved` when the server didn't store it.
 */
export function arrive(session: Session, signal: AbortSignal, steps: () => void): Promise<'saved' | 'none'> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || session.readOnly()) return resolve('none')
    const ended = () => resolve('none')
    signal.addEventListener('abort', ended)
    session.untracked(() => {
      signal.removeEventListener('abort', ended)
      if (signal.aborted) return
      const step = session.beginGesture()
      try {
        steps()
      } catch (error) {
        // A refusal leaves the gesture open with what it wrote, which is put back; a fault put it back already.
        step.cancel()
        reject(error)
        return
      }
      step.end()
      try {
        session.whenConfirmed(step).then(resolve, reject)
      } catch (error) {
        // Put back as it ended, by a fault of the step's own.
        reject(error)
      }
    })
  })
}

export function editorArrivals({ session, ai, designId, newId, after, shown, signal }: ArrivalsDeps): EditorArrivals {
  /** The design's AI frames, jobs and briefs as last read; null before the first read. */
  let read: DesignAi | null = null
  /** The read on its way, while one is. */
  let reading: Promise<void> | null = null
  /** Cancels the next read, while one waits. */
  let next: (() => void) | null = null
  /** The arrivals of pictures on their way, by frame, job and call: none of them starts again meanwhile. */
  const writing = new Map<string, Promise<void>>()
  /** The calls whose arrival the server refused: this tab writes them no more. */
  const refused = new Set<string>()

  /** The AI frames of the design that wait for their picture, as last read, among the frames the design has. */
  function waiting(): string[] {
    const { frames } = session.design()
    return (read?.frames ?? []).filter((f) => f.state === 'waiting' && frames[f.frameId]).map((f) => f.frameId)
  }

  async function startBrief(request: BriefRequest): Promise<BriefStarted> {
    const plan = planBrief(newId)
    const started = await ai.start({
      kind: 'round',
      designId,
      sectionId: plan.sectionId,
      frames: plan.frames,
      words: request.words,
      pictures: request.pictures,
      size: request.size,
      mode: request.mode,
    })
    if (!started.ok || signal.aborted) return started.ok ? { ...started, sectionId: plan.sectionId } : started
    place(plan, request)
    void poll()
    return { ok: true, job: started.job, sectionId: plan.sectionId }
  }

  /** Places a started brief below everything on its page as one arrival; refused, its frames' pictures stay in the brand's images. */
  function place(plan: BriefPlan, request: BriefRequest) {
    const placing = { plan, pageId: request.pageId, words: request.words, size: request.size }
    arrive(session, signal, () => {
      const at = belowAll(session.design().frames, request.pageId)
      placeBrief(session, { ...placing, draftName: request.draftName }, at)
    }).catch(() => {
      // A page deleted meanwhile, or a design at its limits: the drafts are made and kept as the brand's images.
    })
  }

  function poll(): Promise<void> {
    if (reading) return reading
    next?.()
    next = null
    reading = (async () => {
      try {
        // A Reviewer's tab writes nothing, and the API answers it nothing.
        if (signal.aborted || session.readOnly()) return
        const now = await ai.read()
        if (signal.aborted) return
        read = now
        for (const frame of now.frames) fill(now, frame)
      } catch {
        // Offline, or the API is away: the next read tries again.
      } finally {
        reading = null
        schedule()
      }
    })()
    return reading
  }

  /** Waits for the next read: 3 s while a frame waits, else 10 s; none while the tab is hidden. */
  function schedule() {
    if (signal.aborted || !shown.now() || reading || next) return
    next = after(waiting().length > 0 ? POLL_WAITING_MS : POLL_MS, () => {
      next = null
      void poll()
    })
  }

  /**
   * Writes the picture of a waiting frame's call into its picture layer, once the call has made it and while the
   * layer still waits, then marks the call written. A layer that shows the picture already is only marked; one
   * the person filled meanwhile is marked and keeps what they put there. A frame or layer the design hasn't, such
   * as one deleted, is left for an undo that brings it back.
   */
  function fill(now: DesignAi, frame: AiFrameView) {
    if (frame.state !== 'waiting') return
    const key = `${frame.frameId}/${frame.jobId}/${frame.callIndex}`
    const asset = madePicture(now, frame)
    if (!asset || writing.has(key) || refused.has(key)) return
    const design = session.design()
    const layerId = pictureLayerOf(frame.frameId)
    const layer = design.nodes[layerId]
    if (!design.frames[frame.frameId] || layer?.parentId !== frame.frameId || !('fills' in layer.props)) return
    const fills = layer.props.fills as { type: string; assetId?: string; color?: string }[]
    const shows = fills.some((f) => f.type === 'image' && f.assetId === asset)
    const waits = fills.length === 1 && fills[0]?.type === 'solid' && fills[0].color === WAITING_FILL.color
    const written = { jobId: frame.jobId, callIndex: frame.callIndex }
    const arrived =
      shows || !waits
        ? Promise.resolve('saved' as const)
        : arrive(session, signal, () =>
            session.run('node.update', {
              ids: [layerId],
              patch: { fills: [{ type: 'image', assetId: asset, fit: 'fill' }] },
            }),
          )
    const done = arrived
      .then(async (outcome) => {
        if (outcome === 'saved' && !signal.aborted) await ai.written(frame.frameId, written)
        if (read) read = { ...read, frames: read.frames.map((f) => (f === frame ? { ...f, state: 'arrived' } : f)) }
        // With no frame left waiting, the next read waits the longer time.
        if (next && waiting().length === 0) {
          next()
          next = null
          schedule()
        }
      })
      .catch((error: unknown) => {
        // Refused by the server, it isn't written again here; lost with the connection, or not marked, the next read tries again.
        if (error instanceof NotSaved && (error.why === 'rejected' || error.why === 'tooBig')) refused.add(key)
      })
      .finally(() => writing.delete(key))
    writing.set(key, done)
  }

  async function settled() {
    while (writing.size > 0) await Promise.all(writing.values())
  }

  const offShown = shown.onChange(() => {
    if (shown.now()) void poll()
    else {
      next?.()
      next = null
    }
  })
  signal.addEventListener('abort', () => {
    offShown()
    next?.()
    next = null
  })
  void poll()

  return {
    startBrief,
    poll,
    waiting,
    settled,
  }
}

/** The asset of the picture the frame's call made, once it is made; null before. */
function madePicture(read: DesignAi, frame: AiFrameView): string | null {
  const call = read.jobs.find((j) => j.id === frame.jobId)?.calls.find((c) => c.index === frame.callIndex)
  if (call?.state !== 'done' || call.output.kind !== 'pictures') return null
  return call.output.pictures[0]?.assetId ?? null
}
