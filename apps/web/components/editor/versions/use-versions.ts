'use client'

// What the page does with the design's versions. Show versions opens the Versions card, and Save
// version opens it with its save form, the name field taking the focus; Save version's key,
// Ctrl+Alt+S (⌥⌘S on a Mac), does so outside a field and the text being typed in, in a tab whose role
// writes. A row's click fetches its version and views it: the live editor's input pauses and a viewer
// opens on a canvas laid over the stage, on the page the live tab shows, until Back, a restore or
// another row's click; the page's canvas-facing parts read the viewer meanwhile (`viewedEditor`).
import { type RefObject, useEffect, useMemo, useRef } from 'react'

import {
  type Editor,
  type Insets,
  type NoticeDetail,
  shortcutFor,
  startViewer,
  type Viewer,
  type ViewerOptions,
} from '@dazbee/editor'
import { composingKey, inField, isStageField } from '@dazbee/editor/dom-input'
import type { Design, VersionSummary } from '@dazbee/schema'

import { setOpen } from '@/components/editor/edit-store.ts'
import { useValue, type ValueStore, valueStore } from '@/lib/editor/value-store.ts'

/** A version on the canvas: its summary, and its design as `fetchVersion` read it. */
export interface Viewing {
  version: VersionSummary
  design: Design
}

/**
 * How viewing a row's version went: on the canvas, with how many layers the read left out; not
 * fetched; or overtaken by a later click or Back, or the version already on the canvas.
 */
export type ViewOutcome = { leftOut: number } | 'failed' | 'stale'

/** What the viewer is opened with beside its version: the live editor's sources and names, and the zoom it reports. */
export type ViewerSources = Omit<ViewerOptions, 'canvas' | 'overlay' | 'design' | 'page'>

/**
 * How many times Save version was asked for while the card shows its save form, 0 while it shows
 * none: the form takes the focus again each time it is asked for, and ends by setting it back to 0.
 */
export const saveAsked = valueStore(0)
/** The version on the canvas, or null while the live design shows. */
export const viewing: ValueStore<Viewing | null> = valueStore<Viewing | null>(null)
/** The versions the card listed last, newest first: whether a restore has room reads them. */
export const listed: ValueStore<readonly VersionSummary[]> = valueStore<readonly VersionSummary[]>([])
/** Counts what changed the history from outside the card, a restore: the card reads its list again on each. */
export const historyChanged = valueStore(0)
/** The viewer open on the version viewed, once it has opened; null otherwise. */
const openViewer = valueStore<Viewer | null>(null)

/** What opens the version viewed as a copy, for the notice of a restore too big to send; null while none is offered. */
let copyViewed: (() => void) | null = null
/** Counts the versions asked for and the Backs: only the latest ask's answer is shown. */
let asking = 0

/** Opens the Versions card. */
export function showVersions() {
  setOpen('versions')
}

/** Opens the Versions card with its save form, its name field focused. */
export function askSaveVersion() {
  saveAsked.set(saveAsked.get() + 1)
  setOpen('versions')
}

/** Fetches `version` over the live editor's connection and shows it on the canvas in place of the live design. */
export async function viewVersion(editor: Editor, version: VersionSummary): Promise<ViewOutcome> {
  if (viewing.get()?.version.id === version.id) return 'stale'
  const ask = ++asking
  try {
    const read = await editor.fetchVersion(version.id)
    if (ask !== asking) return 'stale'
    if (!read) return 'failed'
    viewing.set({ version, design: read.design })
    return { leftOut: read.leftOut.filter((part) => part.part === 'layer').length }
  } catch {
    return ask === asking ? 'failed' : 'stale'
  }
}

/** Goes back to the live design as it was left; a version still being fetched is not shown. */
export function stopViewing() {
  asking++
  viewing.set(null)
}

/** Forgets the design's versions as the page leaves it: none viewed, none listed. */
export function leaveVersions() {
  stopViewing()
  listed.set([])
}

/**
 * What the page's canvas-facing parts read: the viewer as an editor once it is open on the version
 * viewed (`viewedEditor`), else the live editor, with a key for it, so a part keyed by it starts
 * afresh on the other's selection and page; and whether a version is viewed, its viewer open or
 * opening, while which the page is view-only.
 */
export function useShownEditor(editor: Editor | null) {
  const viewer = useValue(openViewer)
  const viewingVersion = useValue(viewing) !== null
  const shown = useMemo(() => (editor && viewer ? viewedEditor(viewer, editor) : editor), [editor, viewer])
  return { shown, shownKey: viewer ? 'version' : 'live', viewingVersion }
}

/** Sets what opens the version viewed as a copy, for a restore too big to send; null when nothing is viewed. */
export function setCopyViewed(copy: (() => void) | null) {
  copyViewed = copy
}

/**
 * The action the notice of a restore too big to send carries, Open as a copy, while the version is
 * viewed and the member may copy it; none for any other notice.
 */
export function restoreNoticeAction(
  told: NoticeDetail,
  label: string,
): { action?: { label: string; run: () => void } } {
  const run = copyViewed
  return told[0] === 'putBack' && told[1].step === 'restore' && run ? { action: { label, run } } : {}
}

/** Ctrl+Alt+S (⌥⌘S on a Mac) is Save version, unless a field or the text being typed in has the key. */
export function useSaveVersionKey(editor: Editor) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutFor(e) !== 'saveVersion' || composingKey(e)) return
      if (inField(e.target) || isStageField(e.target)) return
      e.preventDefault()
      // A Reviewer's tab, or one whose link ended, saves nothing: the key does nothing there.
      if (editor.actionReady('saveVersion')) askSaveVersion()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [editor])
}

/**
 * The viewer of the version viewed, on `canvas` and `overlay`, while one is: the live editor's input
 * paused, and the viewer opened on the page the live tab shows, fitted between the chrome. As the
 * version goes the viewer is freed, the live editor's input resumes and the zoom shown is the live
 * editor's again. Null while the live design shows, or while the viewer opens; `useShownEditor`
 * reads the same viewer.
 */
export function useVersionViewer(
  editor: Editor,
  stage: { canvas: RefObject<HTMLCanvasElement | null>; overlay: RefObject<HTMLDivElement | null> },
  sources: ViewerSources,
  zoom: ValueStore<number | null>,
  insets: Insets | null,
): Viewer | null {
  const shown = useValue(viewing)
  const viewer = useValue(openViewer)
  // The sources and the chrome's edges as they are when a version opens: they change with each render.
  const opening = useRef({ sources, insets })
  useEffect(() => {
    opening.current = { sources, insets }
  })
  // The chrome's edges as they change, so the viewer fits between them as the live editor does.
  useEffect(() => {
    if (viewer && insets) viewer.setInsets(insets)
  }, [viewer, insets])
  useEffect(() => {
    const [canvas, overlay] = [stage.canvas.current, stage.overlay.current]
    if (!shown || !canvas || !overlay) return
    const resume = editor.pauseInput()
    let open: Viewer | null = null
    let gone = false
    startViewer({
      ...opening.current.sources,
      // A viewer that opens after its version went shows no zoom.
      onZoom: (next) => {
        if (!gone) zoom.set(next)
      },
      canvas,
      overlay,
      design: shown.design,
      page: editor.shownPage(),
    }).then(
      (started) => {
        if (gone) return started.destroy()
        open = started
        const { insets: edges } = opening.current
        if (edges) {
          started.setInsets(edges)
          started.fitAll()
        }
        openViewer.set(started)
      },
      () => {
        // A viewer that can't open (no WebGL) leaves the live design showing.
        if (!gone) stopViewing()
      },
    )
    return () => {
      gone = true
      // The page lets the viewer go before it is freed.
      openViewer.set(null)
      open?.destroy()
      resume()
      zoom.set(editor.camera().zoom)
    }
  }, [editor, shown, stage.canvas, stage.overlay, opening, zoom])
  return viewer
}

/**
 * The viewer as the page's canvas-facing parts take an editor: its own members, and none of what
 * places, uploads or exports, which a viewed version never does; the tab's save state and connection
 * stay the live editor's.
 */
export function viewedEditor(viewer: Viewer, live: Editor): Editor {
  return {
    ...viewer,
    placeImage: () => null,
    // A viewed version is never changed, so no connector on it is picked to delete.
    connectorAt: () => null,
    readSvg: () => Promise.resolve(null),
    imageTarget: () => null,
    exportFiles: live.exportFiles,
    synced: live.synced,
    keptOnDevice: live.keptOnDevice,
    fetchVersion: live.fetchVersion,
    pauseInput: () => () => {},
  }
}
