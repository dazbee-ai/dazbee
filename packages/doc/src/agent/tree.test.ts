// The compact tree an agent reads a frame through: the outline of its layers, the props `fields`
// adds, and the cut a size budget makes in long lists of layers.
import { describe, expect, it } from 'vitest'

import { type DesignInput, parseDesign } from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import { compactTree } from './tree.ts'

const designOf = (input: DesignInput) => {
  const result = parseDesign(input)
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}

/** The linked design with the square's title hidden and its price holding a long text. */
const nested = () => {
  const input = linkedDesign()
  const nodes = input.nodes as Record<string, { props: Record<string, unknown> }>
  nodes['title'] = { ...nodes['title'], props: { ...nodes['title']?.props, visible: false } } as never
  nodes['price'] = { ...nodes['price'], props: { ...nodes['price']?.props, text: 'é'.repeat(130) } } as never
  return designOf(input)
}

/** A frame holding `count` rectangles, each named after its place. */
const crowded = (count: number) => {
  const input = linkedDesign()
  const nodes: Record<string, unknown> = {}
  for (let i = 0; i < count; i++)
    nodes[`r${i}`] = {
      type: 'graphic',
      parentId: 'other',
      link: `r${i}`,
      index: `a${String(i).padStart(3, '0')}`,
      name: `Rect ${i}`,
      props: { x: i, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
    }
  return designOf({ ...input, nodes: nodes as DesignInput['nodes'] })
}

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

describe('compactTree', () => {
  it('gives the outline of a nested frame: id, name, type, visible and text, back to front', () => {
    expect(compactTree(nested(), 'sq')).toEqual({
      id: 'sq',
      name: 'Square',
      type: 'frame',
      width: 1080,
      height: 1080,
      children: [
        { id: 'bg', name: 'bg', type: 'graphic', visible: true },
        {
          id: 'grp',
          name: 'Group',
          type: 'group',
          visible: true,
          children: [
            { id: 'title', name: 'title', type: 'text', visible: false, text: 'title' },
            { id: 'price', name: 'price', type: 'text', visible: true, text: `${'é'.repeat(120)}...` },
          ],
        },
        { id: 'badge', name: 'badge', type: 'graphic', visible: true },
      ],
    })
  })

  it('adds the props `fields` names to each layer that has them, a text in full', () => {
    const tree = compactTree(nested(), 'sq', { fields: ['x', 'width', 'text', 'role'] })
    expect(tree.children?.[0]).toEqual({ id: 'bg', name: 'bg', type: 'graphic', visible: true, x: 0, width: 1080 })
    expect(tree.children?.[1]?.children?.[1]).toEqual({
      id: 'price',
      name: 'price',
      type: 'text',
      visible: true,
      x: 100,
      width: 200,
      text: 'é'.repeat(130),
    })
  })

  it('reads fontSize, fontFamily and fontWeight as a text’s style parts', () => {
    const tree = compactTree(nested(), 'sq', { fields: ['fontSize', 'fontFamily', 'fontWeight'] })
    expect(tree.children?.[0]).toEqual({ id: 'bg', name: 'bg', type: 'graphic', visible: true })
    expect(tree.children?.[1]?.children?.[0]).toMatchObject({
      id: 'title',
      fontSize: 60,
      fontFamily: 'Noto Sans',
      fontWeight: 400,
    })
  })

  it('leaves out a field no layer has, reading the others', () => {
    const tree = compactTree(nested(), 'sq', { fields: ['colour', 'x'] })
    expect(tree.children?.[0]).toEqual({ id: 'bg', name: 'bg', type: 'graphic', visible: true, x: 0 })
  })

  it('refuses a frame the design does not have, a name every object has too', () => {
    expect(() => compactTree(nested(), 'nowhere')).toThrow(/no frame "nowhere"/)
    expect(() => compactTree(nested(), 'constructor')).toThrow(/no frame "constructor"/)
  })

  it('cuts long lists of layers to fit the budget, saying how many were left out', () => {
    const design = crowded(200)
    const whole = compactTree(design, 'other')
    expect(whole.children).toHaveLength(200)
    const maxBytes = Math.floor(bytesOf(whole) / 4)
    const cut = compactTree(design, 'other', { maxBytes })
    expect(bytesOf(cut)).toBeLessThanOrEqual(maxBytes)
    const shown = cut.children?.length ?? 0
    expect(shown).toBeGreaterThan(0)
    expect(cut.children?.[0]?.id).toBe('r0')
    expect(cut.notShown).toBe(200 - shown)
  })

  it('leaves a tree inside its budget whole, with no marker', () => {
    const tree = compactTree(nested(), 'sq', { maxBytes: 100_000 })
    expect(tree.children).toHaveLength(3)
    expect(JSON.stringify(tree)).not.toContain('notShown')
  })

  it('cuts only the lists longer than the cap, keeping short ones whole', () => {
    const input = linkedDesign()
    const nodes = { ...input.nodes } as Record<string, unknown>
    for (let i = 0; i < 50; i++)
      nodes[`s${i}`] = {
        type: 'graphic',
        parentId: 'grp',
        link: `s${i}`,
        index: `b${String(i).padStart(3, '0')}`,
        name: `Spot ${i}`,
        props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'ellipse' } },
      }
    const design = designOf({ ...input, nodes: nodes as DesignInput['nodes'] })
    const whole = compactTree(design, 'sq')
    const cut = compactTree(design, 'sq', { maxBytes: bytesOf(whole) - 200 })
    expect(cut.children).toHaveLength(3)
    expect(cut.notShown).toBeUndefined()
    const group = cut.children?.[1]
    expect((group?.children?.length ?? 0) + (group?.notShown ?? 0)).toBe(52)
    expect(group?.notShown).toBeGreaterThan(0)
  })
})
