import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Paint } from '@dazbee/schema'

import { drawGraphics } from './draw-layers.ts'
import { toFloatPicture } from './parts/float-picture.ts'
import { gradientOf } from './patch-gradient.ts'
import { splitPatches } from './patches.ts'
import { graphic } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'

const LINEAR: Paint = {
  type: 'linear',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  stops: [
    { offset: 0, color: '#FDE68AFF' },
    { offset: 1, color: '#B91C1CFF' },
  ],
}

describe('gradientOf', () => {
  /** The one patch of a rectangle with this fill, with the picture it was cut from. */
  const patchOf = (fill: Paint) => {
    const picture = toFloatPicture(
      drawGraphics(
        ck,
        [graphic({ kind: 'rect', cornerRadius: 0 }, { x: 10, y: 10, width: 220, height: 100 }, { fill })],
        240,
        120,
      ),
    )
    const split = splitPatches(picture)
    const [patch] = split?.patches ?? []
    if (!split || !patch) throw new Error('no patch')
    return { picture, split, patch }
  }

  it('reads a patch that shades from one colour to another as a linear gradient between them', () => {
    const { picture, split, patch } = patchOf(LINEAR)
    const gradient = gradientOf(patch, picture, split.patchOf)
    expect(gradient?.type).toBe('linear')
    // It runs across the patch, in the picture's pixels.
    expect((gradient?.to[0] ?? NaN) - (gradient?.from[0] ?? NaN)).toBeGreaterThan(180)
    expect(Math.abs((gradient?.to[1] ?? NaN) - (gradient?.from[1] ?? NaN))).toBeLessThan(5)
  })

  it('reads no gradient in a patch of one colour', () => {
    const { picture, split, patch } = patchOf({ type: 'solid', color: BLUE })
    expect(gradientOf(patch, picture, split.patchOf)).toBeNull()
  })
})
