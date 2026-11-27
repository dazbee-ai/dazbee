'use client'

// Refine with AI on a picked AI frame: a small box of light frosted glass under the frame. The person writes what to
// change and may mark places over the frame with a box or a brush in Dazbee's blue, numbered in the order drawn and
// kept until sent or cleared. Send uploads the marks as one picture and starts the refine; the new version replaces
// the picture in the frame as it arrives, while the frame shows its sheen. The latest exchange (the person's words and
// the version's summary) shows above the field, earlier ones folded behind Earlier, read from the frame's refines, so
// they survive a reload. A refine that didn't work says so, with Retry. On an editable frame it changes only the
// picture layer selected in the frame, and asks for one when none is; marks are drawn over a frame's whole picture
// only. The words and marks are kept while the box is closed, until they are sent or cleared. The box folds away
// while a gesture runs; Reviewers never get it.
import { type KeyboardEvent, useEffect, useState } from 'react'

import { type Editor, shownPicture } from '@dazbee/editor'
import { type AiRefineView, jobRunning, pictureLayerOf } from '@dazbee/schema'

import { useDesignAi, useSelection } from '@/components/editor/editor-hooks.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useWheelThrough } from '@/components/editor/wheel-through.ts'
import {
  ArrowUpIcon,
  CircleNotchIcon,
  CursorIcon,
  PencilSimpleIcon,
  SquareIcon,
  WarningCircleIcon,
  XIcon,
} from '@/components/ui/icons.tsx'
import { Tooltip, TooltipRow } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { aiRefines } from '@/lib/editor/ai-client.ts'
import { briefSaid } from '@/lib/editor/brief-box.ts'
import {
  drawMarks,
  type Mark,
  marksSize,
  REFINE_DRAFTS,
  refineBoxPlace,
  refineLayer,
  type Size,
} from '@/lib/editor/refine.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { sendAsset } from '@/lib/upload-asset.ts'

import { useFrameRect } from './frame-rect.ts'
import { MarksLayer,type MarkTool } from './marks-layer.tsx'

/** A quiet round icon button of the box, its focus ring in Dazbee's blue. */
const ICON = cn(
  'grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text active:bg-pressed aria-pressed:bg-hover aria-pressed:text-(--stage-accent) disabled:cursor-not-allowed disabled:opacity-45',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--stage-accent)',
)
/** The box's width in pixels. */
const WIDTH = 360

/**
 * The frame's refines, read when the box opens and again whenever the design's AI frames change what they say of
 * the frame's refines; null before the first read.
 */
function useRefines(workspaceId: string, brandId: string, editor: Editor, frameId: string): AiRefineView[] | null {
  const ai = useDesignAi(editor)
  const [refines, setRefines] = useState<AiRefineView[] | null>(null)
  const designId = editor.design().meta.designId
  const own = (ai?.refines ?? []).filter((r) => r.frameId === frameId)
  const key = own
    .map((r) => `${r.id}:${r.resultAssetId ?? ''}:${ai?.jobs.find((j) => j.id === r.jobId)?.state ?? ''}`)
    .join(',')
  useEffect(() => {
    let live = true
    aiRefines(workspaceId, brandId, designId, frameId)
      .then((read) => live && setRefines(read))
      .catch(() => {
        // Offline: the next change of the design's AI frames reads again.
      })
    return () => {
      live = false
    }
  }, [workspaceId, brandId, designId, frameId, key])
  return refines
}

export function RefineBox({
  workspaceId,
  brandId,
  editor,
  frameId,
  onClose,
}: {
  workspaceId: string
  brandId: string
  editor: Editor
  frameId: string
  onClose: () => void
}) {
  const t = useMessages()
  const r = t.editor.refine
  const ai = useDesignAi(editor)
  const selection = useSelection(editor)
  const [box, setBox] = useState<HTMLElement | null>(null)
  const rect = useFrameRect(editor, frameId, box)
  const refines = useRefines(workspaceId, brandId, editor, frameId)
  const [kept] = useState(() => REFINE_DRAFTS.get(editor, frameId))
  const [words, setWords] = useState(kept.words)
  const [marks, setMarks] = useState<Mark[]>(kept.marks)
  const [tool, setTool] = useState<MarkTool>('none')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [earlier, setEarlier] = useState(false)
  useWheelThrough(box)
  // Kept as they change, so the box closed and opened again shows them.
  useEffect(() => REFINE_DRAFTS.set(editor, frameId, { words, marks }), [editor, frameId, words, marks])
  const { design } = useLiveDesign(editor)
  const frame = design.frames[frameId]
  const layer = refineLayer(
    ai,
    frameId,
    selection.map((id) => {
      const node = design.nodes[id]
      return { id, parentId: node?.parentId ?? '', image: Boolean(node && shownPicture(node)) }
    }),
  )
  // Marks are drawn over the frame, so they mark its whole picture, not a layer of an editable frame.
  const marking = layer === pictureLayerOf(frameId)
  const latest = refines?.at(-1)
  const working = jobRunning(latest?.job)
  const failed = latest?.job.state === 'failed' || latest?.job.state === 'cancelled'
  const ready = Boolean(layer && words.trim() !== '' && !busy && !working)

  async function send(message: string, marksAssetId?: string) {
    if (!layer || !frame) return
    setBusy(true)
    setSaid(null)
    try {
      const uploaded = marksAssetId ?? (marking && marks.length > 0 ? await uploadMarks(marks, frame) : undefined)
      const started = await editor.refine({
        frameId,
        pictureLayerId: layer,
        message,
        ...(uploaded ? { marksAssetId: uploaded } : {}),
      })
      if (!started.ok) {
        setSaid(started.refusal ? t.editor.brief[briefSaid(started)] : r.notStarted)
        return
      }
      setWords('')
      setMarks([])
      setTool('none')
    } catch {
      setSaid(r.notStarted)
    } finally {
      setBusy(false)
    }
  }

  /** The marks drawn as one picture at the frame's proportions, uploaded to the brand; its asset's id. */
  async function uploadMarks(drawn: readonly Mark[], size: Size): Promise<string> {
    const picture = marksSize(size)
    const canvas = document.createElement('canvas')
    Object.assign(canvas, picture)
    const pen = canvas.getContext('2d')
    if (!pen) throw new Error('no 2D canvas for the marks')
    drawMarks(pen, drawn, size, picture)
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
    if (!blob) throw new Error('the marks could not be drawn')
    const asset = await sendAsset(workspaceId, brandId, new File([blob], 'marks.png', { type: 'image/png' }), () => {})
    return asset.id
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') onClose()
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (ready) void send(words.trim())
  }

  const stage = box?.offsetParent as HTMLElement | null | undefined
  const place =
    rect && box && stage
      ? refineBoxPlace(
          rect,
          { width: WIDTH, height: box.offsetHeight },
          { width: stage.clientWidth, height: stage.clientHeight },
        )
      : null
  return (
    <>
      {rect && frame && marking && (marks.length > 0 || tool !== 'none') && (
        <MarksLayer
          rect={rect}
          frame={frame}
          marks={marks}
          tool={tool}
          onMark={(mark) => setMarks((all) => [...all, mark])}
        />
      )}
      <TooltipRow>
        <section
          ref={setBox}
          aria-label={r.label}
          data-testid="refine-box"
          data-frame={frameId}
          style={place ? { left: place.left, top: place.top, width: WIDTH } : { width: WIDTH }}
          className={cn(
            'absolute z-20 flex flex-col gap-2 rounded-[20px] surface-frost px-3.5 pt-3 pb-2 font-sans',
            place ? 'visible' : 'invisible',
          )}
        >
          <Tooltip plain label={r.close}>
            <button
              type="button"
              aria-label={r.close}
              onClick={onClose}
              className={cn(ICON, 'absolute end-1.5 top-1.5 size-7')}
            >
              <XIcon size={13} aria-hidden />
            </button>
          </Tooltip>
          {refines && refines.length > 1 && (
            <div className="pe-8">
              <button
                type="button"
                aria-expanded={earlier}
                onClick={() => setEarlier((open) => !open)}
                className="cursor-pointer text-tiny text-muted hover:text-text"
              >
                {format(r.earlier, { n: refines.length - 1 })}
              </button>
              {earlier && (
                <ol className="mt-1 flex max-h-40 flex-col gap-2 overflow-y-auto" data-testid="refine-earlier">
                  {refines.slice(0, -1).map((refine) => (
                    <Exchange key={refine.id} refine={refine} />
                  ))}
                </ol>
              )}
            </div>
          )}
          {latest && (
            <div className="max-h-32 overflow-y-auto pe-8" data-testid="refine-latest">
              <Exchange refine={latest} />
              {failed && (
                <p className="mt-1 flex items-center gap-1.5 text-tiny text-muted">
                  <WarningCircleIcon size={13} aria-hidden className="shrink-0" />
                  {r.failed}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(latest.message, latest.marksAssetId ?? undefined)}
                    className="cursor-pointer font-semibold text-accent-text hover:underline disabled:opacity-45"
                  >
                    {r.retry}
                  </button>
                </p>
              )}
            </div>
          )}
          <textarea
            // The box opens for the words.
            autoFocus
            name="refine"
            rows={2}
            value={words}
            maxLength={4000}
            onChange={(event) => {
              setWords(event.target.value)
              setSaid(null)
            }}
            onKeyDown={onKey}
            aria-label={r.label}
            placeholder={r.placeholder}
            className="w-[calc(100%-2rem)] resize-none border-0 bg-transparent text-small leading-[1.45] text-text outline-none placeholder:text-subtle"
          />
          {(said ?? (!layer ? r.selectPicture : null)) && (
            <p role="status" data-testid="refine-said" className="flex items-center gap-1.5 text-tiny text-muted">
              <WarningCircleIcon size={13} aria-hidden className="shrink-0" />
              {said ?? r.selectPicture}
            </p>
          )}
          <div className="-ms-1 flex items-center gap-0.5">
            {(marking ? (['none', 'box', 'brush'] as const) : []).map((each) => (
              <Tooltip key={each} plain label={r.tools[each]}>
                <button
                  type="button"
                  aria-label={r.tools[each]}
                  aria-pressed={tool === each}
                  data-tool={each}
                  onClick={() => setTool(each)}
                  className={ICON}
                >
                  {each === 'none' ? (
                    <CursorIcon size={15} aria-hidden />
                  ) : each === 'box' ? (
                    <SquareIcon size={15} aria-hidden />
                  ) : (
                    <PencilSimpleIcon size={15} aria-hidden />
                  )}
                </button>
              </Tooltip>
            ))}
            {marks.length > 0 && (
              <button
                type="button"
                onClick={() => setMarks([])}
                className="ms-1 cursor-pointer text-tiny text-muted hover:text-text"
              >
                {format(r.clear, { n: marks.length })}
              </button>
            )}
            <Tooltip plain label={r.send}>
              <button
                type="button"
                aria-label={busy || working ? r.working : r.send}
                disabled={!ready}
                onClick={() => void send(words.trim())}
                className="ms-auto grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent-solid text-on-accent hover:bg-accent-solid-hover disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy || working ? (
                  <CircleNotchIcon size={15} aria-hidden className="animate-spin" />
                ) : (
                  <ArrowUpIcon size={15} weight="bold" aria-hidden />
                )}
              </button>
            </Tooltip>
          </div>
        </section>
      </TooltipRow>
    </>
  )
}

/** One exchange: the person's words, then the version's summary, or Working… while it is made. */
function Exchange({ refine }: { refine: AiRefineView }) {
  const r = useMessages().editor.refine
  const working = jobRunning(refine.job)
  return (
    <li className="flex list-none flex-col gap-0.5">
      <span className="text-small text-text">{refine.message}</span>
      {working ? (
        <span className="flex items-center gap-1 text-tiny text-muted">
          <CircleNotchIcon size={11} aria-hidden className="animate-spin" />
          {r.working}
        </span>
      ) : (
        refine.summary && <span className="text-tiny text-(--stage-accent)">{refine.summary}</span>
      )}
    </li>
  )
}
