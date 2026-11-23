// The Font features part's raise, read and written for whole texts: the raise every character of
// the selected texts shares, and a whole text raised alike.
import type { TextProps } from '@dazbee/schema'

import { type Props, shared } from '@/components/editor/edit-panel/target.ts'

type Text = Pick<TextProps, 'style' | 'runs'>

/** The most a raise goes up or down, as a percentage of the font size. */
export const RAISE_MOST = 100

/** The raise the selected texts' characters share, 0 where none is raised, or mixed where any two differ. */
export function sharedRaise(props: readonly Props[]): number | 'mixed' {
  return shared(props.flatMap((pr) => textRaises(pr as unknown as Text & Pick<TextProps, 'text'>)))
}

/**
 * A whole text raised by `raise`: its base style's raise set, left out at 0, and its runs' own
 * taken off, so every character has it. A run that held only a raise goes.
 */
export function textWithRaise(text: Text, raise: number): Text {
  const style = { ...text.style }
  if (raise === 0) delete style.raise
  else style.raise = raise
  const runs = text.runs.flatMap((run) => {
    if (run.style.raise === undefined) return [run]
    const own = { ...run.style }
    delete own.raise
    return Object.keys(own).length > 0 ? [{ ...run, style: own }] : []
  })
  return { style, runs }
}

/** The raises a text's characters are set at, each once: its base style's with the runs over it, later ones winning; its base style's when it is empty. */
function textRaises(text: Text & Pick<TextProps, 'text'>): number[] {
  const raises = new Set<number>()
  for (let at = 0; at < Math.max(1, text.text.length); at++) {
    let raise = text.style.raise ?? 0
    for (const run of text.runs) if (run.start <= at && at < run.end) raise = run.style.raise ?? raise
    raises.add(raise)
  }
  return [...raises]
}
