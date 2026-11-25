// A stat tile: a figure with its name above it and a line under it, a meter where the figure runs against
// a limit, and the warning icon where it needs looking at. A tile that leads somewhere is a link.
import Link from 'next/link'
import type { ReactNode } from 'react'

import { WarningCircleIcon } from '@/components/ui/icons.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'

/** A meter's fill by how far the figure has run: the accent, then the warning colour past 80%, red at the limit. */
function meterColour(share: number): string {
  if (share >= 1) return 'bg-danger'
  return share >= 0.8 ? 'bg-warning' : 'bg-accent'
}

export function StatTile({
  label,
  value,
  detail,
  warn = false,
  meter,
  href,
  testId,
}: {
  label: string
  value: string
  detail?: ReactNode
  /** Whether the figure needs looking at: the tile shows the warning icon, and its line is red. */
  warn?: boolean
  /** How far the figure has run against its limit, 1 at the limit. */
  meter?: number
  href?: string
  testId?: string
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-caption font-medium text-muted">
        {warn && <WarningCircleIcon size={14} weight="bold" aria-hidden className="shrink-0 text-danger" />}
        {label}
      </span>
      <span className="font-display text-heading leading-tight font-semibold text-text">{value}</span>
      {meter !== undefined && (
        <span aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
          <span
            className={cn('block h-full rounded-full', meterColour(meter))}
            style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }}
          />
        </span>
      )}
      {detail && <span className={cn('text-caption', warn ? 'text-danger' : 'text-muted')}>{detail}</span>}
    </>
  )
  const look = cn(
    'flex min-w-0 flex-col gap-1.5 rounded-card border bg-surface p-4 shadow-panel',
    warn ? 'border-danger/50' : 'border-line',
  )
  return href ? (
    <Link
      href={href}
      data-testid={testId}
      className={cn(look, FOCUS_RING, 'transition-colors hover:border-line-strong hover:bg-raised')}
    >
      {body}
    </Link>
  ) : (
    <div data-testid={testId} data-warn={warn || undefined} className={look}>
      {body}
    </div>
  )
}
