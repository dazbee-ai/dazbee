// The brand home's brief: the blank design a size starts, the brief its form sends, its design's name, and why a
// round didn't start.
import { describe, expect, it } from 'vitest'

import { parseDesign } from '@dazbee/schema'

import { en } from '@/lib/i18n/en.ts'

import { briefDesign, briefFromForm, designName, refusedWords } from './brief.ts'

const WHITE = [{ type: 'solid', color: '#FFFFFFFF' }]
const named = (id: string) => `Name of ${id}`

describe('briefDesign', () => {
  it('makes one empty, white frame per picked size on one page, in the presets’ order, in a row 200 px apart', () => {
    const design = briefDesign('Spring sale', ['link-image', 'story', 'feed-square'], named)
    expect(design).toEqual({
      meta: { designId: 'replaced-by-the-api', name: 'Spring sale' },
      pages: { p1: { name: 'Page 1', order: 'a0' } },
      frames: {
        f1: {
          pageId: 'p1',
          name: 'Name of feed-square',
          width: 1080,
          height: 1080,
          x: 0,
          y: 0,
          fills: WHITE,
          order: 'a0',
        },
        f2: {
          pageId: 'p1',
          name: 'Name of story',
          width: 1080,
          height: 1920,
          x: 1280,
          y: 0,
          fills: WHITE,
          order: 'a1',
        },
        f3: {
          pageId: 'p1',
          name: 'Name of link-image',
          width: 1200,
          height: 628,
          x: 2560,
          y: 0,
          fills: WHITE,
          order: 'a2',
        },
      },
      nodes: {},
    })
    expect(parseDesign(design).success).toBe(true)
  })

  it('makes one Feed square frame when no size it knows was picked', () => {
    const design = briefDesign('Plain', ['banner'], named)
    expect(design.frames).toEqual({
      f1: {
        pageId: 'p1',
        name: 'Name of feed-square',
        width: 1080,
        height: 1080,
        x: 0,
        y: 0,
        fills: WHITE,
        order: 'a0',
      },
    })
  })
})

describe('briefFromForm', () => {
  const form = (fields: [string, string][]) => {
    const data = new FormData()
    for (const [name, value] of fields) data.append(name, value)
    return data
  }

  it('reads the words, pictures, reference design, one size and the speed', () => {
    const brief = briefFromForm(
      form([
        ['brief', '  Diwali serum sale\n'],
        ['image', 'a1'],
        ['image', 'a2'],
        ['reference', 'd9'],
        ['size', 'story'],
        ['mode', 'precise'],
      ]),
    )
    expect(brief).toEqual({
      words: 'Diwali serum sale',
      pictures: ['a1', 'a2'],
      size: { width: 1080, height: 1920 },
      mode: 'precise',
      reference: { designId: 'd9' },
    })
  })

  it('makes a Fast square with no reference when the form names neither size nor speed', () => {
    expect(briefFromForm(form([['brief', 'Sale']]))).toEqual({
      words: 'Sale',
      pictures: [],
      size: { width: 1080, height: 1080 },
      mode: 'fast',
    })
  })
})

describe('designName', () => {
  it('is the first line, cut to 60 characters with an ellipsis', () => {
    expect(designName('Diwali sale\nwarm lights')).toBe('Diwali sale')
    expect(designName('x'.repeat(70))).toBe(`${'x'.repeat(59)}…`)
  })
})

describe('refusedWords', () => {
  it('says why a round didn’t start, and nothing for a key it doesn’t know', () => {
    expect(refusedWords('usedUp', en)).toBe(en.editor.brief.usedUp)
    expect(refusedWords('nope', en)).toBeNull()
    expect(refusedWords(undefined, en)).toBeNull()
  })
})
