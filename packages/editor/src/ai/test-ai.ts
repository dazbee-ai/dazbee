// A fake of the API's AI flow for the arrivals' tests, shared by every tab of a test as the API is: rounds, more
// like this, refines, layering and try again it starts or refuses, with their briefs and refines; a layering job's
// split layers and its finish's lease; the pictures their drafts make and the drafts that
// fail; the frames' states as the API reads them; and the calls marked written, as `markWritten` marks them.
import {
  AI_CALL_FAILURES,
  type AiBriefView,
  type AiFrameView,
  type AiFrameWritten,
  type AiJobRefusal,
  type AiJobView,
  type AiRefineLink,
  type DesignAi,
  LAYERING_CALL,
  REFINE_CALL,
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
  /** Layering job `job` ends with its plan and frame `n`'s split layers made: each split file's PNG bytes. */
  split(job: string, n: number, files: readonly Uint8Array[], plan?: unknown): void
  /** The finish's lease lapses, as when the tab holding it closes. */
  lapse(): void
  /** The holders whose claims were granted, in order, and the finishes ended. */
  readonly claims: string[]
  readonly finishes: string[]
  /** The parts uploaded, in order. */
  readonly parts: Uint8Array[]
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
  const refines: AiRefineLink[] = []
  const files = new Map<string, Uint8Array[]>()
  const claims: string[] = []
  const finishes: string[] = []
  const parts: Uint8Array[] = []
  let lease: string | null = null
  let reads = 0
  let refusal: AiJobRefusal | null = null
  let markFails = false

  const design = (): DesignAi => structuredClone({ frames, jobs, briefs, refines })

  function start(job: StartAiJob): Promise<AiStart> {
    if (refusal) {
      const refused = refusal
      refusal = null
      return Promise.resolve({ ok: false, refusal: refused, message: `refused: ${refused}` })
    }
    started.push(job)
    if (job.kind === 'try-again') return Promise.resolve({ ok: true, job: again(job.frameId) })
    if (job.kind === 'refine') return Promise.resolve({ ok: true, job: refineJob(job) })
    if (job.kind === 'layering') return Promise.resolve({ ok: true, job: layeringJob(job) })
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

  /** A layering job, each call running, its frames being made editable; gives the job's id. */
  function layeringJob(job: Extract<StartAiJob, { kind: 'layering' }>): string {
    const id = `job${started.length}`
    jobs.push({
      id,
      kind: 'layering',
      state: 'running',
      output: null,
      calls: [
        { index: LAYERING_CALL.plan, function: 'layer-plan', state: 'running' },
        ...job.frames.map((_, n) => ({
          index: LAYERING_CALL.split(n),
          function: 'layer-split',
          state: 'running' as const,
        })),
      ],
      error: null,
      createdAt: AT,
      endedAt: null,
    })
    job.frames.forEach(({ frameId }, n) => {
      const frame = frames.find((f) => f.frameId === frameId)
      if (frame) Object.assign(frame, { jobId: id, callIndex: LAYERING_CALL.split(n), state: 'layering' })
    })
    return id
  }

  function split(jobId: string, n: number, made: readonly Uint8Array[], plan: unknown = null) {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) throw new Error(`no job ${jobId}`)
    files.set(jobId, [...made])
    job.state = 'done'
    job.endedAt = AT
    job.calls = job.calls.map((call) => {
      if (call.index === LAYERING_CALL.plan)
        return { ...call, state: 'done', output: { kind: 'text', text: '', json: plan } }
      if (call.index !== LAYERING_CALL.split(n)) return call
      const layers = made.map((_, i) => ({ key: `originals/${jobId}-${i}`, width: 512, height: 512 }))
      return { ...call, state: 'done', output: { kind: 'layers', layers, gpuSeconds: 1 } }
    })
  }

  /** A refine's job, its plan done and its edit running, and its refine; gives the job's id. */
  function refineJob(job: Extract<StartAiJob, { kind: 'refine' }>): string {
    const id = `job${started.length}`
    jobs.push({
      id,
      kind: 'refine',
      state: 'running',
      output: null,
      calls: [
        { index: REFINE_CALL.plan, function: 'refine-plan', state: 'done', output: { kind: 'text', text: '{}' } },
        { index: REFINE_CALL.edit, function: 'refine-edit', state: 'running' },
      ],
      error: null,
      createdAt: AT,
      endedAt: null,
    })
    refines.push({
      id: `refine${refines.length + 1}`,
      frameId: job.frameId,
      pictureLayerId: job.pictureLayerId,
      jobId: id,
      resultAssetId: null,
    })
    return id
  }

  function written(frameId: string, mark: AiFrameWritten): Promise<void> {
    if (markFails) {
      markFails = false
      return Promise.reject(new Error('the network is down'))
    }
    const change = refines.find(
      (r) => r.frameId === frameId && r.jobId === mark.jobId && mark.callIndex === REFINE_CALL.edit,
    )
    const edit = jobs.find((j) => j.id === mark.jobId)?.calls.find((c) => c.index === REFINE_CALL.edit)
    if (change && edit?.state === 'done' && edit.output.kind === 'pictures') {
      marks.push({ frameId, ...mark })
      change.resultAssetId = edit.output.pictures[0]?.assetId ?? null
      return Promise.resolve()
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
    layerWord: 'Layer',
    started,
    marks,
    claims,
    finishes,
    parts,
    split,
    lapse: () => {
      lease = null
    },
    claim: (_jobId, holder) => {
      if (lease !== null && lease !== holder) return Promise.resolve(false)
      lease = holder
      claims.push(holder)
      return Promise.resolve(true)
    },
    finished: (jobId, holder) => {
      if (lease !== holder) return Promise.reject(new Error('another tab holds the finish'))
      lease = null
      finishes.push(jobId)
      for (const frame of frames) if (frame.jobId === jobId && frame.state === 'layering') frame.state = 'editable'
      return Promise.resolve()
    },
    file: (jobId, index) => {
      const bytes = files.get(jobId)?.[index]
      return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`no file ${index} of ${jobId}`))
    },
    part: (png) => {
      parts.push(png)
      return Promise.resolve(`part${parts.length}`)
    },
    reads: () => reads,
    refuseNext: (why) => {
      refusal = why
    },
    failNextMark: () => {
      markFails = true
    },
    make: (job, n, assetId) => makeCall(job, draftCall(n), assetId),
    fail: (jobId, n) => {
      const job = jobs.find((j) => j.id === jobId)
      const at = job?.calls.findIndex((c) => c.index === draftCall(n)) ?? -1
      const call = job?.calls[at]
      const frame = frames.find((f) => f.jobId === jobId && f.callIndex === draftCall(n))
      if (!job || !call || !frame) throw new Error(`no draft ${n} of ${jobId}`)
      job.calls[at] = { index: call.index, function: call.function, state: 'failed', failure: FAILURE }
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
