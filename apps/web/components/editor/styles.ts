// The editor chrome's own looks, as class strings, and the colours offered without a brand kit: every
// editor control that looks like one of these takes it from here instead of spelling its classes again.
// Looks that controls outside the editor share live in components/ui/looks.ts.

import {
  DISABLED,
  FOCUS_RING,
  LIT_ROW,
  TOUCH_FIELD,
  TOUCH_GAP,
  TOUCH_ROW,
  TOUCH_SQUARE,
} from '@/components/ui/looks.ts'

/**
 * A small pill button, as the mock's chips under a list, lit by the tints under the pointer and while
 * pressed; 44 px tall on a phone or a touch screen.
 */
export const CHIP = `inline-flex h-7 ${TOUCH_FIELD} cursor-pointer items-center gap-1 rounded-full border border-line px-3 text-tiny font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:border-line-strong ${LIT_ROW} ${DISABLED}`

/** A small square icon button in a card's row; 44 px each way on a phone. */
export const ICON_BUTTON = `grid size-7 ${TOUCH_SQUARE} shrink-0 cursor-pointer place-items-center rounded-row text-subtle transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text active:bg-pressed disabled:pointer-events-none disabled:opacity-30`

/** A chip on the accent's tint, for a choice that is set: the header card's sizes. Its words are in the text colour. */
export const CHIP_ACCENT = `${CHIP} border-transparent bg-accent-soft text-text hover:border-transparent`
/** A word-sized button that acts at once, in the accent: a menu row's Reset. */
export const LINK_BUTTON = `shrink-0 cursor-pointer rounded-row px-1.5 text-label font-semibold text-accent-text ${LIT_ROW} ${FOCUS_RING}`
/** A button with words and no box until hovered, as a panel's Done or Delete; its words are in the text colour while lit. */
export const QUIET_BUTTON = `flex h-8 cursor-pointer items-center gap-1.5 rounded-row px-3 text-small font-medium text-muted ${LIT_ROW} disabled:pointer-events-none disabled:opacity-50 ${FOCUS_RING}`

/** A square tile showing one image asset's thumbnail, in the asset library and the image picker. */
export const ASSET_TILE =
  'grid aspect-square place-items-center overflow-hidden rounded-[10px] border border-line bg-bg/40 transition-colors duration-[var(--chrome-fast)]'

/** A tool dock button's shape; its width is the caller's. */
export const DOCK_BUTTON = `grid h-10 cursor-pointer place-items-center rounded-[12px] transition-colors duration-[var(--chrome-fast)] ${FOCUS_RING}`
/** The dock's colours for the tool in use, and for the others. */
export const DOCK_ON = 'bg-accent-solid text-on-accent'
export const DOCK_OFF = 'text-muted hover:bg-hover hover:text-text active:bg-pressed active:text-text'
/** One tool's square dock button, lit while the tool is in use. */
export const dockTool = (on: boolean) => `${DOCK_BUTTON} w-10 ${on ? DOCK_ON : DOCK_OFF}`

/**
 * A chip of the phone's tab bar, after the panels' buttons: the tool in use, Pages and the zoom. As
 * tall as the panels' buttons, its words in the text colour, lit by the hover tint while what it
 * opens shows. Its focus ring is drawn inside it, as the tab bar clips what reaches past it.
 */
export const TAB_BAR_CHIP = `inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full px-2 text-small font-semibold whitespace-nowrap text-text tabular-nums transition-colors duration-[var(--chrome-fast)] hover:bg-hover active:bg-pressed aria-expanded:bg-hover disabled:cursor-default disabled:opacity-40 ${FOCUS_RING} focus-visible:outline-offset-[-2px]`
/** On a phone, what rests above the tab bar where the tool tray opens, a flyout and Pages, hidden while the tray is open. */
export const UNDER_TOOL_TRAY = 'max-sm:group-data-[tray]/shell:invisible'

/**
 * What a swatch-like control's target is, the box a pointer or finger hits: as big as what it draws,
 * and on a phone or a touch screen 44 px across, a touch target a finger can hit, with the pressed tint showing round
 * its drawing while pressed. What holds it keeps it TOUCH_GAP from the next target.
 */
const SWATCH_HIT =
  'group/swatch grid shrink-0 cursor-pointer place-items-center transition-colors duration-[var(--chrome-fast)] max-sm:size-[44px] [@media(hover:none)]:size-[44px] max-sm:rounded-row [@media(hover:none)]:rounded-row max-sm:active:bg-pressed [@media(hover:none)]:active:bg-pressed'
/** A round swatch's target. A row of them is a SWATCH_ROW. */
export const SWATCH_TARGET = `${SWATCH_HIT} rounded-full`
/** A square swatch's target: a paint's swatch in its row, a colour field's box beside its hex. */
export const SQUARE_SWATCH_TARGET = `${SWATCH_HIT} rounded-[7px]`
/** How big a swatch target draws what it holds on a phone or a touch screen; elsewhere that size is the caller's. */
export const FACE_SIZE = 'shrink-0 max-sm:size-[32px] [@media(hover:none)]:size-[32px]'
/** What a round swatch target draws: round, as big as its caller says, and 32 px on a phone or a touch screen. */
export const SWATCH_FACE = `${FACE_SIZE} rounded-full`
/** How big the Colour and Background panels draw their swatches, their + and their eyedropper, off a phone. */
export const PANEL_SWATCH = 'size-[22px]'
/** A round colour swatch, drawn in a SWATCH_TARGET; its size off a phone is the caller's. */
export const SWATCH = `${SWATCH_FACE} border border-swatch-ring transition-transform duration-[var(--chrome-fast)] group-hover/swatch:scale-110`
/**
 * A row of swatch targets, wrapping onto more lines; on a phone or a touch screen TOUCH_GAP apart at
 * the least, spread across the row in columns of 44 px targets, each line lined up with the one above.
 */
export const SWATCH_ROW = `flex flex-wrap items-center ${TOUCH_GAP} max-sm:grid max-sm:grid-cols-[repeat(auto-fill,44px)] max-sm:justify-between [@media(hover:none)]:grid [@media(hover:none)]:grid-cols-[repeat(auto-fill,44px)] [@media(hover:none)]:justify-between`
/**
 * A touch area for a control drawn smaller than a finger, such as a gradient's stop: an empty element
 * inside the control, shown only on a phone or a touch screen, 44 px across and centred on it, so a press anywhere in
 * it lands on the control.
 */
export const TOUCH_AREA =
  'absolute top-1/2 left-1/2 hidden size-[44px] -translate-1/2 max-sm:block [@media(hover:none)]:block'

/** Colours a click away when the brand's kit has none; the hex fields take any colour. */
export const SWATCHES = [
  '#FFFFFF',
  '#FBF7F2',
  '#1A1420',
  '#FF48B0',
  '#3D6BFF',
  '#FFD23F',
  '#3DD68C',
  '#FF6B3D',
] as const

/**
 * The ring round a picked swatch or tile, as in the mock: the accent with a gap, a shape and not only a
 * colour, so it reads without colour vision too.
 */
export const PICKED_RING = 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]'

/** The look of a value typed into a field: a number, a hex, a dash pattern. */
export const VALUE_TEXT = 'font-mono text-label tabular-nums text-text'
/**
 * The digits of a number input and its unit: a value's look on a line of whole pixels, so the
 * digits stay put when the input takes the focus.
 */
export const NUMBER_TEXT = `${VALUE_TEXT} leading-[16px]`
/**
 * A number input's value as a click selects it: the accent at a see-through tint with the digits in
 * the text colour, so it shows plainly as selected, 3:1 against the field; on glass, where a field
 * is a well, the glass makes both the stronger ones.
 */
export const NUMBER_SELECTED = 'selection:bg-accent-selected selection:text-text-selected'
/**
 * The same, stronger, where the digits lie on a fill or on glass, so it stays 3:1 against them with
 * its digits 4.5:1 on it.
 */
export const NUMBER_SELECTED_STRONG = 'selection:bg-accent-selected-strong selection:text-text-selected-strong'
/** A field to type a value into, as tall as a knob: its border shows the focus, with no ring besides. */
export const FIELD = `h-8 ${TOUCH_FIELD} min-w-0 w-full rounded-row border border-field-line bg-field px-1.5 ${VALUE_TEXT} outline-none focus-visible:outline-none! placeholder:text-subtle focus:border-accent`
/** Where a dragged row would land in a list: a line across it, placed by the row above or below. */
export const DROP_LINE = 'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent'

/** The outlined tile a text layer's icon sits on in a list row. */
export const LAYER_PICTURE = 'border border-line bg-surface'

/** A name typed in place in a card's row, as a page's or a version's rename. */
export const RENAME_IN_ROW =
  'h-7 min-w-0 flex-1 rounded-[6px] border border-accent bg-field px-1.5 text-small outline-none'

/** A small name over or beside a card's field. */
export const FIELD_LABEL = 'text-tiny font-medium text-muted'

/** A dropdown field's box, as tall as a knob. */
export const SELECT = 'h-8 w-full bg-field px-1.5 text-label'
/**
 * A number you drag sideways, as in the mock: its label at the start, its value in mono at the end,
 * and a soft fill behind them showing where the value sits in its range: from `--fill-from`, `--fill` wide,
 * with a line at the value (`--fill-at`) on a field that has a range (`data-ranged`). While it is
 * typed in (`data-typing`) its edge is the accent, under the pointer too; while it is dragged
 * (`data-scrubbing`) the fill keeps up with the pointer. On a phone or a touch screen it is 44 px tall.
 */
export const KNOB = `relative flex h-8 min-w-0 cursor-ew-resize touch-pan-y select-none items-center gap-2 overflow-hidden rounded-row border border-field-line bg-field px-2.5 text-label font-normal text-muted transition-colors duration-[var(--chrome-fast)] hover:border-line-strong data-typing:border-accent ${TOUCH_FIELD} data-scrubbing:before:transition-none before:pointer-events-none before:absolute before:inset-y-0 before:start-[var(--fill-from,0%)] before:w-[var(--fill,0%)] before:bg-accent-soft before:transition-[width] before:duration-75 data-ranged:after:pointer-events-none data-ranged:after:absolute data-ranged:after:inset-y-1.5 data-ranged:after:start-[clamp(3px,var(--fill-at),calc(100%-3px))] data-ranged:after:w-0.5 data-ranged:after:-translate-x-1/2 data-ranged:after:rounded-full data-ranged:after:bg-accent data-ranged:after:shadow-[0_0_8px_rgb(255_72_176/0.7)] rtl:data-ranged:after:translate-x-1/2`
/** Knobs two to a row, 8 px apart on a phone or a touch screen; a lone last one takes the whole row. */
export const KNOBS = `grid grid-cols-2 gap-1.5 ${TOUCH_GAP} [&>:last-child:nth-child(odd)]:col-span-2`

/** A switch drawn in a menu row or a card's row that is role="switch": checked, its knob slides to the end. */
export const SWITCH =
  'relative h-5 w-[34px] shrink-0 rounded-full bg-subtle/70 transition-colors duration-[var(--chrome-fast)] group-aria-checked:bg-accent-solid after:absolute after:start-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform after:duration-[var(--chrome-fast)] group-aria-checked:after:translate-x-3.5 rtl:group-aria-checked:after:-translate-x-3.5'

/** A tile to pick, as the effects and the box modes are: its picture, its name under it, lit while it is on. */
/**
 * A choice as a small chip: an icon and a short name on the well, tinted with a ring while it is on
 * (pressed, or checked in a radio group). Effects and an outline's look show their choices so.
 */
export const ICON_CHIP = `flex h-[34px] ${TOUCH_ROW} min-w-0 cursor-pointer items-center gap-1 rounded-row bg-well px-2 text-label font-normal whitespace-nowrap text-muted transition-colors duration-[var(--chrome-fast)] [--icon-ground:var(--color-well)] hover:text-text aria-pressed:bg-accent-soft aria-pressed:text-text aria-pressed:shadow-[inset_0_0_0_1.5px_var(--accent)] aria-checked:bg-accent-soft aria-checked:text-text aria-checked:shadow-[inset_0_0_0_1.5px_var(--accent)] ${FOCUS_RING}`

export const TILE = `group flex min-w-0 cursor-pointer flex-col items-center gap-1 text-caption font-normal text-muted aria-pressed:text-text aria-checked:text-text ${FOCUS_RING}`
const TILE_FACE_BASE =
  'grid w-full place-items-center overflow-hidden rounded-[10px] border border-line bg-bg/60 transition-colors duration-[var(--chrome-fast)] group-hover:border-line-strong group-aria-pressed:border-accent group-aria-pressed:ring-1 group-aria-pressed:ring-inset group-aria-pressed:ring-accent group-aria-checked:border-accent group-aria-checked:ring-1 group-aria-checked:ring-inset group-aria-checked:ring-accent'
/** The picture of a TILE, wider than tall. A chosen one's ring is drawn inside it, so a panel's edge never cuts it. */
export const TILE_FACE_WIDE = `${TILE_FACE_BASE} aspect-[3/2]`
/** A row that turns something on or off, with role="switch": its words, then the switch; 44 px tall on a phone or a touch screen. */
export const SWITCH_ROW = `group flex h-8 ${TOUCH_FIELD} w-full cursor-pointer items-center justify-between gap-3 rounded-row text-small font-normal text-text ${FOCUS_RING}`

/** One part of an edit panel or pop-up: a card's controls under a small heading, a hairline above all but the first. */
export const PANEL_PART = 'flex flex-col gap-2.5 border-t border-line pt-3 first:border-t-0 first:pt-0'
/** A small heading over a group of choices: a part's under a section's title, Add a frame's channels, the font chooser's groups. */
export const PANEL_HEADING = 'text-tiny font-medium text-muted'
/** A switcher tab's section title: a step above the headings of the parts inside it. */
export const SECTION_TITLE = 'text-small font-bold text-text'
/**
 * A boxed button of an edit panel that acts at once: its icon, then its words, or its icon alone,
 * 44 px tall on a phone or a touch screen. The hover and pressed tints are laid over its fill.
 */
export const PANEL_BUTTON = `flex h-[34px] ${TOUCH_FIELD} min-w-0 cursor-pointer items-center gap-2 rounded-row border border-field-line bg-field px-2.5 text-label font-normal whitespace-nowrap text-text transition-colors duration-[var(--chrome-fast)] hover:tint-hover active:tint-pressed disabled:cursor-not-allowed disabled:opacity-45 [&>span]:truncate ${FOCUS_RING}`
/** An edit panel's button among many that act at once, as Position's moves: unfilled, lit by the tints. */
export const PANEL_ACTION = `flex h-[34px] min-w-0 cursor-pointer items-center gap-2 rounded-row px-2.5 text-label font-normal whitespace-nowrap text-text transition-colors duration-[var(--chrome-fast)] hover:bg-hover active:bg-pressed disabled:cursor-not-allowed disabled:opacity-45 [&>span]:truncate ${FOCUS_RING}`
/** A switch shaped as a knob, its name at the start: Lock ratio among the size fields; as tall as a knob. */
export const KNOB_SWITCH = `group flex h-8 ${TOUCH_FIELD} min-w-0 cursor-pointer items-center justify-between gap-2 rounded-row border border-field-line bg-field px-2.5 text-label font-normal whitespace-nowrap text-muted transition-colors duration-[var(--chrome-fast)] hover:border-line-strong aria-checked:text-text ${FOCUS_RING}`

/** On a phone, a row of bar buttons (the small menu's) makes each a 44 px target, 8 px from the next. */
export const BAR_TOUCH =
  'max-sm:gap-[8px] max-sm:[&_[data-bar-item]]:h-[44px] max-sm:[&_[data-bar-item]]:min-w-[44px] max-sm:[&_[data-bar-item]]:px-[6px]'
/** One button of a bar, such as the small menu: words or an icon, lit by the hover tint while its menu is open and by the pressed tint while pressed. */
export const BAR_BUTTON = `flex h-[30px] min-w-[30px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-row px-2 text-label font-semibold whitespace-nowrap text-text transition-colors duration-[var(--chrome-fast)] hover:bg-hover active:bg-pressed aria-expanded:bg-hover aria-expanded:active:bg-pressed ${FOCUS_RING}`
/** A button that turns something on or off, such as the small menu's lock and the Text tab's bold: on the accent's tint while it is on, its icon in the text colour. */
export const BAR_TOGGLE = `${BAR_BUTTON} aria-pressed:bg-accent-soft aria-pressed:active:bg-pressed ${DISABLED}`
/** The swatch shown for a colour the selected layers don't share. */
export const MIXED_COLOUR = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)'
/** The upright hairline between a bar's groups of buttons: the tool dock's, and the phone's tab bar's. */
export const BAR_DIVIDER = 'mx-0.5 h-5 w-px shrink-0 bg-line max-sm:mx-0'

/**
 * A small message floating at the stage's start corner: a layer removed, something auto layout
 * decides. One line is 40 px tall; words that wrap make it taller, so its box is the room they take.
 */
export const TOAST =
  'toast-in pointer-events-auto flex min-h-10 items-center gap-2 rounded-card surface-frost py-1.5 ps-3.5 pe-1.5 text-small'
