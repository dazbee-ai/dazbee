// Export's first ticks on a page, and the order its list shows the page's frames in: under each
// section's title, top to bottom, then the frames in no section; the ticked ones export in it.
import { type Design, type Frame, framesInSection, framesOf, sectionOf, sectionsByPlace } from '@dazbee/schema'

/** Which of the page's frames are ticked: every one, or these. */
export type Ticked = 'all' | ReadonlySet<string>

/** A run of Export's list: a section's frames under its title, or the frames in no section, under none. */
export interface ExportGroup {
  /** The section, by its id and title; null for the frames in no section. */
  section: { id: string; title: string } | null
  /** Its frames, by the page's order. */
  frames: [string, Frame][]
}

/** The ticks Export starts with on a page: the page's starred frames, or every frame when none is starred. */
export function firstTicks(design: Design, pageId: string): Ticked {
  const starred = framesOf(design, pageId).filter(([, frame]) => frame.starred === true)
  return starred.length > 0 ? new Set(starred.map(([frameId]) => frameId)) : 'all'
}

/**
 * A page's frames as Export lists them: a group for each section, top to bottom (`sectionsByPlace`),
 * then one under no title for the frames in no section, left out when there are none. A page with
 * no sections is that one group, in the page's order; a page with no frames has no group.
 */
export function exportGroups(design: Design, pageId: string): ExportGroup[] {
  const groups: ExportGroup[] = sectionsByPlace(design, pageId).map(([sectionId, section]) => ({
    section: { id: sectionId, title: section.title },
    frames: framesInSection(design, sectionId),
  }))
  const loose = framesOf(design, pageId).filter(([frameId]) => sectionOf(design, frameId) === undefined)
  if (loose.length > 0) groups.push({ section: null, frames: loose })
  return groups
}

/** The frames' ids in the order the groups show them. */
export function shownOrder(groups: readonly ExportGroup[]): string[] {
  return groups.flatMap((group) => group.frames.map(([frameId]) => frameId))
}
