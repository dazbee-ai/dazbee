// A piece of a picture the AI flow makes on the way, at /w/[workspace]/brands/[brand]/ai/parts: a PNG sent as the
// body, stored as an asset of the brand tagged as a part, which the brand's images never show; its asset.
import { AI_PART_TAG, MAX_UPLOAD_BYTES } from '@dazbee/schema'

import { ApiFailure, updateAsset, uploadAsset } from '@/lib/server/api.ts'

/** The first bytes of every PNG. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string }> },
) {
  const { workspaceId, brandId } = await params
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length > MAX_UPLOAD_BYTES || !PNG.every((b, i) => bytes[i] === b))
    return Response.json({ error: 'Send a PNG of at most 30 MB' }, { status: 400 })
  try {
    const asset = await uploadAsset(workspaceId, brandId, bytes, 'image/png', 'Layer')
    return Response.json(await updateAsset(workspaceId, brandId, asset.id, { tags: [AI_PART_TAG] }), { status: 201 })
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 400 || e.status === 404))
      return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
