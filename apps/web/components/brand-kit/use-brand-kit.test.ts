// The kit as a tab shows and saves it, against the kit's route stubbed as the API answers it: a save
// made from a kit saved since is refused with 409.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_BRAND_KIT, type StoredBrandKit } from '@dazbee/schema'

import {
  changeKit,
  dismissKitTrouble,
  kitTrouble,
  loadKit,
  SAVE_DELAY_MS,
  saveWaitingKit,
  shownKit,
} from './use-brand-kit.ts'

/** The kit's route: the stored kit, each save it was sent, and a gate saves wait at while it is shut. */
interface Route {
  kit: StoredBrandKit | { broken: true }
  puts: Record<string, unknown>[]
  shut: Promise<void> | null
  reads: 'ok' | 'down'
}

const stored = (voice: string, updatedAt: string | null): StoredBrandKit => ({
  ...EMPTY_BRAND_KIT,
  voice,
  updatedAt,
})

let route: Route
/** Each test has a brand of its own, since the shown kits are kept for the page's life. */
let brand = 0
let brandId: string

/** The time of the save after one at `updatedAt`. */
const later = (updatedAt: string | null) =>
  new Date(Date.parse(updatedAt ?? '2026-11-21T09:00:00.000Z') + 1000).toISOString()

/** Another tab saves the kit. */
function savedElsewhere(voice: string) {
  route.kit = stored(voice, later((route.kit as StoredBrandKit).updatedAt))
}

/** Changes the voice of the kit the tab shows. */
function changeVoice(voice: string) {
  const kit = shownKit(brandId)
  if (!kit) throw new Error('The tab shows no kit')
  changeKit('w', brandId, { ...kit, voice })
}

/** Shuts the gate saves wait at; the function returned opens it. */
function shut() {
  let open: (() => void) | undefined
  route.shut = new Promise<void>((resolve) => {
    open = resolve
  })
  return () => {
    route.shut = null
    open?.()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  brandId = `brand-${++brand}`
  route = { kit: stored('First.', '2026-11-21T10:00:00.000Z'), puts: [], shut: null, reads: 'ok' }
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'PUT') {
      if (route.reads === 'down') throw new TypeError('Failed to fetch')
      return Response.json(route.kit)
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    route.puts.push(body)
    await route.shut
    const kit = route.kit as StoredBrandKit
    const { basedOn, ...sent } = body
    if (basedOn !== undefined && basedOn !== kit.updatedAt)
      return Response.json({ error: 'This kit changed since you opened it' }, { status: 409 })
    route.kit = { ...(sent as StoredBrandKit), updatedAt: later(kit.updatedAt) }
    return Response.json(route.kit)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('changeKit', () => {
  it('saves a change made from the kit it loaded, and the next from the save before it', async () => {
    await loadKit('w', brandId)
    changeVoice('Second.')
    const open = shut()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    changeVoice('Third.')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(route.puts).toHaveLength(1)
    open()
    await vi.runAllTimersAsync()
    expect(route.puts.map((p) => [p.voice, p.basedOn])).toEqual([
      ['Second.', '2026-11-21T10:00:00.000Z'],
      ['Third.', '2026-11-21T10:00:01.000Z'],
    ])
    expect((route.kit as StoredBrandKit).voice).toBe('Third.')
    expect(kitTrouble(brandId)).toBeNull()
  })

  it('shows the newer kit and says so when the kit was saved in another tab since it loaded', async () => {
    await loadKit('w', brandId)
    savedElsewhere('From the other tab.')
    changeVoice('Mine.')
    await vi.runAllTimersAsync()
    expect((route.kit as StoredBrandKit).voice).toBe('From the other tab.')
    expect(shownKit(brandId)?.voice).toBe('From the other tab.')
    expect(kitTrouble(brandId)).toEqual({ kind: 'changed', unsaved: ['voice'] })
    changeVoice('Mine, again.')
    await vi.runAllTimersAsync()
    expect((route.kit as StoredBrandKit).voice).toBe('Mine, again.')
    expect(kitTrouble(brandId)).toEqual({ kind: 'changed', unsaved: ['voice'] })
  })

  it('saves none of the changes made behind a refused save', async () => {
    await loadKit('w', brandId)
    savedElsewhere('From the other tab.')
    const open = shut()
    changeVoice('Mine.')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    changeVoice('Mine, more.')
    saveWaitingKit(brandId)
    open()
    await vi.runAllTimersAsync()
    expect(route.puts).toHaveLength(1)
    expect(shownKit(brandId)?.voice).toBe('From the other tab.')
    expect(kitTrouble(brandId)).toEqual({ kind: 'changed', unsaved: ['voice'] })
  })

  it('leaves no kit to change when a refused save cannot read the newer kit', async () => {
    await loadKit('w', brandId)
    savedElsewhere('From the other tab.')
    route.reads = 'down'
    changeVoice('Mine.')
    await vi.runAllTimersAsync()
    expect(shownKit(brandId)).toBeNull()
    expect(kitTrouble(brandId)).toEqual({ kind: 'unreadable', unsaved: ['voice'] })
  })
})

describe('saveWaitingKit', () => {
  it('saves the change waiting now, as a form closing does', async () => {
    await loadKit('w', brandId)
    changeVoice('Mine.')
    saveWaitingKit(brandId)
    await vi.advanceTimersByTimeAsync(0)
    expect(route.puts.map((p) => p.voice)).toEqual(['Mine.'])
  })
})

describe('loadKit', () => {
  it('shows a kit it cannot read as unreadable, never as the empty kit', async () => {
    route.kit = { broken: true }
    await loadKit('w', brandId)
    expect(shownKit(brandId)).toBeNull()
    expect(kitTrouble(brandId)).toEqual({ kind: 'unreadable', unsaved: [] })
  })

  it('shows a kit it cannot fetch as unreadable, and the kit once it can', async () => {
    route.reads = 'down'
    await loadKit('w', brandId)
    expect(kitTrouble(brandId)).toEqual({ kind: 'unreadable', unsaved: [] })
    route.reads = 'ok'
    await loadKit('w', brandId)
    expect(shownKit(brandId)?.voice).toBe('First.')
    expect(kitTrouble(brandId)).toBeNull()
  })

  it('keeps the kit it shows when it fetches the same kit again, and shows a kit saved elsewhere since', async () => {
    await loadKit('w', brandId)
    const first = shownKit(brandId)
    await loadKit('w', brandId)
    expect(shownKit(brandId)).toBe(first)
    savedElsewhere('Theirs.')
    await loadKit('w', brandId)
    expect(shownKit(brandId)?.voice).toBe('Theirs.')
  })

  it('keeps a change waiting to be saved over the kit it fetches', async () => {
    await loadKit('w', brandId)
    changeVoice('Mine.')
    await loadKit('w', brandId)
    expect(shownKit(brandId)?.voice).toBe('Mine.')
    await vi.runAllTimersAsync()
    expect((route.kit as StoredBrandKit).voice).toBe('Mine.')
  })
})

describe('dismissKitTrouble', () => {
  it('puts away the word that a save was refused', async () => {
    await loadKit('w', brandId)
    savedElsewhere('From the other tab.')
    changeVoice('Mine.')
    await vi.runAllTimersAsync()
    dismissKitTrouble(brandId)
    expect(kitTrouble(brandId)).toBeNull()
  })
})
