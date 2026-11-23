// The texts owed a fit: each text that grows with its words, fitted while a font it is drawn in was
// still coming (`FitText` answered `'wait'`), is fitted again once a load of fonts settles and all
// its fonts are here. The refit is untracked, a change no one undoes, as the brand kit's refit:
// undo of the edit that owed it takes the text back with the box from before. It waits for an open
// drag or typing step to end (C40).
import { CommandFault, type FitText, type Session } from '@dazbee/doc'

export interface OwedFitsDeps {
  session: Pick<Session, 'design' | 'untracked'>
  /** The editor's fit (`text/fit-text.ts`), which answers `'wait'` while a text's font is coming. */
  fit: FitText
}

export interface OwedFits {
  /** Owes a text a fit once the fonts it is drawn in are here, keeping its box's centre with `keep`. */
  owe(id: string, keep?: 'centre'): void
  /**
   * A load of fonts settled: each owed text whose fonts are all here is fitted with `fitText`
   * (typing's: the text and the groups around it), untracked, keeping what it was owed with.
   */
  settle(fitText: (id: string, keep?: 'centre') => void): void
}

export function owedFits({ session, fit }: OwedFitsDeps): OwedFits {
  /** The texts fitted while a font they are drawn in was coming, each with the point its box keeps. */
  const owed = new Map<string, 'centre' | undefined>()

  function owe(id: string, keep?: 'centre') {
    owed.set(id, keep ?? owed.get(id))
  }
  function settle(fitText: (id: string, keep?: 'centre') => void) {
    const keeps = new Map(owed)
    const due = [...owed.keys()].filter((id) => {
      const layer = session.design().nodes[id]
      const answer = layer ? fit(layer) : undefined
      if (answer === 'wait') return false
      // Fitted now, or gone, or a box that keeps its size: owed no more.
      owed.delete(id)
      return answer !== undefined
    })
    if (due.length === 0) return
    try {
      session.untracked(() => {
        for (const id of due) fitText(id, keeps.get(id))
      })
    } catch (error) {
      // Its fault listeners were told; the loads' other settle listeners still run.
      if (!(error instanceof CommandFault)) throw error
    }
  }

  return { owe, settle }
}
