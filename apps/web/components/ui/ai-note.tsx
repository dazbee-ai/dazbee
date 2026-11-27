'use client'

// The note that names a design once a job the person started on it ends, on any page: "Your drafts for ‘Diwali
// serum sale’ are ready", with a link to the design, staying until closed. One poll per tab reads the person's jobs
// (lib/ai-jobs.ts) and keeps going while the person moves between pages, so leaving a design stops nothing. In the
// editor, a note for the design that's open is told as the editor's toast instead, and a layering note for it is
// dropped, since the tab that has it open finishes the layers itself.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { MyAiJob } from '@dazbee/schema'

import { type AiNoteView, JOB_STARTED, type NoteKind, pollJobs } from '@/lib/ai-jobs.ts'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format, type Messages } from '@/lib/i18n/index.ts'

import { XIcon } from './icons.tsx'
import { FOCUS_RING, TOUCH_SQUARE } from './looks.ts'

/** The notes showing in this tab, oldest first, kept as the person moves between pages. */
let notes: readonly AiNoteView[] = []
/** How many times notes came in this tab. */
let arrived = 0
const listeners = new Set<() => void>()
let poll: ReturnType<typeof pollJobs> | null = null

function setNotes(next: readonly AiNoteView[]) {
  notes = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Starts this tab's poll, once. */
function startPoll() {
  poll ??= pollJobs({
    read: async () => {
      const response = await fetch('/me/ai-jobs', { cache: 'no-store' })
      if (!response.ok) throw new Error(`The jobs read answered ${response.status}`)
      return MyAiJob.array().parse(await response.json())
    },
    after: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    onNotes: (made) => {
      arrived += 1
      setNotes([...notes.filter((n) => !made.some((m) => m.jobId === n.jobId)), ...made])
    },
  })
  return poll
}

/** What a note says of its design. */
export function noteWords(t: Messages, note: Pick<AiNoteView, 'kind' | 'feature' | 'designName'>): string {
  const w = t.aiNote
  const made = note.feature === 'resize' ? 'sizes' : note.feature === 'refine' ? 'change' : 'drafts'
  const said: Record<NoteKind, string> = {
    ready: w.ready[made],
    some: w.some,
    none: w.none,
    layers: w.layers,
  }
  return format(said[note.kind], { name: note.designName })
}

export function AiNote({
  openDesignId,
  tell,
}: {
  /** The design open in the editor, whose notes are told as its toast. */
  openDesignId?: string
  /** Shows `text` as the editor's toast. */
  tell?: (text: string) => void
}) {
  const t = useMessages()
  const router = useRouter()
  const shown = useSyncExternalStore(
    subscribe,
    () => notes,
    () => notes,
  )
  const came = useSyncExternalStore(
    subscribe,
    () => arrived,
    () => arrived,
  )

  useEffect(() => {
    const p = startPoll()
    const wake = () => p.wake()
    const back = () => {
      if (document.visibilityState === 'visible') p.wake()
    }
    p.wake()
    window.addEventListener(JOB_STARTED, wake)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.removeEventListener(JOB_STARTED, wake)
      document.removeEventListener('visibilitychange', back)
    }
  }, [])

  // Outside the editor, notes coming in while the page shows bring its dots up to date.
  const seen = useRef(came)
  useEffect(() => {
    if (came === seen.current) return
    seen.current = came
    if (openDesignId === undefined) router.refresh()
  }, [came, openDesignId, router])

  // The open design's notes go to its toast.
  useEffect(() => {
    if (openDesignId === undefined) return
    const own = shown.filter((n) => n.designId === openDesignId)
    if (own.length === 0) return
    for (const note of own) if (note.kind !== 'layers') tell?.(noteWords(t, note))
    setNotes(notes.filter((n) => n.designId !== openDesignId))
  }, [shown, openDesignId, tell, t, router])

  const showing = shown.filter((n) => n.designId !== openDesignId)
  if (showing.length === 0) return null
  return (
    <ul
      aria-label={t.aiNote.label}
      className="pointer-events-none fixed end-4 bottom-4 z-50 flex max-w-[min(26rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {showing.map((note) => (
        <li
          key={note.jobId}
          role="status"
          data-testid="ai-note"
          className="toast-in pointer-events-auto flex min-h-10 items-center gap-2 rounded-card surface-frost py-1.5 ps-3.5 pe-1.5 text-small"
        >
          <span className="min-w-0 flex-1">{noteWords(t, note)}</span>
          <Link
            href={brandPath(note.workspaceId, note.brandId, 'designs', note.designId)}
            prefetch={false}
            onClick={() => setNotes(notes.filter((n) => n.jobId !== note.jobId))}
            className={cn('shrink-0 rounded-row px-2.5 py-1 text-tiny font-semibold text-accent-text', FOCUS_RING)}
          >
            {t.aiNote.open}
          </Link>
          <button
            type="button"
            aria-label={t.aiNote.close}
            onClick={() => setNotes(notes.filter((n) => n.jobId !== note.jobId))}
            className={cn(
              'grid size-7 shrink-0 cursor-pointer place-items-center rounded-row text-muted hover:bg-hover',
              TOUCH_SQUARE,
              FOCUS_RING,
            )}
          >
            <XIcon size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
