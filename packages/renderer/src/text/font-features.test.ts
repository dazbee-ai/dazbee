import { describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'

import { familyFeatures, fontFeatureTags } from './font-features.ts'

const fileOf = (family: string) => {
  const file = loadFontFiles().find((f) => f.family === family)
  if (!file) throw new Error(`no file for ${family}`)
  return file.bytes
}

describe('fontFeatureTags', () => {
  it('reads the features a font file has, from its substitutions and positioning', () => {
    const sans = fontFeatureTags(fileOf('Noto Sans'))
    for (const tag of ['liga', 'tnum', 'smcp', 'zero', 'case', 'frac', 'kern']) expect(sans.has(tag)).toBe(true)
    const arabic = fontFeatureTags(fileOf('Noto Naskh Arabic'))
    expect(arabic.has('init')).toBe(true)
    expect(arabic.has('smcp')).toBe(false)
  })

  it('reads none from bytes that are not a font, or end early', () => {
    expect(fontFeatureTags(new Uint8Array([1, 2, 3])).size).toBe(0)
    expect(fontFeatureTags(fileOf('Noto Sans').slice(0, 40)).size).toBe(0)
  })
})

describe('familyFeatures', () => {
  it('gives each family the features every one of its files has', () => {
    const sans = fileOf('Noto Sans')
    const arabic = fileOf('Noto Naskh Arabic')
    const features = familyFeatures([
      { family: 'Mixed', bytes: sans },
      { family: 'Mixed', bytes: arabic },
      { family: 'Sans', bytes: sans },
    ])
    expect(features.get('Sans')?.has('smcp')).toBe(true)
    expect(features.get('Mixed')?.has('smcp')).toBe(false)
    expect(features.get('Mixed')?.has('liga')).toBe(true)
  })
})
