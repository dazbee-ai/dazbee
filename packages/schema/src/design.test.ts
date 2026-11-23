import { describe, expect, it } from 'vitest'

import { checkStructure, DesignMeta, hasGuides, imageAssetIds, MAX_GUIDES, parseDesign } from './design.ts'
import { minimal, storedText } from './test-design.ts'

const errorsFor = (mutate: (d: ReturnType<typeof minimal>) => void) => {
  const d = minimal()
  mutate(d)
  const result = parseDesign(d)
  return result.success ? [] : result.errors
}

const white = [{ type: 'solid', color: '#FFFFFFFF' }]

/** The frame `banner` beside `sq` on `p1`, placed by the frame rule. */
const banner = { pageId: 'p1', name: 'Banner', width: 320, height: 50, x: 1280, y: 0, fills: white, order: 'a1' }

const group = (parentId: string, link: string) => ({
  type: 'group',
  parentId,
  link,
  index: 'a0',
  name: 'G',
  props: { x: 0, y: 0, width: 10, height: 10 },
})

describe('parseDesign', () => {
  it('accepts a minimal design and fills in defaults', () => {
    const result = parseDesign(minimal())
    expect(result.success).toBe(true)
    if (!result.success) return
    const box = result.design.nodes.r1
    expect(box?.props.opacity).toBe(1)
    expect(box?.props.rotation).toBe(0)
    expect(box?.props.visible).toBe(true)
    expect(box?.link).toBe('r1')
  })

  it('reads a design whose text was stored before letter spacing had a unit, carried over', () => {
    const design = parseDesign({ ...minimal(), nodes: { ...minimal().nodes, t1: storedText() } })
    if (!design.success) throw new Error(design.errors.join('; '))
    expect(design.design.nodes.t1).toMatchObject({
      props: { runs: [{ style: { letterSpacing: { unit: 'px', value: -1 }, fontSize: 30 } }] },
    })
  })

  it('keeps no schema version in a design’s meta, which the API’s record of the design holds', () => {
    expect(Object.keys(DesignMeta.shape)).toEqual(['designId', 'name'])
  })

  it('gives a frame without fills an empty background', () => {
    const d = minimal()
    delete (d.frames.sq as { fills?: unknown }).fills
    const result = parseDesign(d)
    if (!result.success) throw new Error(result.errors.join('\n'))
    expect(result.design.frames.sq?.fills).toEqual([])
  })

  it('rejects a frame whose size is not whole pixels', () => {
    expect(
      errorsFor((d) => {
        d.frames.sq.width = 100.5
      }),
    ).toEqual(['frames.sq.width: Invalid input: expected int, received number'])
  })

  it('keeps a frame’s guides, and gives a frame without them none', () => {
    const d = minimal()
    const guides = [
      { axis: 'x', at: 540 },
      { axis: 'y', at: 0 },
    ]
    const result = parseDesign({ ...d, frames: { sq: { ...d.frames.sq, guides }, banner } })
    if (!result.success) throw new Error(result.errors.join('\n'))
    expect(result.design.frames.sq?.guides).toEqual(guides)
    expect(result.design.frames.banner).not.toHaveProperty('guides')
  })

  it('rejects a guide off whole pixels, on no axis or past the cap of guides', () => {
    const withGuides = (guides: unknown[]) =>
      errorsFor((d) => {
        Object.assign(d.frames.sq, { guides })
      })
    expect(withGuides([{ axis: 'x', at: 10.5 }])).toEqual([
      'frames.sq.guides.0.at: Invalid input: expected int, received number',
    ])
    expect(withGuides([{ axis: 'y', at: Infinity }])).toHaveLength(1)
    expect(withGuides([{ axis: 'y', at: Number.NaN }])).toHaveLength(1)
    expect(withGuides([{ axis: 'z', at: 10 }])).toHaveLength(1)
    expect(withGuides([{ axis: 'x' }])).toHaveLength(1)
    const many = Array.from({ length: MAX_GUIDES + 1 }, (_, at) => ({ axis: 'x', at }))
    expect(withGuides(many.slice(0, MAX_GUIDES))).toEqual([])
    expect(withGuides(many)).toEqual([`frames.sq.guides: Too big: expected array to have <=${MAX_GUIDES} items`])
  })

  it('rejects colours that are not #RRGGBBAA', () => {
    expect(
      errorsFor((d) => {
        d.nodes.r1.props.fills = [{ type: 'solid', color: '#FF5A36' }]
      }),
    ).toEqual(['nodes.r1.props.fills.0.color: colours are #RRGGBBAA'])
  })

  it('rejects a layer without a link id', () => {
    expect(
      errorsFor((d) => {
        delete (d.nodes.r1 as { link?: string }).link
      }),
    ).toEqual(['nodes.r1.link: Invalid input: expected string, received undefined'])
  })

  it('rejects a text run that ends past the text', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d.nodes, {
          t1: {
            type: 'text',
            parentId: 'sq',
            link: 't1',
            index: 'a1',
            name: 'Headline',
            props: {
              x: 0,
              y: 0,
              width: 500,
              height: 80,
              text: 'Sale',
              style: { fontFamily: 'Noto Sans', fontSize: 64, color: '#000000FF' },
              runs: [{ start: 0, end: 9, style: { fontWeight: 700 } }],
            },
          },
        })
      }),
    ).toEqual(['nodes.t1.props.runs.0.end: run ends at 9 but the text is 4 UTF-16 units long'])
  })
})

describe('text runs', () => {
  it('keep only the style keys they set, so the rest come from the base style', () => {
    const d = minimal() as ReturnType<typeof minimal> & { nodes: Record<string, unknown> }
    d.nodes.t1 = {
      type: 'text',
      parentId: 'sq',
      link: 't1',
      index: 'a1',
      name: 'Headline',
      props: {
        x: 0,
        y: 0,
        width: 500,
        height: 80,
        text: 'Sale',
        style: { fontFamily: 'Noto Sans', fontSize: 64, color: '#000000FF', fontWeight: 700 },
        runs: [{ start: 0, end: 2, style: { color: '#FF0000FF' } }],
      },
    }
    const result = parseDesign(d)
    if (!result.success) throw new Error(result.errors.join('\n'))
    const t1 = result.design.nodes.t1
    expect(t1?.type === 'text' && t1.props.runs).toEqual([{ start: 0, end: 2, style: { color: '#FF0000FF' } }])
  })
})

describe('hasGuides', () => {
  it('holds for a frame with a guide, past its edge too, and not for one with no list, an empty one or none', () => {
    expect([
      hasGuides({ guides: [{ axis: 'x', at: 2000 }] }),
      hasGuides({}),
      hasGuides({ guides: [] }),
      hasGuides(undefined),
    ]).toEqual([true, false, false, false])
  })
})

describe('imageAssetIds', () => {
  it('finds image fills on frames and layers, once each', () => {
    const image = (assetId: string) => ({ type: 'image', assetId })
    const parsed = parseDesign({
      meta: { designId: 'd', name: 'D' },
      pages: { p1: { name: 'P', order: 'a0' } },
      frames: {
        sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, fills: [image('sq-bg')], order: 'a0' },
        st: {
          pageId: 'p1',
          name: 'Story',
          width: 100,
          height: 200,
          x: 300,
          y: 0,
          fills: [image('st-bg')],
          order: 'a1',
        },
      },
      nodes: {
        g: {
          type: 'graphic',
          parentId: 'sq',
          link: 'g',
          index: 'a0',
          name: 'G',
          props: {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            shape: { kind: 'rect' },
            fills: [{ type: 'solid', color: '#000000FF' }, image('photo')],
          },
        },
        h: {
          type: 'graphic',
          parentId: 'sq',
          link: 'h',
          index: 'a1',
          name: 'H',
          props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' }, fills: [image('photo')] },
        },
        'st-g': {
          type: 'graphic',
          parentId: 'st',
          link: 'g',
          index: 'a0',
          name: 'G',
          props: { x: 0, y: 0, width: 10, height: 20, shape: { kind: 'rect' }, fills: [image('story-photo')] },
        },
      },
    })
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    expect(imageAssetIds(parsed.design)).toEqual(['photo', 'sq-bg', 'st-bg', 'story-photo'])
    expect(imageAssetIds(parsed.design, ['st'])).toEqual(['st-bg', 'story-photo'])
    expect(imageAssetIds(parsed.design, ['sq'])).toEqual(['photo', 'sq-bg'])
    expect(imageAssetIds(parsed.design, [])).toEqual([])
  })

  it('finds an image a stroke paints', () => {
    const parsed = parseDesign({
      meta: { designId: 'd', name: 'D' },
      pages: { p1: { name: 'P', order: 'a0' } },
      frames: { sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, order: 'a0' } },
      nodes: {
        g: {
          type: 'graphic',
          parentId: 'sq',
          link: 'g',
          index: 'a0',
          name: 'G',
          props: {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            shape: { kind: 'rect' },
            strokes: [{ paint: { type: 'image', assetId: 'edge' }, width: 4 }],
          },
        },
      },
    })
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    expect(imageAssetIds(parsed.design, ['sq'])).toEqual(['edge'])
  })

  it('finds the image a text and its runs are painted with', () => {
    const image = (assetId: string) => ({ type: 'image', assetId, fit: 'tile', tileScale: 0.5 })
    const parsed = parseDesign({
      meta: { designId: 'd', name: 'D' },
      pages: { p1: { name: 'P', order: 'a0' } },
      frames: { sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, order: 'a0' } },
      nodes: {
        t: {
          type: 'text',
          parentId: 'sq',
          link: 't',
          index: 'a0',
          name: 'T',
          props: {
            x: 0,
            y: 0,
            width: 100,
            height: 40,
            text: 'Big sale',
            style: { fontFamily: 'Inter', fontSize: 20, color: '#000000FF', image: image('marble') },
            runs: [
              { start: 0, end: 3, style: { image: image('wood') } },
              { start: 4, end: 8, style: { color: '#FF0000FF' } },
            ],
          },
        },
      },
    })
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    expect(imageAssetIds(parsed.design)).toEqual(['marble', 'wood'])
    expect(imageAssetIds(parsed.design, ['sq'])).toEqual(['marble', 'wood'])
  })

  it('finds the picture a bound image fill draws, with the brand variables', () => {
    const parsed = parseDesign({
      meta: { designId: 'd', name: 'D' },
      pages: { p1: { name: 'P', order: 'a0' } },
      frames: { sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, order: 'a0' } },
      nodes: {
        logo: {
          type: 'graphic',
          parentId: 'sq',
          link: 'logo',
          index: 'a0',
          name: 'Logo',
          role: 'logo',
          bindings: { image: 'brand:logo' },
          props: {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            shape: { kind: 'rect' },
            fills: [{ type: 'image', assetId: 'old-logo', fit: 'fit' }],
          },
        },
      },
    })
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    expect(imageAssetIds(parsed.design)).toEqual(['old-logo'])
    expect(imageAssetIds(parsed.design, undefined, { 'brand:logo': 'new-logo' })).toEqual(['new-logo'])
    expect(imageAssetIds(parsed.design, ['sq'], { 'brand:logo': 'new-logo' })).toEqual(['new-logo'])
    expect(imageAssetIds(parsed.design, ['sq'], { 'brand:primary': '#000000FF' })).toEqual(['old-logo'])
  })
})

describe('checkStructure', () => {
  it('passes a design with linked copies in two frames of a page', () => {
    const d = minimal()
    Object.assign(d.frames, { banner })
    Object.assign(d.nodes, { 'banner-r1': { ...d.nodes.r1, parentId: 'banner', link: 'r1' } })
    const result = parseDesign(d)
    if (!result.success) throw new Error(result.errors.join('\n'))
    const errors: string[] = []
    checkStructure(result.design, (path, message) => errors.push(`${path.join('.')}: ${message}`))
    expect(errors).toEqual([])
  })

  it('rejects a design with no page', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d, { pages: {}, frames: {}, nodes: {} })
      }),
    ).toEqual(['pages: a design needs a page'])
  })

  it('rejects a frame whose page is missing', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d.frames, { banner: { ...banner, pageId: 'ghost' } })
      }),
    ).toEqual(['frames.banner.pageId: no page "ghost"'])
  })

  it('rejects a layer id that is also a frame id', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d.frames, { banner })
        Object.assign(d.nodes, { banner: { ...d.nodes.r1, link: 'banner' } })
      }),
    ).toEqual(['nodes.banner: "banner" is both a frame and a layer'])
  })

  it('rejects a layer whose parent is neither a frame nor a layer, a page included', () => {
    expect(
      errorsFor((d) => {
        d.nodes.r1.parentId = 'ghost'
      }),
    ).toEqual(['nodes.r1.parentId: parent "ghost" is neither a frame nor a layer'])
    expect(
      errorsFor((d) => {
        d.nodes.r1.parentId = 'p1'
      }),
    ).toEqual(['nodes.r1.parentId: parent "p1" is neither a frame nor a layer'])
  })

  it('rejects a layer inside a graphic', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d.nodes, { r2: { ...d.nodes.r1, parentId: 'r1', link: 'r2' } })
      }),
    ).toEqual(['nodes.r2.parentId: parent "r1" is a graphic, which can\'t hold layers'])
  })

  it('rejects groups that contain each other, with no link error for the layers in the loop', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d.nodes, { g1: group('g2', 'g'), g2: group('g1', 'g') })
      }),
    ).toEqual(['nodes.g1.parentId: "g1" is inside itself', 'nodes.g2.parentId: "g2" is inside itself'])
  })

  it('names only the layers in a cycle, not a layer hanging below it', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d.nodes, { g0: group('g1', 'g0'), g1: group('g2', 'g1'), g2: group('g1', 'g2') })
      }),
    ).toEqual(['nodes.g1.parentId: "g1" is inside itself', 'nodes.g2.parentId: "g2" is inside itself'])
  })

  it('names only the layers in a cycle when the layer below it is reached after them', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d.nodes, { g1: group('g2', 'g1'), g2: group('g1', 'g2'), g3: group('g1', 'g3') })
      }),
    ).toEqual(['nodes.g1.parentId: "g1" is inside itself', 'nodes.g2.parentId: "g2" is inside itself'])
  })

  it('rejects a frame holding one link id twice, naming the second and later holders', () => {
    expect(
      errorsFor((d) => {
        Object.assign(d.nodes, {
          g: group('sq', 'g'),
          r2: { ...d.nodes.r1, parentId: 'g', link: 'r1' },
          r3: { ...d.nodes.r1, index: 'a1', link: 'r1' },
        })
      }),
    ).toEqual([
      'nodes.r2.link: frame "sq" holds link "r1" twice, also on "r1"',
      'nodes.r3.link: frame "sq" holds link "r1" twice, also on "r1"',
    ])
  })
})
