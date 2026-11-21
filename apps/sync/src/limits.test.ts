// The sync server's message budget on its own: a burst at once, then the sustained rate; and the limits it reads
// from the environment.
import { describe, expect, it } from 'vitest'

import { LIMITS, limitSettings, messageRate } from './limits.ts'

describe('limitSettings', () => {
  it('keeps LIMITS when the environment sets none', () => {
    expect(limitSettings({})).toEqual(LIMITS)
    expect(limitSettings({}).loadedBytes).toBe(200 * 1024 * 1024)
    expect(limitSettings({}).idleDesigns).toBe(50)
    expect(limitSettings({}).idleMs).toBe(60_000)
    expect(limitSettings({ SYNC_LOADED_MB: '', SYNC_IDLE_DESIGNS: ' ' })).toEqual(LIMITS)
  })

  it('reads the loaded bytes, the idle designs and their seconds from the environment', () => {
    expect(limitSettings({ SYNC_LOADED_MB: '300', SYNC_IDLE_DESIGNS: '0', SYNC_IDLE_SECONDS: '120' })).toEqual({
      ...LIMITS,
      loadedBytes: 300 * 1024 * 1024,
      idleDesigns: 0,
      idleMs: 120_000,
    })
  })

  it('refuses a value that isn’t a whole number in its range, naming the variable', () => {
    expect(() => limitSettings({ SYNC_LOADED_MB: '0' })).toThrow(
      'SYNC_LOADED_MB must be a whole number from 1 to 65536, not “0”',
    )
    expect(() => limitSettings({ SYNC_IDLE_DESIGNS: '-1' })).toThrow(
      'SYNC_IDLE_DESIGNS must be a whole number from 0 to 10000, not “-1”',
    )
    expect(() => limitSettings({ SYNC_IDLE_SECONDS: '1.5' })).toThrow(
      'SYNC_IDLE_SECONDS must be a whole number from 0 to 86400, not “1.5”',
    )
  })
})

describe('messageRate', () => {
  it('takes a burst at once, then the sustained rate', () => {
    let now = 0
    const take = messageRate({ ...LIMITS, messagesPerSecond: 60, messageBurst: 200 }, () => now)
    expect(Array.from({ length: 201 }, take).filter(Boolean)).toHaveLength(200)
    now += 1000
    expect(Array.from({ length: 61 }, take).filter(Boolean)).toHaveLength(60)
    now += 100_000
    expect(Array.from({ length: 300 }, take).filter(Boolean)).toHaveLength(200)
  })
})
