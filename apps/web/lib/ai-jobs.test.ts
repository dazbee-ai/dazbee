import { describe, expect, it } from 'vitest'

import type { MyAiJob } from '@dazbee/schema'

import { type AiNoteView, noteKindOf, POLL_MS, pollJobs } from './ai-jobs.ts'

const AT = '2026-11-27T10:00:00.000Z'

const job = (id: string, over: Partial<MyAiJob> = {}): MyAiJob => ({
  id,
  kind: 'round',
  state: 'running',
  workspaceId: 'w',
  brandId: 'b',
  designId: 'd',
  designName: 'Diwali serum sale',
  image: null,
  made: 0,
  failed: 0,
  createdAt: AT,
  endedAt: null,
  ...over,
})

const ended = (id: string, over: Partial<MyAiJob> = {}) => job(id, { state: 'done', made: 4, endedAt: AT, ...over })

/** A poll over the answers `reads` gives in turn, with its timers kept to run by hand. */
function poll(reads: (readonly MyAiJob[])[]) {
  const timers: { ms: number; run: () => void }[] = []
  const notes: AiNoteView[] = []
  let n = 0
  const p = pollJobs({
    read: async () => reads[Math.min(n++, reads.length - 1)] ?? [],
    after: (ms, run) => {
      const timer = { ms, run }
      timers.push(timer)
      return () => timers.splice(timers.indexOf(timer), 1)
    },
    onNotes: (made) => notes.push(...made),
  })
  const tick = async () => {
    for (const timer of timers.splice(0)) timer.run()
    await new Promise((done) => setTimeout(done, 0))
  }
  return { p, timers, notes, tick, reads: () => n }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

describe('pollJobs', () => {
  it('reads every 10 s while a job runs on a design, notes it once it ends, and stops when none runs', async () => {
    const { p, timers, notes, tick, reads } = poll([[job('j1')], [job('j1')], [ended('j1')]])
    await settle()
    expect(timers.map((t) => t.ms)).toEqual([POLL_MS])
    await tick()
    expect(notes).toEqual([])
    await tick()
    expect(notes).toEqual([
      {
        jobId: 'j1',
        kind: 'ready',
        feature: 'round',
        workspaceId: 'w',
        brandId: 'b',
        designId: 'd',
        designName: 'Diwali serum sale',
      },
    ])
    expect(p.polling()).toBe(false)
    expect(reads()).toBe(3)
  })

  it('reads once and rests when nothing runs, until woken', async () => {
    const { p, timers, notes, reads } = poll([[ended('old')], [job('j2')]])
    await settle()
    expect(timers).toEqual([])
    expect(notes).toEqual([])
    p.wake()
    await settle()
    expect(reads()).toBe(2)
    expect(p.polling()).toBe(true)
    p.stop()
    expect(p.polling()).toBe(false)
  })

  it('tries a failed read again at the next turn, so a wake that meets a moment offline still finds its job', async () => {
    const timers: (() => void)[] = []
    const notes: AiNoteView[] = []
    const answers: (() => readonly MyAiJob[])[] = [
      () => [],
      () => {
        throw new Error('offline')
      },
      () => [job('j3')],
      () => [ended('j3')],
    ]
    const p = pollJobs({
      read: async () => (answers.shift() ?? (() => []))(),
      after: (_ms, run) => {
        timers.push(run)
        return () => {}
      },
      onNotes: (made) => notes.push(...made),
    })
    await settle()
    p.wake()
    await settle()
    expect(timers).toHaveLength(1)
    for (let n = 0; n < 2; n++) {
      timers.shift()?.()
      await settle()
    }
    expect(notes.map((note) => note.jobId)).toEqual(['j3'])
  })

  it('notes a job that ended while the page loaded, from the jobs that ran before the reload', async () => {
    const notes: AiNoteView[] = []
    const kept: (readonly string[])[] = []
    pollJobs({
      read: async () => [ended('j4')],
      after: () => () => {},
      onNotes: (made) => notes.push(...made),
      running: ['j4'],
      onRunning: (ids) => kept.push(ids),
    })
    await settle()
    expect(notes.map((note) => note.jobId)).toEqual(['j4'])
    expect(kept).toEqual([[]])
  })

  it('tells of the jobs a read finds started that the last read didn’t, once each', async () => {
    const started: (readonly string[])[] = []
    const timers: (() => void)[] = []
    const answers: (readonly MyAiJob[])[] = [[job('j5')], [job('j5'), job('j6')], [job('j5'), job('j6')]]
    pollJobs({
      read: async () => answers.shift() ?? [],
      after: (_ms, run) => {
        timers.push(run)
        return () => {}
      },
      onNotes: () => {},
      running: ['j5'],
      onStarted: (ids) => started.push(ids),
    })
    await settle()
    for (let n = 0; n < 2; n++) {
      timers.shift()?.()
      await settle()
    }
    expect(started).toEqual([['j6']])
  })

  it('gives no note for a job on no design, nor keeps polling for one', async () => {
    const { p, notes, tick } = poll([[job('img', { kind: 'image', designId: null, designName: null })], []])
    await settle()
    await tick()
    expect(p.polling()).toBe(false)
    expect(notes).toEqual([])
  })
})

describe('noteKindOf', () => {
  it('says ready, some, none, or almost done for layers, and nothing for a cancelled job', () => {
    expect(noteKindOf(ended('a'))).toBe('ready')
    expect(noteKindOf(ended('a', { failed: 1 }))).toBe('some')
    expect(noteKindOf(ended('a', { state: 'failed', made: 0, failed: 4 }))).toBe('none')
    expect(noteKindOf(ended('a', { kind: 'layering' }))).toBe('layers')
    expect(noteKindOf(ended('a', { kind: 'layering', state: 'failed' }))).toBe('none')
    expect(noteKindOf(ended('a', { state: 'cancelled' }))).toBeNull()
  })
})
