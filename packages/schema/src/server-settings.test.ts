import { describe, expect, it } from 'vitest'

import { serverSettings, serverText } from './server-settings.ts'

const SETTINGS = {
  tabs: { name: 'TEST_TABS', value: 30, least: 1, most: 1000 },
  waiting: { name: 'TEST_WAITING', value: 8, least: 0, most: 100 },
}

describe('serverSettings', () => {
  it('takes each setting’s default when unset or empty', () => {
    expect(serverSettings({}, SETTINGS)).toEqual({ tabs: 30, waiting: 8 })
    expect(serverSettings({ TEST_TABS: '', TEST_WAITING: '  ' }, SETTINGS)).toEqual({ tabs: 30, waiting: 8 })
  })

  it('reads each setting from its variable, from its least to its most', () => {
    expect(serverSettings({ TEST_TABS: '1', TEST_WAITING: '0' }, SETTINGS)).toEqual({ tabs: 1, waiting: 0 })
    expect(serverSettings({ TEST_TABS: ' 1000 ', TEST_WAITING: '100' }, SETTINGS)).toEqual({ tabs: 1000, waiting: 100 })
  })

  it('refuses a value that isn’t a whole number in its range, naming the variable', () => {
    for (const value of ['0', '-1', '1.5', '1e3', '0x10', 'ten', '1001'])
      expect(() => serverSettings({ TEST_TABS: value }, SETTINGS)).toThrow(
        `TEST_TABS must be a whole number from 1 to 1000, not “${value}”`,
      )
    expect(() => serverSettings({ TEST_WAITING: '101' }, SETTINGS)).toThrow(/TEST_WAITING/)
  })
})

describe('serverText', () => {
  it('reads a text setting from its variable, without spaces at either end', () => {
    expect(serverText({ TEST_KEY: ' abc-123 ' }, 'TEST_KEY')).toBe('abc-123')
  })

  it('is null when the variable is unset or empty', () => {
    expect(serverText({}, 'TEST_KEY')).toBeNull()
    expect(serverText({ TEST_KEY: '' }, 'TEST_KEY')).toBeNull()
    expect(serverText({ TEST_KEY: '   ' }, 'TEST_KEY')).toBeNull()
  })
})
