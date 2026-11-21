// The brand's kit for the editor and the Brand kit page (#53), at /w/[workspace]/brands/[brand]/kit/data: read
// it, and save it whole. A kit the API gives that can't be read answers 502, a save made from a kit
// saved since is refused with 409, and one that names no kit it was made from, from a tab built
// before, is refused with 400.
import { SaveBrandKit } from '@dazbee/schema'

import { ApiFailure, getBrandKit, saveBrandKit } from '@/lib/server/api.ts'

const failure = (e: unknown) => {
  if (e instanceof ApiFailure && (e.status === 400 || e.status === 404 || e.status === 409))
    return Response.json({ error: e.message }, { status: e.status })
  throw e
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string }> },
) {
  const { workspaceId, brandId } = await params
  try {
    const kit = await getBrandKit(workspaceId, brandId)
    if (!kit) return Response.json({ error: 'The brand kit can’t be read' }, { status: 502 })
    return Response.json(kit, { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    return failure(e)
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params
  const kit = SaveBrandKit.safeParse(await request.json().catch(() => null))
  if (!kit.success) return Response.json({ error: kit.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  // Only a tab built before this app sends no kit it was made from; it would save over newer changes.
  if (kit.data.basedOn === undefined)
    return Response.json({ error: 'This tab is older than Dazbee. Reload it to save the brand kit.' }, { status: 400 })
  try {
    return Response.json(await saveBrandKit(workspaceId, brandId, kit.data))
  } catch (e) {
    return failure(e)
  }
}
