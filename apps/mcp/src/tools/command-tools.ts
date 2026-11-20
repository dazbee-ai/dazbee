// The tools that tell an agent the editor's commands: their list, one line each, and one command's whole
// catalog entry. A restore is left out, since an agent has no way to read a version's records.
import { z } from 'zod'

import { type CatalogEntry, commandCatalog } from '@dazbee/doc'

import { defineTool, type Tool, ToolRefusal, withoutDialect } from './define-tool.ts'

/** The commands an agent may run, as the catalog describes them. */
export const AGENT_CATALOG: CatalogEntry[] = commandCatalog().filter((entry) => entry.name !== 'design.restore')

export const COMMAND_TOOLS: Tool[] = [
  defineTool({
    name: 'list_commands',
    title: 'List commands',
    description:
      'Lists the editor’s commands, the only way to change a design: one line each, with its name, what it does and its input’s fields (? marks one that may be left out). `filter` keeps those whose name or description holds it, in any case; describe_command gives one command’s input in full.',
    readOnly: true,
    input: z.object({
      filter: z.string().max(200).optional().describe('A part of a command’s name or description, in any case'),
    }),
    run: async ({ filter }) => {
      const wanted = (filter ?? '').toLowerCase()
      const lines = AGENT_CATALOG.filter(
        ({ name, description }) => name.toLowerCase().includes(wanted) || description.toLowerCase().includes(wanted),
      ).map(commandLine)
      return lines.length > 0
        ? lines.join('\n')
        : `No command matches “${filter}”; list_commands without a filter lists them all.`
    },
  }),
  defineTool({
    name: 'describe_command',
    title: 'Describe a command',
    description:
      'Gives one command’s catalog entry: its name, what it does, and its input as JSON Schema, with each field’s type, range and meaning. Read it before running a command for the first time.',
    readOnly: true,
    input: z.object({
      command: z.string().max(200).describe('The command’s name, as list_commands gives it, such as node.create'),
    }),
    run: async ({ command }) => {
      const entry = AGENT_CATALOG.find(({ name }) => name === command)
      if (!entry) throw new ToolRefusal(`There is no command “${command}”; list_commands lists them`)
      return { ...entry, input: withoutDialect(entry.input) }
    },
  }),
]

/** A command as one line: its name, what it does, and its input's fields, `?` marking those that may be left out. */
function commandLine({ name, description, input }: CatalogEntry): string {
  const required = new Set(input.required ?? [])
  const fields = Object.keys(input.properties ?? {}).map((field) => (required.has(field) ? field : `${field}?`))
  return `${name}: ${description.replace(/\s+/g, ' ')} Input: ${fields.length > 0 ? fields.join(', ') : 'none'}.`
}
