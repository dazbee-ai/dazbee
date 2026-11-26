// What the editor can be asked to do, in one table: each action with its keys, the group the
// shortcuts list shows it in, and the undo step it makes when it writes. The editor reads it to act
// on keys and to name its steps, the tests to press them, and the app's menus, tooltips and the
// shortcuts list to show them; no key is spelled anywhere else. An action only a menu runs has no
// keys. A key is `Mod` (Ctrl, or ⌘ on a Mac), `Shift` and `Alt`, then one key: a letter, matched by
// the character it types; another character, such as `?`, matched by the character it types
// whatever Shift does to type it; or a KeyboardEvent.code for anything else, so brackets and digits
// work whatever Shift does to them. A row with `byPlace` matches its letter by the key's place too
// on a layout that types no Latin letter there, as Arabic's. A row's `kept` keys run its action too but are not
// listed: the browser has its own use for them, which the stage keeps it from while it has the keys,
// whatever the action then does. The rows are in the shortcuts list's order, group by group.
import type { StepName } from '@dazbee/doc'

import type { KeyInput, PointerInput } from './gestures/inputs.ts'

/** The shortcuts list's groups, in the order it shows them. */
export const SHORTCUT_GROUPS = [
  'edit',
  'text',
  'tools',
  'arrange',
  'combine',
  'linked',
  'align',
  'move',
  'view',
] as const
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

export const SHORTCUTS = [
  { action: 'undo', keys: ['Mod+Z'], group: 'edit' },
  { action: 'redo', keys: ['Mod+Shift+Z', 'Mod+Y'], group: 'edit' },
  { action: 'copy', keys: ['Mod+C'], group: 'edit' },
  { action: 'copyPng', keys: ['Mod+Shift+C'], group: 'edit' },
  { action: 'cut', keys: ['Mod+X'], group: 'edit', step: 'cut' },
  { action: 'paste', keys: ['Mod+V'], group: 'edit', step: 'paste' },
  { action: 'selectAll', keys: ['Mod+A'], group: 'edit' },
  { action: 'selectSameFill', keys: [], group: 'edit' },
  { action: 'selectSameFont', keys: [], group: 'edit' },
  { action: 'findReplace', keys: ['Mod+F'], group: 'edit' },
  { action: 'deselect', keys: ['Escape'], group: 'edit' },
  { action: 'goIn', keys: ['Enter'], group: 'edit' },
  { action: 'goOut', keys: ['Shift+Enter'], group: 'edit' },
  { action: 'nextLayer', keys: ['Tab'], group: 'edit' },
  { action: 'previousLayer', keys: ['Shift+Tab'], group: 'edit' },
  { action: 'selectLayer', keys: [], group: 'edit' },
  { action: 'delete', keys: ['Delete', 'Backspace'], group: 'edit', step: 'delete' },
  { action: 'duplicate', keys: ['Mod+D'], group: 'edit', step: 'duplicate' },
  { action: 'rename', keys: ['F2'], group: 'edit' },
  { action: 'editPoints', keys: [], group: 'edit' },
  { action: 'copyStyle', keys: ['Mod+Alt+C'], group: 'edit' },
  { action: 'pasteStyle', keys: ['Mod+Alt+V'], group: 'edit', step: 'style' },
  { action: 'saveVersion', keys: ['Mod+Alt+S'], group: 'edit' },
  { action: 'bold', keys: ['Mod+B'], group: 'text', step: 'style' },
  { action: 'italic', keys: ['Mod+I'], group: 'text', step: 'style' },
  { action: 'underline', keys: ['Mod+U'], group: 'text', step: 'style' },
  { action: 'strikethrough', keys: ['Mod+Shift+X'], group: 'text', step: 'style' },
  { action: 'toolSelect', keys: ['V'], group: 'tools' },
  { action: 'toolHand', keys: ['H'], group: 'tools' },
  { action: 'toolFrame', keys: ['F'], group: 'tools' },
  { action: 'toolSection', keys: ['Shift+S'], group: 'tools' },
  { action: 'toolRect', keys: ['R'], group: 'tools' },
  { action: 'toolEllipse', keys: ['O'], group: 'tools' },
  { action: 'toolBox', keys: ['B'], group: 'tools' },
  { action: 'toolLine', keys: ['L'], group: 'tools' },
  { action: 'toolArrow', keys: ['Shift+L'], group: 'tools' },
  { action: 'toolPen', keys: ['P'], group: 'tools' },
  { action: 'toolText', keys: ['T'], group: 'tools' },
  { action: 'pickColour', keys: ['Shift+I'], group: 'tools' },
  { action: 'group', keys: ['Mod+G'], group: 'arrange', step: 'group' },
  { action: 'ungroup', keys: ['Mod+Shift+G', 'Mod+Backspace'], group: 'arrange', step: 'ungroup' },
  { action: 'boxSelection', keys: ['Mod+Alt+G'], group: 'arrange', step: 'box' },
  { action: 'autoLayout', keys: ['Shift+A'], group: 'arrange', step: 'layout' },
  { action: 'layoutFree', keys: ['Alt+Shift+A'], group: 'arrange', step: 'layout' },
  { action: 'bringForward', keys: ['Mod+BracketRight'], group: 'arrange', step: 'reorder' },
  { action: 'sendBackward', keys: ['Mod+BracketLeft'], group: 'arrange', step: 'reorder' },
  { action: 'bringToFront', keys: ['Mod+Shift+BracketRight'], group: 'arrange', step: 'reorder' },
  { action: 'sendToBack', keys: ['Mod+Shift+BracketLeft'], group: 'arrange', step: 'reorder' },
  { action: 'lock', keys: ['Mod+Shift+L'], group: 'arrange', step: 'lock' },
  { action: 'hide', keys: ['Mod+Shift+H'], group: 'arrange', step: 'hide' },
  { action: 'mask', keys: ['Mod+Alt+M'], group: 'arrange', step: 'mask' },
  { action: 'flipHorizontal', keys: ['Shift+H'], group: 'arrange', step: 'flip' },
  { action: 'flipVertical', keys: ['Shift+V'], group: 'arrange', step: 'flip' },
  { action: 'booleanUnion', keys: ['Alt+Shift+U'], group: 'combine', step: 'combine' },
  { action: 'booleanSubtract', keys: ['Alt+Shift+S'], group: 'combine', step: 'combine' },
  { action: 'booleanIntersect', keys: ['Alt+Shift+I'], group: 'combine', step: 'combine' },
  { action: 'booleanExclude', keys: ['Alt+Shift+E'], group: 'combine', step: 'combine' },
  { action: 'selectLinkedCopies', keys: ['Mod+Alt+A'], group: 'linked' },
  { action: 'styleToLinked', keys: ['Mod+Alt+Shift+C'], group: 'linked', step: 'style' },
  { action: 'textToLinked', keys: ['Mod+Alt+Shift+T'], group: 'linked', step: 'editText' },
  { action: 'lockLinked', keys: ['Mod+Alt+Shift+L'], group: 'linked', step: 'lock' },
  { action: 'hideLinked', keys: ['Mod+Alt+Shift+H'], group: 'linked', step: 'hide' },
  { action: 'layerToLinked', keys: [], group: 'linked', step: 'copyToFrames' },
  { action: 'deleteLinked', keys: [], group: 'linked', step: 'delete' },
  { action: 'alignLeft', keys: ['Alt+A'], group: 'align', step: 'align' },
  { action: 'alignCentre', keys: ['Alt+H'], group: 'align', step: 'align' },
  { action: 'alignRight', keys: ['Alt+D'], group: 'align', step: 'align' },
  { action: 'alignTop', keys: ['Alt+W'], group: 'align', step: 'align' },
  { action: 'alignMiddle', keys: ['Alt+V'], group: 'align', step: 'align' },
  { action: 'alignBottom', keys: ['Alt+S'], group: 'align', step: 'align' },
  { action: 'distributeHorizontal', keys: ['Alt+Shift+H'], group: 'align', step: 'distribute' },
  { action: 'distributeVertical', keys: ['Alt+Shift+V'], group: 'align', step: 'distribute' },
  { action: 'nudgeLeft', keys: ['ArrowLeft'], kept: ['Alt+ArrowLeft'], group: 'move', step: 'move' },
  { action: 'nudgeRight', keys: ['ArrowRight'], kept: ['Alt+ArrowRight'], group: 'move', step: 'move' },
  { action: 'nudgeUp', keys: ['ArrowUp'], kept: ['Alt+ArrowUp'], group: 'move', step: 'move' },
  { action: 'nudgeDown', keys: ['ArrowDown'], kept: ['Alt+ArrowDown'], group: 'move', step: 'move' },
  { action: 'nudgeLeftFar', keys: ['Shift+ArrowLeft'], kept: ['Alt+Shift+ArrowLeft'], group: 'move', step: 'move' },
  { action: 'nudgeRightFar', keys: ['Shift+ArrowRight'], kept: ['Alt+Shift+ArrowRight'], group: 'move', step: 'move' },
  { action: 'nudgeUpFar', keys: ['Shift+ArrowUp'], kept: ['Alt+Shift+ArrowUp'], group: 'move', step: 'move' },
  { action: 'nudgeDownFar', keys: ['Shift+ArrowDown'], kept: ['Alt+Shift+ArrowDown'], group: 'move', step: 'move' },
  { action: 'zoomIn', keys: ['Mod+Equal', 'Mod+Shift+Equal', 'Mod+NumpadAdd'], group: 'view' },
  { action: 'zoomOut', keys: ['Mod+Minus', 'Mod+NumpadSubtract'], group: 'view' },
  { action: 'zoomToFit', keys: ['Shift+Digit1'], group: 'view' },
  { action: 'zoomToSelection', keys: ['Shift+Digit2'], group: 'view' },
  { action: 'zoomTo100', keys: ['Mod+Digit0', 'Shift+Digit0'], group: 'view' },
  { action: 'toggleRulers', keys: ['Shift+R'], group: 'view' },
  { action: 'toggleHiddenShown', keys: [], group: 'view' },
  { action: 'showVersions', keys: [], group: 'view' },
  { action: 'assets', keys: ['I'], group: 'view' },
  { action: 'quickActions', keys: ['Mod+K', 'Mod+/'], byPlace: true, group: 'view' },
  { action: 'shortcuts', keys: ['?'], group: 'view' },
] as const satisfies readonly {
  action: string
  keys: readonly string[]
  kept?: readonly string[]
  byPlace?: boolean
  group: ShortcutGroup
  step?: StepName
}[]

export type ShortcutAction = (typeof SHORTCUTS)[number]['action']

interface Parsed {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

/**
 * The table's actions the page does, never the stage: the browser copies, cuts and pastes on its
 * own events, which the clipboard's listeners take; the page copies as PNG through the editor, which
 * writes the system clipboard; the page starts picking a colour from the eyedropper of the panel it
 * opens, and opens Find and replace, the Versions card (with its save form, for Save version), the
 * shortcuts list and Quick actions.
 */
export const PAGE_ACTIONS = [
  'copy',
  'copyPng',
  'cut',
  'paste',
  'pickColour',
  'findReplace',
  'saveVersion',
  'showVersions',
  'assets',
  'shortcuts',
  'quickActions',
] as const satisfies readonly ShortcutAction[]
/** An action the stage does: any but the page's (`PAGE_ACTIONS`). */
export type StageAction = Exclude<ShortcutAction, (typeof PAGE_ACTIONS)[number]>
/** How far the arrow keys move the selection, in design pixels: 1, or 10 with Shift. */
export const NUDGE = 1
export const NUDGE_FAR = 10
/** How far each arrow key moves the selection or the picked frame, in design pixels along x and y; Shift goes further. */
export const NUDGES: Readonly<Partial<Record<ShortcutAction, readonly [number, number]>>> = {
  nudgeLeft: [-NUDGE, 0],
  nudgeRight: [NUDGE, 0],
  nudgeUp: [0, -NUDGE],
  nudgeDown: [0, NUDGE],
  nudgeLeftFar: [-NUDGE_FAR, 0],
  nudgeRightFar: [NUDGE_FAR, 0],
  nudgeUpFar: [0, -NUDGE_FAR],
  nudgeDownFar: [0, NUDGE_FAR],
}
/**
 * The actions with no undo step that still change the design or only lead to a change; saving a
 * version adds to the design's history.
 */
const EDITING_ACTIONS: ReadonlySet<ShortcutAction> = new Set([
  'undo',
  'redo',
  'saveVersion',
  'editPoints',
  'rename',
  'toolFrame',
  'toolSection',
  'toolRect',
  'toolEllipse',
  'toolBox',
  'toolLine',
  'toolArrow',
  'toolPen',
  'toolText',
  'pickColour',
])

const parse = (spec: string): Parsed => {
  const parts = spec.split('+')
  const key = parts.at(-1) ?? ''
  return { mod: parts.includes('Mod'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key }
}
const isLetter = (key: string) => /^[A-Z]$/.test(key)
/** A key that types a Latin letter, in either case. */
const LATIN_LETTER = /^[a-z]$/i
/** A key named by the one character it types that is not a letter, such as `?`. */
const isCharacter = (key: string) => key.length === 1 && !isLetter(key)

/** Each key of the table with its action, listed or kept from the browser, and whether its letter matches by its place. */
const byAction = SHORTCUTS.flatMap((row) => {
  const byPlace = 'byPlace' in row && row.byPlace === true
  return [
    ...row.keys.map((spec) => ({ action: row.action, kept: false, byPlace, ...parse(spec) })),
    ...('kept' in row ? row.kept : []).map((spec) => ({ action: row.action, kept: true, byPlace, ...parse(spec) })),
  ]
})

/** The action a key press asks for, if any. */
export function shortcutFor(
  e: Pick<KeyInput, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): ShortcutAction | null {
  return keyOfTable(e)?.action ?? null
}

/**
 * Whether a key press is a key as the table spells it (`spec`), as the table matches its rows: a
 * letter by the character it types, or by its place with Alt (a Mac types another character then),
 * and with `byPlace` by its place where the keyboard's layout types no Latin letter (Ctrl+K types ن
 * on an Arabic one; on Dvorak, which types t there, Ctrl+T stays Ctrl+T); another character whatever
 * Shift does; any other key by its code. The modifiers match exactly.
 */
export function matchesKey(
  spec: string,
  e: Pick<KeyInput, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  { byPlace = false }: { byPlace?: boolean } = {},
) {
  return pressed({ ...parse(spec), byPlace }, e)
}

/** The action of the stage a key press asks for, if any; a key of the page's actions is left to the page. */
export function stageShortcutFor(
  e: Pick<KeyInput, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): StageAction | null {
  const action = shortcutFor(e)
  return action && !(PAGE_ACTIONS as readonly ShortcutAction[]).includes(action) ? (action as StageAction) : null
}

/**
 * Whether a key pressed while the stage has the keys is one of a row's `kept` keys, the stage's
 * whatever its action then does, so the browser runs none of its own: Alt with an arrow, the
 * browser's Back and Forward, nudges as the arrow alone does, or does nothing with nothing to nudge.
 */
export function keptFromBrowser(
  e: Pick<KeyInput, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'target'>,
) {
  return e.target.stage && keyOfTable(e)?.kept === true
}

/**
 * What the shortcuts list shows: each group in order, with the rows of the actions in it that have
 * keys, in the table's order; an action only a menu runs is left out.
 */
export function shortcutsList({ viewOnly = false }: { viewOnly?: boolean } = {}) {
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    rows: SHORTCUTS.filter((s) => s.group === group && s.keys.length > 0 && (!viewOnly || viewAction(s.action))),
  })).filter(({ rows }) => rows.length > 0)
}

/**
 * Whether a tab that may only view offers an action (C35): one that looks, selects, copies or moves
 * the view, never one that makes an undo step, undoes one, or picks a tool or mode that only draws or
 * edits. The menus and the shortcuts list keep only these in such a tab.
 */
export function viewAction(action: ShortcutAction) {
  return stepOf(action) === null && !EDITING_ACTIONS.has(action)
}

/**
 * Whether a key press holds Mod and paste's key, found by the key's place, whatever Shift and the
 * keyboard's layout do: the paste event that follows says neither, and Shift aims it at the pointer.
 */
export function aimsPaste(e: Pick<KeyInput, 'code' | 'ctrlKey' | 'metaKey'>) {
  const { mod, key } = parse(SHORTCUTS.find((s) => s.action === 'paste')?.keys[0] ?? '')
  return mod && (e.ctrlKey || e.metaKey) && e.code === `Key${key}`
}

/** The undo step an action makes when it writes, or null for one that changes no design. */
export function stepOf(action: ShortcutAction): StepName | null {
  const row = SHORTCUTS.find((s) => s.action === action)
  return row && 'step' in row ? row.step : null
}

/** The first key of an action, spelled as the test editor's keys take it: modifiers, then the key's code, joined by `+`. */
export function pressFor(action: ShortcutAction, mod: 'Control' | 'Meta' = 'Control') {
  const spec = SHORTCUTS.find((s) => s.action === action)?.keys[0] ?? ''
  return spec
    .split('+')
    .map((part) => (part === 'Mod' ? mod : isLetter(part) ? `Key${part}` : part))
    .join('+')
}

/**
 * Whether the key that reaches the deepest layer is held, ⌘ on a Mac and Ctrl elsewhere: the press,
 * the hover and the keys all ask this.
 */
export function deepKeyHeld(e: Pick<PointerInput, 'ctrlKey' | 'metaKey'>, mac: boolean) {
  return mac ? e.metaKey : e.ctrlKey
}

/** Whether a press is the right-click: the right button, or on a Mac the left one with Ctrl. */
export function rightClick(e: Pick<PointerInput, 'button' | 'ctrlKey'>, mac: boolean) {
  return e.button === 2 || (mac && e.button === 0 && e.ctrlKey)
}

/** The table's key a key press is, listed or kept, if any. */
function keyOfTable(e: Pick<KeyInput, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) {
  return byAction.find((s) => pressed(s, e)) ?? null
}

/** Whether a key press is one key of the table (`matchesKey`). */
function pressed(
  s: Parsed & { byPlace: boolean },
  e: Pick<KeyInput, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
) {
  if (s.mod !== (e.ctrlKey || e.metaKey) || s.alt !== e.altKey) return false
  // A character is typed with Shift on one keyboard and without it on another.
  if (isCharacter(s.key)) return e.key === s.key
  if (s.shift !== e.shiftKey) return false
  if (!isLetter(s.key)) return e.code === s.key
  // With Alt a Mac types another character (⌥A is å), so there the key's place decides; so it does
  // for a row matched by place on a layout that types no Latin letter there.
  const byPlace = e.altKey || (s.byPlace && !LATIN_LETTER.test(e.key))
  return e.key.toUpperCase() === s.key || (byPlace && e.code === `Key${s.key}`)
}
