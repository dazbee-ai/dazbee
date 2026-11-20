// The families a text layer draws something in, as the scene holds it.
import type { SceneLayer } from '../scene.ts'

type TextLayer = Extract<SceneLayer, { type: 'text' }>

/** The families a text names that draw something: its runs' with characters, and its own unless runs cover every one. */
export function drawnFamilies({ props }: TextLayer): string[] {
  const runs = props.runs.filter((run) => run.end > run.start)
  const covered = new Set<number>()
  for (const run of runs)
    if (run.style.fontFamily) for (let at = run.start; at < Math.min(run.end, props.text.length); at++) covered.add(at)
  const own = covered.size < props.text.length ? [props.style.fontFamily] : []
  return [...own, ...runs.flatMap((run) => (run.style.fontFamily ? [run.style.fontFamily] : []))]
}
