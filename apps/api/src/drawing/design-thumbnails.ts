// The picture of a design the home's bento shows (#84): its cover frame, drawn on a small CPU
// surface like an export (ADR-0005), on a thread of its own, with the fonts and images we store. Like an asset's thumbnail (ADR-0010) it is an image we make and store, once
// per version of the design: the key carries the design's updatedAt, so an edit makes a new one.
import { Worker } from 'node:worker_threads'

import type { Db } from '@dazbee/db'
import type { ResourceBytes } from '@dazbee/renderer'
import { coverFrame, type Design, type DesignCover, type DesignSummary } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { designThumbnailKey } from '../storage-keys.ts'
import { storedDesign } from '../workspace/designs.ts'
import type { DrawJob, DrawResult } from './draw-worker.ts'
import { brandResourcesFor, inDrawingTurn } from './render.ts'

/** Where a design's stored picture is, and the size of the frame it shows. */
export type ThumbnailCover = DesignCover & { key: string }

/** The longest side of a design's picture: the bento's big tile on a 2× screen. */
const DESIGN_THUMBNAIL_SIZE = 640

/**
 * How much memory CanvasKit may take on the drawing thread before the thread is started afresh:
 * Skia keeps the file of each face it drew with while its glyphs are cached, after the fonts are
 * freed, so a thread that drew several CJK faces of 50 MB would hold them all. CanvasKit starts at 128 MiB.
 */
const DRAWING_MEMORY_LIMIT = 192 * 1024 * 1024

/**
 * The font bytes past which a picture's thread is started afresh once it is drawn, for the same
 * reason: a CJK face's file, which Skia would keep while the next picture registers its own.
 */
const BIG_FONT_BYTES = 16 * 1024 * 1024

// The drawing thread, started on the first picture and started again if it dies.
let worker: Worker | undefined
let nextJob = 0
const waiting = new Map<
  number,
  { thread: Worker; fontBytes: number; resolve: (png: Uint8Array) => void; reject: (error: Error) => void }
>()

// A picture being made, by its key, so two requests for the same one draw it once.
const making = new Map<string, Promise<void>>()

/** The frame a design's picture shows, its cover frame (see `coverFrame`), with its size; null with no frame. */
export function coverOf(design: Design): { frameId: string; width: number; height: number } | null {
  const cover = coverFrame(design)
  if (!cover) return null
  const [frameId, frame] = cover
  return { frameId, width: frame.width, height: frame.height }
}

/** The cover frame's size, read from the stored design without drawing: what a tile needs to take its shape. */
export async function designCover(db: Db, summary: DesignSummary): Promise<DesignCover | null> {
  const design = await storedDesign(db, summary.id)
  const cover = design && coverOf(design)
  return cover ? { width: cover.width, height: cover.height } : null
}

/**
 * The stored picture of the design as it is now, made first if this version has none, and the
 * cover frame's size. It is drawn on its own thread (see draw-worker.ts), straight at its small
 * size, in its drawing turn (`inDrawingTurn`). Null when the design has nothing to show.
 */
export async function ensureDesignThumbnail(
  db: Db,
  storage: Storage,
  workspaceId: string,
  summary: DesignSummary,
): Promise<ThumbnailCover | null> {
  const design = await storedDesign(db, summary.id)
  const cover = design && coverOf(design)
  if (!design || !cover) return null
  const key = designThumbnailKey(workspaceId, summary)
  const shape = { key, width: cover.width, height: cover.height }
  if (await storage.exists(key)) return shape
  let made = making.get(key)
  if (!made) {
    made = inDrawingTurn(async () => {
      const resources = await brandResourcesFor(db, storage, workspaceId, summary.brandId, design)
      const png = await drawCover(design, cover, DESIGN_THUMBNAIL_SIZE, resources)
      await storage.put(key, png, 'image/png')
    }).finally(() => making.delete(key))
    making.set(key, made)
  }
  await made
  return shape
}

/**
 * A design's cover frame drawn as PNG on the drawing thread, at most `longest` pixels on its long
 * side (never larger than the frame), with `resources`, whose font and image bytes move to the
 * thread: the caller can't read them after.
 */
export function drawCover(
  design: Design,
  cover: { frameId: string; width: number; height: number },
  longest: number,
  resources: ResourceBytes,
): Promise<Uint8Array> {
  const scale = Math.min(1, longest / Math.max(cover.width, cover.height))
  const size = {
    width: Math.max(1, Math.round(cover.width * scale)),
    height: Math.max(1, Math.round(cover.height * scale)),
  }
  return drawOnThread({
    design,
    frameId: cover.frameId,
    frame: { width: cover.width, height: cover.height },
    size,
    resources,
  })
}

function drawOnThread(job: Omit<DrawJob, 'id'>): Promise<Uint8Array> {
  const thread = drawingThread()
  const id = nextJob++
  return new Promise<Uint8Array>((resolve, reject) => {
    const fontBytes = job.resources.fonts.reduce((sum, font) => sum + font.bytes.byteLength, 0)
    waiting.set(id, { thread, fontBytes, resolve, reject })
    thread.ref()
    // The font and image bytes move to the thread rather than being copied, as a CJK family's files run to 100 MB.
    const bytes = [...job.resources.fonts.map((font) => font.bytes), ...Object.values(job.resources.images)]
    const moved = [...new Set(bytes.map((one) => one.buffer))].filter((buffer) => buffer instanceof ArrayBuffer)
    thread.postMessage({ ...job, id } satisfies DrawJob, moved)
  }).finally(() => {
    if (waiting.size === 0) thread.unref()
  })
}

function drawingThread(): Worker {
  if (worker) return worker
  const thread = new Worker(new URL('./draw-worker.ts', import.meta.url))
  // An idle thread doesn't keep the process (or a test run) alive.
  thread.unref()
  /** Whether the thread was ended on purpose, past its memory: its exit fails nothing. */
  let retired = false
  thread.on('message', (result: DrawResult) => {
    const job = waiting.get(result.id)
    waiting.delete(result.id)
    if ('png' in result) job?.resolve(result.png)
    else job?.reject(new Error(result.error))
    // Past its memory, or after big fonts, the thread ends once it has nothing left to draw; the next
    // picture starts a new one.
    const big = result.memory > DRAWING_MEMORY_LIMIT || (job?.fontBytes ?? 0) > BIG_FONT_BYTES
    if (big && worker === thread) worker = undefined
    if (worker !== thread && ![...waiting.values()].some((one) => one.thread === thread)) {
      retired = true
      void thread.terminate()
    }
  })
  const fail = (error: Error) => {
    if (worker === thread) worker = undefined
    if (retired) return
    for (const [id, job] of waiting)
      if (job.thread === thread) {
        waiting.delete(id)
        job.reject(error)
      }
  }
  thread.on('error', fail)
  thread.on('exit', (code) => fail(new Error(`the design picture thread stopped (${code})`)))
  worker = thread
  return thread
}
