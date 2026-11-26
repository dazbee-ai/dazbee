// A fake fetch for the adapters' tests: answers each URL from the first route whose pattern it holds, and
// keeps what it was sent. The SDK's probe of fetch with a data: URL is answered and not kept. Imported by
// tests only.
import { readFileSync } from 'node:fs'

import { expect } from 'vitest'

import { type CallInput, type CallKind, referenceCount, type Usage } from '@dazbee/schema'

import type { Tier } from './tiers.ts'
import { declaredUnits } from './units.ts'

/** One answer: a status and a body, and the headers it adds. */
export interface FakeAnswer {
  status?: number
  body: string | Uint8Array
  headers?: Record<string, string>
}

/** A request the fake fetch was sent. */
export interface Sent {
  url: string
  method: string
  body: unknown
}

/** A recorded answer from `fixtures/`, as text. */
export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** The 16 × 16 test picture, as bytes. */
export const testPicture = () => new Uint8Array(Buffer.from(fixture('picture.png.b64').trim(), 'base64'))

/**
 * A fetch answering from `routes`, in order: a route's answers are given one per request to it, the last one
 * again once they run out.
 */
export function fakeFetch(routes: [pattern: string, ...answers: FakeAnswer[]][]) {
  const sent: Sent[] = []
  const counts = new Map<string, number>()
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    if (href.startsWith('data:')) return new Response('')
    sent.push({ url: href, method: init?.method ?? 'GET', body: init?.body })
    const route = routes.find(([pattern]) => href.includes(pattern))
    if (!route) return new Response('{"error":"no route"}', { status: 404 })
    const [pattern, ...answers] = route
    const n = counts.get(pattern) ?? 0
    counts.set(pattern, n + 1)
    const answer = answers[Math.min(n, answers.length - 1)] ?? { body: '' }
    return new Response(answer.body as ConstructorParameters<typeof Response>[0], {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json', ...answer.headers },
    })
  }) as typeof globalThis.fetch
  return { fetch, sent }
}

/** A request's references for `input`: `bytes` once for each reference a picture call sends, its marked copy counted. */
export function referencesOf(input: CallInput, bytes: () => Uint8Array | Promise<Uint8Array>) {
  return async () =>
    input.kind === 'picture' ? Promise.all(Array.from({ length: referenceCount(input) }, () => bytes())) : []
}

/** Checks that `usage` names only the units `seller` declares for `kind` calls of `sellerModel` that ask for `tier`. */
export function expectDeclared(
  seller: string,
  kind: CallKind,
  sellerModel: string,
  usage: Usage,
  tier: Tier = 'standard',
): void {
  const declared = declaredUnits(seller, kind, sellerModel, tier) ?? []
  expect(Object.keys(usage).filter((unit) => !declared.includes(unit as never))).toEqual([])
}
