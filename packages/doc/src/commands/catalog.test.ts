// What every command says about itself, and the catalog made from it: each command describes what
// it changes and refuses, each field of its input says what it is, and each names the undo step it
// makes. A command added without them fails here by name.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { commandCatalog } from './catalog.ts'
import { mapInside } from './define.ts'
import { COMMANDS } from './index.ts'
import { STEP_NAMES } from './step-names.ts'

/**
 * The fields whose type is one of the schema's design types, said as a whole: a layer, its style, a
 * paint, a text run's style or a text style's look. Their own fields are the schema's, not the command's.
 */
const DESIGN_TYPES = [
  'design.place.tree',
  'design.restore.design',
  'node.create.layer',
  'node.style.style',
  'frame.update.fills',
  'page.addMany.pages.frames.fills',
  'text.edit.op.style',
  'node.bind.value',
]

/**
 * The fields of a command's input that say nothing of what they are, at every depth: the keys of
 * each object in it, through lists, tuples, records, unions, wrappers and pipes, as `command.field.inner`.
 */
function undescribed(type: z.ZodType, path: string): string[] {
  const found: string[] = []
  mapInside(type, (inside, where, field) => {
    const at = field ? `${path}.${where}` : path
    if (field && !inside.description?.trim()) found.push(at)
    if (!(field && DESIGN_TYPES.includes(at))) found.push(...undescribed(inside, at))
    return inside
  })
  return found
}

describe('COMMANDS', () => {
  it('each command has a description of one or two sentences, and a step name from the list', () => {
    const problems = Object.entries(COMMANDS).flatMap(([name, command]) => {
      const said: { description?: unknown; step?: unknown } = command
      const out: string[] = []
      if (typeof said.description !== 'string' || !/^[A-Z].*\.$/s.test(said.description.trim()))
        out.push(`${name}: no description that is a sentence`)
      if (!STEP_NAMES.includes(said.step as never)) out.push(`${name}: no step name from STEP_NAMES`)
      return out
    })
    expect(problems).toEqual([])
  })

  it('each field of each input says what it is, at every depth', () => {
    expect(Object.entries(COMMANDS).flatMap(([name, command]) => undescribed(command.input, name))).toEqual([])
  })

  it('names each command by the key it is listed under', () => {
    expect(Object.entries(COMMANDS).filter(([key, command]) => key !== command.name)).toEqual([])
  })
})

describe('commandCatalog', () => {
  it('lists every command with its name, description and input as JSON Schema', () => {
    const catalog = commandCatalog()
    expect(catalog.map((entry) => entry.name)).toEqual(Object.keys(COMMANDS))
    for (const entry of catalog) {
      expect(entry.description).toBe(COMMANDS[entry.name].description)
      expect(entry.input).toMatchObject({ type: 'object', additionalProperties: false })
    }
  })

  it('gives each field its description and says which are required, as a caller sends them', () => {
    const rename = commandCatalog().find((entry) => entry.name === 'node.rename')
    expect(rename?.input).toMatchObject({
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', description: COMMANDS['node.rename'].input.shape.id.description },
        name: { type: 'string', minLength: 1, maxLength: 120 },
      },
    })
    // A field with a default is one a caller may leave out.
    const group = commandCatalog().find((entry) => entry.name === 'node.group')
    expect(group?.input).toMatchObject({ required: ['ids'] })
  })

  it('names each layer type’s props for node.create’s layer: a text’s style keys, its align values, a shape’s kind', () => {
    const create = commandCatalog().find((entry) => entry.name === 'node.create')
    const layer = create?.input.properties?.['layer'] as z.core.JSONSchema.BaseSchema
    expect(layer.description).toBe(COMMANDS['node.create'].input.shape.layer.description)
    const options = (layer.anyOf ?? layer.oneOf ?? []) as z.core.JSONSchema.BaseSchema[]
    const byType = Object.fromEntries(
      options.map((option) => [(option.properties?.['type'] as { const: string }).const, option]),
    )
    expect(Object.keys(byType).sort()).toEqual(['boolean', 'box', 'graphic', 'group', 'text'])
    expect(byType['text']).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining(['type', 'name', 'props']),
      properties: {
        role: { enum: expect.arrayContaining(['headline', 'cta']) },
        props: {
          properties: {
            style: { properties: { fontSize: {}, fontFamily: {}, fontWeight: {} } },
            align: { enum: ['start', 'center', 'end', 'justify'] },
            effects: { type: 'array' },
            constraints: { properties: { horizontal: { enum: expect.arrayContaining(['left']) } } },
          },
        },
      },
    })
    expect(JSON.stringify(byType['text'])).not.toContain('"fills"')
    const graphic = JSON.stringify(byType['graphic'])
    for (const key of ['"shape"', '"kind"', '"ellipse"', '"fills"', '"strokes"']) expect(graphic).toContain(key)
  })

  it('names each layer type’s props for node.update’s patch, without a text’s words, which text.edit sets', () => {
    const update = commandCatalog().find((entry) => entry.name === 'node.update')
    const patch = update?.input.properties?.['patch'] as z.core.JSONSchema.BaseSchema
    expect(patch.description).toBe(COMMANDS['node.update'].input.shape.patch.description)
    const options = (patch.anyOf ?? []) as z.core.JSONSchema.BaseSchema[]
    expect(options).toHaveLength(5)
    const text = options.find((option) => option.properties?.['style'])
    expect(text).toMatchObject({ additionalProperties: false, properties: { align: { enum: expect.any(Array) } } })
    expect(text?.required ?? []).toEqual([])
    expect(text?.properties?.['text']).toBeUndefined()
    expect(text?.properties?.['runs']).toBeUndefined()
  })

  it('throws, naming the command, on an input with a type JSON Schema cannot express', () => {
    const registry = COMMANDS as Record<string, unknown>
    // Listed as it is, past `defineCommand`, whose check of strictness refuses a date too.
    registry['test.date'] = {
      name: 'test.date',
      description: 'Takes a date and writes nothing.',
      step: 'edit',
      input: z.strictObject({ at: z.date().describe('When.') }),
      apply: () => {},
    }
    try {
      expect(() => commandCatalog()).toThrow(/test\.date/)
    } finally {
      delete registry['test.date']
    }
  })
})
