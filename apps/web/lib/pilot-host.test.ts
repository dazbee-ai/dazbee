import { describe, expect, it } from 'vitest'

import { isPilotHost, PILOT_ACCESS_PATH, PILOT_AI_PATH, PILOT_PATH, pilotPath } from './pilot-host.ts'

describe('isPilotHost', () => {
  it('knows the host PILOT_HOST names, in any case, with its port', () => {
    expect(isPilotHost('pilot.example.com', 'pilot.example.com')).toBe(true)
    expect(isPilotHost('Pilot.Example.com', ' pilot.example.com ')).toBe(true)
    expect(isPilotHost('pilot.localhost:3117', 'pilot.localhost:3117')).toBe(true)
    expect(isPilotHost('pilot.localhost:3000', 'pilot.localhost:3117')).toBe(false)
    expect(isPilotHost('app.example.com', 'pilot.example.com')).toBe(false)
  })

  it('knows no pilot host when PILOT_HOST is unset or empty', () => {
    expect(isPilotHost('pilot.example.com', undefined)).toBe(false)
    expect(isPilotHost('pilot.example.com', ' ')).toBe(false)
    expect(isPilotHost(null, '')).toBe(false)
  })
})

describe('pilotPath', () => {
  it("serves the pilot host's / from the overview, and every other path as it is", () => {
    expect(pilotPath('/', 'pilot.example.com', 'pilot.example.com')).toBe(PILOT_PATH)
    expect(pilotPath('/login', 'pilot.example.com', 'pilot.example.com')).toBe('/login')
    expect(pilotPath('/', 'app.example.com', 'pilot.example.com')).toBe('/')
    expect(pilotPath('/pilot', 'app.example.com', 'pilot.example.com')).toBe('/pilot')
  })

  it("serves the pilot host's /ai from the AI section, and /ai anywhere else as it is", () => {
    expect(pilotPath('/ai', 'pilot.example.com', 'pilot.example.com')).toBe(PILOT_AI_PATH)
    expect(pilotPath('/ai', 'app.example.com', 'pilot.example.com')).toBe('/ai')
    expect(pilotPath('/ai', 'pilot.example.com', undefined)).toBe('/ai')
    expect(pilotPath('/ai/', 'pilot.example.com', 'pilot.example.com')).toBe('/ai/')
    expect(pilotPath('/ai/x', 'pilot.example.com', 'pilot.example.com')).toBe('/ai/x')
  })

  it("serves the pilot host's /access from early access, and /access anywhere else as it is", () => {
    expect(pilotPath('/access', 'pilot.example.com', 'pilot.example.com')).toBe(PILOT_ACCESS_PATH)
    expect(pilotPath('/access', 'app.example.com', 'pilot.example.com')).toBe('/access')
    expect(pilotPath('/access/x', 'pilot.example.com', 'pilot.example.com')).toBe('/access/x')
  })
})
