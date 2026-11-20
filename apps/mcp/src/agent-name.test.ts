import { describe, expect, it } from 'vitest'

import { agentName } from './agent-name.ts'

describe('agentName', () => {
  it('takes the client’s title before its name', () => {
    expect(agentName({ name: 'claude-code', title: 'Claude' })).toBe('Claude (agent)')
  })

  it('takes the client’s name when it has no title, or a blank one', () => {
    expect(agentName({ name: 'test' })).toBe('test (agent)')
    expect(agentName({ name: 'test', title: '   ' })).toBe('test (agent)')
  })

  it('names an agent that gives no name, or a blank one, “AI agent”', () => {
    expect(agentName(undefined)).toBe('AI agent')
    expect(agentName({ name: '' })).toBe('AI agent')
    expect(agentName({ name: ' \t ', title: '\u0007' })).toBe('AI agent')
  })

  it('takes control and format characters out', () => {
    expect(agentName({ name: 'Cl\u0000au\u001bde\n' })).toBe('Claude (agent)')
    expect(agentName({ name: 'x', title: '‮Claude​' })).toBe('Claude (agent)')
  })

  it('cuts a long name to 56 characters before “ (agent)”, 64 in all', () => {
    const name = agentName({ name: 'x'.repeat(200) })
    expect(name).toBe(`${'x'.repeat(56)} (agent)`)
    expect(name).toHaveLength(64)
  })

  it('counts characters, not UTF-16 units, so a cut never splits one', () => {
    expect(agentName({ name: '🐝'.repeat(60) })).toBe(`${'🐝'.repeat(56)} (agent)`)
  })
})
