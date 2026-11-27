'use client'

// The glass bar above a picked AI frame, in a tab that may change the design: a small bar of light frosted glass over
// the frame's label, holding its AI actions as icons with labels and the star. More like this makes four new drafts
// in a new section right of the draft's section, joined to it by a connector. Hovering an AI action shows about how
// much of the workspace's AI it takes and how long, asked once per action and mode while the design is open. While
// the frame waits for its picture or is being made editable, its AI actions are off and the bar says "Working…". It
// folds away while a gesture runs, and a copy of an AI frame, a plain frame, gets none. Why an action didn't start
// shows in one quiet line under it.
import { useEffect, useState } from 'react'

import type { BriefStarted, Editor } from '@dazbee/editor'
import type { AiEstimate, AiFeature, AiMode } from '@dazbee/schema'

import { editState, useEditState } from '@/components/editor/edit-store.ts'
import { useDesignAi, usePickedFrame } from '@/components/editor/editor-hooks.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { useWheelThrough } from '@/components/editor/wheel-through.ts'
import { CircleNotchIcon, SparkleIcon, StarIcon, WarningCircleIcon } from '@/components/ui/icons.tsx'
import { Tooltip, TooltipRow } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { aiEstimate } from '@/lib/editor/ai-client.ts'
import { briefSaid } from '@/lib/editor/brief-box.ts'
import {
  ESTIMATES,
  estimateWords,
  type GlassFrame,
  glassFrame,
  type GlassPlace,
  glassPlace,
} from '@/lib/editor/glass-bar.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** A labelled action of the bar, its focus ring in Dazbee's blue inside it. */
const ACTION = cn(
  'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-small text-text transition-colors duration-[var(--chrome-fast)] hover:bg-hover active:bg-pressed disabled:cursor-not-allowed disabled:opacity-45',
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--stage-accent)',
)

/**
 * Where the bar goes over the frame, kept current as the view moves and the frame changes; null while a gesture runs
 * or the frame is off the stage, when it folds away.
 */
function usePlace(editor: Editor, frameId: string, bar: HTMLElement | null): GlassPlace | null {
  const [place, setPlace] = useState<GlassPlace | null>(null)
  const { islandsBottom } = useEditState()
  useEffect(() => {
    if (!bar) return
    const stage = bar.offsetParent as HTMLElement | null
    const update = () => {
      const label = editor.labelRect(frameId)
      const frame = editor.design().frames[frameId]
      if (!stage || !label || !frame || editor.busy()) return setPlace(null)
      const origin = stage.getBoundingClientRect()
      const start = editor.screenPoint(0, 0, frameId)
      const end = editor.screenPoint(frame.width, frame.height, frameId)
      const room = stage.clientWidth
      if (end.x - origin.left < 0 || start.x - origin.left > room || end.y - origin.top < 0) return setPlace(null)
      const at = glassPlace({
        frame: { left: Math.min(start.x, end.x) - origin.left, right: Math.max(start.x, end.x) - origin.left },
        label: label.y,
        title: frame.sectionId ? editor.titleRect(frame.sectionId) : null,
        width: bar.offsetWidth,
        height: bar.offsetHeight,
        room,
        under: editState().islandsBottom,
      })
      setPlace((now) => (now && now.left === at.left && now.top === at.top ? now : at))
    }
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    const stopShown = editor.onShown(update)
    const resize = new ResizeObserver(later)
    resize.observe(bar)
    window.addEventListener('pointerup', later)
    return () => {
      cancelAnimationFrame(frame)
      stopShown()
      resize.disconnect()
      window.removeEventListener('pointerup', later)
    }
  }, [editor, frameId, bar, islandsBottom])
  return place
}

export function GlassBar({ workspaceId, brandId, editor }: { workspaceId: string; brandId: string; editor: Editor }) {
  const viewOnly = useViewOnly()
  const frameId = usePickedFrame(editor)
  const ai = useDesignAi(editor)
  const shown = viewOnly ? null : glassFrame(ai, frameId)
  if (!shown || frameId === null) return null
  return (
    <FrameBar
      key={frameId}
      workspaceId={workspaceId}
      brandId={brandId}
      editor={editor}
      frameId={frameId}
      shown={shown}
    />
  )
}

/** The bar of the picked AI frame `frameId`, as `shown` says it shows. */
function FrameBar({
  workspaceId,
  brandId,
  editor,
  frameId,
  shown,
}: {
  workspaceId: string
  brandId: string
  editor: Editor
  frameId: string
  shown: GlassFrame
}) {
  const t = useMessages()
  const g = t.editor.glass
  const { design } = useLiveDesign(editor)
  const frame = design.frames[frameId]
  const [bar, setBar] = useState<HTMLDivElement | null>(null)
  const place = usePlace(editor, frameId, bar)
  useWheelThrough(bar)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  if (!frame) return null
  const starred = frame.starred === true

  async function moreLikeThis() {
    if (!frame) return
    setBusy(true)
    setSaid(null)
    let started: BriefStarted
    try {
      started = await editor.moreLikeThis({
        frameId,
        title: format(g.moreLikeTitle, { name: frame.name }),
        draftName: (n) => format(t.editor.brief.draftName, { n: n + 1 }),
      })
    } catch {
      started = { ok: false, refusal: null, message: 'lost', unknown: true }
    } finally {
      setBusy(false)
    }
    if (started.ok) {
      editor.fitSection(started.sectionId)
      return
    }
    const why = briefSaid(started)
    setSaid(why === 'notStarted' || why === 'unknown' ? g[why] : t.editor.brief[why])
  }

  return (
    <TooltipRow>
      <div
        ref={setBar}
        role="toolbar"
        aria-label={g.label}
        data-testid="glass-bar"
        data-frame={frameId}
        style={place ? { left: place.left, top: place.top } : undefined}
        className={cn('absolute z-20 flex flex-col items-center gap-1 font-sans', place ? 'visible' : 'invisible')}
      >
        <div className="flex items-center gap-0.5 rounded-full surface-frost p-1">
          {shown.working ? (
            <span role="status" className="flex h-8 items-center gap-1.5 px-3 text-small text-muted">
              <CircleNotchIcon size={14} aria-hidden className="animate-spin" />
              {g.working}
            </span>
          ) : (
            shown.moreLike && (
              <AiAction
                workspaceId={workspaceId}
                brandId={brandId}
                editor={editor}
                action="more-like-this"
                mode={shown.mode}
                name={g.moreLikeThis}
              >
                <button
                  type="button"
                  data-action="more-like-this"
                  disabled={busy}
                  onClick={() => void moreLikeThis()}
                  className={ACTION}
                >
                  {busy ? (
                    <CircleNotchIcon size={16} aria-hidden className="animate-spin" />
                  ) : (
                    <SparkleIcon size={16} aria-hidden />
                  )}
                  {g.moreLikeThis}
                </button>
              </AiAction>
            )
          )}
          <Tooltip plain label={starred ? t.editor.frames.unstar : t.editor.frames.star}>
            <button
              type="button"
              data-action="star"
              aria-label={starred ? t.editor.frames.unstar : t.editor.frames.star}
              aria-pressed={starred}
              onClick={() => editor.session.run('frame.update', { frameId, starred: !starred })}
              className={cn(ACTION, 'px-2', starred && 'text-(--star)')}
            >
              {starred ? <StarIcon size={16} weight="fill" aria-hidden /> : <StarIcon size={16} aria-hidden />}
            </button>
          </Tooltip>
        </div>
        {said && (
          <p
            role="status"
            data-testid="glass-said"
            className="flex max-w-80 items-center gap-1.5 rounded-[12px] surface-frost px-3 py-1.5 text-small text-muted"
          >
            <WarningCircleIcon size={14} aria-hidden className="shrink-0" />
            {said}
          </p>
        )}
      </div>
    </TooltipRow>
  )
}

/** An AI action with its tooltip: the action's name, then what it takes once the estimate is asked, on first hover. */
function AiAction({
  workspaceId,
  brandId,
  editor,
  action,
  mode,
  name,
  children,
}: {
  workspaceId: string
  brandId: string
  editor: Editor
  action: AiFeature
  mode: AiMode
  name: string
  children: React.ReactNode
}) {
  const g = useMessages().editor.glass
  const [estimate, setEstimate] = useState<AiEstimate | null>(null)
  const ask = () => {
    if (estimate) return
    ESTIMATES.get(editor, action, mode, () => aiEstimate(workspaceId, brandId, { action, mode }))
      .then(setEstimate)
      .catch(() => {
        // No estimate: the tooltip keeps the action's name.
      })
  }
  return (
    <span onPointerEnter={ask} onFocus={ask} className="contents">
      <Tooltip plain label={estimateWords(estimate, name, g)}>
        {children}
      </Tooltip>
    </span>
  )
}
