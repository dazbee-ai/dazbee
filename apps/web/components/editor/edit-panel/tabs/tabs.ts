// What the edit panel shows for the selected layers or the picked frame: the controls in its
// header, then its switcher tabs in order, each with its sections in order, each section naming the
// controls it shows. Which controls only act is said once, here: a tab that may only view leaves
// them out.
import type { Facts, Kind, PanelProps } from '@/components/editor/edit-panel/target.ts'

/** A switcher tab, by its id. */
export type SwitcherTabId = 'text' | 'image' | 'shape' | 'layout' | 'style' | 'background' | 'arrange'
/** A section of Style, by its id, which is also the one control it shows. */
export type StyleSectionId = 'mask' | 'colour' | 'corners' | 'outline' | 'transparency' | 'effects'
/**
 * A control of the edit panel, by its key: the lock showing a layer locked (`locked`), the lock
 * whose click unlocks it (`unlock`); a shape's own settings (`shape`), a combined shape's
 * operation (`combine`), and combining several shapes (`combine-shapes`); a box's layout (`box`); a
 * photo's Replace (`replace`), Crop (`crop`), fit (`fit`), and its filters, adjustments and fills
 * (`edit`); how
 * the layers sit, their size, place and turn (`position`), and their two flips (`flip`); Order's
 * buttons (`order`); lining one layer up with its frame (`line-up-frame`), and lining several up
 * with each other and spreading them (`line-up`); wrapping several in a group (`group`) or a box
 * (`boxSelection`); a text's font, which opens the font chooser (`font`), its size (`size`), its
 * bold, italic, underline and strikethrough (`text-style`), its alignment, list and case (`align`,
 * `list`, `case`), its spacing, box, shrink to fit and most lines (`spacing`), and its OpenType
 * features (`features`); how the layers
 * look (each of Style's sections); and a picked frame's fills (`background`), its size and place
 * (`frame-position`), and the ⋯ with its actions (`frame-more`).
 */
export type Control =
  | 'locked'
  | 'unlock'
  | 'shape'
  | 'combine'
  | 'combine-shapes'
  | 'box'
  | 'replace'
  | 'crop'
  | 'fit'
  | 'edit'
  | 'position'
  | 'flip'
  | 'order'
  | 'line-up-frame'
  | 'line-up'
  | 'group'
  | 'boxSelection'
  | 'font'
  | 'size'
  | 'text-style'
  | 'align'
  | 'list'
  | 'case'
  | 'spacing'
  | 'features'
  | StyleSectionId
  | 'background'
  | 'frame-position'
  | 'frame-more'
/** A section of the selected layers' switcher tabs, by its id. */
export type LayerSectionId =
  | 'shape'
  | 'combine'
  | 'combine-shapes'
  | 'layout'
  | 'photo'
  | 'fit'
  | 'edit'
  | 'position'
  | 'order'
  | 'line-up'
  | 'wrap-in'
  | 'font'
  | 'paragraph'
  | 'spacing'
  | 'features'
  | StyleSectionId
/** A section of the picked frame's switcher tabs, by its id. */
export type FrameSectionId = 'background' | 'frame-position'
/** One titled block of a switcher tab, by its id, with the controls it shows. */
export interface Section<Id extends string = LayerSectionId> {
  id: Id
  controls: Control[]
}
export interface SwitcherTab<Id extends string = LayerSectionId> {
  id: SwitcherTabId
  sections: Section<Id>[]
}
/** What a section is given: the selection, the controls it shows, and whether it shows its heading (`headedSections`). */
export type SectionProps = PanelProps & { controls: Control[]; headed: boolean }
/** The header's controls, then the switcher tabs, the first opening first. */
export interface PanelLayout<Id extends string = LayerSectionId> {
  header: Control[]
  switcherTabs: SwitcherTab<Id>[]
}
/** The selected layers as the edit panel reads them, and whether the tab may only view the design. */
export interface Selected {
  kind: Kind
  facts: Facts
  several: boolean
  viewOnly: boolean
}

/**
 * The controls that only act, which a tab that may only view leaves out: the header's unlock,
 * combining several shapes, a photo's Replace and Crop, the flips, Order's buttons, lining up, Group
 * and Box.
 */
export const ONLY_ACTS: ReadonlySet<Control> = new Set([
  'unlock',
  'combine-shapes',
  'replace',
  'crop',
  'flip',
  'order',
  'line-up-frame',
  'line-up',
  'group',
  'boxSelection',
])

/** Style's sections, in the order they show: a mask's settings first. */
const STYLE_SECTIONS: readonly StyleSectionId[] = ['mask', 'colour', 'corners', 'outline', 'transparency', 'effects']
/** The Text switcher tab of one or several texts: its Font, Paragraph, Spacing and Font features sections. */
const TEXT_TAB: SwitcherTab = {
  id: 'text',
  sections: [
    { id: 'font', controls: ['font', 'size', 'text-style'] },
    { id: 'paragraph', controls: ['align', 'list', 'case'] },
    { id: 'spacing', controls: ['spacing'] },
    { id: 'features', controls: ['features'] },
  ],
}
/** The Text switcher tab of mixed layers with a text among them: only the font. */
const FONT_ONLY_TAB: SwitcherTab = { id: 'text', sections: [{ id: 'font', controls: ['font'] }] }

/**
 * The sections that never show a heading: a shape's own settings, which the Shape tab names; a
 * photo's Replace and Crop, which name themselves; and its filters, adjustments and fills, each
 * headed inside the section.
 */
const UNHEADED: ReadonlySet<string> = new Set<LayerSectionId>(['shape', 'photo', 'edit'])

/** A section showing one control. */
const oneControl = (id: Section['id'], control: Control): Section => ({ id, controls: [control] })

/**
 * The edit panel for the selected layers. A locked layer's header shows its lock, which unlocks it,
 * or to a tab that may only view, shows it locked. Texts get the Text switcher tab first, and mixed
 * layers with a text among them one with only the font; photos the Image one; shapes with settings of their own, a
 * combined shape and several shapes the Shape one, and one box the Layout one. Every selection then
 * has the Style and Arrange switcher tabs. A locked layer keeps its sections, which turn off all but
 * Order.
 */
export function panelOf(selected: Selected): PanelLayout {
  // The lock that unlocks only acts, so a tab that may only view sees the lock as it stands instead.
  const lock: Control = selected.viewOnly ? 'locked' : 'unlock'
  const header: Control[] = selected.facts.locked.length > 0 ? [lock] : []
  const kinds = kindsTab(selected)
  const style = styleSectionsOf(selected).map((id) => oneControl(id, id))
  const switcherTabs: SwitcherTab[] = [
    ...(kinds ? [kinds] : []),
    { id: 'style', sections: style },
    { id: 'arrange', sections: arrangeOf(selected) },
  ]
  return selected.viewOnly ? viewOnly(header, switcherTabs) : { header, switcherTabs }
}

/**
 * The edit panel for the picked frame: its ⋯ in the header, then Background and Arrange, which holds
 * its size and place. A tab that may only view sees the same panel: its values turn off, and its ⋯
 * keeps what it may do.
 */
export function framePanelOf(picked: { viewOnly: boolean }): PanelLayout<FrameSectionId> {
  const header: Control[] = ['frame-more']
  const switcherTabs: SwitcherTab<FrameSectionId>[] = [
    { id: 'background', sections: [{ id: 'background', controls: ['background'] }] },
    { id: 'arrange', sections: [{ id: 'frame-position', controls: ['frame-position'] }] },
  ]
  return picked.viewOnly ? viewOnly(header, switcherTabs) : { header, switcherTabs }
}

/** Whether the panel shows its switcher: only for two switcher tabs or more; one tab's sections follow the header. */
export function showsSwitcher<Id extends string>(layout: PanelLayout<Id>) {
  return layout.switcherTabs.length > 1
}

/**
 * The sections of `switcherTab` that show a heading: none where one stands alone, as the switcher
 * tab already names it, and where there are more, each that a heading tells apart, but those that
 * never show one (`UNHEADED`).
 */
export function headedSections<Id extends string>(switcherTab: SwitcherTab<Id>): ReadonlySet<Id> {
  if (switcherTab.sections.length < 2) return new Set()
  return new Set(switcherTab.sections.map((one) => one.id).filter((id) => !UNHEADED.has(id)))
}

/**
 * The switcher tab whose colour Shift+I starts picking into: Style, while it shows a colour the
 * layers take; none for a locked layer, whose colour is turned off, or a tab that may only view.
 */
export function colourPickedIn(selected: Selected): SwitcherTabId | null {
  if (selected.viewOnly || selected.facts.locked.length > 0) return null
  return styleSectionsOf(selected).includes('colour') ? 'style' : null
}

/** The kind's tab of the selected layers, which comes first; null for a selection with none. */
function kindsTab({ kind, facts, several }: Selected): SwitcherTab | null {
  if (kind === 'text') return TEXT_TAB
  if (facts.anyText) return FONT_ONLY_TAB
  if (kind === 'photo') return imageTab(facts, several)
  if (kind === 'box' && !several) return { id: 'layout', sections: [oneControl('layout', 'box')] }
  if (kind !== 'shape') return null
  const sections: Section[] = [
    // A rectangle's own settings are its corners, which are the corners control's, not the Shape tab's.
    ...(facts.ownShape && facts.ownShape !== 'rect' ? [oneControl('shape', 'shape')] : []),
    ...(facts.booleans ? [oneControl('combine', 'combine')] : []),
    ...(several ? [oneControl('combine-shapes', 'combine-shapes')] : []),
  ]
  return sections.length > 0 ? { id: 'shape', sections } : null
}

/**
 * The Image switcher tab of one or several photos: Replace, and Crop for one photo, as cropping
 * takes one; the fit; its filters, adjustments and fills; then for one photo a box holds, the box's
 * layout, its corners with it.
 */
function imageTab(facts: Facts, several: boolean): SwitcherTab {
  return {
    id: 'image',
    sections: [
      { id: 'photo', controls: several ? ['replace'] : ['replace', 'crop'] },
      oneControl('fit', 'fit'),
      oneControl('edit', 'edit'),
      ...(facts.boxes && !several ? [oneControl('layout', 'box')] : []),
    ],
  }
}

/**
 * Style's sections for the selected layers, by kind: a mask's settings while every one is a mask;
 * a colour for a text, a shape but a line, a box, and shapes and boxes together; corners for a
 * rectangle and a photo in one (a box's are in its Layout); an outline for all but a text (whose
 * outline is an effect) and a group; then for every selection its transparency and its effects.
 */
function styleSectionsOf({ kind, facts }: Selected): StyleSectionId[] {
  const shapesOrBoxes = kind === 'shape' || kind === 'box' || (kind === 'mixed' && facts.shapesOrBoxes)
  const shows: Record<StyleSectionId, boolean> = {
    mask: facts.masks,
    colour: kind === 'text' || (shapesOrBoxes && !facts.lines),
    corners: (kind === 'photo' || kind === 'shape') && !facts.boxes && facts.ownShape === 'rect',
    outline: kind === 'photo' || shapesOrBoxes,
    transparency: true,
    effects: true,
  }
  return STYLE_SECTIONS.filter((id) => shows[id])
}

/**
 * Arrange's sections: how the layers sit, then Order; one layer then lines up with its frame, and
 * several first line up with each other and wrap in a group or a box.
 */
function arrangeOf({ several }: Selected): Section[] {
  const position: Section = { id: 'position', controls: ['position', 'flip'] }
  const order: Section = { id: 'order', controls: ['order'] }
  if (!several) return [position, order, { id: 'line-up', controls: ['line-up-frame'] }]
  return [
    { id: 'line-up', controls: ['line-up'] },
    { id: 'wrap-in', controls: ['group', 'boxSelection'] },
    position,
    order,
  ]
}

/** The panel a tab that may only view sees: every control that only acts left out, and what is left empty with it. */
function viewOnly<Id extends string>(header: Control[], switcherTabs: SwitcherTab<Id>[]): PanelLayout<Id> {
  const shows = (control: Control) => !ONLY_ACTS.has(control)
  return {
    header: header.filter(shows),
    switcherTabs: switcherTabs
      .map((switcherTab) => ({
        ...switcherTab,
        sections: switcherTab.sections
          .map((section) => ({ ...section, controls: section.controls.filter(shows) }))
          .filter((section) => section.controls.length > 0),
      }))
      .filter((switcherTab) => switcherTab.sections.length > 0),
  }
}
