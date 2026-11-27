// What Other sizes and Make all editable read of a design's AI frames: the sizes the AI is offered from a list of
// picked tiles, and a section of AI sizes as one Make all editable takes it: its frames still a picture, and the
// picture of the draft they came from, which the one layer plan is made from.
import { type DesignAi, isAiSize, pictureLayerOf } from '@dazbee/schema'

/** A design as these read it: its frames, layers and connectors. */
interface Placed {
  frames: Readonly<Record<string, { sectionId?: string | undefined; width: number; height: number }>>
  nodes: Readonly<Record<string, { parentId: string; props: { visible?: boolean; fills?: unknown } }>>
  connectors: Readonly<Record<string, { from: string; to: string }>>
}

/** A section of AI sizes to make editable together: its frames, and the draft's picture the plan is made from. */
export interface SizesToLayer {
  frameIds: string[]
  planAssetId: string
}

/** The picked sizes the AI may redraw: from 1:3 to 3:1. */
export function aiSizes<S extends { width: number; height: number }>(picked: readonly S[]): S[] {
  return picked.filter(isAiSize)
}

/**
 * Section `sectionId` as Make all editable takes it: its AI frames of the size kind that show their picture, at
 * least two, and the picture the draft it is joined from by a connector shows; null for any other section.
 */
export function sizesToLayer(ai: DesignAi | null, design: Placed, sectionId: string): SizesToLayer | null {
  const frameIds = (ai?.frames ?? [])
    .filter((f) => f.kind === 'size' && f.state === 'arrived' && design.frames[f.frameId]?.sectionId === sectionId)
    .map((f) => f.frameId)
  const draft = Object.values(design.connectors).find((c) => c.to === sectionId)?.from
  const planAssetId = draft === undefined ? null : shownOf(design, pictureLayerOf(draft))
  return frameIds.length >= 2 && planAssetId ? { frameIds, planAssetId } : null
}

/** The picture layer `layerId` shows; null for none. */
function shownOf(design: Placed, layerId: string): string | null {
  const fills = (design.nodes[layerId]?.props.fills ?? []) as { type: string; assetId?: string }[]
  return fills.find((fill) => fill.type === 'image')?.assetId ?? null
}
