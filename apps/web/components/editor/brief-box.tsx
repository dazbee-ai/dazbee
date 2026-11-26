'use client'

// The brief box in a design, just above the tool dock: a few words, pictures uploaded to the brand's images, one
// size the AI is offered and Fast or Precise, in one compact capsule. Enter starts the round; once its job is
// saved, its section and four frames are placed below everything on the page and fill as their pictures arrive,
// and the view fits them. A brief that doesn't start places nothing, and the box says why in place. It warns
// when four more drafts would take the design past its size warning.
import { type KeyboardEvent, useRef, useState } from 'react'

import { briefPassesWarning, type Editor } from '@dazbee/editor'
import { type AiMode, type AssetSummary, MAX_REFERENCES, SIZE_CHANNELS } from '@dazbee/schema'

import { CircleNotchIcon, PlusIcon, XIcon } from '@/components/ui/icons.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { AI_SIZE_PRESETS, type BriefSaid, briefSaid } from '@/lib/editor/brief-box.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { IMAGE_ACCEPT, sendAsset } from '@/lib/upload-asset.ts'

/** A picture of the brief: uploading, uploaded as an asset of the brand, or not uploaded. */
interface Picture {
  key: string
  name: string
  asset?: AssetSummary
  failed?: boolean
}

const MODES: readonly AiMode[] = ['fast', 'precise']

const ROUND_BUTTON =
  'grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text active:bg-pressed disabled:cursor-not-allowed disabled:opacity-45'

export function BriefBox({
  workspaceId,
  brandId,
  editor,
  onClose,
}: {
  workspaceId: string
  brandId: string
  /** The editor, once it runs: until then nothing starts. */
  editor: Editor | null
  onClose: () => void
}) {
  const t = useMessages()
  const b = t.editor.brief
  const [words, setWords] = useState('')
  const [pictures, setPictures] = useState<Picture[]>([])
  const [sizeId, setSizeId] = useState<string>(AI_SIZE_PRESETS[0]?.id ?? '')
  const [mode, setMode] = useState<AiMode>('fast')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<BriefSaid | null>(null)
  const files = useRef<HTMLInputElement>(null)
  const size = AI_SIZE_PRESETS.find((preset) => preset.id === sizeId) ?? AI_SIZE_PRESETS[0]
  const uploading = pictures.some((p) => !p.asset && !p.failed)
  const ready = Boolean(editor && size && words.trim() !== '' && !busy && !uploading)
  const nearLimit = editor ? briefPassesWarning(editor.designSize()) : false

  const upload = (picked: File[]) => {
    for (const file of picked.slice(0, MAX_REFERENCES - pictures.length)) {
      const key = crypto.randomUUID()
      const change = (patch: Partial<Picture>) =>
        setPictures((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)))
      setPictures((all) => [...all, { key, name: file.name }])
      sendAsset(workspaceId, brandId, file, () => {})
        .then((asset) => change({ asset }))
        .catch(() => change({ failed: true }))
    }
  }

  async function make() {
    if (!editor || !size || !ready) return
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
        setSaid(briefSaid(started.refusal))
        return
      }
      editor.fitSection(started.sectionId)
      setWords('')
      setPictures([])
      onClose()
    } catch {
      setSaid('notStarted')
    } finally {
      setBusy(false)
    }
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') onClose()
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void make()
  }

  return (
    <section
      aria-label={b.label}
      data-testid="brief-box"
      className="absolute start-1/2 bottom-(--above-dock) z-20 flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 flex-col gap-2 rounded-[20px] surface-frost p-3 rtl:translate-x-1/2"
    >
      {pictures.length > 0 && (
        <ul aria-label={b.addPictures} className="flex flex-wrap gap-1.5">
          {pictures.map((picture) => (
            <PictureChip
              key={picture.key}
              picture={picture}
              src={picture.asset && brandPath(workspaceId, brandId, 'assets', picture.asset.id, 'thumbnail')}
              onRemove={() => setPictures((all) => all.filter((p) => p.key !== picture.key))}
            />
          ))}
        </ul>
      )}
      <textarea
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
        className="w-full resize-none bg-transparent px-1 text-body text-text outline-none placeholder:text-subtle"
      />
      {said && (
        <p role="status" data-testid="brief-said" className="px-1 text-small text-danger-text">
          {b[said]}
        </p>
      )}
      {nearLimit && !said && <p className="px-1 text-small text-muted">{b.nearLimit}</p>}
      <div className="flex items-center gap-2">
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
        <button
          type="button"
          aria-label={b.addPictures}
          title={b.addPictures}
          disabled={pictures.length >= MAX_REFERENCES}
          onClick={() => files.current?.click()}
          className={ROUND_BUTTON}
        >
          <PlusIcon size={16} aria-hidden />
        </button>
        <select
          name="brief-size"
          aria-label={b.size}
          value={size?.id}
          onChange={(event) => setSizeId(event.target.value)}
          className="h-8 min-w-0 max-w-[12rem] cursor-pointer truncate rounded-full border-[1.5px] border-line bg-transparent px-2 text-small text-text"
        >
          {SIZE_CHANNELS.map((channel) => {
            const presets = AI_SIZE_PRESETS.filter((preset) => preset.channel === channel)
            if (presets.length === 0) return null
            return (
              <optgroup key={channel} label={t.editor.sizes.channel[channel]}>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {t.editor.sizes.preset[preset.id]}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
        <div
          role="radiogroup"
          aria-label={b.mode}
          className="flex shrink-0 rounded-full border-[1.5px] border-line p-0.5"
        >
          {MODES.map((each) => (
            <button
              key={each}
              type="button"
              role="radio"
              aria-checked={mode === each}
              title={b[`${each}Line`]}
              onClick={() => setMode(each)}
              className={cn(
                'h-6 cursor-pointer rounded-full px-2.5 text-small font-semibold transition-colors duration-[var(--chrome-fast)]',
                mode === each ? 'bg-accent-solid text-on-accent' : 'text-muted hover:text-text',
              )}
            >
              {b[each]}
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-caption text-subtle">{b[`${mode}Line`]}</span>
        <button
          type="button"
          disabled={!ready}
          onClick={() => void make()}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-accent-solid px-3.5 text-small font-semibold text-on-accent transition-colors duration-[var(--chrome-fast)] hover:bg-accent-solid-hover disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy && <CircleNotchIcon size={14} aria-hidden className="animate-spin" />}
          {busy ? b.making : b.make}
        </button>
        <button type="button" aria-label={b.close} title={b.close} onClick={onClose} className={ROUND_BUTTON}>
          <XIcon size={14} aria-hidden />
        </button>
      </div>
    </section>
  )
}

/** A picture of the brief as a small chip: its thumbnail once uploaded, its name, and a button that removes it. */
function PictureChip({ picture, src, onRemove }: { picture: Picture; src: string | undefined; onRemove: () => void }) {
  const b = useMessages().editor.brief
  const note = picture.failed ? b.notUploaded : picture.asset ? null : b.uploading
  return (
    <li
      className={cn(
        'flex h-8 max-w-[10rem] items-center gap-1.5 rounded-full border-[1.5px] border-line ps-1 pe-0.5 text-caption',
        picture.failed && 'border-danger-line text-danger-text',
      )}
      title={note ? format(note, { name: picture.name }) : picture.name}
    >
      {src ? (
        <img src={src} alt="" className="size-6 shrink-0 rounded-full object-cover" />
      ) : (
        <CircleNotchIcon size={14} aria-hidden className={cn('shrink-0', !picture.failed && 'animate-spin')} />
      )}
      <span className="min-w-0 flex-1 truncate">{picture.name}</span>
      <button
        type="button"
        aria-label={format(b.removePicture, { name: picture.name })}
        onClick={onRemove}
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-subtle hover:bg-hover hover:text-text"
      >
        <XIcon size={12} aria-hidden />
      </button>
    </li>
  )
}
