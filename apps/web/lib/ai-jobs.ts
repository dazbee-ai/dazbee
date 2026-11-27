// The poll behind the note that names a design once a job the person started on it ends: the person's own jobs
// read every 10 s while one runs on a design, and not at all once none does, until the poll is woken again, as
// when a job starts in this tab or the tab comes back into view. A job on no design, such as Make an image's, gets
// no note: its picture shows in Assets.
import type { MyAiJob } from '@dazbee/schema'

/** How often the person's jobs are read while one runs: 10 s. */
export const POLL_MS = 10_000

/** The window event a tab sends when it starts a job, which wakes the poll. */
export const JOB_STARTED = 'dazbee:ai-job-started'

/** What a note says of a job that ended. */
export type NoteKind = 'ready' | 'some' | 'none' | 'layers'

/** A note for a job that ended on a design. */
export interface AiNoteView {
  jobId: string
  kind: NoteKind
  /** The job's feature, which names what was made: drafts, sizes or a change. */
  feature: MyAiJob['kind']
  workspaceId: string
  brandId: string
  designId: string
  designName: string
}

/** Whether `job` is on a design and hasn't ended. */
function runsOnDesign(job: MyAiJob): boolean {
  return job.designId !== null && job.endedAt === null
}

/**
 * What the note for `job`, ended, says: for layering, that the layers are almost done, a tab finishing them; for
 * the rest, ready, some that didn't come out, or none; null for a cancelled job.
 */
export function noteKindOf(job: MyAiJob): NoteKind | null {
  if (job.state === 'cancelled') return null
  if (job.kind === 'layering') return job.state === 'done' ? 'layers' : 'none'
  if (job.made === 0) return 'none'
  return job.failed > 0 ? 'some' : 'ready'
}

/** The notes for the jobs on a design that ran at the last read, `running`, and have ended in `now`. */
export function notesOf(running: ReadonlySet<string>, now: readonly MyAiJob[]): AiNoteView[] {
  return now.flatMap((job) => {
    if (!running.has(job.id) || job.endedAt === null || !job.designId) return []
    const kind = noteKindOf(job)
    if (!kind) return []
    return [
      {
        jobId: job.id,
        kind,
        feature: job.kind,
        workspaceId: job.workspaceId,
        brandId: job.brandId,
        designId: job.designId,
        designName: job.designName ?? '',
      },
    ]
  })
}

/** What the poll needs from its page: the read, a timer, and where its notes go. */
export interface JobPollDeps {
  read: () => Promise<readonly MyAiJob[]>
  /** Runs `run` after `ms`; the answer cancels it. */
  after: (ms: number, run: () => void) => () => void
  onNotes: (notes: AiNoteView[]) => void
}

/**
 * The person's jobs, read now and every `POLL_MS` while one runs on a design; once none does, the poll rests until
 * `wake`. A read that fails is tried again at the next turn. `stop` ends it.
 */
export function pollJobs(deps: JobPollDeps) {
  /** The jobs on a design that ran at the last read. */
  let running = new Set<string>()
  let reading = false
  /** Whether a wake came during a read, which may have been sent before the job it is for was saved. */
  let again = false
  let stopped = false
  let cancel: (() => void) | null = null

  async function check() {
    if (stopped) return
    if (reading) {
      again = true
      return
    }
    again = false
    cancel?.()
    cancel = null
    reading = true
    let next = running.size > 0
    try {
      const jobs = await deps.read()
      if (stopped) return
      const notes = notesOf(running, jobs)
      running = new Set(jobs.filter(runsOnDesign).map((job) => job.id))
      if (notes.length > 0) deps.onNotes(notes)
      next = running.size > 0
    } catch {
      // Offline or signed out: tried again at the next turn, if one was due.
    } finally {
      reading = false
    }
    if (again) void check()
    else if (next && !stopped) cancel = deps.after(POLL_MS, () => void check())
  }

  void check()
  return {
    /** Reads now, as when a job started or the tab came back. */
    wake: () => void check(),
    /** Whether a next read is due. */
    polling: () => cancel !== null,
    stop: () => {
      stopped = true
      cancel?.()
      cancel = null
    },
  }
}

/** Tells this tab's poll that a job started. */
export function aiJobStarted() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(JOB_STARTED))
}
