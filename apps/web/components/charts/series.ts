// What a chart draws: points along its x axis, series of values at those points, and the series colours in
// their fixed order. A series keeps the colour of the thing it stands for, whatever else is shown.

/** A point along the x axis: its key, its short name under the axis, and its long name in the tooltip and table. */
export interface ChartPoint {
  key: string
  short: string
  long: string
}

/** One series: its key, its name, its colour, and its value at each point; null where it has none. */
export interface ChartSeries {
  key: string
  label: string
  colour: string
  values: (number | null)[]
}

/** The series colours, in their fixed order, from app/styles/tokens.css. */
export const SERIES_COLOURS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const

/** The colour of what falls outside the named series. */
export const OTHER_COLOUR = 'var(--chart-other)'

/** The colour that marks a point as wrong, always shown with its icon and word. */
export const CRITICAL_COLOUR = 'var(--chart-critical)'

/** The colour of the thing at `index` in its fixed list: its own slot, or the grey of Other past the last. */
export function seriesColour(index: number): string {
  return SERIES_COLOURS[index] ?? OTHER_COLOUR
}
