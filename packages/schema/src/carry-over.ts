// The steps that carry stored layers over to this schema's version, run on a layer record before
// it is validated. A design's document holds no version, so each step finds the shape it carries
// over in the record itself and leaves any other record as it is: every step runs on every read.
import { isRecord } from './json.ts'

type Rec = Record<string, unknown>

/**
 * One step: the schema version it carries over to, and what it does to a text's character style,
 * as a text's base style, its runs' and a copied style's text look hold it. Each gives back the
 * same object when it holds nothing the step carries over.
 */
interface CarryOverStep {
  to: number
  textStyle(style: Rec): Rec
}

/**
 * To version 10: letter spacing stored as a bare number of pixels becomes pixels with their unit;
 * none becomes a percentage of 0, as a new text's is, which draws the same.
 */
function letterSpacingWithUnit(style: Rec): Rec {
  const { letterSpacing } = style
  if (typeof letterSpacing !== 'number') return style
  return {
    ...style,
    letterSpacing: letterSpacing === 0 ? { unit: 'percent', value: 0 } : { unit: 'px', value: letterSpacing },
  }
}

/** The steps, oldest first. */
const STEPS: readonly CarryOverStep[] = [{ to: 10, textStyle: letterSpacingWithUnit }]

/**
 * A layer record as stored, carried over by every step to this schema's version, ready to be
 * validated: a text's base style and each run's carried over (`carryOverTextStyle`). The same
 * object when no step changes it; the record given is never changed.
 */
export function carryOverLayer(record: unknown): unknown {
  if (!isRecord(record) || record.type !== 'text' || !isRecord(record.props)) return record
  const { props } = record
  const style = carryOverTextStyle(props.style)
  const runs = Array.isArray(props.runs) ? props.runs.map(runCarriedOver) : props.runs
  const runsChanged = Array.isArray(runs) && runs.some((run, i) => run !== (props.runs as unknown[])[i])
  if (style === props.style && !runsChanged) return record
  return { ...record, props: { ...props, style, runs } }
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

/**
 * A text's character style as stored, carried over by every step: a text's base style, a run's,
 * or the text look of a copied style. The same object when no step changes it.
 */
export function carryOverTextStyle(style: unknown): unknown {
  if (!isRecord(style)) return style
  let out = style
  for (const step of STEPS) out = step.textStyle(out)
  return out
}

function runCarriedOver(run: unknown): unknown {
  if (!isRecord(run)) return run
  const style = carryOverTextStyle(run.style)
  return style === run.style ? run : { ...run, style }
}
