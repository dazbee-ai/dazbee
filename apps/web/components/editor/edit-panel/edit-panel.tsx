'use client'

// The edit panel, floating at the stage's end side under the top islands, only as tall as what it
// holds and scrolling past the room above the bottom controls; on a stage narrower than
// EDIT_SHEET_WIDTH, a phone's or a tablet's, a sheet at the bottom, low or full (`sheet-heights.ts`), which the stage
// keeps the selection clear of (`sheet-clear.ts`). It opens with the selection or the picked frame:
// its header, its switcher while it has two switcher tabs or more, and the shown switcher tab's
// sections, scrolled to the top for each new selection. It never takes the focus as it opens and
// leaves Esc to the stage, which deselects; F6 moves the focus into it and back to the stage. The
// font chooser or a design card takes its place, on a phone as a sheet at the bottom; that one
// closes on ✕, Esc, another selection or a pop-up opening, and gives the focus back to what opened
// it when closed from inside it.
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

import type { Editor } from '@dazbee/editor'
import { composingKey, inField, stageHasKeys } from '@dazbee/editor/dom-input'

import { useFontCatalog } from '@/components/brand-kit/font-catalog.ts'
import { LineUpSection, OrderSection, PositionSection } from '@/components/editor/edit-panel/arrange/arrange.tsx'
import { WrapInSection } from '@/components/editor/edit-panel/arrange/wrap-in.tsx'
import { BackgroundSection } from '@/components/editor/edit-panel/frame/background.tsx'
import { FrameMore } from '@/components/editor/edit-panel/frame/frame-more.tsx'
import { FramePositionSection } from '@/components/editor/edit-panel/frame/position.tsx'
import type { FrameSectionProps } from '@/components/editor/edit-panel/frame/types.ts'
import { EditSection, FitSection, PhotoSection } from '@/components/editor/edit-panel/image-tab/image-tab.tsx'
import { PANEL_HEADER_ID, PanelHeader } from '@/components/editor/edit-panel/tabs/panel-header.tsx'
import { STYLE_SECTION_PARTS } from '@/components/editor/edit-panel/tabs/style-sections.tsx'
import { Switcher, SWITCHER_PANEL_ID, switcherTabId } from '@/components/editor/edit-panel/tabs/switcher.tsx'
import {
  framePanelOf,
  type FrameSectionId,
  headedSections,
  type PanelLayout,
  panelOf,
  type Section,
  type SectionProps,
  showsSwitcher,
} from '@/components/editor/edit-panel/tabs/tabs.ts'
import {
  FeaturesSection,
  FontSection,
  ParagraphSection,
  SpacingSection,
} from '@/components/editor/edit-panel/text-tab/text-tab.tsx'
import {
  asPanelGoes,
  FONT_CHOOSER,
  isSheet,
  onF6,
  overPanel,
  type PanelFocus,
  panelFor,
  type PanelId,
  pickSwitcherTab,
  selectionPanelShows,
  setOpen,
  shownSwitcherTab,
  useEditState,
  useSelectionFollower,
} from '@/components/editor/edit-store.ts'
import { usePickedFrame, useSelection } from '@/components/editor/editor-hooks.ts'
import { FontChooser } from '@/components/editor/fonts/font-chooser.tsx'
import { EDIT_PANEL_INSET, EDIT_PANEL_WIDTH } from '@/components/editor/stage-insets.ts'
import { UNDER_TOOL_TRAY } from '@/components/editor/styles.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly, ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { ArrowLeftIcon, XIcon } from '@/components/ui/icons.tsx'
import { TOUCH_SQUARE } from '@/components/ui/looks.ts'
import { inPopUp } from '@/components/ui/menu-close.ts'
import { useOverlayScroll } from '@/components/ui/overlay-scroll.ts'
import { useScrollEdges } from '@/components/ui/scroll-edges.ts'
import { useSheet } from '@/components/ui/sheet-top.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format, type Messages } from '@/lib/i18n/index.ts'
import { usePhone } from '@/lib/phone.ts'

import { LayoutSection } from './layout-section.tsx'
import { typingIn } from './number-field.tsx'
import { CombineSection, CombineShapesSection, ShapeSection } from './shape-sections.tsx'
import { FRAME_SHEET, SheetHandle, useSelectionSheet, useSheetStart } from './sheet.tsx'
import { usePressWatch, useSheetClear } from './sheet-clear.ts'
import { useEditSheet } from './sheet-heights.ts'
import { factsOf, kindOf, type PanelProps, type Target, useTarget } from './target.ts'

/** What each section of a switcher tab holds for the selection, by the section's id. */
const SECTIONS: Record<Section['id'], (props: SectionProps) => ReactNode> = {
  font: FontSection,
  paragraph: ParagraphSection,
  spacing: SpacingSection,
  features: FeaturesSection,
  position: PositionSection,
  order: OrderSection,
  'line-up': LineUpSection,
  'wrap-in': WrapInSection,
  shape: ShapeSection,
  combine: CombineSection,
  'combine-shapes': CombineShapesSection,
  layout: LayoutSection,
  photo: PhotoSection,
  fit: FitSection,
  edit: EditSection,
  ...STYLE_SECTION_PARTS,
}
/** What each section of a switcher tab holds for the picked frame, by the section's id. */
const FRAME_SECTIONS: Record<FrameSectionId, (props: FrameSectionProps) => ReactNode> = {
  background: BackgroundSection,
  'frame-position': FramePositionSection,
}

/** The edit panel's card: its glass, over the stage. */
const CARD = 'pop-in absolute z-20 flex flex-col overflow-hidden surface-frost outline-none'
/**
 * The card at the stage's end side, EDIT_PANEL_INSET in, only as tall as what it holds, clear of the
 * zoom pill below it, and below 1280 px of Pages over the zoom pill, or of the two over the dock.
 */
const SIDE_CARD = cn(
  'end-(--edit-panel-inset) w-(--edit-panel-width) rounded-[16px]',
  'max-h-[calc(100%-var(--panel-top)-4.5rem)] sm:max-xl:max-h-[calc(100%-var(--panel-top)-var(--above-corner))]',
)
/** A card in the edit panel's place: at the side, and on a phone across the screen. */
const PANEL_CARD = cn(CARD, SIDE_CARD, 'max-sm:inset-x-2 max-sm:end-2 max-sm:w-auto max-sm:rounded-[22px]')
/** The card's body, which scrolls: a field scrolled into view stops above the faded edge, past its 28 px. */
const PANEL_BODY =
  'flex min-h-0 scroll-pb-[28px] flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 [&>*]:shrink-0'
/** The card's body holding one part that fills it and scrolls inside, as the font chooser's list does. */
const FILLED_BODY = 'overflow-hidden [&>*]:min-h-0 [&>*]:shrink'
/** The body's end fading out while there is more to scroll to. */
const FADED_END = '[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]'

/** The controls the focus can go to: those turned off, by themselves or by a fieldset, left out. */
const CONTROLS =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** The item that opened panel `id`: the one that had the focus as it opened, else the first that opens it. */
const openerOf = (id: PanelId, opener: Element | null) =>
  opener instanceof HTMLElement && opener.isConnected && opener.dataset.opens === id
    ? opener
    : document.querySelector<HTMLElement>(`[data-opens="${id}"]`)

/** What the selected layers are called: the layer's name, or how many layers. */
const layersName = (target: Target, p: Messages['editor']['props']) =>
  target.ids.length > 1 ? format(p.layers, { n: target.ids.length }) : target.names[0] || p.layer

/**
 * The card's place: `top` down the stage but at the bottom as a sheet (`atBottom`), EDIT_PANEL_WIDTH
 * wide and EDIT_PANEL_INSET from the end edge.
 */
const cardStyle = (top: number, atBottom: boolean) =>
  ({
    // The panel is no control itself, so it shows no focus ring.
    outline: 'none',
    ...(atBottom ? {} : { top }),
    '--panel-top': `${top}px`,
    '--edit-panel-width': `${EDIT_PANEL_WIDTH}px`,
    '--edit-panel-inset': `${EDIT_PANEL_INSET}px`,
  }) as CSSProperties

/** The page's focus as the edit panel's rules read it, for the panel element `panel`. */
const focusOf = (panel: HTMLElement | null): PanelFocus => {
  const at = document.activeElement
  return {
    inPanel: panel?.contains(at) ?? false,
    toStage: () => (at instanceof HTMLElement ? at.blur() : undefined),
    toSwitcher: () => {
      const body = panel?.querySelector<HTMLElement>(`#${SWITCHER_PANEL_ID}`)
      const shown = panel?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      // With no switcher, the first control that is on, or the body itself while none is.
      const into = shown ?? body?.querySelector<HTMLElement>(CONTROLS) ?? body
      into?.focus()
    },
  }
}

/**
 * Closes the open panel; with `back`, the focus goes back to the item that opened it at once,
 * before the panel goes: later, it could take the focus from whatever the next click or key opened.
 * An item inside the edit panel, as the Text switcher tab's font or a picked frame's ⋯, shows again
 * only once the panel that took its place has gone, so the panel goes first then.
 */
function closePanel(id: PanelId, back: boolean, opener: Element | null = null) {
  const to = back ? openerOf(id, opener) : null
  if (to || !back) {
    to?.focus()
    setOpen(null)
    return
  }
  flushSync(() => setOpen(null))
  openerOf(id, null)?.focus()
}

/** How far down the stage the edit panel starts: EDIT_PANEL_INSET under the top islands, as from the end edge. */
function usePanelTop() {
  return useEditState().islandsBottom + EDIT_PANEL_INSET
}

/**
 * The edit panel's body, which scrolls, and how far it is scrolled: on a phone its scroll bar stays
 * shown while there is more to scroll to, as no pointer hovers to show it.
 */
function usePanelBody(phone: boolean) {
  const body = useRef<HTMLDivElement>(null)
  const bodyRef = useOverlayScroll(body, { shown: phone })
  const scroll = useScrollEdges(body)
  return { body, bodyRef, scroll }
}

/**
 * The edit panel, following the selection: open while layers are selected or a frame is picked,
 * unless the font chooser or a design card takes its place, which a change of selection closes.
 */
export function EditPanel({ editor, workspaceId, brandId }: { editor: Editor; workspaceId: string; brandId: string }) {
  const { open } = useEditState()
  const viewOnly = useViewOnly()
  const ids = useSelection(editor)
  const picked = usePickedFrame(editor)
  useSelectionFollower(ids, picked)
  usePressWatch()
  useSheetClear(editor, ids, useEditSheet())
  const selected = useTarget(editor, ids)
  const shows = panelFor(selected !== null, picked)
  if (shows === 'frame' && picked)
    return <FramePanel editor={editor} frameId={picked} workspaceId={workspaceId} brandId={brandId} />
  if (!selected) return null
  const { target, design } = selected
  if (open === FONT_CHOOSER)
    return <FontPanel target={target} design={design} workspaceId={workspaceId} brandId={brandId} />
  const facts = factsOf(target, design)
  const layout = panelOf({ kind: kindOf(target), facts, several: target.ids.length > 1, viewOnly })
  if (!selectionPanelShows(open, layout.switcherTabs.length > 0)) return null
  return <LayersPanel {...{ target, design, workspaceId, brandId, layout }} locked={facts.locked} />
}

/**
 * The edit panel's frame, for the font chooser and the design's own cards (Pages): its title, up to two
 * lines, a note and an action beside it, ✕, and a body that scrolls. It floats at the stage's end
 * side under the top islands, only as tall as what it holds; where the edit panel is a sheet, on
 * a phone or a tablet, so is it, but for Pages and Versions. Esc or ✕ closes it, and the focus goes back to the item that opened it when closed from
 * inside it. It takes the focus as it opens unless `focus` is false.
 */
export function PanelFrame({
  id,
  title,
  note,
  action,
  focus = true,
  back,
  fills = false,
  children,
}: {
  id: PanelId
  title: string
  note?: string
  action?: ReactNode
  /** Whether the panel takes the focus as it opens; false leaves it where it is, as on the stage. */
  focus?: boolean
  /** Whether what it holds fills the body and scrolls inside itself, the body not scrolling. */
  fills?: boolean
  /** The name of a back arrow before the title, which closes the panel in place of ✕. */
  back?: string
  children: ReactNode
}) {
  const t = useMessages()
  const phone = usePhone()
  // Where the edit panel is a sheet at the bottom, so is this, but Pages and Versions, which open
  // above a phone's tab bar, the bar still showing.
  const sheet = useEditSheet() && isSheet(id)
  const sheetStart = useSheetStart()
  const panel = useRef<HTMLElement>(null)
  // As a sheet its top edge is known, so what sits at the bottom start can stand above it.
  const sheetRef = useSheet(sheet)
  const panelRef = useCallback(
    (element: HTMLElement | null) => {
      panel.current = element
      sheetRef(element)
    },
    [sheetRef],
  )
  const { bodyRef, scroll } = usePanelBody(phone)
  // The focus goes back to what opened it: the Text switcher tab's font, a picked frame's ⋯, or Pages.
  const [opener] = useState(() => document.activeElement)
  const top = usePanelTop()
  // Esc closes the panel before it clears the selection, wherever the focus is. A number field with
  // something typed in it stands over the panel: it takes the key alone, throwing away what was
  // typed and keeping the focus, so the next Esc closes the panel. In another field of the panel
  // the field still takes the key and the panel closes with it; the focus goes back to the item
  // that opened it once the field has let it go. A field outside the panel, as the design's name,
  // stands over it: it takes the key alone, throwing away what was typed, and the
  // focus leaves it, so the next Esc closes the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // An input method's Escape cancels what it composes.
      if (event.key !== 'Escape' || event.defaultPrevented || composingKey(event)) return
      // What stands over the panel, as Keyboard shortcuts or the Share menu, closes first, on its own
      // Esc; so does a greyed control's tooltip saying why.
      if (overPanel() || document.querySelector('[aria-disabled="true"][data-state$="open"]')) return
      const at = document.activeElement
      // A list of the panel's own, a select's or a pop-up's, closes first.
      if (inPopUp(at) || at?.getAttribute('aria-expanded') === 'true') return
      if (typingIn(at)) return
      if (inField(at)) {
        if (!panel.current?.contains(at)) {
          // Once the field has thrown away what was typed, so leaving it keeps nothing.
          requestAnimationFrame(() => document.activeElement === at && at.blur())
          return
        }
        setOpen(null)
        requestAnimationFrame(() => {
          if (stageHasKeys(document.activeElement)) openerOf(id, opener)?.focus()
        })
        return
      }
      event.stopImmediatePropagation()
      event.preventDefault()
      closePanel(id, panel.current?.contains(at) ?? false, opener)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  // The focus moves into the panel as it opens, onto the panel itself: Tab goes on to its
  // controls, and no field takes the focus, so a phone's keyboard stays down. `focus` is set once,
  // as the panel opens.
  useEffect(() => {
    if (focus) panel.current?.focus({ preventScroll: true })
  }, [focus])
  // A long title, as a frame's long name in Add a size to, wraps onto a second line and then ends
  // in an ellipsis, with the whole title as its tooltip.
  const heading = useRef<HTMLHeadingElement>(null)
  const [titleCut, setTitleCut] = useState(false)
  useLayoutEffect(() => {
    const el = heading.current
    if (!el) return
    const measure = () => setTitleCut(el.scrollHeight > el.clientHeight + 1)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [title])
  return (
    <section
      ref={panelRef}
      id="edit-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="edit-panel-title"
      tabIndex={-1}
      data-testid={`bar-${id}-menu`}
      data-panel={id}
      style={{ ...cardStyle(top, phone || sheet), ...sheetStart }}
      className={cn(
        PANEL_CARD,
        // On a phone Pages rests above the tab bar, under the islands, giving way to the tool tray there.
        sheet
          ? FRAME_SHEET
          : cn(
              'max-sm:top-auto max-sm:bottom-(--above-tab-bar) max-sm:max-h-[calc(100%-var(--panel-top)-var(--above-tab-bar))]',
              UNDER_TOOL_TRAY,
            ),
      )}
    >
      <div
        className={cn(
          'flex min-h-12 shrink-0 items-center gap-2 border-b py-1.5 ps-4 pe-2 transition-colors',
          scroll.down ? 'border-line' : 'border-transparent',
          back && 'ps-2',
        )}
      >
        <h2
          ref={heading}
          id="edit-panel-title"
          title={titleCut ? title : undefined}
          className="line-clamp-2 min-w-0 flex-1 font-display text-card leading-[1.3] font-bold tracking-tight break-words"
        >
          {title}
        </h2>
        {note && (
          <span
            data-testid="edit-panel-note"
            className="min-w-0 max-w-[50%] shrink-0 truncate pe-0.5 text-caption font-medium text-muted"
          >
            {note}
          </span>
        )}
        {action}
        {/* ✕, or with `back` a back arrow before the title, closes the panel. */}
        <button
          type="button"
          aria-label={back ?? t.editor.closePanel}
          title={back}
          data-testid={back ? 'edit-panel-back' : 'edit-panel-close'}
          onClick={() => closePanel(id, true, opener)}
          className={cn(
            `grid size-7 ${TOUCH_SQUARE} shrink-0 cursor-pointer place-items-center rounded-full text-subtle hover:bg-hover hover:text-text active:bg-pressed`,
            back && '-order-1',
          )}
        >
          {back ? (
            <ArrowLeftIcon size={14} aria-hidden className="rtl:-scale-x-100" />
          ) : (
            <XIcon size={14} aria-hidden />
          )}
        </button>
      </div>
      <div
        ref={bodyRef}
        onScroll={scroll.measure}
        className={cn(PANEL_BODY, fills ? FILLED_BODY : scroll.more && FADED_END)}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * The edit panel for the picked frame, while nothing takes its place: its name and ⋯, then
 * Background and Arrange. None once the frame is gone, as a frame duplicated a moment ago is picked
 * before the design that holds it is drawn. Picking another frame keeps the panel, and the ⋯ the
 * focus may be on.
 */
function FramePanel({ editor, frameId, workspaceId, brandId }: Omit<FrameSectionProps, 'design'>) {
  const { open } = useEditState()
  const viewOnly = useViewOnly()
  const { design } = useLiveDesign(editor)
  const frame = design.frames[frameId]
  if (!frame || !selectionPanelShows(open, true)) return null
  const layout = framePanelOf({ viewOnly })
  return (
    <SelectionPanel
      editor={editor}
      layout={layout}
      named={{ 'data-frame': frameId }}
      header={
        <PanelHeader editor={editor} name={frame.name} controls={layout.header}>
          {layout.header.includes('frame-more') && <FrameMore editor={editor} frameId={frameId} design={design} />}
        </PanelHeader>
      }
      section={(section) => {
        const Content = FRAME_SECTIONS[section.id]
        // Keyed by the frame too, so what a section holds for one frame, as Lock ratio, starts afresh for another.
        return (
          <Content
            key={`${section.id} ${frameId}`}
            editor={editor}
            design={design}
            frameId={frameId}
            workspaceId={workspaceId}
            brandId={brandId}
          />
        )
      }}
    />
  )
}

/**
 * The font chooser, in the edit panel's place: its back arrow, or Esc, returns to the Text switcher
 * tab, the focus to its font. The chooser's search takes the focus as it opens.
 */
function FontPanel({ target, workspaceId, brandId }: PanelProps) {
  const { bar, editPanel } = useMessages().editor
  const { catalog, refresh } = useFontCatalog(workspaceId, brandId)
  return (
    <PanelFrame id={FONT_CHOOSER} title={bar.panels.font} focus={false} back={editPanel.backToText} fills>
      <ViewOnlyFieldset>
        <FontChooser
          editor={target.editor}
          workspaceId={workspaceId}
          brandId={brandId}
          catalog={catalog}
          refresh={refresh}
          onDone={() => closePanel(FONT_CHOOSER, true)}
        />
      </ViewOnlyFieldset>
    </PanelFrame>
  )
}

/** The edit panel for the selected layers: their name and lock, then their sections. */
function LayersPanel({
  layout,
  locked,
  ...props
}: PanelProps & {
  layout: PanelLayout
  /** The selected layers that are locked, which the header's lock unlocks. */
  locked: string[]
}) {
  const { target } = props
  const t = useMessages()
  return (
    <SelectionPanel
      editor={target.editor}
      layout={layout}
      named={{ 'data-selection': target.ids.join(' ') }}
      header={
        <PanelHeader
          editor={target.editor}
          name={layersName(target, t.editor.props)}
          controls={layout.header}
          locked={locked}
        />
      }
      section={(section, headed) => {
        const Content = SECTIONS[section.id]
        // Keyed by the layers too, so what a section shows open for some layers starts afresh for others.
        return (
          <Content key={[section.id, ...target.ids].join(' ')} {...props} controls={section.controls} headed={headed} />
        )
      }}
    />
  )
}

/**
 * The edit panel showing the selection or the picked frame: its header, its switcher while it has
 * two switcher tabs or more, then the shown switcher tab's sections, which scroll. It never takes
 * the focus. F6 moves the focus to the switcher's shown switcher tab, or with no switcher to the
 * first control, and from inside the panel back to the stage; if the panel goes with the focus
 * inside it, the focus goes back to the stage. Esc on one of its own controls does what it does on
 * the stage, deselecting, and gives the stage back the keys; a field, a list open from a control, or
 * a menu or dialog over the panel keeps its own Esc. On a phone or a tablet it is a sheet at the
 * bottom with a handle, low for each new selection, which drags or presses to full and back; on a
 * phone it waits for an open flyout to close, as both rest above the tab bar.
 */
function SelectionPanel<Id extends string>({
  editor,
  layout,
  named,
  header,
  section,
}: {
  editor: Editor
  layout: PanelLayout<Id>
  /** What the panel shows, named on it: the selected layers, or the picked frame. */
  named: { 'data-selection': string } | { 'data-frame': string }
  header: ReactNode
  /** Draws one section of the shown switcher tab, keyed, with whether it shows its heading. */
  section: (section: Section<Id>, headed: boolean) => ReactNode
}) {
  const { pickedSwitcherTab, selections } = useEditState()
  const phone = usePhone()
  const top = usePanelTop()
  const panel = useRef<HTMLElement>(null)
  const { body, bodyRef, scroll } = usePanelBody(phone)
  const sheet = useSelectionSheet(panel, body, top)
  const switcherTabs = layout.switcherTabs.map((one) => one.id)
  const shown = shownSwitcherTab(switcherTabs, pickedSwitcherTab)
  const switcherTab = layout.switcherTabs.find((one) => one.id === shown)
  const sections = switcherTab?.sections ?? []
  const headed = switcherTab ? headedSections(switcherTab) : new Set()
  const switcher = showsSwitcher(layout)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F6' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      // A dialog or a menu standing over the panel keeps the focus.
      if (overPanel()) return
      event.preventDefault()
      onF6(focusOf(panel.current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // As the panel goes, while it is still on the page.
  useLayoutEffect(() => {
    const el = panel.current
    return () => asPanelGoes(focusOf(el))
  }, [])
  // Each new selection shows the panel from its top.
  useLayoutEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [body, selections])
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || composingKey(event.nativeEvent)) return
    const at = event.target instanceof Element ? event.target : null
    if (inField(at) || inPopUp(at) || at?.getAttribute('aria-expanded') === 'true' || overPanel()) return
    event.preventDefault()
    focusOf(panel.current).toStage()
    editor.perform('deselect')
  }
  if (!shown || sheet.waits) return null
  return (
    <section
      ref={sheet.ref}
      id="edit-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={PANEL_HEADER_ID}
      data-testid="selection-panel"
      data-sheet={sheet.on ? (sheet.full ? 'full' : 'low') : undefined}
      {...named}
      onKeyDown={onKeyDown}
      style={{ ...cardStyle(top, sheet.on), ...sheet.style }}
      className={cn(CARD, sheet.className ?? SIDE_CARD, UNDER_TOOL_TRAY)}
    >
      {sheet.on && <SheetHandle full={sheet.full} handle={sheet.handle} />}
      {header}
      {switcher && <Switcher switcherTabs={switcherTabs} shown={shown} onPick={pickSwitcherTab} />}
      <div
        ref={bodyRef}
        id={SWITCHER_PANEL_ID}
        tabIndex={-1}
        {...(switcher ? { role: 'tabpanel', 'aria-labelledby': switcherTabId(shown) } : {})}
        onScroll={scroll.measure}
        className={cn(
          PANEL_BODY,
          'border-t pt-3 outline-none transition-colors',
          scroll.down ? 'border-line' : 'border-transparent',
          scroll.more && FADED_END,
        )}
      >
        <ViewOnlyFieldset>{sections.map((one) => section(one, headed.has(one.id)))}</ViewOnlyFieldset>
      </div>
    </section>
  )
}
