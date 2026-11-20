// The sync server's limits on a connection (D10, D11) over real sockets: the message rate, a member's
// connections, what a tab may send before its hello and its welcome, the size and nesting of a
// message, a socket that stops reading or answering, and the pings that keep an idle tab connected.
import { afterAll, describe, expect, it } from 'vitest'

import { type Change, SYNC_CLOSE } from '@dazbee/schema'

import { LIMITS, type Limits } from './limits.ts'
import { BOB, changes, rename, storeSaved } from './test-saves.ts'
import { closeDatabase, pause, tokenFor, until } from './test-sync.ts'
import { openTab, startServer, type TestTab, typesOf } from './test-tab.ts'

const servers: { destroy(): Promise<void> }[] = []
afterAll(async () => {
  await Promise.all(servers.map((s) => s.destroy()))
  await closeDatabase()
})

async function started(limits: Partial<Limits> = {}, more: Parameters<typeof startServer>[0] = {}) {
  const run = await startServer({ limits: { ...LIMITS, idleMs: 0, ...limits }, ...more })
  servers.push(run.server)
  return run
}

async function joined(url: string, designId: string, token = tokenFor(designId)) {
  const tab = await openTab(url, designId)
  tab.hello(token)
  await tab.next('welcome')
  return tab
}

async function answers(tab: TestTab) {
  const from = tab.heard.length
  tab.send({ type: 'ping' })
  await tab.next('pong', from)
  return tab.closed === undefined
}

/** A change set renaming `l0` to a name of about `bytes` bytes. */
const sized = (id: number, base: number, bytes: number) => changes(id, base, [rename('l0', 'n'.repeat(bytes))])

describe('limits', () => {
  it('closes only the socket that sends past its rate', async () => {
    const { url } = await started({ messagesPerSecond: 10, messageBurst: 20 })
    const design = await storeSaved()
    const fast = await joined(url, design)
    const calm = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    for (let n = 0; n < 40; n++) fast.send({ type: 'ping' })
    expect(await fast.whenClosed()).toBe(SYNC_CLOSE.tooManyMessages)
    expect(await answers(calm)).toBe(true)
    calm.close()
  })

  it('applies no change set past the rate: the socket closes before it', async () => {
    const { url, server } = await started({ messagesPerSecond: 1, messageBurst: 3 })
    const design = await storeSaved()
    const calm = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    const fast = await joined(url, design)
    // The hello took one message of the burst: two change sets fit, and the third is past it.
    fast.send(changes(1, 0, [rename('l0', 'One')]))
    fast.send(changes(2, 0, [rename('l1', 'Two')]))
    fast.send(changes(3, 0, [rename('l0', 'Three')]))
    expect(await fast.whenClosed()).toBe(SYNC_CLOSE.tooManyMessages)
    await server.designs.settled()
    const nodes = (server.designs.host(design)?.server()?.state().toRecords().nodes ?? {}) as Record<
      string,
      { name: string }
    >
    expect([nodes.l0?.name, nodes.l1?.name]).toEqual(['One', 'Two'])
    calm.close()
  })

  it("holds a member to so many open connections to a design, freeing one's place once it closes", async () => {
    const { url } = await started({ connectionsPerMember: 2 })
    const design = await storeSaved()
    const first = await joined(url, design)
    const second = await joined(url, design)
    const third = await openTab(url, design)
    third.hello(tokenFor(design))
    expect(await third.whenClosed()).toBe(SYNC_CLOSE.tooManyConnections)
    // Another member counts on their own.
    const bob = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    first.close()
    await first.whenClosed()
    await pause(50)
    const again = await joined(url, design)
    expect(typesOf(again)).toContain('welcome')
    for (const tab of [second, bob, again]) tab.close()
  })

  it('counts a member’s agent tabs apart from the member’s own, so agents never use up the person’s', async () => {
    const { url } = await started({ connectionsPerMember: 1, connectionsPerMinute: 2 })
    const design = await storeSaved()
    const claude = await joined(url, design, tokenFor(design, { agent: 'Claude (agent)' }))
    const second = await openTab(url, design)
    second.hello(tokenFor(design, { agent: 'Codex (agent)' }))
    expect(await second.whenClosed()).toBe(SYNC_CLOSE.tooManyConnections)
    const third = await openTab(url, design)
    third.hello(tokenFor(design, { agent: 'Claude (agent)' }))
    expect(await third.whenClosed()).toBe(SYNC_CLOSE.tooManyMessages)

    const ann = await joined(url, design)
    expect(typesOf(ann)).toContain('welcome')
    for (const tab of [claude, ann]) tab.close()
  })

  it('holds a member to so many new connections to a design a minute', async () => {
    const { url } = await started({ connectionsPerMinute: 3 })
    const design = await storeSaved()
    for (let n = 0; n < 3; n++) (await joined(url, design)).close()
    const fourth = await openTab(url, design)
    fourth.hello(tokenFor(design))
    expect(await fourth.whenClosed()).toBe(SYNC_CLOSE.tooManyMessages)
  })

  it('rejects a change set past the message limit with its reason, and the connection stays', async () => {
    const { url } = await started({}, { host: { limits: { messageBytes: 2_000 } } })
    const design = await storeSaved()
    const tab = await joined(url, design)
    tab.send(sized(1, 0, 3_000))
    expect(await tab.next('reject')).toMatchObject({ changeSetId: 1, reason: 'tooManyChanges' })
    expect(await answers(tab)).toBe(true)
    tab.close()
  })

  it('closes with 1009 a frame past the message limit and the room around it', async () => {
    const { url } = await started({}, { host: { limits: { messageBytes: 2_000 } } })
    const design = await storeSaved()
    const tab = await joined(url, design)
    tab.send(sized(1, 0, 70 * 1024))
    expect(await tab.whenClosed()).toBe(1009)
  })

  it('closes a message nested past the limit, and a binary frame, with protocol', async () => {
    const { url } = await started()
    const design = await storeSaved()
    let deep: unknown = 1
    for (let n = 0; n < 12; n++) deep = [deep]
    const nested = await joined(url, design)
    nested.send(changes(1, 0, [{ op: 'set', value: { part: 'layer', id: 'l0', key: 'name' }, to: deep } as Change]))
    expect(await nested.whenClosed()).toBe(SYNC_CLOSE.protocol)
    const binary = await joined(url, design)
    binary.socket.send(Buffer.from(JSON.stringify({ type: 'ping' })), { binary: true })
    expect(await binary.whenClosed()).toBe(SYNC_CLOSE.protocol)
  })

  it('closes a hello past the stateless limit unread, and a tab that sends too much before its welcome', async () => {
    const { url } = await started({ statelessBytes: 1_000, authenticatingBytes: 3_000 })
    const design = await storeSaved()
    const large = await openTab(url, design)
    large.send({ type: 'hello', protocol: 1, token: 'n'.repeat(2_000), waiting: 0 })
    expect(await large.whenClosed()).toBe(SYNC_CLOSE.protocol)
    const eager = await openTab(url, design)
    // Sent at once with the hello: the welcome waits on loading the design.
    eager.hello(tokenFor(design))
    for (let n = 1; n <= 4; n++) eager.send(sized(n, 0, 1_000))
    expect(await eager.whenClosed()).toBe(SYNC_CLOSE.tooManyMessages)
  })

  it('ends a socket that stops reading once more than so much waits for it', async () => {
    const { url, lines } = await started({ unsentBytes: 1024 * 1024 })
    const design = await storeSaved()
    const stalled = await joined(url, design)
    const writer = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    // The stalled tab's socket stops reading: what the server sends it piles up.
    ;(stalled.socket as unknown as { _socket: { pause(): void } })._socket.pause()
    // More than the network's own buffers hold, so the server's fills; the writer reads as it goes.
    const stopped = () => lines.some((line) => line.includes('ended: it stopped reading'))
    for (let n = 1; n <= 1_000 && !stopped(); n += 10) {
      for (let k = n; k < n + 10; k++) writer.send(sized(k, 0, 30_000))
      await until(() => typesOf(writer).filter((t) => t === 'accepted').length >= n + 9)
    }
    expect(stopped()).toBe(true)
    expect(await answers(writer)).toBe(true)
    writer.close()
  }, 30_000)

  it('keeps a tab that reads slowly, which can answer a ping only once it has read what came before', async () => {
    const { url, lines } = await started({}, { pingEveryMs: 300 })
    const design = await storeSaved()
    const slow = await joined(url, design)
    const writer = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    const paused = (slow.socket as unknown as { _socket: { pause(): void; resume(): void } })._socket
    // The slow tab reads nothing for 2 s, while the server keeps sending it more: longer than two
    // pings, shorter than the most a tab may stay silent.
    paused.pause()
    for (let n = 1; n <= 20; n++) {
      writer.send(sized(n, n - 1, 50_000))
      await pause(100)
    }
    paused.resume()
    expect(await until(() => slow.heard.filter((m) => m.type === 'accepted').length === 20)).toBe(true)
    expect(slow.closed).toBeUndefined()
    expect(lines.some((line) => line.includes('said nothing'))).toBe(false)
    for (const tab of [slow, writer]) tab.close()
  })

  it('ends a tab that answers no ping for too long, though the server keeps sending to it', async () => {
    const { url, lines } = await started({}, { pingEveryMs: 100 })
    const design = await storeSaved()
    const deaf = await openTab(url, design, { autoPong: false })
    deaf.hello(tokenFor(design))
    await deaf.next('welcome')
    const writer = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    for (let n = 1; n <= 40 && deaf.closed === undefined; n++) {
      writer.send(sized(n, n - 1, 10))
      await pause(50)
    }
    expect(await deaf.whenClosed()).toBe(1006)
    expect(lines.some((line) => line.includes('said nothing for too long'))).toBe(true)
    writer.close()
  })

  it('keeps an idle tab connected through its pings, and ends one that answers none', async () => {
    const { url, lines } = await started({}, { pingEveryMs: 100 })
    const design = await storeSaved()
    const idle = await joined(url, design)
    const deaf = await openTab(url, design, { autoPong: false })
    deaf.hello(tokenFor(design, { userId: BOB.userId }))
    await deaf.next('welcome')
    await pause(600)
    expect(idle.closed).toBeUndefined()
    expect(await deaf.whenClosed()).toBe(1006)
    expect(lines.some((line) => line.includes('said nothing for two pings'))).toBe(true)
    idle.close()
  })
})
