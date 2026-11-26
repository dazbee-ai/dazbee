'use client'

// Export: the frames of one page, each with a tick, the page's starred frames ticked at first, or
// every frame when none is starred, as PNG, JPG, WebP, PDF or SVG, the first three at 1x, 2x or 3x;
// the editor's export worker draws them while the stage stays responsive. The frames are listed
// under their sections' titles (`export-frame-list.tsx`), and the ticked ones export in that order.
// One file downloads as itself, more as one zip.
import { useState } from 'react'

import type { Editor } from '@dazbee/editor'
import {
  DEFAULT_EXPORT_NAME,
  type Design,
  EXPORT_SCALES,
  exportFits,
  type ExportScale,
  ExportType,
  type Frame,
  inOrder,
  isRasterExport,
  numberedFrameNames,
} from '@dazbee/schema'

import { NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import { useShownPage } from '@/components/editor/editor-hooks.ts'
import { ExportCheck } from '@/components/editor/menus/export-check.tsx'
import { ExportFrameList } from '@/components/editor/menus/export-frame-list.tsx'
import { exportGroups, firstTicks, shownOrder, type Ticked } from '@/components/editor/menus/export-ticks.ts'
import { FIELD, FIELD_LABEL } from '@/components/editor/styles.ts'
import { Button } from '@/components/ui/button.tsx'
import { SEGMENT, SEGMENTS, TOUCH_FIELD } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { Select } from '@/components/ui/select.tsx'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { counted, format } from '@/lib/i18n/index.ts'

/** The scales as the Scale row's choices. */
const SCALES = EXPORT_SCALES.map(String) as readonly `${ExportScale}`[]
/** The most frames a tooltip names before "and N more". */
const NAMED = 3
/** A name kept whole in text of either direction. */
const isolated = (text: string) => `\u2068${text}\u2069`

const LABEL = FIELD_LABEL

/** A button that applies but has nothing to do: faded and unlit, as a disabled one looks, yet it takes the pointer. */
const GREYED = 'cursor-not-allowed opacity-50 hover:bg-accent-solid active:scale-100'

function download(name: string, type: string, bytes: Uint8Array<ArrayBuffer>) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // The download has its own copy once it starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * The export form, opened from the Share menu with the shown page's first ticks (`firstTicks`), or
 * from a picked frame's ⋯ with `asked`, its frame, ticked alone. Another page, picked here or shown
 * on the canvas, starts with its own first ticks.
 */
export function ExportForm({
  id,
  editor,
  design,
  asked,
}: {
  id: string
  editor: Editor
  design: Design
  asked?: readonly string[] | undefined
}) {
  const t = useMessages()
  const locale = useLocale()
  const pages = inOrder(design.pages)
  // The page: the one picked here, or the asked frames', while it exists; else the one the canvas shows.
  const shown = useShownPage(editor)
  const [chosen, setChosen] = useState<string | null>(() => (asked?.[0] && design.frames[asked[0]]?.pageId) || null)
  const thisPage = chosen && Object.hasOwn(design.pages, chosen) ? chosen : shown
  const [ticks, setTicks] = useState<{ pageId: string; ticked: Ticked }>(() => ({
    pageId: thisPage,
    ticked: asked ? new Set(asked) : firstTicks(design, thisPage),
  }))
  const ticked = ticks.pageId === thisPage ? ticks.ticked : firstTicks(design, thisPage)
  const [name, setName] = useState(DEFAULT_EXPORT_NAME)
  const [type, setType] = useState<ExportType>('png')
  const [quality, setQuality] = useState(90)
  const [scale, setScale] = useState<ExportScale>(1)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The page's frames as the list shows them, each by its numbered name; the ticked ones are exported, in that order.
  const groups = exportGroups(design, thisPage)
  const names = numberedFrameNames(design, thisPage)
  const isTicked = (frameId: string) => ticked === 'all' || ticked.has(frameId)
  const frameIds = shownOrder(groups).filter(isTicked)
  const count = frameIds.length
  const raster = isRasterExport(type)
  // Ticked frames too big to draw as an image at this scale: Export waits until they fit. Those too
  // big at 1x too are named alone, as only a PDF or an SVG takes them.
  const tooBig = raster ? frameIds.filter((frameId) => !exportFits(design.frames[frameId] as Frame, scale)) : []
  const neverFit = tooBig.filter((frameId) => !exportFits(design.frames[frameId] as Frame, 1))
  const words = t.editor.exports
  const listed = (ids: readonly string[]) => {
    const named = ids.slice(0, NAMED).map((frameId) => {
      const number = names.get(frameId)?.number ?? null
      const own = design.frames[frameId]?.name ?? frameId
      return isolated(number === null ? own : `${own} ${number}`)
    })
    if (ids.length > NAMED) named.push(counted(locale, words.check.more, ids.length - NAMED))
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(named)
  }
  const tooBigWords = () =>
    neverFit.length > 0
      ? format(words.tooBigForImage, { frames: listed(neverFit) })
      : format(words.tooBig, { frames: listed(tooBig), scale: isolated(format(words.scaleValue, { scale })) })
  const waitsFor = count === 0 ? words.tickOne : tooBig.length > 0 ? tooBigWords() : null

  const choosePage = (pageId: string) => {
    setChosen(pageId)
    setTicks({ pageId, ticked: firstTicks(design, pageId) })
  }
  const tick = (ids: readonly string[], on: boolean) => {
    const next = new Set(frameIds)
    for (const frameId of ids) {
      if (on) next.add(frameId)
      else next.delete(frameId)
    }
    setTicks({ pageId: thisPage, ticked: next })
  }

  const run = async () => {
    setError(null)
    setProgress({ done: 0, total: count })
    try {
      const file = await editor.exportFiles(
        { frameIds, type, quality, scale, name: name.trim() || DEFAULT_EXPORT_NAME },
        (done, total) => setProgress({ done, total }),
      )
      download(file.name, file.type, file.bytes as Uint8Array<ArrayBuffer>)
    } catch (reason) {
      setError(format(t.editor.exports.failed, { reason: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div
      id={id}
      role="dialog"
      aria-labelledby={`${id}-title`}
      data-testid="export"
      className="modal-in absolute end-0 top-full z-30 mt-2 flex w-80 flex-col gap-3 rounded-card surface-frost p-3"
    >
      <h2 id={`${id}-title`} className="px-0.5 font-display text-card font-bold tracking-tight">
        {t.editor.exports.title}
      </h2>
      {/* Another page's frames can be the ones. */}
      {pages.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>{t.editor.exports.page}</span>
          <Select
            name="page"
            label={t.editor.exports.page}
            value={thisPage}
            options={pages.map(([pageId, p]) => ({ value: pageId, label: p.name }))}
            onChange={choosePage}
            testId="export-page"
            className="h-8 bg-raised px-2 text-small"
          />
        </div>
      )}

      <div role="group" aria-labelledby={`${id}-frames`} className="flex flex-col gap-1.5">
        <span id={`${id}-frames`} className={LABEL}>
          {t.editor.exports.frames}
        </span>
        <ExportFrameList
          editor={editor}
          groups={groups}
          names={names}
          isTicked={isTicked}
          onTickAll={(on) => setTicks({ pageId: thisPage, ticked: on ? 'all' : new Set() })}
          onTick={tick}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>{t.editor.exports.type}</span>
        <RadioGroup
          label={t.editor.exports.type}
          options={ExportType.options}
          value={type}
          onPick={setType}
          className={SEGMENTS}
        >
          {ExportType.options.map((value) => (
            <Radio key={value} value={value} data-type={value} className={cn(SEGMENT, 'uppercase')}>
              {value}
            </Radio>
          ))}
        </RadioGroup>
      </div>

      {/* PDF and SVG are vectors, drawn at any size, so only images take a scale. */}
      {raster && (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>{words.scale}</span>
          <RadioGroup
            label={words.scale}
            options={SCALES}
            value={`${scale}`}
            onPick={(to) => setScale(Number(to) as ExportScale)}
            className={SEGMENTS}
          >
            {SCALES.map((value) => (
              <Radio key={value} value={value} data-scale={value} className={SEGMENT}>
                <span dir="ltr">{format(words.scaleValue, { scale: value })}</span>
              </Radio>
            ))}
          </RadioGroup>
        </div>
      )}

      {(type === 'jpg' || type === 'webp') && (
        <div className="flex flex-col gap-1.5">
          <NumberField
            label={words.quality}
            name={words.quality}
            describedBy={type === 'webp' ? `${id}-lossless` : undefined}
            value={quality}
            min={1}
            max={100}
            testId="export-quality"
            onSet={(to) => setQuality(Math.round(to))}
            onEach={(change) => setQuality((now) => Math.round(Math.min(100, Math.max(1, change(now)))))}
          />
          {type === 'webp' && (
            <p id={`${id}-lossless`} className="px-0.5 text-tiny text-muted" data-testid="export-quality-hint">
              {words.lossless}
            </p>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>{t.editor.exports.fileNames}</span>
        <input
          name="file-names"
          value={name}
          maxLength={200}
          spellCheck={false}
          placeholder={DEFAULT_EXPORT_NAME}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          data-testid="export-name"
          className={FIELD}
        />
      </label>

      {waitsFor !== null && progress === null ? (
        // Greyed with nothing ticked or a frame too big, still under the pointer and the keyboard, so its tooltip says why.
        <Tooltip label={waitsFor}>
          <Button variant="primary" aria-disabled="true" data-testid="export-run" className={cn(TOUCH_FIELD, GREYED)}>
            {counted(locale, t.editor.exports.run, count)}
          </Button>
        </Tooltip>
      ) : (
        <Button
          variant="primary"
          disabled={progress !== null}
          onClick={() => void run()}
          data-testid="export-run"
          className={TOUCH_FIELD}
        >
          {progress
            ? format(t.editor.exports.making, { done: progress.done, total: progress.total })
            : counted(locale, t.editor.exports.run, count)}
        </Button>
      )}
      <ExportCheck editor={editor} design={design} frameIds={frameIds} />
      {error && (
        <p role="alert" className="text-tiny text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
