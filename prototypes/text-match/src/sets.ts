// PROTOTYPE. The test sets with known fonts, as blocks the matcher takes: the synthetic set
// (make-synthetic.ts), our own realistic set (make-realistic.ts) and the LICA set (lica.ts). Each has
// a development part (for choosing checkpoints and settings) and a test part.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DATA_DIR } from './catalogue.ts'
import type { Truth } from './make-synthetic.ts'
import type { Block } from './measure.ts'
import { readPng } from './png.ts'

export type SetName = 'synthetic' | 'own' | 'lica'

export interface Item {
  id: string
  block: Block
  /** The truth; `face` is '' when only the family is known (LICA faces missing from the library). */
  truth: Truth & { kind?: string }
}

/** The items of a set's part ('dev', 'test' or 'all'). */
export function loadSet(set: SetName, part: string): Item[] {
  const dir = join(DATA_DIR, set)
  const raw = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as (Truth & {
    face: string | null
    angle?: number
  })[]
  return raw
    .filter((t) => part === 'all' || t.part === part)
    .map((t) => {
      const truth = {
        ...t,
        face: t.face ?? '',
        form: t.form ?? 'cutout',
        degradation: t.degradation ?? 'none',
        lowContrast: t.lowContrast ?? false,
        rotation: t.rotation ?? 0,
      } as Item['truth']
      const rgba = readPng(join(dir, `${t.id}.png`))
      let block: Block
      if (set === 'synthetic')
        block = {
          rgba,
          text: t.text,
          ...(t.form === 'cutout' ? { behind: readPng(join(dir, `${t.id}-behind.png`)) } : {}),
        }
      else if (set === 'own')
        block = { rgba, text: t.text, angle: t.angle ?? 0, behind: readPng(join(dir, `${t.id}-behind.png`)) }
      else block = { rgba, text: t.text, angle: 0 }
      return { id: t.id, block, truth }
    })
}
