import { describe, expect, it } from 'vitest'

import { googleFontsOf } from './google-font-links.ts'

describe('googleFontsOf', () => {
  it('reads both Google Fonts APIs’ families and weights, and nothing of any other link', () => {
    expect(
      googleFontsOf('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,700;1,400&family=Lora'),
    ).toEqual([
      { family: 'Inter', weights: [400, 700] },
      { family: 'Lora', weights: [] },
    ])
    expect(googleFontsOf('https://fonts.googleapis.com/css2?family=Roboto+Flex:wght@100..1000')).toEqual([
      { family: 'Roboto Flex', weights: [100, 1000] },
    ])
    expect(googleFontsOf('https://fonts.googleapis.com/css?family=Open+Sans:400,700italic|Oswald')).toEqual([
      { family: 'Open Sans', weights: [400, 700] },
      { family: 'Oswald', weights: [] },
    ])
    expect(googleFontsOf('https://fonts.example.com/css2?family=Inter')).toEqual([])
  })
})
