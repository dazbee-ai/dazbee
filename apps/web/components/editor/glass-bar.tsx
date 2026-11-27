'use client'

// The glass bar above a picked AI frame, in a tab that may change the design: a small bar of light frosted glass over
// the frame's label, holding its AI actions as icons with labels and the star. More like this makes four new drafts
// in a new section right of the draft's section, joined to it by a connector; Other sizes opens the Add size card to
// redraw it at the sizes picked; Refine with AI opens the refine box under the frame, and its picture versions show
// beside it; Make editable turns it into layers, and on a section of AI sizes Make all editable turns them all. Hovering an AI action shows about how
// much of the workspace's AI it takes and how long, asked once per action and mode while the design is open. While
// the frame waits for its picture, is refined or is being made editable, its AI actions are off and the bar says "Working…". It
// folds away while a gesture runs, and a copy of an AI frame, a plain frame, gets none. Why an action didn't start
// shows in one quiet line under it, and so does, the first time a person makes a picture editable, that its text can
// be fixed after.
import { useEffect, useState, useSyncExternalStore } from 'react'

import type { BriefStarted, Editor } from '@dazbee/editor'
import { type AiEstimate, type AiFeature, type AiMode, pictureLayerOf } from '@dazbee/schema'

import { editState, setOpen, useEditState } from '@/components/editor/edit-store.ts'
import { useDesignAi, usePickedFrame } from '@/components/editor/editor-hooks.ts'
import { PictureVersions } from '@/components/editor/refine/picture-versions.tsx'
import { RefineBox } from '@/components/editor/refine/refine-box.tsx'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { useWheelThrough } from '@/components/editor/wheel-through.ts'
import {
  CircleNotchIcon,
  MagicWandIcon,
  SparkleIcon,
  SquaresFourIcon,
  StackIcon,
  StarIcon,
  WarningCircleIcon,
} from '@/components/ui/icons.tsx'
import { Tooltip, TooltipRow } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { aiEstimate } from '@/lib/editor/ai-client.ts'
import { type SizesToLayer, sizesToLayer } from '@/lib/editor/ai-sizes.ts'
import { briefSaid } from '@/lib/editor/brief-box.ts'
import {
  editableAction,
  ESTIMATES,
  estimateWords,
  type GlassFrame,
  glassFrame,
  type GlassPlace,
  glassPlace,
  warmingUp,
} from '@/lib/editor/glass-bar.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** Where the browser remembers that the person was told Back to picture keeps their layers. */
const BACK_NOTE_KEY = 'dazbee:back-to-picture-told'
/** Where the browser remembers that the person was told text can be fixed after Make editable. */
const TEXT_HINT_KEY = 'dazbee:make-editable-told'

/** A labelled action of the bar, its focus ring in Dazbee's blue inside it. */
const ACTION = cn(
  'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-small text-text transition-colors duration-[var(--chrome-fast)] hover:bg-hover active:bg-pressed disabled:cursor-not-allowed disabled:opacity-45',
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--stage-accent)',
)

/** Make all editable asked of a frame's bar from the section's actions, run by the bar once it shows that frame. */
let askedFrame: string | null = null
const askedListeners = new Set<() => void>()

function onAsked(listener: () => void) {
  askedListeners.add(listener)
  return () => askedListeners.delete(listener)
}

/** Asks the glass bar of frame `frameId` to run Make all editable, so the bar says why when it doesn't start. */
export function askMakeAllEditable(frameId: string) {
  askedFrame = frameId
  for (const listener of askedListeners) listener()
}

/** Whether this is the first time on this browser for `key`, which it then remembers; true where storage is off. */
function firstTime(key: string): boolean {
  try {
    if (localStorage.getItem(key)) return false
    localStorage.setItem(key, '1')
  } catch {
    // Storage is off: the note shows each time.
  }
  return true
}

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
  const ai = useDesignAi(editor)
  const frame = design.frames[frameId]
  const [bar, setBar] = useState<HTMLDivElement | null>(null)
  const place = usePlace(editor, frameId, bar)
  useWheelThrough(bar)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [refining, setRefining] = useState(false)
  // A size of a section of AI sizes is made editable with the rest of them, in one job.
  const allSizes =
    frame?.sectionId && shown.frame.kind === 'size' && shown.frame.state === 'arrived'
      ? sizesToLayer(ai, design, frame.sectionId)
      : null
  const asked = useSyncExternalStore(
    onAsked,
    () => askedFrame,
    () => null,
  )
  useEffect(() => {
    if (asked !== frameId || !allSizes) return
    askedFrame = null
    void makeAllEditable(allSizes)
  })
  if (!frame) return null
  const starred = frame.starred === true
  const editable = editableAction(shown.frame, design)

  async function makeAllEditable(sizes: SizesToLayer) {
    setBusy(true)
    setSaid(null)
    try {
      const started = await editor.makeAllEditable(sizes.frameIds)
      if (!started.ok) setSaid(started.refusal ? t.editor.brief[briefSaid(started)] : g.notStarted)
      else if (firstTime(TEXT_HINT_KEY)) setSaid(g.textHint)
    } catch {
      setSaid(g.unknown)
    } finally {
      setBusy(false)
    }
  }

  async function makeEditable() {
    setBusy(true)
    setSaid(null)
    try {
      const started = await editor.makeEditable(frameId)
      if (!started.ok) setSaid(started.refusal ? t.editor.brief[briefSaid(started)] : g.notStarted)
      else if (firstTime(TEXT_HINT_KEY)) setSaid(g.textHint)
    } catch {
      setSaid(g.unknown)
    } finally {
      setBusy(false)
    }
  }

  /** Shows the picture with its layers hidden, or the layers over the hidden picture, as one undo step. */
  function showPicture(show: boolean, layerIds: string[]) {
    editor.session.run('frame.showPicture', { frameId, pictureLayerId: pictureLayerOf(frameId), layerIds, show })
    // The first Back to picture says the layers are kept, once per person.
    if (show && firstTime(BACK_NOTE_KEY)) setSaid(g.backKept)
  }

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
              {warmingUp(
                ai?.jobs.find((j) => j.id === shown.frame.jobId),
                Date.now(),
              )
                ? g.warmingUp
                : g.working}
            </span>
          ) : (
            <>
              {shown.moreLike && (
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
              )}
              {shown.refine && (
                <AiAction
                  workspaceId={workspaceId}
                  brandId={brandId}
                  editor={editor}
                  action="refine"
                  mode={shown.mode}
                  name={t.editor.refine.action}
                >
                  <button
                    type="button"
                    data-action="refine"
                    aria-expanded={refining}
                    onClick={() => setRefining((open) => !open)}
                    className={ACTION}
                  >
                    <MagicWandIcon size={16} aria-hidden />
                    {t.editor.refine.action}
                  </button>
                </AiAction>
              )}
              {editable && (
                <AiAction
                  workspaceId={workspaceId}
                  brandId={brandId}
                  editor={editor}
                  action="resize"
                  mode={shown.mode}
                  name={g.otherSizes}
                >
                  <button type="button" data-action="other-sizes" onClick={() => setOpen('addSize')} className={ACTION}>
                    <SquaresFourIcon size={16} aria-hidden />
                    {g.otherSizes}
                  </button>
                </AiAction>
              )}
              {allSizes && (
                <button
                  type="button"
                  data-action="make-all-editable"
                  disabled={busy}
                  onClick={() => void makeAllEditable(allSizes)}
                  className={cn(ACTION, 'text-muted')}
                >
                  <StackIcon size={16} aria-hidden />
                  {g.makeAllEditable}
                </button>
              )}
              {editable?.kind === 'make' && !allSizes && (
                <AiAction
                  workspaceId={workspaceId}
                  brandId={brandId}
                  editor={editor}
                  action="layering"
                  mode={shown.mode}
                  name={g.makeEditable}
                >
                  <button
                    type="button"
                    data-action="make-editable"
                    disabled={busy}
                    onClick={() => void makeEditable()}
                    className={cn(ACTION, 'text-muted')}
                  >
                    <StackIcon size={16} aria-hidden />
                    {g.makeEditable}
                  </button>
                </AiAction>
              )}
              {editable && editable.kind !== 'make' && (
                <button
                  type="button"
                  data-action={editable.kind === 'back' ? 'back-to-picture' : 'make-editable-again'}
                  onClick={() => showPicture(editable.kind === 'back', editable.layerIds)}
                  className={cn(ACTION, 'text-muted')}
                >
                  <StackIcon size={16} aria-hidden />
                  {editable.kind === 'back' ? g.backToPicture : g.makeEditable}
                </button>
              )}
            </>
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
      {refining && (
        <RefineBox
          workspaceId={workspaceId}
          brandId={brandId}
          editor={editor}
          frameId={frameId}
          onClose={() => setRefining(false)}
        />
      )}
      <PictureVersions
        workspaceId={workspaceId}
        brandId={brandId}
        editor={editor}
        frameId={frameId}
        layerId={pictureLayerOf(frameId)}
      />
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
