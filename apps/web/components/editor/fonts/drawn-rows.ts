// Which of the font chooser's rows are drawn: only those in view of its scrolled list, and a few past
// either edge, so every Google family scrolls smoothly; the heading pinned above the list;
// and the scroll that shows a row.
import type { FontGroup, FontRow } from './font-rows.ts'

/** Where each row sits down the list, and how tall the list is, in pixels. */
export interface RowLayout {
  tops: number[]
  total: number
}

/** How tall each kind of row is, in pixels. */
export const ROW_HEIGHT: Readonly<Record<FontRow['kind'], number>> = { heading: 28, family: 36, weight: 28 }

/** Rows drawn past each edge of the view, so a quick scroll never shows a gap. */
const OVERSCAN = 8

/**
 * Stacks the rows. The first heading takes no room: the pinned heading above the list shows it
 * until the next heading scrolls by.
 */
export function layOut(rows: readonly FontRow[]): RowLayout {
  const tops: number[] = []
  let total = 0
  rows.forEach((row, i) => {
    tops.push(total)
    total += heightOf(row, i)
  })
  return { tops, total }
}

/**
 * The rows drawn with the list scrolled to `scrollTop` and `height` pixels of it in view, `from`
 * to `to` (not included), and the group whose heading is pinned above it: the last whose own
 * heading has scrolled by, else the first group.
 */
export function drawnRows(
  rows: readonly FontRow[],
  { tops }: RowLayout,
  scrollTop: number,
  height: number,
): { from: number; to: number; pinned: FontGroup | null } {
  if (rows.length === 0) return { from: 0, to: 0, pinned: null }
  // The first row reaching below the top edge, and the first starting below the bottom edge.
  const first = firstWhere(rows.length, (i) => (tops[i] ?? 0) + heightOf(rows[i], i) > scrollTop)
  const past = firstWhere(rows.length, (i) => (tops[i] ?? 0) >= scrollTop + height)
  let pinned = rows[0]?.group ?? null
  for (let i = 0; i < first; i++) {
    const row = rows[i]
    if (row?.kind === 'heading') pinned = row.group
  }
  return { from: Math.max(0, first - OVERSCAN), to: Math.min(rows.length, past + OVERSCAN), pinned }
}

/** The scroll that shows row `at` whole, moving the least from `scrollTop`: unchanged when it shows. */
export function scrollToShow(
  rows: readonly FontRow[],
  { tops }: RowLayout,
  at: number,
  scrollTop: number,
  height: number,
): number {
  const top = tops[at] ?? 0
  const bottom = top + heightOf(rows[at], at)
  if (top < scrollTop) return top
  if (bottom > scrollTop + height) return bottom - height
  return scrollTop
}

/**
 * The scroll that keeps the row keyed `key` `offset` pixels below the list's top edge, where it
 * showed before the rows changed round it, as when a pick closes the weights of the family picked
 * before; null when the row is no longer listed.
 */
export function keptInPlace(rows: readonly FontRow[], { tops }: RowLayout, key: string, offset: number): number | null {
  const at = rows.findIndex((row) => row.key === key)
  return at === -1 ? null : (tops[at] ?? 0) - offset
}

/**
 * The scroll that shows the weight rows under the family keyed `key`, as a pick opens them, moving
 * the least from `scrollTop`: up just far enough for the last weight to show, but never so far the
 * family itself passes the top edge. Unchanged when they show; null when the row is no longer listed.
 */
export function scrollToShowWeights(
  rows: readonly FontRow[],
  { tops }: RowLayout,
  key: string,
  scrollTop: number,
  height: number,
): number | null {
  const at = rows.findIndex((row) => row.key === key)
  if (at === -1) return null
  let last = at
  while (rows[last + 1]?.kind === 'weight') last++
  const bottom = (tops[last] ?? 0) + heightOf(rows[last], last)
  if (bottom <= scrollTop + height) return scrollTop
  return Math.min(bottom - height, tops[at] ?? 0)
}

/** A row's height; the first heading's is none, as it shows pinned above the list. */
function heightOf(row: FontRow | undefined, index: number): number {
  if (!row || (index === 0 && row.kind === 'heading')) return 0
  return ROW_HEIGHT[row.kind]
}

/** The first index below `length` for which `holds` is true, where it is false and then true; `length` when it never is. */
function firstWhere(length: number, holds: (i: number) => boolean): number {
  let low = 0
  let high = length
  while (low < high) {
    const mid = (low + high) >> 1
    if (holds(mid)) high = mid
    else low = mid + 1
  }
  return low
}
