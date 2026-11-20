// Draws agent renders on a thread of its own, so a render never holds up other agents' calls: drawing on the CPU
// surface (ADR-0005) is synchronous, and a large frame takes long enough to stall every call queued behind it. The
// thread keeps CanvasKit, the fonts the app ships and one resource cache for its life, and draws one job at a time.
import { createHash } from 'node:crypto'
import { parentPort } from 'node:worker_threads'

import { type AgentRender, agentRender, AgentRenderTooBig } from '@dazbee/export'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { type ResourceBytes, type ResourceCache, resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Design } from '@dazbee/schema'

/** One render: a frame of the design, with the fonts and images it draws beyond those the app ships. */
export interface RenderJob {
  id: number
  /** The design as JSON: the agent tab's live view of it is not something a worker can be sent. */
  design: string
  frameId: string
  maxSize: number
  /** The design's font files the app doesn't ship. */
  fonts: ResourceBytes['fonts']
  /** The encoded images the frame draws, by asset id. */
  images: ResourceBytes['images']
  variables?: ResourceBytes['variables']
}

/** The worker's answer: the PNG and its size, that no PNG fits the byte limit, or why it failed. */
export type RenderAnswer = (AgentRender & { id: number }) | { id: number; tooBig: true } | { id: number; error: string }

/** The brand's font files and images the last job sent, by their SHA-256 (see `same`). */
let kept = new Map<string, Uint8Array>()
let cache: ResourceCache | undefined

parentPort?.on('message', (job: RenderJob) => {
  void answer(job).then((answered) => parentPort?.postMessage(answered))
})

/** The job drawn, or why it wasn't. */
async function answer(job: RenderJob): Promise<RenderAnswer> {
  try {
    const ck = await loadCanvasKit()
    cache ??= resourceCache(ck)
    const sent = new Map<string, Uint8Array>()
    const bytes: ResourceBytes = {
      fonts: [...loadFontFiles(), ...job.fonts.map(({ family, bytes }) => ({ family, bytes: same(bytes, sent) }))],
      fallbackFamilies: [...FALLBACK_FAMILIES],
      images: Object.fromEntries(Object.entries(job.images).map(([id, image]) => [id, same(image, sent)])),
      ...(job.variables ? { variables: job.variables } : {}),
    }
    kept = sent
    const design = JSON.parse(job.design) as Design
    const { png, width, height, scale } = agentRender(ck, design, job.frameId, bytes, {
      maxSize: job.maxSize,
      cache,
    })
    return { id: job.id, png, width, height, scale }
  } catch (error) {
    if (error instanceof AgentRenderTooBig) return { id: job.id, tooBig: true }
    return { id: job.id, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The array the last job sent with the same bytes, else `bytes`, noted in `sent`: each job's arrays are new, and the
 * cache tells bytes apart by their array, so this keeps what it decoded from one job to the next.
 */
function same(bytes: Uint8Array, sent: Map<string, Uint8Array>): Uint8Array {
  const hash = createHash('sha256').update(bytes).digest('base64')
  const array = kept.get(hash) ?? sent.get(hash) ?? bytes
  sent.set(hash, array)
  return array
}
