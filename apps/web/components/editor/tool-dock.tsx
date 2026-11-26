'use client'

// The tool dock: one button for each tool, the Select tool with its menu of Select and Hand, the
// Frame tool with its menu of Frame and Section, the shape tool with its menu of shapes, the tool in
// use lit, and on a tablet or desktop after a divider the flyouts' buttons. On a phone it is the
// tool tray: the tab bar's tool button, showing the tool in use, opens it above the bar, and picking
// a tool closes it.
import { type ReactNode, useEffect, useState } from 'react'

import { type ShapeMenuTool, type ShortcutAction, VIEW_TOOLS } from '@dazbee/editor'
import { stageHasKeys } from '@dazbee/editor/dom-input'

import { type FrameTool, frameToolIcon, FrameTools } from '@/components/editor/menus/frame-menu.tsx'
import { type SelectTool, selectToolIcon, SelectTools } from '@/components/editor/menus/select-menu.tsx'
import { shapeIcon, ShapeTools } from '@/components/editor/menus/shape-menu.tsx'
import {
  CaretUpIcon,
  CursorIcon,
  FrameCornersIcon,
  type Icon,
  PenNibIcon,
  ShapesIcon,
  TextTIcon,
} from '@/components/ui/icons.tsx'
import { useMenuClose } from '@/components/ui/menu-close.ts'
import { Tooltip, withShortcut } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format, type Messages } from '@/lib/i18n/index.ts'

import { BAR_DIVIDER, dockTool, TAB_BAR_CHIP } from './styles.ts'

export type Tool = 'select' | 'frame' | 'section' | 'shape' | 'text' | 'pen' | 'hand'

/** The tool tray's state, from `useToolTray`. */
export type ToolTray = ReturnType<typeof useToolTray>

const TOOLS: { id: Tool; icon: Icon }[] = [
  { id: 'select', icon: CursorIcon },
  { id: 'frame', icon: FrameCornersIcon },
  { id: 'shape', icon: ShapesIcon },
  { id: 'text', icon: TextTIcon },
  { id: 'pen', icon: PenNibIcon },
]
/** The action that picks each tool, its name and its key; the shape tool's shape picks its own. */
const TOOL_ACTIONS = {
  select: 'toolSelect',
  frame: 'toolFrame',
  section: 'toolSection',
  text: 'toolText',
  pen: 'toolPen',
  hand: 'toolHand',
} as const satisfies Record<Exclude<Tool, 'shape'>, ShortcutAction>
/** The id of the dock, which the tool button opens on a phone. */
const DOCK_ID = 'editor-tools'

/** A tool's name; the shape tool's is the name of the shape it draws. */
const toolName = (t: Messages, tool: Tool, shape: ShapeMenuTool) =>
  tool === 'shape' ? t.editor.shapes[shape] : t.editor.actions[TOOL_ACTIONS[tool]]
/** The tools a tab that may only view keeps (C35): Select's button, with Hand in its menu, the editor's `VIEW_TOOLS`. */
const viewTools = (viewOnly: boolean) =>
  viewOnly ? TOOLS.filter(({ id }) => (VIEW_TOOLS as ReadonlySet<string>).has(id)) : TOOLS

/**
 * Whether the tool tray is open, on a phone only. It closes on its button, on Esc, on a press outside
 * it and its button, and once a tool is picked; while open it stands over the edit panel, so Esc
 * closes it first.
 */
export function useToolTray(phone: boolean) {
  const [open, setOpen] = useState(false)
  const shown = phone && open
  const { box, button, overPanelMark } = useMenuClose(shown, () => setOpen(false))
  // Off a phone the tray is shut, so it never opens again by itself as the screen narrows back.
  useEffect(() => {
    if (!phone) setOpen(false)
  }, [phone])
  // Closes the tray as a tool is picked. As Esc does, the focus goes back to the tool button, once
  // the tray and a menu or picker in it have let it go, rather than nowhere.
  const close = () => {
    if (!shown) return
    setOpen(false)
    requestAnimationFrame(() => {
      const at = document.activeElement
      if (stageHasKeys(at) || box.current?.contains(at)) button.current?.focus()
    })
  }
  return { open: shown, setOpen, close, box, button, overPanelMark }
}

export function ToolDock({
  tray,
  tool,
  shape,
  frameTool = 'frame',
  selectTool = 'select',
  sheet,
  viewOnly = false,
  flyoutButtons,
  onPick,
}: {
  tray: ToolTray
  tool: Tool
  shape: ShapeMenuTool
  /** The tool the Frame button picks: the last of Frame and Section picked. */
  frameTool?: FrameTool
  /** The tool the Select button picks: the last of Select and Hand picked. */
  selectTool?: SelectTool
  sheet: boolean
  /** The tab may only view: the dock holds Select and Hand alone. */
  viewOnly?: boolean
  /** The flyouts' buttons at the dock's end, after a divider, kept in a tab that may only view; left out on a phone. */
  flyoutButtons?: ReactNode
  onPick: (tool: Tool, shape: ShapeMenuTool) => void
}) {
  const t = useMessages()
  // A tool picked closes the tray.
  const pick = (id: Tool, picked: ShapeMenuTool) => {
    onPick(id, picked)
    tray.close()
  }
  return (
    <div
      ref={tray.box}
      id={DOCK_ID}
      role="toolbar"
      aria-label={t.editor.tools}
      data-dock
      {...tray.overPanelMark}
      className={cn(
        'absolute inset-x-0 bottom-4 z-10 mx-auto flex w-max items-center gap-1 rounded-[18px] surface-frost p-1.5 max-sm:gap-0.5',
        // On a phone, the tray rests above the tab bar. It rises into place as it opens, and goes at
        // once as it closes, so a tool picked or a sheet opening never shows it on the way out.
        'max-sm:bottom-(--above-tab-bar)',
        tray.open
          ? 'max-sm:transition-[opacity,translate] max-sm:duration-[var(--chrome)] max-sm:ease-(--ease-out) motion-reduce:transition-none'
          : 'max-sm:pointer-events-none max-sm:invisible max-sm:translate-y-2 max-sm:opacity-0',
        sheet && 'max-sm:invisible',
      )}
    >
      {viewTools(viewOnly).map(({ id, icon: ToolIcon }) => {
        if (id === 'select') {
          return (
            <SelectTools
              key={id}
              active={tool === 'select' || tool === 'hand'}
              tool={selectTool}
              onPick={(picked) => pick(picked, shape)}
            />
          )
        }
        if (id === 'frame') {
          return (
            <FrameTools
              key={id}
              active={tool === 'frame' || tool === 'section'}
              tool={frameTool}
              onPick={(picked) => pick(picked, shape)}
            />
          )
        }
        if (id === 'shape') {
          return (
            <ShapeTools
              key={id}
              active={tool === 'shape'}
              shape={shape}
              onPick={(picked) => {
                pick('shape', picked)
              }}
            />
          )
        }
        const label = toolName(t, id, shape)
        const on = tool === id
        return (
          <Tooltip key={id} label={withShortcut(label, keyOf(TOOL_ACTIONS[id]))}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={on}
              data-tool={id}
              onClick={() => {
                pick(id, shape)
              }}
              className={dockTool(on)}
            >
              <ToolIcon size={20} weight={on ? 'fill' : 'regular'} aria-hidden />
            </button>
          </Tooltip>
        )
      })}
      {flyoutButtons && (
        <>
          <span aria-hidden className={BAR_DIVIDER} />
          {flyoutButtons}
        </>
      )}
    </div>
  )
}

/** The phone's tool button in the tab bar: the icon of the tool in use and a caret, opening the tool tray. */
export function ToolButton({ tray, tool, shape }: { tray: ToolTray; tool: Tool; shape: ShapeMenuTool }) {
  const t = useMessages()
  const ToolIcon =
    tool === 'shape'
      ? shapeIcon(shape)
      : tool === 'section'
        ? frameToolIcon('section')
        : tool === 'hand'
          ? selectToolIcon('hand')
          : (TOOLS.find((one) => one.id === tool)?.icon ?? CursorIcon)
  return (
    <button
      ref={tray.button}
      type="button"
      aria-label={format(t.editor.toolInUse, { tool: toolName(t, tool, shape) })}
      aria-expanded={tray.open}
      aria-controls={DOCK_ID}
      data-testid="tool-button"
      onClick={() => tray.setOpen((open) => !open)}
      className={cn(TAB_BAR_CHIP, 'gap-0.5')}
    >
      <ToolIcon size={20} weight="fill" aria-hidden />
      <CaretUpIcon size={12} weight="bold" aria-hidden />
    </button>
  )
}
