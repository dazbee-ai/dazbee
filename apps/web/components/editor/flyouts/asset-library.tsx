'use client'

// The brand's asset library, in the Assets flyout: upload several images at once and watch each
// one's progress, have an image made from a few words, name and tag them, find them by either, place
// one on the design, and delete one nothing uses. The pictures the AI made show under their own filter, Made with
// AI, which an image just made turns on, so the main list keeps the person's own. An image dragged onto a frame goes there. One
// clicked with a mouse or a pen is armed and shows picked: the next click on a frame places it, a
// drag there draws it, and Escape, another tool, a press off every frame, clicking it again or
// closing Assets disarms it. A key, a tap and an SVG file place at once, as the editor places with
// no point. Thumbnails are small copies the API made and stored; the design itself draws the
// original, decoded by CanvasKit.
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react'

import type { Editor } from '@dazbee/editor'
import { AssetSummary, imageAssetIds, isVectorAsset } from '@dazbee/schema'

import { carryAsset } from '@/components/editor/asset-drag.ts'
import { useEditState } from '@/components/editor/edit-store.ts'
import { ASSET_TILE } from '@/components/editor/styles.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { EmptyState, NoMatch } from '@/components/ui/empty-state.tsx'
import { MagnifyingGlassIcon, PencilSimpleIcon, TrashIcon, UploadSimpleIcon, XIcon } from '@/components/ui/icons.tsx'
import { DASHED_BUTTON } from '@/components/ui/looks.ts'
import { overlayScroll } from '@/components/ui/overlay-scroll.ts'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { isAiAsset, libraryShows } from '@/lib/editor/asset-filter.ts'
import { armsOnClick, placeAsset } from '@/lib/editor/place-asset.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { ASSET_ACCEPT as ACCEPT, sendAsset as send } from '@/lib/upload-asset.ts'

import { AssetDetails } from './asset-details.tsx'
import { MakeImage } from './make-image.tsx'

interface Upload {
  key: string
  name: string
  progress: number
  error?: string
}

/** How long typing pauses before the library searches. */
const SEARCH_DELAY_MS = 150

/** `changed` counts uploads made elsewhere, such as files dropped on the stage; each change lists the assets again. */
export function AssetLibrary({
  editor,
  workspaceId,
  brandId,
  changed = 0,
}: {
  editor: Editor
  workspaceId: string
  brandId: string
  changed?: number
}) {
  const t = useMessages().editor.assetLibrary
  const [query, setQuery] = useState('')
  const [fetched, setFetched] = useState<AssetSummary[] | null>(null)
  const [madeWithAi, setMadeWithAi] = useState(false)
  const assets = fetched && libraryShows(fetched, madeWithAi)
  const anyAi = fetched?.some(isAiAsset) ?? false
  const [uploads, setUploads] = useState<Upload[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  // Whether the details were opened by the tile's Delete, which asks at once.
  const [deletingFromTile, setDeletingFromTile] = useState(false)
  const [dropping, setDropping] = useState(false)
  // A tab that may only view browses the library: it places, uploads, renames and deletes nothing (C35).
  const viewOnly = useViewOnly()
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  // The image armed to place, until it is placed or the select tool comes back without it.
  const [armed, setArmed] = useState<string | null>(null)
  // The pointer the last press on a tile came from: a click with no press before it is a key's.
  const pressedWith = useRef<string | null>(null)
  useEffect(() => {
    const stop = editor.onTool((tool) => {
      if (tool !== 'image') setArmed(null)
    })
    return () => {
      stop()
    }
  }, [editor])
  // Closing Assets disarms the image it armed, at once, while the flyout still slides out.
  const shown = useEditState().flyout === 'assets'
  useEffect(() => {
    if (!shown && editor.imageArmed()) editor.armImage(null)
    return () => {
      if (editor.imageArmed()) editor.armImage(null)
    }
  }, [editor, shown])
  const pick = (asset: AssetSummary, detail: number) => {
    const by = pressedWith.current
    pressedWith.current = null
    if (!armsOnClick(asset, by, detail)) placeAsset(editor, workspaceId, brandId, asset)
    else if (armed === asset.id) editor.armImage(null)
    else {
      editor.armImage(asset)
      setArmed(asset.id)
    }
  }

  useEffect(() => {
    const ask = new AbortController()
    const timer = setTimeout(
      () => {
        const q = query.trim()
        fetch(`${brandPath(workspaceId, brandId, 'assets')}${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
          signal: ask.signal,
        })
          .then(async (response) => {
            if (response.ok) setFetched(AssetSummary.array().parse(await response.json()))
          })
          // Offline, or a newer search took over: the list keeps what it had.
          .catch(() => undefined)
      },
      version === 0 && !query ? 0 : SEARCH_DELAY_MS,
    )
    return () => {
      clearTimeout(timer)
      ask.abort()
    }
  }, [workspaceId, brandId, query, version, changed])

  const upload = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const key = `${file.name}-${file.size}-${Math.random()}`
        const change = (patch: Partial<Upload>) =>
          setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...patch } : u)))
        setUploads((all) => [...all, { key, name: file.name, progress: 0 }])
        send(workspaceId, brandId, file, (progress) => change({ progress }))
          .then(() => {
            setUploads((all) => all.filter((u) => u.key !== key))
            refresh()
          })
          .catch((error: unknown) => change({ error: error instanceof Error ? error.message : String(error) }))
      }
    },
    [workspaceId, brandId, refresh],
  )

  const replace = (asset: AssetSummary) => setFetched((all) => all?.map((a) => (a.id === asset.id ? asset : a)) ?? null)
  const edited = viewOnly ? undefined : assets?.find((a) => a.id === editing)
  const hasFiles = (e: DragEvent) => !viewOnly && e.dataTransfer.types.includes('Files')
  const searched = query.trim()
  // A library with no images holds its Upload in its empty state, in place of the one above.
  const noImages = assets?.length === 0 && !searched

  return (
    <div
      data-testid="asset-library"
      className={cn('flex min-h-0 flex-1 flex-col', dropping && 'bg-accent-soft')}
      onDragOver={(e) => {
        // A tab that may only view takes no file, yet keeps the browser from opening one dropped here.
        if (viewOnly) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'none'
          return
        }
        if (!hasFiles(e)) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => {
        if (viewOnly) e.preventDefault()
        if (!hasFiles(e)) return
        e.preventDefault()
        setDropping(false)
        upload([...e.dataTransfer.files])
      }}
    >
      <div className="flex shrink-0 flex-col gap-2 px-[18px] pb-3">
        <label className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-bg/40 px-2.5 focus-within:border-accent">
          <MagnifyingGlassIcon size={14} aria-hidden className="shrink-0 text-subtle" />
          <input
            name="asset-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t.search}
            placeholder={t.search}
            className="h-full min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-subtle"
          />
        </label>
        {!viewOnly && !noImages && (
          <UploadButton className={DASHED_BUTTON} label={dropping ? t.dropHere : t.upload} onFiles={upload} />
        )}
        {/* A tab that may only view, as a Reviewer's, has nothing made. */}
        {!viewOnly && (
          <MakeImage
            workspaceId={workspaceId}
            brandId={brandId}
            onMade={() => {
              setMadeWithAi(true)
              refresh()
            }}
          />
        )}
        {(anyAi || madeWithAi) && (
          <div role="group" aria-label={t.filter} className="flex gap-1">
            {([false, true] as const).map((ai) => (
              <button
                key={String(ai)}
                type="button"
                aria-pressed={madeWithAi === ai}
                data-filter={ai ? 'ai' : 'all'}
                onClick={() => setMadeWithAi(ai)}
                className="h-7 cursor-pointer rounded-full px-3 text-tiny text-muted hover:bg-hover hover:text-text aria-pressed:bg-hover aria-pressed:text-text"
              >
                {ai ? t.madeWithAi : t.images}
              </button>
            ))}
          </div>
        )}
        {uploads.length > 0 && (
          <ul aria-label={t.upload} className="flex flex-col gap-1.5" data-testid="asset-uploads">
            {uploads.map((u) => (
              <li key={u.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-tiny">
                  <span
                    className={cn('min-w-0 flex-1 truncate', u.error ? 'text-danger' : 'text-muted')}
                    role={u.error ? 'alert' : undefined}
                  >
                    {u.error
                      ? format(t.uploadFailed, { name: u.name, reason: u.error })
                      : format(t.uploading, { name: u.name })}
                  </span>
                  {u.error && (
                    <button
                      type="button"
                      aria-label={t.done}
                      onClick={() => setUploads((all) => all.filter((x) => x.key !== u.key))}
                      className="grid size-5 cursor-pointer place-items-center rounded-row text-subtle hover:bg-hover hover:text-text active:bg-pressed"
                    >
                      <XIcon size={12} aria-hidden />
                    </button>
                  )}
                </div>
                {!u.error && (
                  <div
                    role="progressbar"
                    aria-label={format(t.uploading, { name: u.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(u.progress * 100)}
                    className="h-1 overflow-hidden rounded-full bg-well"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full bg-accent-solid transition-[width]',
                        u.progress >= 1 && 'animate-pulse',
                      )}
                      style={{ width: `${Math.max(4, u.progress * 100)}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {edited && (
        <AssetDetails
          key={edited.id}
          asset={edited}
          workspaceId={workspaceId}
          brandId={brandId}
          usedHere={() => imageAssetIds(editor.session.design()).includes(edited.id)}
          openDesign={editor.session.design().meta.designId}
          askNow={deletingFromTile}
          onSaved={replace}
          onDeleted={() => {
            setEditing(null)
            setFetched((now) => now && now.filter((a) => a.id !== edited.id))
          }}
          onDone={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}

      <div ref={overlayScroll} className="min-h-0 flex-1 overflow-y-auto px-[18px] pt-1 pb-4">
        {noImages && (
          <EmptyState
            pose="picture"
            tight
            title={t.empty.title}
            // A tab that may only view is told nothing it can't do.
            {...(viewOnly ? {} : { line: t.empty.line })}
            action={
              !viewOnly && (
                <UploadButton
                  className={cn(
                    buttonStyles({ variant: 'primary', size: 'md' }),
                    'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
                  )}
                  label={dropping ? t.dropHere : t.upload}
                  onFiles={upload}
                />
              )
            }
          />
        )}
        {assets?.length === 0 && searched && <NoMatch query={searched} />}
        {assets && assets.length > 0 && (
          <ul aria-label={t.images} className="grid grid-cols-3 gap-2">
            {assets.map((asset) => {
              const name = asset.name || t.untitled
              const picture = (
                <img
                  src={brandPath(workspaceId, brandId, 'assets', asset.id, 'thumbnail')}
                  alt=""
                  width={asset.width}
                  height={asset.height}
                  draggable={false}
                  loading="lazy"
                  className="size-full object-contain"
                />
              )
              if (viewOnly)
                return (
                  <li key={asset.id} data-asset={asset.id} className="relative flex min-w-0 flex-col gap-1">
                    <span title={name} className={ASSET_TILE}>
                      {picture}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 truncate text-caption font-medium',
                        asset.name ? 'text-muted' : 'text-subtle',
                      )}
                      title={name}
                    >
                      {name}
                    </span>
                  </li>
                )
              return (
                <li key={asset.id} data-asset={asset.id} className="group relative flex min-w-0 flex-col gap-1">
                  <button
                    type="button"
                    draggable
                    aria-label={format(t.place, { name })}
                    aria-pressed={armed === asset.id}
                    title={isVectorAsset(asset) ? t.placeHint : t.armHint}
                    onPointerDown={(e) => {
                      pressedWith.current = e.pointerType
                    }}
                    onClick={(e) => pick(asset, e.detail)}
                    onDragStart={(e) => {
                      carryAsset(e, asset)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    className={cn(
                      ASSET_TILE,
                      'cursor-grab hover:border-line-strong active:cursor-grabbing',
                      editing === asset.id && 'border-accent',
                      // Armed, the tile is tinted too, apart from the focus ring a tile tabbed to has.
                      armed === asset.id && 'border-accent bg-accent-soft',
                    )}
                  >
                    {picture}
                  </button>
                  {/* Name and tags open from the tile's corner, shown on hover or focus, and while open. */}
                  <button
                    type="button"
                    aria-label={`${t.edit}: ${name}`}
                    aria-pressed={editing === asset.id}
                    onClick={() => {
                      setDeletingFromTile(false)
                      setEditing(editing === asset.id ? null : asset.id)
                    }}
                    className="absolute end-1 top-1 grid size-6 cursor-pointer place-items-center rounded-full surface-frost text-muted opacity-0 transition-opacity duration-[var(--chrome-fast)] group-hover:opacity-100 hover:text-text focus-visible:opacity-100 aria-pressed:text-accent-text aria-pressed:opacity-100"
                  >
                    <PencilSimpleIcon size={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`${t.delete}: ${name}`}
                    data-testid="asset-tile-delete"
                    onClick={() => {
                      setDeletingFromTile(true)
                      setEditing(asset.id)
                    }}
                    className="absolute start-1 top-1 grid size-6 cursor-pointer place-items-center rounded-full surface-frost text-muted opacity-0 transition-opacity duration-[var(--chrome-fast)] group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                  >
                    <TrashIcon size={12} aria-hidden />
                  </button>
                  <span
                    className={cn(
                      'min-w-0 truncate text-caption font-medium',
                      asset.name ? 'text-muted' : 'text-subtle',
                    )}
                    title={name}
                  >
                    {name}
                  </span>
                  {asset.tags.length > 0 && (
                    <p className="-mt-0.5 truncate text-micro text-subtle">{asset.tags.join(' · ')}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** A button that picks image files from the computer and hands them on to upload. */
function UploadButton({
  className,
  label,
  onFiles,
}: {
  className: string
  label: string
  onFiles: (files: File[]) => void
}) {
  return (
    <label className={className}>
      <UploadSimpleIcon size={14} aria-hidden />
      {label}
      <input
        name="images"
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </label>
  )
}
