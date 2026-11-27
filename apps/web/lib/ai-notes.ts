// This tab's AI notes: the one poll of the person's jobs (ai-jobs.ts), started once and kept while the person moves
// between pages, the notes it made that still show, and what each note says. The notes and the jobs that ran at
// the last read are kept in the tab's session storage, so a reload keeps the notes until closed and still notes a
// job that ended while the page loaded.
import { z } from 'zod'

import { MyAiJob } from '@dazbee/schema'

import { format, type Messages } from '@/lib/i18n/index.ts'

import { type AiNoteView, JOBS_CHANNEL, type NoteKind, pollJobs } from './ai-jobs.ts'

/** Where the tab keeps its notes, and the jobs on a design that ran at its last read. */
const NOTES_KEY = 'dazbee.aiNotes'
const RUNNING_KEY = 'dazbee.aiRunning'

const StoredNote = z.object({
  jobId: z.string(),
  kind: z.enum(['ready', 'some', 'none', 'layers']),
  feature: MyAiJob.shape.kind,
  workspaceId: z.string(),
  brandId: z.string(),
  designId: z.string(),
  designName: z.string(),
})

/** No notes, as the server draws the page and the page first hydrates. */
const NO_NOTES: readonly AiNoteView[] = []

/** The notes showing in this tab, oldest first. */
let notes: readonly AiNoteView[] = stored(NOTES_KEY, StoredNote.array()) ?? []
/** How many times notes came, or jobs were found started, in this tab: the page's dots may have changed. */
let changes = 0
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
    running: stored(RUNNING_KEY, z.string().array()) ?? [],
    onRunning: (ids) => store(RUNNING_KEY, ids),
    // A job found started, as a round the brand's home started on the server, may be news to the person's other tabs.
    onStarted: () => {
      changes += 1
      tellOtherTabs()
      for (const listener of listeners) listener()
    },
    onNotes: (made) => {
      changes += 1
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

/** The notes as the server draws them: none, since only the tab keeps them. */
export function serverNotes() {
  return NO_NOTES
}

/** How many times the jobs changed as the page shows them, growing by one each time notes come or jobs start. */
export function jobsChanged() {
  return changes
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

/** Tells the person's other tabs that a job started, which wakes their polls. */
function tellOtherTabs() {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(JOBS_CHANNEL)
  channel.postMessage('started')
  channel.close()
}

/** What the tab keeps under `key`, read as `schema`; null when there is none, or no storage. */
function stored<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    const kept = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key)
    return kept === null ? null : schema.parse(JSON.parse(kept))
  } catch {
    return null
  }
}

function setNotes(next: readonly AiNoteView[]) {
  notes = next
  store(NOTES_KEY, next)
  for (const listener of listeners) listener()
}

/** Keeps `value` under `key` in the tab's session storage, where there is one. */
function store(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // No storage, as in a private window: the tab keeps it in memory only.
  }
}
