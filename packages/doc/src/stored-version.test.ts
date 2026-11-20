import { describe, expect, it } from 'vitest'

import { type DesignRecords, parseDesign, SCHEMA_VERSION } from '@dazbee/schema'

import { readVersion } from './stored-version.ts'
import { linkedDesign } from './test-design.ts'

describe('readVersion', () => {
  it('reads a version’s records as a design', () => {
    const records = linkedDesign() as unknown as DesignRecords
    const parsed = parseDesign(linkedDesign())
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    expect(readVersion(records, SCHEMA_VERSION)).toEqual({ design: parsed.design, leftOut: [] })
  })

  it('carries a version stored before letter spacing had a unit over, its pixels kept', () => {
    const records = linkedDesign() as unknown as DesignRecords
    const title = records.nodes.title as { props: { style: Record<string, unknown> } }
    title.props.style = { ...title.props.style, letterSpacing: 1.5 }
    const { design, leftOut } = readVersion(records, 9)
    expect(leftOut).toEqual([])
    expect(design.nodes.title).toMatchObject({ props: { style: { letterSpacing: { unit: 'px', value: 1.5 } } } })
  })

  it('leaves out a layer the schema refuses, and tells it, reading the rest', () => {
    const records = linkedDesign() as unknown as DesignRecords
    const badge = records.nodes.badge as { props: Record<string, unknown> }
    const stored = {
      ...records,
      nodes: { ...records.nodes, badge: { ...badge, props: { ...badge.props, x: 'left' } } },
    }

    const { design, leftOut } = readVersion(stored, 1)

    expect(design.nodes.badge).toBeUndefined()
    expect(design.nodes.title).toBeDefined()
    expect(leftOut).toMatchObject([{ part: 'layer', id: 'badge' }])
  })
})
