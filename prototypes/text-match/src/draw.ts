// PROTOTYPE. Draws one text layer with Dazbee's own renderer, exactly as an export draws it: a design
// of one frame holding the layer, parsed by the schema, laid out and drawn on the CPU surface.
import type { CanvasKit } from '@dazbee/canvaskit'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { drawScene, render, resourceCache, type ResourceBytes, textMeasure } from '@dazbee/renderer'
import { parseDesign, type TextProps } from '@dazbee/schema'

import { type CatalogueFace, fontBytes } from './catalogue.ts'

/** What the matcher sets on a text: the layer's look, before it is placed. */
export interface TextLook {
  family: string
  weight: number
  style: 'normal' | 'italic'
  /** Pixels. */
  size: number
  /** Percent of the size, Dazbee's unit. */
  spacing: number
  /** A multiple of the size; undefined is the font's own. */
  lineHeight?: number
  align: 'start' | 'center' | 'end'
  /** #RRGGBBAA */
  color: string
  outline?: { width: number; color: string }
}

export interface Placed {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export type Drawer = ReturnType<typeof makeDrawer>

/** Builds the text layer's props as Dazbee stores them. */
export function textProps(text: string, look: TextLook, place: Placed): Record<string, unknown> {
  return {
    ...place,
    text,
    boxMode: 'autoWidth',
    align: look.align,
    style: {
      fontFamily: look.family,
      fontWeight: look.weight,
      fontStyle: look.style,
      fontSize: look.size,
      color: look.color,
      letterSpacing: { unit: 'percent', value: round(look.spacing, 2) },
      ...(look.lineHeight ? { lineHeight: look.lineHeight } : {}),
      ...(look.outline && look.outline.width > 0 ? { outline: look.outline } : {}),
    },
  }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/**
 * A drawer over Dazbee's renderer that keeps fonts registered between draws. `use` names the faces
 * the next draws may set text in (with the shipped fallbacks); `draw` gives RGBA pixels.
 */
export function makeDrawer(ck: CanvasKit, shipped: readonly CatalogueFace[]) {
  const cache = resourceCache(ck)
  const bytes = new Map<string, Uint8Array>()
  const bytesOf = (face: CatalogueFace) => {
    let b = bytes.get(face.file)
    if (!b) bytes.set(face.file, (b = fontBytes(face)))
    return b
  }
  let fonts: ResourceBytes['fonts'] = []
  let key = ''
  const resourceBytes = (): ResourceBytes => ({ fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })

  function use(faces: readonly CatalogueFace[]) {
    // One registration per file (a variable file is several faces); a shipped family the faces
    // name again is left to the faces, so the face asked for is the one drawn.
    const families = new Set(faces.map((f) => f.family))
    const seen = new Set<string>()
    const all = [...shipped.filter((f) => !families.has(f.family)), ...faces].filter((f) => {
      const k = `${f.family}|${f.file}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const next = all.map((f) => f.file).join(',')
    if (next === key) return
    key = next
    fonts = all.map((f) => ({ family: f.family, bytes: bytesOf(f) }))
    // Keeps the byte cache small: only the faces in use stay read.
    for (const file of bytes.keys()) if (!all.some((f) => f.file === file)) bytes.delete(file)
  }

  /** The natural width and height Dazbee gives the text set in this look, as a text that grows draws it. */
  function measure(text: string, look: TextLook): { width: number; height: number } {
    const resources = cache.resources(resourceBytes())
    const parsed = parseDesign(design(1, 1, null, textProps(text, look, { x: 0, y: 0, width: 1, height: 1, rotation: 0 })))
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const props = parsed.design.nodes.t!.props as TextProps
    return textMeasure(ck, resources)(props, null)
  }

  /**
   * The frame's pixels, RGBA unpremultiplied: the text layer drawn on `background` (#RRGGBBAA), or
   * on nothing when it is null.
   */
  function draw(
    width: number,
    height: number,
    background: string | null,
    props: Record<string, unknown>,
  ): Uint8Array {
    const parsed = parseDesign(design(width, height, background, props))
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const resources = cache.resources(resourceBytes())
    const scene = render(parsed.design, 'f', undefined, textMeasure(ck, resources))
    const surface = ck.MakeSurface(width, height)
    if (!surface) throw new Error(`no ${width}x${height} surface`)
    try {
      drawScene(ck, surface.getCanvas(), scene, resources)
      surface.flush()
      const image = surface.makeImageSnapshot()
      try {
        const px = image.readPixels(0, 0, {
          width,
          height,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB,
        })
        if (!(px instanceof Uint8Array)) throw new Error('no pixels')
        return px
      } finally {
        image.delete()
      }
    } finally {
      surface.dispose()
    }
  }

  return { use, draw, measure, delete: cache.delete }
}

function design(width: number, height: number, background: string | null, props: Record<string, unknown>) {
  return {
    meta: { designId: 'd', name: 'match' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p',
        name: 'Block',
        width,
        height,
        x: 0,
        y: 0,
        fills: background ? [{ type: 'solid', color: background }] : [],
        order: 'a0',
      },
    },
    nodes: { t: { type: 'text', parentId: 'f', link: 't', index: 'a0', name: 'Text', props } },
  }
}
