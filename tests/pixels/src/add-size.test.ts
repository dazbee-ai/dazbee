// Add size scales a layer's look with its box: a card with a stroke, rounded corners, a drop shadow
// and spaced text, added at 300 × 250 from 1080 × 1080, draws the same pixels as the same card
// built by hand at 300 × 250 from its sizes scaled by 250 / 1080 and rounded to hundredths.
import { describe, expect, it } from 'vitest'

import { openSession, readDesign } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { renderDesign } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, parseDesign } from '@dazbee/schema'

import { comparePixels, fixtureResources } from './pixels.ts'

const ck = await loadCanvasKit()
const bytes = fixtureResources()

const white = [{ type: 'solid', color: '#FFFFFFFF' }]
/** The card's sizes: its box, corners, stroke, shadow, and its label's box, font size and letter spacing. */
interface CardSizes {
  box: { x: number; y: number; width: number; height: number }
  corners: number
  stroke: number
  shadow: { y: number; blur: number }
  label: { x: number; y: number; width: number; height: number }
  fontSize: number
  letterSpacing: number
}

/** A page with one frame of `size` holding the card at `sizes`. */
function design(size: { width: number; height: number }, sizes: CardSizes): Design {
  const json = {
    meta: { designId: 'd', name: 'Add size' },
    pages: { p1: { name: 'Page', order: 'a0' } },
    frames: { f: { pageId: 'p1', name: 'F', ...size, x: 0, y: 0, fills: white, order: 'a0' } },
    nodes: {
      card: {
        type: 'box',
        parentId: 'f',
        link: 'card',
        index: 'a0',
        name: 'Card',
        props: {
          ...sizes.box,
          cornerRadius: sizes.corners,
          fills: [{ type: 'solid', color: '#FFD84DFF' }],
          strokes: [{ paint: { type: 'solid', color: '#1F2329FF' }, width: sizes.stroke, align: 'inside' }],
          effects: [{ type: 'dropShadow', color: '#00000060', x: 0, ...sizes.shadow, spread: 0 }],
        },
      },
      label: {
        type: 'text',
        parentId: 'card',
        link: 'label',
        index: 'a0',
        name: 'Label',
        props: {
          ...sizes.label,
          text: 'SHOP NOW',
          align: 'center',
          style: {
            fontFamily: 'Noto Sans',
            fontWeight: 700,
            fontSize: sizes.fontSize,
            color: '#1F2329FF',
            letterSpacing: { unit: 'px', value: sizes.letterSpacing },
          },
        },
      },
    },
  }
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

describe('add size', () => {
  it('draws a card added at 300 × 250 as the same card built by hand there from its sizes scaled and rounded', () => {
    const square = design(
      { width: 1080, height: 1080 },
      {
        box: { x: 140, y: 340, width: 800, height: 400 },
        corners: 40,
        stroke: 6,
        shadow: { y: 20, blur: 40 },
        label: { x: 200, y: 480, width: 680, height: 120 },
        fontSize: 64,
        letterSpacing: 2,
      },
    )
    const store = openTestStore(square)
    const mpu = openSession(store).run('frame.addSize', { frameId: 'f', newId: 'mpu', width: 300, height: 250 })

    // s = 250 / 1080, each size to hundredths: the stroke 1.39, the corners 9.26, the shadow 0, 4.63, 9.26.
    const byHand = design(
      { width: 300, height: 250 },
      {
        box: { x: 57.41, y: 78.7, width: 185.19, height: 92.59 },
        corners: 9.26,
        stroke: 1.39,
        shadow: { y: 4.63, blur: 9.26 },
        label: { x: 71.3, y: 111.11, width: 157.41, height: 27.78 },
        fontSize: 14.81,
        letterSpacing: 0.46,
      },
    )
    const added = renderDesign(ck, readDesign(store), mpu, bytes)
    expect(comparePixels(renderDesign(ck, byHand, 'f', bytes), added).differing).toBe(0)
    // The card unscaled would draw otherwise: the comparison sees its look.
    const unscaled = design(
      { width: 300, height: 250 },
      {
        box: { x: 57.41, y: 78.7, width: 185.19, height: 92.59 },
        corners: 40,
        stroke: 6,
        shadow: { y: 20, blur: 40 },
        label: { x: 71.3, y: 111.11, width: 157.41, height: 27.78 },
        fontSize: 14.81,
        letterSpacing: 2,
      },
    )
    expect(comparePixels(renderDesign(ck, unscaled, 'f', bytes), added).differing).toBeGreaterThan(0)
  })
})
