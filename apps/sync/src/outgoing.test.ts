// What the sync server sends a tab: a whole-design welcome written once per sequence number, in a turn
// of its own; a message past 1 MiB gzipped; and one tab's data kept in order (D10, D8).
import { gunzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import type { DesignRecords, ServerMessage } from '@dazbee/schema'

import { type Data, encode, GZIP_BYTES, inOrder, type WelcomeCache } from './outgoing.ts'
import { turns } from './turns.ts'

const design = (name = 'Stored', padding = 0): DesignRecords => ({
  meta: { designId: 'd', name, padding: 'x'.repeat(padding) },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {},
  nodes: {},
})

function welcome(seq: number, records: DesignRecords, tabId = 1, syncId = 's1'): ServerMessage {
  return {
    type: 'welcome',
    syncId,
    tabId,
    seq,
    secret: `secret${tabId}`,
    access: 'edit',
    size: { layers: 0, frames: 0, pages: 1, sections: 0, connectors: 0, bytes: 10 },
    tabs: {},
    processed: { lastChangeSet: 0, rejected: [] },
    catchUp: { design: records },
  }
}

const read = (data: Data) => JSON.parse(typeof data === 'string' ? data : gunzipSync(data).toString('utf8')) as unknown

describe('encode', () => {
  it('writes a whole-design welcome as the message, its design written once per sequence number', async () => {
    const cache: WelcomeCache = {}
    let turnsTaken = 0
    const turn = () => {
      turnsTaken++
      return Promise.resolve()
    }
    const first = welcome(3, design())
    expect(read(await encode(first, cache, turn))).toEqual(first)
    // A second tab at the same sequence number: the cached JSON, no turn.
    const second = welcome(3, design('changed in memory only'), 2)
    expect(read(await encode(second, cache, turn))).toEqual({ ...second, catchUp: { design: design() } })
    expect(turnsTaken).toBe(1)
    // A later sequence number, or another sync id, writes it afresh.
    const later = welcome(4, design('Later'))
    expect(read(await encode(later, cache, turn))).toEqual(later)
    const reopened = welcome(4, design('After a drop'), 1, 's2')
    expect(read(await encode(reopened, cache, turn))).toEqual(reopened)
    expect(turnsTaken).toBe(3)
  })

  it('sends any other message as its JSON, at once', () => {
    const message: ServerMessage = { type: 'pong' }
    expect(encode(message, {}, () => Promise.reject(new Error('no turn')))).toBe('{"type":"pong"}')
  })

  it('gzips a message past 1 MiB, off the event loop', async () => {
    const big = welcome(1, design('Big', GZIP_BYTES))
    const data = encode(big, {}, () => Promise.resolve())
    expect(data).toBeInstanceOf(Promise)
    const sent = await data
    expect(sent).toBeInstanceOf(Uint8Array)
    expect((sent as Uint8Array).byteLength).toBeLessThan(GZIP_BYTES / 10)
    expect(read(sent)).toEqual(big)
  })

  it('writes a version a tab asked for in a turn, its stored text unparsed, gzipped past 1 MiB', async () => {
    let turnsTaken = 0
    const turn = () => {
      turnsTaken++
      return Promise.resolve()
    }
    const json = JSON.stringify(design('Kept'))
    const small = encode({ type: 'storedVersion', id: 'v1', stored: { json, schemaVersion: 6 } }, {}, turn)
    expect(small).toBeInstanceOf(Promise)
    expect(await small).toBe(`{"type":"version","id":"v1","schemaVersion":6,"design":${json}}`)
    expect(turnsTaken).toBe(1)

    const bigJson = JSON.stringify(design('Big', GZIP_BYTES))
    const big = await encode({ type: 'storedVersion', id: 'v2', stored: { json: bigJson, schemaVersion: 6 } }, {}, turn)
    expect(big).toBeInstanceOf(Uint8Array)
    expect(read(big)).toEqual({ type: 'version', id: 'v2', schemaVersion: 6, design: design('Big', GZIP_BYTES) })
    expect(read(await encode({ type: 'storedVersion', id: 'gone', stored: null }, {}, turn))).toEqual({
      type: 'version',
      id: 'gone',
      schemaVersion: null,
      design: null,
    })
  })

  it('writes the design JSON of two designs in different turns', async () => {
    const order: string[] = []
    /** A design whose JSON notes when it is written: the first also asks for a mark in the next turn. */
    const noted = (name: string): DesignRecords => ({
      ...design(name),
      meta: {
        toJSON: () => {
          order.push(name)
          if (name === 'A') setImmediate(() => order.push('between'))
          return { designId: 'd', name }
        },
      },
    })
    const turn = turns()
    await Promise.all([encode(welcome(1, noted('A')), {}, turn), encode(welcome(1, noted('B')), {}, turn)])
    expect(order).toEqual(['A', 'between', 'B'])
  })
})

describe('inOrder', () => {
  it('sends data in the order it was made, data being made holding what follows', async () => {
    const sent: Data[] = []
    const send = inOrder(
      (data) => sent.push(data),
      () => {},
    )
    let finish: (data: Data) => void = () => {}
    send('first')
    send(new Promise<Data>((resolve) => (finish = resolve)))
    send('third')
    expect(sent).toEqual(['first'])
    finish('second')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toEqual(['first', 'second', 'third'])
    send('fourth')
    expect(sent.at(-1)).toBe('fourth')
  })
})
