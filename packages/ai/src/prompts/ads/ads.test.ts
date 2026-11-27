// The ad prompts: the parts the code fills in, the marks' colour, and how both round planners name the brand's logo.
import { describe, expect, it } from 'vitest'

import * as draft from './draft.ts'
import * as layerPlanner from './layer-planner.ts'
import * as reading from './reading.ts'
import * as reference from './reference.ts'
import * as refineEditor from './refine-editor.ts'
import * as roundDirector from './round-director.ts'
import * as roundDirectorLight from './round-director-light.ts'

const prompts: Record<string, string> = {
  ...draft,
  ...layerPlanner,
  ...reading,
  ...reference,
  ...refineEditor,
  ...roundDirector,
  ...roundDirectorLight,
}

describe('the ad prompts', () => {
  it('keep the places the code fills in', () => {
    expect(draft.DRAFT_PROMPT).toContain('{shape}')
    expect(draft.DRAFT_PROMPT).toContain('{brief}')
    expect(draft.DRAFT_PROMPT).toContain('{pictures}')
    expect(reference.REFERENCE_AD).toContain('{kind}')
    expect(reference.REFERENCE_KIND).toContain('{kind}')
  })

  it('show the refine editor numbered blue marks, never pink ones', () => {
    expect(refineEditor.REFINE_EDITOR).toContain('a copy with numbered blue marks on those places')
    expect(Object.values(prompts).some((text) => text.includes('pink'))).toBe(false)
  })

  it.each([
    ['full', roundDirector.ROUND_DIRECTOR],
    ['light', roundDirectorLight.ROUND_DIRECTOR_LIGHT],
  ])('the %s round planner names the brand as its logo, never as lettering', (_name, director) => {
    const words = director.replace(/\s+/g, ' ')
    expect(words).toContain('Every ad shows the brand as its own logo, the way people know it.')
    expect(words).toContain('"at the top left, the small white <brand> logo", with no typeface and no double quotes')
    expect(words).toContain(
      'an attached logo is the brand\'s logo in every ad, named "the logo from the attached picture, unchanged"',
    )
    expect(words).toContain(
      "it is named as the brand's logo, with its place, its size and its colour, and has no typeface and no double quotes",
    )
    expect(words).toContain('When no brand is named, no ad has a logo, the fourth included')
    expect(words).not.toContain('wordmark')
  })
})
