// What the stacked column chart and the line chart share: their sizes, the frame each draws its marks in, and
// moving the point under the keyboard along the x axis.
import type { KeyboardEvent, PointerEvent } from 'react'

import { namedPoints, niceTicks } from './scale.ts'

/** A chart's frame: its ticks, where its plot sits, and how to place a point and a value in it. */
export interface Frame {
  ticks: number[]
  left: number
  plotWidth: number
  height: number
  slot: number
  named: Set<number>
  /** The middle of the point at `index`, in px from the chart's left edge. */
  x: (index: number) => number
  /** The height of `value`, in px from the chart's top edge. */
  y: (value: number) => number
}

/** Space above the plot, so the top tick's label isn't cut. */
export const TOP = 8

/** The band under the plot that holds the names along the x axis. */
export const AXIS_BAND = 22

/** Space after the plot. */
const RIGHT = 4

/** About how wide a digit of a tick's label is, at the axis's 11 px. */
const DIGIT = 6.5

/** The frame of a chart `width` px wide with a plot `height` px tall, for `count` points up to `max`. */
export function frameOf({
  width,
  height,
  count,
  max,
  format,
}: {
  width: number
  height: number
  count: number
  max: number
  format: (value: number) => string
}): Frame {
  const ticks = niceTicks(max)
  const top = ticks.at(-1) ?? 1
  const left = Math.ceil(Math.max(...ticks.map((tick) => format(tick).length)) * DIGIT) + 10
  const plotWidth = Math.max(1, width - left - RIGHT)
  const slot = plotWidth / Math.max(count, 1)
  return {
    ticks,
    left,
    plotWidth,
    height,
    slot,
    named: namedPoints(count, plotWidth),
    x: (index) => left + slot * (index + 0.5),
    y: (value) => TOP + height - (value / top) * height,
  }
}

/** The point under the pointer, or null off the plot. */
export function pointAt(event: PointerEvent<Element>, frame: Frame, count: number): number | null {
  const box = event.currentTarget.getBoundingClientRect()
  const index = Math.floor((event.clientX - box.left - frame.left) / frame.slot)
  return index >= 0 && index < count ? index : null
}

/** The point the keyboard moves to from `active`: the arrows step, Home and End jump, Esc lets go. */
export function pointAfterKey(event: KeyboardEvent, active: number | null, count: number): number | null | undefined {
  const last = count - 1
  switch (event.key) {
    case 'ArrowRight':
      return Math.min(last, (active ?? -1) + 1)
    case 'ArrowLeft':
      return Math.max(0, (active ?? count) - 1)
    case 'Home':
      return 0
    case 'End':
      return last
    case 'Escape':
      return null
    default:
      return undefined
  }
}
