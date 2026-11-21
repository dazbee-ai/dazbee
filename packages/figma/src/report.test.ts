import { describe, expect, it } from 'vitest'

import { FigmaReport } from '@dazbee/schema'

import { newReport } from './report.ts'

const at = (id: string, name = id) => ({ id, name })

describe('newReport', () => {
  it('keeps lines in the order first met, with their counts and first three layers', () => {
    const report = newReport()
    report.add('slices', at('1:1', 'Slice A'))
    report.add('sections', at('1:2'))
    for (const n of [3, 4, 5, 6]) report.add('slices', at(`1:${n}`))
    expect(report.report().items).toEqual([
      { line: 'slices', kind: 'left-out', count: 5, nodes: [at('1:1', 'Slice A'), at('1:3'), at('1:4')] },
      { line: 'sections', kind: 'changed', count: 1, nodes: [at('1:2')] },
    ])
  })

  it('counts a line with no layer to name', () => {
    const report = newReport()
    report.add('empty-pages')
    report.add('empty-pages', at('0:2', 'Page 2'))
    expect(report.report().items).toEqual([
      { line: 'empty-pages', kind: 'left-out', count: 2, nodes: [at('0:2', 'Page 2')] },
    ])
  })

  it('counts layers that share an id, as a file with no ids or repeated ones has', () => {
    const report = newReport()
    report.add('unreadable-layers', at('', 'A'))
    report.add('unreadable-layers', at('', 'B'))
    expect(report.report().items[0]).toMatchObject({ count: 2, nodes: [at('', 'A'), at('', 'B')] })
  })

  it('gives a report the schema reads, with the fonts it is told', () => {
    const report = newReport()
    report.add('texts', at('1:1'))
    expect(FigmaReport.parse(report.report(['Inter']))).toMatchObject({ fonts: ['Inter'] })
  })
})
