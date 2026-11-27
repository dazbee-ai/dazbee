// Where a section's rename field goes over its title on the stage.
import type { Rect } from '@dazbee/schema'

/** A title's height on screen at its full size, which its rename field's text is set in. */
const TITLE_HEIGHT = 18

/**
 * The rename field's box for a title drawn at `title`: the title's own place and width, and never shorter than a
 * title at its full size, so the field's text shows whole over a title drawn smaller, zoomed far out.
 */
export function renameFieldBox(title: Rect): Rect {
  return { ...title, height: Math.max(title.height, TITLE_HEIGHT) }
}
