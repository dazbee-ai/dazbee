// The Font features part's raise for whole texts: the raise the selected texts' characters share,
// and a whole text raised alike.
import { describe, expect, it } from 'vitest'

import { sharedRaise, textWithRaise } from './raise.ts'

const STYLE = { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' }
/** "$99" with its runs, and its base style's raise. */
const price = (runs: object[] = [], raise?: number) => ({
  text: '$99',
  style: { ...STYLE, ...(raise === undefined ? {} : { raise }) },
  runs,
})

describe('sharedRaise', () => {
  it('reads the raise every character has, 0 where none is raised', () => {
    expect(sharedRaise([price(), price()])).toBe(0)
    expect(sharedRaise([price([], 30), price([{ start: 0, end: 3, style: { raise: 30 } }])])).toBe(30)
    // A run that sets no raise keeps the base style's.
    expect(sharedRaise([price([{ start: 0, end: 1, style: { underline: true } }], -20)])).toBe(-20)
  })

  it('reads mixed where any two characters differ, in one text or across texts', () => {
    expect(sharedRaise([price([{ start: 0, end: 1, style: { raise: 30 } }])])).toBe('mixed')
    expect(sharedRaise([price([], 30), price()])).toBe('mixed')
  })
})

describe('textWithRaise', () => {
  it('sets the base style’s raise and takes the runs’ own off, so every character has it', () => {
    const text = price([
      { start: 0, end: 1, style: { raise: 30 } },
      { start: 1, end: 3, style: { raise: -10, underline: true } },
    ])
    expect(textWithRaise(text, 20)).toEqual({
      style: { ...STYLE, raise: 20 },
      runs: [{ start: 1, end: 3, style: { underline: true } }],
    })
    expect(sharedRaise([{ ...text, ...textWithRaise(text, 20) }])).toBe(20)
  })

  it('leaves the raise out of the base style at 0', () => {
    expect(textWithRaise(price([], 30), 0)).toEqual({ style: STYLE, runs: [] })
  })
})
