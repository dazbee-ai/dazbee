// The steps that carry stored layers over to this schema's version, run on a layer record before
// it is validated. A design's document holds no version, so each step finds the shape it carries
// over in the record itself and leaves any other record as it is: every step runs on every read.
import { isRecord } from './json.ts'

/** One step: the schema version it carries layers over to, and what it does to one layer record. */
interface CarryOverStep {
  to: number
  /** The layer carried over, a new object; the same object when it holds nothing this step carries over. */
  layer(record: Record<string, unknown>): Record<string, unknown>
}

type Rec = Record<string, unknown>

/** The steps, oldest first. */
const STEPS: readonly CarryOverStep[] = [{ to: 10, layer: letterSpacingWithUnit }]

/**
 * A layer record as stored, carried over by every step to this schema's version, ready to be
 * validated: the same object when no step changes it. The record given is never changed.
 */
export function carryOverLayer(record: unknown): unknown {
  if (!isRecord(record)) return record
  let out = record
  for (const step of STEPS) out = step.layer(out)
  return out
}

/** Every layer of a record of layers carried over (`carryOverLayer`): the same record when none changes. */
export function carryOverLayers(nodes: Readonly<Rec>): Readonly<Rec> {
  let out: Rec | undefined
  for (const [id, layer] of Object.entries(nodes)) {
    const carried = carryOverLayer(layer)
    if (carried === layer) continue
    out ??= { ...nodes }
    out[id] = carried
  }
  return out ?? nodes
}

/** To version 10: letter spacing stored as a bare number of pixels becomes pixels with their unit, in the style and each run. */
function letterSpacingWithUnit(layer: Rec): Rec {
  const props = layer.props
  if (layer.type !== 'text' || !isRecord(props)) return layer
  const style = withUnit(props.style)
  const runs = Array.isArray(props.runs) ? props.runs.map(runWithUnit) : props.runs
  const runsChanged = Array.isArray(runs) && runs.some((run, i) => run !== (props.runs as unknown[])[i])
  if (style === props.style && !runsChanged) return layer
  return { ...layer, props: { ...props, style, runs } }
}

function runWithUnit(run: unknown): unknown {
  if (!isRecord(run)) return run
  const style = withUnit(run.style)
  return style === run.style ? run : { ...run, style }
}

function withUnit(style: unknown): unknown {
  if (!isRecord(style) || typeof style.letterSpacing !== 'number') return style
  return { ...style, letterSpacing: { unit: 'px', value: style.letterSpacing } }
}
