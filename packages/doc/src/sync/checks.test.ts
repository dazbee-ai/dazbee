import { describe, expect, it } from 'vitest'

import { type Change, type DesignRecords, parseDesign, SYNC_LIMITS, type Target } from '@dazbee/schema'

import { kindsDesign, linkedDesign, testDesign } from '../test-design.ts'
import { seeded } from '../test-walk.ts'
import type { Rec } from './changes.ts'
import { bytesWritten, capIssue, changeSetIssue, designBytes, designSizeOf, sizeOf, utf8Length } from './checks.ts'
import { DesignState } from './state.ts'

const parentOf = (id: string): Target => ({ part: 'layer', id, key: 'parentId' })
const records = (design: unknown) => design as DesignRecords

/** Applies the changes on an overlay of `design`, and gives the state before and after and what they wrote. */
function applied(design: DesignRecords, changes: Change[]) {
  const before = DesignState.fromRecords(design)
  const after = before.overlay(true)
  const written = new Set<string>()
  for (const change of changes) for (const key of after.apply(change, 'strict')) written.add(key)
  return { before, after, written }
}

/** Why the change set breaks a rule on the linked design, if it does. */
function issueOf(...changes: Change[]) {
  const { before, after, written } = applied(records(linkedDesign()), changes)
  return changeSetIssue(after, before, written)
}

function group(link: string, parentId: string) {
  return { type: 'group', parentId, link, index: 'a5', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } }
}

describe('capIssue', () => {
  it('rejects more records of a part than a design may hold, before anything is applied', () => {
    const layers = (n: number): Change[] =>
      Array.from({ length: n }, (_, i) => ({ op: 'set', value: { part: 'layer', id: `l${i}`, key: 'name' }, to: 'x' }))
    expect(capIssue(layers(SYNC_LIMITS.designLayers))).toBeUndefined()
    // Many changes to one record count it once.
    expect(capIssue([...layers(SYNC_LIMITS.designLayers), ...layers(10)])).toBeUndefined()
    expect(capIssue(layers(SYNC_LIMITS.designLayers + 1))).toMatchObject({ reason: 'tooManyChanges' })
    const pages: Change[] = Array.from({ length: SYNC_LIMITS.designPages + 1 }, (_, i) => ({
      op: 'delete',
      part: 'page',
      id: `p${i}`,
    }))
    expect(capIssue(pages)?.words).toBe('1001 pages, past 1000')
  })

  it('rejects more changes than a change set may hold', () => {
    const many: Change[] = Array.from({ length: SYNC_LIMITS.changeSetChanges + 1 }, () => ({
      op: 'set',
      value: { part: 'meta', id: 'meta', key: 'name' },
      to: 'x',
    }))
    expect(capIssue(many)).toMatchObject({ reason: 'tooManyChanges' })
  })
})

describe('changeSetIssue', () => {
  it('passes a change set that keeps every rule', () => {
    expect(issueOf({ op: 'set', value: parentOf('badge'), to: 'grp' })).toBeUndefined()
  })

  it('passes two moves that are a cycle midway and a tree at the end, in either order', () => {
    // A new group g2 inside grp, then g2 out to the frame and grp into g2: midway each holds the other.
    const create: Change = { op: 'create', part: 'layer', id: 'g2', record: group('g2', 'grp') }
    const groupOut: Change = { op: 'set', value: parentOf('g2'), to: 'sq' }
    const groupIn: Change = { op: 'set', value: parentOf('grp'), to: 'g2' }
    expect(issueOf(create, groupOut, groupIn)).toBeUndefined()
    expect(issueOf(create, groupIn, groupOut)).toBeUndefined()
  })

  it('rejects a cycle', () => {
    expect(issueOf({ op: 'set', value: parentOf('grp'), to: 'grp' })).toEqual({
      reason: 'structure',
      words: 'nodes.grp.parentId: "grp" is inside itself',
    })
    const twoGroups = issueOf(
      { op: 'create', part: 'layer', id: 'g2', record: group('g2', 'grp') },
      { op: 'set', value: parentOf('grp'), to: 'g2' },
    )
    expect(twoGroups?.words).toMatch(/is inside itself/)
  })

  it('rejects deleting the last page', () => {
    expect(issueOf({ op: 'delete', part: 'page', id: 'p1' }, { op: 'delete', part: 'page', id: 'p2' })).toEqual({
      reason: 'structure',
      words: 'pages: a design needs a page',
    })
  })

  it('rejects a value the schema does not take, a key or prop with no place, and a bad id', () => {
    expect(
      issueOf({ op: 'set', value: { part: 'layer', id: 'badge', key: 'props', prop: 'opacity' }, to: 3 }),
    ).toMatchObject({ reason: 'invalidRecord', words: expect.stringMatching(/^layer "badge": props.opacity/) })
    expect(issueOf({ op: 'set', value: { part: 'frame', id: 'sq', key: 'width' }, to: -1 })?.words).toMatch(
      /^frame "sq": width/,
    )
    expect(issueOf({ op: 'set', value: { part: 'meta', id: 'meta', key: 'name' }, to: 7 })?.words).toMatch(
      /^the design: name/,
    )
    expect(issueOf({ op: 'create', part: 'layer', id: 'x', record: { ...group('x', 'sq'), extra: 1 } })).toEqual({
      reason: 'invalidRecord',
      words: 'layer "x": no place for "extra"',
    })
    const withProp = group('x', 'sq')
    expect(
      issueOf({
        op: 'create',
        part: 'layer',
        id: 'x',
        record: { ...withProp, props: { ...withProp.props, text: 'a' } },
      })?.words,
    ).toBe('layer "x": no place for "props.text"')
    expect(issueOf({ op: 'create', part: 'layer', id: 'a b', record: group('ab', 'sq') })?.words).toMatch(
      /^layer "a b": id:/,
    )
  })

  it('rejects a `__proto__` key in a record, as JSON gives it', () => {
    const record = JSON.parse(`{"__proto__": {"x": 1}, ${JSON.stringify(group('x', 'sq')).slice(1)}`) as Rec
    expect(Object.hasOwn(record, '__proto__')).toBe(true)
    expect(issueOf({ op: 'create', part: 'layer', id: 'x', record })).toEqual({
      reason: 'invalidRecord',
      words: 'layer "x": no place for "__proto__"',
    })
  })

  it('rejects a second holder of a link in a frame, also when a group brings it', () => {
    expect(issueOf({ op: 'set', value: { part: 'layer', id: 'badge', key: 'link' }, to: 'bg' })).toEqual({
      reason: 'structure',
      words: 'nodes.badge.link: frame "sq" holds link "bg" twice, also on "bg"',
    })
    // story-grp holds story-title (link "title"); moved into the square, which holds "grp" and "title".
    expect(issueOf({ op: 'set', value: parentOf('story-grp'), to: 'sq' })?.words).toMatch(/holds link "grp" twice/)
    // A group brought into the square holding a title, its own link new there: the title it holds is caught.
    expect(
      issueOf(
        { op: 'set', value: { part: 'layer', id: 'story-grp', key: 'link' }, to: 'g9' },
        { op: 'set', value: parentOf('story-grp'), to: 'sq' },
      )?.words,
    ).toMatch(/nodes.story-title.link: frame "sq" holds link "title" twice/)
  })

  it('rejects a layer in a parent that cannot hold it or is gone, and a frame whose page is gone', () => {
    expect(issueOf({ op: 'set', value: parentOf('badge'), to: 'bg' })?.words).toBe(
      'nodes.badge.parentId: parent "bg" is a graphic, which can\'t hold layers',
    )
    expect(issueOf({ op: 'set', value: parentOf('badge'), to: 'nowhere' })?.words).toBe(
      'nodes.badge.parentId: parent "nowhere" is neither a frame nor a layer',
    )
    expect(issueOf({ op: 'set', value: { part: 'frame', id: 'sq', key: 'pageId' }, to: 'p9' })?.words).toBe(
      'frames.sq.pageId: no page "p9"',
    )
  })

  it('rejects a layer deleted and made again as another type that cannot hold what it holds, or be where it is', () => {
    const graphic = (parentId: string, link: string) => ({
      type: 'graphic',
      parentId,
      link,
      index: 'a1',
      name: 'G',
      props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
    })
    const title = records(linkedDesign()).nodes.title as Rec
    expect(
      issueOf(
        { op: 'delete', part: 'layer', id: 'grp' },
        { op: 'create', part: 'layer', id: 'grp', record: graphic('sq', 'grp') },
        { op: 'create', part: 'layer', id: 'title', record: title },
      )?.words,
    ).toBe('nodes.title.parentId: parent "grp" is a graphic, which can\'t hold layers')
  })

  it('rejects a key the schema drops, at any depth, and a value nested however deep', () => {
    const style = { fontFamily: 'Noto Sans', fontSize: 60, color: '#111111FF' }
    const styled = (extra: Record<string, unknown>): Change => ({
      op: 'set',
      value: { part: 'layer', id: 'title', key: 'props', prop: 'style' },
      to: { ...style, ...extra },
    })
    expect(issueOf(styled({}))).toBeUndefined()
    expect(issueOf(styled({ junk: 1 }))).toEqual({
      reason: 'invalidRecord',
      words: 'layer "title": no place for "props.style.junk"',
    })
    const proto = JSON.parse(`{"__proto__": 1}`) as Record<string, unknown>
    expect(issueOf(styled(proto))?.words).toBe('layer "title": no place for "props.style.__proto__"')
    let deep: unknown = 1
    for (let i = 0; i < 200_000; i++) deep = [deep]
    expect(issueOf(styled({ junk: deep }))?.reason).toBe('invalidRecord')
    expect(issueOf({ op: 'create', part: 'layer', id: 'x', record: { ...group('x', 'sq'), name: deep } })?.reason).toBe(
      'invalidRecord',
    )
  })

  it('looks at the records a change set wrote only', () => {
    // A design already broken elsewhere passes a change set that doesn't touch what is broken.
    const broken = records(linkedDesign())
    ;(broken.nodes.badge as Record<string, unknown>).link = 'bg'
    const { before, after, written } = applied(broken, [
      { op: 'set', value: { part: 'layer', id: 'title', key: 'name' }, to: 'T' },
    ])
    expect(changeSetIssue(after, before, written)).toBeUndefined()
  })

  it('passes a change to a text stored before letter spacing had a unit, and refuses a bad feature tag', () => {
    const stored = records(linkedDesign())
    const title = stored.nodes.title as { props: { style: Record<string, unknown> } }
    title.props.style = { ...title.props.style, letterSpacing: 2 }
    const { before, after, written } = applied(stored, [
      { op: 'set', value: { part: 'layer', id: 'title', key: 'props', prop: 'align' }, to: 'center' },
    ])
    expect(changeSetIssue(after, before, written)).toBeUndefined()
    const style = { fontFamily: 'Noto Sans', fontSize: 60, color: '#111111FF', features: { ligature: false } }
    expect(
      issueOf({ op: 'set', value: { part: 'layer', id: 'title', key: 'props', prop: 'style' }, to: style })?.reason,
    ).toBe('invalidRecord')
  })

  it('agrees with checkStructure and the schema over random change sets (I1)', () => {
    const designs = [testDesign, linkedDesign, kindsDesign] as const
    let rejected = 0
    const seeds = 1000
    for (let seed = 1; seed <= seeds; seed++) {
      const random = seeded(seed)
      const design = records(designs[seed % designs.length]?.())
      const { before, after, written } = applied(design, randomChanges(design, random))
      const issue = changeSetIssue(after, before, written)
      const parsed = parseDesign(after.toRecords())
      if (issue) rejected++
      expect(issue === undefined, `seed ${seed}: ${issue?.words ?? (parsed.success ? '' : parsed.errors[0])}`).toBe(
        parsed.success,
      )
    }
    // Both kinds of answer are reached often.
    expect(rejected).toBeGreaterThan(seeds / 5)
    expect(seeds - rejected).toBeGreaterThan(seeds / 10)
    // A thousand seeds take about 2.5 s alone and over 5 s on a CI runner shared with the other workspaces' tests.
  }, 20_000)
})

describe('designBytes', () => {
  it('is the size of the records in UTF-8, and a change set adds what it writes', () => {
    const state = DesignState.fromRecords(records(linkedDesign()))
    const json = JSON.stringify(linkedDesign())
    expect(designBytes(state)).toBeGreaterThan(json.length * 0.95)
    expect(designBytes(state)).toBeLessThan(json.length * 1.05)
    const { before, after, written } = applied(records(linkedDesign()), [
      { op: 'set', value: { part: 'layer', id: 'title', key: 'name' }, to: 'é'.repeat(100) },
      { op: 'delete', part: 'layer', id: 'grp' },
      { op: 'create', part: 'layer', id: 'g2', record: group('g2', 'sq') },
    ])
    expect(designBytes(before) + bytesWritten(after, before, written)).toBe(designBytes(after))
    expect(sizeOf('layer', { a: 1 }, 'x')).toBe('"x":{"a":1},'.length)
  })
})

describe('designSizeOf', () => {
  it('counts the layers, frames and pages of a design’s records, and their bytes as designBytes counts them', () => {
    const design = records(linkedDesign())
    const state = DesignState.fromRecords(design)
    expect(designSizeOf(state.toRecords())).toEqual({
      layers: Object.keys(design.nodes).length,
      frames: Object.keys(design.frames).length,
      pages: Object.keys(design.pages).length,
      bytes: designBytes(state),
    })
  })
})

describe('utf8Length', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8Length('aé€😀')).toBe(1 + 2 + 3 + 4)
  })
})

/**
 * A random change set over `design`: moves into any record (itself, a text, a page, nothing), link
 * changes to taken links, frames moved between pages, pages and layers deleted and created, and now
 * and then a value the schema does not take.
 */
function randomChanges(design: DesignRecords, random: () => number): Change[] {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T
  const layers = Object.keys(design.nodes)
  const frames = Object.keys(design.frames)
  const pages = Object.keys(design.pages)
  const links = Object.values(design.nodes).map((n) => (n as { link: string }).link)
  const holders = [...layers, ...frames, ...pages, 'nowhere', 'new1', 'new2']
  const parents = [...new Set(Object.values(design.nodes).map((n) => (n as { parentId: string }).parentId))]
  const groups = layers.filter((id) => parents.includes(id))
  const changes: Change[] = []
  const count = 1 + Math.floor(random() * 4)
  for (let i = 0; i < count; i++) {
    const roll = random()
    if (roll < 0.1 && groups.length > 0) changes.push({ op: 'set', value: parentOf(pick(groups)), to: pick(frames) })
    else if (roll < 0.3) changes.push({ op: 'set', value: parentOf(pick(layers)), to: pick(holders) })
    else if (roll < 0.45)
      changes.push({ op: 'set', value: { part: 'layer', id: pick(layers), key: 'link' }, to: pick(links) })
    else if (roll < 0.55)
      changes.push({ op: 'set', value: { part: 'frame', id: pick(frames), key: 'pageId' }, to: pick([...pages, 'p9']) })
    else if (roll < 0.62) changes.push({ op: 'delete', part: 'page', id: pick(pages) })
    else if (roll < 0.7) changes.push({ op: 'delete', part: 'layer', id: pick(layers) })
    else if (roll < 0.85) {
      const id = pick(['new1', 'new2'])
      if (changes.some((c) => c.op === 'create' && c.id === id)) continue
      const record = random() < 0.5 ? group(pick(links), pick(holders)) : { ...group(id, pick(holders)), type: 'text' }
      if (record.type === 'text') Object.assign(record, { props: { ...record.props, text: 'x', style: {} } })
      changes.push({ op: 'create', part: 'layer', id, record })
    } else if (roll < 0.88) {
      // An existing layer deleted and made again, maybe as another type, holding what it can.
      const id = pick(layers)
      const was = design.nodes[id] as { parentId: string; link: string }
      const type = pick(['group', 'text', 'graphic', 'boolean'])
      const props = { x: 0, y: 0, width: 10, height: 10 }
      const own =
        type === 'text'
          ? { ...props, text: 'x', style: {} }
          : type === 'graphic'
            ? { ...props, shape: { kind: 'rect' } }
            : type === 'boolean'
              ? { ...props, op: 'union' }
              : props
      changes.push({ op: 'delete', part: 'layer', id })
      changes.push({ op: 'create', part: 'layer', id, record: { ...group(was.link, was.parentId), type, props: own } })
    } else if (roll < 0.9) {
      const id = pick(['new3', 'new4'])
      if (random() < 0.5) {
        changes.push({ op: 'create', part: 'page', id, record: { name: 'P', order: 'a9' } })
      } else {
        const record = {
          pageId: pick([...pages, 'new3', 'new4']),
          name: 'F',
          width: 10,
          height: 10,
          x: 0,
          y: 0,
          order: 'a9',
        }
        changes.push({ op: 'create', part: 'frame', id, record })
      }
    } else if (roll < 0.92) changes.push({ op: 'set', value: { part: 'layer', id: pick(layers), key: 'index' }, to: 7 })
    else changes.push({ op: 'set', value: { part: 'layer', id: pick(layers), key: 'name' }, to: 'n' })
  }
  // Only changes that apply: those that don't would be rejected before the checks.
  const state = DesignState.fromRecords(design).overlay()
  return changes.filter((change) => state.apply(change, 'lenient').length > 0 || change.op === 'delete')
}
