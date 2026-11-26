'use client'

// The Frame button in the tool dock: one button picks the tool last picked of Frame and Section, and
// the caret beside it opens a menu of the two, each with its key, as the shape tool's menu does.
import { useState } from 'react'

import type { ShortcutAction } from '@dazbee/editor'

import { DOCK_BUTTON, DOCK_OFF, DOCK_ON } from '@/components/editor/styles.ts'
import { BoundingBoxIcon, CaretUpIcon, FrameCornersIcon, type Icon } from '@/components/ui/icons.tsx'
import { LIT_ROW, MENU_KEY, TOUCH_ROW } from '@/components/ui/looks.ts'
import { Menu, MenuRadio, MenuRadios } from '@/components/ui/menu.tsx'
import { Tooltip, withShortcut } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** The tools the Frame button picks between. */
export type FrameTool = 'frame' | 'section'

/** Each tool of the menu, with its icon and the action of its key. */
const FRAME_TOOLS: { id: FrameTool; icon: Icon; action: ShortcutAction }[] = [
  { id: 'frame', icon: FrameCornersIcon, action: 'toolFrame' },
  { id: 'section', icon: BoundingBoxIcon, action: 'toolSection' },
]

/** The tool the Frame button picks, as the menu lists it. */
const toolOf = (tool: FrameTool) =>
  FRAME_TOOLS.find((t) => t.id === tool) ?? (FRAME_TOOLS[0] as (typeof FRAME_TOOLS)[number])

/** The icon of the tool the Frame button picks, as its dock button shows it. */
export const frameToolIcon = (tool: FrameTool): Icon => toolOf(tool).icon

export function FrameTools({
  active,
  tool,
  onPick,
}: {
  active: boolean
  tool: FrameTool
  onPick: (tool: FrameTool) => void
}) {
  const t = useMessages()
  const s = t.editor.sections
  const [open, setOpen] = useState(false)
  const current = toolOf(tool)
  const label = s[current.id]
  return (
    <div
      role="group"
      aria-label={s.menu}
      className={cn(
        'flex items-center rounded-[12px] transition-colors duration-[var(--chrome-fast)]',
        active && DOCK_ON,
      )}
    >
      <Tooltip label={withShortcut(label, keyOf(current.action))}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          data-tool={current.id}
          // The Frame tool opens Add a frame, which gives the focus back here as it closes.
          data-opens={current.id === 'frame' ? 'addFrame' : undefined}
          onClick={() => onPick(current.id)}
          className={cn(DOCK_BUTTON, 'w-9 ps-0.5', active ? 'text-on-accent' : DOCK_OFF)}
        >
          <current.icon size={20} weight={active ? 'fill' : 'regular'} aria-hidden />
        </button>
      </Tooltip>
      <Menu
        trigger={
          <button
            type="button"
            aria-label={s.more}
            data-testid="frame-menu"
            className={cn(
              DOCK_BUTTON,
              'w-4',
              active
                ? 'text-on-accent/80 hover:text-on-accent'
                : 'text-subtle hover:bg-hover hover:text-text active:bg-pressed',
            )}
          >
            <CaretUpIcon size={10} weight="bold" aria-hidden />
          </button>
        }
        tooltip={s.more}
        open={open}
        onOpenChange={setOpen}
        label={s.menu}
        place={{ side: 'top', align: 'center', sideOffset: 10 }}
        className="w-52 p-1"
      >
        <MenuRadios value={tool} onValueChange={(id) => onPick(id as FrameTool)}>
          {FRAME_TOOLS.map(({ id, icon: ToolIcon, action }) => (
            <MenuRadio
              key={id}
              value={id}
              label={s[id]}
              data-frame-tool={id}
              className={cn(
                `flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-row px-2 text-small outline-none transition-colors duration-[var(--chrome-fast)] ${LIT_ROW} focus-visible:bg-hover focus-visible:lit`,
                TOUCH_ROW,
                id === tool ? 'text-text' : 'text-muted',
              )}
            >
              <ToolIcon
                size={16}
                weight={id === tool ? 'fill' : 'regular'}
                aria-hidden
                className={cn(id === tool && 'text-accent-text')}
              />
              <span className="flex-1 text-start">{s[id]}</span>
              <kbd className={MENU_KEY}>{keyOf(action)}</kbd>
            </MenuRadio>
          ))}
        </MenuRadios>
      </Menu>
    </div>
  )
}
