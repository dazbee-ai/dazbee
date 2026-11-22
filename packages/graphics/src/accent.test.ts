import { describe, expect, it } from 'vitest'

import { paintsWith, swapAccent } from './accent.ts'

describe('swapAccent', () => {
  it('writes the accent as the colour given wherever it paints, in any case, and nothing else', () => {
    const text =
      '<svg><style>.a{fill:#68E1FD}</style><rect fill="#68e1fd"/><stop stop-color="#68e1fd"/>' +
      '<rect fill="#68e1fda"/><rect fill="#68e1fe"/></svg>'
    expect(swapAccent(text, '#68e1fd', '#E4572E')).toBe(
      '<svg><style>.a{fill:#e4572e}</style><rect fill="#e4572e"/><stop stop-color="#e4572e"/>' +
        '<rect fill="#68e1fda"/><rect fill="#68e1fe"/></svg>',
    )
  })

  it('refuses what isn’t #rrggbb', () => {
    expect(() => swapAccent('', '#6c63ff', 'red')).toThrow()
  })
})

describe('paintsWith', () => {
  it('tells whether a file paints with a colour, in any case, and not with a longer one it starts', () => {
    expect(paintsWith('<rect fill="#6C63FF"/>', '#6c63ff')).toBe(true)
    expect(paintsWith('<rect fill="#6c63ff80"/>', '#6c63ff')).toBe(false)
  })
})
