'use client'

// A viewed version on the page: the viewer's canvas laid over the stage, and over it the bar that
// says which version shows, with Restore, Open as a copy and Back. Restore makes the design the
// version for everyone, as one undo step; Open as a copy makes a design of it in the same brand and
// goes there; Back returns to the live design as it was left. A Reviewer's bar has Back alone, and
// Restore is off while the tab is offline or the history can make no room for the version kept first.
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Editor, Insets, Viewer } from '@dazbee/editor'

import { copyVersionFromEditor } from '@/app/w/[workspaceId]/brands/[brandId]/designs/[designId]/actions.ts'
import { Button } from '@/components/ui/button.tsx'
import { ArrowArcLeftIcon, ArrowCounterClockwiseIcon, CopyIcon } from '@/components/ui/icons.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { useValue, type ValueStore } from '@/lib/editor/value-store.ts'
import {
  copyName,
  restoreBlocked,
  restoredWords,
  restoreMark,
  versionItems,
  viewingWords,
  whenSaved,
} from '@/lib/editor/versions.ts'
import { frameName } from '@/lib/frame-name.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { layerName } from '@/lib/layer-name.ts'

import {
  historyChanged,
  leaveVersions,
  listed,
  setCopyViewed,
  stopViewing,
  useVersionViewer,
  type ViewerSources,
  type Viewing,
  viewing,
} from './use-versions.ts'

/** The design the page has open, and the tab's state the bar reads. */
interface Opened {
  editor: Editor
  workspaceId: string
  brandId: string
  designId: string
  designName: string
  /** The tab's save state: Restore is off while Offline. */
  status: ValueStore<string>
  /** Whether the member's role writes: the live tab's, as the page views the version read-only. */
  writes: boolean
}

/**
 * The version viewed, while one is: its canvas over the stage and its bar. Tells `onRestored` what
 * to say once a restore is done.
 */
export function VersionStage({
  loads,
  zoom,
  insets,
  onRestored,
  ...opened
}: Opened & {
  /** How the live editor loads a design's images and fonts, which the version's load with too. */
  loads: Pick<ViewerSources, 'assetBytes' | 'fontFaces' | 'fontFile'>
  /** The zoom the page shows: the viewer's while it shows, the live editor's again after. */
  zoom: ValueStore<number | null>
  insets: Insets | null
  onRestored: (words: string) => void
}) {
  const t = useMessages()
  const shown = useValue(viewing)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const sources: ViewerSources = {
    ...loads,
    designId: opened.designId,
    typingFieldLabel: t.editor.typingField,
    frameName: (width, height) => frameName(t, width, height),
    layerName: (kind) => layerName(t, kind),
    radiusLabel: (radius) => format(t.editor.radiusPill, { radius }),
  }
  const viewer = useVersionViewer(opened.editor, { canvas, overlay }, sources, zoom, insets)
  // A page that leaves the design leaves no version viewed for the next one.
  useEffect(() => leaveVersions, [])
  if (!shown) return null
  return (
    <>
      {/* A canvas of each version's own, laid over the live one: the design is a picture, so it never mirrors. */}
      {/* On the stage's own colour, so nothing of the live design shows through. */}
      <div key={`stage-${shown.version.id}`} dir="ltr" className="absolute inset-0 bg-bg" data-testid="version-stage">
        <canvas ref={canvas} className="block size-full touch-none" onContextMenu={(e) => e.preventDefault()} />
        <div ref={overlay} className="stage-overlay pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      </div>
      <VersionBar key={`bar-${shown.version.id}`} {...opened} viewer={viewer} shown={shown} onRestored={onRestored} />
    </>
  )
}

/** Which version shows and when it was taken, with Restore, Open as a copy and Back, above the tool dock. */
function VersionBar({
  editor,
  workspaceId,
  brandId,
  designId,
  designName,
  status,
  writes,
  viewer,
  shown,
  onRestored,
}: Opened & { viewer: Viewer | null; shown: Viewing; onRestored: (words: string) => void }) {
  const locale = useLocale()
  const words = useMessages().editor.versions
  const { version, design } = shown
  const items = versionItems(writes)
  const blocked = restoreBlocked(useValue(status), useValue(listed), version.id)
  const [busy, setBusy] = useState(false)
  // What the bar says beside why Restore is off: a copy or a restore that failed, or nothing to restore.
  const [note, setNote] = useState<'copyFailed' | 'restoreFailed' | 'sameVersion' | null>(null)
  // Whether a copy is on its way, from the bar or the notice: one at a time.
  const copying = useRef(false)

  const copy = useCallback(async () => {
    if (copying.current) return
    copying.current = true
    setBusy(true)
    setNote(null)
    try {
      const made = await copyVersionFromEditor(
        workspaceId,
        brandId,
        designId,
        version.id,
        copyName(designName, version, words),
      )
      window.location.assign(brandPath(workspaceId, brandId, 'designs', made.id))
    } catch {
      copying.current = false
      setNote('copyFailed')
      setBusy(false)
    }
  }, [workspaceId, brandId, designId, designName, version, words])
  // The notice of a restore too big to send offers the copy instead, while this version shows.
  useEffect(() => {
    if (!items.copy) return
    setCopyViewed(() => void copy())
    return () => setCopyViewed(null)
  }, [items.copy, copy])

  const restore = async () => {
    if (!viewer || blocked) return
    setBusy(true)
    setNote(null)
    try {
      const done = await editor.restoreVersion(design, restoreMark(version), viewer.shownPage())
      // A version the design is already writes nothing and keeps no undo step: there is nothing to undo.
      if (done === 'same') setNote('sameVersion')
      if (done !== 'restored') return
      stopViewing()
      // The Before restore version is stored before the restore, so it is listed once the tab is Saved.
      void whenSaved(status).then(() => historyChanged.set(historyChanged.get() + 1))
      onRestored(restoredWords(locale, version, words))
    } catch {
      setNote('restoreFailed')
    } finally {
      setBusy(false)
    }
  }
  // Why Restore is off, said only to a member it is offered to.
  const why =
    !items.restore || !blocked
      ? undefined
      : blocked === 'full'
        ? words.full
        : blocked === 'offline'
          ? words.reconnectRestore
          : words.notSavingRestore

  return (
    <div
      role="region"
      aria-label={viewingWords(locale, version, words)}
      data-testid="version-bar"
      // Above the dock; on a tablet above the zoom pill and Pages, which sit over the dock there.
      className="pop-in absolute start-1/2 bottom-[5.5rem] z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col items-center gap-1.5 rtl:translate-x-1/2 max-sm:bottom-[4.75rem] sm:max-lg:bottom-(--above-corner)"
    >
      <div className="flex max-w-full items-center gap-2 rounded-full surface-frost py-1.5 ps-4 pe-1.5">
        <span className="min-w-0 truncate text-small font-semibold text-text">
          {viewingWords(locale, version, words)}
        </span>
        {items.restore && (
          <Button
            variant="primary"
            disabled={busy || !viewer || blocked !== null}
            title={why}
            onClick={() => void restore()}
            data-testid="version-restore"
          >
            <ArrowCounterClockwiseIcon size={14} aria-hidden />
            <span className="max-sm:sr-only">{words.restore}</span>
          </Button>
        )}
        {items.copy && (
          <Button variant="secondary" disabled={busy} onClick={() => void copy()} data-testid="version-copy">
            <CopyIcon size={14} aria-hidden />
            <span className="max-sm:sr-only">{words.openCopy}</span>
          </Button>
        )}
        <Button variant="ghost" onClick={stopViewing} data-testid="version-back">
          <ArrowArcLeftIcon size={14} aria-hidden />
          <span>{words.back}</span>
        </Button>
      </div>
      {(note ?? why) && (
        <p role="status" className="rounded-full surface-frost px-3 py-1 text-label text-muted">
          {note ? words[note] : why}
        </p>
      )}
    </div>
  )
}
