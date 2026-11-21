import { beforeAll, describe, expect, it } from 'vitest'

import type { CanvasKit } from '@dazbee/canvaskit'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { svgToLayers } from '@dazbee/svg'

import { iconSvg } from './icon-svg.ts'

let ck: CanvasKit

beforeAll(async () => {
  ck = await loadCanvasKit()
})

/** The SVG reader's graphics of an icon's file, each with its fills and strokes. */
function graphicsOf(svg: string) {
  const { tree } = svgToLayers(ck, svg, { name: 'Icon' })
  return Object.values(tree.nodes).filter((node) => node.type === 'graphic')
}

describe('iconSvg', () => {
  it('outlines a style of lines into one filled shape in the colour, with no strokes', () => {
    const svg = iconSvg(ck, 'tabler', 'shopping-cart', 'outline', { colour: '#112233FF', size: 240 })
    expect(svg).not.toContain('stroke')
    const graphics = graphicsOf(svg)
    expect(graphics).toHaveLength(1)
    expect(graphics[0]?.props).toMatchObject({ fills: [{ type: 'solid', color: '#112233FF' }], strokes: [] })
  })

  it('outlines a line the width the set draws it: 2 of 24, ends rounded', () => {
    // tabler/minus is one line from (5, 12) to (19, 12): outlined, 16 wide with its round ends and 2 tall.
    const [graphic] = graphicsOf(iconSvg(ck, 'tabler', 'minus', 'outline', { colour: '#000000FF', size: 24 }))
    expect(graphic?.props).toMatchObject({ x: 4, y: 11, width: 16, height: 2 })
  })

  it('keeps a filled style’s paths as the set draws them, each in the colour, with its opacity', () => {
    const svg = iconSvg(ck, 'phosphor', 'star', 'duotone', { colour: '#AA0000FF', size: 100 })
    const graphics = graphicsOf(svg)
    expect(graphics).toHaveLength(2)
    expect(graphics.map(({ props }) => props.opacity).sort()).toEqual([0.2, 1])
    for (const { props } of graphics) expect(props.fills).toEqual([expect.objectContaining({ color: '#AA0000FF' })])
  })

  it('refuses a style the set doesn’t draw the icon in', () => {
    expect(() => iconSvg(ck, 'tabler', 'star', 'bold', { colour: '#000000FF', size: 24 })).toThrow()
  })
})
