import { describe, expect, it } from 'vitest'

import {
  AI_FEATURE_INPUTS,
  answerSchema,
  briefTitle,
  FLOW_ANSWERS,
  isAiSize,
  LayeringInput,
  LayerPlanAnswer,
  parseFeatureJob,
  ProductLayerPlanAnswer,
  ReadingAnswer,
  ReferenceReadAnswer,
  RefineInput,
  RefinePlanAnswer,
  ResizeInput,
  RoundInput,
  RoundPlanAnswer,
  TryAgainInput,
} from './ai-flow.ts'

const ad = (kind: string) => ({
  kind,
  idea: 'Morning ritual.',
  arrangement: 'The cup large at the left, the texts at the right.',
  picture: 'The whole cup alone, from the front.',
  prompt: 'A finished, professional square ad for a coffee. ... correctly spelled text',
})

const plan = {
  brand: 'Warm and calm. Facts: "Harbour Coffee", "₹199"',
  ads: [ad('photographic'), ad('graphical'), ad('composite'), ad('free')],
}

const frame = (n: number) => ({ frameId: `frame-${n}`, pictureLayerId: `picture-${n}` })

const round = {
  brandId: 'brand-1',
  designId: 'design-1',
  briefId: 'brief-1',
  sectionId: 'section-1',
  frames: [frame(1), frame(2), frame(3), frame(4)],
  words: 'Diwali serum sale, 20% off',
  pictures: ['workspaces/w/originals/product'],
  size: { width: 1080, height: 1080 },
  mode: 'fast',
  brand: { name: 'Harbour', colors: ['#14213D'], fonts: ['Lora'], voice: 'Warm' },
}

/** Every object in a JSON schema, nested ones included. */
function objectsOf(schema: unknown): Record<string, unknown>[] {
  if (!schema || typeof schema !== 'object') return []
  const own = (schema as { type?: unknown }).type === 'object' ? [schema as Record<string, unknown>] : []
  return [...own, ...Object.values(schema).flatMap(objectsOf)]
}

describe('RoundInput', () => {
  it('takes a brief with its brand and kit logo, the tab-made ids of four frames and their picture layers, a size and a mode', () => {
    expect(RoundInput.parse(round).frames).toHaveLength(4)
    expect(RoundInput.parse({ ...round, logoKey: 'workspaces/w/originals/logo' }).logoKey).toBe(
      'workspaces/w/originals/logo',
    )
    expect(RoundInput.safeParse({ ...round, brandId: undefined }).success).toBe(false)
    expect(RoundInput.safeParse({ ...round, frames: round.frames.slice(0, 3) }).success).toBe(false)
    expect(RoundInput.safeParse({ ...round, mode: 'slow' }).success).toBe(false)
  })

  it('refuses a size the AI isn’t offered', () => {
    expect(RoundInput.safeParse({ ...round, size: { width: 1600, height: 400 } }).success).toBe(false)
  })
})

describe('TryAgainInput', () => {
  it('takes a brief and one of its four drafts', () => {
    const input = { brandId: 'brand-1', designId: 'design-1', briefId: 'brief-1', draft: 3, frame: frame(4) }
    expect(TryAgainInput.parse(input).draft).toBe(3)
    expect(TryAgainInput.safeParse({ ...input, draft: 4 }).success).toBe(false)
  })
})

describe('RefineInput', () => {
  it('takes the picture, the message and an optional marks layer', () => {
    const input = {
      brandId: 'brand-1',
      designId: 'design-1',
      frame: frame(1),
      pictureKey: 'workspaces/w/originals/draft',
      message: 'Bigger price',
      size: { width: 1080, height: 1350 },
    }
    expect(RefineInput.parse(input).marksKey).toBeUndefined()
    expect(RefineInput.parse({ ...input, marksKey: 'workspaces/w/originals/marks' }).marksKey).toBeDefined()
    expect(RefineInput.safeParse({ ...input, message: '' }).success).toBe(false)
  })
})

describe('ResizeInput', () => {
  it('takes the picture and at least one size, each a new frame', () => {
    const input = {
      brandId: 'brand-1',
      designId: 'design-1',
      sectionId: 'section-2',
      pictureKey: 'workspaces/w/originals/draft',
      sizes: [{ ...frame(5), width: 1080, height: 1920 }],
    }
    expect(ResizeInput.parse(input).sizes).toHaveLength(1)
    expect(ResizeInput.safeParse({ ...input, sizes: [] }).success).toBe(false)
  })
})

describe('LayeringInput', () => {
  it('takes one picture per size and the split’s size, 512 or 1024', () => {
    const input = {
      brandId: 'brand-1',
      designId: 'design-1',
      frames: [{ frameId: 'frame-1', pictureKey: 'workspaces/w/originals/draft' }],
      size: 1024,
    }
    expect(LayeringInput.parse(input).size).toBe(1024)
    expect(LayeringInput.safeParse({ ...input, size: 768 }).success).toBe(false)
  })
})

describe('AI_FEATURE_INPUTS', () => {
  it('holds an input contract for each flow job kind, more like this naming the liked draft', () => {
    expect(AI_FEATURE_INPUTS['more-like-this'].safeParse(round).success).toBe(false)
    expect(
      AI_FEATURE_INPUTS['more-like-this'].parse({ ...round, likedKey: 'workspaces/w/originals/liked' }).likedKey,
    ).toBe('workspaces/w/originals/liked')
  })
})

describe('RoundPlanAnswer', () => {
  it('reads the brand field and four ads, each with its kind and prompt, and refuses three', () => {
    expect(RoundPlanAnswer.parse(plan).ads.map((a) => a.kind)).toEqual([
      'photographic',
      'graphical',
      'composite',
      'free',
    ])
    expect(RoundPlanAnswer.safeParse({ ...plan, ads: plan.ads.slice(0, 3) }).success).toBe(false)
    expect(RoundPlanAnswer.safeParse({ ...plan, ads: [...plan.ads.slice(0, 3), ad('poster')] }).success).toBe(false)
  })
})

describe('RefinePlanAnswer', () => {
  it('reads the instruction, the summary and pinned only', () => {
    const answer = { instruction: 'Make the price badge larger.', summary: 'Bigger price', pinned_only: true }
    expect(RefinePlanAnswer.parse(answer)).toEqual(answer)
    expect(RefinePlanAnswer.safeParse({ ...answer, pinned_only: 'yes' }).success).toBe(false)
  })
})

describe('ReferenceReadAnswer', () => {
  it('reads why, whether the picture is an ad, and its kind', () => {
    const answer = { why: 'A photograph fills the canvas, the texts lie on it.', is_ad: true, kind: 'photographic' }
    expect(ReferenceReadAnswer.parse(answer)).toEqual(answer)
    expect(ReferenceReadAnswer.safeParse({ ...answer, kind: 'poster' }).success).toBe(false)
  })
})

describe('LayerPlanAnswer', () => {
  const element = {
    id: 'e1',
    kind: 'text',
    name: 'Headline',
    content: 'Summer sale',
    text_lines: ['Summer sale'],
    box: { x_min: 100, y_min: 80, x_max: 900, y_max: 200 },
    shadow: 'none',
    group: null,
    ming_layer: 1,
  }
  const answer = {
    ad_type: 'graphical',
    elements: [element],
    prompt: 'Decompose this image into 1 layers with the following specifications:',
    notes: [],
    design_name: 'Harbour – Summer sale',
  }

  it('reads elements with boxes on the 0 to 999 grid and their Ming layer, and refuses a box past it', () => {
    expect(LayerPlanAnswer.parse(answer).elements[0]?.box.x_max).toBe(900)
    const past = { ...element, box: { ...element.box, x_max: 1000 } }
    expect(LayerPlanAnswer.safeParse({ ...answer, elements: [past] }).success).toBe(false)
  })

  it('names the product element only in the plan with the product note', () => {
    expect(ProductLayerPlanAnswer.parse({ ...answer, product_element: 'e1' }).product_element).toBe('e1')
    expect(ProductLayerPlanAnswer.safeParse(answer).success).toBe(false)
  })
})

describe('ReadingAnswer', () => {
  it('reads each text block as the advertiser intended it, with how it is lettered', () => {
    const block = {
      id: 't1',
      text: 'Free cancelling',
      corrections: ['canculling -> cancelling'],
      lettering: 'font',
      style: 'sans-serif',
      italic: false,
      rounded: true,
      mixed_styles: false,
      mixed_note: '',
    }
    expect(ReadingAnswer.parse({ blocks: [block] }).blocks[0]?.text).toBe('Free cancelling')
    expect(ReadingAnswer.safeParse({ blocks: [{ ...block, style: 'gothic' }] }).success).toBe(false)
  })
})

describe('isAiSize', () => {
  it('offers sizes from 1:3 to 3:1', () => {
    expect(isAiSize({ width: 1080, height: 1080 })).toBe(true)
    expect(isAiSize({ width: 1080, height: 1920 })).toBe(true)
    expect(isAiSize({ width: 300, height: 900 })).toBe(true)
    expect(isAiSize({ width: 1500, height: 500 })).toBe(true)
    expect(isAiSize({ width: 728, height: 90 })).toBe(false)
    expect(isAiSize({ width: 160, height: 600 })).toBe(false)
  })
})

describe('parseFeatureJob', () => {
  it('reads a flow job by its job kind’s contract, and throws on an input of another job kind', () => {
    expect(parseFeatureJob('round', round)).toEqual({ kind: 'round', input: RoundInput.parse(round) })
    expect(() => parseFeatureJob('try-again', round)).toThrow()
  })
})

describe('briefTitle', () => {
  it('takes the first line, trimmed, and cuts a long one to 120 characters with an ellipsis', () => {
    expect(briefTitle('  Diwali serum sale  \n20% off, this week only')).toBe('Diwali serum sale')
    const long = briefTitle('word '.repeat(40))
    expect(long).toHaveLength(120)
    expect(long.endsWith('word…')).toBe(true)
  })
})

describe('answerSchema', () => {
  it('gives each answer as a JSON schema a strict response format takes: every property required, no others', () => {
    for (const answer of Object.values(FLOW_ANSWERS)) {
      const schema = answerSchema(answer)
      expect(schema).not.toHaveProperty('$schema')
      const objects = objectsOf(schema)
      expect(objects.length).toBeGreaterThan(0)
      for (const object of objects) {
        expect(object.additionalProperties).toBe(false)
        expect(object.required).toEqual(Object.keys(object.properties as object))
      }
    }
  })
})
