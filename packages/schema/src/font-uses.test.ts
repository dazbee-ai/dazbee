import { describe, expect, it } from 'vitest'

import { parseDesign } from './design.ts'
import { fontUses, textFontUses } from './font-uses.ts'
import { minimal } from './test-design.ts'
import type { TextLook } from './variables.ts'

describe('fontUses', () => {
  it('lists each family in each weight and style the texts are drawn in, once each, with the script fonts in them', () => {
    const d = minimal()
    const text = (words: string, style: object, runs: unknown[] = []) => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: words,
      style: { fontFamily: 'Inter', fontSize: 20, color: '#000000FF', ...style },
      runs,
    })
    Object.assign(d.nodes, {
      a: {
        type: 'text',
        parentId: 'sq',
        link: 'a',
        index: 'a5',
        name: 'A',
        props: text('Sale 新品', {}, [{ start: 0, end: 4, style: { fontWeight: 700 } }]),
      },
      b: { type: 'text', parentId: 'sq', link: 'b', index: 'a6', name: 'B', props: text('Sale', { fontWeight: 700 }) },
    })
    const parsed = parseDesign(d)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    expect(fontUses(parsed.design)).toEqual([
      { family: 'Inter', weight: 400, style: 'normal' },
      { family: 'Inter', weight: 700, style: 'normal' },
      { family: 'Noto Sans SC', weight: 400, style: 'normal' },
      { family: 'Noto Sans SC', weight: 700, style: 'normal' },
    ])
  })
})

describe('textFontUses', () => {
  const layer = (props: object, bindings?: Record<string, string>) => {
    const parsed = parseDesign({
      ...minimal(),
      nodes: {
        t: {
          type: 'text',
          parentId: 'sq',
          link: 't',
          index: 'a0',
          name: 'T',
          ...(bindings ? { bindings } : {}),
          props: {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            text: 'Big sale today',
            style: { fontFamily: 'Inter', fontSize: 20, color: '#000000FF' },
            ...props,
          },
        },
      },
    })
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const node = parsed.design.nodes.t
    if (node?.type !== 'text') throw new Error('no text')
    return node
  }

  it('gives the weight and style of the text and of each stretch its runs set, overlapping runs merged', () => {
    const text = layer({
      runs: [
        { start: 0, end: 8, style: { fontWeight: 700 } },
        { start: 4, end: 14, style: { fontStyle: 'italic' } },
        { start: 9, end: 14, style: { fontFamily: 'Lobster' } },
      ],
    })
    expect(textFontUses(text)).toEqual([
      { family: 'Inter', weight: 400, style: 'normal' },
      { family: 'Inter', weight: 700, style: 'normal' },
      { family: 'Inter', weight: 400, style: 'italic' },
      { family: 'Inter', weight: 700, style: 'italic' },
      { family: 'Lobster', weight: 400, style: 'italic' },
    ])
  })

  it('gives the script fonts its characters need in every weight and style it is drawn in', () => {
    const text = layer({ text: 'שלום 🎉', runs: [{ start: 0, end: 2, style: { fontWeight: 900 } }] })
    expect(textFontUses(text)).toEqual([
      { family: 'Inter', weight: 400, style: 'normal' },
      { family: 'Inter', weight: 900, style: 'normal' },
      { family: 'Noto Color Emoji', weight: 400, style: 'normal' },
      { family: 'Noto Color Emoji', weight: 900, style: 'normal' },
      { family: 'Noto Sans Hebrew', weight: 400, style: 'normal' },
      { family: 'Noto Sans Hebrew', weight: 900, style: 'normal' },
    ])
  })

  it('takes the family, weight and style a brand text style gives', () => {
    const look: TextLook = {
      fontFamily: 'Anton',
      fontWeight: 800,
      fontStyle: 'italic',
      lineHeight: 1.2,
      letterSpacing: { unit: 'px', value: 0 },
      textCase: 'none',
    }
    const text = layer({}, { textStyle: 'brand:headline' })
    expect(textFontUses(text, { 'brand:headline': look })).toEqual([{ family: 'Anton', weight: 800, style: 'italic' }])
  })

  it('reads an unchanged layer once for the same variables', () => {
    const text = layer({})
    expect(textFontUses(text)).toBe(textFontUses(text))
  })
})
