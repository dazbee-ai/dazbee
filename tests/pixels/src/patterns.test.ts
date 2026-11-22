// The patterns of bands, badges, numbers, quotes and words swept in every style at every channel size and with the
// other stand-in brands (test-pattern-sweeps.ts), and what every pattern's frames share: an underlined highlight drawn
// clear of the next line, texts linked across the sizes, and the ground following the brand kit.
import { describe, expect, it } from 'vitest'

import { testEditor } from '@dazbee/editor/test-editor'
import { PATTERNS } from '@dazbee/patterns'
import { renderDesign } from '@dazbee/renderer'
import { brandVariables, framesOf } from '@dazbee/schema'

import { rgbaAt } from './pixels.ts'
import { PATTERN_GROUPS, patternSweeps } from './test-pattern-sweeps.ts'
import { builtPattern, CHANNEL_SIZES, ck, CONTENT, patternBytes, STRIDE_KIT } from './test-patterns.ts'

patternSweeps('bands-numbers-quotes')

describe('a pattern’s frames', () => {
  it('are each swept in one file of the suite', () => {
    const swept = Object.values(PATTERN_GROUPS).flat()
    expect([...swept].sort()).toEqual(PATTERNS.map((pattern) => pattern.id).sort())
  })

  it('set an underlined highlight clear of the next line', async () => {
    // A ground no colour of the kit reads on as small text, so the bold style underlines its highlight.
    const grey = {
      ...STRIDE_KIT,
      colors: [
        { token: 'primary' as const, name: 'Primary', value: '#7A7A7AFF' },
        { token: 'accent' as const, name: 'Accent', value: '#8A8A8AFF' },
        { token: 'secondary' as const, name: 'Secondary', value: '#6F6F6FFF' },
        { token: 'text' as const, name: 'Text', value: '#000000FF' },
        { token: 'background' as const, name: 'Background', value: '#7F7F7FFF' },
      ],
    }
    const content = { headline: 'Free delivery on every single order', highlight: 'Free delivery' }
    const { session, bytes } = await builtPattern('words-only', 'bold', [{ width: 336, height: 280 }], {
      kit: grey,
      content,
    })
    const design = session.design()
    const [[frameId] = ['']] = framesOf(design, 'p1')
    const headline = Object.values(design.nodes).find((node) => node.name === 'Headline')
    if (headline?.type !== 'text') throw new Error('no headline')
    expect(headline.props.runs.some((run) => run.style.underline)).toBe(true)
    const image = renderDesign(ck, design, frameId, bytes)
    // The rows of the headline's box with ink in them, in runs: each line, and the underline apart from the line
    // after it.
    const { x, y, width, height } = headline.props
    const inked = (row: number) => {
      for (let col = Math.ceil(x); col < x + width; col++) {
        const [r = 0] = rgbaAt(image, col, row)
        if (r < 60) return true
      }
      return false
    }
    let runs = 0
    let inRun = false
    for (let row = Math.floor(y); row < Math.ceil(y + height); row++) {
      const ink = inked(row)
      if (ink && !inRun) runs++
      inRun = ink
    }
    const lines = Math.round(height / (headline.props.style.fontSize * (headline.props.style.lineHeight ?? 1.2)))
    expect(runs).toBe(lines + 1)
  })

  it('hold linked copies of each text: a headline changed in one size goes to every size with Copy to other frames', async () => {
    const { session } = await builtPattern('words-only', 'bold', CHANNEL_SIZES)
    const images = patternBytes().images
    const e = await testEditor(session.design(), {
      sources: { assetBytes: async (id) => images[id] ?? new Uint8Array() },
    })
    try {
      const headlines = () =>
        Object.entries(e.core.session.design().nodes).filter(([, node]) => node.name === 'Headline')
      expect(headlines()).toHaveLength(CHANNEL_SIZES.length)
      const [[first = ''] = []] = headlines()
      const length = CONTENT['words-only']?.headline.length ?? 0
      e.core.session.run('text.edit', { id: first, op: { kind: 'delete', at: 0, length } })
      e.core.session.run('text.edit', { id: first, op: { kind: 'insert', at: 0, text: 'Free returns, always' } })
      e.core.select([first])
      expect(e.core.perform('textToLinked')).toBe(true)
      expect(new Set(headlines().map(([, node]) => (node.type === 'text' ? node.props.text : '')))).toEqual(
        new Set(['Free returns, always']),
      )
    } finally {
      e.end()
    }
  })

  it('change with the brand kit: a new primary colour draws the ground in it', async () => {
    const { session, bytes } = await builtPattern('words-only', 'bold', [{ width: 1080, height: 1080 }])
    const design = session.design()
    const [[frameId] = ['']] = framesOf(design, 'p1')
    const green = {
      ...STRIDE_KIT,
      colors: STRIDE_KIT.colors.map((c) => (c.token === 'primary' ? { ...c, value: '#0A7A3FFF' } : c)),
    }
    const before = renderDesign(ck, design, frameId, bytes)
    const after = renderDesign(ck, design, frameId, {
      ...bytes,
      variables: brandVariables(green, { id: 'logo', contentType: 'image/png' }),
    })
    // A pixel of the ground, clear of the words and the decoration, near the frame's left edge half way down.
    const at = (image: { width: number; pixels: Uint8Array }) => rgbaAt(image, 12, 540)
    expect(at(before)).toEqual([255, 90, 54, 255])
    expect(at(after)).toEqual([10, 122, 63, 255])
  })
})
