// A fake of the API's AI flow for the arrivals' tests, shared by every tab of a test as the API is: rounds it
// starts or refuses, the pictures their drafts make, the frames' states as the API reads them, and the calls
// marked written, as `markWritten` marks them.
import type { AiFrameView, AiFrameWritten, AiJobRefusal, AiJobView, DesignAi, StartAiJob } from '@dazbee/schema'

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
  /** Draft `n` of job `job` makes its picture, asset `assetId`. */
  make(job: string, n: number, assetId: string): void
  /** Call `index` of job `job` makes its picture, asset `assetId`. */
  makeCall(job: string, index: number, assetId: string): void
  /** The frame waits again, for the one call of a new job, as a try-again's; gives the job's id. */
  again(frameId: string): string
  /** The read of the design's AI frames gives what the API holds now. */
  design(): DesignAi
}

/** The call of a round that makes draft `n`: the plan is call 0. */
export const draftCall = (n: number) => n + 1

const AT = '2026-11-27T10:00:00.000Z'

export function fakeAi(): FakeAi {
  const started: StartAiJob[] = []
  const marks: (AiFrameWritten & { frameId: string })[] = []
  const frames: AiFrameView[] = []
  const jobs: AiJobView[] = []
  let reads = 0
  let refusal: AiJobRefusal | null = null

  const design = (): DesignAi => structuredClone({ frames, jobs, briefs: [] })

  function start(job: StartAiJob): Promise<AiStart> {
    if (refusal) {
      const refused = refusal
      refusal = null
      return Promise.resolve({ ok: false, refusal: refused, message: `refused: ${refused}` })
    }
    started.push(job)
    if (job.kind !== 'round') throw new Error(`the fake starts rounds only, not ${job.kind}`)
    const id = `job${started.length}`
    jobs.push({
      id,
      kind: 'round',
      state: 'running',
      output: null,
      calls: [
        { index: 0, step: 'flow.round-plan', state: 'done', output: { kind: 'text', text: '{}' } },
        ...job.frames.map((_, n) => ({ index: draftCall(n), step: 'flow.draft-fast', state: 'running' as const })),
      ],
      error: null,
      createdAt: AT,
      endedAt: null,
    })
    job.frames.forEach(({ frameId }, n) =>
      frames.push({
        frameId,
        briefId: 'brief',
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
      step: 'flow.draft-fast',
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
      calls: [{ index: 0, step: 'flow.draft-fast', state: 'running' }],
      error: null,
      createdAt: AT,
      endedAt: null,
    })
    Object.assign(frame, { jobId: id, callIndex: 0, state: 'waiting' })
    return id
  }

  function written(frameId: string, mark: AiFrameWritten): Promise<void> {
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
    make: (job, n, assetId) => makeCall(job, draftCall(n), assetId),
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
