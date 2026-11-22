// Fetches a file from an outside https link for the features that bring one in, so that no link reaches the
// server's own network: public addresses only, each connection made to the address that was checked, at most
// three redirects each checked again, a cap on the decoded bytes, a time limit, and no credentials.
import type { LookupAddress } from 'node:dns'
import { Resolver } from 'node:dns/promises'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

/**
 * A file fetched from a link: its bytes, the type its site said it is (which nothing trusts), and its link after
 * the redirects.
 */
export interface FetchedFile {
  bytes: Uint8Array
  contentType: string | null
  url: string
}

/** How many decoded bytes a fetch may read, and how long it may take, redirects and all. */
export interface SafeFetchLimits {
  maxBytes: number
  timeoutMs: number
}

/** What a fetch resolves hosts with and connects through: DNS queries and `node:https` unless given. */
export interface SafeFetchSettings {
  resolve?: (hostname: string) => Promise<LookupAddress[]>
  request?: (options: RequestOptions, onResponse: (response: IncomingMessage) => void) => ClientRequest
}

/** A lookup's answer: an error, or the address and its family, or every address when asked for all. */
export type LookupCallback = (error: Error | null, address?: string | LookupAddress[], family?: number) => void

/** A link that wasn't fetched, in a sentence a person or an agent can act on, with the status its site answered. */
export class FetchRefused extends Error {
  /** The site's answer that refused it, such as 403; null when no answer did. */
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.status = status
  }
}

/** `SafeFetchSettings` with nothing left out. */
type Reach = Required<SafeFetchSettings>

/** The most redirects one fetch follows. */
const MAX_REDIRECTS = 3
/** The statuses that redirect to their `location`. */
const REDIRECTS = new Set([301, 302, 303, 307, 308])
/** The body encodings read, each with the stream that decodes it. */
const DECODERS: Record<string, () => NodeJS.ReadWriteStream> = {
  gzip: createGunzip,
  'x-gzip': createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
}
/** What every request says it is, as some sites turn away a request that names nothing. */
const USER_AGENT = 'Dazbee (+https://dazbee.com)'
/** The error codes of a TLS connection whose certificate doesn't check. */
const TLS_ERROR = /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|HOSTNAME_MISMATCH)/
/** An encoding's name as a site may send it, which a refusal may repeat; anything else a site sends is never repeated. */
const ENCODING_NAME = /^[a-z0-9.+-]{1,40}$/
/**
 * The DNS that resolves hosts when no other is given: queries of their own, each given up after 3 seconds and tried
 * twice, so a slow name server never holds a thread the server needs for anything else.
 */
const DNS = new Resolver({ timeout: 3_000, tries: 2 })
/**
 * The IPv4 and IPv6 addresses that are not on the public internet, in two lists: a list checks an IPv4 address
 * as its IPv6 mapping too, which IPv6's ranges would hold.
 */
const NOT_PUBLIC = { 4: notPublic('ipv4'), 6: notPublic('ipv6') }

/** The ranges of `family` that aren't public: IANA's special-purpose ranges, and IPv6 outside global unicast. */
function notPublic(family: 'ipv4' | 'ipv6'): BlockList {
  const list = new BlockList()
  const ipv4: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]
  // Global unicast is 2000::/3; within it, the protocol, documentation and 6to4 ranges aren't one site's.
  const ipv6: [string, number][] = [
    ['::', 3],
    ['4000::', 2],
    ['8000::', 1],
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
  ]
  for (const [network, prefix] of family === 'ipv4' ? ipv4 : ipv6) list.addSubnet(network, prefix, family)
  return list
}

/**
 * The file at `link`, fetched with no cookies, token or `Authorization`. It throws `FetchRefused` with a sentence
 * for a link that isn't https or reaches an address that isn't public, a fourth redirect, a status other than
 * success, a body past `maxBytes` once decoded, and a fetch past `timeoutMs`.
 */
export async function safeFetch(
  link: string,
  { maxBytes, timeoutMs }: SafeFetchLimits,
  { resolve = resolveAll, request = httpsRequest }: SafeFetchSettings = {},
): Promise<FetchedFile> {
  let url = checkedLink(link)
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await get(url, signal, { resolve, request })
      const status = response.statusCode ?? 0
      if (REDIRECTS.has(status)) {
        response.destroy()
        if (redirects === MAX_REDIRECTS)
          throw new FetchRefused(
            `The link redirects more than ${MAX_REDIRECTS} times; give the link of the file itself`,
          )
        const { location } = response.headers
        if (!location) throw new FetchRefused(`${url.hostname} redirected without saying where; ask for another link`)
        url = checkedLink(location, url)
        continue
      }
      if (status < 200 || status > 299) {
        response.destroy()
        throw refusedStatus(url, status)
      }
      const bytes = await readBody(url, response, maxBytes, signal)
      return { bytes, contentType: response.headers['content-type'] ?? null, url: url.href }
    }
  } catch (error) {
    if (error instanceof FetchRefused) throw error
    if (signal.aborted)
      throw new FetchRefused(
        `${url.hostname} took more than ${timeoutMs / 1000} seconds to send the file; try again, or ask for another link`,
      )
    throw unreachable(url, error)
  }
}

/** The host to connect to: an IPv6 address without its brackets. */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '')
}

/** Every IPv4 and IPv6 address the DNS gives `hostname`; it throws when it gives none. */
async function resolveAll(hostname: string): Promise<LookupAddress[]> {
  const [four, six] = await Promise.allSettled([DNS.resolve4(hostname), DNS.resolve6(hostname)])
  const addresses = [
    ...(four.status === 'fulfilled' ? four.value.map((address) => ({ address, family: 4 })) : []),
    ...(six.status === 'fulfilled' ? six.value.map((address) => ({ address, family: 6 })) : []),
  ]
  if (addresses.length === 0) throw new Error(`no address for ${hostname}`)
  return addresses
}

/**
 * `link`, read against `base` when given, as a URL Dazbee may fetch: https, with no user name or password, on
 * the usual port, and not at an address that isn't public.
 */
function checkedLink(link: string, base?: URL): URL {
  let url: URL
  try {
    url = new URL(link, base)
  } catch {
    throw new FetchRefused('That is not a link')
  }
  if (url.protocol !== 'https:') throw new FetchRefused('Dazbee fetches only https links; give the https link')
  if (url.username || url.password) throw new FetchRefused('Dazbee fetches no link with a user name or password in it')
  if (url.port) throw new FetchRefused('Dazbee fetches https links only on their usual port (443)')
  const literal = hostOf(url)
  if (isIP(literal) && !isPublic(literal))
    throw new FetchRefused(
      `Dazbee fetches only from public websites, and ${url.hostname} is a private or local address`,
    )
  return url
}

/** Whether `address` is on the public internet. */
function isPublic(address: string): boolean {
  const family = isIP(address)
  if (family !== 4 && family !== 6) return false
  try {
    return !NOT_PUBLIC[family].check(address, family === 4 ? 'ipv4' : 'ipv6')
  } catch {
    return false
  }
}

/**
 * The response to a GET of `url`, sent with no credentials on a connection of its own, made to an address of its
 * host only once every address is checked.
 */
function get(url: URL, signal: AbortSignal, { resolve, request }: Reach): Promise<IncomingMessage> {
  return new Promise((done, fail) => {
    const sent = request(
      {
        method: 'GET',
        hostname: hostOf(url),
        port: 443,
        path: `${url.pathname}${url.search}`,
        headers: { accept: '*/*', 'accept-encoding': Object.keys(DECODERS).join(', '), 'user-agent': USER_AGENT },
        agent: false,
        lookup: checkedLookup(url, resolve),
        signal,
      },
      done,
    )
    sent.on('error', fail)
    sent.end()
  })
}

/**
 * A connection's lookup that resolves the host, refuses it unless every address is public, and hands back the
 * addresses it checked, so the connection goes to one of them whatever the DNS answers next. A host with no
 * address and one at a private address are refused alike, so the refusal tells nothing of the server's network.
 */
function checkedLookup(url: URL, resolve: Reach['resolve']): RequestOptions['lookup'] {
  const noPublicSite = () =>
    new FetchRefused(`Dazbee found no public website at ${url.hostname}; check the link, or ask the person for another`)
  return ((hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    resolve(hostname).then(
      (addresses) => {
        const [first] = addresses
        if (!first || !addresses.every(({ address }) => isPublic(address))) return callback(noPublicSite())
        return options.all ? callback(null, addresses) : callback(null, first.address, first.family)
      },
      () => callback(noPublicSite()),
    )
  }) as RequestOptions['lookup']
}

/** The refusal of an answer that is neither the file nor a redirect, by its status. */
function refusedStatus(url: URL, status: number): FetchRefused {
  return new FetchRefused(statusSentence(url.hostname, status), status)
}

/** What a refusal by its status tells. */
function statusSentence(host: string, status: number): string {
  if (status === 401 || status === 403 || status === 451)
    return `${host} refused to give Dazbee this file (${status}): it may need a sign-in or turn servers away; ask the person for another link, or for the file itself`
  if (status === 404 || status === 410) return `Nothing is at that link on ${host} (${status}); check the link`
  if (status === 429) return `${host} is turning requests away for now (429); try again later, or ask for another link`
  if (status >= 500) return `${host} failed to answer (${status}); try again in a moment, or ask for another link`
  return `${host} answered ${status} instead of the file; ask for another link`
}

/**
 * The response's body, decoded, ending the fetch once more than `maxBytes` arrive, as sent or decoded, so a
 * small compressed body can't grow past it.
 */
async function readBody(url: URL, response: IncomingMessage, maxBytes: number, signal: AbortSignal) {
  const tooBig = () =>
    new FetchRefused(
      `The file at that link is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, the most Dazbee takes; ask for a smaller one`,
    )
  if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
    response.destroy()
    throw tooBig()
  }
  const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase()
  const decoder = encoding === 'identity' ? null : DECODERS[encoding]
  if (decoder === undefined) {
    response.destroy()
    const named = ENCODING_NAME.test(encoding) ? ` (${encoding})` : ''
    throw new FetchRefused(
      `${url.hostname} sent the file in an encoding Dazbee can’t read${named}; ask for another link`,
    )
  }
  let sent = 0
  response.on('data', (chunk: Buffer) => {
    sent += chunk.length
    if (sent > maxBytes) response.destroy()
  })
  const body: Readable = decoder ? (response.pipe(decoder()) as unknown as Readable) : response
  const end = () => body.destroy()
  response.on('error', end)
  response.on('close', () => {
    if (!response.complete) body.destroy(new Error('the body ended early'))
  })
  signal.addEventListener('abort', end)
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      size += chunk.length
      if (size > maxBytes) throw tooBig()
      chunks.push(chunk)
    }
  } catch (error) {
    if (error instanceof FetchRefused || signal.aborted) throw error
    if (sent > maxBytes) throw tooBig()
    throw new FetchRefused(`${url.hostname} sent a file that could not be read; try again, or ask for another link`)
  } finally {
    signal.removeEventListener('abort', end)
    response.destroy()
    body.destroy()
  }
  if (sent > maxBytes) throw tooBig()
  const joined = Buffer.concat(chunks, size)
  // A view of the joined chunks, not a copy of them.
  return new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength)
}

/** The refusal of a site the connection to failed. */
function unreachable(url: URL, error: unknown): FetchRefused {
  const code = error instanceof Error && 'code' in error ? String(error.code) : ''
  if (TLS_ERROR.test(code))
    return new FetchRefused(`${url.hostname}’s secure connection could not be checked (${code}); ask for another link`)
  return new FetchRefused(`${url.hostname} could not be reached; try again in a moment, or ask for another link`)
}
