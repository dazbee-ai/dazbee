// The ad prompts keep the reference flow's words exactly, but for the one marks change, each under its version name.
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import * as draft from './draft.ts'
import * as layerPlanner from './layer-planner.ts'
import * as reading from './reading.ts'
import * as reference from './reference.ts'
import * as refineEditor from './refine-editor.ts'
import * as roundDirector from './round-director.ts'
import * as roundDirectorLight from './round-director-light.ts'

/** The SHA-256 of each prompt's words as the reference flow has them, the refine editor's marks made blue. */
const WORDS = {
  PLANNER_PROMPT: 'cc38fc937840c67fc6ed1e34495b2ac2d6431286ac8cefd04f58c4a14eec2a34',
  PLANNER_PRODUCT_NOTE: '0eafb143358f2130bc9386da6d4ce3b10f919c3444c87026cce33132e5876e78',
  READING_PROMPT: '1b160606f459f65cd7fb27d45b5d21e7aa31dd6137d0681fa190cf63755ac504',
  ROUND_DIRECTOR: 'b30db0c9d8e5c26a5791918d9f6fe2e8c15f3e72215880213bb42697c245b61f',
  ROUND_DIRECTOR_LIGHT: '7b9d85c434f544665efceba141e2b622463117baaaa2530506b7d8438169c595',
  LIKED_DRAFT: '066236a582732291512b00a94b63cbd07a331c5e30f7fc3f15053eb710e8b8bf',
  REFERENCE_READER: '42dac42b6d07034ecfeae2ed53800dc4dac484a722a93f0711c03d5f2f9becb6',
  REFERENCE_AD: '6bfa170957f7a1c99428038d609bc88b687b22755bfe45be0c9072713c49e5ff',
  REFERENCE_KIND: '6fbd665e5b98733b528f48b9e5ed5ba1068e01002a01ca2cc3fa7bffcd8ef6c4',
  REFERENCE_KIND_UNKNOWN: 'c06c6f039bcd729dccf09710c8a5f2d206473d6f3e177f743b50344651255f96',
  DRAFT_PROMPT: '322e17447ae22e6b8c729397c9c6314125a8c913dd8bbe5620cb0421f77036f8',
  PICTURES_SENTENCE: '9ac3b99456fdd6d1117d906666df4638cf4ab5fec23e5259abbdbba770f31818',
  REFINE_EDITOR: '22b3d630e1fe056dabad7757421d73eee31c38ae40c5649cce0d464f4131d6c8',
}

const prompts: Record<string, string> = {
  ...draft,
  ...layerPlanner,
  ...reading,
  ...reference,
  ...refineEditor,
  ...roundDirector,
  ...roundDirectorLight,
}

const sha256 = (words: string) => createHash('sha256').update(words, 'utf8').digest('hex')

describe('the ad prompts', () => {
  it('keep the reference words exactly', () => {
    const words = Object.fromEntries(Object.entries(prompts).filter(([name]) => !name.endsWith('_VERSION')))
    expect(Object.fromEntries(Object.entries(words).map(([name, text]) => [name, sha256(text)]))).toEqual(WORDS)
  })

  it('show the refine editor numbered blue marks, never pink ones', () => {
    expect(refineEditor.REFINE_EDITOR).toContain('a copy with numbered blue marks on those places')
    expect(Object.values(prompts).some((text) => text.includes('pink'))).toBe(false)
  })

  it('keep each prompt’s version name', () => {
    expect({
      planner: layerPlanner.PLANNER_PROMPT_VERSION,
      productNote: layerPlanner.PLANNER_PRODUCT_NOTE_VERSION,
      reading: reading.READING_PROMPT_VERSION,
      roundDirector: roundDirector.ROUND_DIRECTOR_VERSION,
      roundDirectorLight: roundDirectorLight.ROUND_DIRECTOR_LIGHT_VERSION,
      referenceReader: reference.REFERENCE_READER_VERSION,
      referenceAd: reference.REFERENCE_AD_VERSION,
      draft: draft.DRAFT_PROMPT_VERSION,
      refineEditor: refineEditor.REFINE_EDITOR_VERSION,
    }).toEqual({
      planner: 'v7',
      productNote: 'product-1',
      reading: 'v1',
      roundDirector: 'v7',
      roundDirectorLight: 'light-3',
      referenceReader: 'v1',
      referenceAd: 'v1',
      draft: 'v1',
      refineEditor: 'v1',
    })
  })
})
