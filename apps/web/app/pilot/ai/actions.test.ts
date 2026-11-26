// The AI section's server actions, with the API stubbed: a save the API refuses as made from an older copy, a
// pick sent, refused and never sent, and what an upload of a seller's usage file says before and after the API
// reads it.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addAiPick, setModelSellers, uploadAiSellerFile } from '@/lib/server/admin-ai.ts'
import { ApiFailure } from '@/lib/server/api.ts'

import { pickPreset, saveSellerOrder, uploadSellerFile } from './actions.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/server/admin-ai.ts', () => ({
  addAiPick: vi.fn(),
  setModelSellers: vi.fn(),
  uploadAiSellerFile: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(addAiPick).mockReset().mockResolvedValue(null)
  vi.mocked(uploadAiSellerFile)
    .mockReset()
    .mockResolvedValue({ days: ['2026-11-23'] })
})

describe('saveSellerOrder', () => {
  it('says a save from an older copy changed meanwhile, in the page’s words', async () => {
    vi.mocked(setModelSellers).mockRejectedValue(new ApiFailure(409, 'Changed meanwhile'))
    const order = { sellers: [{ seller: 'pixazo' as const, sellerModel: null }], was: [] }
    expect(await saveSellerOrder('seedream-5.5', order)).toBe(
      'This changed since you opened it; reload to see the newest.',
    )
    expect(setModelSellers).toHaveBeenCalledWith('seedream-5.5', order)
  })
})

describe('pickPreset', () => {
  const pick = { function: 'round-plan', mode: 'precise', preset: 'light-luna', since: '2026-11-27T06:30:00.000Z' }

  it('sends the pick with when the page read the newest one, and says nothing when it is added', async () => {
    expect(await pickPreset(pick)).toBeNull()
    expect(addAiPick).toHaveBeenCalledWith(pick)
    // A function no mode changes is picked for under no mode, from a page that read no pick.
    const first = { function: 'draft', mode: '', preset: 'gpt-image-medium', since: null }
    expect(await pickPreset(first)).toBeNull()
    expect(addAiPick).toHaveBeenLastCalledWith(first)
  })

  it('says another admin’s pick changed it meanwhile, in the page’s words, and gives the API’s reason for any other refusal', async () => {
    vi.mocked(addAiPick).mockRejectedValue(new ApiFailure(409, 'Changed meanwhile'))
    expect(await pickPreset(pick)).toBe('This changed since you opened it; reload to see the newest.')
    vi.mocked(addAiPick).mockRejectedValue(new ApiFailure(400, 'round-plan has no preset light-luna'))
    expect(await pickPreset(pick)).toBe('round-plan has no preset light-luna')
  })

  it('never sends a pick for a name that is no AI function or no mode', async () => {
    const invalid = 'Something is missing or out of range. Check each field.'
    expect(await pickPreset({ ...pick, function: 'no-function' })).toBe(invalid)
    expect(await pickPreset({ ...pick, mode: 'careful' })).toBe(invalid)
    expect(addAiPick).not.toHaveBeenCalled()
  })
})

describe('uploadSellerFile', () => {
  it('says an empty file is empty, without sending it', async () => {
    for (const text of ['', ' \n']) {
      expect(await uploadSellerFile({ seller: 'meta', name: 'usage.csv', text })).toEqual({
        error: 'This file is empty.',
      })
    }
    expect(uploadAiSellerFile).not.toHaveBeenCalled()
  })

  it('gives the days a file covered', async () => {
    const upload = { seller: 'meta' as const, name: 'usage.csv', text: 'Date,Spend\n2026-11-23,1' }
    expect(await uploadSellerFile(upload)).toEqual({ days: ['2026-11-23'] })
    expect(uploadAiSellerFile).toHaveBeenCalledWith(upload)
  })
})
