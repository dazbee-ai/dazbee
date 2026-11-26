import { describe, expect, it } from 'vitest'

import { cleanNote, designRecords, readTabVersion, SYNC_CLOSE, TabMessage } from './sync.ts'

describe('SYNC_CLOSE', () => {
  it('gives each reason its own code, in the range a WebSocket leaves to applications', () => {
    const codes = Object.values(SYNC_CLOSE)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code >= 4000 && code <= 4999).toBe(true)
  })
})

const MARK = { versionId: 'v1', kind: 'named', name: 'Sent to client', takenAt: '2026-11-16T14:30:00.000Z' }

describe('TabMessage', () => {
  const changes = (kind: string) => ({ type: 'changes', id: 1, base: 0, kind, changes: [], restore: MARK })

  it('takes a restore mark on an edit change set', () => {
    expect(TabMessage.safeParse(changes('edit')).success).toBe(true)
  })

  it('refuses a restore mark on an undo, a redo or a follow-up', () => {
    for (const kind of ['undo', 'redo', 'followUp']) expect(TabMessage.safeParse(changes(kind)).success).toBe(false)
  })
})

describe('readTabVersion', () => {
  it('reads a whole number from 1, and nothing else, as the version a tab was built with', () => {
    expect(readTabVersion('1')).toBe(1)
    expect(readTabVersion('12')).toBe(12)
    for (const sent of [null, '', '0', '-1', '1.5', '01', '1e3', 'Infinity', ' 1', '99999999999999999999'])
      expect(readTabVersion(sent)).toBeNull()
  })
})

describe('cleanNote', () => {
  it('turns control characters into spaces, drops what changes the writing direction, and trims', () => {
    expect(cleanNote('  Writing\tthe\nheadline \u0007 ')).toBe('Writing the headline')
    expect(cleanNote('‮enilwen‬ ⁧كتابة⁩')).toBe('enilwen كتابة')
    expect(cleanNote('👨‍👩‍👧 family')).toBe('👨‍👩‍👧 family')
  })
})

describe('designRecords', () => {
  const design = { meta: { designId: 'd', name: 'D' }, pages: { p1: {} }, frames: {}, nodes: {} }

  it('stores a design without sections or connectors as before them', () => {
    expect(designRecords({ ...design, sections: {}, connectors: {} })).toEqual(design)
    expect(Object.keys(designRecords(design))).toEqual(['meta', 'pages', 'frames', 'nodes'])
  })

  it('keeps the sections and connectors a design holds', () => {
    const sections = { s1: { pageId: 'p1', title: 'S', order: 'a0' } }
    const connectors = { c1: { pageId: 'p1', from: 'a', to: 'b', order: 'a0' } }
    expect(designRecords({ ...design, sections, connectors })).toEqual({ ...design, sections, connectors })
  })
})
