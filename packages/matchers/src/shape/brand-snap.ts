// Brand snap: a graphic's fill within ΔE00 5 of a brand kit colour takes that colour and is bound to
// it (`fill: brand:<token>`), so changing the brand colour recolours it. A stroke's colour snaps too,
// unbound, as a stroke's colour is not a bindable property. The snap is drawn and judged: when it
// makes the piece look different and it looked the same before, the farthest snaps are undone,
// one at a time, until it looks the same.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { Color, MatchKit, VariableRef } from '@dazbee/schema'

import { ciede2000, type Lab, srgbToLab } from '../looks-same/colour.ts'
import { looksSame } from '../looks-same/rule.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { hexRgb } from './parts/colour.ts'

/** The graphics after the snap, and the kit's colours by `brand:<token>` to draw bound fills with. */
export interface Snapped {
  layers: ShapeLayer[]
  variables: Record<VariableRef, string>
}

/** A fill or stroke within this ΔE00 of a kit colour takes it. */
const SNAP_DELTA_E = 5

/** Snaps each graphic's colours to the nearest kit colour within ΔE00 5, judged against the piece. */
export function snapToBrand(
  ck: CanvasKit,
  piece: Pixels,
  layers: readonly ShapeLayer[],
  colors: MatchKit['colors'],
): Snapped {
  const variables: Record<VariableRef, string> = {}
  const kit: { token: string; value: Color; lab: Lab }[] = []
  for (const [token, value] of Object.entries(colors)) {
    variables[`brand:${token}`] = value.toUpperCase()
    kit.push({ token, value, lab: srgbToLab(...hexRgb(value)) })
  }
  if (kit.length === 0) return { layers: [...layers], variables }
  const nearest = (colour: string) => {
    const lab = srgbToLab(...hexRgb(colour))
    let best = kit[0]
    let bestDistance = Infinity
    for (const k of kit) {
      const d = ciede2000(lab, k.lab)
      if (d < bestDistance) {
        bestDistance = d
        best = k
      }
    }
    return { best, distance: bestDistance }
  }
  const opaque = (value: Color) => value.slice(0, 7).toUpperCase() + 'FF'
  const stroked = layers.map((layer): ShapeLayer => {
    if (!layer.props.strokes.some((stroke) => stroke.paint.type === 'solid')) return layer
    const strokes = layer.props.strokes.map((stroke) => {
      if (stroke.paint.type !== 'solid') return stroke
      const { best, distance } = nearest(stroke.paint.color)
      return best && distance <= SNAP_DELTA_E
        ? { ...stroke, paint: { ...stroke.paint, color: opaque(best.value) } }
        : stroke
    })
    return { ...layer, props: { ...layer.props, strokes } }
  })
  const snaps: { index: number; distance: number; layer: ShapeLayer }[] = []
  const snapped = stroked.map((layer, index): ShapeLayer => {
    const { fills } = layer.props
    const at = fills.length - 1
    const top = fills[at]
    if (top?.type !== 'solid') return layer
    const { best, distance } = nearest(top.color)
    if (!best || distance > SNAP_DELTA_E) return layer
    snaps.push({ index, distance, layer })
    return {
      ...layer,
      bindings: { fill: `brand:${best.token}` },
      props: {
        ...layer.props,
        fills: fills.map((fill, j) => (j === at ? { ...top, color: opaque(best.value) } : fill)),
      },
    }
  })
  if (snaps.length === 0) return { layers: stroked, variables }
  const same = (drawn: readonly ShapeLayer[]) =>
    looksSame('shape', piece, drawGraphics(ck, drawn, piece.width, piece.height, 1, variables)).same
  if (same(snapped) || !same(stroked)) return { layers: snapped, variables }
  snaps.sort((a, b) => b.distance - a.distance)
  const undone = snapped.slice()
  for (const snap of snaps) {
    undone[snap.index] = snap.layer
    if (same(undone)) break
  }
  return { layers: undone, variables }
}
