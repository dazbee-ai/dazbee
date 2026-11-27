// AI results arriving in the design (ADR-0004): a brief, or more like a draft, the tab starts, placed once its job
// is saved, each picture made, written into its frame's picture layer, and each refine's new version, written into
// the picture layer it changes. Each is an arrival: commands run untracked, one change set
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
  type AiRefineLink,
  type AiSize,
  type DesignAi,
  jobRunning,
  type Layer,
  madeCallPicture,
  type PageBox,
  pictureLayerOf,
  planRound,
  REFINE_CALL,
  type RoundPlan,
  type StartAiJob,
} from '@dazbee/schema'

import { briefSpot, moreLikeSpot, pictureState, placeBrief, shownPicture } from './place-brief.ts'

/**
 * How a job a tab starts came out: saved, or refused with why, the refusal named when saving it was refused; or,
 * with `unknown`, an answer lost on its way, so the job may have been saved.
 */
export type AiStart =
  { ok: true; job: string } | { ok: false; refusal: AiJobRefusal | null; message: string; unknown?: true }

/** What the editor asks of the API for the AI flow, through the app's routes. */
export interface EditorAi {
  /** What Make editable names a layer the layer plan names nothing in, before its number, in the page's words. */
  layerWord: string
  /** The design's AI frames, with their jobs and briefs. */
  read(): Promise<DesignAi>
  /** Starts a job on the design; a refusal comes back as the answer, never thrown. */
  start(job: StartAiJob): Promise<AiStart>
  /** Marks a call written into the design's frame `frameId`. */
  written(frameId: string, written: AiFrameWritten): Promise<void>
  /** Claims, or renews, layering job `jobId`'s finish for `holder`; whether `holder` holds it now. */
  claim(jobId: string, holder: string): Promise<boolean>
  /** Ends layering job `jobId`'s finish held by `holder`: its frames become editable. */
  finished(jobId: string, holder: string): Promise<void>
  /** Split layer `index` of layering job `jobId`, as PNG bytes. */
  file(jobId: string, index: number): Promise<Uint8Array>
  /** Uploads a PNG as a hidden part of the brand, as a piece of a layered picture; its asset's id. */
  part(png: Uint8Array): Promise<string>
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

/** A refine a tab starts: the AI frame, the picture layer it changes, what to change and the marks, if any. */
export interface RefineRequest {
  frameId: string
  pictureLayerId: string
  message: string
  marksAssetId?: string
}

/** More like a draft: the AI frame liked, the new section's title and each new draft's name. */
export interface MoreLikeRequest {
  frameId: string
  title: string
  /** Each draft's name, by its place from 0. */
  draftName: (n: number) => string
}

/**
 * A brief started: its job and its section, placed below everything on its page; or why it was refused; or, with
 * `notPlaced`, a job saved whose section and frames the design didn't take, its drafts kept as the brand's images.
 */
export type BriefStarted =
  { ok: true; job: string; sectionId: string } | (Extract<AiStart, { ok: false }> & { notPlaced?: true })

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
  /**
   * Whether the tab is connected to the sync server now: a picture is written only then, so no arrival waits in
   * the tab's queue, to land later over what a person chose meanwhile.
   */
  connected: () => boolean
  /** The zoom an area of the page is seen at: the lower of the zoom now and the zoom it fits at. */
  zoomFor: (area: PageBox) => number
  /**
   * Gets pictures ready to draw in the editor, their bytes here and decoded; settles once they are, or can't be. A
   * picture is written once it is ready, so its layer keeps its waiting fill until the picture can be drawn.
   */
  readyPictures: (assetIds: readonly string[]) => Promise<void>
  /**
   * Whether everything of the tab's is stored on the sync server: a picture the tab's design shows is marked
   * written only then, so a call is never marked for a picture still in the tab's queue.
   */
  synced: () => boolean
  /** Aborted when the editor ends: no read, write or mark starts after it. */
  signal: AbortSignal
}

export interface EditorArrivals {
  /**
   * Starts a round from a brief: makes its ids, starts the job with them, and only once it is saved places the
   * section and its frames below everything on the page, as one arrival; settles once the server has stored it.
   * A refused job places nothing.
   */
  startBrief(request: BriefRequest): Promise<BriefStarted>
  /**
   * Starts more like an AI frame of a brief: a round of its brief whose planner sees the picture the frame's picture
   * layer shows, placed once it is saved in a new section right of the frame's section, joined to the frame by a
   * connector, as one arrival. A frame of no brief, or showing no picture, starts nothing.
   */
  moreLikeThis(request: MoreLikeRequest): Promise<BriefStarted>
  /**
   * Refines the picture a picture layer of an AI frame shows, with the person's message and the marks picture, if
   * any; its new version arrives in that layer. Then reads the design's AI frames. A layer that shows no picture
   * starts nothing.
   */
  refine(request: RefineRequest): Promise<AiStart>
  /**
   * Makes an AI frame editable: starts a layering job for the picture its picture layer shows; its layers arrive once
   * a tab finishes it. Then reads the design's AI frames. A frame showing no picture starts nothing.
   */
  makeEditable(frameId: string): Promise<AiStart>
  /** Tries a failed AI frame again, its picture made again into the same frame; settles once the design's AI frames are read again. */
  tryAgain(frameId: string): Promise<AiStart>
  /** The design's AI frames, jobs and briefs as last read, with the frames marked written since; null before the first read. */
  read(): DesignAi | null
  /** Calls back after each read, and each time a frame is marked written. */
  onRead(listener: () => void): () => void
  /** Reads the design's AI frames now and writes the pictures that arrived; the next read is 3 s or 10 s after. */
  poll(): Promise<void>
  /** The AI frames of the design that wait for their picture, as last read, among those the design has with their picture layer. */
  waiting(): string[]
  /** The AI frames made editable, as last read, whose picture layer the design has hidden. */
  editable(): Set<string>
  /** Settles once every arrival of a picture started so far is stored and marked written, or given up. */
  settled(): Promise<void>
  /**
   * Runs `steps` as one arrival, no undo of any tab taking it back; resolves whether the server stored it ('saved'),
   * or that nothing ran ('none').
   */
  land(steps: () => void): Promise<'saved' | 'none'>
}

/** How long a shown tab waits between reads of the design's AI frames. */
export const POLL_MS = 10_000
/** How long it waits while a frame of the design waits for its picture. */
export const POLL_WAITING_MS = 3_000

export function editorArrivals({
  session,
  ai,
  designId,
  newId,
  after,
  shown,
  connected,
  synced,
  zoomFor,
  readyPictures,
  signal,
}: ArrivalsDeps): EditorArrivals {
  /** The design's AI frames, jobs and briefs as last read; null before the first read. */
  let read: DesignAi | null = null
  /** The read on its way, while one is. */
  let reading: Promise<void> | null = null
  /** Cancels the next read, while one waits. */
  let next: (() => void) | null = null
  /** The arrivals of pictures on their way, by `callKey`: none of them starts again meanwhile. */
  const writing = new Map<string, Promise<void>>()
  /** The calls whose arrival is stored but not yet marked written: they are marked again, never written again. */
  const stored = new Set<string>()
  /** The calls whose arrival the server refused: this tab writes them no more. */
  const refused = new Set<string>()
  /** What hears each read. */
  const readers = new Set<() => void>()

  /**
   * The AI frames the design has that wait for a picture, as last read: a draft's, or its layers while it is made
   * editable, with its picture layer; or a refine's new version, with the layer it changes.
   */
  function waiting(): string[] {
    const { nodes } = session.design()
    const drafts = (read?.frames ?? []).filter(
      (f) =>
        (f.state === 'waiting' || f.state === 'layering') && nodes[pictureLayerOf(f.frameId)]?.parentId === f.frameId,
    )
    const refines = (read?.refines ?? []).filter(
      (r) => r.resultAssetId === null && jobRunning(jobOf(r.jobId)) && nodes[r.pictureLayerId]?.parentId === r.frameId,
    )
    return [...new Set([...drafts, ...refines].map((f) => f.frameId))]
  }

  function editable(): Set<string> {
    const { nodes } = session.design()
    return new Set(
      (read?.frames ?? [])
        .filter((f) => f.state === 'editable' && nodes[pictureLayerOf(f.frameId)]?.props.visible === false)
        .map((f) => f.frameId),
    )
  }

  /** Job `id` as last read. */
  function jobOf(id: string) {
    return read?.jobs.find((j) => j.id === id)
  }

  async function settled() {
    while (writing.size > 0) await Promise.all(writing.values())
  }

  /** The picture layer `layerId` of frame `frameId` in the design now; undefined when the design hasn't it there. */
  function layerIn(layerId: string, frameId: string) {
    const layer = session.design().nodes[layerId]
    return layer?.parentId === frameId ? layer : undefined
  }

  async function startBrief(request: BriefRequest): Promise<BriefStarted> {
    const plan = planRound(newId)
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
    if (!started.ok) return started
    return placed(started.job, plan, () => {
      const at = briefSpot(session.design().frames, request.pageId, request.size, zoomFor)
      placeBrief(session, { plan, ...request }, at)
    })
  }

  async function moreLikeThis(request: MoreLikeRequest): Promise<BriefStarted> {
    const design = session.design()
    const frame = design.frames[request.frameId]
    const aiFrame = read?.frames.find((f) => f.frameId === request.frameId)
    const brief = read?.briefs.find((b) => b.id === aiFrame?.briefId)
    const layer = layerIn(pictureLayerOf(request.frameId), request.frameId)
    const liked = layer && shownPicture(layer)
    if (!frame || !brief || !liked) return { ok: false, refusal: null, message: 'that frame shows no draft of a brief' }
    const plan = planRound(newId)
    const size = { width: frame.width, height: frame.height }
    const started = await ai.start({
      kind: 'more-like-this',
      designId,
      sectionId: plan.sectionId,
      frames: plan.frames,
      words: brief.words,
      pictures: brief.pictureAssetIds,
      size,
      mode: brief.mode,
      likedAssetId: liked,
    })
    if (!started.ok) return started
    return placed(started.job, plan, () => {
      const now = session.design()
      const at = moreLikeSpot(now, request.frameId, size, zoomFor)
      const pageId = now.frames[request.frameId]?.pageId
      // The liked draft deleted meanwhile: the drafts aren't placed, and stay in the brand's images.
      if (!at || !pageId) throw new Error('the liked draft is gone')
      placeBrief(session, { plan, pageId, words: brief.words, size, ...request, from: request.frameId }, at)
    })
  }

  async function refine(request: RefineRequest): Promise<AiStart> {
    const frame = session.design().frames[request.frameId]
    const layer = layerIn(request.pictureLayerId, request.frameId)
    const picture = layer && shownPicture(layer)
    if (!frame || !picture) return { ok: false, refusal: null, message: 'that layer shows no picture' }
    const started = await ai.start({
      kind: 'refine',
      designId,
      frameId: request.frameId,
      pictureLayerId: request.pictureLayerId,
      pictureAssetId: picture,
      message: request.message,
      ...(request.marksAssetId ? { marksAssetId: request.marksAssetId } : {}),
      size: refineSize(frame, layer, request.pictureLayerId === pictureLayerOf(request.frameId)),
    })
    if (started.ok) await poll()
    return started
  }

  async function makeEditable(frameId: string): Promise<AiStart> {
    const layer = layerIn(pictureLayerOf(frameId), frameId)
    const picture = layer && shownPicture(layer)
    if (!picture) return { ok: false, refusal: null, message: 'that frame shows no picture' }
    const started = await ai.start({ kind: 'layering', designId, frames: [{ frameId, pictureAssetId: picture }] })
    if (started.ok) await poll()
    return started
  }

  async function tryAgain(frameId: string): Promise<AiStart> {
    const started = await ai.start({ kind: 'try-again', designId, frameId })
    if (started.ok) await poll()
    return started
  }

  /**
   * Places a started job's section and frames with `steps`, as one arrival, then reads the design's AI frames; how
   * the start came out. Not placed, as on a page deleted meanwhile or a design at its limits, its drafts stay in the
   * brand's images.
   */
  async function placed(job: string, plan: RoundPlan, steps: () => void): Promise<BriefStarted> {
    let outcome: 'saved' | 'none' = 'none'
    try {
      outcome = await arrive(session, signal, steps)
    } catch {
      // Refused, or not stored: told as not placed.
    }
    void poll()
    if (outcome !== 'saved')
      return { ok: false, refusal: null, message: 'the design did not take the drafts', notPlaced: true }
    return { ok: true, job, sectionId: plan.sectionId }
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
        for (const frame of now.frames) writePicture(now, frame)
        for (const change of now.refines) writeVersion(now, change)
        told()
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
   * layer still waits, then marks the call written. One the person filled meanwhile is marked and keeps what they
   * put there.
   */
  function writePicture(now: DesignAi, frame: AiFrameView) {
    if (frame.state !== 'waiting') return
    const asset = madeCallPicture(now.jobs, frame.jobId, frame.callIndex)
    if (!asset) return
    writeCall({
      frameId: frame.frameId,
      layerId: pictureLayerOf(frame.frameId),
      call: { jobId: frame.jobId, callIndex: frame.callIndex },
      asset,
      replaces: (holds) => holds === 'waits',
      marked: (was) => ({
        ...was,
        frames: was.frames.map((f) => (f === frame ? { ...f, state: 'arrived', assetId: asset } : f)),
      }),
    })
  }

  /**
   * Writes a refine's new version into the picture layer it changes, once its edit has made it and until it is marked
   * written, whatever the layer shows meanwhile, since the person asked for the change; then marks it written.
   */
  function writeVersion(now: DesignAi, change: AiRefineLink) {
    if (change.resultAssetId !== null) return
    const asset = madeCallPicture(now.jobs, change.jobId, REFINE_CALL.edit)
    if (!asset) return
    writeCall({
      frameId: change.frameId,
      layerId: change.pictureLayerId,
      call: { jobId: change.jobId, callIndex: REFINE_CALL.edit },
      asset,
      replaces: (holds) => holds !== 'shows',
      marked: (was) => ({
        ...was,
        refines: was.refines.map((r) => (r === change ? { ...r, resultAssetId: asset } : r)),
      }),
    })
  }

  /**
   * Writes picture `asset` of call `call` into layer `layerId` of frame `frameId` as an arrival, once it is ready to
   * draw, when what the layer holds is one it `replaces` and the tab is connected; then marks the call written and
   * keeps what `marked` makes of the last read. A layer that shows the picture already, once the tab's queue is
   * stored, or whose arrival this tab stored before, is only marked. A frame or layer the design hasn't, such as one
   * deleted, is left for an undo that brings it back.
   */
  function writeCall({
    frameId,
    layerId,
    call,
    asset,
    replaces,
    marked,
  }: {
    frameId: string
    layerId: string
    call: AiFrameWritten
    asset: string
    replaces: (holds: ReturnType<typeof pictureState>) => boolean
    marked: (was: DesignAi) => DesignAi
  }) {
    const key = `${frameId}/${call.jobId}/${call.callIndex}`
    if (writing.has(key) || refused.has(key) || !layerIn(layerId, frameId)) return
    const done = readyPictures([asset])
      .then(() => {
        // Read again once the picture is ready: the layer may have changed meanwhile.
        const layer = layerIn(layerId, frameId)
        if (!layer || signal.aborted) return 'none' as const
        const holds = pictureState(layer, asset)
        const writes = !stored.has(key) && replaces(holds)
        // Offline, the picture waits for the next read; one the design shows waits until the tab's queue is stored.
        if (writes ? !connected() : holds === 'shows' && !synced()) return 'none' as const
        if (!writes) return 'saved' as const
        return arrive(session, signal, () =>
          session.run('node.update', {
            ids: [layerId],
            patch: { fills: [{ type: 'image', assetId: asset, fit: 'fill' }] },
          }),
        )
      })
      .then(async (outcome) => {
        if (outcome !== 'saved' || signal.aborted) return
        stored.add(key)
        await ai.written(frameId, call)
        stored.delete(key)
        if (read) {
          read = marked(read)
          told()
        }
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

  function told() {
    for (const listener of [...readers]) listener()
  }

  function onRead(listener: () => void) {
    readers.add(listener)
    return () => readers.delete(listener)
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
    moreLikeThis,
    refine,
    makeEditable,
    tryAgain,
    read: () => read,
    onRead,
    poll,
    waiting,
    editable,
    settled,
    land: (steps) => arrive(session, signal, steps),
  }
}

/**
 * Runs `steps` as one arrival: their commands as one gesture, untracked, so no undo of any tab takes them back.
 * After a gesture of the tab's own still open, it runs once that ends, as `untracked` does. Resolves 'saved' once
 * the sync server has stored it, at once when it changed nothing; 'none' when it ran nothing, in a tab that may
 * only view the design, or once `signal` aborts first. Fails with what `steps` threw, its commands' writes put
 * back, and with `NotSaved` when the server didn't store it.
 */
function arrive(session: Session, signal: AbortSignal, steps: () => void): Promise<'saved' | 'none'> {
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

/**
 * The size a refine's picture is made at: the frame's, for its picture layer; else the layer's own, as on an editable
 * frame, in whole pixels.
 */
function refineSize(
  frame: { width: number; height: number },
  layer: Pick<Layer, 'props'>,
  whole: boolean,
): { width: number; height: number } {
  if (whole || !('width' in layer.props)) return { width: frame.width, height: frame.height }
  return { width: Math.max(1, Math.round(layer.props.width)), height: Math.max(1, Math.round(layer.props.height)) }
}
