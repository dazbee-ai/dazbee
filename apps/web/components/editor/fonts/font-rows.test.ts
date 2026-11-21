import { describe, expect, it } from 'vitest'

import { filterChoices, fontPick, type FontRow, fontRows, stepActive } from './font-rows.ts'
import { LIBRARY_CATALOG, TEST_CATALOG, testFamily } from './test-families.ts'

const ANY = { query: '', category: null, script: null }
const NONE_CHOSEN = { family: null, weight: null }

/** Each row as a person reads it: a group's heading, a family's name, or a weight under it. */
const read = (rows: FontRow[]) =>
  rows.map((row) =>
    row.kind === 'heading' ? `# ${row.group}` : row.kind === 'family' ? row.family.family : `  ${row.weight}`,
  )

/** The families listed under a group's heading. */
const under = (rows: FontRow[], group: FontRow['group']) =>
  rows.flatMap((row) => (row.kind === 'family' && row.group === group ? [row.family.family] : []))

describe('fontRows', () => {
  it('lists the brand’s fonts, then the ones used last, then all, each under its heading', () => {
    const rows = fontRows(TEST_CATALOG, ANY, ['Family 120 display', 'Family 007 sans-serif'], NONE_CHOSEN)
    expect(read(rows).slice(0, 7)).toEqual([
      '# brand',
      'Harbour Grotesk',
      'Harbour Script',
      '# recent',
      'Family 120 display',
      'Family 007 sans-serif',
      '# all',
    ])
    expect(under(rows, 'all')).toHaveLength(300)
    expect(rows).toHaveLength(2 + 2 + 300 + 3)
  })

  it('lists all fonts most used first, whatever order the catalog has them in', () => {
    const rows = fontRows([...TEST_CATALOG].reverse(), ANY, [], NONE_CHOSEN)
    expect(under(rows, 'all').slice(0, 3)).toEqual([
      'Family 000 sans-serif',
      'Family 001 sans-serif',
      'Family 002 sans-serif',
    ])
    expect(under(rows, 'all').at(-1)).toBe('Family 299 monospace')
  })

  it('lists by popularity, not by name, and the families Google doesn’t rank after, by name', () => {
    const catalog = [
      testFamily('Zilla', 'google', 'serif', { rank: 1, scripts: ['Latn'] }),
      testFamily('Noto Sans', 'builtin', null),
      testFamily('Abel', 'google', 'sans-serif', { rank: 2, scripts: ['Latn'] }),
      testFamily('Gone Sans', 'google', 'sans-serif'),
    ]
    expect(under(fontRows(catalog, ANY, [], NONE_CHOSEN), 'all')).toEqual(['Zilla', 'Abel', 'Gone Sans', 'Noto Sans'])
  })

  it('keeps only the families that draw the script picked, and then no upload, as it names none', () => {
    const rows = fontRows(TEST_CATALOG, { ...ANY, script: 'Jpan' }, ['Family 057 sans-serif'], NONE_CHOSEN)
    expect(under(rows, 'brand')).toEqual([])
    expect(under(rows, 'recent')).toEqual(['Family 057 sans-serif'])
    expect(under(rows, 'all')).toEqual([
      'Family 007 sans-serif',
      'Family 057 sans-serif',
      'Family 107 serif',
      'Family 157 display',
      'Family 207 handwriting',
      'Family 257 monospace',
    ])
  })

  it('narrows by script, chip and search together', () => {
    const rows = fontRows(TEST_CATALOG, { query: '1', category: 'serif', script: 'Arab' }, [], NONE_CHOSEN)
    expect(under(rows, 'all')).toEqual(['Family 103 serif', 'Family 113 serif'])
  })

  it('lists the whole library’s 1,950 families, and a search through them', () => {
    expect(under(fontRows(LIBRARY_CATALOG, ANY, [], NONE_CHOSEN), 'all')).toHaveLength(1950)
    expect(under(fontRows(LIBRARY_CATALOG, { ...ANY, query: '1949' }, [], NONE_CHOSEN), 'all')).toEqual([
      'Family 1949 monospace',
    ])
  })

  it('leaves out a used family the catalog no longer has, and one already under the brand’s fonts', () => {
    const rows = fontRows(TEST_CATALOG, ANY, ['Gone Sans', 'Harbour Script', 'Family 100 serif'], NONE_CHOSEN)
    expect(under(rows, 'recent')).toEqual(['Family 100 serif'])
  })

  it('shows no heading for a group with nothing in it', () => {
    const rows = fontRows(TEST_CATALOG.slice(0, 300), ANY, [], NONE_CHOSEN)
    expect(read(rows).slice(0, 2)).toEqual(['# all', 'Family 000 sans-serif'])
  })

  it('keeps the families whose name holds every word typed, in any case', () => {
    const rows = fontRows(TEST_CATALOG, { query: '  FAMILY 25 ', category: null, script: null }, [], NONE_CHOSEN)
    expect(read(rows)).toEqual([
      '# all',
      'Family 025 sans-serif',
      'Family 125 display',
      'Family 225 handwriting',
      ...Array.from({ length: 10 }, (_, i) => `Family 25${i} monospace`),
    ])
    expect(
      read(fontRows(TEST_CATALOG, { query: 'harbour script', category: null, script: null }, [], NONE_CHOSEN)),
    ).toEqual(['# brand', 'Harbour Script'])
  })

  it('filters every group by what is typed, the families used last too', () => {
    const rows = fontRows(
      TEST_CATALOG,
      { query: '120', category: null, script: null },
      ['Family 120 display', 'Family 007 sans-serif'],
      NONE_CHOSEN,
    )
    expect(read(rows)).toEqual(['# recent', 'Family 120 display', '# all', 'Family 120 display'])
  })

  it('keeps only the chip’s category, and with a chip on no upload shows, as it has none', () => {
    const rows = fontRows(
      TEST_CATALOG,
      { query: '', category: 'handwriting', script: null },
      ['Family 200 handwriting', 'Family 001 sans-serif'],
      NONE_CHOSEN,
    )
    expect(under(rows, 'brand')).toEqual([])
    expect(under(rows, 'recent')).toEqual(['Family 200 handwriting'])
    expect(under(rows, 'all')).toHaveLength(60)
    expect(under(rows, 'all').every((name) => name.endsWith('handwriting'))).toBe(true)
  })

  it('narrows a chip’s category by what is typed', () => {
    const rows = fontRows(TEST_CATALOG, { query: '7', category: 'serif', script: null }, [], NONE_CHOSEN)
    expect(under(rows, 'all')).toEqual([
      'Family 067 serif',
      ...Array.from({ length: 10 }, (_, i) => `Family 07${i} serif`),
      'Family 087 serif',
      'Family 097 serif',
      'Family 107 serif',
      'Family 117 serif',
    ])
  })

  it('lists nothing, not even a heading, when no family matches', () => {
    expect(fontRows(TEST_CATALOG, { query: 'zzz', category: null, script: null }, [], NONE_CHOSEN)).toEqual([])
  })

  it('shows the chosen family’s weights under it, wherever it is listed', () => {
    const rows = fontRows(TEST_CATALOG, ANY, ['Family 001 sans-serif'], {
      family: 'Family 001 sans-serif',
      weight: 700,
    })
    expect(read(rows).slice(3, 9)).toEqual([
      '# recent',
      'Family 001 sans-serif',
      '  400',
      '  700',
      '# all',
      'Family 000 sans-serif',
    ])
    expect(read(rows).slice(9, 12)).toEqual(['Family 001 sans-serif', '  400', '  700'])
  })

  it('adds the text’s own weight where the family doesn’t list it, as a variable font’s 450', () => {
    const rows = fontRows(TEST_CATALOG.slice(0, 2), ANY, [], { family: 'Family 000 sans-serif', weight: 450 })
    expect(read(rows)).toEqual(['# all', 'Family 000 sans-serif', '  400', '  450', '  700', 'Family 001 sans-serif'])
  })

  it('shows no weights for a family of one weight, or while the texts’ families differ', () => {
    const one = {
      ...testFamily('Solo', 'google', 'display'),
      faces: testFamily('Solo', 'google', 'display').faces.slice(0, 1),
    }
    expect(read(fontRows([one], ANY, [], { family: 'Solo', weight: 400 }))).toEqual(['# all', 'Solo'])
    expect(fontRows(TEST_CATALOG, ANY, [], { family: null, weight: 400 }).some((row) => row.kind === 'weight')).toBe(
      false,
    )
  })

  it('gives every row its own key, though a family shows under two headings', () => {
    const rows = fontRows(TEST_CATALOG, ANY, ['Family 001 sans-serif'], {
      family: 'Family 001 sans-serif',
      weight: 400,
    })
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })
})

describe('filterChoices', () => {
  it('offers every category and every script, the scripts most families draw first', () => {
    expect(filterChoices(TEST_CATALOG, { category: null, script: null })).toEqual({
      categories: ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'],
      scripts: ['Latn', 'Arab', 'Jpan'],
    })
  })

  it('offers only the categories that have a family of the script picked, and the chip that is on', () => {
    const japanese = [
      testFamily('Kana Sans', 'google', 'sans-serif', { rank: 1, scripts: ['Jpan'] }),
      testFamily('Kana Serif', 'google', 'serif', { rank: 2, scripts: ['Jpan', 'Latn'] }),
      testFamily('Latin Mono', 'google', 'monospace', { rank: 3, scripts: ['Latn'] }),
    ]
    expect(filterChoices(japanese, { category: null, script: 'Jpan' }).categories).toEqual(['sans-serif', 'serif'])
    expect(filterChoices(japanese, { category: 'monospace', script: 'Jpan' }).categories).toEqual([
      'sans-serif',
      'serif',
      'monospace',
    ])
  })

  it('offers only the scripts the chip’s category draws, and the script picked', () => {
    const catalog = [
      testFamily('Kana Sans', 'google', 'sans-serif', { rank: 1, scripts: ['Jpan', 'Latn'] }),
      testFamily('Latin Mono', 'google', 'monospace', { rank: 2, scripts: ['Latn'] }),
    ]
    expect(filterChoices(catalog, { category: 'monospace', script: null }).scripts).toEqual(['Latn'])
    expect(filterChoices(catalog, { category: 'monospace', script: 'Jpan' }).scripts).toEqual(['Latn', 'Jpan'])
  })

  it('counts the fonts we ship by the scripts they draw, and no upload', () => {
    const catalog = [testFamily('Noto Naskh Arabic', 'builtin', null), testFamily('Harbour Script', 'upload', null)]
    expect(filterChoices(catalog, { category: null, script: null })).toEqual({
      categories: ['serif'],
      scripts: ['Arab'],
    })
  })
})

describe('stepActive', () => {
  const rows = fontRows(TEST_CATALOG, ANY, ['Family 001 sans-serif'], { family: 'Family 001 sans-serif', weight: 400 })
  const keyAt = (index: number) => rows[index]?.key ?? null
  const at = (key: string | null) => {
    const row = rows.find((one) => one.key === key)
    return row && row.kind !== 'heading' ? read([row])[0] : null
  }

  it('moves to the next family or weight, past a heading', () => {
    const lastBrand = rows.findIndex((row) => row.kind === 'family' && row.family.family === 'Harbour Script')
    expect(at(stepActive(rows, keyAt(lastBrand), 1))).toBe('Family 001 sans-serif')
    const first = keyAt(rows.findIndex((row) => row.kind === 'family' && row.group === 'recent'))
    expect(at(stepActive(rows, first, 1))).toBe('  400')
    expect(at(stepActive(rows, first, -1))).toBe('Harbour Script')
  })

  it('starts at the first family, and stops at either end', () => {
    expect(at(stepActive(rows, null, 1))).toBe('Harbour Grotesk')
    expect(at(stepActive(rows, keyAt(1), -1))).toBe('Harbour Grotesk')
    expect(at(stepActive(rows, keyAt(rows.length - 1), 1))).toBe('Family 299 monospace')
  })

  it('finds no row in an empty list', () => {
    expect(stepActive([], null, 1)).toBeNull()
  })
})

describe('fontPick', () => {
  it('sets a picked family in the weight nearest the text’s, as the font has always been set', () => {
    const family = TEST_CATALOG.find((one) => one.family === 'Family 000 sans-serif')
    if (!family) throw new Error('the fixture has Family 000')
    expect(fontPick(family, 600)).toEqual({ family: 'Family 000 sans-serif', weight: 700 })
    expect(fontPick(family, 500)).toEqual({ family: 'Family 000 sans-serif', weight: 400 })
    expect(fontPick(family, null)).toEqual({ family: 'Family 000 sans-serif', weight: 400 })
  })
})
