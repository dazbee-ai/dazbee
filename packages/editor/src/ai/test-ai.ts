// A fake of the API's AI flow for the arrivals' tests, shared by every tab of a test as the API is: rounds, more
// like this and try again it starts or refuses, with their briefs; the pictures their drafts make and the drafts that
// fail; the frames' states as the API reads them; and the calls marked written, as `markWritten` marks them.
import {
  AI_CALL_FAILURES,
  type AiBriefView,
  type AiFrameView,
  type AiFrameWritten,
  type AiJobRefusal,
  type AiJobView,
  type DesignAi,
  type StartAiJob,
} from '@dazbee/schema'

import type { AiStart, EditorAi } from './arrivals.ts'

export interface FakeAi extends EditorAi {
  /** The jobs started, in order. */
  readonly started: StartAiJob[]
  /** The calls marked written, in order, each once it is marked. */
  readonly marks: (AiFrameWritten & { frameId: string })[]
  /** How many times the frames were read. */
  reads(): number
  /** Refuses the next job started, with why. */
  refuseNext(refusal: AiJobRefusal): void
  /** Draft `n` of job `job` fails. */
  fail(job: string, n: number): void
  /** Draft `n` of job `job` makes its picture, asset `assetId`. */
  make(job: string, n: number, assetId: string): void
  /** Call `index` of job `job` makes its picture, asset `assetId`. */
  makeCall(job: string, index: number, assetId: string): void
  /** The frame waits again, for the one call of a new job, as a try-again's; gives the job's id. */
  again(frameId: string): string
  /** The next mark of a call written fails, as with the network down, and marks nothing. */
  failNextMark(): void
  /** The read of the design's AI frames gives what the API holds now. */
  design(): DesignAi
}

/** The call of a round that makes draft `n`: the plan is call 0. */
export const draftCall = (n: number) => n + 1

const AT = '2026-11-27T10:00:00.000Z'

/** Why a failed draft of the fake failed. */
const FAILURE = AI_CALL_FAILURES[0]

export function fakeAi(): FakeAi {
  const started: StartAiJob[] = []
  const marks: (AiFrameWritten & { frameId: string })[] = []
  const frames: AiFrameView[] = []
  const jobs: AiJobView[] = []
  const briefs: AiBriefView[] = []
  let reads = 0
  let refusal: AiJobRefusal | null = null
  let markFails = false

  const design = (): DesignAi => structuredClone({ frames, jobs, briefs })

  function start(job: StartAiJob): Promise<AiStart> {
    if (refusal) {
      const refused = refusal
      refusal = null
      return Promise.resolve({ ok: false, refusal: refused, message: `refused: ${refused}` })
    }
    started.push(job)
    if (job.kind === 'try-again') return Promise.resolve({ ok: true, job: again(job.frameId) })
    if (job.kind !== 'round' && job.kind !== 'more-like-this')
      throw new Error(`the fake starts rounds and more like this only, not ${job.kind}`)
    const id = `job${started.length}`
    const briefId = `brief${started.length}`
    briefs.push({
      id: briefId,
      sectionId: job.sectionId,
      title: job.words.trim(),
      words: job.words,
      pictureAssetIds: job.pictures,
      referenceAssetId: null,
      size: job.size,
      mode: job.mode,
      planned: true,
      createdAt: AT,
    })
    jobs.push({
      id,
      kind: job.kind,
      state: 'running',
      output: null,
      calls: [
        { index: 0, function: 'round-plan', state: 'done', output: { kind: 'text', text: '{}' } },
        ...job.frames.map((_, n) => ({ index: draftCall(n), function: 'draft', state: 'running' as const })),
      ],
      error: null,
      createdAt: AT,
      endedAt: null,
    })
    job.frames.forEach(({ frameId }, n) =>
      frames.push({
        frameId,
        briefId,
        jobId: id,
        callIndex: draftCall(n),
        kind: 'draft',
        state: 'waiting',
        assetId: null,
        updatedAt: AT,
      }),
    )
    return Promise.resolve({ ok: true, job: id })
  }

  function makeCall(jobId: string, index: number, assetId: string) {
    const job = jobs.find((j) => j.id === jobId)
    const at = job?.calls.findIndex((c) => c.index === index) ?? -1
    if (!job || at < 0) throw new Error(`no call ${index} of ${jobId}`)
    job.calls[at] = {
      index,
      function: 'draft',
      state: 'done',
      output: { kind: 'pictures', pictures: [{ key: `originals/${assetId}`, width: 1080, height: 1080, assetId }] },
    }
  }

  function again(frameId: string): string {
    const frame = frames.find((f) => f.frameId === frameId)
    if (!frame) throw new Error(`no AI frame ${frameId}`)
    const id = `job${jobs.length + 1}`
    jobs.push({
      id,
      kind: 'try-again',
      state: 'running',
      output: null,
      calls: [{ index: 0, function: 'draft', state: 'running' }],
      error: null,
      createdAt: AT,
      endedAt: null,
    })
    Object.assign(frame, { jobId: id, callIndex: 0, state: 'waiting' })
    return id
  }

  function written(frameId: string, mark: AiFrameWritten): Promise<void> {
    if (markFails) {
      markFails = false
      return Promise.reject(new Error('the network is down'))
    }
    const frame = frames.find((f) => f.frameId === frameId)
    const call = jobs.find((j) => j.id === mark.jobId)?.calls.find((c) => c.index === mark.callIndex)
    if (!frame || frame.jobId !== mark.jobId || frame.callIndex !== mark.callIndex || call?.state !== 'done')
      return Promise.reject(new Error(`call ${mark.jobId}/${mark.callIndex} can't be marked on ${frameId}`))
    marks.push({ frameId, ...mark })
    if (frame.state === 'waiting' && call.output.kind === 'pictures') {
      frame.state = 'arrived'
      frame.assetId = call.output.pictures[0]?.assetId ?? null
    }
    return Promise.resolve()
  }

  return {
    started,
    marks,
    reads: () => reads,
    refuseNext: (why) => {
      refusal = why
    },
    failNextMark: () => {
      markFails = true
    },
    make: (job, n, assetId) => makeCall(job, draftCall(n), assetId),
    fail: (jobId, n) => {
      const call = jobs.find((j) => j.id === jobId)?.calls.find((c) => c.index === draftCall(n))
      const frame = frames.find((f) => f.jobId === jobId && f.callIndex === draftCall(n))
      if (!call || !frame) throw new Error(`no draft ${n} of ${jobId}`)
      const at = jobs.find((j) => j.id === jobId)?.calls.indexOf(call) ?? -1
      const job = jobs.find((j) => j.id === jobId)
      if (job) job.calls[at] = { index: call.index, function: call.function, state: 'failed', failure: FAILURE }
      frame.state = 'failed'
    },
    makeCall,
    again,
    design,
    read: () => {
      reads++
      return Promise.resolve(design())
    },
    start,
    written,
  }
}
