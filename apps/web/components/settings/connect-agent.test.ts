// How the Connect an agent page shows what an agent's client says of itself: its name with nothing in it that draws
// over the page, and the host it sends the person back to with the end that names the site always in view.
import { describe, expect, it, vi } from 'vitest'

import { shownHost, shownName } from './connect-agent.tsx'

// The form's actions run on the server; these tests draw nothing and send nothing.
vi.mock('@/app/agents/connect/actions.ts', () => ({ allow: vi.fn(), deny: vi.fn() }))

describe('shownName', () => {
  it('keeps a plain name as it is, in any script', () => {
    expect(shownName('Claude Code')).toBe('Claude Code')
    expect(shownName('وكيل التصميم')).toBe('وكيل التصميم')
    expect(shownName('Tiếng Việt')).toBe('Tiếng Việt')
  })

  it('draws a line or paragraph break as a space, so a name never fakes lines of the page', () => {
    expect(shownName('Claude\u2028Dazbee checked this agent\u2029')).toBe('Claude Dazbee checked this agent ')
  })

  it('keeps at most three marks on a letter, so a name never stacks marks over the lines round it', () => {
    expect(shownName(`Z${'\u0336\u0335'.repeat(50)}ed`)).toBe('Z\u0336\u0335\u0336ed')
  })
})

describe('shownHost', () => {
  it('shows a host as it is', () => {
    expect(shownHost('127.0.0.1:33418')).toBe('127.0.0.1:33418')
    expect(shownHost('claude.ai')).toBe('claude.ai')
  })

  it('cuts a long host from its start, keeping the end that names the site', () => {
    const host = `claude.ai.${'a'.repeat(200)}.evil.example`

    expect(shownHost(host)).toBe(`…${host.slice(-63)}`)
    expect(shownHost(host).endsWith('.evil.example')).toBe(true)
  })
})
