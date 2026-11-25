// The root layout, run in Node with the cookies and fonts stubbed: the build it names on <html>.
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PhoneSoon } from '@/components/ui/phone-soon.tsx'
import { en } from '@/lib/i18n/en.ts'

import RootLayout from './layout.tsx'

vi.mock('server-only', () => ({}))
vi.mock('./globals.css', () => ({}))
vi.mock('@/lib/fonts.ts', () => ({ fontVariables: '' }))
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }))

const html = async () => (await RootLayout({ children: 'page' })) as ReactElement<Record<string, unknown>>

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('RootLayout', () => {
  it('names the build it is of on <html>', async () => {
    vi.stubEnv('BUILD_ID', '0123456789abcdef0123456789abcdef01234567')

    expect((await html()).props['data-build']).toBe('0123456789abcdef0123456789abcdef01234567')
  })

  it('puts the phone notice first in the body, in the reader’s language', async () => {
    const [, body] = (await html()).props.children as [unknown, ReactElement<{ children: ReactElement[] }>]
    const [first] = body.props.children

    expect(first?.type).toBe(PhoneSoon)
    expect(first?.props).toEqual({ title: en.pages.phoneSoon.title, line: en.pages.phoneSoon.line })
  })

  it('names a build run from a checkout `dev`', async () => {
    vi.stubEnv('BUILD_ID', '')

    expect((await html()).props['data-build']).toBe('dev')
  })
})
