'use client'

// The marks a person draws over a frame for Refine with AI: numbered boxes and brush strokes in Dazbee's blue, laid
// over the frame on the stage and following the view. While a mark tool is picked, the layer takes the presses over
// the frame and draws with it; otherwise presses go through to the canvas. The wheel over it pans and zooms the stage.
import { type PointerEvent, useRef, useState } from 'react'

import { useWheelThrough } from '@/components/editor/wheel-through.ts'
import { cn } from '@/lib/cn.ts'
import { type Mark, type MarkPoint, MARKS_BLUE, markStart, type Size, type StageEdges } from '@/lib/editor/refine.ts'

/** What a press over the frame draws: nothing (the canvas takes it), a box or a brush stroke. */
export type MarkTool = 'none' | 'box' | 'brush'

/**
 * The marks over the frame, numbered in the order drawn; with a tool picked, it takes the presses over the frame and
 * draws a box or a brush stroke, kept in the frame's design pixels so they follow the view.
 */
export function MarksLayer({
  rect,
  frame,
  marks,
  tool,
  onMark,
}: {
  rect: StageEdges
  frame: Size
  marks: readonly Mark[]
  tool: MarkTool
  onMark: (mark: Mark) => void
}) {
  const [layer, setLayer] = useState<SVGSVGElement | null>(null)
  const drawing = useRef<Mark | null>(null)
  const [, redraw] = useState(0)
  useWheelThrough(layer as unknown as HTMLElement | null)
  const k = (rect.right - rect.left) / frame.width
  const pointOf = (event: PointerEvent<SVGSVGElement>): MarkPoint => {
    const box = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(frame.width, Math.max(0, (event.clientX - box.left) / k)),
      y: Math.min(frame.height, Math.max(0, (event.clientY - box.top) / k)),
    }
  }
  const shown = drawing.current ? [...marks, drawing.current] : marks
  return (
    <svg
      ref={setLayer}
      data-testid="refine-marks"
      aria-hidden
      className={cn('absolute z-10', tool === 'none' ? 'pointer-events-none' : 'cursor-crosshair touch-none')}
      style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      onPointerDown={(event) => {
        if (tool === 'none' || event.button !== 0) return
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // A pointer the browser no longer tracks: the stroke still draws while it stays over the frame.
        }
        const at = pointOf(event)
        drawing.current = tool === 'box' ? { kind: 'box', from: at, to: at } : { kind: 'brush', points: [at] }
        redraw((n) => n + 1)
      }}
      onPointerMove={(event) => {
        const now = drawing.current
        if (!now) return
        const at = pointOf(event)
        drawing.current = now.kind === 'box' ? { ...now, to: at } : { ...now, points: [...now.points, at] }
        redraw((n) => n + 1)
      }}
      onPointerUp={() => {
        const done = drawing.current
        drawing.current = null
        if (
          done &&
          (done.kind === 'brush' ? done.points.length > 1 : done.from.x !== done.to.x && done.from.y !== done.to.y)
        )
          onMark(done)
        redraw((n) => n + 1)
      }}
    >
      {shown.map((mark, n) => {
        const width = 3 / k
        const at = markStart(mark)
        return (
          <g key={n}>
            {mark.kind === 'box' ? (
              <rect
                x={Math.min(mark.from.x, mark.to.x)}
                y={Math.min(mark.from.y, mark.to.y)}
                width={Math.abs(mark.to.x - mark.from.x)}
                height={Math.abs(mark.to.y - mark.from.y)}
                fill="none"
                stroke={MARKS_BLUE}
                strokeWidth={width}
              />
            ) : (
              <polyline
                points={mark.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={MARKS_BLUE}
                strokeWidth={width * 2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {at && (
              <>
                <circle cx={at.x} cy={at.y} r={10 / k} fill={MARKS_BLUE} />
                <text
                  x={at.x}
                  y={at.y}
                  dy={4 / k}
                  fontSize={12 / k}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontWeight={700}
                >
                  {n + 1}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}
