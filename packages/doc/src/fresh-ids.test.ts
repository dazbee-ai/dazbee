import { describe, expect, it } from 'vitest'

import { parseDesign } from '@dazbee/schema'

import { withFreshIds } from './fresh-ids.ts'
import { sectionedDesign, testDesign } from './test-design.ts'

describe('withFreshIds (#54)', () => {
  it('gives every page, frame and layer a new id and keeps everything that names them', () => {
    const parsed = parseDesign(testDesign())
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const before = parsed.design
    const after = withFreshIds(before)
    const ids = (d: typeof before) => [...Object.keys(d.pages), ...Object.keys(d.frames), ...Object.keys(d.nodes)]
    expect(ids(after).filter((id) => ids(before).includes(id))).toEqual([])
    expect(ids(after)).toHaveLength(ids(before).length)
    // Still a valid design, the same in every way but its ids.
    const again = parseDesign(after)
    if (!again.success) throw new Error(again.errors.join('\n'))
    const [page] = Object.keys(after.pages)
    const banner = Object.keys(after.frames).find((id) => after.frames[id]?.name === 'Banner') ?? ''
    expect(after.frames[banner]).toEqual({ ...before.frames.banner, pageId: page })
    const copy = Object.entries(after.nodes).find(([, n]) => n.parentId === banner && n.name === 'Headline')?.[1]
    expect(copy?.props).toEqual(before.nodes['banner-headline']?.props)
  })

  it('gives each link id one new link id: linked copies stay linked to each other, and to nothing outside the copy', () => {
    const parsed = parseDesign(testDesign())
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const before = parsed.design
    const after = withFreshIds(before)
    const linkOf = (name: string, frame: string) =>
      Object.values(after.nodes).find((n) => n.name === name && after.frames[n.parentId]?.name === frame)?.link
    expect(linkOf('Headline', 'Square')).toBe(linkOf('Headline', 'Banner'))
    expect(linkOf('Box', 'Square')).toBe(linkOf('Box', 'Banner'))
    expect(linkOf('Box', 'Square')).not.toBe(linkOf('Headline', 'Square'))
    const oldLinks = new Set(Object.values(before.nodes).map((n) => n.link))
    expect(Object.values(after.nodes).filter((n) => oldLinks.has(n.link))).toEqual([])
  })

  it('gives sections and connectors new ids, still joining the same frames and sections, and keeps stars', () => {
    const parsed = parseDesign(sectionedDesign())
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const before = parsed.design
    const after = withFreshIds(before)
    const again = parseDesign(after)
    if (!again.success) throw new Error(again.errors.join('\n'))
    const old = new Set([
      ...Object.keys(before.sections),
      ...Object.keys(before.connectors),
      ...Object.keys(before.frames),
    ])
    expect([...Object.keys(after.sections), ...Object.keys(after.connectors)].filter((id) => old.has(id))).toEqual([])
    const frameNamed = (name: string) => Object.keys(after.frames).find((id) => after.frames[id]?.name === name) ?? ''
    const sectionTitled = (title: string) =>
      Object.keys(after.sections).find((id) => after.sections[id]?.title === title) ?? ''
    const pageNamed = (name: string) => Object.keys(after.pages).find((id) => after.pages[id]?.name === name)
    expect(after.frames[frameNamed('Square')]?.sectionId).toBe(sectionTitled('Ads'))
    expect(after.frames[frameNamed('Story')]).toMatchObject({ sectionId: sectionTitled('Ads'), starred: true })
    expect(after.frames[frameNamed('Wide')]?.sectionId).toBe(sectionTitled('Banners'))
    expect(after.frames[frameNamed('Tall')]).not.toHaveProperty('sectionId')
    expect(after.sections[sectionTitled('Far')]?.pageId).toBe(pageNamed('Page 2'))
    const joined = Object.values(after.connectors).map(({ pageId, from, to }) => [pageId, from, to])
    expect(joined).toEqual([
      [pageNamed('Page 1'), frameNamed('Square'), frameNamed('Story')],
      [pageNamed('Page 1'), sectionTitled('Ads'), frameNamed('Wide')],
    ])
  })
})
