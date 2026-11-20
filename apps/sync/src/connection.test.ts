// The sync server's connection (D3, D10) over real sockets and Postgres: who may open a design and
// with what access, renewing the token, the tab's schema version, and the hello.
import { afterAll, describe, expect, it, vi } from 'vitest'

import { MEMBER_ROLES, type MemberRole, SCHEMA_VERSION, SYNC_CLOSE } from '@dazbee/schema'
import { signSyncToken, SYNC_TOKEN_TTL_MS } from '@dazbee/sync-token'

import { LIMITS } from './limits.ts'
import { BOB, changes, rename, storeSaved } from './test-saves.ts'
import { closeDatabase, pause, tokenFor, until } from './test-sync.ts'
import { openTab, startServer, type TestTab, typesOf, welcomeOf } from './test-tab.ts'

const servers: { destroy(): Promise<void> }[] = []
afterAll(async () => {
  await Promise.all(servers.map((s) => s.destroy()))
  await closeDatabase()
})

async function started(options: Parameters<typeof startServer>[0] = {}) {
  const run = await startServer(options)
  servers.push(run.server)
  return run
}

/** A tab on `designId` that said hello with `token` and was welcomed. */
async function joined(url: string, designId: string, token = tokenFor(designId)) {
  const tab = await openTab(url, designId)
  tab.hello(token)
  await tab.next('welcome')
  return tab
}

/** Whether the tab is still connected: it answers a ping with a pong. */
async function answers(tab: TestTab) {
  const from = tab.heard.length
  tab.send({ type: 'ping' })
  await tab.next('pong', from)
  return tab.closed === undefined
}

describe('access', () => {
  it('opens a design only with a valid token for it, closing the others before they hear anything', async () => {
    const { url } = await started()
    const design = await storeSaved()
    const other = await storeSaved()
    const tokens = [
      'not-a-token',
      tokenFor(design, { ttl: -1000 }),
      tokenFor(other),
      signSyncToken('someone-else-'.padEnd(32, 'y'), {
        designId: design,
        workspaceId: 'w',
        userId: 'u',
        role: 'editor',
        schemaVersion: SCHEMA_VERSION,
        name: 'Ann',
      }).token,
    ]
    for (const token of tokens) {
      const tab = await openTab(url, design)
      tab.hello(token)
      expect(await tab.whenClosed()).toBe(SYNC_CLOSE.tokenExpired)
      expect(tab.heard).toEqual([])
    }
  })

  it.each(MEMBER_ROLES.map((role) => [role, role === 'reviewer' ? 'view' : 'edit'] as const))(
    "tells a tab its access in the welcome: a %s's is %s",
    async (role: MemberRole, access) => {
      const { url } = await started()
      const design = await storeSaved()
      const tab = await joined(url, design, tokenFor(design, { role }))
      expect(welcomeOf(tab).access).toBe(access)
      tab.close()
    },
  )

  it("rejects a Reviewer's change sets, and the Reviewer stays connected", async () => {
    const { url } = await started()
    const design = await storeSaved()
    const tab = await joined(url, design, tokenFor(design, { role: 'reviewer' }))
    tab.send(changes(1, 0, [rename('l0', 'No')]))
    expect(await tab.next('reject')).toMatchObject({ changeSetId: 1, reason: 'viewOnly' })
    expect(await answers(tab)).toBe(true)
    tab.close()
  })

  it('takes a role a renewed token changes without a reconnect, losing no change set around it', async () => {
    const { url } = await started()
    const design = await storeSaved()
    const tab = await joined(url, design)
    tab.send(changes(1, 0, [rename('l0', 'Before')]))
    tab.send({ type: 'token', token: tokenFor(design, { role: 'reviewer' }) })
    tab.send(changes(2, 1, [rename('l0', 'While viewing')]))
    expect(await tab.next('access')).toEqual({ type: 'access', access: 'view' })
    expect(await tab.next('reject')).toMatchObject({ changeSetId: 2, reason: 'viewOnly' })
    tab.send({ type: 'token', token: tokenFor(design, { role: 'owner' }) })
    tab.send(changes(3, 1, [rename('l0', 'After')]))
    const from = tab.heard.length
    expect(await tab.next('access', from)).toEqual({ type: 'access', access: 'edit' })
    expect(await tab.next('accepted', from)).toMatchObject({ changeSetId: 3, seq: 2 })
    expect(tab.heard.filter((m) => m.type === 'accepted').map((m) => m.type === 'accepted' && m.changeSetId)).toEqual([
      1, 3,
    ])
    tab.close()
  })

  it("closes a connection sent another member's token, or one for another design", async () => {
    const { url } = await started()
    const design = await storeSaved()
    const other = await storeSaved()
    for (const token of [tokenFor(design, { userId: BOB.userId }), tokenFor(other), 'not-a-token']) {
      const tab = await joined(url, design)
      tab.send({ type: 'token', token })
      expect(await tab.whenClosed()).toBe(SYNC_CLOSE.tokenExpired)
    }
  })

  it('ends the connection at expiry without a fresh token', async () => {
    const { url } = await started({ renewal: { beforeMs: 100, everyMs: 50 } })
    const design = await storeSaved()
    const tab = await joined(url, design, tokenFor(design, { ttl: 600 }))
    expect(await tab.whenClosed()).toBe(SYNC_CLOSE.tokenExpired)
    expect(typesOf(tab)).toContain('token')
  })

  it('takes the token it has, brought back, as no renewal: it asks again and closes at expiry', async () => {
    const { url } = await started({ renewal: { beforeMs: 450, everyMs: 150 } })
    const design = await storeSaved()
    const token = tokenFor(design, { ttl: 900 })
    const tab = await joined(url, design, token)
    tab.onMessage = (message) => {
      if (message.type === 'token') tab.send({ type: 'token', token })
    }
    expect(await tab.whenClosed()).toBe(SYNC_CLOSE.tokenExpired)
    expect(typesOf(tab).filter((t) => t === 'token').length).toBeGreaterThanOrEqual(2)
  })

  it('takes nothing after the token expired, whatever the timers did', async () => {
    const { url, server } = await started()
    const design = await storeSaved()
    const tab = await joined(url, design)
    tab.send(changes(1, 0, [rename('l0', 'In time')]))
    await tab.next('accepted')
    // The clock passes the token's expiry while its timer has not fired.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + SYNC_TOKEN_TTL_MS + 1 })
    try {
      tab.send(changes(2, 1, [rename('l0', 'Late')]))
      expect(await tab.whenClosed()).toBe(SYNC_CLOSE.tokenExpired)
    } finally {
      vi.useRealTimers()
    }
    await server.designs.settled()
    expect(tab.heard.filter((m) => m.type === 'accepted')).toHaveLength(1)
  })

  it('asks again every so often until a token comes, and only once the tab was welcomed', async () => {
    const { url } = await started({ renewal: { beforeMs: 5_000, everyMs: 100 } })
    const design = await storeSaved()
    const tab = await openTab(url, design)
    // A token with less left than `beforeMs` is asked for at once: the ask waits for the welcome.
    tab.hello(tokenFor(design, { ttl: 4_000 }))
    await tab.next('welcome')
    await until(() => typesOf(tab).filter((t) => t === 'token').length >= 3)
    expect(typesOf(tab)[0]).toBe('welcome')
    tab.send({ type: 'token', token: tokenFor(design) })
    await pause(150)
    const asked = typesOf(tab).length
    await pause(300)
    expect(typesOf(tab).length).toBe(asked)
    tab.close()
  })
})

describe('versions', () => {
  it.each([[String(SCHEMA_VERSION - 1)], ['abc'], ['1.5'], [null]])(
    'closes a tab built before the server (%s) with tabTooOld before it says anything',
    async (version) => {
      const { url } = await started()
      const design = await storeSaved()
      const tab = await openTab(url, design, { version })
      expect(await tab.whenClosed()).toBe(SYNC_CLOSE.tabTooOld)
      expect(tab.heard).toEqual([])
    },
  )

  it('closes a tab built before the server with tabTooOld though its URL names no design, as a tab from before this server’s', async () => {
    const { url } = await started()
    const tab = await openTab(url, 'unused', { version: SCHEMA_VERSION - 1, design: null })
    expect(await tab.whenClosed()).toBe(SYNC_CLOSE.tabTooOld)
  })

  it("closes a tab older than its token's design, at hello and at renewal", async () => {
    const { url } = await started()
    const design = await storeSaved()
    const newer = tokenFor(design, { schemaVersion: SCHEMA_VERSION + 1 })
    const atHello = await openTab(url, design)
    atHello.hello(newer)
    expect(await atHello.whenClosed()).toBe(SYNC_CLOSE.tabTooOld)
    expect(atHello.heard).toEqual([])
    const atRenewal = await joined(url, design)
    atRenewal.send({ type: 'token', token: newer })
    expect(await atRenewal.whenClosed()).toBe(SYNC_CLOSE.tabTooOld)
  })

  it('lets a tab built after the design in', async () => {
    const { url } = await started()
    const design = await storeSaved()
    const tab = await openTab(url, design, { version: SCHEMA_VERSION + 1 })
    tab.hello(tokenFor(design))
    expect((await tab.next('welcome')).type).toBe('welcome')
    tab.close()
  })
})

describe('hello', () => {
  it('closes a tab that says no hello in time, or sends anything else first', async () => {
    const { url, lines } = await started({ limits: { ...LIMITS, idleMs: 0, helloMs: 150 } })
    const design = await storeSaved()
    const silent = await openTab(url, design)
    expect(await silent.whenClosed()).toBe(SYNC_CLOSE.protocol)
    const early = await openTab(url, design)
    early.send(changes(1, 0, [rename('l0', 'Early')]))
    expect(await early.whenClosed()).toBe(SYNC_CLOSE.protocol)
    const unnamed = await openTab(url, design, { design: null })
    expect(await unnamed.whenClosed()).toBe(SYNC_CLOSE.protocol)
    // An id not shaped as one is refused before it is read on or logged.
    const forged = await openTab(url, design, { design: `${design}\nforged log line` })
    expect(await forged.whenClosed()).toBe(SYNC_CLOSE.protocol)
    expect(lines.some((line) => line.includes('forged'))).toBe(false)
  })

  it('takes nothing a tab sent after the server closed it, in the same burst', async () => {
    const { url, server } = await started()
    const design = await storeSaved()
    const tab = await joined(url, design)
    tab.socket.send(Buffer.from('{}'), { binary: true })
    tab.send(changes(1, 0, [rename('l0', 'After the close')]))
    expect(await tab.whenClosed()).toBe(SYNC_CLOSE.protocol)
    await server.designs.settled()
    expect(server.designs.host(design)?.server()?.seq() ?? 0).toBe(0)
  })

  it('forgets a tab closed before its welcome: its place is free, and no tab hears of it', async () => {
    const { url } = await started({ limits: { ...LIMITS, idleMs: 0, connectionsPerMember: 1 } })
    const design = await storeSaved()
    const gone = await openTab(url, design)
    // It closes while the design is still loading.
    gone.hello(tokenFor(design))
    gone.close()
    await gone.whenClosed()
    await pause(50)
    const next = await joined(url, design)
    expect(welcomeOf(next).tabs).toEqual({})
    next.close()
  })

  it('closes the old socket of a tab that connected again, and frees its place, telling no one it left', async () => {
    const { url } = await started({ limits: { ...LIMITS, idleMs: 0, connectionsPerMember: 2 } })
    const design = await storeSaved()
    const old = await joined(url, design)
    const bob = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    const { syncId, tabId, secret } = welcomeOf(old)
    const again = await openTab(url, design)
    again.hello(tokenFor(design), { syncId, tabId, seq: 0, secret })
    expect((await again.next('welcome')).tabId).toBe(tabId)
    expect(await old.whenClosed()).toBe(SYNC_CLOSE.replaced)
    await pause(50)
    // The old socket's place is free: a second tab of the member opens.
    const second = await joined(url, design)
    expect(welcomeOf(second).tabId).not.toBe(tabId)
    expect(bob.heard.filter((m) => m.type === 'left' && m.tabId === tabId)).toEqual([])
    for (const tab of [again, bob, second]) tab.close()
  })

  it('names an agent’s tab to the others by the agent’s name, and a person’s tab by the person’s', async () => {
    const { url } = await started()
    const design = await storeSaved()
    const ann = await joined(url, design)
    const claude = await joined(url, design, tokenFor(design, { agent: 'Claude (agent)' }))
    const bob = await joined(url, design, tokenFor(design, { userId: BOB.userId, name: 'Bob' }))

    await until(() => ann.heard.filter((m) => m.type === 'joined').length === 2)
    expect(ann.heard.filter((m) => m.type === 'joined').map((m) => m.name)).toEqual(['Claude (agent)', 'Bob'])
    expect(Object.values(welcomeOf(bob).tabs)).toEqual(['user-1', 'Claude (agent)'])
    for (const tab of [ann, claude, bob]) tab.close()
  })

  it('joins as a new tab a resume by another member, holding a tab id and its secret (I12)', async () => {
    const { url } = await started()
    const design = await storeSaved()
    const ann = await joined(url, design)
    const { syncId, tabId, secret } = welcomeOf(ann)
    ann.close()
    const bob = await openTab(url, design)
    bob.hello(tokenFor(design, { userId: BOB.userId }), { syncId, tabId, seq: 0, secret })
    const welcome = await bob.next('welcome')
    expect(welcome.tabId).not.toBe(tabId)
    expect(welcome.secret).not.toBe(secret)
    bob.close()
  })
})
