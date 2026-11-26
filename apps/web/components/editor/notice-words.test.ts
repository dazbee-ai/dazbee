// The words of the editor's notices, in each language: those the connection gives too (C35, C36,
// C39, C43, D9, D11), each reason a change set is rejected for included.
import { describe, expect, it } from 'vitest'

import { REJECT_REASONS } from '@dazbee/schema'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { noticePose, noticeWords } from './notice-words.ts'

describe('noticeWords', () => {
  it('says why a change set was rejected, by its reason, and when the reason was not heard', () => {
    for (const [locale, messages] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      const words = REJECT_REASONS.map((reason) =>
        noticeWords(locale, messages.editor, 'rejected', { kind: 'edit', reason }),
      )
      expect(words.every((w) => w.length > 0)).toBe(true)
      expect(noticeWords(locale, messages.editor, 'rejected', { kind: 'edit' })).toBe(
        messages.editor.notices.rejected.offline,
      )
    }
    expect(noticeWords('en', en.editor, 'rejected', { kind: 'undo', reason: 'placedSince' })).toBe(
      'That undo would have removed what someone just added, so it was taken back.',
    )
  })

  it('says a tab that came to only view kept nothing not yet saved, in the same words whether its drag was put back or the server refused its change', () => {
    const notKept = 'You can now only view this design, so changes not yet saved weren’t kept.'
    expect(noticeWords('en', en.editor, 'nowViewOnly')).toBe(notKept)
    expect(noticeWords('en', en.editor, 'rejected', { kind: 'edit', reason: 'viewOnly' })).toBe(notKept)
    expect(noticeWords('ar', ar.editor, 'nowViewOnly')).toBe(
      noticeWords('ar', ar.editor, 'rejected', { kind: 'edit', reason: 'viewOnly' }),
    )
  })

  it('counts the change sets lost, and gives the share of a design near its limits as a percentage', () => {
    expect(noticeWords('en', en.editor, 'queueLost', { changeSets: 1 })).toBe(
      '1 change made while offline could not be saved, as the design was restored meanwhile.',
    )
    expect(noticeWords('en', en.editor, 'queueLost', { changeSets: 4 })).toMatch(/^4 changes /)
    expect(noticeWords('ar', ar.editor, 'queueLost', { changeSets: 2 })).toMatch(/^تعذّر حفظ تغييرين/)
    expect(noticeWords('en', en.editor, 'nearLimit', { share: 0.8312 })).toBe(
      'This design is 83% full. Move some frames to another design before it fills up.',
    )
  })

  it('names the sections or the connectors when they are what is near its limit, in both languages', () => {
    expect(noticeWords('en', en.editor, 'nearLimit', { share: 0.8, parts: 'sections' })).toBe(
      'This design holds 80% of the sections it can. Ungroup some sections before it fills up.',
    )
    expect(noticeWords('en', en.editor, 'nearLimit', { share: 0.9, parts: 'connectors' })).toBe(
      'This design holds 90% of the connectors it can. Delete some connectors before it fills up.',
    )
    expect(noticeWords('ar', ar.editor, 'nearLimit', { share: 0.8, parts: 'sections' })).toContain('الأقسام')
    expect(noticeWords('ar', ar.editor, 'nearLimit', { share: 0.8, parts: 'connectors' })).toContain('الموصلات')
  })

  it('gives the notices with nothing besides them their words as they are', () => {
    for (const n of ['deviceFull', 'deviceCopyFailed', 'noDeviceCopy', 'viewOnly', 'pickFailed', 'pickTooBig'] as const)
      expect(noticeWords('en', en.editor, n)).toBe(en.editor.notices[n])
    expect(noticeWords('ar', ar.editor, 'pickTooBig')).toBe(ar.editor.notices.pickTooBig)
    expect(noticeWords('en', en.editor, 'viewOnly')).toBe('You can view this design, not edit it.')
  })

  it('words a step put back, a restore with words of its own that offer the copy', () => {
    expect(noticeWords('en', en.editor, 'putBack', { step: 'move' })).toBe(en.editor.notices.putBack)
    expect(noticeWords('en', en.editor, 'putBack', { step: null })).toBe(en.editor.notices.putBack)
    expect(noticeWords('en', en.editor, 'putBack', { step: 'restore' })).toBe(
      'This version is too different to restore in one step. Open it as a copy instead.',
    )
    expect(noticeWords('ar', ar.editor, 'putBack', { step: 'restore' })).toBe(ar.editor.notices.restoreTooBig)
  })

  it('names who restored which version: a named one by its name, an automatic one by when it was taken', () => {
    const takenAt = '2026-11-16T14:30:00.000Z'
    const named = { versionId: 'v1', kind: 'named', name: 'Sent to client', takenAt } as const
    const auto = { versionId: 'v2', kind: 'auto', name: '', takenAt } as const
    expect(noticeWords('en', en.editor, 'restored', { by: 'Ann', mark: named })).toBe('Ann restored ‘Sent to client’')
    const time = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    expect(noticeWords('en', en.editor, 'restored', { by: 'Ann', mark: auto })).toBe(
      `Ann restored the version from ${time.format(new Date(takenAt))}`,
    )
    expect(noticeWords('en', en.editor, 'restored', { by: ' ', mark: named })).toBe('Someone restored ‘Sent to client’')
    expect(noticeWords('ar', ar.editor, 'restored', { by: 'Ann', mark: named })).toBe('Ann استعاد «Sent to client»')
  })

  it('names who else is typing in the text being edited', () => {
    expect(noticeWords('en', en.editor, 'editingElsewhere', { name: 'Ann' })).toBe(
      'Ann is editing this text: the version finished last is kept.',
    )
    expect(noticeWords('ar', ar.editor, 'editingElsewhere', { name: 'Ann' })).toMatch(/^Ann /)
    expect(noticeWords('en', en.editor, 'editingElsewhere', { name: ' ' })).toBe(
      'Someone else is editing this text: the version finished last is kept.',
    )
  })

  it('fills the notices it read before: a layout, an SVG’s parts, the layers left out', () => {
    expect(noticeWords('en', en.editor, 'flowEnd', { layout: 'row' })).toBe(
      'This layer is already at that end of the row.',
    )
    expect(noticeWords('en', en.editor, 'svgLeftOut', { parts: ['filter', 'script'] })).toBe(
      'Placed as layers. Left out, since no layer can show them: filters and scripts.',
    )
    expect(noticeWords('en', en.editor, 'layersLeftOut', { layers: 2 })).toBe(
      '2 layers could not be read, so they are left out of the design.',
    )
  })

  it('says Copy as PNG copied, or why it copied nothing', () => {
    expect(noticeWords('en', en.editor, 'pngCopied')).toBe('Copied as PNG')
    expect(noticeWords('en', en.editor, 'pngNotCopied', { why: 'tooBig' })).toBe(
      'Too big to copy as a PNG: a picture has at most 16,383 pixels a side and 50 million in all.',
    )
    expect(noticeWords('en', en.editor, 'pngNotCopied', { why: 'refused' })).toBe(
      'The browser didn’t let Dazbee put the PNG on the clipboard.',
    )
    expect(noticeWords('ar', ar.editor, 'pngCopied')).toBe('نُسخ كصورة PNG')
  })

  it('names the pasted files that weren’t placed, as a list in the locale’s words', () => {
    expect(noticeWords('en', en.editor, 'imagesNotPasted', { names: ['notes.pdf', 'moving.gif'] })).toBe(
      'Couldn’t paste notes.pdf and moving.gif. Only PNG, JPEG and WebP images up to 16,384 pixels a side go on the design, and they upload first.',
    )
    expect(noticeWords('ar', ar.editor, 'imagesNotPasted', { names: ['a.gif'] })).toBe(
      'تعذّر لصق a.gif. لا يوضع على التصميم إلا صور PNG وJPEG وWebP التي لا يزيد ضلعها على 16,384 بكسل، وتُرفع أولًا.',
    )
  })

  it('says pictures are uploading, an SVG’s or pasted images, in the words of a drop: one by its name, more by their number', () => {
    expect(noticeWords('en', en.editor, 'uploading', { names: ['Card Photo'] })).toBe('Uploading Card Photo')
    expect(noticeWords('en', en.editor, 'uploading', { names: ['Card Photo', 'Card Logo'] })).toBe('Uploading 2 images')
    expect(noticeWords('ar', ar.editor, 'uploading', { names: ['Card Photo', 'Card Logo'] })).toBe('جارٍ رفع الصور (2)')
  })

  it('counts the pictures of an SVG that didn’t upload, after the parts it left out or alone', () => {
    expect(noticeWords('en', en.editor, 'svgLeftOut', { parts: ['filter'], notUploaded: 1 })).toBe(
      'Placed as layers. Left out, since no layer can show them: filters. 1 picture inside the SVG didn’t upload, so it is left out.',
    )
    expect(noticeWords('en', en.editor, 'svgLeftOut', { parts: [], notUploaded: 3 })).toBe(
      '3 pictures inside the SVG didn’t upload, so they are left out.',
    )
    expect(noticeWords('ar', ar.editor, 'svgLeftOut', { parts: [], notUploaded: 2 })).toBe(
      'تعذّر رفع صورتين داخل ملف SVG، فلم توضعا.',
    )
  })
})

describe('noticePose', () => {
  it('shows the offline bee beside the notice that this browser keeps no changes, and no bee beside the rest', () => {
    expect(noticePose('noDeviceCopy')).toBe('offline')
    for (const n of ['deviceFull', 'deviceCopyFailed', 'viewOnly', 'refused', 'nearLimit'] as const)
      expect(noticePose(n)).toBeUndefined()
  })
})
