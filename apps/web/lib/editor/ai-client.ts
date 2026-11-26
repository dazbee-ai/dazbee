// The AI flow's routes as the editor calls them from the browser: the design's AI frames, starting a job, and
// marking a call written into the design. A job the API refuses comes back as its answer, never thrown.
import type { AiStart, EditorAi } from '@dazbee/editor'
import { type AiFrameWritten, AiJobRefused, AiJobStarted, DesignAi, type StartAiJob } from '@dazbee/schema'

import { brandPath, readJson } from '@/lib/brand-routes.ts'

/** The editor's AI flow on design `designId` of a brand, through the app's routes. */
export function editorAi(workspaceId: string, brandId: string, designId: string): EditorAi {
  const design = brandPath(workspaceId, brandId, 'designs', designId, 'ai')
  const post = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return {
    read: async () => DesignAi.parse(await readJson(await fetch(design, { cache: 'no-store' }))),
    start: async (job: StartAiJob) => {
      const response = await fetch(brandPath(workspaceId, brandId, 'ai', 'jobs'), post(job))
      return startAnswer(response.status, await response.json().catch(() => null))
    },
    written: async (frameId: string, written: AiFrameWritten) => {
      await readJson(await fetch(`${design}/frames/${encodeURIComponent(frameId)}/written`, post(written)))
    },
  }
}

/** How a job came out from the route's answer: its status and body read as JSON (null when it isn't). */
export function startAnswer(status: number, body: unknown): AiStart {
  const started = AiJobStarted.safeParse(body)
  if (status === 201 && started.success) return { ok: true, job: started.data.job }
  const refused = AiJobRefused.partial({ refusal: true }).safeParse(body)
  return {
    ok: false,
    refusal: refused.data?.refusal ?? null,
    message: refused.data?.error ?? String(status),
  }
}
