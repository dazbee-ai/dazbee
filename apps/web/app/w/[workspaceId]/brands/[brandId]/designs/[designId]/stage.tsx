'use client'

import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { type Editor, SHAPE_MENU_TOOLS, type ShapeMenuTool, startEditor, TabStopped, type Tool } from '@dazbee/editor'
import { labelTextAt } from '@dazbee/editor/dom-input'
import { isVectorAsset, type Member } from '@dazbee/schema'

import { ASSET_DRAG_TYPE, draggedAsset, VECTOR_DRAG_TYPE } from '@/components/editor/asset-drag.ts'
import { AddFramePanel, useFrameToolCard } from '@/components/editor/edit-panel/add-frame-panel.tsx'
import { EditPanel } from '@/components/editor/edit-panel/edit-panel.tsx'
import { EyedropperChrome } from '@/components/editor/edit-panel/eyedropper.tsx'
import { setOpen } from '@/components/editor/edit-store.ts'
import { useReadOnly } from '@/components/editor/editor-hooks.ts'
import { EmptyPageHint } from '@/components/editor/empty-page-hint.tsx'
import { FindReplacePanel } from '@/components/editor/find-replace-panel.tsx'
import { AssetLibrary } from '@/components/editor/flyouts/asset-library.tsx'
import { BrandKitPanel } from '@/components/editor/flyouts/brand-kit-panel.tsx'
import { KitVariables } from '@/components/editor/flyouts/kit-variables.tsx'
import { LayersPanel } from '@/components/editor/flyouts/layers-panel.tsx'
import { FrameRename } from '@/components/editor/frame-rename.tsx'
import { HiddenShownPill } from '@/components/editor/hidden-shown-pill.tsx'
import { HistoryButtons } from '@/components/editor/menus/history-buttons.tsx'
import { ShareMenu } from '@/components/editor/menus/share-menu.tsx'
import { SmallMenu } from '@/components/editor/menus/small-menu.tsx'
import { StageMenu } from '@/components/editor/menus/stage-menu.tsx'
import { rightClickAt, type StageMenuOpen } from '@/components/editor/menus/stage-menu-at.ts'
import { ZoomControl } from '@/components/editor/menus/zoom-control.tsx'
import { noticePose, noticeWords } from '@/components/editor/notice-words.ts'
import { OpenFailureState, OpeningBee } from '@/components/editor/opening-bee.tsx'
import { PagesButton, PagesPanel } from '@/components/editor/pages-panel.tsx'
import { EditorShell } from '@/components/editor/shell.tsx'
import type { ChromeInsets } from '@/components/editor/stage-insets.ts'
import { NoticeToast, UndoToast } from '@/components/editor/toasts.tsx'
import { restoreNoticeAction, useShownEditor } from '@/components/editor/versions/use-versions.ts'
import { VersionStage } from '@/components/editor/versions/version-bar.tsx'
import { VersionsPanel } from '@/components/editor/versions/versions-panel.tsx'
import { ViewOnlyProvider } from '@/components/editor/view-only.tsx'
import type { MascotPose } from '@/components/ui/mascot.tsx'
import { carriesFiles, dragFills, dropAt, isAssetFile, placeDroppedFiles } from '@/lib/editor/drop-files.ts'
import { placeAsset } from '@/lib/editor/place-asset.ts'
import { type Uploading, uploadNotice } from '@/lib/editor/upload-notice.ts'
import { useValue, type ValueStore, valueStore } from '@/lib/editor/value-store.ts'
import { frameName } from '@/lib/frame-name.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { layerName } from '@/lib/layer-name.ts'

import { fetchSyncToken, renameFromEditor } from './actions.ts'
import { assetBytes, brandKitVariables, fontLoader, imageUploader, keepForOffline } from './editor-io.ts'

declare global {
  interface Window {
    dazbee?: Editor
  }
}

/** The editor's tools that the dock shows as the one shape button. */
const isShapeMenuTool = (tool: Tool): tool is ShapeMenuTool => (SHAPE_MENU_TOOLS as readonly string[]).includes(tool)

export function EditorStage({
  designId,
  designName,
  brandId,
  brandName,
  everyBrand,
  forEveryBrand,
  syncUrl,
  account,
  member,
}: {
  designId: string
  designName: string
  /** The member the page is signed in as, in the design's workspace: the tab copies the editor takes up are theirs. */
  member: Member
  brandId: string
  brandName: string
  /** How the workspace says "every brand", for a template's scope (#54). */
  everyBrand: string
  /** Whether the member may save a template for every brand: not one limited to some brands. */
  forEveryBrand: boolean
  syncUrl: string
  /** The account avatar and its menu, at the top end after Share. */
  account?: ReactNode
}) {
  // The member as plain values, so the editor starts again only when the person signed in changes.
  const { userId, workspaceId } = member
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  // The name as last saved from the crumb, so it shows at once without reloading the page.
  const [name, setName] = useState(designName)
  // The save state and zoom change on every edit and zoom step; held outside this component's state,
  // they re-render the status and the zoom pill alone, not the whole editor.
  const [status] = useState(() => valueStore('Starting'))
  const [zoom] = useState(() => valueStore<number | null>(null))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  // The messages a frame drawn with the Frame tool is named from, as they are when it is drawn.
  const t = useMessages()
  const messages = useRef(t)
  useEffect(() => {
    messages.current = t
  }, [t])
  const locale = useLocale()
  const [notice, setNotice] = useState<{
    text: string
    at: number
    lasting?: boolean
    /** Whether it says what uploads, from drops and SVG files, which it says until nothing does. */
    uploads?: boolean
    action?: { label: string; run: () => void }
    /** It says a colour is being picked, which picking's end takes away. */
    picking?: boolean
    /** Daz beside the words, for a notice that shows it. */
    pose?: MascotPose
  } | null>(null)
  // The right-click menu open on the stage: a layer's actions, a frame's, or the hidden layers it offers to show.
  const [menuAt, setMenuAt] = useState<StageMenuOpen | null>(null)
  const closeMenu = useCallback(() => setMenuAt(null), [])
  // A Reviewer's tab, or one whose link ended, may only view (C35): nothing that writes is offered.
  const viewOnly = useReadOnly(editor)
  // A version viewed over the stage, which the canvas-facing parts read while it shows, view-only.
  const { shown, shownKey, viewingVersion } = useShownEditor(editor)
  // A tab that turns view-only while open closes what was open to edit: a pop-up, a menu, a form.
  useEffect(() => {
    if (!viewOnly) return
    setOpen(null)
    setMenuAt(null)
  }, [viewOnly])
  const dismissNotice = useCallback(() => setNotice(null), [])
  // What the brand kit says while its flyout is closed, such as a save it refused, stays until dismissed.
  const tellKit = useCallback((text: string) => setNotice({ text, at: Date.now(), lasting: true }), [])
  // The library, if open, shows the files dropped and the pictures of SVG files once they upload.
  const [uploaded, setUploaded] = useState(0)
  // Dropped files and SVG files' pictures upload under one lasting notice that counts them all,
  // after what the drop said; once nothing uploads, it says what the drop said, which it then forgets.
  const uploads = useRef<Uploading>({ files: [], pictures: [], said: '' })
  const droppedWords = t.editor.droppedFiles
  const showUploads = useCallback(() => {
    const told = uploadNotice(droppedWords, uploads.current)
    if (told && !told.lasting) uploads.current = { ...uploads.current, said: '' }
    // The same words showing stay as they are, rather than showing again.
    if (told)
      setNotice((now) =>
        now?.text === told.text && (now.lasting ?? false) === told.lasting
          ? now
          : { text: told.text, at: Date.now(), ...(told.lasting ? { lasting: true, uploads: true } : {}) },
      )
    else setNotice((now) => (now?.uploads ? null : now))
  }, [droppedWords])
  // Picking a colour says so as the stage's notice, with Cancel, which a phone has in place of Esc;
  // it stays until picking ends.
  const cancelPicking = t.editor.eyedropper.cancel
  const pickingNotice = useCallback(
    (text: string) =>
      setNotice({
        text,
        at: Date.now(),
        picking: true,
        lasting: true,
        action: { label: cancelPicking, run: () => editor?.stopPicking() },
      }),
    [cancelPicking, editor],
  )
  const pickingEnded = useCallback(() => setNotice((now) => (now?.picking ? null : now)), [])
  useEffect(() => {
    if (!editor) return
    const stop = editor.onNotice((...told) => {
      if (told[0] !== 'uploading') {
        const action = restoreNoticeAction(told, t.editor.versions.openCopy)
        const pose = noticePose(told[0])
        setNotice({
          text: noticeWords(locale, t.editor, ...told),
          at: Date.now(),
          ...action,
          ...(pose ? { pose } : {}),
        })
        return
      }
      uploads.current = { ...uploads.current, pictures: told[1].names }
      if (told[1].names.length === 0) setUploaded((n) => n + 1)
      showUploads()
    })
    return () => {
      stop()
    }
  }, [editor, locale, t, showUploads])
  // The dock follows the editor's tool: a key picks one, and drawing a shape goes back to select.
  const [tool, setEditorTool] = useState<Tool>('select')
  const [shape, setShape] = useState<ShapeMenuTool>('rect')
  useEffect(() => {
    if (!editor) return
    const stop = editor.onTool((next) => {
      setEditorTool(next)
      if (isShapeMenuTool(next)) setShape(next)
    })
    return () => {
      stop()
    }
  }, [editor])
  // An image armed from Assets has no button of its own: the dock lights Select, which disarms it.
  const dockTool = isShapeMenuTool(tool) ? 'shape' : tool === 'image' ? 'select' : tool
  // The Frame tool opens Add a frame, and closing the card puts the tool down.
  useFrameToolCard(editor, tool)
  const dismissRemoved = useCallback(() => setRemoved(null), [])
  // A frame Delete deleted, by its key or its ⋯ menu, says so with its undo, as a deleted page does.
  const frameRemoved = t.editor.frames.removed
  useEffect(() => {
    if (!editor) return
    const stop = editor.onFrameDelete((frameName) => setRemoved(format(frameRemoved, { name: frameName })))
    return () => {
      stop()
    }
  }, [editor, frameRemoved])

  // Files dropped from the computer: the images upload into the library and go where they were
  // dropped. The notice says what was left out and stays while the rest and an SVG file's pictures
  // upload, then says what was left out, what didn't upload and what wasn't placed. The library, if
  // open, shows the uploads.
  const dropped = useMessages().editor.droppedFiles
  const dropFiles = (files: File[], client: { x: number; y: number }) => {
    if (!editor) return
    const list = (items: string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items)
    const take = files.filter(isAssetFile)
    const left = files.filter((file) => !isAssetFile(file))
    const leftOut = left.length > 0 ? format(dropped.notImages, { names: list(left.map((file) => file.name)) }) : ''
    if (!take[0]) {
      if (leftOut) setNotice({ text: leftOut, at: Date.now() })
      return
    }
    uploads.current = {
      ...uploads.current,
      files: [...uploads.current.files, ...take.map((f) => f.name)],
      said: leftOut,
    }
    showUploads()
    // Each file is counted out once sent, before an SVG file's pictures upload.
    const sent = (file: File) => {
      const still = [...uploads.current.files]
      still.splice(still.indexOf(file.name), 1)
      uploads.current = { ...uploads.current, files: still }
      showUploads()
    }
    void placeDroppedFiles(editor, workspaceId, brandId, take, dropAt(editor, client, files), sent).then(
      ({ failed, unplaced }) => {
        setUploaded((n) => n + 1)
        const didntUpload =
          failed.length > 0
            ? format(dropped.failed, { files: list(failed.map((file) => format(dropped.failedFile, file))) })
            : ''
        const said = [leftOut, didntUpload, unplaced > 0 ? dropped.offPage : ''].filter(Boolean).join(' ')
        uploads.current = { ...uploads.current, said }
        showUploads()
      },
    )
  }

  // The stage's edges the always-on chrome and the edit panel's place cover: the editor fits the
  // ads between them. The first time the editor and they are both known the design is fitted again,
  // since it opened fitted to the whole stage. The editor counts as ready only after that, so nothing set on its
  // camera (or read from it) before then is undone by the fit.
  const [chrome, setChrome] = useState<ChromeInsets | null>(null)
  const onInsets = useCallback((insets: ChromeInsets) => setChrome(insets), [])
  const [fittedTo, setFittedTo] = useState<Editor | null>(null)
  useEffect(() => {
    if (!editor || !chrome) return
    editor.setInsets(chrome)
    if (fittedTo !== editor) {
      editor.fitAll()
      setFittedTo(editor)
    }
  }, [editor, chrome, fittedTo])

  // Lets this page open again without a connection (#37): the worker keeps the page and what it
  // loaded, and the design itself is in IndexedDB.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // In development the worker would keep serving the chunks from before an edit, so it is
    // never used there, and one left from a production build is removed.
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((all) => Promise.all(all.map((r) => r.unregister())))
      return
    }
    navigator.serviceWorker
      .register('/sw.js')
      .then(keepForOffline)
      .catch(() => {
        // Without the worker the editor still works online; only reopening offline is lost.
      })
  }, [])

  useEffect(() => {
    if (!canvas.current || !overlay.current) return
    let editor: Editor | undefined
    const unmounted = new AbortController()
    const [stage, layer] = [canvas.current, overlay.current]
    brandKitVariables(workspaceId, brandId)
      .then((variables) =>
        startEditor({
          canvas: stage,
          overlay: layer,
          typingFieldLabel: messages.current.editor.typingField,
          designId,
          syncUrl,
          member: { userId, workspaceId },
          syncToken: () => fetchSyncToken(workspaceId, brandId, designId),
          assetBytes: (assetId) => assetBytes(workspaceId, brandId, assetId),
          fontFiles: fontLoader(workspaceId, brandId),
          uploadImage: imageUploader(workspaceId, brandId),
          ...(variables ? { variables } : {}),
          onStatus: status.set,
          onZoom: zoom.set,
          frameName: (width, height) => frameName(messages.current, width, height),
          layerName: (kind) => layerName(messages.current, kind),
          radiusLabel: (radius) => format(messages.current.editor.radiusPill, { radius }),
          signal: unmounted.signal,
        }),
      )
      .then((started) => {
        if (unmounted.signal.aborted) return started.destroy()
        editor = started
        window.dazbee = started
        setEditor(started)
        // CanvasKit and the fonts may have loaded before the worker was in charge.
        void keepForOffline()
      })
      .catch((error: unknown) => {
        if (unmounted.signal.aborted) return
        // A first visit the sync server stopped shows why over the stage, as an open tab would.
        if (error instanceof TabStopped) status.set(error.state)
        else status.set(`Error: ${error instanceof Error ? error.message : String(error)}`)
      })
    return () => {
      unmounted.abort()
      editor?.destroy()
      delete window.dazbee
      setEditor(null)
      zoom.set(null)
      setOpen(null)
    }
  }, [brandId, designId, syncUrl, status, zoom, userId, workspaceId])

  return (
    <ViewOnlyProvider value={viewOnly || viewingVersion}>
      <EditorShell
        workspaceId={workspaceId}
        brandId={brandId}
        brandName={brandName}
        designName={name}
        // The name is renamed only once the editor says the tab may edit, not while it starts.
        {...(!editor || viewOnly
          ? {}
          : {
              onRename: async (next: string) => setName(await renameFromEditor(workspaceId, brandId, designId, next)),
            })}
        status={status}
        history={editor && !viewOnly && !viewingVersion ? <HistoryButtons editor={editor} /> : undefined}
        tool={dockTool}
        shape={shape}
        onToolChange={(tool, picked) => {
          setShape(picked)
          editor?.setTool(tool === 'shape' ? picked : tool)
        }}
        corner={(inBar) => <PagesAndZoom key={shownKey} editor={shown} store={zoom} inBar={inBar} />}
        onInsets={onInsets}
        fitted={editor !== null && fittedTo === editor}
        actions={
          editor ? (
            <ShareMenu
              editor={editor}
              workspaceId={workspaceId}
              brandId={brandId}
              brandName={brandName}
              designName={name}
              everyBrand={everyBrand}
              forEveryBrand={forEveryBrand}
              viewOnly={viewOnly}
            />
          ) : undefined
        }
        account={account}
        editor={shown}
        toast={
          editor && removed && !viewOnly && !viewingVersion ? (
            <UndoToast key={removed} editor={editor} message={removed} onDone={dismissRemoved} />
          ) : notice ? (
            <NoticeToast
              key={notice.at}
              message={notice.text}
              onDone={dismissNotice}
              lasting={notice.lasting ?? false}
              {...(notice.action ? { action: notice.action } : {})}
              {...(notice.pose ? { pose: notice.pose } : {})}
            />
          ) : null
        }
        flyouts={
          editor && shown
            ? {
                layers: <LayersPanel key={shownKey} editor={shown} />,
                assets: <AssetLibrary editor={editor} workspaceId={workspaceId} brandId={brandId} changed={uploaded} />,
                brand: <BrandKitPanel editor={editor} workspaceId={workspaceId} brandId={brandId} />,
              }
            : {}
        }
      >
        {editor && <KitVariables editor={editor} workspaceId={workspaceId} brandId={brandId} tell={tellKit} />}
        {/* The design is a picture, so it never mirrors: the stage stays left to right in Arabic too. */}
        {/* An asset dragged from the library lands where it is dropped (#52): into the shape it is
          dropped on, lit while it is over it, or as a new layer. Image files dropped from the
          computer upload first, then land the same way. */}
        <div
          dir="ltr"
          className="absolute inset-0"
          onDragOver={(e) => {
            if (!editor) return
            // A tab that may only view takes no drop, yet keeps the browser from opening a dropped file;
            // with no drop effect the browser fires no drop, so View only is told as the drag comes over.
            if (viewOnly) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'none'
              editor.tellViewOnly()
              return
            }
            if (!e.dataTransfer.types.includes(ASSET_DRAG_TYPE) && carriesFiles(e.dataTransfer)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              editor.imageTarget(dragFills(e.dataTransfer) ? { x: e.clientX, y: e.clientY } : null)
              return
            }
            if (!e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            // An SVG file becomes layers of its own, so no shape lights up to take it.
            if (!e.dataTransfer.types.includes(VECTOR_DRAG_TYPE)) editor.imageTarget({ x: e.clientX, y: e.clientY })
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) editor?.imageTarget(null)
          }}
          onDrop={(e) => {
            if (editor && viewOnly) {
              e.preventDefault()
              editor.tellViewOnly()
              return
            }
            const asset = editor && draggedAsset(e)
            if (editor && !asset && carriesFiles(e.dataTransfer)) {
              e.preventDefault()
              editor.imageTarget(null)
              dropFiles([...e.dataTransfer.files], { x: e.clientX, y: e.clientY })
              return
            }
            if (!asset) return
            e.preventDefault()
            const at = { x: e.clientX, y: e.clientY }
            const into = isVectorAsset(asset) ? null : editor.imageTarget(at)
            if (!into || !editor.fillWithImage(into, asset)) placeAsset(editor, workspaceId, brandId, asset, at)
            editor.imageTarget(null)
          }}
        >
          <StageMenu editor={editor} menu={menuAt} onClose={closeMenu}>
            <canvas
              ref={canvas}
              className="block size-full touch-none"
              data-testid="stage"
              onContextMenu={(e) => {
                // The menu opens for what the right-click picks, a layer or a frame by its empty area or
                // its label, or outside every frame for Show hidden layers alone, while the design has hidden
                // layers or they show; otherwise neither it nor the browser's menu opens.
                const client = { x: e.clientX, y: e.clientY }
                const labelFrameId = overlay.current ? labelTextAt(overlay.current, client) : undefined
                const menu = editor ? rightClickAt(editor, client, { labelFrameId }) : null
                if (!menu) e.preventDefault()
                setMenuAt(menu)
              }}
            />
          </StageMenu>
          <div
            ref={overlay}
            className="stage-overlay pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden
          />
          {editor && <FrameRename editor={editor} />}
        </div>
        {/* A design that can't be opened, or that the sync server stopped, says why over the stage, with its way on. */}
        <OpenFailureState status={status} workspaceId={workspaceId} brandId={brandId} />
        {editor && (
          <VersionStage
            {...{
              editor,
              workspaceId,
              brandId,
              designId,
              status,
              zoom,
              designName: name,
              insets: chrome,
              onRestored: setRemoved,
              writes: !viewOnly,
            }}
            loads={{
              assetBytes: (assetId) => assetBytes(workspaceId, brandId, assetId),
              fontFiles: fontLoader(workspaceId, brandId),
            }}
          />
        )}
        {/* The small menu and the edit panel follow the page's direction, so they mirror in Arabic. */}
        {/* Keyed by the editor they read, so each starts afresh on its selection as a version shows and goes. */}
        {shown && (
          <Fragment key={shownKey}>
            <SmallMenu editor={shown} rightClick={menuAt !== null} />
            <EditPanel editor={shown} workspaceId={workspaceId} brandId={brandId} />
            <AddFramePanel editor={shown} />
            <PagesPanel editor={shown} onRemoved={setRemoved} />
            <FindReplacePanel editor={shown} />
            <EmptyPageHint editor={shown} />
            <HiddenShownPill editor={shown} insets={chrome} />
          </Fragment>
        )}
        {editor && (
          <VersionsPanel
            editor={editor}
            workspaceId={workspaceId}
            brandId={brandId}
            designId={designId}
            status={status}
          />
        )}
        {editor && <EyedropperChrome editor={editor} onStart={pickingNotice} onEnd={pickingEnded} />}
      </EditorShell>
      <OpeningBee status={status} ready={editor !== null && fittedTo === editor} />
    </ViewOnlyProvider>
  )
}

/** Pages and the zoom pill, reading the zoom from the store; on a phone (`inBar`) chips of the tab bar. */
function PagesAndZoom({
  editor,
  store,
  inBar,
}: {
  editor: Editor | null
  store: ValueStore<number | null>
  inBar: boolean
}) {
  const zoom = useValue(store)
  return (
    <>
      <PagesButton editor={editor} inBar={inBar} />
      <ZoomControl zoom={editor ? zoom : null} editor={editor} inBar={inBar} />
    </>
  )
}
