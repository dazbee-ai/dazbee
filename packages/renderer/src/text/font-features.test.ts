import { describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'

import {
  familyFeatures,
  familySuperSubs,
  fontFeatureTags,
  fontSuperSubs,
  superSubsOf,
  USUAL_SUPER_SUBS,
} from './font-features.ts'

const fileOf = (family: string) => {
  const file = loadFontFiles().find((f) => f.family === family)
  if (!file) throw new Error(`no file for ${family}`)
  return file.bytes
}

/** A copy of a font file with its OS/2 table's superscript and subscript fields, weight and italic bit set as given. */
function withOs2(
  bytes: Uint8Array,
  set: Partial<Record<'weight' | 'subSize' | 'subOffset' | 'supSize' | 'supOffset', number>> & { italic?: boolean },
) {
  const copy = bytes.slice()
  const view = new DataView(copy.buffer)
  let os2 = 0
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16
    if (String.fromCharCode(...copy.subarray(record, record + 4)) === 'OS/2') os2 = view.getUint32(record + 8)
  }
  const at = { weight: 4, subSize: 12, subOffset: 16, supSize: 20, supOffset: 24 } as const
  for (const [field, value] of Object.entries(set)) {
    if (field === 'italic') view.setUint16(os2 + 62, value ? 1 : 0)
    else view.setInt16(os2 + at[field as keyof typeof at], value as number)
  }
  return copy
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

describe('fontSuperSubs', () => {
  it('reads a font’s superscript and subscript size and offset as shares of its em, with its weight and slant', () => {
    expect(fontSuperSubs(fileOf('Noto Sans'))).toEqual({
      weight: 400,
      italic: false,
      superscript: { scale: 0.6, shift: 0.35 },
      subscript: { scale: 0.6, shift: 0.075 },
    })
  })

  it('takes the usual 65 %, raised 35 % or lowered 14 % of an em where a font leaves them at zero', () => {
    const unset = withOs2(fileOf('Noto Sans'), { subSize: 0, subOffset: 0, supSize: 0, supOffset: 0, italic: true })
    expect(fontSuperSubs(unset)).toEqual({
      weight: 400,
      italic: true,
      superscript: { scale: 0.65, shift: 0.35 },
      subscript: { scale: 0.65, shift: 0.14 },
    })
  })

  it('takes the usual values from bytes that are not a font', () => {
    expect(fontSuperSubs(new Uint8Array([1, 2, 3]))).toEqual({ weight: 400, italic: false, ...USUAL_SUPER_SUBS })
  })
})

describe('familySuperSubs', () => {
  it('lists each family’s files’ superscripts and subscripts under the family', () => {
    const sans = fileOf('Noto Sans')
    const families = familySuperSubs([
      { family: 'Sans', bytes: sans },
      { family: 'Sans', bytes: fileOf('Noto Sans Devanagari') },
      { family: 'Other', bytes: sans },
    ])
    expect([...families.keys()]).toEqual(['Sans', 'Other'])
    expect(families.get('Sans')).toHaveLength(2)
    expect(families.get('Other')).toEqual([fontSuperSubs(sans)])
  })
})

describe('superSubsOf', () => {
  const sans = fileOf('Noto Sans')
  const scripts = familySuperSubs([
    { family: 'Sans', bytes: withOs2(sans, { weight: 400, supSize: 500 }) },
    { family: 'Sans', bytes: withOs2(sans, { weight: 700, supSize: 700 }) },
    { family: 'Sans', bytes: withOs2(sans, { weight: 400, supSize: 800, italic: true }) },
  ])

  it('gives the scripts of the family’s file nearest the weight, in the slant asked for', () => {
    expect(superSubsOf(scripts, 'Sans', 600, false).superscript.scale).toBe(0.7)
    expect(superSubsOf(scripts, 'Sans', 500, false).superscript.scale).toBe(0.5)
    expect(superSubsOf(scripts, 'Sans', 700, true).superscript.scale).toBe(0.8)
  })

  it('gives the usual scripts for a family it has no file of', () => {
    expect(superSubsOf(scripts, 'Other', 400, false)).toEqual(USUAL_SUPER_SUBS)
    expect(superSubsOf(undefined, 'Sans', 400, false)).toEqual(USUAL_SUPER_SUBS)
  })
})
