'use client'

// Export's list of frames: a row for every frame of the page, each with a tick, after a row that
// ticks them all; a row under the pointer or with the keyboard focus lights its frame on the canvas.
import { type FocusEvent, useEffect, useRef } from 'react'

import type { Editor } from '@dazbee/editor'
import type { Frame, NumberedName } from '@dazbee/schema'

import { SizeText } from '@/components/editor/size-text.tsx'
import { LIT_ROW, MENU_VALUE } from '@/components/ui/looks.ts'
import { useOverlayScroll } from '@/components/ui/overlay-scroll.ts'
import { Tick } from '@/components/ui/tick.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { usePhone } from '@/lib/phone.ts'

/** Which of the page's frames are ticked: every one, or these. */
export type Ticked = 'all' | ReadonlySet<string>

/**
 * The frames list: its rows as tall as a menu's (MENU_ITEM), 44 px on a phone for a finger, and as
 * tall as eight and a half of them, five and a half on a phone, so the part of the next row at the
 * bottom edge shows that it scrolls.
 */
const FRAMES_LIST =
  '-mx-1 flex max-h-[calc(var(--frame-row)*8.5)] flex-col overflow-y-auto px-1 [--frame-row:calc(var(--spacing)*9)] max-sm:max-h-[calc(var(--frame-row)*5.5)] max-sm:[--frame-row:44px]'

/**
 * A frame's row, its tick in a hidden checkbox: as tall as the list says (FRAMES_LIST), lit under the
 * pointer and while pressed, ringed when reached by keyboard.
 */
const ROW = `flex h-(--frame-row) w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-row px-2 text-start text-small font-medium text-text transition-colors duration-[var(--chrome-fast)] ${LIT_ROW} has-[:focus-visible]:bg-hover has-[:focus-visible]:lit has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent`

/** Scrolls the list so the row holding a control that took the focus shows whole, its ring and all. */
function showWhole(control: HTMLElement) {
  const row = control.closest('label')
  const list = row?.parentElement
  if (!row || !list) return
  const [box, at] = [list.getBoundingClientRect(), row.getBoundingClientRect()]
  // Whole pixels, rounded out, as rows sit on fractions of one.
  if (at.top < box.top) list.scrollTop -= Math.ceil(box.top - at.top)
  else if (at.bottom > box.bottom) list.scrollTop += Math.ceil(at.bottom - box.bottom)
}

/**
 * Lights a frame on the canvas while its row is under the pointer or has the keyboard focus, the
 * pointer's first, and none once the list goes; returns the handlers a frame's row takes.
 */
function useLitFrame(editor: Editor) {
  const under = useRef<string | null>(null)
  const focused = useRef<string | null>(null)
  useEffect(() => () => editor.lightFrame(null), [editor])
  const show = () => editor.lightFrame(under.current ?? focused.current)
  return (frameId: string) => ({
    onPointerEnter: () => {
      under.current = frameId
      show()
    },
    onPointerLeave: () => {
      if (under.current === frameId) under.current = null
      show()
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      focused.current = (event.target as HTMLElement).matches(':focus-visible') ? frameId : null
      show()
    },
    onBlur: () => {
      if (focused.current === frameId) focused.current = null
      show()
    },
  })
}

export function ExportFrameList({
  editor,
  frames,
  names,
  isTicked,
  allTicked,
  setTicked,
  tick,
}: {
  editor: Editor
  frames: [string, Frame][]
  names: ReadonlyMap<string, NumberedName>
  isTicked: (frameId: string) => boolean
  allTicked: boolean | 'mixed'
  setTicked: (ticked: Ticked) => void
  tick: (frameId: string, on: boolean) => void
}) {
  const t = useMessages()
  const lightsFrame = useLitFrame(editor)
  // On a phone the list's bar stays shown, as no pointer hovers to bring it up.
  const list = useRef<HTMLDivElement>(null)
  const listRef = useOverlayScroll(list, { shown: usePhone() })
  return frames.length === 0 ? (
    <p className="text-small text-muted" data-testid="export-no-frames">
      {t.editor.exports.noFrames}
    </p>
  ) : (
    <div ref={listRef} className={FRAMES_LIST} data-testid="export-frames">
      {frames.length > 1 && <AllFramesRow on={allTicked} onTick={(on) => setTicked(on ? 'all' : new Set())} />}
      {frames.map(([frameId, frame]) => (
        <FrameRow
          key={frameId}
          frameId={frameId}
          frame={frame}
          number={names.get(frameId)?.number ?? null}
          on={isTicked(frameId)}
          onTick={(on) => tick(frameId, on)}
          lights={lightsFrame(frameId)}
        />
      ))}
    </div>
  )
}

/** The row that ticks every frame of the page, or unticks them all; a dash while only some are ticked. */
function AllFramesRow({ on, onTick }: { on: boolean | 'mixed'; onTick: (on: boolean) => void }) {
  const t = useMessages()
  return (
    <label className={ROW} title={t.editor.exports.allFrames}>
      <TickBox on={on} onTick={onTick} name="all-frames" testId="export-all-frames" />
      <span className="min-w-0 flex-1 truncate font-semibold" data-part="name">
        {t.editor.exports.allFrames}
      </span>
    </label>
  )
}

/**
 * A frame's row: its tick, its own name as its label shows it, the number its file takes after it,
 * muted, and its size; under the pointer or with the keyboard focus it lights its frame on the canvas.
 */
function FrameRow({
  frameId,
  frame,
  number,
  on,
  onTick,
  lights,
}: {
  frameId: string
  frame: Frame
  /** The number added to the frame's name to keep its file's apart, or null. */
  number: number | null
  on: boolean
  onTick: (on: boolean) => void
  lights: ReturnType<ReturnType<typeof useLitFrame>>
}) {
  return (
    <label className={ROW} title={number === null ? frame.name : `${frame.name} ${number}`} {...lights}>
      <TickBox on={on} onTick={onTick} name="frame" testId="export-frame" frameId={frameId} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1">
        <span className="truncate" data-part="name">
          {frame.name}
        </span>
        {number !== null && (
          <span className="shrink-0 text-muted" data-part="number">
            {number}
          </span>
        )}
      </span>
      <SizeText size={frame} className={cn(MENU_VALUE, 'shrink-0')} data-part="size" />
    </label>
  )
}

/**
 * A row's tick: a checkbox the eye doesn't see, drawn as Tick; as it takes the focus, its row
 * scrolls whole into view.
 */
function TickBox({
  on,
  onTick,
  name,
  testId,
  frameId,
}: {
  on: boolean | 'mixed'
  onTick: (on: boolean) => void
  name: string
  testId: string
  frameId?: string
}) {
  return (
    <>
      <input
        type="checkbox"
        name={name}
        value={frameId}
        checked={on === true}
        ref={(input) => {
          if (input) input.indeterminate = on === 'mixed'
        }}
        onChange={(event) => onTick(event.target.checked)}
        onFocus={(event) => showWhole(event.currentTarget)}
        className="sr-only"
        data-testid={testId}
        data-frame={frameId}
      />
      <Tick on={on} />
    </>
  )
}
