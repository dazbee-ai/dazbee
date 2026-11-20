import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT } from '@dazbee/schema'

import { en } from '@/lib/i18n/en.ts'

import { changedParts, refusedWords } from './kit-changes.ts'

const KIT = {
  ...EMPTY_BRAND_KIT,
  colors: [{ token: 'primary', name: 'Primary', value: '#14213DFF' }],
  voice: 'Warm.',
}

describe('changedParts', () => {
  it('names the parts a change touched, in the form’s order', () => {
    const changed = {
      ...KIT,
      voice: 'Bold.',
      logoAssetId: 'asset-1',
      colors: [{ token: 'primary', name: 'Ink', value: '#14213DFF' }],
    }
    expect(changedParts(KIT, changed)).toEqual(['colors', 'logo', 'voice'])
  })

  it('names none for the same kit', () => {
    expect(changedParts(KIT, { ...KIT })).toEqual([])
  })
})

describe('refusedWords', () => {
  it('names the parts whose changes weren’t saved, as the form heads them', () => {
    expect(refusedWords(en, 'en', ['colors', 'voice'])).toBe(
      'This kit changed since you opened it, so your changes to Colours and Tone of voice weren’t saved. It now shows the kit as it was saved: make them again here.',
    )
  })

  it('says only that the kit changed when no part of it was changed', () => {
    expect(refusedWords(en, 'en', [])).toBe(
      'This kit changed since you opened it. It now shows the kit as it was saved.',
    )
  })
})
