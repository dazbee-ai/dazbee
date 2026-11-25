// Pacing calls under a seller's per-minute limit.
import { setTimeout as sleep } from 'node:timers/promises'

import { describe, expect, it } from 'vitest'

import { newId } from '@dazbee/db'

import { pace } from './pacing.ts'

describe('pace', () => {
  it('lets calls up to the limit start at once, and makes the next wait until it is aborted', async () => {
    const key = `seller-${newId()}`
    const signal = new AbortController().signal
    await pace(key, 2, signal)
    await pace(key, 2, signal)
    const controller = new AbortController()
    let started = false
    const third = pace(key, 2, controller.signal).then(() => (started = true))
    await sleep(50)
    expect(started).toBe(false)
    controller.abort(new Error('cancelled'))
    await expect(third).rejects.toThrow('cancelled')
  })

  it('never waits with no limit', async () => {
    const signal = new AbortController().signal
    for (let i = 0; i < 100; i++) await pace(`seller-${newId()}`, undefined, signal)
  })
})
