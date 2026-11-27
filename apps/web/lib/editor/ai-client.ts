// The AI flow's routes as the editor calls them from the browser: the design's AI frames, a frame's refines, starting
// a job, marking a call written into the design, a layering finish's lease, end, split layers and parts, the estimate an AI action shows on hover, and the person's own jobs on the brand.
// A job the API refuses comes back as its answer, never thrown.
import { z } from 'zod'

import type { AiStart, EditorAi } from '@dazbee/editor'
import {
  AiEstimate,
  type AiEstimateQuery,
  type AiFrameWritten,
  AiJobRefused,
  AiJobStarted,
  AiRefineView,
  AssetSummary,
  DesignAi,
  MyAiJob,
  type StartAiJob,
} from '@dazbee/schema'

import { brandPath, readJson } from '@/lib/brand-routes.ts'

/**
 * The editor's AI flow on design `designId` of a brand, through the app's routes; Make editable names a layer the
 * layer plan names nothing in `layerWord` and its number.
 */
export function editorAi(workspaceId: string, brandId: string, designId: string, layerWord: string): EditorAi {
  const design = brandPath(workspaceId, brandId, 'designs', designId, 'ai')
  const job = (jobId: string) => brandPath(workspaceId, brandId, 'ai', 'jobs', jobId)
  return {
    layerWord,
    read: async () => DesignAi.parse(await readJson(await fetch(design, { cache: 'no-store' }))),
    start: (job: StartAiJob) => startAiJob(workspaceId, brandId, job),
    written: async (frameId: string, written: AiFrameWritten) => {
      await readJson(await fetch(`${design}/frames/${encodeURIComponent(frameId)}/written`, post(written)))
    },
    claim: async (jobId: string, holder: string) =>
      z.object({ held: z.boolean() }).parse(await readJson(await fetch(`${job(jobId)}/claim`, post({ holder })))).held,
    finished: async (jobId: string, holder: string) => {
      await readJson(await fetch(`${job(jobId)}/finished`, post({ holder })))
    },
    file: async (jobId: string, index: number) => {
      const response = await fetch(`${job(jobId)}/files/${index}`)
      if (!response.ok) await readJson(response)
      return new Uint8Array(await response.arrayBuffer())
    },
    part: async (png: Uint8Array) => {
      const response = await fetch(brandPath(workspaceId, brandId, 'ai', 'parts'), {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: png.slice(),
      })
      return AssetSummary.parse(await readJson(response)).id
    },
  }
}

/** The refines of AI frame `frameId` of design `designId`, oldest first. */
export async function aiRefines(
  workspaceId: string,
  brandId: string,
  designId: string,
  frameId: string,
): Promise<AiRefineView[]> {
  const path = brandPath(workspaceId, brandId, 'designs', designId, 'ai', 'frames', frameId, 'refines')
  return AiRefineView.array().parse(await readJson(await fetch(path, { cache: 'no-store' })))
}

/** Starts `job` on the brand; how it came out, a refusal as the answer. */
export async function startAiJob(workspaceId: string, brandId: string, job: StartAiJob): Promise<AiStart> {
  const response = await fetch(brandPath(workspaceId, brandId, 'ai', 'jobs'), post(job))
  return startAnswer(response.status, await response.json().catch(() => null))
}

/** How much of the workspace's AI the action `query` names takes, and about how long. */
export async function aiEstimate(
  workspaceId: string,
  brandId: string,
  query: Pick<AiEstimateQuery, 'action'> & Partial<Pick<AiEstimateQuery, 'mode' | 'reference' | 'sizes'>>,
): Promise<AiEstimate> {
  const asked = new URLSearchParams(
    Object.entries(query).map(([name, value]) => [
      name,
      name === 'sizes'
        ? (value as AiEstimateQuery['sizes']).map((s) => `${s.width}x${s.height}`).join(',')
        : String(value),
    ]),
  )
  const response = await fetch(`${brandPath(workspaceId, brandId, 'ai', 'estimate')}?${asked.toString()}`, {
    cache: 'no-store',
  })
  return AiEstimate.parse(await readJson(response))
}

/** The person's own AI jobs on the brand, running or just ended, newest first. */
export async function myAiJobs(workspaceId: string, brandId: string): Promise<MyAiJob[]> {
  const response = await fetch(brandPath(workspaceId, brandId, 'ai', 'my-jobs'), { cache: 'no-store' })
  return MyAiJob.array().parse(await readJson(response))
}

/** A POST of `body` as JSON. */
function post(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/**
 * How a job came out from the route's answer: its status and body read as JSON (null when it isn't). A server's
 * failure with no refusal may have come after the job was saved, so its outcome is unknown.
 */
export function startAnswer(status: number, body: unknown): AiStart {
  const started = AiJobStarted.safeParse(body)
  if (status === 201 && started.success) return { ok: true, job: started.data.job }
  const refused = AiJobRefused.partial({ refusal: true }).safeParse(body)
  const refusal = refused.data?.refusal ?? null
  return {
    ok: false,
    refusal,
    message: refused.data?.error ?? String(status),
    ...(refusal === null && status >= 500 ? { unknown: true as const } : {}),
  }
}
