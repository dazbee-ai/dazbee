import { describe, expect, it } from 'vitest'

import { buildPattern } from '../catalog.ts'
import { PATTERN_STYLES } from '../styles.ts'
import { CHANNEL_SIZES, CONTENT, KIT, measure } from '../test-input.ts'
import { dateParts } from './event-date.ts'

describe('the event date', () => {
  it('sets a date’s day large and the rest on the strip, and a date with no day whole', () => {
    expect(dateParts('28 Nov')).toEqual({ day: '28', rest: 'Nov' })
    expect(dateParts('Sat, Nov 28th')).toEqual({ day: '28th', rest: 'Sat, Nov' })
    expect(dateParts('Tonight')).toEqual({ day: 'Tonight', rest: '' })
  })

  it('shows the date at every channel size, as a chip before the words in a short frame', () => {
    const content = { ...CONTENT, number: '28 Nov' }
    for (const style of PATTERN_STYLES)
      for (const { width, height } of CHANNEL_SIZES) {
        const { nodes } = buildPattern('event-date', { style, kit: KIT, content, width, height, measure })
        const shown = Object.values(nodes).some((node) => node.type === 'text' && /28/.test(node.props.text))
        expect({ style, width, height, shown }).toEqual({ style, width, height, shown: true })
      }
  })
})
