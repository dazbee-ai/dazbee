// The person's own AI jobs in every workspace they are in, running or just ended, at /me/ai-jobs, which the note
// that names a design once its job ends reads on any page.
import { myAiJobs } from '@/lib/server/ai-flow.ts'
import { ApiFailure } from '@/lib/server/api.ts'

export async function GET() {
  try {
    return Response.json(await myAiJobs(), { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 401) return Response.json({ error: e.message }, { status: 401 })
    throw e
  }
}
