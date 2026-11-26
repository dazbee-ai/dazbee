'use client'

// The Select button in the tool dock: one button picks the tool last picked of Select and Hand, and
// the caret beside it opens a menu of the two, each with its key, as the Frame button's menu does.
// Space still pans while held, whichever is picked.
import { useState } from 'react'

import { DOCK_BUTTON, DOCK_OFF, DOCK_ON } from '@/components/editor/styles.ts'
import { CaretUpIcon, CursorIcon, HandIcon, type Icon } from '@/components/ui/icons.tsx'
import { LIT_ROW, MENU_KEY, TOUCH_ROW } from '@/components/ui/looks.ts'
import { Menu, MenuRadio, MenuRadios } from '@/components/ui/menu.tsx'
import { Tooltip, withShortcut } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** The tools the Select button picks between. */
export type SelectTool = 'select' | 'hand'

/** Each tool of the menu, with its icon and the action of its key, which names it. */
const SELECT_TOOLS: { id: SelectTool; icon: Icon; action: 'toolSelect' | 'toolHand' }[] = [
  { id: 'select', icon: CursorIcon, action: 'toolSelect' },
  { id: 'hand', icon: HandIcon, action: 'toolHand' },
]

/** The tool the Select button picks, as the menu lists it. */
const toolOf = (tool: SelectTool) =>
  SELECT_TOOLS.find((t) => t.id === tool) ?? (SELECT_TOOLS[0] as (typeof SELECT_TOOLS)[number])

/** The icon of the tool the Select button picks, as its dock button shows it. */
export const selectToolIcon = (tool: SelectTool): Icon => toolOf(tool).icon

export function SelectTools({
  active,
  tool,
  onPick,
}: {
  active: boolean
  tool: SelectTool
  onPick: (tool: SelectTool) => void
}) {
  const t = useMessages()
  const words = t.editor.selectTools
  const [open, setOpen] = useState(false)
  const current = toolOf(tool)
  const label = t.editor.actions[current.action]
  return (
    <div
      role="group"
      aria-label={words.menu}
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
            aria-label={words.more}
            data-testid="select-menu"
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
        tooltip={words.more}
        open={open}
        onOpenChange={setOpen}
        label={words.menu}
        place={{ side: 'top', align: 'center', sideOffset: 10 }}
        className="w-52 p-1"
      >
        <MenuRadios value={tool} onValueChange={(id) => onPick(id as SelectTool)}>
          {SELECT_TOOLS.map(({ id, icon: ToolIcon, action }) => (
            <MenuRadio
              key={id}
              value={id}
              label={t.editor.actions[action]}
              data-select-tool={id}
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
              <span className="flex-1 text-start">{t.editor.actions[action]}</span>
              <kbd className={MENU_KEY}>{keyOf(action)}</kbd>
            </MenuRadio>
          ))}
        </MenuRadios>
      </Menu>
    </div>
  )
}
