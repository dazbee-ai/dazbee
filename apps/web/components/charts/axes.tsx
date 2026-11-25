// A chart's axes: a hairline at each tick with its value beside it, the baseline, and the names of the
// points along the x axis that fit.
import { AXIS_BAND, type Frame } from './plot.ts'
import type { ChartPoint } from './series.ts'

export function Axes({
  frame,
  points,
  width,
  format,
}: {
  frame: Frame
  points: ChartPoint[]
  width: number
  format: (value: number) => string
}) {
  const bottom = frame.y(0)
  return (
    <g className="fill-muted text-micro">
      {frame.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={frame.left}
            x2={frame.left + frame.plotWidth}
            y1={frame.y(tick)}
            y2={frame.y(tick)}
            stroke={tick === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text x={frame.left - 6} y={frame.y(tick)} dy="0.32em" textAnchor="end" className="tabular-nums">
            {format(tick)}
          </text>
        </g>
      ))}
      {points.map((point, i) =>
        frame.named.has(i) ? (
          <text
            key={point.key}
            x={Math.min(Math.max(frame.x(i), frame.left + 18), width - 18)}
            y={bottom + AXIS_BAND - 6}
            textAnchor="middle"
          >
            {point.short}
          </text>
        ) : null,
      )}
    </g>
  )
}
