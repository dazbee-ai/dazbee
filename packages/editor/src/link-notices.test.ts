// What the connection tells the person, as the page's notices (D9, D10, D11, C36, C39, C43).
import { afterEach, describe, expect, it } from 'vitest'

import { type DesignSize, SYNC_LIMITS } from '@dazbee/schema'

import type { LinkNotice, LinkNotices } from './core-interface.ts'
import { editorLinkNotices } from './link-notices.ts'
import { DESIGN } from './test-actions.ts'
import { type TestEditor, testEditor } from './test-editor.ts'

/** A connection a test tells notices and sizes through. */
function testLink(first?: DesignSize) {
  const listeners = new Set<(notice: LinkNotice) => void>()
  const sizeListeners = new Set<() => void>()
  let size = first
  const link: LinkNotices = {
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    size: () => size,
    onSize(listener) {
      sizeListeners.add(listener)
      return () => sizeListeners.delete(listener)
    },
  }
  return {
    link,
    tell: (notice: LinkNotice) => {
      for (const listener of listeners) listener(notice)
    },
    resize(next: DesignSize) {
      size = next
      for (const listener of sizeListeners) listener()
    },
  }
}

/** A design size holding `layers` layers and little else. */
const layers = (n: number): DesignSize => ({ layers: n, frames: 1, pages: 1, sections: 0, connectors: 0, bytes: 1000 })

let editor: TestEditor | undefined
afterEach(() => editor?.end())

describe('editorLinkNotices', () => {
  it('tells each notice of the connection as the page’s, with what it tells besides', async () => {
    const { link, tell } = testLink()
    editor = await testEditor(DESIGN, { linkNotices: link })
    tell({ kind: 'rejected', changeSetId: 4, changeSetKind: 'undo', reason: 'placedSince' })
    tell({ kind: 'rejected', changeSetId: 5, changeSetKind: 'edit' })
    tell({ kind: 'lost', changeSets: 3 })
    tell({ kind: 'tooBig', step: 'paste' })
    tell({ kind: 'deviceStopped', why: 'full' })
    tell({ kind: 'deviceStopped', why: 'failed' })
    tell({ kind: 'noDeviceCopy' })
    const mark = { versionId: 'v1', kind: 'auto', name: '', takenAt: '2026-11-16T14:30:00.000Z' } as const
    tell({ kind: 'restored', by: 'Ann', mark })
    tell({ kind: 'tooBig', step: null })
    expect(editor.told).toEqual([
      ['rejected', { kind: 'undo', reason: 'placedSince' }],
      ['rejected', { kind: 'edit' }],
      ['queueLost', { changeSets: 3 }],
      ['putBack', { step: 'paste' }],
      ['deviceFull'],
      ['deviceCopyFailed'],
      ['noDeviceCopy'],
      ['restored', { by: 'Ann', mark }],
      ['putBack', { step: null }],
    ])
  })

  it('warns once a design reaches 80% of a limit, again only after it fell below, and at once for one opened past it', async () => {
    const warn = SYNC_LIMITS.designLayers * SYNC_LIMITS.warnAt
    const { link, tell, resize } = testLink(layers(100))
    editor = await testEditor(DESIGN, { linkNotices: link })
    resize(layers(warn - 1))
    expect(editor.told).toEqual([])
    resize(layers(warn))
    tell({ kind: 'nearLimit', size: layers(warn + 10) })
    resize(layers(warn + 20))
    expect(editor.told).toEqual([['nearLimit', { share: 0.8 }]])
    resize(layers(warn - 1))
    resize(layers(SYNC_LIMITS.designLayers * 0.9))
    expect(editor.told).toEqual([
      ['nearLimit', { share: 0.8 }],
      ['nearLimit', { share: 0.9 }],
    ])
    editor.end()
    const opened = testLink({ ...layers(1), bytes: SYNC_LIMITS.designBytes * 0.85 })
    editor = await testEditor(DESIGN, { linkNotices: opened.link })
    expect(editor.told).toEqual([['nearLimit', { share: 0.85 }]])
  })

  it('names the sections or the connectors when they are what is nearest its limit', async () => {
    const { link, resize } = testLink(layers(1))
    editor = await testEditor(DESIGN, { linkNotices: link })
    resize({ ...layers(1), sections: 800 })
    resize(layers(1))
    resize({ ...layers(1), connectors: 4500 })
    resize(layers(1))
    // The layers are nearer theirs than the connectors: the design as a whole is near its limit.
    resize({ ...layers(SYNC_LIMITS.designLayers * 0.95), connectors: 4500 })
    expect(editor.told).toEqual([
      ['nearLimit', { share: 0.8, parts: 'sections' }],
      ['nearLimit', { share: 0.9, parts: 'connectors' }],
      ['nearLimit', { share: 0.95 }],
    ])
  })

  it('keeps a warning that comes before the page listens, such as at the first welcome, until it does', () => {
    const { link, resize } = testLink()
    const told: unknown[][] = []
    const ending = new AbortController()
    const notices = editorLinkNotices({ link, notify: (...notice) => told.push(notice), signal: ending.signal })
    resize(layers(SYNC_LIMITS.designLayers * 0.9))
    expect(told).toEqual([])
    notices.tellOpened()
    notices.tellOpened()
    expect(told).toEqual([['nearLimit', { share: 0.9 }]])
    ending.abort()
  })

  it('keeps every notice that comes before the page listens, in order, and tells each once it does', () => {
    const { link, tell, resize } = testLink()
    const told: unknown[][] = []
    const ending = new AbortController()
    const notices = editorLinkNotices({ link, notify: (...notice) => told.push(notice), signal: ending.signal })
    tell({ kind: 'noDeviceCopy' })
    tell({ kind: 'rejected', changeSetId: 2, changeSetKind: 'edit', reason: 'placedSince' })
    resize(layers(SYNC_LIMITS.designLayers * 0.9))
    tell({ kind: 'lost', changeSets: 1 })
    expect(told).toEqual([])
    notices.tellOpened()
    notices.tellOpened()
    tell({ kind: 'tooBig', step: 'paste' })
    expect(told).toEqual([
      ['noDeviceCopy'],
      ['rejected', { kind: 'edit', reason: 'placedSince' }],
      ['nearLimit', { share: 0.9 }],
      ['queueLost', { changeSets: 1 }],
      ['putBack', { step: 'paste' }],
    ])
    ending.abort()
  })
})
