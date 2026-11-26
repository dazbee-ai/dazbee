// Which sellers the environment puts in use, and the AI recording it turns on.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { aiRecordingOf, reportsOf, useSellersOf } from './in-use.ts'
import { sellerAdapter } from './seller.ts'

/** An environment of `values` that keeps the name of every setting read from it. */
function watchedEnv(values: Record<string, string>) {
  const read = new Set<string>()
  const env = new Proxy(values, {
    get(target, key) {
      if (typeof key === 'string') read.add(key)
      return target[key as string]
    },
  }) as NodeJS.ProcessEnv
  return { env, read }
}

describe('useSellersOf', () => {
  it('replays under every seller’s name, reading no seller key, and calls no seller', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dazbee-recording-'))
    const { env, read } = watchedEnv({ AI_REPLAY_DIR: dir, OPENAI_API_KEY: 'a key', MUSE_API_KEY: 'a key' })
    expect(useSellersOf(env)).toEqual(['openai', 'meta', 'openrouter', 'zenmux', 'pixazo', 'modal'])
    expect([...read].filter((key) => !key.startsWith('AI_') && key !== 'NODE_ENV')).toEqual([])

    const call = sellerAdapter('openai')?.call({
      call: { job: 'job', function: 'reading', preset: 'luna', index: 0 },
      model: 'gpt-6-luna',
      input: { kind: 'text', instructions: 'Read.', prompt: 'The ad.', pictures: [] },
      options: {},
      signal: new AbortController().signal,
      readPicture: async () => new Uint8Array(),
      references: async () => [],
      keepRequestId: async () => undefined,
    })
    await expect(call).rejects.toMatchObject({ code: 'not_recorded' })
  })
})

describe('aiRecordingOf', () => {
  it('is off with neither folder, and gives the mode, the folder and the replay speed', () => {
    expect(aiRecordingOf({})).toBeNull()
    expect(aiRecordingOf({ AI_RECORD_DIR: 'rec' })).toEqual({ mode: 'record', dir: resolve('rec') })
    expect(aiRecordingOf({ AI_REPLAY_DIR: 'rec' })).toEqual({ mode: 'replay', dir: resolve('rec'), speed: 10 })
    expect(aiRecordingOf({ AI_REPLAY_DIR: 'rec', AI_REPLAY_SPEED: '2.5' })).toMatchObject({ speed: 2.5 })
  })

  it('refuses either in production, both at once, and a speed that is not above 0', () => {
    for (const env of [{ AI_RECORD_DIR: 'rec' }, { AI_REPLAY_DIR: 'rec' }]) {
      expect(() => aiRecordingOf({ ...env, NODE_ENV: 'production' })).toThrow(/never set in production/)
      expect(() => useSellersOf({ ...env, NODE_ENV: 'production' })).toThrow(/never set in production/)
    }
    expect(() => aiRecordingOf({ AI_RECORD_DIR: 'a', AI_REPLAY_DIR: 'b' })).toThrow(/not set together/)
    expect(() => aiRecordingOf({ AI_REPLAY_DIR: 'rec', AI_REPLAY_SPEED: '0' })).toThrow(/above 0/)
    expect(() => aiRecordingOf({ AI_REPLAY_DIR: 'rec', AI_REPLAY_SPEED: 'fast' })).toThrow(/above 0/)
  })
})

describe('reportsOf', () => {
  it('gives no seller’s cost report when replaying', () => {
    expect(reportsOf({ AI_REPLAY_DIR: 'rec', OPENAI_ADMIN_API_KEY: 'a key' }).size).toBe(0)
    expect(reportsOf({ OPENAI_ADMIN_API_KEY: 'a key' }).has('openai')).toBe(true)
  })
})
