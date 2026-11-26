'use client'

// The brief box in a design, just above the tool dock, on light frosted glass: the brief's pictures as square
// thumbnails, its words in a borderless field that keeps line breaks, and one row of quiet icon buttons, each with
// a tooltip: add pictures, the size (its shape, opening a list of the sizes the AI is offered), the speed (Fast or
// Precise, one toggle), and the one primary action, Make drafts. Enter makes the drafts too, Shift+Enter starts a
// new line. Once the job is saved, the brief's section and four frames are placed below everything on the page
// and fill as their pictures arrive, and the view fits them. A brief that doesn't start places nothing, and one
// quiet line above the row says why. It warns the same way when four more drafts would take the design past its
// size warning.
import * as Popover from '@radix-ui/react-popover'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { briefPassesWarning, type Editor } from '@dazbee/editor'
import { type AiMode, MAX_REFERENCES, type SizePreset } from '@dazbee/schema'

import {
  ArrowUpIcon,
  CircleNotchIcon,
  FlashIcon,
  InfoIcon,
  PlusIcon,
  SparkIcon,
  WarningCircleIcon,
  XIcon,
} from '@/components/ui/icons.tsx'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { AI_SIZE_PRESETS, briefKey, type BriefSaid, briefSaid, otherMode, shapeIn } from '@/lib/editor/brief-box.ts'
import { BRIEF_DRAFTS, type BriefPicture } from '@/lib/editor/brief-draft.ts'
import { sizeOf } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { IMAGE_ACCEPT, sendAsset } from '@/lib/upload-asset.ts'

/**
 * The keyboard's focus ring on the box's controls, in Dazbee's blue; the pointer shows none. Each control carries
 * `data-own-focus`, so the app's own ring (globals.css) leaves it to this, and the words field shows none.
 */
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--stage-accent)'
/** A quiet round icon button of the row. */
const ICON_BUTTON = cn(
  'grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text active:bg-pressed disabled:cursor-not-allowed disabled:opacity-45 aria-expanded:bg-hover aria-expanded:text-text',
  FOCUS,
)

export function BriefBox({
  workspaceId,
  brandId,
  editor,
  onClose,
}: {
  workspaceId: string
  brandId: string
  /** The editor: its box's words, pictures, size and speed are kept while the box is closed, until they are sent. */
  editor: Editor
  onClose: () => void
}) {
  const t = useMessages()
  const b = t.editor.brief
  const [kept] = useState(() => BRIEF_DRAFTS.get(editor, AI_SIZE_PRESETS[0]?.id ?? ''))
  const [words, setWords] = useState(kept.words)
  const [pictures, setPictures] = useState<BriefPicture[]>(kept.pictures)
  const [sizeId, setSizeId] = useState(kept.sizeId)
  const [mode, setMode] = useState<AiMode>(kept.mode)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<BriefSaid | null>(null)
  const files = useRef<HTMLInputElement>(null)
  const size = AI_SIZE_PRESETS.find((preset) => preset.id === sizeId) ?? AI_SIZE_PRESETS[0]
  const uploading = pictures.some((p) => !p.asset && !p.failed)
  const ready = Boolean(size && words.trim() !== '' && !busy && !uploading)
  const nearLimit = briefPassesWarning(editor.designSize())
  const note = said ? b[said] : nearLimit ? b.nearLimit : null
  // Kept as it changes, so the box closed and opened again shows it.
  useEffect(() => BRIEF_DRAFTS.set(editor, { words, pictures, sizeId, mode }), [editor, words, pictures, sizeId, mode])

  const upload = (picked: File[]) => {
    for (const file of picked.slice(0, MAX_REFERENCES - pictures.length)) {
      const key = crypto.randomUUID()
      const change = (patch: Partial<BriefPicture>) => {
        setPictures((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)))
        // The box may be closed by now: its kept draft takes the upload in.
        BRIEF_DRAFTS.patchPicture(editor, key, patch)
      }
      setPictures((all) => [...all, { key, name: file.name }])
      sendAsset(workspaceId, brandId, file, () => {})
        .then((asset) => change({ asset }))
        .catch(() => change({ failed: true }))
    }
  }

  async function make() {
    if (!size || !ready) return
    setBusy(true)
    setSaid(null)
    try {
      const started = await editor.startBrief({
        pageId: editor.shownPage(),
        words,
        pictures: pictures.flatMap((p) => (p.asset ? [p.asset.id] : [])),
        size: { width: size.width, height: size.height },
        mode,
        draftName: (n) => format(b.draftName, { n: n + 1 }),
      })
      if (!started.ok) {
        setSaid(briefSaid(started))
        // The job may be saved: the words go, so Enter doesn't start the same brief again.
        if (started.notPlaced || started.unknown) setWords('')
        return
      }
      editor.fitSection(started.sectionId)
      setWords('')
      setPictures([])
      // Sent, the brief is kept no more: the box closes now, before its next render would keep the change.
      BRIEF_DRAFTS.set(editor, { words: '', pictures: [], sizeId, mode })
      onClose()
    } catch {
      // The answer was lost on its way: the job may be saved.
      setSaid('unknown')
      setWords('')
    } finally {
      setBusy(false)
    }
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const does = briefKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })
    if (does === 'close') onClose()
    if (does !== 'make') return
    event.preventDefault()
    void make()
  }

  return (
    <section
      aria-label={b.label}
      data-testid="brief-box"
      className="absolute start-1/2 bottom-(--above-dock) z-20 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 flex-col gap-3 rounded-[24px] surface-frost px-4 pt-4 pb-2.5 font-sans max-sm:bottom-(--above-tab-bar) rtl:translate-x-1/2"
    >
      <Tooltip plain label={b.close}>
        <button
          data-own-focus
          type="button"
          aria-label={b.close}
          onClick={onClose}
          className={cn(ICON_BUTTON, 'absolute end-2 top-2 size-7 text-subtle')}
        >
          <XIcon size={14} aria-hidden />
        </button>
      </Tooltip>
      {pictures.length > 0 && (
        <ul aria-label={b.addPictures} className="flex flex-wrap gap-2 pe-8">
          {pictures.map((picture) => (
            <Thumbnail
              key={picture.key}
              picture={picture}
              src={picture.asset && brandPath(workspaceId, brandId, 'assets', picture.asset.id, 'thumbnail')}
              onRemove={() => setPictures((all) => all.filter((p) => p.key !== picture.key))}
            />
          ))}
        </ul>
      )}
      <textarea
        data-own-focus
        // The box opens for the words.
        autoFocus
        name="brief"
        rows={2}
        value={words}
        onChange={(event) => {
          setWords(event.target.value)
          setSaid(null)
        }}
        onKeyDown={onKey}
        aria-label={b.label}
        placeholder={b.placeholder}
        maxLength={4000}
        // It sits in the glass with no edge of its own, even while typed in.
        className="w-full resize-none border-0 bg-transparent pe-8 text-[17px] leading-[1.45] text-text outline-none placeholder:text-subtle focus-visible:outline-none"
      />
      {note && (
        <p role="status" data-testid="brief-said" className="flex items-center gap-1.5 text-small text-muted">
          {said ? (
            <WarningCircleIcon size={14} aria-hidden className="shrink-0" />
          ) : (
            <InfoIcon size={14} aria-hidden className="shrink-0" />
          )}
          {note}
        </p>
      )}
      <div className="-ms-2 flex items-center gap-1">
        <input
          ref={files}
          type="file"
          name="brief-pictures"
          multiple
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            upload([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <Tooltip plain label={b.addPictures}>
          <button
            data-own-focus
            type="button"
            aria-label={b.addPictures}
            disabled={pictures.length >= MAX_REFERENCES}
            onClick={() => files.current?.click()}
            className={ICON_BUTTON}
          >
            <PlusIcon size={18} aria-hidden />
          </button>
        </Tooltip>
        {size && <SizePicker size={size} onPick={(picked) => setSizeId(picked.id)} />}
        <Tooltip plain label={b[mode]}>
          <button
            data-own-focus
            type="button"
            aria-label={b[mode]}
            data-testid="brief-speed"
            data-mode={mode}
            onClick={() => setMode(otherMode)}
            className={ICON_BUTTON}
          >
            {mode === 'fast' ? <FlashIcon size={18} aria-hidden /> : <SparkIcon size={18} aria-hidden />}
          </button>
        </Tooltip>
        <Tooltip plain label={b.make}>
          <button
            data-own-focus
            type="button"
            aria-label={busy ? b.making : b.make}
            disabled={!ready}
            onClick={() => void make()}
            className={cn(
              'ms-auto grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-accent-solid text-on-accent transition-colors duration-[var(--chrome-fast)] hover:bg-accent-solid-hover disabled:cursor-not-allowed disabled:opacity-45',
              FOCUS,
            )}
          >
            {busy ? (
              <CircleNotchIcon size={18} aria-hidden className="animate-spin" />
            ) : (
              <ArrowUpIcon size={18} weight="bold" aria-hidden />
            )}
          </button>
        </Tooltip>
      </div>
    </section>
  )
}

/** A picture of the brief as a square thumbnail, with × to remove it on hover or focus. */
function Thumbnail({
  picture,
  src,
  onRemove,
}: {
  picture: BriefPicture
  src: string | undefined
  onRemove: () => void
}) {
  const b = useMessages().editor.brief
  const note = picture.failed ? b.notUploaded : picture.asset ? null : b.uploading
  const label = note ? format(note, { name: picture.name }) : picture.name
  return (
    <li className="group relative size-14 shrink-0" title={label}>
      <span className="grid size-full place-items-center overflow-hidden rounded-[12px] bg-hover text-subtle">
        {src ? (
          <img src={src} alt={picture.name} className="size-full object-cover" />
        ) : picture.failed ? (
          <WarningCircleIcon size={18} aria-label={label} />
        ) : (
          <CircleNotchIcon size={18} aria-label={label} className="animate-spin" />
        )}
      </span>
      <Tooltip plain label={format(b.removePicture, { name: picture.name })}>
        <button
          data-own-focus
          type="button"
          aria-label={format(b.removePicture, { name: picture.name })}
          onClick={onRemove}
          className={cn(
            'absolute -end-1.5 -top-1.5 grid size-5 cursor-pointer place-items-center rounded-full surface-frost text-muted opacity-0 transition-opacity duration-[var(--chrome-fast)] group-hover:opacity-100 hover:text-text focus-visible:opacity-100',
            FOCUS,
          )}
        >
          <XIcon size={10} aria-hidden />
        </button>
      </Tooltip>
    </li>
  )
}

/** The size button, drawn as the picked size's shape, and the list of the sizes the AI is offered it opens. */
function SizePicker({ size, onPick }: { size: SizePreset; onPick: (size: SizePreset) => void }) {
  const t = useMessages()
  const b = t.editor.brief
  const [open, setOpen] = useState(false)
  const label = format(b.size, { name: t.editor.sizes.preset[size.id], size: sizeOf(size) })
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip plain label={label}>
        <Popover.Trigger asChild>
          <button type="button" data-own-focus aria-label={label} data-testid="brief-size" className={ICON_BUTTON}>
            <Shape size={size} box={16} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          aria-label={b.sizes}
          className="pop-in z-40 flex max-h-[min(24rem,60vh)] w-64 flex-col overflow-y-auto rounded-[16px] surface-frost p-1.5 outline-none"
        >
          {AI_SIZE_PRESETS.map((preset) => (
            <button
              data-own-focus
              key={preset.id}
              type="button"
              data-preset={preset.id}
              aria-current={preset.id === size.id ? 'true' : undefined}
              onClick={() => {
                onPick(preset)
                setOpen(false)
              }}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-row px-2.5 py-2 text-start text-small text-text hovered:bg-hover hovered:lit aria-[current=true]:bg-hover',
                FOCUS,
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center text-muted">
                <Shape size={preset} box={16} />
              </span>
              <span className="min-w-0 flex-1 truncate">{t.editor.sizes.preset[preset.id]}</span>
              <span dir="ltr" className="shrink-0 font-mono text-tiny text-subtle tabular-nums">
                {sizeOf(preset)}
              </span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** A size's shape as a small outlined rectangle that fits a `box`-pixel square. */
function Shape({ size, box }: { size: { width: number; height: number }; box: number }) {
  return <span aria-hidden className="block rounded-[2px] border-[1.5px] border-current" style={shapeIn(size, box)} />
}
