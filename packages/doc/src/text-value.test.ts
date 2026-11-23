import { describe, expect, it } from 'vitest'

import { type RunStyle, withRunStyle } from '@dazbee/schema'

import { seeded } from './test-walk.ts'
import { applyTextOp, matchesIn, replaceOps, replaceRangeOps, type TextOp, type TextValue } from './text-value.ts'

/** What random texts are made of: letters, a space, an accented letter and emoji of two UTF-16 units. */
const PIECES = ['a', 'b', 'c', ' ', 'é', '😀', '👍🏽']
/** The values each style key is set to, one of them an object. */
const STYLES: { [K in keyof RunStyle]-?: RunStyle[K][] } = {
  fontFamily: ['Noto Sans', 'Inter'],
  fontWeight: [400, 700],
  fontStyle: ['normal', 'italic'],
  fontSize: [12, 20],
  color: ['#FF0000FF', '#00FF00FF'],
  letterSpacing: [
    { unit: 'px', value: 2 },
    { unit: 'percent', value: 5 },
  ],
  lineHeight: [1, 1.5],
  underline: [true, false],
  strikethrough: [true, false],
  textCase: ['none', 'upper'],
  outline: [
    { width: 1, color: '#000000FF' },
    { width: 2, color: '#000000FF' },
  ],
  features: [{ liga: false }, { tnum: true, liga: true }],
  gradient: [
    {
      type: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      stops: [
        { offset: 0, color: '#FF0000FF' },
        { offset: 1, color: '#0000FFFF' },
      ],
    },
    {
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      radius: 0.5,
      stops: [
        { offset: 0, color: '#FFFFFFFF' },
        { offset: 1, color: '#000000FF' },
      ],
    },
  ],
  turn: [-15, 30],
  raise: [30, -20],
}

/** One UTF-16 unit of a text and the style it has: the reference the walk checks `applyTextOp` against. */
interface Unit {
  unit: string
  style: RunStyle
}

/** A text and its runs as one unit each, with each unit's own style. */
function unitsOf({ text, runs }: TextValue): Unit[] {
  return [...Array(text.length).keys()].map((n) => ({
    unit: text.charAt(n),
    style: Object.assign({}, ...runs.filter((run) => run.start <= n && n < run.end).map((run) => run.style)),
  }))
}

/** A value with every object's keys sorted, at any depth, so two styles that hold the same compare equal as JSON. */
const sorted = (value: unknown): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => [key, sorted(v)]),
      )
    : Array.isArray(value)
      ? value.map(sorted)
      : value

/** The units as a text, and its runs: neighbours with the same style joined, unstyled units in none. */
function valueOf(units: readonly Unit[]): TextValue {
  const runs: TextValue['runs'] = []
  units.forEach(({ style }, n) => {
    if (Object.keys(style).length === 0) return
    const last = runs.at(-1)
    if (last && last.end === n && JSON.stringify(sorted(last.style)) === JSON.stringify(sorted(style))) last.end = n + 1
    else runs.push({ start: n, end: n + 1, style })
  })
  return { text: units.map(({ unit }) => unit).join(''), runs }
}

const high = (unit: string | undefined) => unit !== undefined && /[\uD800-\uDBFF]/.test(unit)
const low = (unit: string | undefined) => unit !== undefined && /[\uDC00-\uDFFF]/.test(unit)

/** The edit on units, one at a time: what `applyTextOp` says it does, written the simplest way. */
function modelOp(value: TextValue, op: TextOp): TextValue {
  const units = unitsOf(value)
  const at = Math.min(op.at, units.length)
  const end = op.kind === 'insert' ? at : Math.min(at + op.length, units.length)
  // An offset inside a surrogate pair turns both halves into U+FFFD, keeping their style.
  for (const cut of new Set([at, end])) {
    const [before, after] = [units[cut - 1], units[cut]]
    if (before && after && high(before.unit) && low(after.unit)) before.unit = after.unit = '\uFFFD'
  }
  if (op.kind === 'insert') {
    const style = at > 0 ? (units[at - 1] as Unit).style : {}
    units.splice(
      at,
      0,
      ...[...op.text].flatMap((ch) =>
        [...Array(ch.length).keys()].map((k) => ({ unit: ch.charAt(k), style: { ...style } })),
      ),
    )
  } else if (op.kind === 'delete') units.splice(at, end - at)
  else for (let n = at; n < end; n++) (units[n] as Unit).style = withRunStyle((units[n] as Unit).style, op.style)
  return valueOf(units)
}

/**
 * A random edit `text.edit` takes on a text of `length` units: any offset and range within the
 * text, its ends and the middles of emoji included.
 */
function randomOp(random: () => number, length: number): TextOp {
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)] as T
  const offset = (most: number) => {
    const roll = random()
    if (roll < 0.15) return 0
    if (roll < 0.3) return most
    return Math.floor(random() * (most + 1))
  }
  const kinds =
    length > 60
      ? (['insert', 'delete', 'delete', 'style'] as const)
      : (['insert', 'insert', 'delete', 'style', 'style'] as const)
  const kind = length === 0 ? 'insert' : pick(kinds)
  if (kind === 'insert') {
    const text = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(PIECES)).join('')
    return { kind, at: offset(length), text }
  }
  const at = offset(length - 1)
  const span = 1 + Math.floor(random() * Math.min(length - at, 6))
  if (kind === 'delete') return { kind, at, length: span }
  const keys = Object.keys(STYLES) as (keyof RunStyle)[]
  const style = Object.fromEntries(
    Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
      const key = pick(keys)
      return [key, pick(STYLES[key] as unknown[])]
    }),
  ) as RunStyle
  return { kind, at, length: span, style }
}

describe('applyTextOp', () => {
  it('inserts a text of millions of characters, as a paste can, without running out of stack', () => {
    const big = 'x'.repeat(1_000_000)
    const value = applyTextOp(
      { text: 'Hi', runs: [{ start: 0, end: 2, style: { color: '#FF0000FF' } }] },
      { kind: 'insert', at: 2, text: big },
    )
    expect(value.text.length).toBe(big.length + 2)
    expect(value.runs).toEqual([{ start: 0, end: big.length + 2, style: { color: '#FF0000FF' } }])
  })

  it('sets the features a style gives tag by tag over each character’s own', () => {
    const value = { text: 'Sale', runs: [{ start: 0, end: 4, style: { features: { liga: false } } }] }
    expect(applyTextOp(value, { kind: 'style', at: 0, length: 2, style: { features: { tnum: true } } }).runs).toEqual([
      { start: 0, end: 2, style: { features: { liga: false, tnum: true } } },
      { start: 2, end: 4, style: { features: { liga: false } } },
    ])
  })

  it('takes a gradient off the characters a colour is styled over, so the colour shows', () => {
    const gradient = STYLES.gradient[0] as NonNullable<RunStyle['gradient']>
    const value = { text: 'Sale', runs: [{ start: 0, end: 4, style: { gradient, fontWeight: 700 } }] }
    expect(applyTextOp(value, { kind: 'style', at: 0, length: 2, style: { color: '#00FF00FF' } }).runs).toEqual([
      { start: 0, end: 2, style: { fontWeight: 700, color: '#00FF00FF' } },
      { start: 2, end: 4, style: { gradient, fontWeight: 700 } },
    ])
  })

  it('inserts with the style of the character before, deletes, and styles over what each character has', () => {
    const bold = { fontWeight: 700 }
    const value = { text: 'Summer sale', runs: [{ start: 0, end: 6, style: bold }] }
    expect(applyTextOp(value, { kind: 'insert', at: 6, text: '!' })).toEqual({
      text: 'Summer! sale',
      runs: [{ start: 0, end: 7, style: bold }],
    })
    expect(applyTextOp(value, { kind: 'insert', at: 0, text: '>' }).runs).toEqual([{ start: 1, end: 7, style: bold }])
    expect(applyTextOp(value, { kind: 'delete', at: 4, length: 4 })).toEqual({
      text: 'Summale',
      runs: [{ start: 0, end: 4, style: bold }],
    })
    expect(applyTextOp(value, { kind: 'style', at: 3, length: 5, style: { color: '#FF0000FF' } }).runs).toEqual([
      { start: 0, end: 3, style: bold },
      { start: 3, end: 6, style: { ...bold, color: '#FF0000FF' } },
      { start: 6, end: 8, style: { color: '#FF0000FF' } },
    ])
  })

  it('joins neighbours a style makes equal into one run', () => {
    const value = {
      text: 'abc',
      runs: [
        { start: 0, end: 1, style: { fontWeight: 700 } },
        { start: 2, end: 3, style: { fontWeight: 700 } },
      ],
    }
    expect(applyTextOp(value, { kind: 'style', at: 1, length: 1, style: { fontWeight: 700 } }).runs).toEqual([
      { start: 0, end: 3, style: { fontWeight: 700 } },
    ])
  })

  it('turns an emoji an edit cuts in two into two replacement characters', () => {
    const value = { text: 'a😀b', runs: [] }
    expect(applyTextOp(value, { kind: 'insert', at: 2, text: 'x' }).text).toBe('a\uFFFDx\uFFFDb')
    expect(applyTextOp(value, { kind: 'delete', at: 0, length: 2 }).text).toBe('\uFFFDb')
    expect(applyTextOp(value, { kind: 'style', at: 2, length: 2, style: { fontWeight: 700 } })).toEqual({
      text: 'a\uFFFD\uFFFDb',
      runs: [{ start: 2, end: 4, style: { fontWeight: 700 } }],
    })
  })

  it('stops an offset or a range past the end at the end', () => {
    const value = { text: 'ab', runs: [{ start: 0, end: 2, style: { fontWeight: 700 } }] }
    expect(applyTextOp(value, { kind: 'insert', at: 5, text: 'c' })).toEqual({
      text: 'abc',
      runs: [{ start: 0, end: 3, style: { fontWeight: 700 } }],
    })
    expect(applyTextOp(value, { kind: 'delete', at: 1, length: 4 }).text).toBe('a')
    expect(applyTextOp(value, { kind: 'style', at: 1, length: 4, style: { color: '#FF0000FF' } })).toEqual({
      text: 'ab',
      runs: [
        { start: 0, end: 1, style: { fontWeight: 700 } },
        { start: 1, end: 2, style: { fontWeight: 700, color: '#FF0000FF' } },
      ],
    })
  })

  /** Seeds of walks with one edit at a time, as commands write them, and with four, as a batch does. */
  const walks = [...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => [seed, 1]), ...[11, 12, 13, 14].map((seed) => [seed, 4])]

  it.each(walks)(
    'gives what the edit says, one unit at a time, edit after edit, in 1000 edits (seed %i, %i at once)',
    (seed, each) => {
      const random = seeded(seed)
      let value: TextValue = { text: 'Summer sale', runs: [{ start: 0, end: 6, style: { fontWeight: 800 } }] }
      let model = value
      for (let step = 0; step < 1000 / each; step++) {
        const ops: TextOp[] = []
        for (let k = 0; k < each; k++) {
          const op = randomOp(random, value.text.length)
          ops.push(op)
          value = applyTextOp(value, op)
          model = modelOp(model, op)
        }
        expect(value, `step ${step}: ${JSON.stringify(ops)}`).toEqual(model)
      }
    },
  )
})

describe('matchesIn', () => {
  it('finds where each match starts, whatever its case, one after another without overlapping', () => {
    expect(matchesIn('Sale, sale, SALE!', 'sale')).toEqual([0, 6, 12])
    expect(matchesIn('aaaa', 'aa')).toEqual([0, 2])
    expect(matchesIn('Summer', 'winter')).toEqual([])
    expect(matchesIn('anything', '')).toEqual([])
  })

  it('never starts or ends a match inside a character written as two UTF-16 units', () => {
    const [first, second] = [String.fromCharCode(0xd83d), String.fromCharCode(0xde00)]
    expect(matchesIn('a😀b', first)).toEqual([])
    expect(matchesIn('a😀b', `${second}b`)).toEqual([])
    expect(matchesIn('a😀b😀', '😀')).toEqual([1, 4])
  })
})

describe('replaceRangeOps', () => {
  const BOLD = { fontWeight: 700 } as const
  /** The text and runs once the ops replacing `start`–`end` with `insert` are applied in order. */
  const replaced = (value: TextValue, start: number, end: number, insert: string) =>
    replaceRangeOps(value.text, start, end, insert).reduce(applyTextOp, value)

  it('gives text over a bold word after plain text the bold of that word', () => {
    const value = { text: 'Big sale', runs: [{ start: 4, end: 8, style: BOLD }] }
    expect(replaced(value, 4, 8, 'deal')).toEqual({ text: 'Big deal', runs: [{ start: 4, end: 8, style: BOLD }] })
    expect(replaced(value, 4, 5, 'wh')).toEqual({ text: 'Big whale', runs: [{ start: 4, end: 9, style: BOLD }] })
  })

  it('counts an emoji the range starts with as one character', () => {
    const value = { text: 'a😀bc', runs: [{ start: 1, end: 3, style: BOLD }] }
    expect(replaced(value, 1, 4, 'XY')).toEqual({ text: 'aXYc', runs: [{ start: 1, end: 3, style: BOLD }] })
    expect(replaced(value, 1, 3, 'Z')).toEqual({ text: 'aZbc', runs: [{ start: 1, end: 2, style: BOLD }] })
  })

  it('inserts with the run before at an empty range, and deletes with nothing to insert', () => {
    const value = { text: 'ab', runs: [{ start: 0, end: 1, style: BOLD }] }
    expect(replaceRangeOps('ab', 1, 1, 'x')).toEqual([{ kind: 'insert', at: 1, text: 'x' }])
    expect(replaced(value, 1, 1, 'x')).toEqual({ text: 'axb', runs: [{ start: 0, end: 2, style: BOLD }] })
    expect(replaced(value, 0, 1, '')).toEqual({ text: 'b', runs: [] })
    expect(replaceRangeOps('ab', 1, 1, '')).toEqual([])
  })
})

describe('replaceOps', () => {
  /** The text and runs once the ops are applied in order. */
  const replaced = (value: TextValue, find: string, replace: string) =>
    replaceOps(value.text, find, replace).reduce(applyTextOp, value)

  it('replaces every match, whatever its case, each taking the style of the first character it replaces', () => {
    const value = { text: 'Big sale, BIG deals', runs: [{ start: 10, end: 13, style: { fontWeight: 700 } }] }
    expect(replaced(value, 'big', 'Huge')).toEqual({
      text: 'Huge sale, Huge deals',
      runs: [{ start: 11, end: 15, style: { fontWeight: 700 } }],
    })
  })

  it('keeps the style of what is around each match, and of a match styled in parts from its first character', () => {
    const value = {
      text: 'one TWO three',
      runs: [
        { start: 0, end: 4, style: { color: '#FF0000FF' } },
        { start: 4, end: 5, style: { fontWeight: 700 } },
      ],
    }
    expect(replaced(value, 'two', '2')).toEqual({
      text: 'one 2 three',
      runs: [
        { start: 0, end: 4, style: { color: '#FF0000FF' } },
        { start: 4, end: 5, style: { fontWeight: 700 } },
      ],
    })
  })

  it('deletes each match with nothing to replace it, and leaves a text with no match as it is', () => {
    expect(replaced({ text: 'a-b-c', runs: [] }, '-', '')).toEqual({ text: 'abc', runs: [] })
    expect(replaceOps('abc', 'x', 'y')).toEqual([])
  })

  it('replaces a match that starts with an emoji, and a replacement that holds the match, once each', () => {
    expect(replaced({ text: '😀 hi 😀 hi', runs: [] }, '😀 hi', 'yo')).toEqual({ text: 'yo yo', runs: [] })
    expect(replaced({ text: 'cat cat', runs: [] }, 'cat', 'cats')).toEqual({ text: 'cats cats', runs: [] })
  })
})
