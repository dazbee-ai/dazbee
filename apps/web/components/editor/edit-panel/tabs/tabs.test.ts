// The edit panel's header and switcher tabs for each selection, and where each key of the key map
// lands in them: in exactly one place, or nowhere where the control only acts and the tab may only view.
import { describe, expect, it } from 'vitest'

import type { Facts } from '@/components/editor/edit-panel/target.ts'

import {
  colourPickedIn,
  type Control,
  framePanelOf,
  headedSections,
  ONLY_ACTS,
  type PanelLayout,
  panelOf,
  type Selected,
  showsSwitcher,
  type SwitcherTab,
} from './tabs.ts'

const FACTS: Facts = {
  ownShape: null,
  inFlow: false,
  placed: false,
  lines: false,
  eachCorner: false,
  booleans: false,
  boxes: false,
  masks: false,
  sized: true,
  texts: true,
  anyText: true,
  shapesOrBoxes: false,
  locked: [],
}
const text = (over: Partial<Selected> = {}): Selected => ({
  kind: 'text',
  facts: FACTS,
  several: false,
  viewOnly: false,
  ...over,
})
const locked = (over: Partial<Selected> = {}) => text({ facts: { ...FACTS, locked: ['t'] }, ...over })
/** A headline and a badge selected together: mixed kinds, a text among them. */
const headlineAndBadge = (over: Partial<Selected> = {}) =>
  text({ kind: 'mixed', several: true, facts: { ...FACTS, texts: false }, ...over })
/** A photo and a shape selected together: mixed kinds, no text among them. */
const noText = (over: Partial<Selected> = {}) =>
  text({ kind: 'mixed', several: true, facts: { ...FACTS, texts: false, anyText: false }, ...over })
const tabsOf = (layout: PanelLayout) => layout.switcherTabs.map((one) => one.id)
/** The Arrange switcher tab's sections. */
const arrangeOf = (layout: PanelLayout) => layout.switcherTabs.find((one) => one.id === 'arrange')?.sections
/** A selection of `kind`, with its facts changed by `facts`. */
const of = (kind: Selected['kind'], facts: Partial<Facts> = {}, over: Partial<Selected> = {}): Selected =>
  text({ kind, facts: { ...FACTS, texts: kind === 'text', anyText: kind === 'text', ...facts }, ...over })
/** The switcher tab `id` of a layout, if it has one. */
const tabOf = (layout: PanelLayout, id: string) => layout.switcherTabs.find((one) => one.id === id)
/** The ids of the sections of switcher tab `id` for `selected`, in order. */
const sectionsOf = (selected: Selected, id: string) =>
  tabOf(panelOf(selected), id)?.sections.map((section) => section.id)

/** Shapes: of one own shape (`ownShape`), or of no shape with settings of its own. */
const shapes = (ownShape: Facts['ownShape'], over: Partial<Facts> = {}, several = false): Selected => ({
  kind: 'shape',
  facts: {
    ...FACTS,
    texts: false,
    anyText: false,
    ownShape,
    lines: ownShape === 'line',
    eachCorner: ownShape === 'rect',
    ...over,
  },
  several,
  viewOnly: false,
})
/** Photos: one, or with `several`, more; held in a box with `boxes`. */
const photos = (several = false, facts: Partial<Facts> = {}, over: Partial<Selected> = {}): Selected =>
  of('photo', { ownShape: 'rect', eachCorner: true, ...facts }, { several, ...over })
/** Boxes: one, or with `several`, more. */
const boxes = (several = false, over: Partial<Selected> = {}): Selected => ({
  kind: 'box',
  facts: { ...FACTS, texts: false, anyText: false, boxes: true, eachCorner: true },
  several,
  viewOnly: false,
  ...over,
})
/**
 * The switcher tabs of a selection, each as its id and, but for Arrange, its sections' ids; Style
 * left out, whose sections `panelOf’s Style` checks.
 */
const kindsTabsOf = (selected: Selected) =>
  panelOf(selected)
    .switcherTabs.filter((one) => one.id !== 'style')
    .map((one) => (one.id === 'arrange' ? ['arrange'] : [one.id, one.sections.map((section) => section.id)]))

/** The key map: each key of the spec's key map, and its one home in the edit panel. */
const KEY_MAP: Record<Control, string> = {
  locked: 'header',
  unlock: 'header',
  shape: 'shape › shape',
  combine: 'shape › combine',
  'combine-shapes': 'shape › combine-shapes',
  box: 'layout › layout',
  replace: 'image › photo',
  crop: 'image › photo',
  fit: 'image › fit',
  edit: 'image › edit',
  position: 'arrange › position',
  flip: 'arrange › position',
  order: 'arrange › order',
  'line-up-frame': 'arrange › line-up',
  'line-up': 'arrange › line-up',
  group: 'arrange › wrap-in',
  boxSelection: 'arrange › wrap-in',
  font: 'text › font',
  size: 'text › font',
  'text-style': 'text › font',
  align: 'text › paragraph',
  list: 'text › paragraph',
  case: 'text › paragraph',
  curve: 'text › curve-bounce',
  spacing: 'text › spacing',
  features: 'text › features',
  mask: 'style › mask',
  colour: 'style › colour',
  corners: 'style › corners',
  outline: 'style › outline',
  transparency: 'style › transparency',
  effects: 'style › effects',
  background: 'background › background',
  'frame-position': 'arrange › frame-position',
  'frame-more': 'header',
}
/** A picked frame's switcher tabs: Background, then Arrange with its size and place. */
const FRAME_TABS = [
  { id: 'background', sections: [{ id: 'background', controls: ['background'] }] },
  { id: 'arrange', sections: [{ id: 'frame-position', controls: ['frame-position'] }] },
]
/** Arrange's sections for one layer, and for several, while the tab may edit the design. */
const ONE_ARRANGE = [
  { id: 'position', controls: ['position', 'flip'] },
  { id: 'order', controls: ['order'] },
  { id: 'line-up', controls: ['line-up-frame'] },
]
const SEVERAL_ARRANGE = [
  { id: 'line-up', controls: ['line-up'] },
  { id: 'wrap-in', controls: ['group', 'boxSelection'] },
  { id: 'position', controls: ['position', 'flip'] },
  { id: 'order', controls: ['order'] },
]

/** Each control the panel shows, with every place it shows in: `header`, or `<switcher tab> › <section>`. */
function homesOf<Id extends string>(layout: PanelLayout<Id>) {
  const homes = new Map<Control, string[]>()
  const add = (control: Control, place: string) => homes.set(control, [...(homes.get(control) ?? []), place])
  for (const control of layout.header) add(control, 'header')
  for (const switcherTab of layout.switcherTabs)
    for (const section of switcherTab.sections)
      for (const control of section.controls) add(control, `${switcherTab.id} › ${section.id}`)
  return homes
}

describe('ONLY_ACTS', () => {
  it('names the controls that only act: unlock, combining several shapes, Flip, Order’s buttons, Line up, Group and Box', () => {
    expect([...ONLY_ACTS].sort()).toEqual(
      [
        'boxSelection',
        'combine-shapes',
        'crop',
        'flip',
        'group',
        'line-up',
        'line-up-frame',
        'order',
        'replace',
        'unlock',
      ].sort(),
    )
  })
})

describe('panelOf', () => {
  it('gives every selection Style, then Arrange, after a kind’s tab', () => {
    expect(tabsOf(panelOf(text()))).toEqual(['text', 'style', 'arrange'])
    expect(tabsOf(panelOf(headlineAndBadge()))).toEqual(['text', 'style', 'arrange'])
    expect(tabsOf(panelOf(shapes('star')))).toEqual(['shape', 'style', 'arrange'])
    expect(tabsOf(panelOf(boxes()))).toEqual(['layout', 'style', 'arrange'])
    for (const selected of [noText(), of('group'), shapes('rect')])
      expect(tabsOf(panelOf(selected))).toEqual(['style', 'arrange'])
  })

  it('gives one layer Arrange with Position and its flips, Order, then lining it up with the frame', () => {
    expect(arrangeOf(panelOf(text()))).toEqual(ONE_ARRANGE)
  })

  it('gives several layers Arrange with Line up and Group and Box first, then Position and Order', () => {
    expect(arrangeOf(panelOf(text({ kind: 'mixed', several: true })))).toEqual(SEVERAL_ARRANGE)
  })

  it("keeps a locked layer's Arrange sections, which turn themselves off but for Order", () => {
    expect(arrangeOf(panelOf(locked()))).toEqual(ONE_ARRANGE)
    expect(arrangeOf(panelOf(locked({ several: true })))).toEqual(SEVERAL_ARRANGE)
  })

  it('shows a tab that may only view Position alone in Arrange: no flips, Order, Line up, Group or Box', () => {
    const viewed = [{ id: 'position', controls: ['position'] }]
    expect(arrangeOf(panelOf(text({ viewOnly: true })))).toEqual(viewed)
    expect(arrangeOf(panelOf(text({ viewOnly: true, several: true })))).toEqual(viewed)
    expect(arrangeOf(panelOf(locked({ viewOnly: true, several: true })))).toEqual(viewed)
  })

  it('gives one or several texts the Text switcher tab first, with its Font, Paragraph, Curve and bounce, Spacing and Font features sections', () => {
    const textTab = {
      id: 'text',
      sections: [
        { id: 'font', controls: ['font', 'size', 'text-style'] },
        { id: 'paragraph', controls: ['align', 'list', 'case'] },
        { id: 'curve-bounce', controls: ['curve'] },
        { id: 'spacing', controls: ['spacing'] },
        { id: 'features', controls: ['features'] },
      ],
    }
    expect(panelOf(text()).switcherTabs[0]).toEqual(textTab)
    expect(panelOf(text({ several: true })).switcherTabs[0]).toEqual(textTab)
  })

  it('gives mixed layers with a text among them a Text switcher tab with only the font', () => {
    expect(panelOf(headlineAndBadge()).switcherTabs[0]).toEqual({
      id: 'text',
      sections: [{ id: 'font', controls: ['font'] }],
    })
    expect(arrangeOf(panelOf(headlineAndBadge()))).toEqual(SEVERAL_ARRANGE)
  })

  it('gives layers with no text among them no Text switcher tab', () => {
    expect(tabsOf(panelOf(noText()))).toEqual(['style', 'arrange'])
  })

  it("shows a locked layer's lock in the header, which unlocks it, and keeps Style and Arrange", () => {
    const layout = panelOf(locked())
    expect(layout.header).toEqual(['unlock'])
    expect(tabsOf(layout)).toEqual(['text', 'style', 'arrange'])
  })

  it('gives each section of Style the one control it is named for', () => {
    expect(tabOf(panelOf(of('shape', { ownShape: 'rect', masks: true })), 'style')?.sections).toEqual([
      { id: 'mask', controls: ['mask'] },
      { id: 'colour', controls: ['colour'] },
      { id: 'corners', controls: ['corners'] },
      { id: 'outline', controls: ['outline'] },
      { id: 'transparency', controls: ['transparency'] },
      { id: 'effects', controls: ['effects'] },
    ])
  })

  it('shows a tab that may only view the lock as it stands, without unlocking', () => {
    expect(panelOf(locked({ viewOnly: true })).header).toEqual(['locked'])
    expect(panelOf(text({ viewOnly: true })).header).toEqual([])
  })

  it('leaves every control that only acts out of a tab that may only view', () => {
    for (const selected of [
      locked({ viewOnly: true }),
      text({ viewOnly: true, several: true }),
      headlineAndBadge({ viewOnly: true }),
      { ...shapes('star', {}, true), viewOnly: true },
      { ...shapes(null, { booleans: true }, true), viewOnly: true },
      photos(false, {}, { viewOnly: true }),
      photos(true, { boxes: true }, { viewOnly: true }),
    ])
      for (const control of homesOf(panelOf(selected)).keys()) expect(ONLY_ACTS.has(control)).toBe(false)
  })

  it('puts each key of the key map in its one home, for every selection', () => {
    const cases = [
      text(),
      locked(),
      locked({ viewOnly: true }),
      text({ viewOnly: true }),
      text({ several: true }),
      locked({ several: true }),
      text({ viewOnly: true, several: true }),
      headlineAndBadge(),
      headlineAndBadge({ viewOnly: true }),
      noText(),
      shapes('star'),
      shapes('star', {}, true),
      shapes('polygon'),
      shapes('line'),
      shapes(null, { booleans: true }),
      shapes(null, { booleans: true }, true),
      shapes(null, {}, true),
      shapes('rect'),
      boxes(),
      boxes(true),
      { ...shapes(null, {}, true), viewOnly: true },
      of('shape', { ownShape: 'rect', masks: true }),
      of('photo', { ownShape: 'rect' }, { viewOnly: true }),
      of('mixed', { shapesOrBoxes: true }, { several: true }),
      photos(),
      photos(true),
      photos(false, { locked: ['p'] }),
    ]
    for (const selected of cases)
      for (const [control, places] of homesOf(panelOf(selected))) expect(places).toEqual([KEY_MAP[control]])
    expect(homesOf(panelOf(locked())).get('unlock')).toEqual(['header'])
    expect(homesOf(panelOf(locked({ viewOnly: true }))).get('locked')).toEqual(['header'])
    expect(homesOf(panelOf(text())).get('position')).toEqual(['arrange › position'])
    expect(homesOf(panelOf(text())).get('spacing')).toEqual(['text › spacing'])
    expect(homesOf(panelOf(text())).get('features')).toEqual(['text › features'])
    expect(homesOf(panelOf(headlineAndBadge())).get('font')).toEqual(['text › font'])
    const several = homesOf(panelOf(text({ several: true })))
    expect(several.get('line-up')).toEqual(['arrange › line-up'])
    expect(several.get('group')).toEqual(['arrange › wrap-in'])
    expect(several.get('boxSelection')).toEqual(['arrange › wrap-in'])
    expect(several.get('line-up-frame')).toBeUndefined()
    expect(homesOf(panelOf(text())).get('line-up')).toBeUndefined()
    const inBox = homesOf(panelOf(photos(false, { boxes: true })))
    expect(inBox.get('box')).toEqual(['image › layout'])
    for (const control of ['replace', 'crop', 'fit', 'edit'] as const)
      expect(inBox.get(control)).toEqual([KEY_MAP[control]])
  })

  it('shows a tab that may only view every text control, none of which only acts', () => {
    expect(panelOf(text({ viewOnly: true })).switcherTabs[0]).toEqual(panelOf(text()).switcherTabs[0])
  })

  it('gives a star its own settings in a Shape switcher tab, first', () => {
    expect(kindsTabsOf(shapes('star'))).toEqual([['shape', ['shape']], ['arrange']])
  })

  it('gives a rectangle, an ellipse or a drawn path no Shape switcher tab: a rectangle’s corners are in Style', () => {
    // An ellipse and a path have no shape with settings of its own.
    for (const selected of [shapes('rect'), shapes(null)]) expect(kindsTabsOf(selected)).toEqual([['arrange']])
  })

  it('gives a polygon its sides and a line its ends in the Shape switcher tab', () => {
    for (const selected of [shapes('polygon'), shapes('line')])
      expect(kindsTabsOf(selected)).toEqual([['shape', ['shape']], ['arrange']])
  })

  it('gives a combined shape its operation in the Shape switcher tab', () => {
    expect(kindsTabsOf(shapes(null, { booleans: true }))).toEqual([['shape', ['combine']], ['arrange']])
  })

  it('gives several stars their own settings, then Combine', () => {
    expect(kindsTabsOf(shapes('star', {}, true))).toEqual([['shape', ['shape', 'combine-shapes']], ['arrange']])
    expect(kindsTabsOf(shapes(null, { booleans: true }, true))).toEqual([
      ['shape', ['combine', 'combine-shapes']],
      ['arrange'],
    ])
  })

  it('gives several shapes of different kinds, or several rectangles, Combine only', () => {
    for (const selected of [shapes(null, {}, true), shapes('rect', {}, true)])
      expect(kindsTabsOf(selected)).toEqual([['shape', ['combine-shapes']], ['arrange']])
  })

  it('shows a tab that may only view the shape and the operation turned off, and not several shapes’ Combine', () => {
    const viewing = (selected: Selected) => kindsTabsOf({ ...selected, viewOnly: true })
    expect(viewing(shapes('star', {}, true))).toEqual([['shape', ['shape']], ['arrange']])
    expect(viewing(shapes(null, { booleans: true }))).toEqual([['shape', ['combine']], ['arrange']])
    expect(viewing(shapes(null, {}, true))).toEqual([['arrange']])
  })

  it('gives one box its layout in a Layout switcher tab, first, and several boxes none', () => {
    expect(kindsTabsOf(boxes())).toEqual([['layout', ['layout']], ['arrange']])
    expect(kindsTabsOf(boxes(true))).toEqual([['arrange']])
  })

  it('gives a photo the Image switcher tab first: Replace and Crop, Fit, then its filters and adjustments', () => {
    expect(tabsOf(panelOf(photos()))).toEqual(['image', 'style', 'arrange'])
    expect(tabOf(panelOf(photos()), 'image')?.sections).toEqual([
      { id: 'photo', controls: ['replace', 'crop'] },
      { id: 'fit', controls: ['fit'] },
      { id: 'edit', controls: ['edit'] },
    ])
    expect(tabsOf(panelOf(photos(false, { ownShape: null, eachCorner: false })))).toEqual(['image', 'style', 'arrange'])
  })

  it('gives several photos the Image switcher tab without Crop, which takes one photo', () => {
    expect(tabOf(panelOf(photos(true)), 'image')?.sections).toEqual([
      { id: 'photo', controls: ['replace'] },
      { id: 'fit', controls: ['fit'] },
      { id: 'edit', controls: ['edit'] },
    ])
  })

  it('gives one photo held in a box its box’s layout at the end of Image, and no Layout switcher tab', () => {
    expect(kindsTabsOf(photos(false, { boxes: true }))).toEqual([
      ['image', ['photo', 'fit', 'edit', 'layout']],
      ['arrange'],
    ])
    expect(tabOf(panelOf(photos(false, { boxes: true })), 'image')?.sections.at(-1)).toEqual({
      id: 'layout',
      controls: ['box'],
    })
    expect(tabsOf(panelOf(photos(false, { boxes: true })))).toEqual(['image', 'style', 'arrange'])
    expect(kindsTabsOf(photos(true, { boxes: true }))).toEqual([['image', ['photo', 'fit', 'edit']], ['arrange']])
  })

  it('shows a tab that may only view a photo’s Fit and its filters and adjustments, without Replace or Crop', () => {
    expect(kindsTabsOf(photos(false, {}, { viewOnly: true }))).toEqual([['image', ['fit', 'edit']], ['arrange']])
    expect(kindsTabsOf(photos(false, { boxes: true }, { viewOnly: true }))).toEqual([
      ['image', ['fit', 'edit', 'layout']],
      ['arrange'],
    ])
  })

  it('keeps a locked photo’s Image switcher tab whole, whose settings show turned off', () => {
    expect(kindsTabsOf(photos(false, { locked: ['p'] }))).toEqual(kindsTabsOf(photos()))
  })

  it('keeps a locked shape’s or box’s first switcher tab, whose settings show turned off', () => {
    const lockedOne = (selected: Selected) => kindsTabsOf({ ...selected, facts: { ...selected.facts, locked: ['s'] } })
    expect(lockedOne(shapes('star'))).toEqual(kindsTabsOf(shapes('star')))
    expect(lockedOne(boxes())).toEqual(kindsTabsOf(boxes()))
  })
})

describe('panelOf’s Style', () => {
  // One case per line of the spec's Style table, then a mask's and a rectangle's own lines.
  it.each([
    ['a text', of('text'), ['colour', 'transparency', 'effects']],
    ['a masking text', of('text', { masks: true }), ['mask', 'colour', 'transparency', 'effects']],
    ['a photo in a rectangle', of('photo', { ownShape: 'rect' }), ['corners', 'outline', 'transparency', 'effects']],
    ['a photo in an ellipse', of('photo'), ['outline', 'transparency', 'effects']],
    ['a photo in a box', of('photo', { boxes: true }), ['outline', 'transparency', 'effects']],
    [
      'a masking photo',
      of('photo', { ownShape: 'rect', masks: true }),
      ['mask', 'corners', 'outline', 'transparency', 'effects'],
    ],
    ['a rectangle', of('shape', { ownShape: 'rect' }), ['colour', 'corners', 'outline', 'transparency', 'effects']],
    ['a star', of('shape', { ownShape: 'star' }), ['colour', 'outline', 'transparency', 'effects']],
    ['a line', of('shape', { ownShape: 'line', lines: true }), ['outline', 'transparency', 'effects']],
    ['a combined shape', of('shape', { booleans: true }), ['colour', 'outline', 'transparency', 'effects']],
    ['a masking shape', of('shape', { masks: true }), ['mask', 'colour', 'outline', 'transparency', 'effects']],
    ['a box', of('box', { boxes: true }), ['colour', 'outline', 'transparency', 'effects']],
    [
      'a masking box',
      of('box', { boxes: true, masks: true }),
      ['mask', 'colour', 'outline', 'transparency', 'effects'],
    ],
    ['shapes and boxes', of('mixed', { shapesOrBoxes: true }), ['colour', 'outline', 'transparency', 'effects']],
    [
      'masking shapes and boxes',
      of('mixed', { shapesOrBoxes: true, masks: true }),
      ['mask', 'colour', 'outline', 'transparency', 'effects'],
    ],
    ['a group', of('group'), ['transparency', 'effects']],
    ['a masking group', of('group', { masks: true }), ['mask', 'transparency', 'effects']],
    ['a text and a shape', of('mixed'), ['transparency', 'effects']],
    ['a masking text and shape', of('mixed', { masks: true }), ['mask', 'transparency', 'effects']],
  ])('gives %s its row of sections', (_, selected, sections) => {
    expect(sectionsOf(selected, 'style')).toEqual(sections)
    expect(sectionsOf({ ...selected, several: true }, 'style')).toEqual(sections)
  })

  it('keeps every section for a locked layer and a tab that may only view, which see them turned off', () => {
    const rect = of('shape', { ownShape: 'rect', locked: ['r'] })
    const sections = ['colour', 'corners', 'outline', 'transparency', 'effects']
    expect(sectionsOf(rect, 'style')).toEqual(sections)
    expect(sectionsOf({ ...rect, viewOnly: true }, 'style')).toEqual(sections)
  })
})

describe('framePanelOf', () => {
  it("gives a picked frame Background, then Arrange with its size and place, and its actions in the header's ⋯", () => {
    expect(framePanelOf({ viewOnly: false })).toEqual({ header: ['frame-more'], switcherTabs: FRAME_TABS })
  })

  it('keeps the same panel for a tab that may only view, whose values turn off and whose ⋯ keeps Export and Copy as PNG', () => {
    expect(framePanelOf({ viewOnly: true })).toEqual({ header: ['frame-more'], switcherTabs: FRAME_TABS })
  })

  it('puts each of the frame’s keys of the key map in its one home', () => {
    for (const viewOnly of [false, true]) {
      const homes = homesOf(framePanelOf({ viewOnly }))
      expect([...homes.keys()].sort()).toEqual(['background', 'frame-more', 'frame-position'])
      for (const [control, places] of homes) expect(places).toEqual([KEY_MAP[control]])
    }
  })

  it('shows the switcher, as a picked frame has two switcher tabs', () => {
    expect(showsSwitcher(framePanelOf({ viewOnly: false }))).toBe(true)
  })
})

describe('showsSwitcher', () => {
  const arrange = {
    id: 'arrange',
    sections: [{ id: 'position', controls: ['position'] }],
  } as const satisfies SwitcherTab

  it('shows no switcher for one switcher tab, whose sections follow the header directly', () => {
    expect(showsSwitcher({ header: [], switcherTabs: [arrange] })).toBe(false)
  })

  it('shows the switcher for two switcher tabs or more, as every selection has with Style and Arrange', () => {
    expect(showsSwitcher(panelOf(text()))).toBe(true)
    expect(showsSwitcher(panelOf(noText()))).toBe(true)
    expect(showsSwitcher(panelOf(noText({ viewOnly: true })))).toBe(true)
    expect(showsSwitcher({ header: [], switcherTabs: [arrange, arrange] })).toBe(true)
  })
})

describe('headedSections', () => {
  /** The sections of a selection's first switcher tab that show a heading. */
  const headedOf = (selected: Selected) => {
    const [first] = panelOf(selected).switcherTabs
    return first ? [...headedSections(first)] : []
  }

  it('heads no section that stands alone in its switcher tab, which the tab already names', () => {
    for (const selected of [
      shapes('star'),
      shapes('line'),
      shapes(null, { booleans: true }),
      shapes(null, {}, true),
      boxes(),
    ])
      expect(headedOf(selected)).toEqual([])
  })

  it('heads Combine beside a shape’s own settings, which the Shape tab names, to tell them apart', () => {
    expect(headedOf(shapes('star', {}, true))).toEqual(['combine-shapes'])
    expect(headedOf(shapes(null, { booleans: true }, true))).toEqual(['combine', 'combine-shapes'])
  })

  it('heads a photo’s Fit and its box’s layout, but not Replace and Crop, which name themselves, or its filters and adjustments, which are headed inside', () => {
    expect(headedOf(photos())).toEqual(['fit'])
    expect(headedOf(photos(false, { boxes: true }))).toEqual(['fit', 'layout'])
  })
})

describe('colourPickedIn', () => {
  it('sends Shift+I to Style for a selection whose Style shows a colour', () => {
    for (const selected of [
      of('text'),
      of('shape', { ownShape: 'rect' }),
      of('box'),
      of('mixed', { shapesOrBoxes: true }),
    ])
      expect(colourPickedIn(selected)).toBe('style')
  })

  it('sends it nowhere for a selection with no colour, a locked layer, or a tab that may only view', () => {
    for (const selected of [
      of('photo'),
      of('shape', { ownShape: 'line', lines: true }),
      of('group'),
      of('mixed'),
      of('text', { locked: ['t'] }),
      of('text', {}, { viewOnly: true }),
    ])
      expect(colourPickedIn(selected)).toBeNull()
  })
})
