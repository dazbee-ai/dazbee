// The sections' titles on the overlay, each inside the top left of its outline, which the stage's
// surface draws under the frames; a title is lit while its section is picked or a drop's target.
import { px } from './rulers.ts'
import { type ShownSections, titleBox } from './sections.ts'

/**
 * The title of each section shown whose outline is on the stage (`stage`, its size), as wide as its outline leaves room for, cut short past that; the section being renamed
 * (`renaming`) is left out, the page's field standing in its place.
 */
export function sectionTitleParts(
  { outlines, lit }: ShownSections,
  {
    picked,
    renaming,
    stage,
  }: { picked: string | null; renaming: string | null; stage: { width: number; height: number } },
): HTMLElement[] {
  return outlines.flatMap(({ id, title, box }) => {
    const off = box.x > stage.width || box.y > stage.height || box.x + box.width < 0 || box.y + box.height < 0
    if (off || id === renaming) return []
    const at = titleBox(box)
    const el = document.createElement('div')
    el.className = 'section-title'
    el.dataset.section = id
    if (id === picked || id === lit) el.dataset.active = ''
    el.textContent = title
    Object.assign(el.style, { left: px(at.x), top: px(at.y), maxWidth: px(at.width) })
    return [el]
  })
}
