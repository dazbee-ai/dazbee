// Two tabs binding, unbinding and editing one layer at once, each case in both server orders: the
// tab named later stays offline until both have run, so the server orders its change set second.
// Each binding is a value of its own, so the tabs keep each other's, and a binding still there
// draws its token's value. Each case ends with the end checks.
import { afterEach, describe, expect, it } from 'vitest'

import {
  BINDABLE_PROPERTIES,
  type BindableProperty,
  bindProps,
  type DesignInput,
  type Layer,
  type TextLook,
  type Variables,
  type VariableValue,
} from '@dazbee/schema'

import { testDesign } from './test-design.ts'
import { closeTabs, deliver, endChecks, type SimTab, type Tabs, tabsOn } from './test-tabs.ts'

/** What the end checks find when nothing is lost. */
const CLEAN = { leftOut: [], repaired: [], missing: [] }

/** The Headline text style's look, as the kit gives it. */
const HEADLINE: TextLook = {
  fontFamily: 'Playfair Display',
  fontWeight: 700,
  fontStyle: 'normal',
  lineHeight: 1.1,
  letterSpacing: { unit: 'percent', value: -1 },
}

/** The brand kit's tokens, as the tabs draw them. */
const VARIABLES: Variables = {
  'brand:headline': HEADLINE,
  'brand:primary': '#FF5A36FF',
  'brand:accent': '#00AA00FF',
  'brand:ink': '#111111FF',
  'brand:heading': 'Noto Sans',
  'brand:body': 'Inter',
}

/** The test design, with the box's fill bound to the primary colour and the headline's font to the heading font. */
const boundDesign = (): DesignInput => {
  const design = testDesign()
  Object.assign(design.nodes.box as object, { bindings: { fill: 'brand:primary' } })
  Object.assign(design.nodes.headline as object, { bindings: { fontFamily: 'brand:heading' } })
  return design
}

type Session = SimTab['session']

/** The tabs each test opened, closed after it. */
const opened: Tabs[] = []
afterEach(() => {
  for (const world of opened.splice(0)) closeTabs(world)
})

/**
 * Two tabs on `design`: A runs `inA` and B runs `inB`, with the tab `later` offline until both
 * have run, so the server orders its change set after the other's; then everything is delivered.
 */
async function crossing(design: DesignInput, later: 'A' | 'B', inA: (a: Session) => void, inB: (b: Session) => void) {
  const world = await tabsOn(design, 2)
  opened.push(world)
  const [a, b] = (world.tabs as [SimTab, SimTab]).map((tab) => tab.session) as [Session, Session]
  world.sim.disconnect(later === 'A' ? 0 : 1)
  inA(a)
  inB(b)
  await world.sim.settle()
  world.sim.reconnect(later === 'A' ? 0 : 1)
  await deliver(world)
  return { world, a, b }
}

/** Layer `id` as tab `tab` holds it. */
const layerIn = (tab: Session, id: string) => tab.design().nodes[id] as Layer

/** The value `property` of layer `id` draws with the brand kit's tokens. */
function drawn(tab: Session, id: string, property: BindableProperty): VariableValue | undefined {
  const layer = layerIn(tab, id)
  return BINDABLE_PROPERTIES[property].read(bindProps(layer.type, layer.props, layer.bindings, VARIABLES))
}

/** Checks that both tabs hold `bindings` on layer `id`, and that each draws its token's value. */
function expectBound(tabs: Session[], id: string, bindings: Partial<Record<BindableProperty, string>>) {
  for (const tab of tabs) {
    expect(layerIn(tab, id).bindings ?? {}).toEqual(bindings)
    for (const [property, ref] of Object.entries(bindings))
      expect(drawn(tab, id, property as BindableProperty)).toEqual(VARIABLES[ref])
  }
}

for (const later of ['A', 'B'] as const) {
  describe(`two tabs on one layer, ${later} ordered later`, () => {
    it('A binds a text’s colour while B binds its font: both bound', async () => {
      const { world, a, b } = await crossing(
        testDesign(),
        later,
        (tab) =>
          tab.run('node.bind', { ids: ['headline'], property: 'textColor', ref: 'brand:ink', value: '#111111FF' }),
        (tab) => tab.run('node.bind', { ids: ['headline'], property: 'fontFamily', ref: 'brand:body', value: 'Inter' }),
      )
      expectBound([a, b], 'headline', { textColor: 'brand:ink', fontFamily: 'brand:body' })
      expect(await endChecks(world)).toEqual(CLEAN)
    })

    it('A recolours a bound fill by hand while B binds it to another token: the later step’s colour and binding', async () => {
      const { world, a, b } = await crossing(
        boundDesign(),
        later,
        (tab) => tab.run('node.update', { ids: ['box'], patch: { fills: [{ type: 'solid', color: '#14213DFF' }] } }),
        (tab) => tab.run('node.bind', { ids: ['box'], property: 'fill', ref: 'brand:accent', value: '#00AA00FF' }),
      )
      expectBound([a, b], 'box', later === 'A' ? {} : { fill: 'brand:accent' })
      for (const tab of [a, b])
        expect(layerIn(tab, 'box').props).toMatchObject({
          fills: [{ color: later === 'A' ? '#14213DFF' : '#00AA00FF' }],
        })
      expect(await endChecks(world)).toEqual(CLEAN)
    })

    it('A recolours a text by hand while B binds its font: the font bound, the colour unbound, either way', async () => {
      const design = boundDesign()
      Object.assign(design.nodes.headline as object, {
        bindings: { textColor: 'brand:ink', fontFamily: 'brand:heading' },
      })
      const { world, a, b } = await crossing(
        design,
        later,
        (tab) => {
          const { style } = layerIn(tab, 'headline').props as { style: object }
          tab.run('node.update', { ids: ['headline'], patch: { style: { ...style, color: '#14213DFF' } } })
        },
        (tab) => tab.run('node.bind', { ids: ['headline'], property: 'fontFamily', ref: 'brand:body', value: 'Inter' }),
      )
      expectBound([a, b], 'headline', { fontFamily: 'brand:body' })
      // The style is one value: the later step's colour is the one kept.
      for (const tab of [a, b])
        expect(drawn(tab, 'headline', 'textColor')).toBe(later === 'A' ? '#14213DFF' : '#111111FF')
      expect(await endChecks(world)).toEqual(CLEAN)
    })

    it('A changes a bound text’s letter spacing while B binds its colour: the colour bound either way', async () => {
      const { world, a, b } = await crossing(
        boundDesign(),
        later,
        (tab) => {
          const { style } = layerIn(tab, 'headline').props as { style: object }
          tab.run('node.update', {
            ids: ['headline'],
            patch: { style: { ...style, letterSpacing: { unit: 'px', value: 4 } } },
          })
        },
        (tab) =>
          tab.run('node.bind', { ids: ['headline'], property: 'textColor', ref: 'brand:accent', value: '#00AA00FF' }),
      )
      expectBound([a, b], 'headline', { fontFamily: 'brand:heading', textColor: 'brand:accent' })
      expect(await endChecks(world)).toEqual(CLEAN)
    })

    it('A binds a text’s style while B sets its font by hand: the style bound and drawn either way', async () => {
      const { world, a, b } = await crossing(
        boundDesign(),
        later,
        (tab) =>
          tab.run('node.bind', { ids: ['headline'], property: 'textStyle', ref: 'brand:headline', value: HEADLINE }),
        (tab) => {
          const { style } = layerIn(tab, 'headline').props as { style: object }
          tab.run('node.update', { ids: ['headline'], patch: { style: { ...style, fontFamily: 'Lora' } } })
        },
      )
      expectBound([a, b], 'headline', { textStyle: 'brand:headline' })
      // The style is one value: the later step's is stored, and the binding draws the kit's look over it.
      for (const tab of [a, b])
        expect(layerIn(tab, 'headline').props).toMatchObject({
          style: { fontFamily: later === 'A' ? 'Playfair Display' : 'Lora' },
        })
      expect(await endChecks(world)).toEqual(CLEAN)
    })

    it('A binds a text’s style while B binds its font: the style alone, or both drawn in the style’s look', async () => {
      const { world, a, b } = await crossing(
        boundDesign(),
        later,
        (tab) =>
          tab.run('node.bind', { ids: ['headline'], property: 'textStyle', ref: 'brand:headline', value: HEADLINE }),
        (tab) => tab.run('node.bind', { ids: ['headline'], property: 'fontFamily', ref: 'brand:body', value: 'Inter' }),
      )
      // A ends the font binding it saw; B, ordered later, binds the font again over A's style.
      const bindings =
        later === 'A' ? { textStyle: 'brand:headline' } : { textStyle: 'brand:headline', fontFamily: 'brand:body' }
      for (const tab of [a, b]) {
        expect(layerIn(tab, 'headline').bindings).toEqual(bindings)
        expect(drawn(tab, 'headline', 'textStyle')).toEqual(HEADLINE)
      }
      expect(await endChecks(world)).toEqual(CLEAN)
    })

    it('A unbinds a fill while B changes the fill paint’s own opacity: unbound, with B’s opacity', async () => {
      const { world, a, b } = await crossing(
        boundDesign(),
        later,
        (tab) => tab.run('node.bind', { ids: ['box'], property: 'fill', ref: null }),
        (tab) =>
          tab.run('node.update', {
            ids: ['box'],
            patch: { fills: [{ type: 'solid', color: '#FF5A36FF', opacity: 0.5 }] },
          }),
      )
      expectBound([a, b], 'box', {})
      for (const tab of [a, b])
        expect(layerIn(tab, 'box').props).toMatchObject({ fills: [{ color: '#FF5A36FF', opacity: 0.5 }] })
      expect(await endChecks(world)).toEqual(CLEAN)
    })

    it('A ends a layer’s only binding while B binds another of its properties: the other bound', async () => {
      const { world, a, b } = await crossing(
        boundDesign(),
        later,
        (tab) => tab.run('node.bind', { ids: ['headline'], property: 'fontFamily', ref: null }),
        (tab) =>
          tab.run('node.bind', { ids: ['headline'], property: 'textColor', ref: 'brand:ink', value: '#111111FF' }),
      )
      expectBound([a, b], 'headline', { textColor: 'brand:ink' })
      expect(await endChecks(world)).toEqual(CLEAN)
    })
  })
}
