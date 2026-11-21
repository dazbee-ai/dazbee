// What the commands are, for a caller that has not read the code, such as an agent: each command's
// name, what it does, and its input as JSON Schema, made from the definitions by zod's converter, with
// the type `catalogAs` gave a field in place of the field's own.
import { z } from 'zod'

import { catalogTypeOf } from './define.ts'
import { type CommandName, COMMANDS } from './index.ts'

/** One command as the catalog lists it. */
export interface CatalogEntry<N extends string = string> {
  name: N
  description: string
  /** The input a caller sends, as JSON Schema (draft 2020-12): a field with a default may be left out. */
  input: z.core.JSONSchema.BaseSchema
}

/**
 * Every command, in the order `COMMANDS` lists them. It throws, naming the command, on an input
 * holding a type JSON Schema cannot express, so no command is listed with part of its input missing.
 */
export function commandCatalog(): CatalogEntry<CommandName>[] {
  return Object.values(COMMANDS).map(({ name, description, input }) => {
    try {
      const schema = z.toJSONSchema(input, { io: 'input', unrepresentable: 'throw', override: putCatalogType })
      return { name: name as CommandName, description, input: schema }
    } catch (error) {
      throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  })
}

/** Puts the JSON Schema of the type `catalogAs` gave a field in place of the field's own, keeping its description. */
function putCatalogType({
  zodSchema,
  jsonSchema,
}: {
  zodSchema: z.core.$ZodTypes
  jsonSchema: z.core.JSONSchema.BaseSchema
}) {
  const listed = catalogTypeOf(zodSchema)
  if (!listed) return
  const { description } = jsonSchema
  const replaced: z.core.JSONSchema.BaseSchema = z.toJSONSchema(listed, { io: 'input', unrepresentable: 'throw' })
  delete replaced.$schema
  // The converter keeps the object it hands the override, so the field's own keys are taken off it.
  for (const key of Object.keys(jsonSchema)) Reflect.deleteProperty(jsonSchema, key)
  Object.assign(jsonSchema, replaced, description === undefined ? {} : { description })
}
