// Making drafts from the brand home, with the API faked: the design made, the round started with its ids, and a
// refused round's design deleted.
import { describe, expect, it, vi } from 'vitest'

import { type StartRound, WAITING_FILL } from '@dazbee/schema'

import type { JobStart } from './ai-flow.ts'
import { type BriefStartApi, startBriefDesign } from './brief-start.ts'

vi.mock('server-only', () => ({}))

const BRIEF = { words: 'Diwali sale', pictures: ['a1'], size: { width: 1080, height: 1080 }, mode: 'fast' as const }

/** The API faked: the design it made, the round it was asked to start, and what it deleted. */
function fakeApi(answer: () => Promise<JobStart>) {
  const made: unknown[] = []
  const rounds: StartRound[] = []
  const deleted: string[] = []
  const api: BriefStartApi = {
    createDesign: (_name, content) => {
      made.push(content)
      return Promise.resolve({ id: 'd1' })
    },
    startRound: (round) => {
      rounds.push(round)
      return answer()
    },
    deleteDesign: (id) => {
      deleted.push(id)
      return Promise.resolve(null)
    },
  }
  return { api, made, rounds, deleted }
}

const start = (api: BriefStartApi) => {
  let n = 0
  return startBriefDesign(api, {
    brief: BRIEF,
    name: 'Diwali sale',
    draftName: (d) => `Draft ${d + 1}`,
    newId: () => `id${++n}`,
  })
}

describe('startBriefDesign', () => {
  it('makes a design of the brief’s section and four waiting drafts, then starts its round with their ids', async () => {
    const { api, made, rounds, deleted } = fakeApi(() =>
      Promise.resolve({ ok: true, started: { job: 'j1', briefId: 'b1' } }),
    )
    expect(await start(api)).toEqual({ designId: 'd1' })
    const content = made[0] as { frames: Record<string, unknown>; nodes: Record<string, { props: { fills: unknown } }> }
    expect(Object.keys(content.frames)).toEqual(['id1', 'id2', 'id3', 'id4'])
    expect(content.nodes['id1-picture']?.props.fills).toEqual([WAITING_FILL])
    expect(rounds).toEqual([
      expect.objectContaining({
        kind: 'round',
        designId: 'd1',
        sectionId: 'id5',
        words: 'Diwali sale',
        pictures: ['a1'],
      }),
    ])
    expect(rounds[0]?.frames.map((f) => f.frameId)).toEqual(['id1', 'id2', 'id3', 'id4'])
    expect(deleted).toEqual([])
  })

  it('deletes the design of a refused round and says why', async () => {
    const { api, deleted } = fakeApi(() =>
      Promise.resolve({ ok: false, status: 409, error: 'used up', refusal: 'used-up' }),
    )
    expect(await start(api)).toEqual({ refused: 'used-up' })
    expect(deleted).toEqual(['d1'])
  })

  it('keeps the design when the round’s answer was lost, since its drafts may arrive', async () => {
    const { api, deleted } = fakeApi(() => Promise.reject(new Error('the API is away')))
    expect(await start(api)).toEqual({ designId: 'd1' })
    expect(deleted).toEqual([])
  })

  it('makes no design for a brief of no words', async () => {
    const { api, made, rounds } = fakeApi(() => Promise.reject(new Error('not asked')))
    let n = 0
    const started = await startBriefDesign(api, {
      brief: { ...BRIEF, words: '' },
      name: 'Untitled design',
      draftName: String,
      newId: () => `id${++n}`,
    })
    expect(started).toEqual({ refused: null })
    expect(made).toEqual([])
    expect(rounds).toEqual([])
  })
})
