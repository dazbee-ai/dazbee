'use client'

import { weightName } from '@/components/brand-kit/font-catalog.ts'
import { FontPreview } from '@/components/brand-kit/font-preview.tsx'
import { PANEL_HEADING } from '@/components/editor/styles.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import type { ChosenFont, FontRow } from './font-rows.ts'

/** One drawn row, placed down the list: a group's heading, a family, or a weight of the chosen family. */
export function ChooserRow({
  id,
  row,
  top,
  heading,
  workspaceId,
  brandId,
  current,
  active,
  viewOnly,
  onHover,
  onPick,
}: {
  id: string
  row: FontRow
  top: number
  heading: string
  workspaceId: string
  brandId: string
  current: ChosenFont
  active: boolean
  viewOnly: boolean
  onHover: () => void
  onPick: () => void
}) {
  const t = useMessages()
  if (row.kind === 'heading')
    return (
      <div
        role="presentation"
        style={{ top }}
        className={cn(PANEL_HEADING, 'absolute inset-x-0 flex h-7 items-end px-2 pb-1')}
      >
        {heading}
      </div>
    )
  const chosen = row.family.family === current.family && (row.kind === 'family' || row.weight === current.weight)
  const label = row.kind === 'family' ? row.family.family : weightName(t.editor.fonts.weights, row.weight)
  return (
    <div
      id={id}
      role="option"
      aria-label={label}
      aria-selected={chosen}
      data-family={row.family.family}
      data-weight={row.kind === 'weight' ? row.weight : undefined}
      data-active={active ? '' : undefined}
      style={{ top }}
      onPointerEnter={onHover}
      // A click leaves the focus in the search, where the arrow keys move through the list.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => !viewOnly && onPick()}
      className={cn(
        'absolute inset-x-1 flex items-center rounded-row px-2 data-[active]:not-aria-selected:bg-hover data-[active]:lit aria-selected:bg-accent-soft aria-selected:lit',
        row.kind === 'family' ? 'h-9' : 'h-7 ps-6 text-label text-muted',
        !viewOnly && 'cursor-pointer',
      )}
    >
      {row.kind === 'family' ? <FontPreview workspaceId={workspaceId} brandId={brandId} family={row.family} /> : label}
    </div>
  )
}
