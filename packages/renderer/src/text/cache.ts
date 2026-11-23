import type { CanvasKit, FontCollection } from '@dazbee/canvaskit'
import type { TextProps } from '@dazbee/schema'

import { lru } from '../lru.ts'
import type { Resources } from '../resources.ts'
import { layoutKey, layoutText, type TextLayout, type TextResources } from './layout.ts'

export type ParagraphCache = ReturnType<typeof paragraphCache>

/**
 * Laid-out text kept by what shapes it, for a screen that redraws often: a redraw lays out only
 * the text that changed. The cache owns its layouts; `delete` frees them all.
 */
export function paragraphCache(limit = 4000) {
  // The layouts by what shapes them, least recently used first.
  const entries = lru<string, TextLayout>(limit, (laid) => laid.delete())
  // The fonts the kept layouts were shaped with.
  let fonts: FontCollection | null = null

  function layout(ck: CanvasKit, props: TextProps, resources: TextResources) {
    // The fonts' features are read from the same files, so they change only with the fonts.
    if (resources.fonts !== fonts) {
      entries.clear()
      fonts = resources.fonts
    }
    return entries.get(layoutKey(props, resources.fallbackFamilies), () => layoutText(ck, props, resources))
  }

  return { layout, delete: entries.clear }
}

/** A text layer laid out, from the paragraph cache when there is one; `done` frees what the cache doesn't own. */
export function laidOut(ck: CanvasKit, props: TextProps, resources: Resources) {
  if (resources.paragraphs) return { ...resources.paragraphs.layout(ck, props, resources), done: () => {} }
  const laid = layoutText(ck, props, resources)
  return { ...laid, done: () => laid.delete() }
}

/**
 * Measures text for auto layout, the way `layoutText` lays it out to draw: natural width
 * (rounded up, as a text box that grows draws) or the height at a given width. A curved text
 * measures as its curve's box at any width.
 */
export function textMeasure(ck: CanvasKit, resources: TextResources) {
  return (props: TextProps, width: number | null) => {
    const laid = layoutText(
      ck,
      width === null ? { ...props, boxMode: 'autoWidth' } : { ...props, boxMode: 'autoHeight', width },
      resources,
    )
    try {
      return { width: width === null || props.curve ? laid.width : width, height: laid.height }
    } finally {
      laid.delete()
    }
  }
}
