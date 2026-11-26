// The AI functions section, rendered in Node as the page sends it: each function's presets with what their calls
// measured, under each preset the modes that use it and the buttons that point another mode at it, and the picks.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { AiFunctionView, AiPickView } from '@dazbee/schema'

import { I18nProvider } from '@/lib/i18n/client.tsx'
import type { Locale } from '@/lib/i18n/index.ts'

import { AiFunctions, modesOf, settingsLine, utcTime } from './ai-functions.tsx'

vi.mock('@/app/pilot/ai/actions.ts', () => ({ pickPreset: vi.fn() }))

const AT = '2026-11-27T06:30:00.000Z'

/** The round plan: Fast on the code's choice, Precise picked over to the light preset, which has no done call. */
const ROUND_PLAN: AiFunctionView = {
  function: 'round-plan',
  kind: 'text',
  presets: [
    {
      name: 'light-luna',
      model: 'gpt-6-luna',
      settings: { effort: 'low', tier: 'fast' },
      ownPrompt: true,
      measured: { done: 0, cost: 0.54, seconds: 10, cutOffs: 0, failures: 0, firstGuess: true },
    },
    {
      name: 'full-terra',
      model: 'gpt-6.1-terra',
      settings: { effort: 'low', tier: 'standard' },
      ownPrompt: true,
      measured: { done: 37, cost: 1.9125, seconds: 31, cutOffs: 2, failures: 5, firstGuess: false },
    },
  ],
  modes: [
    { mode: 'fast', preset: 'light-luna', source: 'code', lacking: null, pickedAt: null },
    { mode: 'precise', preset: 'light-luna', source: 'pick', lacking: null, pickedAt: AT },
  ],
}

/** The draft: one preset, under no mode. */
const DRAFT: AiFunctionView = {
  function: 'draft',
  kind: 'picture',
  presets: [
    {
      name: 'gpt-image-medium',
      model: 'gpt-image-2.5-sunburst',
      settings: {},
      ownPrompt: false,
      measured: { done: 4, cost: 3.05, seconds: 28, cutOffs: 0, failures: 1, firstGuess: false },
    },
  ],
  modes: [{ mode: '', preset: 'gpt-image-medium', source: 'code', lacking: null, pickedAt: null }],
}

/** The round plan's three picks, newest first. */
const PICKS: AiPickView[] = [
  { id: 3, mode: 'precise', preset: 'light-luna', setBy: 'ada@example.com', setAt: AT },
  { id: 2, mode: 'precise', preset: 'full-terra', setBy: 'bo@example.com', setAt: '2026-11-26T22:41:07.250Z' },
  { id: 1, mode: 'precise', preset: 'light-luna', setBy: null, setAt: '2026-11-26T22:41:02.900Z' },
]

/** The section's markup as the page sends it. */
const html = (functions: AiFunctionView[], picks: Record<string, AiPickView[]> = {}, locale: Locale = 'en') =>
  renderToStaticMarkup(
    createElement(I18nProvider, { locale, children: createElement(AiFunctions, { functions, picks }) }),
  )

/** The markup of the row of `preset`'s measurements. */
const rowOf = (markup: string, preset: string) =>
  new RegExp(`<tr data-preset="${preset}"[^>]*>.*?</tr>`, 's').exec(markup)?.[0] ?? ''

/** The markup of the line under `preset`'s measurements: the modes that use it, and the buttons. */
const usesOf = (markup: string, preset: string) =>
  new RegExp(`<tr data-uses-of="${preset}">.*?</tr>`, 's').exec(markup)?.[0] ?? ''

/** The words of a row's cells. */
const cellsOf = (row: string) => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(([, cell]) => cell ?? '')

describe('settingsLine', () => {
  it('writes a preset’s settings as one line, and a dash when it passes none', () => {
    expect(settingsLine({ effort: 'low', tier: 'fast' })).toBe('effort: low, tier: fast')
    expect(settingsLine({})).toBe('—')
  })
})

describe('utcTime', () => {
  it('writes a time in UTC to the second, marked UTC', () => {
    expect(utcTime('2026-11-26T22:41:07.250Z')).toBe('2026-11-26 22:41:07 UTC')
    expect(utcTime('2026-11-27T04:11:07+05:30')).toBe('2026-11-26 22:41:07 UTC')
  })
})

describe('modesOf', () => {
  it('gives the modes that use a preset, and those that could be pointed at it', () => {
    expect(modesOf(ROUND_PLAN, 'light-luna')).toEqual({ using: ROUND_PLAN.modes, others: [] })
    expect(modesOf(ROUND_PLAN, 'full-terra')).toEqual({ using: [], others: ROUND_PLAN.modes })
  })
})

describe('AiFunctions', () => {
  it('shows each AI function with its kind, and each preset with its model, its settings and whether its prompt is its own', () => {
    const markup = html([ROUND_PLAN, DRAFT])
    expect(markup).toMatch(/<li data-function="round-plan"[^>]*><h3[^>]*>Round plan<span[^>]*>Text model<\/span>/)
    expect(markup).toMatch(/<li data-function="draft"[^>]*><h3[^>]*>Draft<span[^>]*>Picture model<\/span>/)
    // A function named as its kind of call doesn't say the same words twice.
    const split = html([{ ...DRAFT, function: 'layer-split', kind: 'layer-split' }])
    expect(split).toMatch(/<h3[^>]*>Layer split<span[^>]*>GPU model<\/span>/)
    expect(cellsOf(rowOf(markup, 'light-luna')).slice(0, 4)).toEqual([
      'light-luna',
      'gpt-6-luna',
      'effort: low, tier: fast',
      'Yes',
    ])
    expect(cellsOf(rowOf(markup, 'gpt-image-medium')).slice(0, 4)).toEqual([
      'gpt-image-medium',
      'gpt-image-2.5-sunburst',
      '—',
      'No',
    ])
  })

  it('shows a preset’s measurements as the API gave them: its cost, its time, its done calls, cut-offs and failures', () => {
    const markup = html([ROUND_PLAN])
    expect([...markup.matchAll(/<th[^>]*>(.*?)<\/th>/g)].slice(4, 9).map(([, head]) => head)).toEqual([
      'Cost of a call, ₹',
      'Time of a call, s',
      'Done calls',
      'Cut off',
      'Failed',
    ])
    expect(cellsOf(rowOf(markup, 'full-terra')).slice(4, 9)).toEqual(['1.9125', '31', '37', '2', '5'])
  })

  it('marks the cost and the time of a preset with no done call as a first guess, and says in the hint what that means', () => {
    const markup = html([ROUND_PLAN, DRAFT])
    const guess = '<span data-first-guess="true"[^>]*>First guess</span>'
    const cells = cellsOf(rowOf(markup, 'light-luna'))
    expect(cells[4]).toMatch(new RegExp(`^0.54${guess}$`))
    expect(cells[5]).toMatch(new RegExp(`^10${guess}$`))
    // Its done calls carry no mark, and nothing is said only on hover.
    expect(cells[6]).toBe('0')
    expect(rowOf(markup, 'light-luna')).not.toContain('title=')
    expect(rowOf(markup, 'full-terra')).not.toContain('data-first-guess')
    expect(rowOf(markup, 'gpt-image-medium')).not.toContain('data-first-guess')
    expect(markup).toContain(
      'First guess marks the cost and the time of a preset with no done call yet: they are the guess the code gives it, not measured.',
    )
    expect(markup).toContain('calls answered from a recording are not counted')
  })

  it('names the modes that use a preset, with whether a pick or the code chose it', () => {
    const markup = html([ROUND_PLAN, DRAFT])
    const light = usesOf(markup, 'light-luna')
    expect(light).toMatch(/<span data-uses="fast" data-source="code"[^>]*>Fast, the code’s choice<\/span>/)
    expect(light).toMatch(/<span data-uses="precise" data-source="pick"[^>]*>Precise, picked<\/span>/)
    expect(light).not.toContain('<button')
    expect(usesOf(markup, 'gpt-image-medium')).toMatch(
      /data-uses="" data-source="code"[^>]*>Every mode, the code’s choice</,
    )
  })

  it('puts the modes and the buttons on a line of their own under the preset, across the table, so no column holds them', () => {
    const markup = html([ROUND_PLAN])
    expect(usesOf(markup, 'full-terra')).toMatch(
      /^<tr data-uses-of="full-terra"><td colSpan="9"[^>]*><div class="flex flex-wrap/,
    )
    expect(markup.match(/<th /g)).toHaveLength(9)
    expect(markup.indexOf('data-preset="full-terra"')).toBeLessThan(markup.indexOf('data-uses-of="full-terra"'))
    // A preset no mode uses says so.
    expect(usesOf(markup, 'full-terra')).toContain(
      'Used by:</span><span class="text-caption text-muted">no mode</span>',
    )
  })

  it('offers one button for each mode that could use a preset, and none for the modes that use it', () => {
    const terra = usesOf(html([ROUND_PLAN]), 'full-terra')
    expect(terra).toMatch(
      /<button type="button" data-use="fast" aria-label="Use full-terra for Round plan, Fast"[^>]*>Use for Fast<\/button>/,
    )
    expect(terra).toMatch(
      /<button type="button" data-use="precise" aria-label="Use full-terra for Round plan, Precise"[^>]*>Use for Precise<\/button>/,
    )
    expect(terra).not.toContain('data-uses=')
  })

  it('says beside its function that the newest pick names a preset the running code doesn’t have', () => {
    const lacking: AiFunctionView = {
      ...ROUND_PLAN,
      modes: [
        { mode: 'fast', preset: 'light-luna', source: 'code', lacking: null, pickedAt: null },
        { mode: 'precise', preset: 'full-terra', source: 'code', lacking: 'gone-preset', pickedAt: AT },
      ],
    }
    const markup = html([lacking, DRAFT])
    const roundPlan = /<li data-function="round-plan".*?<\/li>/s.exec(markup)?.[0] ?? ''
    expect(roundPlan).toMatch(/<div data-lacking="precise"><p role="alert"/)
    expect(roundPlan).toContain(
      'Precise: the newest pick names gone-preset, which the running code doesn’t have, so the code’s own choice, full-terra, runs.',
    )
    expect(markup.match(/data-lacking/g)).toHaveLength(1)
    expect(html([ROUND_PLAN])).not.toContain('data-lacking')
  })

  it('lists a function’s picks, newest first, with who made each and when in UTC to the second', () => {
    const markup = html([ROUND_PLAN, DRAFT], { 'round-plan': PICKS })
    const history = /<details data-picks="round-plan".*?<\/details>/s.exec(markup)?.[0] ?? ''
    expect(history).toContain('Picks, newest first (3)')
    const picks = [...history.matchAll(/<tr data-pick="(\d+)">(.*?)<\/tr>/gs)].map(([, id, row]) => [
      id,
      ...cellsOf(row ?? ''),
    ])
    expect(picks).toEqual([
      ['3', `<time dateTime="${AT}">2026-11-27 06:30:00 UTC</time>`, 'Precise', 'light-luna', 'ada@example.com'],
      // Two picks in the same minute read apart.
      ['2', expect.stringContaining('>2026-11-26 22:41:07 UTC<'), 'Precise', 'full-terra', 'bo@example.com'],
      ['1', expect.stringContaining('>2026-11-26 22:41:02 UTC<'), 'Precise', 'light-luna', 'An account since deleted'],
    ])
    // A function with no pick says the code's own choice runs.
    const none = /<details data-picks="draft".*?<\/details>/s.exec(markup)?.[0] ?? ''
    expect(none).toContain('Picks, newest first (0)')
    expect(none).toContain('No picks yet: the code’s own choice runs.')
  })

  it('has its words in Arabic too', () => {
    const markup = html([ROUND_PLAN, DRAFT], { 'round-plan': PICKS }, 'ar')
    expect(markup).toContain('دوال الذكاء الاصطناعي')
    expect(markup).toContain('تقدير أولي')
    expect(markup).not.toMatch(/First guess|Use for|Picked by|Every mode|the code’s choice/)
  })
})
