import { describe, expect, it } from 'vitest'

import { parseDesign } from '@dazbee/schema'

import { repair } from './repair.ts'

type Json = Record<string, unknown>

const box = { x: 0, y: 0, width: 10, height: 10 }
const rect = { ...box, shape: { kind: 'rect' } }

/** A layer of `type` under `parentId`, sharing `link`. */
const layer = (type: 'group' | 'graphic' | 'text', parentId: string, link: string, index = 'a0'): Json => ({
  type,
  parentId,
  link,
  index,
  name: type,
  props:
    type === 'graphic'
      ? rect
      : type === 'text'
        ? { ...box, text: 'Hi', style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' } }
        : box,
})

const frame = (pageId: string, x: number, order: string) => ({
  pageId,
  name: 'Frame',
  width: 1080,
  height: 1080,
  x,
  y: 0,
  fills: [],
  order,
})

/** Page p1 holds frames p1-sq and p1-story, page p2 holds p2-sq; `nodes` are the layers. */
const snap = (nodes: Record<string, Json>) => ({
  meta: { designId: 'd1', name: 'Repairs' },
  pages: { p1: { name: 'Page 1', order: 'a0' }, p2: { name: 'Page 2', order: 'a1' } } as Record<string, Json>,
  frames: {
    'p1-sq': frame('p1', 0, 'a0'),
    'p1-story': frame('p1', 1280, 'a1'),
    'p2-sq': frame('p2', 0, 'a0'),
  } as Record<string, Json>,
  nodes,
})

/** Reads a snapshot, checking that what comes out is a valid design that needs no more repair. */
function repaired(s: ReturnType<typeof snap>) {
  const out = repair(s)
  const parsed = parseDesign(out.design)
  expect(parsed.success ? [] : parsed.errors).toEqual([])
  const again = repair(out.design)
  expect([again.repairs, again.leftOut]).toEqual([[], []])
  return { ...out, nodes: out.design.nodes }
}

describe('repair', () => {
  it('reads a snapshot that needs no repair as the design it holds, each layer the same object in every read', () => {
    const s = snap({ a: layer('graphic', 'p1-sq', 'a'), b: layer('graphic', 'p1-story', 'a') })
    const out = repair(s)
    const parsed = parseDesign(s)
    expect(out.design).toEqual(parsed.success && parsed.design)
    expect([out.repairs, out.leftOut]).toEqual([[], []])
    expect(repair({ ...s, nodes: { ...s.nodes } }).design.nodes.a).toBe(out.design.nodes.a)
  })

  it('gives a design with no page left one empty page, at an id no frame or layer has', () => {
    const s = snap({ page: layer('graphic', 'p1-sq', 'page') })
    s.pages = {}
    s.frames['page-2'] = frame('p9', 0, 'a2')
    const out = repaired(s)
    expect(out.design.pages).toEqual({ 'page-3': { name: 'Page 1', order: 'a0' } })
    expect(out.design.frames).toEqual({})
    expect(out.nodes).toEqual({})
    expect(out.repairs).toEqual([
      'no page was left; added the empty page "page-3"',
      'dropped frame "p1-sq", whose page "p1" is gone',
      'dropped frame "p1-story", whose page "p1" is gone',
      'dropped frame "p2-sq", whose page "p2" is gone',
      'dropped frame "page-2", whose page "p9" is gone',
      'dropped "page", which is in no frame',
    ])
  })

  it('drops a frame whose page is gone, and the layers in it, keeping every other object as it was', () => {
    const s = snap({ x: layer('graphic', 'gone-f', 'x'), y: layer('graphic', 'p1-sq', 'y') })
    s.frames['gone-f'] = frame('p9', 0, 'a0')
    const out = repaired(s)
    expect(Object.keys(out.design.frames).sort()).toEqual(['p1-sq', 'p1-story', 'p2-sq'])
    expect(Object.keys(out.nodes)).toEqual(['y'])
    expect(out.repairs).toEqual([
      'dropped frame "gone-f", whose page "p9" is gone',
      'dropped "x", which is in no frame',
    ])
    // A layer no rule changed is the object another read of it gives.
    expect(out.nodes.y).toBe(repair(snap({ y: s.nodes.y as Json })).design.nodes.y)
  })

  it('reads parts whose ids name a member every object has, and leaves out those under `__proto__`, which is no id', () => {
    const s = snap({
      ['__proto__']: layer('graphic', 'constructor', 'a'),
      toString: layer('graphic', 'constructor', 'b'),
    })
    s.pages = { valueOf: { name: 'Page 1', order: 'a0' }, ['__proto__']: { name: 'Page 2', order: 'a1' } }
    s.frames = { constructor: frame('valueOf', 0, 'a0'), ['__proto__']: frame('valueOf', 1280, 'a1') }
    const out = repair(s)
    const issue = 'id: an id is never "__proto__"'
    expect(out.repairs).toEqual([])
    expect(out.leftOut).toEqual([
      { part: 'page', id: '__proto__', issue },
      { part: 'frame', id: '__proto__', issue },
      { part: 'layer', id: '__proto__', issue },
    ])
    expect(Object.keys(out.design.pages)).toEqual(['valueOf'])
    expect(Object.keys(out.design.frames)).toEqual(['constructor'])
    expect(Object.keys(out.design.nodes)).toEqual(['toString'])
  })

  it('leaves out a layer the schema does not take, and what it holds with it, and reports each', () => {
    const wide = layer('group', 'p1-sq', 'wide')
    const s = snap({
      a: layer('graphic', 'p1-sq', 'a'),
      lost: { parentId: 'p1-sq', link: 'lost', index: 'a1' },
      wide: { ...wide, props: { ...(wide.props as Json), width: -5 } },
      kid: layer('graphic', 'wide', 'kid'),
      'p1-story': layer('graphic', 'p1-sq', 'twin'),
      'not an id': layer('graphic', 'p1-sq', 'spaced'),
    })
    const out = repaired(s)
    expect(Object.keys(out.nodes)).toEqual(['a'])
    expect(out.repairs).toEqual([])
    expect(out.leftOut).toEqual([
      {
        part: 'layer',
        id: 'lost',
        issue: "type: Invalid discriminator value. Expected 'box' | 'group' | 'graphic' | 'text' | 'boolean'",
      },
      { part: 'layer', id: 'not an id', issue: 'id: ids are letters, digits, _ and -' },
      { part: 'layer', id: 'p1-story', issue: '"p1-story" is both a frame and a layer' },
      { part: 'layer', id: 'wide', issue: 'props.width: Too small: expected number to be >=0' },
      { part: 'layer', id: 'kid', issue: '"wide", which holds it, was left out' },
    ])
  })

  it('leaves out a frame the schema does not take with its layers, and a page with its frames', () => {
    const s = snap({
      a: layer('graphic', 'p1-sq', 'a'),
      g: layer('group', 'p1-story', 'g'),
      inG: layer('graphic', 'g', 'inG'),
      far: layer('graphic', 'p2-sq', 'far'),
    })
    s.frames['p1-story'] = { ...frame('p1', 1280, 'a1'), width: 0 }
    s.pages.p2 = { name: 'Page 2', order: 5 }
    const out = repaired(s)
    expect(Object.keys(out.design.pages)).toEqual(['p1'])
    expect(Object.keys(out.design.frames)).toEqual(['p1-sq'])
    expect(Object.keys(out.nodes)).toEqual(['a'])
    expect(out.repairs).toEqual([])
    expect(out.leftOut).toEqual([
      { part: 'page', id: 'p2', issue: 'order: Invalid input: expected string, received number' },
      { part: 'frame', id: 'p1-story', issue: 'width: Too small: expected number to be >0' },
      { part: 'frame', id: 'p2-sq', issue: '"p2", which holds it, was left out' },
      { part: 'layer', id: 'far', issue: '"p2-sq", which holds it, was left out' },
      { part: 'layer', id: 'g', issue: '"p1-story", which holds it, was left out' },
      { part: 'layer', id: 'inG', issue: '"p1-story", which holds it, was left out' },
    ])
  })

  it('reads a snapshot without sections or connectors as a design with none', () => {
    const out = repaired(snap({}))
    expect([out.design.sections, out.design.connectors]).toEqual([{}, {}])
  })

  it("keeps a page's sections and connectors, loose ends included", () => {
    const s = {
      ...snap({}),
      sections: { s1: { pageId: 'p1', title: 'Ads', order: 'a0' } },
      connectors: { c1: { pageId: 'p1', from: 'p1-sq', to: 'gone', order: 'a0' } },
    }
    s.frames['p1-sq'] = { ...frame('p1', 0, 'a0'), sectionId: 'missing', starred: true }
    const out = repaired(s)
    expect(out.design.sections).toEqual(s.sections)
    expect(out.design.connectors).toEqual(s.connectors)
    expect(out.design.frames['p1-sq']).toMatchObject({ sectionId: 'missing', starred: true })
    expect([out.repairs, out.leftOut]).toEqual([[], []])
  })

  it('leaves out a section or connector the schema does not take, and drops one whose page is gone', () => {
    const s = {
      ...snap({}),
      sections: {
        ok: { pageId: 'p1', title: 'Ads', order: 'a0' },
        untitled: { pageId: 'p1', title: ' ', order: 'a1' },
        lost: { pageId: 'p9', title: 'Lost', order: 'a2' },
        'held-out': { pageId: 'p2', title: 'Held', order: 'a0' },
        'p1-sq': { pageId: 'p1', title: 'Clash', order: 'a3' },
      },
      connectors: {
        joined: { pageId: 'p1', from: 'p1-sq', to: 'ok', order: 'a0' },
        endless: { pageId: 'p1', from: 'p1-sq', order: 'a1' },
        astray: { pageId: 'p9', from: 'a', to: 'b', order: 'a2' },
      },
    }
    s.pages.p2 = { name: 'Page 2', order: 5 }
    const out = repaired(s)
    expect(Object.keys(out.design.sections)).toEqual(['ok'])
    expect(Object.keys(out.design.connectors)).toEqual(['joined'])
    expect(out.repairs).toEqual([
      'dropped section "lost", whose page "p9" is gone',
      'dropped connector "astray", whose page "p9" is gone',
    ])
    expect(out.leftOut.filter(({ part }) => part === 'section' || part === 'connector')).toEqual([
      { part: 'section', id: 'untitled', issue: 'title: Too small: expected string to have >=1 characters' },
      { part: 'section', id: 'held-out', issue: '"p2", which holds it, was left out' },
      { part: 'section', id: 'p1-sq', issue: '"p1-sq" is a section and another record' },
      { part: 'connector', id: 'endless', issue: 'to: Invalid input: expected string, received undefined' },
    ])
  })

  it('gives a meta field the schema does not take its default, and reports it', () => {
    const s = snap({ a: layer('graphic', 'p1-sq', 'a') })
    const out = repaired({ ...s, meta: { designId: '', name: 7 } as unknown as typeof s.meta })
    expect(out.design.meta).toEqual({ designId: 'unknown', name: '' })
    expect(Object.keys(out.nodes)).toEqual(['a'])
    expect(out.leftOut).toEqual([
      { part: 'meta', id: 'designId', issue: 'Too small: expected string to have >=1 characters' },
      { part: 'meta', id: 'name', issue: 'Invalid input: expected string, received number' },
    ])
  })

  it('reads a schema version a tab wrote into meta as nothing, leaving nothing out', () => {
    const s = snap({ a: layer('graphic', 'p1-sq', 'a') })
    for (const schemaVersion of [99, 'one']) {
      const read = repaired({ ...s, meta: { ...s.meta, schemaVersion } as typeof s.meta })
      expect(read.design.meta).toStrictEqual(s.meta)
      expect(read.leftOut).toEqual([])
    }
  })

  it('gives a design whose only page the schema does not take one empty page', () => {
    const s = snap({ a: layer('graphic', 'p1-sq', 'a') })
    s.pages = { p1: { name: 'Page 1' } }
    const out = repaired(s)
    expect(out.design.pages).toEqual({ page: { name: 'Page 1', order: 'a0' } })
    expect(out.design.frames).toEqual({})
    expect(out.repairs).toEqual([
      'no page was left; added the empty page "page"',
      'dropped frame "p2-sq", whose page "p2" is gone',
    ])
    expect(out.leftOut.map(({ part, id }) => [part, id])).toEqual([
      ['page', 'p1'],
      ['frame', 'p1-sq'],
      ['frame', 'p1-story'],
      ['layer', 'a'],
    ])
  })

  it('adds the empty page at an id no page left out has either', () => {
    const s = snap({})
    s.pages = { page: { name: 'Page 1' } }
    s.frames = {}
    const out = repaired(s)
    expect(out.design.pages).toEqual({ 'page-2': { name: 'Page 1', order: 'a0' } })
    expect(out.leftOut.map(({ part, id }) => [part, id])).toEqual([['page', 'page']])
  })

  it('puts a layer that lost its index at the back', () => {
    const lost = layer('graphic', 'p1-sq', 'a')
    delete lost.index
    const out = repaired(snap({ a: lost }))
    expect(out.nodes.a).toMatchObject({ index: 'a0', parentId: 'p1-sq' })
    expect(out.repairs).toEqual(['"a" lost its index; put at the back'])
  })

  it('breaks a cycle at its smallest id, moving it to the top of the first frame of the first page that has one', () => {
    const s = snap({
      g2: layer('group', 'g1', 'g2'),
      g1: layer('group', 'g2', 'g1'),
      kid: layer('graphic', 'g2', 'kid'),
    })
    // The first page has no frame; on the second, the frame first by order (not by id) is the fallback.
    s.pages = { p0: { name: 'Empty', order: 'a0' }, p1: { name: 'Page 1', order: 'a1' } }
    s.frames = { 'p1-b': frame('p1', 0, 'a0'), 'p1-a': frame('p1', 1280, 'a1') }
    const out = repaired(s)
    expect(out.nodes.g1?.parentId).toBe('p1-b')
    expect(out.nodes.g2?.parentId).toBe('g1')
    expect(out.nodes.kid?.parentId).toBe('g2')
    expect(out.repairs).toEqual(['"g1" was inside itself; moved to frame "p1-b"'])
  })

  it('gives the layers a broken cycle brings into a frame a link no other layer holds, so no link id is on two pages', () => {
    const out = repaired(
      snap({
        g1: layer('group', 'g2', 'L'),
        g2: layer('group', 'g1', 'g2'),
        kid: layer('graphic', 'g2', 'kid'),
        // Their linked copies on page p2, where the cycle's layers were before the moves.
        'p2-g1': layer('group', 'p2-sq', 'L'),
        'p2-kid': layer('graphic', 'p2-g1', 'kid'),
        // A layer on p1 that holds the cycle layer's id as its link.
        other: layer('graphic', 'p1-story', 'g2'),
      }),
    )
    expect(out.nodes.g1).toMatchObject({ parentId: 'p1-sq', link: 'g1' })
    expect(out.nodes.g2).toMatchObject({ parentId: 'g1', link: 'g2-2' })
    expect(out.nodes.kid).toMatchObject({ parentId: 'g2', link: 'kid-2' })
    expect([out.nodes['p2-g1']?.link, out.nodes['p2-kid']?.link, out.nodes.other?.link]).toEqual(['L', 'kid', 'g2'])
    expect(out.repairs).toEqual([
      '"g1" was inside itself; moved to frame "p1-sq"',
      '"g1" came out of a cycle with link "L", which another layer holds; its link is now "g1"',
      '"g2" came out of a cycle with link "g2", which another layer holds; its link is now "g2-2"',
      '"kid" came out of a cycle with link "kid", which another layer holds; its link is now "kid-2"',
    ])
  })

  it('drops the layers of a cycle, and what they hold, when no frame is left to move them to', () => {
    const s = snap({
      g1: layer('group', 'g2', 'g1'),
      g2: layer('group', 'g1', 'g2'),
      kid: layer('graphic', 'g2', 'kid'),
    })
    s.frames = {}
    const out = repaired(s)
    expect(out.nodes).toEqual({})
    expect(out.repairs).toEqual([
      'dropped "g1", which was inside itself, with no frame to move it to',
      'dropped "g2", which was inside itself, with no frame to move it to',
      'dropped "kid", which is in no frame',
    ])
  })

  it("moves a layer whose parent can't hold it to the top of that parent's frame", () => {
    const out = repaired(
      snap({
        g: layer('group', 'p1-story', 'g'),
        pic: layer('graphic', 'g', 'pic'),
        t: layer('text', 'pic', 't'),
      }),
    )
    expect(out.nodes.t?.parentId).toBe('p1-story')
    expect(out.nodes.pic?.parentId).toBe('g')
    expect(out.repairs).toEqual([`"t" can't be held by "pic"; moved to frame "p1-story"`])
  })

  it('drops a layer whose frame or parent is gone, with everything under it', () => {
    const out = repaired(
      snap({
        orphan: layer('group', 'deleted-group', 'orphan'),
        child: layer('graphic', 'orphan', 'child'),
        framed: layer('graphic', 'deleted-frame', 'framed'),
        kept: layer('graphic', 'p2-sq', 'kept'),
      }),
    )
    expect(Object.keys(out.nodes)).toEqual(['kept'])
    expect(out.repairs).toEqual([
      'dropped "child", which is in no frame',
      'dropped "framed", which is in no frame',
      'dropped "orphan", which is in no frame',
    ])
  })

  it('leaves a link to the layer of a frame whose id sorts first, and gives each other holder its own id as link', () => {
    const out = repaired(
      snap({
        b: layer('graphic', 'p1-sq', 'L', 'a1'),
        a: layer('graphic', 'p1-sq', 'L', 'a0'),
        c: layer('graphic', 'p1-sq', 'L', 'a2'),
        // One link id in two frames is how linked copies are.
        d: layer('graphic', 'p1-story', 'L'),
      }),
    )
    expect(Object.fromEntries(Object.entries(out.nodes).map(([id, n]) => [id, n.link]))).toEqual({
      a: 'L',
      b: 'b',
      c: 'c',
      d: 'L',
    })
    expect(out.repairs).toEqual([
      '"b" held link "L" in frame "p1-sq" with "a"; its link is now "b"',
      '"c" held link "L" in frame "p1-sq" with "a"; its link is now "c"',
    ])
  })

  it('numbers the new link from 2 when the frame holds the layer id as a link, cutting a long id to fit', () => {
    const long = 'x'.repeat(64)
    const out = repaired(
      snap({
        a: layer('graphic', 'p1-sq', 'L'),
        b: layer('graphic', 'p1-sq', 'L'),
        holdsB: layer('graphic', 'p1-sq', 'b'),
        holdsB2: layer('graphic', 'p1-sq', 'b-2'),
        [long]: layer('graphic', 'p1-sq', 'L'),
        holdsLong: layer('graphic', 'p1-sq', long),
      }),
    )
    expect(out.nodes.b?.link).toBe('b-3')
    expect(out.nodes[long]?.link).toBe(`${'x'.repeat(60)}-2`)
  })

  it('checks links last, among the layers a broken cycle brought into a frame', () => {
    const s = snap({
      'a-keeper': layer('graphic', 'p1-sq', 'L'),
      g1: layer('group', 'g2', 'L'),
      g2: layer('group', 'g1', 'g2'),
    })
    const out = repaired(s)
    expect(out.nodes.g1).toMatchObject({ parentId: 'p1-sq', link: 'g1' })
    expect(out.nodes['a-keeper']?.link).toBe('L')
  })
})
