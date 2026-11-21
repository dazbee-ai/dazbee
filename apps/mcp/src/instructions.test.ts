import { describe, expect, it } from 'vitest'

import { renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { DesignInput } from '@dazbee/schema'

import { INSTRUCTIONS } from './instructions.ts'

/** A red square's props, `size` pixels a side, at `x` and `y`. */
const red = (x: number, y: number, size: number) => ({
  x,
  y,
  width: size,
  height: size,
  shape: { kind: 'rect' as const },
  fills: [{ type: 'solid' as const, color: '#FF0000FF' }],
})

/**
 * A 200×200 white frame placed at 500, 300 on its page, holding a box at 20, 20 with a red square at 30, 40 inside
 * it, and a box turned a quarter, over 0, 0 to 60, 60, with a red square at its top-left corner.
 */
const PLACED: DesignInput = {
  meta: { designId: 'd1', name: 'Placed' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    f: {
      pageId: 'p1',
      name: 'Frame',
      width: 200,
      height: 200,
      x: 500,
      y: 300,
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      order: 'a0',
    },
  },
  nodes: {
    holder: {
      type: 'box',
      parentId: 'f',
      link: 'holder',
      index: 'a0',
      name: 'Holder',
      props: { x: 20, y: 20, width: 160, height: 160 },
    },
    inside: {
      type: 'graphic',
      parentId: 'holder',
      link: 'inside',
      index: 'a0',
      name: 'Inside',
      props: red(30, 40, 10),
    },
    turned: {
      type: 'box',
      parentId: 'f',
      link: 'turned',
      index: 'a1',
      name: 'Turned',
      props: { x: 0, y: 0, width: 60, height: 60, rotation: 90 },
    },
    corner: { type: 'graphic', parentId: 'turned', link: 'corner', index: 'a0', name: 'Corner', props: red(0, 0, 10) },
  },
}

/** Whether the frame's pixel at `x`, `y` is red. */
function redAt({ width, pixels }: { width: number; pixels: Uint8Array }, x: number, y: number): boolean {
  const at = (y * width + x) * 4
  return pixels[at] === 255 && pixels[at + 1] === 0 && pixels[at + 2] === 0
}

describe('INSTRUCTIONS', () => {
  it('measures a layer’s x and y from its frame’s top-left corner, also inside a box, as the renderer draws it', async () => {
    expect(INSTRUCTIONS).toContain('A layer’s x and y are measured from its frame’s top-left corner')
    const drawn = renderPixels(await loadCanvasKit(), PLACED, 'f', { fonts: [], fallbackFamilies: [], images: {} })
    expect(redAt(drawn, 35, 45)).toBe(true)
    expect(redAt(drawn, 55, 65)).toBe(false)
  })

  it('turns a layer clockwise about its centre, with the layers it holds, as the renderer draws it', async () => {
    expect(INSTRUCTIONS).toContain('clockwise about the layer’s centre, and a box or group turns the layers in it')
    const drawn = renderPixels(await loadCanvasKit(), PLACED, 'f', { fonts: [], fallbackFamilies: [], images: {} })
    // The square at the box's top-left corner, turned a quarter clockwise about the box's centre, is at its top-right.
    expect(redAt(drawn, 55, 5)).toBe(true)
    expect(redAt(drawn, 5, 5)).toBe(false)
    expect(redAt(drawn, 5, 55)).toBe(false)
  })

  it('says calls on the open design are answered in order, and what closes it: close_design or another session', () => {
    expect(INSTRUCTIONS).toContain('Calls on the open design are answered one at a time, in the order sent')
    expect(INSTRUCTIONS).toContain('close_design closes it once you are done')
    expect(INSTRUCTIONS).toContain('Opening a design in another session of this agent, such as a new chat, closes')
  })

  it('says commands run only through run_command and batch, never as tools of their own', () => {
    expect(INSTRUCTIONS).toContain('Commands run only through run_command and batch')
    expect(INSTRUCTIONS).toContain('node.update and text.replace, for two, are run_command')
  })

  it('says node.style sets a whole copied style, and one prop changes with node.update', () => {
    expect(INSTRUCTIONS).toContain(
      'node.style sets a whole style copied from a layer; change one prop with node.update',
    )
  })

  it('says to wait for open_design’s answer before any other call on the design', () => {
    expect(INSTRUCTIONS).toContain('wait for its answer before any other call on the design')
  })

  it('points to ad_rules before designing, for advice and the plans, and to list_fonts', () => {
    expect(INSTRUCTIONS).toContain('Before you design a size, read ad_rules for it')
    expect(INSTRUCTIONS).toContain('the plans make_ad, add_sizes and review_frames')
    expect(INSTRUCTIONS).toContain('list_fonts')
  })

  it('fits the 4,096 characters Claude Code takes of a server’s instructions', () => {
    expect(INSTRUCTIONS.length).toBeLessThan(4096)
  })

  it('tells of the Before agent version, kept before each run of the agent’s changes', () => {
    expect(INSTRUCTIONS).toContain(
      'Before your first change to a design, and before your first change after a person’s edit',
    )
  })
})
