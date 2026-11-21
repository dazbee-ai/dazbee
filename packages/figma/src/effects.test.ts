import { describe, expect, it } from 'vitest'

import { box, frame, onePage, rectangle } from './test-figma.ts'
import { imported, layersOf, onlyFrame } from './test-import.ts'

const BLACK = { r: 0, g: 0, b: 0, a: 0.25 }
const withEffects = (effects: unknown[]) =>
  onePage([frame('1:1', box(0, 0, 400, 300), [rectangle('1:2', box(0, 0, 40, 40), { effects })])])
const effectsOf = (text: string) => layersOf(onlyFrame(text))['1-2']?.props.effects
const itemsOf = (text: string) => imported(text).converted.report.items.map((i) => [i.line, i.count])
const shadow = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  color: BLACK,
  offset: { x: 2, y: 4 },
  radius: 8,
  spread: 1,
  visible: true,
  blendMode: 'NORMAL',
  ...extra,
})

describe('effectsOf', () => {
  it('makes a drop shadow from its offset, radius as blur, spread and colour, showing behind only when Figma does', () => {
    const text = withEffects([
      shadow('DROP_SHADOW', { showShadowBehindNode: true }),
      shadow('DROP_SHADOW', { showShadowBehindNode: false }),
    ])
    const drop = { type: 'dropShadow', x: 2, y: 4, blur: 8, spread: 1, color: '#00000040' }
    expect(effectsOf(text)).toEqual([{ ...drop, showBehind: true }, drop])
    expect(itemsOf(text)).toEqual([])
  })

  it('makes an inner shadow, taking a negative spread as 0, reported', () => {
    const text = withEffects([shadow('INNER_SHADOW'), shadow('INNER_SHADOW', { spread: -3 })])
    const inner = { type: 'innerShadow', x: 2, y: 4, blur: 8, color: '#00000040' }
    expect(effectsOf(text)).toEqual([
      { ...inner, spread: 1 },
      { ...inner, spread: 0 },
    ])
    expect(itemsOf(text)).toEqual([['inner-shadow-spreads', 1]])
  })

  it('makes layer and background blurs, a progressive one even at its end radius, reported', () => {
    const text = withEffects([
      { type: 'LAYER_BLUR', radius: 6, visible: true },
      { type: 'BACKGROUND_BLUR', radius: 10, visible: true, blurType: 'PROGRESSIVE', startRadius: 0 },
    ])
    expect(effectsOf(text)).toEqual([
      { type: 'layerBlur', radius: 6 },
      { type: 'backgroundBlur', radius: 10 },
    ])
    expect(itemsOf(text)).toEqual([['progressive-blurs', 1]])
  })

  it('draws a shadow blended in another way than normal as normal, reported', () => {
    const text = withEffects([shadow('DROP_SHADOW', { blendMode: 'MULTIPLY' })])
    expect(effectsOf(text)).toHaveLength(1)
    expect(itemsOf(text)).toEqual([['effect-blend-modes', 1]])
  })

  it('leaves out noise, texture, effects of unknown types or with no colour, and hidden effects, each reported', () => {
    const text = withEffects([
      { type: 'NOISE', visible: true },
      { type: 'TEXTURE', visible: true },
      { type: 'GLASS', visible: true },
      { type: 'DROP_SHADOW', radius: 2 },
      { radius: 2 },
      'junk',
      shadow('DROP_SHADOW', { visible: false }),
    ])
    expect(effectsOf(text)).toEqual([])
    expect(itemsOf(text)).toEqual([
      ['noise-effects', 1],
      ['texture-effects', 1],
      ['unknown-effects', 1],
      ['unreadable-effects', 3],
      ['hidden-effects', 1],
    ])
  })
})
