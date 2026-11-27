'use client'

// The note that names a design once a job the person started on it ends, on any page: "Your drafts for ‘Diwali
// serum sale’ are ready", with a link to the design, staying until closed. One poll per tab reads the person's jobs
// (lib/ai-jobs.ts) and keeps going while the person moves between pages, so leaving a design stops nothing. In the
// editor, a note for the design that's open is told as the editor's toast instead, and a layering note for it is
// dropped, since the tab that has it open finishes the layers itself.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { JOB_STARTED, JOBS_CHANNEL } from '@/lib/ai-jobs.ts'
import { closeNotes, notesArrived, noteWords, onNotes, serverNotes, shownNotes, tabPoll } from '@/lib/ai-notes.ts'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { XIcon } from './icons.tsx'
import { FOCUS_RING, TOUCH_SQUARE } from './looks.ts'

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
  const shown = useSyncExternalStore(onNotes, shownNotes, serverNotes)
  const came = useSyncExternalStore(onNotes, notesArrived, notesArrived)

  useEffect(() => {
    const p = tabPoll()
    const wake = () => p.wake()
    const back = () => {
      if (document.visibilityState === 'visible') p.wake()
    }
    // Another tab of the person's that starts a job wakes this one too.
    const others = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(JOBS_CHANNEL)
    p.wake()
    window.addEventListener(JOB_STARTED, wake)
    others?.addEventListener('message', wake)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.removeEventListener(JOB_STARTED, wake)
      others?.close()
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
    const said = own.filter((note) => note.kind !== 'layers').map((note) => noteWords(t, note))
    if (said.length > 0) tell?.(said.join(' · '))
    closeNotes((note) => note.designId === openDesignId)
  }, [shown, openDesignId, tell, t])

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
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{noteWords(t, note)}</span>
          <Link
            href={brandPath(note.workspaceId, note.brandId, 'designs', note.designId)}
            prefetch={false}
            onClick={() => closeNotes((n) => n.jobId === note.jobId)}
            className={cn('shrink-0 rounded-row px-2.5 py-1 text-tiny font-semibold text-accent-text', FOCUS_RING)}
          >
            {t.aiNote.open}
          </Link>
          <button
            type="button"
            aria-label={t.aiNote.close}
            onClick={() => closeNotes((n) => n.jobId === note.jobId)}
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
