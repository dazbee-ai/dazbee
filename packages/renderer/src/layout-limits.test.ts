// The least and most width and height of layers auto layout sizes, through scene building, with the
// stand-in measure of test-layout.ts.
import { describe, expect, it } from 'vitest'

import { box, boxLayer, laidOut, layout, type Node, PAD, rect, scene, text } from './test-layout.ts'

/** A row 500 wide and 200 tall, nothing around or between, holding `children` by id. */
function row(children: Record<string, Node>, props: Record<string, unknown> = {}) {
  return scene({ r: boxLayer('sq', 'a0', { ...box(0, 0, 500, 200), layout: layout(props) }), ...children })
}
const tile = (index: string, width: number, height: number, props: Record<string, unknown> = {}) =>
  rect('r', index, { ...box(0, 0, width, height), ...props })
const fill = (axis: 'width' | 'height') => ({
  sizing: { width: axis === 'width' ? 'fill' : 'fixed', height: axis === 'height' ? 'fill' : 'fixed' },
})

describe('limits', () => {
  it('holds a fixed layer in a flow between its least and most, the least winning where they cross', () => {
    const get = row({
      a: tile('a0', 300, 300, { maxWidth: 200, maxHeight: 100 }),
      b: tile('a1', 10, 10, { minWidth: 50, minHeight: 30 }),
      c: tile('a2', 100, 10, { minWidth: 120, maxWidth: 80 }),
    })
    expect(get('a')).toEqual(box(0, 0, 200, 100))
    expect(get('b')).toEqual(box(200, 0, 50, 30))
    expect(get('c')).toEqual(box(250, 0, 120, 10))
  })

  it('wraps a text that fits its words at its most width, drawn as Auto height there; at its least, as wide as that', () => {
    const all = laidOut({
      r: boxLayer('sq', 'a0', { ...box(0, 0, 500, 200), layout: layout({}) }),
      long: text('r', 'a0', 'Buy now and save', { maxWidth: 100 }),
      short: text('r', 'a1', 'Buy', { minWidth: 80 }),
      free: text('r', 'a2', 'Shop'),
    })
    const props = (id: string) => all.get(id)?.props as { width: number; height: number; boxMode: string }
    // "Buy now" is 70 wide, and "and" would take it past 100.
    expect(props('long')).toMatchObject({ width: 100, height: 40, boxMode: 'autoHeight' })
    expect(props('short')).toMatchObject({ width: 80, height: 20, boxMode: 'autoHeight' })
    expect(props('free')).toMatchObject({ width: 40, height: 20, boxMode: 'autoWidth' })
  })

  it('gives a curved text the size of its curve in a row, whatever its Fill sizing and limits', () => {
    const curve = { shape: 'arcUp', amount: 50 }
    const get = row({
      a: text('r', 'a0', 'Badge', { curve, sizing: { width: 'fill', height: 'fill' }, minWidth: 300, maxHeight: 5 }),
      b: tile('a1', 10, 10, fill('width')),
    })
    // The stand-in measures "Badge" as 50 by 20, the curve's size it gives every text.
    expect(get('a')).toEqual(box(0, 0, 50, 20))
    expect(get('b')).toEqual(box(50, 0, 450, 10))
  })

  it('shares the room along the flow by turns, a layer held at a limit keeping it and the rest sharing what is left', () => {
    const most = row({
      a: tile('a0', 10, 10, { ...fill('width'), maxWidth: 100 }),
      b: tile('a1', 10, 10, fill('width')),
      c: tile('a2', 10, 10, fill('width')),
    })
    expect([most('a').width, most('b').width, most('c').width]).toEqual([100, 200, 200])
    const least = row({
      a: tile('a0', 10, 10, { ...fill('width'), minWidth: 300 }),
      b: tile('a1', 10, 10, fill('width')),
      c: tile('a2', 10, 10, fill('width')),
    })
    expect([least('a').width, least('b').width, least('c').width]).toEqual([300, 100, 100])
  })

  it('holds a layer filling across the flow to its limits', () => {
    const get = row({ a: tile('a0', 10, 10, { ...fill('height'), maxHeight: 50 }) }, { align: 'center' })
    expect(get('a')).toEqual(box(0, 75, 10, 50))
  })

  it('holds a grid cell’s filling layer to its most, lined up in the cell', () => {
    const get = scene({
      g: boxLayer('sq', 'a0', {
        ...box(0, 0, 400, 100),
        layout: layout({ direction: 'grid', columns: 2, justify: 'center' }),
      }),
      a: rect('g', 'a0', { ...box(0, 0, 10, 10), ...fill('width'), maxWidth: 150 }),
    })
    expect(get('a')).toEqual(box(25, 0, 150, 10))
  })

  it('holds a laid-out box’s own size to its limits, whether it fits what it holds or keeps its size', () => {
    const get = scene({
      hug: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        maxWidth: 200,
        minHeight: 60,
        layout: layout({}),
      }),
      wide: rect('hug', 'a0', box(0, 0, 300, 20)),
      kept: boxLayer('sq', 'a1', { ...box(0, 300, 500, 50), maxWidth: 400, layout: layout({ padding: PAD(0) }) }),
      grow: rect('kept', 'a0', { ...box(0, 0, 10, 10), ...fill('width') }),
    })
    expect(get('hug')).toEqual(box(0, 0, 200, 60))
    expect(get('kept')).toEqual(box(0, 300, 400, 50))
    expect(get('grow')).toEqual(box(0, 300, 400, 10))
  })

  it('stretches a layer filling across a box that fits it to the box as its limits hold it', () => {
    const get = scene({
      r: boxLayer('sq', 'a0', {
        ...box(0, 0, 500, 10),
        sizing: { width: 'fixed', height: 'hug' },
        minHeight: 200,
        layout: layout({}),
      }),
      a: rect('r', 'a0', box(0, 0, 40, 40)),
      f: rect('r', 'a1', { ...box(0, 0, 40, 10), ...fill('height') }),
    })
    expect(get('r').height).toBe(200)
    expect(get('f')).toEqual(box(40, 0, 40, 200))
  })

  it('fits a column’s height to what it holds once its own limits set the width its layers fill', () => {
    const column = (limits: Record<string, number>, wide: number) =>
      scene({
        c: boxLayer('sq', 'a0', {
          ...box(0, 0, 10, 10),
          sizing: { width: 'hug', height: 'hug' },
          ...limits,
          layout: layout({ direction: 'column' }),
        }),
        r: rect('c', 'a0', box(0, 0, wide, 20)),
        t: text('c', 'a1', 'aaaa bbbb cccc dddd', { boxMode: 'autoHeight', sizing: { width: 'fill', height: 'hug' } }),
      })
    const most = column({ maxWidth: 100 }, 200)
    expect(most('t')).toEqual(box(0, 20, 100, 40))
    expect(most('c')).toEqual(box(0, 0, 100, 60))
    const least = column({ minWidth: 300 }, 90)
    expect(least('t')).toEqual(box(0, 20, 300, 20))
    expect(least('c')).toEqual(box(0, 0, 300, 40))
  })

  it('leaves a box with no limits that its negative padding makes less than nothing as it is', () => {
    const get = scene({
      r: boxLayer('sq', 'a0', {
        ...box(0, 0, 500, 10),
        sizing: { width: 'fixed', height: 'hug' },
        layout: layout({ padding: { top: -30, right: 0, bottom: -30, left: 0 } }),
      }),
      a: rect('r', 'a0', box(0, 0, 40, 40)),
      f: rect('r', 'a1', { ...box(0, 0, 40, 10), ...fill('height') }),
    })
    expect(get('r').height).toBe(-20)
    expect(get('f').height).toBe(40)
  })

  it('draws a text that fits its words but keeps its height in its kept box at the width its limit holds', () => {
    const all = laidOut({
      r: boxLayer('sq', 'a0', { ...box(0, 0, 500, 200), layout: layout({}) }),
      t: text('r', 'a0', 'Buy now and save', {
        height: 20,
        sizing: { width: 'hug', height: 'fixed' },
        maxWidth: 100,
      }),
    })
    expect(all.get('t')?.props).toMatchObject({ width: 100, height: 20, boxMode: 'fixed' })
  })

  it('holds a turned layer at its own size, taking the room of its turned bounds', () => {
    const all = laidOut({
      r: boxLayer('sq', 'a0', { ...box(0, 0, 500, 200), layout: layout({}) }),
      a: tile('a0', 300, 100, { rotation: 90, maxWidth: 200 }),
      b: tile('a1', 10, 10),
    })
    expect(all.get('a')?.props).toMatchObject({ width: 200, height: 100 })
    // Turned a quarter, it takes 100 along the row.
    expect(all.get('b')?.props.x).toBe(100)
  })

  it('leaves a layer no flow places at its own size', () => {
    const get = scene({
      free: boxLayer('sq', 'a0', box(0, 0, 500, 200)),
      a: rect('free', 'a0', { ...box(0, 0, 100, 100), maxWidth: 50 }),
      b: rect('sq', 'a1', { ...box(0, 0, 100, 100), maxWidth: 50 }),
    })
    expect(get('a').width).toBe(100)
    expect(get('b').width).toBe(100)
  })
})
