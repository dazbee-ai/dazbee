'use client'

import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { FocusEvent, ReactNode } from 'react'

/**
 * A tooltip's look, for a caller that measures one before it shows: one line, wrapping only where
 * it would be wider than the window less the 8 px it keeps from each side.
 */
export const TOOLTIP =
  'z-50 max-w-[calc(100vw-16px)] rounded-md border border-line bg-raised px-2 py-1 text-tiny font-medium text-text shadow-panel data-[state=delayed-open]:animate-[tooltip-in_var(--chrome-fast)_var(--ease-out)]'

/** A tooltip's words for a control with a shortcut: its name, then its key, as the tool dock and the small menu show them. */
export const withShortcut = (label: string, key: string) => `${label} · ${key}`

/** Keeps Radix from opening the tooltip on focus the browser doesn't show as keyboard focus. */
const keyboardFocusOnly = (e: FocusEvent<HTMLElement>) => {
  if (!e.currentTarget.matches(':focus-visible')) e.preventDefault()
}

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RadixTooltip.Provider delayDuration={350} skipDelayDuration={150}>
    {children}
  </RadixTooltip.Provider>
)

/**
 * How long after a tooltip of a row closes the next one still opens at once: long enough for the pointer to cross a
 * neighbouring button, either way.
 */
export const ROW_SKIP_MS = 700

/**
 * A row of neighbouring icon buttons whose tooltips switch at once as the pointer moves along it, either way: its
 * tooltips hold only words, so none stays open for a pointer heading towards it, and a tooltip elsewhere on the page
 * that does can't hold them back, as they keep their own provider.
 */
export const TooltipRow = ({ children }: { children: ReactNode }) => (
  <RadixTooltip.Provider delayDuration={350} skipDelayDuration={ROW_SKIP_MS} disableHoverableContent>
    {children}
  </RadixTooltip.Provider>
)

/**
 * A short label beside a control; the control must carry its own accessible name too. It shows on
 * hover and on keyboard focus, not when a menu closed by the pointer hands focus back to the control.
 */
export function Tooltip({
  label,
  side = 'top',
  align = 'center',
  sideOffset = 8,
  open,
  onOpenChange,
  plain = false,
  children,
}: {
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** How it lines up along its control's side. */
  align?: 'start' | 'center' | 'end'
  /** Pixels between it and its control. */
  sideOffset?: number
  /** Whether it shows, for a caller that also opens it another way, such as a tap; left out, hover and focus decide. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * It holds only words, so the pointer moving off its control towards it doesn't keep it open,
   * and the next control's tooltip shows at once.
   */
  plain?: boolean
  children: ReactNode
}) {
  return (
    <RadixTooltip.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
      disableHoverableContent={plain}
    >
      <RadixTooltip.Trigger asChild onFocus={keyboardFocusOnly}>
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          // Off the window's edges by as much as it keeps from its control.
          collisionPadding={8}
          // Words only: the pointer passes through it to the control under it.
          className={plain ? `${TOOLTIP} pointer-events-none` : TOOLTIP}
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
