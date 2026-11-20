import { describe, expect, it } from 'vitest'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { kitEntryName } from './kit-names.ts'

describe('kitEntryName', () => {
  it("shows a role by the role's own name, in the person's language, whatever name it stores", () => {
    const primary = { token: 'primary', name: 'Brand navy' }
    expect(kitEntryName(en.editor.brandKit.brandRoles, 'color', primary)).toBe('Primary')
    expect(kitEntryName(ar.editor.brandKit.brandRoles, 'color', primary)).toBe('الأساسي')
    expect(kitEntryName(en.editor.brandKit.brandRoles, 'font', { token: 'body', name: 'Body copy' })).toBe('Body')
  })

  it("shows the brand's own colours and fonts by their names, and a role's token of the other kind too", () => {
    expect(kitEntryName(en.editor.brandKit.brandRoles, 'color', { token: 'sale-red', name: 'Sale red' })).toBe(
      'Sale red',
    )
    expect(kitEntryName(en.editor.brandKit.brandRoles, 'font', { token: 'text', name: 'Small print' })).toBe(
      'Small print',
    )
  })
})
