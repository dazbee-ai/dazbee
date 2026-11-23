'use client'

// A round colour swatch that picks its colour, as every swatch row draws one: the swatch as small as
// its row draws it, inside a target as big as the swatch, or 44 px on a phone so a finger hits it.
import { PICKED_RING, SWATCH, SWATCH_TARGET } from '@/components/editor/styles.ts'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'

/**
 * A swatch button of `color`, or of the picture at `picture`, drawn `size` (a size class) off a
 * phone, ringed while `on`. `on` left out, it toggles nothing and has no pressed state; `title`
 * defaults to `label`.
 */
export function Swatch({
  color,
  picture,
  label,
  title = label,
  size,
  on,
  onPick,
}: {
  color: string
  picture?: string
  label: string
  title?: string
  size: string
  on?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      aria-pressed={on}
      onClick={onPick}
      className={cn(SWATCH_TARGET, FOCUS_RING)}
    >
      <span
        aria-hidden
        style={picture ? { background: `${color} url("${picture}") center / cover` } : { backgroundColor: color }}
        className={cn(SWATCH, size, on && PICKED_RING)}
      />
    </button>
  )
}
