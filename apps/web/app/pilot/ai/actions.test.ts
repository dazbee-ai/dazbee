// The AI section's server actions, with the API stubbed: a save the API refuses as made from an older copy, and
// what an upload of a seller's usage file says before and after the API reads it.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setModelSellers, uploadAiSellerFile } from '@/lib/server/admin-ai.ts'
import { ApiFailure } from '@/lib/server/api.ts'

import { saveSellerOrder, uploadSellerFile } from './actions.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/server/admin-ai.ts', () => ({
  setModelSellers: vi.fn(),
  uploadAiSellerFile: vi.fn(),
}))

beforeEach(() => {
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
