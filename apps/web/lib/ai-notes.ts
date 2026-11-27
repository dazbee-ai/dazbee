// This tab's AI notes: the one poll of the person's jobs (ai-jobs.ts), started once and kept while the person moves
// between pages, the notes it made that still show, and what each note says.
import { MyAiJob } from '@dazbee/schema'

import { format, type Messages } from '@/lib/i18n/index.ts'

import { type AiNoteView, type NoteKind, pollJobs } from './ai-jobs.ts'

/** The notes showing in this tab, oldest first. */
let notes: readonly AiNoteView[] = []
/** How many times notes came in this tab. */
let arrived = 0
const listeners = new Set<() => void>()
let poll: ReturnType<typeof pollJobs> | null = null

/** This tab's poll, started on the first call. */
export function tabPoll() {
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

/** Calls `listener` whenever the notes change; the answer stops it. */
export function onNotes(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The notes showing. */
export function shownNotes() {
  return notes
}

/** How many times notes came, which grows by one each time some do. */
export function notesArrived() {
  return arrived
}

/** Closes the notes `closing` picks. */
export function closeNotes(closing: (note: AiNoteView) => boolean) {
  setNotes(notes.filter((note) => !closing(note)))
}

/** What a note says of its design. */
export function noteWords(t: Messages, note: Pick<AiNoteView, 'kind' | 'feature' | 'designName'>): string {
  const w = t.aiNote
  const made = note.feature === 'resize' ? 'sizes' : note.feature === 'refine' ? 'change' : 'drafts'
  const said: Record<NoteKind, string> = {
    ready: w.ready[made],
    some: made === 'sizes' ? w.some.sizes : w.some.drafts,
    none: w.none,
    layers: w.layers,
  }
  return format(said[note.kind], { name: note.designName })
}

function setNotes(next: readonly AiNoteView[]) {
  notes = next
  for (const listener of listeners) listener()
}
