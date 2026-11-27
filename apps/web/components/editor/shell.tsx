'use client'

// The editor's chrome: two islands floating at the top; a bottom tool dock whose end holds the
// buttons that open the flyouts (Layers, Assets, AI, Brand) on the stage's start side, Pages and
// the zoom, and a slot for the mini bar above the selection. The AI button opens the brief box just
// above the dock, in a tab that may change the design, and a picked AI frame shows the glass bar above it. On a phone a tab bar at the bottom holds
// the flyouts' buttons, then the tool button, which opens the dock above it as a tray, then Pages and
// the zoom. The canvas
// runs edge to edge under all of it; the stage is the editor itself, told which edges the chrome
// covers so it fits the ads between.
import { MotionConfig, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Editor, ShapeMenuTool } from '@dazbee/editor'

import { useCopyPngKey } from '@/components/editor/menus/copy-png-key.ts'
import type { FrameTool } from '@/components/editor/menus/frame-menu.tsx'
import { QuickActions } from '@/components/editor/menus/quick-actions.tsx'
import type { SelectTool } from '@/components/editor/menus/select-menu.tsx'
import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { brandPath, workspacePath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import type { ValueStore } from '@/lib/editor/value-store.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { dirOf } from '@/lib/i18n/index.ts'
import { usePhone } from '@/lib/phone.ts'

import { useAssetsKey } from './assets-key.ts'
import { BriefBox } from './brief-box.tsx'
import { DesignName } from './design-name.tsx'
import { type Flyout, isMenuSheet, isPanel, isSheet, setFlyout, setIslandsBottom, useEditState } from './edit-store.ts'
import { FlyoutButtons } from './flyout-buttons.tsx'
import { FlyoutCard } from './flyout-card.tsx'
import { GlassBar } from './glass-bar.tsx'
import { SaveStatus } from './save-status.tsx'
import { type ChromeInsets, measureInsets } from './stage-insets.ts'
import { BAR_DIVIDER } from './styles.ts'
import { ToastSlot } from './toasts.tsx'
import { type Tool, ToolButton, ToolDock, useToolTray } from './tool-dock.tsx'
import { useViewOnly } from './view-only.tsx'

const CHROME = { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const }

export function EditorShell({
  workspaceId,
  brandId,
  brandName,
  designName,
  onRename,
  status,
  history,
  tool: shownTool,
  shape = 'rect',
  frameTool = 'frame',
  selectTool = 'select',
  onToolChange,
  corner,
  onInsets,
  fitted = true,
  actions,
  account,
  flyouts,
  editor = null,
  toast,
  children,
}: {
  workspaceId: string
  brandId: string
  brandName: string
  designName: string
  /** Saves a new name for the design; left out, the name can't be changed here. */
  onRename?: (name: string) => Promise<void>
  /** The editor's save state, or what it is doing before it opens. */
  status: ValueStore<string>
  /** Undo and redo, after the save state in the header pill. */
  history?: ReactNode
  /** The tool in use, when the editor decides it (a key, or drawing a shape ends); the dock keeps its own otherwise. */
  tool?: Tool
  /** The shape the shape tool draws (#44). */
  shape?: ShapeMenuTool
  /** The tool the dock's Frame button picks: the last of Frame and Section picked. */
  frameTool?: FrameTool
  /** The tool the dock's Select button picks: the last of Select and Hand picked. */
  selectTool?: SelectTool
  onToolChange?: (tool: Tool, shape: ShapeMenuTool) => void
  /** Pages and the zoom: at the stage's bottom corner, or on a phone in the tab bar after the tool button (`inBar`). */
  corner?: (inBar: boolean) => ReactNode
  /** Called with the stage's edges the always-on chrome covers, once it is first measured and whenever they change. */
  onInsets?: (insets: ChromeInsets) => void
  /** False until the stage has fitted the design between the chrome: the editor is not ready before. */
  fitted?: boolean
  /** The design's one action at the header's end: Share, holding Export and Save as template. */
  actions?: ReactNode
  /** The account avatar after it, with language, theme, settings and sign out. */
  account?: ReactNode
  /** What a flyout shows once its ticket fills it, such as the asset library (#52); an empty state until then. */
  flyouts?: Partial<Record<Flyout, ReactNode>>
  /** The editor, once it runs: a toast keeps off its selection. */
  editor?: Editor | null
  /** The toast over the stage, if one shows: the undo toast or a notice. */
  toast?: ReactNode
  children: ReactNode
}) {
  const t = useMessages()
  const rtl = dirOf(useLocale()) === 'rtl'
  // Motion's own reduced-motion mode still fades; chrome should simply appear.
  const reduced = useReducedMotion()
  const chrome = reduced ? { duration: 0 } : CHROME
  const phone = usePhone()
  const [ownTool, setTool] = useState<Tool>('select')
  const tool = shownTool ?? ownTool
  const viewOnly = useViewOnly()
  useCopyPngKey(editor)
  const flyoutTitle = (id: Flyout) => t.editor[id]
  // What the editor has open: on a phone an edit panel, the full menu or the right-click menu is a
  // sheet, which hides the tab bar, and a sheet closes a flyout and the tool tray, as they close
  // it; so does the selection's edit panel at its full height, but not low, when the tab bar shows
  // under it. Pages opens above the tab bar instead. The tab bar keeps its place unseen under the
  // sheet, so the stage's insets keep it and a frame shown as the sheet closes lands clear of where
  // it comes back.
  const edit = useEditState()
  const { flyout } = edit
  const sheet = phone && (isSheet(edit.open) || isMenuSheet(edit) || edit.fullSheet)
  const panelOnPhone = sheet || (phone && isPanel(edit.open))
  // A menu sheet reaches the top of a short phone, so the header's islands give way to it.
  const menuSheet = phone && isMenuSheet(edit)
  const tray = useToolTray(phone)
  const { setOpen: setTray } = tray
  useEffect(() => {
    if (!panelOnPhone) return
    setFlyout(null)
    setTray(false)
  }, [panelOnPhone, setTray])
  // No flyout stays open for the next editor opened.
  useEffect(() => () => setFlyout(null), [])
  useAssetsKey(phone)
  const stage = useRef<HTMLElement>(null)

  const startIsland = useRef<HTMLDivElement>(null)
  const endIsland = useRef<HTMLDivElement>(null)
  const tabBar = useRef<HTMLElement>(null)
  const dock = tray.box
  const reported = useRef('')
  const report = useRef(onInsets)
  report.current = onInsets
  // The zoom pill and Pages at the stage's bottom corner, so the ads end above them; on a phone they
  // are in the tab bar.
  const cornerPieces = () => [
    stage.current?.querySelector('[data-zoom]') ?? null,
    stage.current?.querySelector('[data-pages]') ?? null,
  ]
  useLayoutEffect(() => {
    const measure = () => {
      if (!stage.current) return
      const boxOf = (el: Element | null) => el?.getBoundingClientRect() ?? null
      const area = stage.current.getBoundingClientRect()
      const islands = [boxOf(startIsland.current), boxOf(endIsland.current)]
      setIslandsBottom(Math.round(Math.max(0, ...islands.map((box) => (box ? box.bottom - area.top : 0)))))
      const insets = measureInsets(
        area,
        {
          islands,
          tabBar: boxOf(tabBar.current),
          dock: [dock.current, ...cornerPieces()].map(boxOf),
        },
        rtl,
      )
      const key = JSON.stringify(insets)
      if (key === reported.current) return
      reported.current = key
      report.current?.(insets)
    }
    const watch = new ResizeObserver(measure)
    for (const el of [
      stage.current,
      startIsland.current,
      endIsland.current,
      tabBar.current,
      dock.current,
      ...cornerPieces(),
    ])
      if (el) watch.observe(el)
    measure()
    return () => watch.disconnect()
  }, [phone, dock, rtl])

  // The AI button opens the brief box above the dock in place of its flyout, once the editor runs and in a tab
  // that may change the design.
  const briefing = flyout === 'ai' && editor !== null && !viewOnly
  const cardFlyout = briefing ? null : flyout
  const flyoutButtons = <FlyoutButtons flyout={flyout} title={flyoutTitle} phone={phone} rtl={rtl} reduced={reduced} />

  return (
    <MotionConfig reducedMotion="user">
      {/* While the phone's tool tray is open, what rests above the tab bar gives way to it (UNDER_TOOL_TRAY). */}
      <div data-tray={tray.open ? '' : undefined} className="group/shell h-dvh overflow-hidden bg-bg text-text">
        <div className="relative flex h-full min-h-0">
          {/* Two islands float over the canvas, the design's name and save state at
              the start and Share and the account at the end, clear of the rulers when they are on (top and
              left in either direction, so the insets swap in right-to-left). The start island sits on a
              small frosted pill, so its words read over an ad zoomed in under it; the end island's
              buttons are solid and need none. */}
          <header
            className={cn(
              'pointer-events-none absolute start-6 end-4 rtl:start-4 rtl:end-6 top-6 z-30 flex items-center justify-between gap-3',
              menuSheet && 'invisible',
            )}
          >
            <div
              ref={startIsland}
              data-testid="island-start"
              className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full surface-frost py-0.5 ps-0.5 pe-3"
            >
              <Link
                href={workspacePath(workspaceId)}
                aria-label={t.library.home}
                className="grid size-9 shrink-0 place-items-center rounded-row hover:bg-hover active:bg-pressed"
              >
                <DazbeeMark size={28} />
              </Link>
              <nav aria-label={t.library.designs} className="flex min-w-0 items-center gap-1.5 text-small">
                <Link
                  href={brandPath(workspaceId, brandId)}
                  className="truncate text-muted transition-colors hover:text-text max-sm:hidden"
                >
                  {brandName}
                </Link>
                <span aria-hidden className="text-subtle max-sm:hidden">
                  /
                </span>
                <DesignName name={designName} onRename={onRename} />
              </nav>
              <SaveStatus status={status} fitted={fitted} />
              {history}
            </div>
            <div
              ref={endIsland}
              data-testid="island-end"
              className="pointer-events-auto flex shrink-0 items-center gap-2"
            >
              {actions}
              {account}
            </div>
          </header>
          {phone && (
            <nav
              ref={tabBar}
              aria-label={t.editor.tools}
              data-testid="tab-bar"
              className={cn(
                // Clipped, so the AI button's soft gradient stays inside and never shows on the canvas.
                'absolute start-1/2 bottom-3 z-20 flex -translate-x-1/2 items-center gap-2 overflow-hidden rounded-full surface-frost p-2 rtl:translate-x-1/2',
                sheet && 'invisible',
              )}
            >
              {flyoutButtons}
              <span aria-hidden className={BAR_DIVIDER} />
              {/* The chips sit closer together than the panels' buttons, their own padding spacing them,
                  so the bar fits a 360 px screen. */}
              <div className="flex items-center gap-0.5">
                <ToolButton tray={tray} tool={tool} shape={shape} />
                {corner?.(true)}
              </div>
            </nav>
          )}

          {phone && (
            <FlyoutCard
              flyout={cardFlyout}
              title={flyoutTitle}
              brandName={brandName}
              flyouts={flyouts}
              chrome={chrome}
              phone={phone}
              rtl={rtl}
              stage={stage}
            />
          )}

          <main ref={stage} className="group/stage canvas-dots relative min-w-0 flex-1 overflow-clip">
            {children}
            {!phone && corner?.(false)}
            <ToolDock
              tray={tray}
              tool={tool}
              shape={shape}
              frameTool={frameTool}
              selectTool={selectTool}
              sheet={sheet}
              viewOnly={viewOnly}
              flyoutButtons={!phone && flyoutButtons}
              onPick={(id, picked) => {
                setTool(id)
                onToolChange?.(id, picked)
              }}
            />
            {briefing && editor && (
              <BriefBox workspaceId={workspaceId} brandId={brandId} editor={editor} onClose={() => setFlyout(null)} />
            )}
            {editor && !viewOnly && <GlassBar workspaceId={workspaceId} brandId={brandId} editor={editor} />}
            <ToastSlot editor={editor}>{toast}</ToastSlot>
            <QuickActions editor={editor} tray={tray} />
          </main>
          {!phone && (
            <FlyoutCard
              flyout={cardFlyout}
              title={flyoutTitle}
              brandName={brandName}
              flyouts={flyouts}
              chrome={chrome}
              phone={phone}
              rtl={rtl}
              stage={stage}
            />
          )}
        </div>
      </div>
    </MotionConfig>
  )
}
