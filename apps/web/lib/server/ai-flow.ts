// The API's calls for the AI flow in a design, from the web app's server only: starting a job, reading the design's
// AI frames, and marking a call written into the design. The API refuses each to a Reviewer.
import 'server-only'

import { z } from 'zod'

import {
  type AiFrameWritten,
  type AiJobRefusal,
  AiJobRefused,
  AiJobStarted,
  DesignAi,
  type StartAiJob,
} from '@dazbee/schema'

import { ApiFailure, brandRoot, call } from './api.ts'

/** A job started; or refused, with the API's status, its words and, when saving it was refused, why. */
export type JobStart =
  { ok: true; started: AiJobStarted } | { ok: false; status: number; error: string; refusal: AiJobRefusal | null }

/**
 * Starts a flow job on a design of the brand. A refusal comes back as it is: to save it (403, 409, 503 with why),
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

/** The design's AI frames, with their jobs and briefs. */
export const designAi = (workspaceId: string, brandId: string, designId: string) =>
  call(DesignAi, designAiPath(workspaceId, brandId, designId))

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

/** The API's path of a design's AI frames. */
function designAiPath(workspaceId: string, brandId: string, designId: string) {
  return `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}/ai`
}
