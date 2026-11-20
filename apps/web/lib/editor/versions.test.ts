import { describe, expect, it } from 'vitest'

import type { VersionSummary } from '@dazbee/schema'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { valueStore } from './value-store.ts'
import {
  copyName,
  renamedTo,
  restoreBlocked,
  restoredWords,
  restoreMark,
  saveBlocked,
  savedName,
  versionByline,
  versionItems,
  versionTime,
  versionTitle,
  viewingWords,
  whenSaved,
} from './versions.ts'

const words = en.editor.versions
const TAKEN = '2026-11-16T14:30:00.000Z'
const version = (over: Partial<VersionSummary> = {}): VersionSummary => ({
  id: 'v1',
  kind: 'named',
  name: 'Sent to client',
  description: '',
  savedBy: 'Ann',
  takenAt: TAKEN,
  ...over,
})
/** A history of `n` versions, all named. */
const named = (n: number) => Array.from({ length: n }, (_, i) => version({ id: `v${i}`, name: `V${i}` }))
/** A time as the page's locale writes it, in the machine's own time zone, as the card does. */
const at = (locale: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(
    new Date(TAKEN),
  )

describe('versionTitle', () => {
  it('is a named version’s name, and Autosave or Before restore for an automatic one, in the page’s language', () => {
    expect(versionTitle(version(), words)).toBe('Sent to client')
    expect(versionTitle(version({ kind: 'auto', name: '' }), words)).toBe('Autosave')
    expect(versionTitle(version({ kind: 'beforeRestore', name: '' }), words)).toBe('Before restore')
    expect(versionTitle(version({ kind: 'auto', name: '' }), ar.editor.versions)).toBe('حفظ تلقائي')
  })

  it('is Before and the agent’s name for a Before agent version, or Before agent when it has none', () => {
    expect(versionTitle(version({ kind: 'beforeAgent', name: 'Claude (agent)' }), words)).toBe('Before Claude (agent)')
    expect(versionTitle(version({ kind: 'beforeAgent', name: '' }), words)).toBe('Before agent')
    expect(versionTitle(version({ kind: 'beforeAgent', name: 'Claude (agent)' }), ar.editor.versions)).toBe(
      'قبل Claude (agent)',
    )
  })
})

describe('versionTime', () => {
  it('writes when a version was taken as day, month and time in the page’s locale', () => {
    expect(versionTime('en', TAKEN)).toBe(at('en'))
    expect(versionTime('ar', TAKEN)).toBe(at('ar'))
    expect(versionTime('en', TAKEN)).toMatch(/16 Nov|Nov 16/)
  })
})

describe('viewingWords', () => {
  it('says which version the canvas shows: a named one by its name in quotes, an automatic one by its kind, and when', () => {
    expect(viewingWords('en', version(), words)).toBe(`Viewing ‘Sent to client’ · ${at('en')}`)
    expect(viewingWords('en', version({ kind: 'auto', name: '' }), words)).toBe(`Viewing Autosave · ${at('en')}`)
    expect(viewingWords('ar', version({ kind: 'beforeRestore', name: '' }), ar.editor.versions)).toContain(
      'قبل الاستعادة',
    )
  })
})

describe('restoredWords', () => {
  it('says what a restore restored: a named version by its name, an automatic one by when it was taken', () => {
    expect(restoredWords('en', version(), words)).toBe('Restored ‘Sent to client’')
    expect(restoredWords('en', version({ kind: 'auto', name: '' }), words)).toBe(
      `Restored the version from ${at('en')}`,
    )
  })
})

describe('versionByline', () => {
  it('names who named it and when, Automatic for an automatic version, and Someone for a person gone', () => {
    expect(versionByline('en', version(), words)).toBe(`Ann · ${at('en')}`)
    expect(versionByline('en', version({ kind: 'auto', name: '', savedBy: null }), words)).toBe(
      `Automatic · ${at('en')}`,
    )
    expect(versionByline('en', version({ savedBy: null }), words)).toBe(`Someone · ${at('en')}`)
    expect(versionByline('ar', version({ kind: 'beforeRestore', savedBy: null }), ar.editor.versions)).toBe(
      `تلقائي · ${at('ar')}`,
    )
  })
})

describe('versionItems', () => {
  it('gives a member whose role writes Save version, Rename and Delete, and a Reviewer none', () => {
    expect(versionItems(true)).toEqual({ save: true, rename: true, remove: true, restore: true, copy: true })
    expect(versionItems(false)).toEqual({ save: false, rename: false, remove: false, restore: false, copy: false })
  })
})

describe('saveBlocked', () => {
  it('offers Save while the tab saves or is about to, and says why not while Offline or not saving', () => {
    for (const status of ['Saved', 'Saving', 'Connecting']) expect(saveBlocked(status, [])).toBeNull()
    expect(saveBlocked('Offline', [])).toBe('offline')
    for (const status of ['Outdated', 'Deleted', 'Replaced', 'NoAccess', 'Error: lost'])
      expect(saveBlocked(status, [])).toBe('notSaving')
    expect(words[saveBlocked('Offline', []) ?? 'full']).toBe('Reconnect to save a version')
  })

  it('refuses Save with the history full of named versions, 100 of them, and not while one is automatic', () => {
    expect(saveBlocked('Saved', named(100))).toBe('full')
    expect(words.full).toBe('The version history is full. Delete a version to save another.')
    expect(saveBlocked('Saved', named(99))).toBeNull()
    const oneAutomatic = [...named(99), version({ id: 'a', kind: 'auto', name: '' })]
    expect(saveBlocked('Saved', oneAutomatic)).toBeNull()
  })
})

describe('restoreBlocked', () => {
  it('offers Restore while the tab is connected, and turns it off with Reconnect while Offline', () => {
    expect(restoreBlocked('Saved', named(3), 'v1')).toBeNull()
    expect(restoreBlocked('Saving', named(3), 'v1')).toBeNull()
    expect(restoreBlocked('Offline', named(3), 'v1')).toBe('offline')
    expect(words.reconnectRestore).toBe('Reconnect to restore')
    expect(restoreBlocked('Deleted', named(3), 'v1')).toBe('notSaving')
  })

  it('refuses with the history full when 100 versions hold none automatic but the one restored, which is never dropped', () => {
    expect(restoreBlocked('Saved', named(100), 'v1')).toBe('full')
    const restoringAutosave = [...named(99), version({ id: 'a', kind: 'auto', name: '' })]
    expect(restoreBlocked('Saved', restoringAutosave, 'a')).toBe('full')
    expect(restoreBlocked('Saved', restoringAutosave, 'v1')).toBeNull()
    expect(restoreBlocked('Saved', named(99), 'v1')).toBeNull()
  })
})

describe('restoreMark', () => {
  it('is the version’s id, kind, name and time, as the restore’s change set carries them', () => {
    expect(restoreMark(version({ description: 'For round 2' }))).toEqual({
      versionId: 'v1',
      kind: 'named',
      name: 'Sent to client',
      takenAt: TAKEN,
    })
  })
})

describe('copyName', () => {
  it('names the copy after the design and the version, in the page’s words, cut to 120 characters', () => {
    expect(copyName('Spring sale', version(), words)).toBe('Spring sale (Sent to client)')
    expect(copyName('Spring sale', version({ kind: 'beforeRestore', name: '' }), words)).toBe(
      'Spring sale (Before restore)',
    )
    expect(copyName('Spring sale', version({ kind: 'beforeAgent', name: 'Claude (agent)' }), words)).toBe(
      'Spring sale (Before Claude (agent))',
    )
    expect(copyName('Spring sale', version({ kind: 'auto', name: '' }), ar.editor.versions)).toBe(
      'Spring sale (حفظ تلقائي)',
    )
    const long = copyName('D'.repeat(100), version({ name: 'N'.repeat(100) }), words)
    expect(long).toHaveLength(120)
    expect(long.startsWith(`${'D'.repeat(100)} (N`)).toBe(true)
  })
})

describe('savedName', () => {
  it('saves an empty name as Version N in the page’s language, N one more than the versions listed', () => {
    expect(savedName('  ', words, named(3))).toBe('Version 4')
    expect(savedName('', ar.editor.versions, named(0))).toBe('النسخة 1')
    expect(savedName('  Round 2 ', words, named(3))).toBe('Round 2')
  })
})

describe('renamedTo', () => {
  it('gives the name a rename sends, or null when it changes nothing', () => {
    expect(renamedTo(version(), ' Approved ', words)).toBe('Approved')
    expect(renamedTo(version(), 'Sent to client', words)).toBeNull()
    expect(renamedTo(version(), '   ', words)).toBeNull()
    // An automatic version renamed becomes named; left as its title, it stays automatic.
    expect(renamedTo(version({ kind: 'auto', name: '' }), 'Good one', words)).toBe('Good one')
    expect(renamedTo(version({ kind: 'auto', name: '' }), 'Autosave', words)).toBeNull()
  })
})

describe('whenSaved', () => {
  it('waits until the tab is Saved', async () => {
    const status = valueStore('Saving')
    let answer: string | null = null
    void whenSaved(status).then((a) => (answer = a))
    await Promise.resolve()
    expect(answer).toBeNull()
    status.set('Saved')
    await Promise.resolve()
    expect(answer).toBe('saved')
  })

  it('answers at once for a tab already Saved, and stops waiting with why once the tab goes Offline', async () => {
    expect(await whenSaved(valueStore('Saved'))).toBe('saved')
    const status = valueStore('Saving')
    const waited = whenSaved(status)
    status.set('Offline')
    expect(await waited).toBe('offline')
    expect(await whenSaved(valueStore('Deleted'))).toBe('notSaving')
  })
})
