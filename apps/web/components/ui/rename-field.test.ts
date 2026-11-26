// The rename field as the page draws it, rendered in Node: the browser is asked never to fill it.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RenameField } from './rename-field.tsx'

describe('RenameField', () => {
  it('asks the browser and password managers never to suggest or fill the name', () => {
    const markup = renderToStaticMarkup(
      createElement(RenameField, { name: 'Sale', label: 'Name of Sale', inputName: 'section-title', onDone: () => {} }),
    )
    // HTML reads attribute names in any case.
    expect(markup).toMatch(/autocomplete="off"/i)
    expect(markup).toContain('data-1p-ignore')
    expect(markup).toContain('data-lpignore="true"')
  })
})
