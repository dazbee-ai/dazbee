// A frame as an agent looks at it: one PNG, drawn on the CPU surface (ADR-0005) at the scale that
// fits its longer side to a size and its file to a byte limit.
import type { CanvasKit } from '@dazbee/canvaskit'
import { renderEncoded, type ResourceBytes, type ResourceCache, resourceCache } from '@dazbee/renderer'
import type { Design } from '@dazbee/schema'

/** A frame drawn for an agent: the PNG, its size in pixels, and the scale it was drawn at. */
export interface AgentRender {
  png: Uint8Array
  width: number
  height: number
  scale: number
}

/** How an agent's render is fitted. */
export interface AgentRenderOptions {
  /** The most pixels the longer side may take; 1600 by default, from 16 to 8192. */
  maxSize?: number
  /** The most bytes the PNG may take; AGENT_RENDER_MAX_BYTES by default. */
  maxBytes?: number
  cache?: ResourceCache
}

/** The longer side of an agent's render, in pixels, unless asked otherwise. */
export const AGENT_RENDER_MAX_SIZE = 1600
/** The most an agent's render is scaled up: a small frame is drawn at twice its size, not more. */
export const AGENT_RENDER_MAX_SCALE = 2
/** The most bytes an agent's render takes unless asked otherwise: 5,000,000 once written as base64. */
export const AGENT_RENDER_MAX_BYTES = 3_750_000

/** The sizes an agent may ask for, as FigCraft's screenshot clamps them. */
const SIZE_RANGE = [16, 8192] as const
/** The share of the scale a PNG's bytes suggest that the next try takes, so each try is smaller. */
const SHRINK_MARGIN = 0.9

/**
 * Frame `frameId` as a PNG for an agent to look at: scaled so its longer side is at most
 * `maxSize` pixels, and never past AGENT_RENDER_MAX_SCALE, then drawn smaller until the PNG takes
 * at most `maxBytes`. A PNG's bytes grow about as its pixels do, so each try scales by the square
 * root of the share it may keep, a little less, and none below a longer side of 16 pixels. Throws
 * when the PNG is over the limit at that smallest scale.
 */
export function agentRender(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  { maxSize = AGENT_RENDER_MAX_SIZE, maxBytes = AGENT_RENDER_MAX_BYTES, cache }: AgentRenderOptions = {},
): AgentRender {
  const frame = Object.hasOwn(design.frames, frameId) ? design.frames[frameId] : undefined
  if (!frame) throw new Error(`no frame "${frameId}"`)
  const [least, most] = SIZE_RANGE
  if (!(maxSize >= least && maxSize <= most)) throw new RangeError(`maxSize must be from ${least} to ${most}`)
  if (!(maxBytes > 0)) throw new RangeError('maxBytes must be a number of bytes above 0')
  const longer = Math.max(frame.width, frame.height)
  let scale = Math.min(AGENT_RENDER_MAX_SCALE, maxSize / longer)
  // The surface's sides are rounded up, so a scale a hair over the fit would add a pixel.
  if (Math.ceil(longer * scale) > maxSize) scale = (maxSize - 0.5) / longer
  // One cache for every try, so the fonts and images are decoded once.
  const owned = cache ?? resourceCache(ck)
  try {
    const draw = () => renderEncoded(ck, design, frameId, bytes, { format: 'png', scale }, owned)
    let png = draw()
    while (png.length > maxBytes) {
      const smallest = least / longer
      if (scale <= smallest) throw new Error(`no render of frame "${frameId}" fits in ${maxBytes} bytes`)
      scale = Math.max(smallest, scale * Math.sqrt(maxBytes / png.length) * SHRINK_MARGIN)
      png = draw()
    }
    return { png, width: Math.ceil(frame.width * scale), height: Math.ceil(frame.height * scale), scale }
  } finally {
    if (!cache) owned.delete()
  }
}
