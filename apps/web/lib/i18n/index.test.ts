// Filling the catalogs' strings, and the words a count takes in each language.
import { describe, expect, it } from 'vitest'

import { STEP_NAMES } from '@dazbee/doc'
import { SHORTCUTS } from '@dazbee/editor'
import { SIZE_CHANNELS, SIZE_PRESETS } from '@dazbee/schema'

import { ar } from './ar.ts'
import { en } from './en.ts'
import { counted, designCount, format } from './index.ts'

describe('counted', () => {
  it('takes the words each count takes in Arabic: 3 to 10 files plural, 11 and over singular', () => {
    const run = (n: number) => counted('ar', ar.editor.exports.run, n)
    expect(run(1)).toBe('تصدير ملف واحد')
    expect(run(2)).toBe('تصدير ملفين')
    expect(run(3)).toBe('تصدير 3 ملفات')
    expect(run(10)).toBe('تصدير 10 ملفات')
    expect(run(11)).toBe('تصدير 11 ملفًا')
    expect(run(99)).toBe('تصدير 99 ملفًا')
    expect(run(100)).toBe('تصدير 100 ملف')
  })

  it('takes one word for one in English and another for the rest', () => {
    const run = (n: number) => counted('en', en.editor.exports.run, n)
    expect(run(1)).toBe('Export 1 file')
    expect(run(2)).toBe('Export 2 files')
    expect(run(11)).toBe('Export 11 files')
  })
})

describe('the notice of layers a design leaves out', () => {
  it('says how many could not be read, in each language', () => {
    expect([1, 2, 12].map((n) => counted('en', en.editor.notices.layersLeftOut, n))).toEqual([
      '1 layer could not be read, so it is left out of the design.',
      '2 layers could not be read, so they are left out of the design.',
      '12 layers could not be read, so they are left out of the design.',
    ])
    expect([1, 2, 3, 11, 100].map((n) => counted('ar', ar.editor.notices.layersLeftOut, n))).toEqual([
      'تعذّرت قراءة طبقة واحدة، فتُركت خارج التصميم.',
      'تعذّرت قراءة طبقتين، فتُركتا خارج التصميم.',
      'تعذّرت قراءة 3 طبقات، فتُركت خارج التصميم.',
      'تعذّرت قراءة 11 طبقة، فتُركت خارج التصميم.',
      'تعذّرت قراءة 100 طبقة، فتُركت خارج التصميم.',
    ])
  })
})

describe('designCount', () => {
  it('says none for none, the singular for one and the plural for the rest', () => {
    expect([0, 1, 2, 12].map((n) => designCount('en', en, n))).toEqual([
      'No designs yet',
      '1 design',
      '2 designs',
      '12 designs',
    ])
    expect([1, 2, 3, 11].map((n) => designCount('ar', ar, n))).toEqual([
      'تصميم واحد',
      'تصميمان',
      '3 تصاميم',
      '11 تصميمًا',
    ])
  })
})

describe('the names of what the editor does', () => {
  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('name in %s every action of the shortcut table and every undo step', (_, messages) => {
    const names: Record<string, string | undefined> = messages.editor.actions
    const steps: Record<string, string | undefined> = messages.editor.steps
    expect(SHORTCUTS.filter(({ action }) => !names[action]?.trim()).map(({ action }) => action)).toEqual([])
    expect(STEP_NAMES.filter((step) => !steps[step]?.trim())).toEqual([])
  })
})

describe('the words of Quick actions', () => {
  it('count the actions listed by each language’s plural rules', () => {
    const count = (locale: 'en' | 'ar', n: number) =>
      counted(locale, (locale === 'en' ? en : ar).editor.quickActions.count, n)
    expect([1, 2, 12].map((n) => count('en', n))).toEqual(['1 action', '2 actions', '12 actions'])
    expect([1, 2, 3, 10, 11, 100].map((n) => count('ar', n))).toEqual([
      'إجراء واحد',
      'إجراءان',
      '3 إجراءات',
      '10 إجراءات',
      '11 إجراءً',
      '100 إجراء',
    ])
  })

  it('say what was typed when nothing matches, and name the row, the button and the search', () => {
    expect(format(en.editor.noMatch.title, { query: 'xyz' })).toBe('Nothing matches “xyz”')
    expect(format(ar.editor.noMatch.title, { query: 'xyz' })).toBe('لا شيء يطابق «xyz»')
    expect([en, ar].map((t) => [t.editor.actions.quickActions, t.editor.quickActions.search])).toEqual([
      ['Quick actions', 'Search actions'],
      ['إجراءات سريعة', 'ابحث في الإجراءات'],
    ])
  })
})

describe('the names of the sizes', () => {
  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('name in %s every channel and every preset of the Add a frame card', (_, messages) => {
    const presets: Record<string, string | undefined> = messages.editor.sizes.preset
    const channels: Record<string, string | undefined> = messages.editor.sizes.channel
    expect(SIZE_PRESETS.filter(({ id }) => !presets[id]?.trim()).map(({ id }) => id)).toEqual([])
    expect(SIZE_CHANNELS.filter((channel) => !channels[channel]?.trim())).toEqual([])
  })

  it('names the channels as the card heads them', () => {
    expect(SIZE_CHANNELS.map((channel) => en.editor.sizes.channel[channel])).toEqual([
      'Meta',
      'TikTok and YouTube',
      'LinkedIn and X',
      'Pinterest',
      'Google Display',
    ])
  })
})

describe('the radius pill', () => {
  it('says a radius dragged in each language', () => {
    expect(format(en.editor.radiusPill, { radius: 12 })).toBe('Radius 12')
    expect(format(ar.editor.radiusPill, { radius: 45.37 })).toBe('نصف القطر 45.37')
  })
})

describe('the 3D side colour', () => {
  it('names its colour once in each language', () => {
    expect(format(en.editor.props.colourOf, { name: en.editor.props.extrusionSides })).toBe('3D sides colour')
    expect(format(ar.editor.props.colourOf, { name: ar.editor.props.extrusionSides })).toBe('لون جوانب ثلاثي الأبعاد')
  })
})
