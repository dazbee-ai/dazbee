'use client'

// What the stage shows of the design's AI frames over the canvas, in a tab that may change the design: on each frame
// of the shown page whose picture didn't come out, a small note centred on it, "Didn't come out", with Try again and
// a line saying what wasn't charged, or, on a frame too small on screen for it, Try again alone; and just after each
// brief's section title, the brief's pictures as small square chips. Both follow the view as it moves. Try again
// starts the frame's picture again into the same frame; a refusal shows in the note.
import { useEffect, useState } from 'react'

import type { Editor } from '@dazbee/editor'

import { useDesignAi } from '@/components/editor/editor-hooks.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { ArrowsClockwiseIcon, CircleNotchIcon, WarningCircleIcon } from '@/components/ui/icons.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { briefChips, type FailedNote, failedNotes } from '@/lib/editor/ai-frame-notes.ts'
import { briefSaid } from '@/lib/editor/brief-box.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** The side of a brief's picture chip, in pixels. */
const CHIP = 22
/** Pixels between a section's title and its chips. */
const CHIP_GAP = 8
/** The narrowest a failed frame is on screen, in pixels, for its whole note; narrower, it shows Try again alone. */
const NOTE_WIDTH = 220

/**
 * A number that changes each time the stage is drawn again while `following`, so what follows the view is placed
 * again; with nothing to follow, the stage's draws render nothing here.
 */
function useMoved(editor: Editor, following: boolean): number {
  const [moved, setMoved] = useState(0)
  useEffect(() => {
    if (!following) return
    const stop = editor.onShown(() => setMoved((n) => n + 1))
    return () => {
      stop()
    }
  }, [editor, following])
  return moved
}

export function AiFrameNotes({
  workspaceId,
  brandId,
  editor,
}: {
  workspaceId: string
  brandId: string
  editor: Editor
}) {
  const viewOnly = useViewOnly()
  const ai = useDesignAi(editor)
  const { design } = useLiveDesign(editor)
  const [stage, setStage] = useState<HTMLElement | null>(null)
  const page = editor.shownPage()
  const notes = viewOnly ? [] : failedNotes(ai, design, page)
  const chips = briefChips(ai, design, page)
  const moved = useMoved(editor, notes.length > 0 || chips.length > 0)
  const origin = stage?.getBoundingClientRect()
  return (
    <div ref={(el) => setStage(el?.parentElement ?? null)} data-moved={moved} className="contents">
      {origin && notes.map((note) => <Note key={note.frameId} editor={editor} note={note} origin={origin} />)}
      {origin &&
        chips.map(({ sectionId, assetIds }) => {
          const title = editor.titleRect(sectionId)
          if (!title) return null
          // Just after the title's words, which may be shorter than the room the title has.
          const words = stage?.querySelector(`.stage-overlay .section-title[data-section="${CSS.escape(sectionId)}"]`)
          const end = words ? words.getBoundingClientRect().right - origin.left : title.x
          return (
            <ul
              key={sectionId}
              data-testid="brief-chips"
              data-section={sectionId}
              className="pointer-events-none absolute z-10 flex gap-1"
              style={{ left: end + CHIP_GAP, top: title.y + (title.height - CHIP) / 2 }}
            >
              {assetIds.map((id) => (
                <li key={id} className="overflow-hidden rounded-[6px] bg-hover" style={{ width: CHIP, height: CHIP }}>
                  <img
                    src={brandPath(workspaceId, brandId, 'assets', id, 'thumbnail')}
                    alt=""
                    className="size-full object-cover"
                  />
                </li>
              ))}
            </ul>
          )
        })}
    </div>
  )
}

/** A failed frame's note, centred on the frame as it is on the stage now; none for a frame off the stage. */
function Note({ editor, note, origin }: { editor: Editor; note: FailedNote; origin: DOMRect }) {
  const t = useMessages()
  const n = t.editor.aiFrames
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const frame = editor.design().frames[note.frameId]
  if (!frame) return null
  const start = editor.screenPoint(0, 0, note.frameId)
  const end = editor.screenPoint(frame.width, frame.height, note.frameId)
  const centre = { x: (start.x + end.x) / 2 - origin.left, y: (start.y + end.y) / 2 - origin.top }
  if (centre.x < 0 || centre.y < 0 || centre.x > origin.width || centre.y > origin.height) return null
  const whole = Math.abs(end.x - start.x) >= NOTE_WIDTH

  async function again() {
    setBusy(true)
    setSaid(null)
    try {
      const started = await editor.tryAgain(note.frameId)
      if (!started.ok) setSaid(started.refusal ? t.editor.brief[briefSaid(started)] : n.notTried)
    } catch {
      setSaid(n.notTried)
    } finally {
      setBusy(false)
    }
  }

  const icon = busy ? (
    <CircleNotchIcon size={14} aria-hidden className="animate-spin" />
  ) : (
    <ArrowsClockwiseIcon size={14} aria-hidden />
  )
  if (!whole)
    return (
      <button
        type="button"
        data-testid="ai-failed"
        data-frame={note.frameId}
        data-action="try-again"
        disabled={busy}
        aria-label={`${n.didntComeOut} · ${n.tryAgain} · ${said ?? n.notCharged[note.notCharged]}`}
        title={`${n.didntComeOut} · ${said ?? n.notCharged[note.notCharged]}`}
        onClick={() => void again()}
        className="absolute z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-accent-solid text-on-accent hover:bg-accent-solid-hover disabled:cursor-not-allowed disabled:opacity-45"
        style={{ left: centre.x, top: centre.y }}
      >
        {icon}
      </button>
    )
  return (
    <div
      role="status"
      data-testid="ai-failed"
      data-frame={note.frameId}
      className="absolute z-10 flex w-max max-w-64 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 rounded-[16px] surface-frost px-3.5 py-2.5 text-center font-sans"
      style={{ left: centre.x, top: centre.y }}
    >
      <span className="flex items-center gap-1.5 text-small text-text">
        <WarningCircleIcon size={14} aria-hidden className="shrink-0" />
        {n.didntComeOut}
      </span>
      <button
        type="button"
        data-action="try-again"
        disabled={busy}
        onClick={() => void again()}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-accent-solid px-3 text-small text-on-accent hover:bg-accent-solid-hover disabled:cursor-not-allowed disabled:opacity-45"
      >
        {icon}
        {n.tryAgain}
      </button>
      <span className="text-tiny text-muted">{said ?? n.notCharged[note.notCharged]}</span>
    </div>
  )
}
