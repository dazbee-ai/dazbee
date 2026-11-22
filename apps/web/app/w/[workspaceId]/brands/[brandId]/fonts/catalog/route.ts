// The brand's font catalog in its two parts, for the font chooser: the address of the Google list, which the browser
// keeps, and the brand's own uploads, asked for again after each upload.
import { ApiFailure, fontCatalog } from '@/lib/server/api.ts'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string }> },
) {
  const { workspaceId, brandId } = await params
  try {
    return Response.json(await fontCatalog(workspaceId, brandId), { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return new Response('No such brand', { status: 404 })
    throw e
  }
}
