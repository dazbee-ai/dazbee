import * as RadixTooltip from '@radix-ui/react-tooltip'
import { describe, expect, it } from 'vitest'

import { ROW_SKIP_MS, TooltipRow } from './tooltip.tsx'

describe('TooltipRow', () => {
  it('keeps its tooltips to words that close as the pointer leaves, and opens the next at once for longer than the page’s', () => {
    const row = TooltipRow({ children: null })
    expect(row.type).toBe(RadixTooltip.Provider)
    expect(row.props).toMatchObject({ disableHoverableContent: true, skipDelayDuration: ROW_SKIP_MS })
    expect(ROW_SKIP_MS).toBeGreaterThan(150)
  })
})
