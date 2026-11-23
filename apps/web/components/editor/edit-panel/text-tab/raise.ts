// The Font features part's raise, read and written for whole texts: the raise every character of
// the selected texts shares, and a whole text raised alike.
import type { TextProps } from '@dazbee/schema'

import { type Props, shared } from '@/components/editor/edit-panel/target.ts'

type Text = Pick<TextProps, 'style' | 'runs'>

/** The raise the selected texts' characters share, 0 where none is raised, or mixed where any two differ. */
export function sharedRaise(props: readonly Props[]): number | 'mixed' {
  return shared(props.flatMap((pr) => textRaises(pr as unknown as Text & Pick<TextProps, 'text'>)))
}

/**
 * A whole text raised by `raise`, so every character has it: its base style's raise set, left out
 * at 0, and each run that sets its own raise set to it too. A run's style is written over what its
 * characters have, so a run's raise is set rather than taken off.
 */
export function textWithRaise(text: Text, raise: number): Text {
  const style = { ...text.style }
  if (raise === 0) delete style.raise
  else style.raise = raise
  const runs = text.runs.map((run) =>
    run.style.raise === undefined ? run : { ...run, style: { ...run.style, raise } },
  )
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
