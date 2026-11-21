// What the editor's core is opened with and what it is once open, the members the open editor
// shares with it, and the events it tells of. The core runs without a browser: every point one of
// its members takes or gives is a stage point.
import type { CanvasKit } from '@dazbee/canvaskit'
import type {
  Axis,
  BoxLayout,
  CommandInput,
  CommandName,
  CommandResult,
  DesignStore,
  Notice as ClientNotice,
  Session,
  Sizing,
  StepName,
} from '@dazbee/doc'
import type { ResourceBytes, ResourceCache } from '@dazbee/renderer'
import type {
  AutoLayout,
  ChangeSetKind,
  Design,
  DesignSize,
  Point,
  Presence,
  Rect,
  RejectReason,
  RestoreMark,
  SafeZoneChoice,
  TextStyle,
  ValueKind,
  VariableRef,
  Variables,
} from '@dazbee/schema'
import type { Skipped } from '@dazbee/svg'

import type { Camera, Insets, Viewport } from './canvas/camera.ts'
import type { Frame } from './canvas/frames.ts'
import type { Paint } from './canvas/redraw.ts'
import type { Motion, Spot } from './canvas/view.ts'
import type { ClipboardPayload, Remembered } from './clipboard.ts'
import type { CopyMaker } from './display-copies.ts'
import type { OpenedFonts } from './font-loads.ts'
import type { FrameSampler } from './gestures/colour-pick.ts'
import type { KeyAnswer, KeyInput, PointerAnswer, PointerInput } from './gestures/inputs.ts'
import type { LayerAt } from './gestures/pointer.ts'
import type { SetLayout } from './layers/box-layout.ts'
import type { MaskState, MaskWhy } from './layers/masks.ts'
import type { UngroupState } from './layers/ungroup.ts'
import type { WrapState } from './layers/wrap-state.ts'
import type { LinkedMenu } from './linked-copies.ts'
import type { SvgRead } from './place-svg.ts'
import type { ResourceSources } from './resources.ts'
import type { Restored } from './restore.ts'
import type { ShortcutAction, StageAction } from './shortcuts.ts'
import type { FieldState } from './text/field-change.ts'
import type { FoundText } from './text/find-replace.ts'
import type { RunStyle, TextRange } from './text/text-edit.ts'
import type { TextStyleState } from './text/text-styles.ts'
import type { PlacedAsset, PlaceImageOptions, Tool } from './tools.ts'

/** The options that are not about the page: what the core reads of what `startEditor` is given. */
export interface CoreOptions extends ResourceSources {
  designId: string
  /**
   * Loading steps, then once the design is open its save state (#37): Saving while the sync server
   * has not yet got every edit, Saved once it has, Offline (kept on this device) without it.
   */
  onStatus?: (status: string) => void
  /** Called with the zoom (1 is 100%) whenever it changes. */
  onZoom?: (zoom: number) => void
  /** The name a frame added from a size, or drawn with the Frame tool, takes from its size, in the app's words. */
  frameName: (width: number, height: number) => string
  /** The name a new group, Mask group or box takes, in the app's words. */
  layerName: (kind: 'group' | 'maskGroup' | 'box') => string
  /** A radius as the pill beside the pointer reads it while a radius dot is dragged, in the app's words. */
  radiusLabel: (radius: number) => string
  /**
   * Uploads a picture an SVG file shows into the brand's library, by its bytes, sniffed type and
   * name ("‹layer name› · ‹file name›"), giving the asset it became. Without it, an SVG's pictures are
   * left out.
   */
  uploadImage?: (bytes: Uint8Array, type: string, name: string) => Promise<PlacedAsset>
}

/** The tab's access to the design: whether it may only view it (a Reviewer's, C35), and when that may have changed. */
export interface TabAccess {
  readOnly(): boolean
  /** Whether a refused edit goes untold: the page already says why the tab can't edit (an ended link). */
  quiet?(): boolean
  onChange(listener: () => void): () => void
}

/**
 * What the connection and the device copy tell the person: the client's notices, the device copy
 * stopping (the device full, or the browser's storage failing), and a browser that keeps none.
 */
export type LinkNotice = ClientNotice | { kind: 'deviceStopped'; why: 'full' | 'failed' } | { kind: 'noDeviceCopy' }

/** Where the core hears what the connection tells the person, and the design's size against its limits (D11). */
export interface LinkNotices {
  on(listener: (notice: LinkNotice) => void): () => void
  /** The design's size as the server last told it; undefined before it has. */
  size(): DesignSize | undefined
  onSize(listener: () => void): () => void
}

/**
 * The session as the page runs commands through it: a write a Reviewer's tab refuses (C35) does
 * nothing and gives undefined, the editor saying View only, rather than throwing.
 */
export interface PageSession extends Omit<Session, 'run' | 'batch' | 'undo' | 'redo'> {
  run<N extends CommandName>(name: N, input: CommandInput<N>): CommandResult<N> | undefined
  batch<T>(...args: [steps: () => T] | [name: StepName | null, steps: () => T]): T | undefined
  undo(): ReturnType<Session['undo']> | undefined
  redo(): ReturnType<Session['redo']> | undefined
}

/** Another person's tab's latest presence, as the tab's link heard it, with the name its tab is listed by. */
export interface OtherPresence {
  name: string
  /** The person's number while the design is loaded: the same for each of their tabs. */
  person: number
  /** Their index into `PEOPLE_COLOURS`. */
  colour: number
  /** The tab is an agent's, as its token says. */
  agent?: true
  presence: Presence
}

/** The tab's presence and the other people's: what the tab's link sends and hears. */
export interface TabPresence {
  /** Sends the tab's presence; the link sends the latest at most 30 times a second. */
  send(presence: Presence): void
  /** The other people's tabs' latest presence, by tab id, the one heard from last at the end. */
  others(): ReadonlyMap<number, OtherPresence>
  /** Told whenever `others()` changes. */
  onChange(listener: () => void): () => void
}

/** What the core is opened with: all that is loaded before it opens, and what only its caller can give. */
export interface CoreStart {
  ck: CanvasKit
  /** The cache the screen and exports decode fonts and images in, which the caller frees once the core has ended. */
  cache: ResourceCache
  /** The bytes the design opens with: the fonts the app ships, the design's own fonts and its images. */
  first: ResourceBytes
  /** The catalog's faces and the files the design opened with (`openedFonts`). */
  firstFonts: OpenedFonts
  store: DesignStore
  /** Whether the sync server is connected: a font or image that fails offline waits for it. */
  connected: () => boolean
  /** What the editor keeps on a device between designs and visits: the last copy and the copied style. */
  remembered: Remembered
  /** Whether the computer is a Mac, whose ⌘ is the deep key and whose Ctrl with a click is the right-click. */
  onMac: () => boolean
  /** Ends the core when it aborts: every listener is let go and all the core made is freed. */
  signal: AbortSignal
  options: CoreOptions
  /** The tab's access; without it, the tab may always edit. */
  access?: TabAccess
  /** What the connection tells the person; without it, nothing. */
  linkNotices?: LinkNotices
  /** Where the tab's presence goes; without it, the tab sends none. */
  presence?: TabPresence
  /**
   * Runs a callback after a time in milliseconds, and gives what cancels it: the pause that ends a
   * typing step (C47), and placing an SVG checking again for a gesture to end. Without it, a typing
   * step ends only when typing stops or the tab is hidden, and an SVG read while a gesture runs is
   * not placed.
   */
  after?: (ms: number, run: () => void) => () => void
  /**
   * The screen's animation frames and the system's reduced motion, which the camera's glide to a
   * frame just added steps on; without them, the camera moves straight there.
   */
  motion?: Motion
  /** Makes the screen's display copies away from the main thread; without it they are made at once. */
  copyMaker?: CopyMaker
  /**
   * Draws the frames picking a colour reads, whole at 1x as the 1x export draws them, away from the
   * main thread (the export worker); without it they are drawn here.
   */
  sampler?: FrameSampler
  /** Whether the stage may show the hidden layers (`setHiddenShown`): unless told not to, as a version viewed is. */
  hiddenShowable?: boolean
}

/**
 * Something the page should say: why a gesture, a key or a paste did nothing, how placing an SVG
 * went, the pictures uploading (an SVG's and pasted images), the pasted files that weren't placed,
 * whether Copy as PNG put its picture on the clipboard, that the design leaves out layers it could
 * not read, that a change could not be applied because its command faulted, and why picking a
 * colour picked none: the frame's colours could not be read (in time), or the frame is too big to
 * draw. Then what the connection tells: a change set the server rejected (C36), a step too big to send put back (C39),
 * change sets lost to a server that no longer knew the tab (C43), the device copy stopped or not
 * kept (D9), a design near its limits (D11), that the tab may only view the design (C35), that it
 * came to only view it while a drag held changes not yet saved, which were put back, and that another
 * tab restored a version.
 */
export type Notice =
  | 'placedByLayout'
  | 'flowEnd'
  | 'refused'
  | 'svgLeftOut'
  | 'svgUnreadable'
  | 'uploading'
  | 'imagesNotPasted'
  | 'pngCopied'
  | 'pngNotCopied'
  | 'pasteNeedsFrame'
  | 'layersLeftOut'
  | 'notApplied'
  | 'rejected'
  | 'putBack'
  | 'queueLost'
  | 'deviceFull'
  | 'deviceCopyFailed'
  | 'noDeviceCopy'
  | 'nearLimit'
  | 'viewOnly'
  | 'nowViewOnly'
  | 'editingElsewhere'
  | 'pickFailed'
  | 'pickTooBig'
  | 'restored'

/**
 * Why a key did nothing to the selection, by the reason the menus grey its item with: Group and
 * Box's (`WrapState`) and the mask item's (`MaskWhy`). `locked` is also a box whose style is locked
 * against a layout key, and a layer locked in place among those the arrow keys would move in a flow.
 */
export type Refusal = Exclude<WrapState, 'ready' | 'none'> | MaskWhy

/** What a notice tells the page besides itself, by notice; the rest tell nothing more. */
export interface NoticeDetails {
  /** The layout of the box whose flow places the layers the notice is about. */
  placedByLayout: { layout: AutoLayout['direction'] }
  flowEnd: { layout: AutoLayout['direction'] }
  /** Why the key did nothing. */
  refused: { why: Refusal }
  /** The parts the SVG had that no layer shows, and how many of its pictures didn't upload, when any. */
  svgLeftOut: { parts: readonly Skipped[]; notUploaded?: number }
  /** The names of the pictures uploading now, of SVG files and pasted images; none once they all have. */
  uploading: { names: readonly string[] }
  /** The names of the pasted files that weren't placed: no PNG, JPEG or WebP the editor can draw, or they didn't upload. */
  imagesNotPasted: { names: readonly string[] }
  /** Why Copy as PNG put nothing on the clipboard: the picture is too big for an export, it failed to draw, or the browser refused the write. */
  pngNotCopied: { why: 'tooBig' | 'failed' | 'refused' }
  /** How many layers the design leaves out. */
  layersLeftOut: { layers: number }
  /** What the change set was, and why the server rejected it; no reason when the tab learned it on reconnecting. */
  rejected: { kind: ChangeSetKind; reason?: RejectReason }
  /** How many change sets were lost. */
  queueLost: { changeSets: number }
  /** The name of the step put back; null for a step with none. */
  putBack: { step: StepName | null }
  /** Who restored, by their member's name, and which version. */
  restored: { by: string; mark: RestoreMark }
  /** The largest share of a design limit the design holds, from 0.8 up. */
  nearLimit: { share: number }
  /** The name of another tab's person typing in the text this tab starts editing (C47). */
  editingElsewhere: { name: string }
}

/** A notice as the page is told it, with what it tells besides itself; `N` narrows it to some notices. */
export type NoticeDetail<N extends Notice = Notice> = {
  [K in N]: K extends keyof NoticeDetails ? [notice: K, detail: NoticeDetails[K]] : [notice: K]
}[N]

/**
 * What the texts of frames to export won't draw as designed: the families the catalog has no file
 * for, drawn in the fallback fonts instead, and each character no font has, with the names of the
 * texts it is in.
 */
export interface FontCheck {
  families: string[]
  characters: { text: string; layers: string[] }[]
}

/** What one redraw did, for the checks that count a redraw's work. */
export interface DrawInfo {
  /** Time spent drawing, from reading the design to submitting the frame. */
  ms: number
  /** Frames drawn; the rest were out of view and skipped. */
  drawn: number
  frames: number
  /** Frames whose picture was recorded again because they changed. */
  recorded: number
  /** Outline paths made for the overlay: one for each outlined layer that changed, none for a pan or a zoom. */
  outlined: number
}

/** The editor's side of the pointer and the keys: what takes the inputs, and tells the cursor. */
export interface EditorInput {
  /** Takes one pointer input. */
  pointer(e: PointerInput): PointerAnswer
  /** Takes one key input. */
  key(e: KeyInput): KeyAnswer
  /**
   * Types text into the text being edited over its selected range, as a paste of it; false while
   * none is. The stage field sends what it takes in through `fieldChanged` instead.
   */
  text(text: string): boolean
  /**
   * Deletes back from the caret as Backspace does, for a delete that came with no key (an input
   * method's, a phone keyboard's); false while no text is edited, or with nothing before the caret.
   */
  deleteBackward(): boolean
  /**
   * What the stage field holds for the text being edited: its selected range alone (nothing at a
   * caret, or for a range over 4,000 UTF-16 units), with its selection; null while none is edited.
   */
  fieldText(): FieldState | null
  /**
   * The stage field's value and selection changed to `state`. While an input method composes,
   * `composing` is the input event's data, and the change is drawn as a composition and written
   * nowhere; with null it is written in the typing step, a composition's commit too. False while no
   * text is edited.
   */
  fieldChanged(state: FieldState, composing: string | null): boolean
  /**
   * Escape while a colour is picked ends picking, and while a drag is held drops it. Returns whether
   * there was either, whose key it then is and nothing else's.
   */
  cancelOnEscape(e: KeyInput): boolean
  /** The window lost the focus. */
  blur(): void
  /** The tab was hidden: the typing step open now ends (C47). */
  hidden(): void
  /** The cursor the stage shows now, as CSS names it. */
  cursor(): string
  /** Adds a listener told the cursor each time it changes; returns the function that stops it. */
  onCursor(listener: (cursor: string) => void): () => void
}

/** The editor's side of the clipboard: what a copy and a cut give, and what takes a paste. */
export interface EditorClipboard {
  /** What a copy puts on the clipboard, or null with nothing to copy. */
  copy(): ClipboardPayload | null
  /** Cuts, and gives what the cut puts on the clipboard, or null with nothing to cut. */
  cut(): ClipboardPayload | null
  /** Pastes what the clipboard brings. Returns at once whether the editor took it, so the browser does nothing more with it. */
  paste(payload: ClipboardPayload): boolean
  /** The selected layers as a menu's Copy copies them, or null with nothing copied. */
  copyLayers(): ClipboardPayload | null
}

/**
 * What the open core and the open editor both are: each member that means the same without the
 * page and with it. A member that takes or gives a point is not here: the core's is a stage point
 * and the editor's a point in client coordinates, so each declares its own.
 */
export interface EditorBase {
  session: PageSession
  store: DesignStore
  /** Whether the tab may only view the design (a Reviewer's, C35, or one whose link ended). */
  readOnly: () => boolean
  /** Adds a listener told when the tab's access may have changed; returns the function that stops it. */
  onAccess: (listener: () => void) => () => void
  /** Tells the page View only (once, as a refused edit does), for an edit the page itself turns away, such as a drop. */
  tellViewOnly: () => void
  /** The design as the document holds it now, which can be ahead of the last redraw. */
  design: () => Design
  /** The first selected layer, or null. */
  selected: () => string | null
  /** Every selected layer, in the order they were picked. */
  selection: () => string[]
  /** The frame of the first selected layer, by its id, where the selection's box and handles go; null with none. */
  selectedFrame: () => string | null
  /**
   * Selects layers in the frames of the first one's page, leaving out any on other pages, and shows
   * that page first when another is shown; none clears the selection.
   */
  select(ids: string[]): void
  /**
   * Shift and a click on a layer of the shown page from outside the stage, as the layers panel's
   * rows take it: a selected layer is taken out; a layer of a frame that holds a selected one, or a
   * linked copy of a selected one, is added; any other is selected alone.
   */
  toggleSelected(id: string): void
  /** Does what a shortcut does, as if its key was pressed on the stage. */
  perform: (action: StageAction) => boolean
  /**
   * Whether an action of the shortcut table can run now: in a tab that may only view, only one that
   * views (`viewAction`); else whether running it now, by `perform` or for copy, cut and paste by
   * the clipboard, changes the design, the selection, the picked frame, the camera, the tool, the
   * rulers or the remembered values. It reads the rules the actions run by and runs nothing.
   */
  actionReady: (action: ShortcutAction) => boolean
  /**
   * What Ungroup would do for the selection: `ready`, `none` with no group or box selected, or why
   * none can come apart, `locked` (each is locked against deleting), `maskLocked` (a mask it
   * would free has its style locked) or `placedByLayout` (an auto layout box would place what it
   * holds elsewhere). It tries the ungroup on a copy of the design,
   * so a menu asks once as it opens.
   */
  ungroupState: () => UngroupState
  /**
   * What Group and the Box action would do for the selection: `ready`, `none` with nothing
   * selected, or why they can't, `apart` (a frame's layers are in different boxes or groups) or
   * `locked` (one is locked in place).
   */
  wrapState: () => WrapState
  /**
   * Sets each selected box's layout as one undo step: Free, a row or column read off its layers
   * (`auto`), or the row, column or grid named. A laid-out box fits what it holds both ways; going
   * Free keeps every layer, and the box, where they are drawn. Gives what it did (`SetLayout`).
   */
  setLayout: (layout: BoxLayout) => SetLayout
  /**
   * What the Full menu's mask item shows for the selection: Use as mask or Release mask, with why
   * it is greyed, or null when it is left out (nothing selected, or a layer inside a boolean).
   * `perform('mask')` runs it, and does nothing while it is greyed.
   */
  maskState: () => MaskState
  /** Whether this tab has a change of its own to undo, or an undone one to redo. */
  canUndo: () => boolean
  canRedo: () => boolean
  /** The name of the step undo would revert, or redo bring back; null with none. */
  undoName: () => StepName | null
  redoName: () => StepName | null
  /** Calls back whenever what undo or redo would do may have changed. */
  onHistory: (listener: () => void) => () => void
  /** Whether Paste in a menu has layers to place: the ones last copied in Dazbee on this device. */
  canPasteLayers: () => boolean
  /** Pastes the layers last copied in Dazbee on this device, as Mod+V does; false with none kept. */
  pasteLayers(): boolean
  /**
   * What the full menu's style and linked-copy items would do for the selection now (Copy style,
   * Paste style, Copy to other frames, and lock, hide and delete in all frames), or why one has
   * nothing to do; null with nothing selected. `perform` does each, as one undo step.
   */
  linkedMenu(): LinkedMenu | null
  /**
   * Moves a layer to the top level of its frame or into a container there, before a sibling or on
   * top (#59), as one undo step; groups it leaves and enters fit what they hold again. False when the
   * move isn't allowed, such as into itself, into another frame or into a layer that can't hold it.
   */
  moveLayer(id: string, parentId: string, before?: string): boolean
  /**
   * Starts one undo step for the properties panel's scrubbing (#60): every change until the
   * returned function is called is undone together.
   */
  beginGesture: () => () => void
  /** Whether a gesture is running: a drag, resize or turn on the stage, a scrub in the panels, or text being typed. */
  gesturing: () => boolean
  /**
   * Sets properties of layers as the properties panel does, as one undo step, or as part of the
   * gesture open. `to` gives a layer's patch from its props as drawn (`drawnPropsOf`); null leaves
   * it be. A place it gives is stored where it is drawn there, and a side it gives a width or
   * height of becomes Fixed, as a resize makes it. The change stays on these layers:
   * their linked copies in other frames keep their own values. X and Y of a group or box carry what
   * it holds along; groups fit what they hold again. A fill, text colour or font set by hand no
   * longer follows the brand. False when a change isn't allowed, such as on a locked layer.
   */
  setProps(
    ids: string[],
    to: (id: string, props: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
  ): boolean
  /**
   * Sets how sides of layers size, Fixed, Fit content or Fill, as one undo step, a text's box mode
   * kept in step. Fill along the flow of a box that fits its content fixes that box there at the
   * size it is drawn, in the same step. False when a change isn't allowed.
   */
  setSizing(ids: string[], to: Partial<Record<Axis, Sizing>>): boolean
  /**
   * Sets the corner radius of the layers that have one, a box, a rectangle, a polygon or a star, as
   * one undo step: every corner at the radius `to` works out from the one each layer shows, or with
   * `corner`, from the top left clockwise as drawn (a flipped layer's mirrored), only that corner of a
   * box or a rectangle. A radius is never below 0 and is kept to hundredths. The linked copies keep theirs. False when a layer isn't
   * allowed the change, such as one with its style locked; the others still take it.
   */
  setRadius(ids: string[], to: (radius: number) => number, corner?: number): boolean
  /** Renames a layer (#59), as one undo step; false for an empty name. */
  renameLayer: (id: string, name: string) => boolean
  /** The shown page's texts holding a string, whatever its case, frame by frame, and how many matches they hold. */
  findText: (find: string) => FoundText
  /** Selects the shown page's texts holding a string, whatever its case, ending typing first; gives how many. */
  selectFound: (find: string) => number
  /**
   * Replaces every match of `find`, whatever its case, in the shown page's texts not locked against
   * content changes, as one undo step, fitting each to its words, and selects them; gives how many
   * texts changed.
   */
  replaceText: (find: string, replace: string) => number
  /** Locks layers completely, or unlocks them (#59), as one undo step. */
  setLocked: (ids: string[], locked: boolean) => boolean
  /** Hides layers, or shows them (#59), as one undo step, like the Hide shortcut: their linked copies stay as they are. */
  setHidden(ids: string[], hidden: boolean): boolean
  /** Calls back with what the editor tells the person, such as a nudge auto layout decides. */
  onNotice(listener: (...told: NoticeDetail) => void): () => boolean
  /** Selects a layer picked from the list `layersAt` gives, as the layers panel would, going into the group it is in. */
  pickLayer(layer: { id: string; frameId: string }): void
  /** Whether a gesture is running or Alt shows a measure: when the bar by the selection keeps out of the way. */
  busy: () => boolean
  /** The text layer being edited and its selected range, when one is selected; what the bar and cards then style. */
  textSelection: () => { id: string; range: TextRange } | null
  /** Each character's style in the selected range of the text being edited, or null with no range. */
  textSelectionStyles(): TextStyle[] | null
  /** Styles the selected range of the text being edited, as one undo step; false with no range. */
  styleTextSelection: (style: RunStyle) => boolean
  /** Calls back when the text being edited, or its selected range, changes. */
  onTextSelection(listener: () => void): () => boolean
  /**
   * Bold, italic, underline and strikethrough for what their keys and `perform` act on now: on, off
   * or mixed, and whether the toggle can write (Bold can't where a family has no weight for it).
   * Null with no text to act on: no range selected while typing, no text being edited, and no text
   * layer selected.
   */
  textStyles(): TextStyleState | null
  /**
   * The OpenType features a family has, each of its files having them, as its font files say; null
   * until the editor has its files.
   */
  fontFeatures(family: string): ReadonlySet<string> | null
  /**
   * Calls back when font files arrive, so what reads the faces a family has (`textStyles`) or its
   * features (`fontFeatures`) can read again.
   */
  onFontsArrive(listener: () => void): () => boolean
  /** Calls back with the selected layers whenever the selection changes. */
  onSelection(listener: (ids: string[]) => void): () => boolean
  /**
   * The frame picked as a whole, by a click on its label or its empty area, or null; no layer is
   * selected while one is. Esc, a layer selected or a click on empty canvas lets it go.
   */
  pickedFrame: () => string | null
  /**
   * Picks a frame of the shown page as a press on its label does, letting the selection go; null,
   * or a frame not on the shown page, lets the picked one go.
   */
  pickFrame: (frameId: string | null) => void
  /**
   * Calls back with the picked frame, or null, whenever it changes, and each time the picked frame
   * is picked again, as by another click on its label.
   */
  onFramePick(listener: (frameId: string | null) => void): () => boolean
  /**
   * Lights a frame of the shown page from outside the stage, outlined as a layer under the pointer
   * is and its label lit, as a list's row does while it is hovered or focused; null lets it go.
   */
  lightFrame(frameId: string | null): void
  /**
   * Lights a layer of the shown page from outside the stage, outlined as a layer under the pointer
   * is, as a layers panel row does while it is hovered; null lets it go.
   */
  lightLayer(layer: { id: string; frameId: string } | null): void
  /**
   * Asks for the selected layers' constraint lines on the stage, as Arrange does while
   * it shows their constraints, or for none with false: dashed lines from each layer's sides to its
   * parent's sides it keeps to, and a short bar through a layer kept to the centre, drawn while
   * the rule reads constraints for every selected layer.
   */
  showConstraints(shown: boolean): void
  /**
   * Picks a frame of the shown page and asks the page to rename it in place, as a double click on
   * its label does, panning first, at the same zoom, so the label shows beside the chrome; the page
   * renames it with the `frame.update` command and calls `renamed` once its field closes, the label
   * left out until then. Does nothing for a frame not on the shown page.
   */
  renameFrame(frameId: string): void
  /** Calls back with the frame to rename in place: its label was double-clicked, or `renameFrame` asked. */
  onFrameRename(listener: (frameId: string) => void): () => boolean
  /** The page's rename field has closed: the frame's label shows again. */
  renamed(): void
  /** Calls back with a frame's name once Delete, by its key or `perform('delete')`, deleted it as the picked frame. */
  onFrameDelete(listener: (name: string) => void): () => boolean
  /**
   * Adds an empty white frame of a size to the shown page, under the name given (a size tile's,
   * so a TikTok video tile makes "TikTok video") or else named after the size (`frameName`), where
   * the frame rule puts it, as one undo step. It is picked and shown whole with its label beside the
   * chrome, panned at the same zoom when it fits and zoomed out only as far as it needs when it
   * doesn't; the select tool comes back. Returns its id, or null with nothing changed for a size
   * past the limits.
   */
  addFrame(size: { width: number; height: number }, name?: string): string | null
  /**
   * Add size: a frame of a size holding linked copies of a frame's layers, scaled to it and placed
   * by their constraints, guessed where they have none, each text the placing made wider or narrower
   * fitted to its words, under its name, where the frame rule puts it, as one undo step, then picked
   * and shown as `addFrame` does.
   * Returns its id, or null with nothing changed for a frame gone or a size past the limits.
   */
  addSize(frameId: string, size: { width: number; height: number }): string | null
  /**
   * Resizes a frame from its top left, its layers following their constraints, each text whose width
   * that changed fitted to its words, as one undo step called `resize`. Returns whether it did; false,
   * with nothing changed, for a frame gone or a size past the limits or not whole.
   */
  resizeFrame(frameId: string, size: { width: number; height: number }): boolean
  /** Whether the rulers along the stage's edges show. */
  rulers: () => boolean
  /**
   * The safe zones shown: on each 9:16 frame, the bands the named platform's interface covers, every
   * platform's together for `ALL_PLATFORMS`, or none for null. Never drawn in an export.
   */
  safeZones: () => SafeZoneChoice | null
  /** Shows a platform's safe zones by its name in `SAFE_ZONES`, all together or none; none in a new tab, and nothing keeps it. */
  setSafeZones(platform: SafeZoneChoice | null): void
  /**
   * Whether the stage draws the design's hidden layers, in every frame of every page, faded, where a
   * click or a marquee selects them. Only this tab sees them: no export, picture or other tab draws
   * them, and they stay hidden.
   */
  hiddenShown: () => boolean
  /** Shows the hidden layers on the stage or stops; off in a new tab, nothing keeps it, and it writes nothing. */
  setHiddenShown(on: boolean): void
  /** Whether a drag snaps to layers and the frame. */
  snapping: () => boolean
  /**
   * Snapping's work since the editor opened, for the checks that count it: `gathered` drags
   * worked out what they can snap to, `moves` pointer moves of a drag snapped, and the last
   * drag gathered `targets` boxes, each move measured against all of them.
   */
  snapWork: () => { gathered: number; moves: number; targets: number }
  /** Turns snapping on or off for every drag. */
  setSnapping(on: boolean): void
  /** Calls back whenever the rulers, snapping or the hidden layers turn on or off, or other safe zones show. */
  onView(listener: () => void): () => boolean
  /** The shown page's frames as last drawn, by order, each at its stored place. */
  frames: () => Frame[]
  /** The id of the shown page's frame in the middle of the view, or null when none is there. */
  middleFrame: () => string | null
  /** The page the canvas shows: the first page when the editor opens, and when the shown page is deleted. */
  shownPage: () => string
  /**
   * Shows a page, its frames fitted; the first page for one the design lacks. A selection, crop,
   * path edit, pen path or typing on another page and the picked frame let go.
   */
  showPage(pageId: string): void
  /**
   * Restores a version (`readVersion` reads it): what is open on the stage ends as before Undo,
   * the design becomes the version's pages, frames and layers, its own name kept, as one undo step
   * the other tabs are told of; the selection lets go, and `page` is shown when the version has it,
   * else the page shown when the version has it, else the version's first. `tooBig` when its
   * change set was past a change set's limits: put back, nothing sent, the page told `putBack`.
   * Undefined in a tab that may only view, which writes nothing (C35).
   */
  restoreVersion(design: Design, mark: RestoreMark, page?: string): Promise<Restored | undefined>
  camera: () => Camera
  viewport: () => Viewport
  setCamera: (next: Camera) => void
  /**
   * Glides, as the view does to a frame just added, so a part of the stage, in stage pixels as the
   * editor's `selectionRect` gives it, shows whole clear of the chrome and of `cover`, the
   * stage's edges a sheet over it covers: nothing when it shows already. With `zoomOut` false the
   * zoom stays, and a part too big for the room shows from its top.
   */
  showOnStage(rect: Rect, cover: Partial<Insets>, zoomOut: boolean): void
  /** The stage's edges floating chrome covers, in screen pixels; later fits keep clear of them. */
  setInsets(next: Insets): void
  zoomTo: (zoom: number, at?: Point) => void
  zoomIn: () => void
  zoomOut: () => void
  fitAll: () => void
  fitSelection: () => void
  /** Fits a frame in view, showing its page first when another is shown. Throws for a frame the design lacks. */
  fitFrame(frameId: string): void
  setTool: (next: Tool) => void
  tool: () => Tool
  /**
   * Arms an image from Assets: the image tool takes it, and its next click on a frame places it, a
   * drag there draws it, and the select tool comes back. Null disarms it and puts the select tool
   * back; another tool, Escape and a press off every frame disarm it too.
   */
  armImage(asset: PlacedAsset | null): void
  /** Whether the image tool has an image to place. */
  imageArmed: () => boolean
  /** Calls back with the tool whenever it changes, by a key or after drawing a shape. */
  onTool(listener: (tool: Tool) => void): () => boolean
  /** A layer's box as drawn in its frame, in design pixels, auto layout solved; null for a layer in no frame. */
  boxOf(id: string): Rect | null
  /**
   * A layer's properties as drawn: its x, y, width and height where auto layout places and sizes it
   * inside its containers, unturned by them as its own are kept.
   */
  drawnPropsOf(id: string): Readonly<Record<string, unknown>>
  /**
   * Resolves once the fonts and images the design has asked for so far are here or failed to
   * come. One arriving drops every frame's picture, so the next redraw records them again.
   */
  loaded: () => Promise<undefined>
  onDraw(listener: (design: Design, at: number, info: DrawInfo) => void): () => boolean
  /**
   * Calls back whenever what the stage shows changed: at each redraw, and when only what is drawn
   * over the canvas changes, as the hover and what Alt measures do on a pointer move.
   */
  onShown(listener: () => void): () => boolean
  /**
   * The export render of a frame, as this tab holds it now, on the CPU surface, as RGBA; the shown
   * page's first frame by default. A frame on another page needs its images loaded first (shown, or
   * its page exported); it throws for one whose images are not here.
   */
  exportPixels(frameId?: string): Uint8Array
  /** The families whose files the editor has, shipped ones included (#50). */
  loadedFamilies: () => string[]
  /**
   * What the texts of these frames, on any page, won't draw as designed in an export, once the
   * fonts they name have come or failed to; a family whose load failed is not listed.
   */
  fontCheck(frameIds: readonly string[]): Promise<FontCheck>
  /**
   * Sets the font of the selected text layers, or of the selected range of the text being edited,
   * as one undo step: the family, and the weight when one is given. It waits for the family's files
   * first, so text that grows the size of its words is measured in it and fits its box in the same step.
   */
  setFont(fontFamily: string, fontWeight?: number): Promise<void>
  /** The brand kit's values bound properties take now (#53). */
  variables: () => Variables
  /**
   * Gives bound properties new values, as when the brand kit changes: bound layers redraw with them,
   * the families of brand fonts load, and exports use them. Text bound to a brand font whose family
   * changed takes the new one and refits once its files are here, a change no one undoes; the
   * promise settles then.
   */
  setVariables(variables: Variables): Promise<void>
  /**
   * Binds the selected layers to a brand colour, font or logo, or unbinds them with null, in one
   * undo step. A colour binds a text layer's colour and any other layer's fill; a font binds
   * text only; the logo binds the picture of a graphic or box that shows one. Returns how many
   * layers changed.
   */
  bindSelection(kind: ValueKind, ref: VariableRef | null): number
  /**
   * Starts picking a colour from the design, ending any picking on: the next click on the stage, or
   * a finger lifted there, picks the colour of the design pixel under it as the 1x export draws it,
   * and picking ends. It resolves with `#RRGGBB`, or null when picking ends with none (Esc,
   * `stopPicking`, another start, the colours unread or a Reviewer's tab). It writes nothing.
   */
  pickColour(): Promise<string | null>
  /** Ends picking a colour with none picked. */
  stopPicking(): void
  /** Whether a colour is being picked. */
  picking: () => boolean
  /** Calls back with whether a colour is being picked, as picking starts and ends. */
  onPicking(listener: (picking: boolean) => void): () => boolean
  /** Ends typing into a text layer, if one is being typed into, closing its undo step. */
  stopEditing: () => void
  /**
   * Ends what stays open on the stage until a key ends it, closing its undo step: typing, and a
   * pen path, which keeps the anchors placed so far, as Enter does.
   */
  settle(): void
  /** Whether it has ended: the signal the core was opened with has aborted, which the editor's `destroy` does. */
  destroyed: () => boolean
  /**
   * Resolves once no gesture is open on the stage, so what is placed next is an undo step of its
   * own: typing ends at once, a pen path after 3 seconds as Enter ends it, and a drag or a panel's
   * scrub is waited for. False once the editor has ended.
   */
  whenSettled(): Promise<boolean>
  /**
   * Places an SVG file `readSvg` read, as a group of its layers, in one undo step, selected, and
   * tells what no layer shows. Undo leaves its uploaded pictures in the library. Returns the
   * group's id, or null when it placed nothing: a drag is held on the stage, whose undo step it
   * would join, the frame it was read for is gone or not on the shown page, or the editor has
   * ended. A caller placing one file uses `placeWhenSettled`.
   */
  placeSvg(read: SvgRead): string | null
  /** Places an SVG file `readSvg` read once `whenSettled` resolves, as `placeSvg` does; null when it placed nothing. */
  placeWhenSettled(read: SvgRead): Promise<string | null>
  /**
   * Puts an image into a layer as its fill, as one undo step: in place of its topmost image fill
   * (keeping its fit, adjustments and filter, the crop reset), or on top of its fills when it has
   * none; a fill bound to a brand colour stays bound. Its linked copies keep their own fills. The
   * layer is selected in its frame. False when it can't take one, such as a layer whose style is
   * locked.
   */
  fillWithImage(id: string, asset: PlacedAsset): boolean
  /** A picture of a page's first frame, shown or not, `size` pixels on its longer side, for the Pages card. Null for a page with no frames. */
  pageThumbnail(pageId: string, size?: number): string | null
  /**
   * A small picture of a layer for the effect tiles and the layers panel: drawn by the renderer
   * without the layer's own effects, in its own frame, and kept until the layer or what it is
   * drawn with changes. Text is "Aa" in its look, outlined with no fill when asked. A PNG object
   * URL, or null.
   */
  layerThumbnail(id: string, size?: number, outlined?: boolean): string | null
}

/**
 * The open core: the editor without the page. Beside the base's members it has the ones that take
 * or give a point, each a stage point, and what the page's side is built on.
 */
export interface EditorCore extends EditorBase {
  /**
   * Picks what a right-click at a stage point acts on: the selection when the point is on it, else
   * the layer there, selected, locked or not. Returns the selected layers, none when the point is
   * on no layer.
   */
  selectAt(stage: Point): string[]
  /**
   * Every layer that shows at a stage point, front-most first, each before the layers it holds
   * there with how deep it is, locked ones too: what the right-click's Select layer lists. None off
   * every frame.
   */
  layersAt(stage: Point): LayerAt[]
  /**
   * Places an image asset as a graphic filled with it (#52), in one undo step: centred on `where`,
   * a spot or a stage point, or else in the middle of the frame in the middle of the view. The
   * image's bytes load in the background. As the brand's logo (`logo`), it has the role logo and its
   * picture follows the brand's. Returns the new layer's id, or null when the point is on no frame.
   */
  placeImage(asset: PlacedAsset, where?: Point | Spot, options?: PlaceImageOptions): string | null
  /**
   * Reads an SVG file to place with `placeSvg`, centred on `where`, a spot or a stage point, or else
   * in the middle of the frame in view: the spot first, then the file, scaled down to 60% of the
   * frame's shorter side when larger, and its pictures uploaded with `uploadImage`, 4 at a time,
   * the page told while they upload. A picture that didn't upload is left out and told once placed.
   * Null when there is no frame, or the file can't be read, which is told.
   */
  readSvg(text: string, name: string, where?: Point | Spot): Promise<SvgRead | null>
  /** The spot under a stage point: the frame there and the point in it. Null off every frame. */
  spotAt(stage: Point): Spot | null
  /**
   * Outlines the layer an image dragged over a stage point would go into, or clears the outline
   * with null. Returns that layer's id, or null where a drop makes a new layer.
   */
  imageTarget(stage: Point | null): string | null
  /** Where a design pixel of a frame of the shown page is on the stage now; its first frame by default. */
  stagePoint(x: number, y: number, frameId?: string): Point
  /** The pointer and the keys: what takes the inputs, and tells the cursor. */
  input: EditorInput
  /** The clipboard: what a copy and a cut give, and what takes a paste. */
  clipboard: EditorClipboard
  /** Sets the stage's size, in CSS pixels, and the screen's pixels for each; it asks for no redraw. */
  setViewport(next: Viewport & { dpr: number }): void
  /**
   * Runs the redraw pass, handing the pictures to `paint` when there is one. Returns what it did,
   * which the draw listeners hear too; null, the pass stopped there, when `paint` answered false.
   */
  redraw(paint?: Paint): DrawInfo | null
}
