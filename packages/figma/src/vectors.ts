// The outlines a Figma node draws, from the paths its file gives in its own pixels: `fillGeometry`,
// always closed, and `strokeGeometry`, a stroke's outline. A vector's outlines that share a winding
// rule join into one; mixed rules, and regions with fills of their own, keep one each. A visible
// stroke on a vector is kept as its outline filled with the stroke's paints, since a live stroke
// along its closed fill would add an edge an open path doesn't have. A shape a boolean combines
// is one outline, the area all its paths fill.

import type { CanvasKit, Path } from '@dazbee/canvaskit'
import { type Matrix, pathData, transformed } from '@dazbee/svg'

import { bool, field, type FigmaFields, type FigmaNode, list, num, ownMap, record, str } from './read.ts'
import type { Reporter } from './report.ts'

/** One outline a node draws, as a path graphic draws it. */
export interface Outline {
  d: string
  fillRule: 'nonzero' | 'evenodd'
  /** The Figma paints it is filled with, as the file lists them. */
  fills: readonly unknown[]
  /** Whether it draws the node's strokes live along its edge. */
  strokes: boolean
}

/**
 * How a node's paths become outlines: by a vector's rules, as one shape with its live strokes (a
 * star, a polygon, an arc or ring, a skewed rectangle, a boolean drawn as one path), or as one
 * shape a boolean combines, whose paints and strokes don't show.
 */
export type OutlineRule = 'vector' | 'shape' | 'in-boolean'

/** A path read from the file, in the layer's pixels, with the fills of its region when it has its own. */
interface Entry {
  path: Path
  regionFills: readonly unknown[] | null
}

/** Paths whose coordinates pass this, in pixels, are no drawing Dazbee keeps. */
const MAX_PATH_COORDINATE = 1e12

/**
 * The outlines `n` draws by `rule`, its paths taken into the layer's pixels by `toBox`, bottom to
 * top. None, reported, when the file gives no path to draw it by; a stroke kept as an outline is
 * reported.
 */
export function outlinesOf(ck: CanvasKit, report: Reporter, n: FigmaNode, rule: OutlineRule, toBox: Matrix): Outline[] {
  const fills = list(field(n.fields, 'fills'))
  const overrides = rule === 'vector' ? ownMap(field(n.fields, 'fillOverrideTable')) : new Map<string, unknown>()
  const entries = entriesOf(ck, n.fields, 'fillGeometry', toBox, overrides)
  try {
    if (rule !== 'vector') {
      const one = entries.length > 0 ? oneOutline(ck, entries) : null
      if (!one) report.add('shapes-without-outlines', n)
      return one ? [{ ...one, fills, strokes: rule === 'shape' }] : []
    }
    const out = vectorOutlines(ck, report, n, entries, toBox)
    if (out.length === 0) report.add('shapes-without-outlines', n)
    return out
  } finally {
    for (const e of entries) e.path.delete()
  }
}

/**
 * The paths of a node's geometry `key`, each read from its data with its winding rule and taken
 * through `toBox`; data that is no path, or reaches past any drawing, is skipped. An entry whose
 * `overrideID` names an entry of `overrides` with a list of fills has those fills.
 */
function entriesOf(
  ck: CanvasKit,
  fields: FigmaFields,
  key: string,
  toBox: Matrix,
  overrides: ReadonlyMap<string, unknown>,
): Entry[] {
  const out: Entry[] = []
  for (const item of list(field(fields, key))) {
    const data = str(field(item, 'path'))
    const read = data ? ck.Path.MakeFromSVGString(data) : null
    if (!read) continue
    const path = transformed(ck, read, toBox)
    read.delete()
    const bounds = [...path.computeTightBounds()]
    if (path.countPoints() === 0 || !bounds.every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_PATH_COORDINATE)) {
      path.delete()
      continue
    }
    path.setFillType(field(item, 'windingRule') === 'EVENODD' ? ck.FillType.EvenOdd : ck.FillType.Winding)
    const id = num(field(item, 'overrideID'))
    const region = id === undefined ? undefined : record(overrides.get(String(id)))
    const regionFills = field(region, 'fills')
    out.push({ path, regionFills: Array.isArray(regionFills) ? regionFills : null })
  }
  return out
}

/**
 * One outline of `entries`: joined when they share a winding rule, else the area any of them
 * fills, each by its own rule; null when Skia can't combine them.
 */
function oneOutline(ck: CanvasKit, entries: readonly Entry[]): Omit<Outline, 'fills' | 'strokes'> | null {
  const oneRule = shareRule(ck, entries)
  let path: Path | null = oneRule ? joinedPath(ck, entries) : (entries[0] as Entry).path.copy()
  for (const e of oneRule ? [] : entries.slice(1)) {
    const united: Path | null = path && ck.Path.MakeFromOp(path, e.path, ck.PathOp.Union)
    path?.delete()
    path = united
  }
  if (!path) return null
  const outline = outlineOf(ck, path)
  path.delete()
  return outline
}

/** A vector's fills by its regions and winding rules, then its stroke's outline when it shows. */
function vectorOutlines(ck: CanvasKit, report: Reporter, n: FigmaNode, entries: Entry[], toBox: Matrix): Outline[] {
  const fills = list(field(n.fields, 'fills'))
  const strokes = list(field(n.fields, 'strokes'))
  const plain = entries.filter((e) => !e.regionFills)
  const oneRule = shareRule(ck, plain)
  const filled: Outline[] = []
  for (const e of entries) {
    if (e.regionFills) {
      filled.push({ ...outlineOf(ck, e.path), fills: e.regionFills, strokes: false })
    } else if (!oneRule) {
      filled.push({ ...outlineOf(ck, e.path), fills, strokes: false })
    } else if (e === plain[0]) {
      const joined = joinedPath(ck, plain)
      filled.push({ ...outlineOf(ck, joined), fills, strokes: false })
      joined.delete()
    }
  }
  if (!showsStrokes(n.fields)) return filled
  const strokeEntries = entriesOf(ck, n.fields, 'strokeGeometry', toBox, new Map())
  try {
    const stroke = strokeEntries.length > 0 ? oneOutline(ck, strokeEntries) : null
    if (!stroke) {
      // With nothing else to draw, the caller reports the vector left out once.
      if (filled.length > 0) report.add('shapes-without-outlines', n)
      return filled
    }
    report.add('vector-strokes-outlined', n)
    // With no fills of its own, a stroked vector draws only its regions' fills below its stroke.
    const below = fills.length > 0 ? filled : filled.filter((o) => o.fills !== fills)
    return [...below, { ...stroke, fills: strokes, strokes: false }]
  } finally {
    for (const e of strokeEntries) e.path.delete()
  }
}

/** Whether `entries` all fill by one winding rule. */
function shareRule(ck: CanvasKit, entries: readonly Entry[]): boolean {
  return new Set(entries.map((e) => isEvenOdd(ck, e.path))).size <= 1
}

function isEvenOdd(ck: CanvasKit, path: Path): boolean {
  return path.getFillType().value === ck.FillType.EvenOdd.value
}

/** The paths of `entries` as one, under the first one's winding rule. */
function joinedPath(ck: CanvasKit, entries: readonly Entry[]): Path {
  const builder = new ck.PathBuilder()
  for (const e of entries) builder.addPath(e.path)
  builder.setFillType(isEvenOdd(ck, (entries[0] as Entry).path) ? ck.FillType.EvenOdd : ck.FillType.Winding)
  return builder.detachAndDelete()
}

function outlineOf(ck: CanvasKit, path: Path): Pick<Outline, 'd' | 'fillRule'> {
  return { d: pathData(path), fillRule: isEvenOdd(ck, path) ? 'evenodd' : 'nonzero' }
}

/** Whether a node's strokes show: one of its stroke paints is visible, at a width above 0. */
function showsStrokes(fields: FigmaFields): boolean {
  const visible = list(field(fields, 'strokes')).some(
    (p) => record(p) !== undefined && bool(field(p, 'visible')) !== false,
  )
  return visible && (num(field(fields, 'strokeWeight')) ?? 1) > 0
}
