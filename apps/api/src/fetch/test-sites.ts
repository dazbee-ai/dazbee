// Outside websites for the safe fetch's tests: one local HTTP server stands in for every https site, each
// hostname resolves to the addresses a test gives it, and the transport takes each connection the safe fetch
// makes to an address it checked to the local server instead, noting the address.
import type { LookupAddress } from 'node:dns'
import {
  createServer,
  type IncomingMessage,
  request as httpRequest,
  type RequestOptions,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { isIP } from 'node:net'

import type { LookupCallback, SafeFetchSettings } from './safe-fetch.ts'

/** What answers a request to a site: the stand-in's request and response. */
export type TestHandler = (request: IncomingMessage, response: ServerResponse) => void

/** A request a site was sent: its host, path and headers. */
export interface TestVisit {
  host: string
  path: string
  headers: IncomingMessage['headers']
}

/** The stand-in sites, and what the safe fetch did with them. */
export interface TestSites {
  /** The safe fetch's settings that reach these sites. */
  settings: SafeFetchSettings
  /** Answers `path` on `host` with `handler`. */
  serve(host: string, path: string, handler: TestHandler): void
  /**
   * Resolves `host` to each list of addresses in turn, one list a lookup, the last one from then on. Every
   * address is IPv4 or IPv6.
   */
  resolveTo(host: string, ...answers: string[][]): void
  /** The addresses the transport was asked to connect to, in order. */
  connected: string[]
  /** How many times each host was looked up. */
  lookups: Map<string, number>
  /** The requests the sites were sent, in order. */
  visits: TestVisit[]
  /** How many connections to the sites are open now. */
  openConnections(): number
  close(): Promise<void>
}

/** Node's `lookup` option of a connection. */
type Lookup = (host: string, options: object, callback: LookupCallback) => void

/** A public address the tests resolve hosts to: a real one, never connected to. */
export const PUBLIC_ADDRESS = '93.184.215.14'

/** Starts the stand-in sites. */
export async function testSites(): Promise<TestSites> {
  const handlers = new Map<string, TestHandler>()
  const answers = new Map<string, string[][]>()
  const connected: string[] = []
  const lookups = new Map<string, number>()
  const visits: TestVisit[] = []
  const server = createServer((request, response) => {
    const host = (request.headers.host ?? '').replace(/:\d+$/, '')
    const path = request.url ?? '/'
    visits.push({ host, path, headers: request.headers })
    const handler = handlers.get(`${host}${path}`)
    if (handler) handler(request, response)
    else response.writeHead(404).end('not found')
  })
  let open = 0
  server.on('connection', (socket) => {
    open++
    socket.on('close', () => open--)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo

  const resolve = (host: string): Promise<LookupAddress[]> => {
    const count = (lookups.get(host) ?? 0) + 1
    lookups.set(host, count)
    const lists = answers.get(host)
    const list = lists?.[Math.min(count, lists.length) - 1]
    if (!list) return Promise.reject(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }))
    return Promise.resolve(list.map((address) => ({ address, family: isIP(address) })))
  }

  const settings: SafeFetchSettings = {
    resolve,
    request: (options, onResponse) => {
      const given = options.lookup as Lookup | undefined
      // Without the safe fetch's own lookup, the connection would go wherever the host resolves now, unchecked.
      const lookup: Lookup = given ?? ((host, _options, callback) => void resolve(host).then((a) => callback(null, a)))
      const hostname = String(options.hostname ?? '')
      const literal = isIP(hostname) !== 0
      if (literal) connected.push(hostname)
      return httpRequest(
        {
          ...options,
          ...(literal ? { hostname: '127.0.0.1', headers: { ...options.headers, host: hostname } } : {}),
          port,
          lookup: ((host: string, lookupOptions: object, callback: LookupCallback) =>
            lookup(host, { ...lookupOptions, all: true }, (error, addresses) => {
              if (error) return callback(error)
              const list = Array.isArray(addresses) ? addresses : []
              connected.push(...list.map(({ address }) => address))
              const local = [{ address: '127.0.0.1', family: 4 }]
              return (lookupOptions as { all?: boolean }).all ? callback(null, local) : callback(null, '127.0.0.1', 4)
            })) as RequestOptions['lookup'],
        },
        onResponse,
      )
    },
  }

  return {
    settings,
    serve: (host, path, handler) => void handlers.set(`${host}${path}`, handler),
    resolveTo: (host, ...lists) => void answers.set(host, lists),
    connected,
    lookups,
    visits,
    openConnections: () => open,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}
