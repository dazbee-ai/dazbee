// The API's calls for the AI flow, from the web app's server only: starting a job, reading a design's AI frames and
// a frame's refines, marking a call written into the design, a layering finish's lease, end and split layers, the estimate an AI action shows on hover, and the person's own jobs. The
// API refuses each but the last to a Reviewer.
import 'server-only'

import { z } from 'zod'

import {
  AiEstimate,
  AiFinishLease,
  type AiFrameWritten,
  type AiJobRefusal,
  AiJobRefused,
  AiJobStarted,
  AiRefineView,
  DesignAi,
  MyAiJob,
  type StartAiJob,
} from '@dazbee/schema'

import { ApiFailure, brandRoot, call, callBytes } from './api.ts'

/** A job started; or refused, with the API's status, its words and, when saving it was refused, why. */
export type JobStart =
  { ok: true; started: AiJobStarted } | { ok: false; status: number; error: string; refusal: AiJobRefusal | null }

/**
 * Starts a flow job on the brand: on a design of it, or, for an image, on none. A refusal comes back as it is: to save it (403, 409, 503 with why),
 * or of what it names (400, 404, 409).
 */
export async function startAiJob(workspaceId: string, brandId: string, job: StartAiJob): Promise<JobStart> {
  try {
    const started = await call(AiJobStarted, `${brandRoot(workspaceId, brandId)}/ai/jobs`, {
      method: 'POST',
      body: job,
    })
    return { ok: true, started }
  } catch (e) {
    if (!(e instanceof ApiFailure) || (e.status >= 500 && e.status !== 503)) throw e
    const refusal = AiJobRefused.safeParse(e.body).data?.refusal ?? null
    return { ok: false, status: e.status, error: e.message, refusal }
  }
}

/** Claims, or renews, layering job `jobId`'s finish for `holder`: its lease. */
export const claimFinish = (workspaceId: string, brandId: string, jobId: string, holder: string) =>
  call(AiFinishLease, `${jobPath(workspaceId, brandId, jobId)}/claim`, { method: 'POST', body: { holder } })

/** Ends layering job `jobId`'s finish held by `holder`. */
export const endFinish = (workspaceId: string, brandId: string, jobId: string, holder: string) =>
  call(z.null(), `${jobPath(workspaceId, brandId, jobId)}/finished`, { method: 'POST', body: { holder } })

/** Split layer `index` of layering job `jobId`, as PNG bytes. */
export const layeringFile = (workspaceId: string, brandId: string, jobId: string, index: number) =>
  callBytes(`${jobPath(workspaceId, brandId, jobId)}/files/${index}`)

/** The design's AI frames, with their jobs and briefs. */
export const designAi = (workspaceId: string, brandId: string, designId: string) =>
  call(DesignAi, designAiPath(workspaceId, brandId, designId))

/** The refines of the design's AI frame `frameId`, oldest first. */
export const frameRefines = (workspaceId: string, brandId: string, designId: string, frameId: string) =>
  call(
    AiRefineView.array(),
    `${designAiPath(workspaceId, brandId, designId)}/frames/${encodeURIComponent(frameId)}/refines`,
  )

/** Marks call `written` written into the design's frame `frameId`. */
export const markAiWritten = (
  workspaceId: string,
  brandId: string,
  designId: string,
  frameId: string,
  written: AiFrameWritten,
) =>
  call(z.null(), `${designAiPath(workspaceId, brandId, designId)}/frames/${encodeURIComponent(frameId)}/written`, {
    method: 'POST',
    body: written,
  })

/**
 * How much of the workspace's AI an action takes and about how long, for the estimate's `query` as the API reads
 * it: the action, with its mode, sizes and reference where it has them.
 */
export const aiEstimate = (workspaceId: string, brandId: string, query: URLSearchParams) =>
  call(AiEstimate, `${brandRoot(workspaceId, brandId)}/ai/estimate?${query.toString()}`)

/** The person's own running and just-ended AI jobs, in every workspace they are in. */
export const myAiJobs = () => call(MyAiJob.array(), '/me/ai/jobs')

/** The API's path of a flow job of the brand. */
function jobPath(workspaceId: string, brandId: string, jobId: string) {
  return `${brandRoot(workspaceId, brandId)}/ai/jobs/${encodeURIComponent(jobId)}`
}

/** The API's path of a design's AI frames. */
function designAiPath(workspaceId: string, brandId: string, designId: string) {
  return `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}/ai`
}
