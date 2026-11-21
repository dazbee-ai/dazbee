// The MCP server's prompts: each a plan in Dazbee's words, naming the tools and commands to use, that ends with the
// same check. Arguments are put into a plan in one pass, so an argument's text is never read as a placeholder.
import { ErrorCode, type GetPromptResult, McpError, type Prompt } from '@modelcontextprotocol/sdk/types.js'

import { CHECK, DEFINITIONS } from './plans.ts'

/** The prompts every session offers, in `prompts/list` order. */
export const PROMPTS: Prompt[] = DEFINITIONS.map(({ name, title, description, arguments: args }) => ({
  name,
  title,
  description,
  arguments: args.map((arg) => ({
    name: arg.name,
    description: arg.default === undefined ? arg.description : `${arg.description}; ${arg.default} unless given`,
    required: arg.default === undefined,
  })),
}))

/**
 * The prompt `name` as one user message, its arguments put in; an `McpError` for a prompt there is none of, an
 * argument it doesn't take, or one it needs left out or blank. A blank argument with a default takes the default.
 */
export function promptMessage(name: string, given: Record<string, string> = {}): GetPromptResult {
  const prompt = DEFINITIONS.find((definition) => definition.name === name)
  if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Prompt ${name} not found`)
  const takes = prompt.arguments.map((arg) => arg.name)
  const unknown = Object.keys(given).filter((key) => !takes.includes(key))
  if (unknown.length > 0)
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown argument${unknown.length === 1 ? '' : 's'} ${unknown.map((key) => `\`${key}\``).join(', ')} (${name} takes ${takes.join(', ')})`,
    )
  const values = new Map([['check', CHECK]])
  for (const arg of prompt.arguments) {
    const value = Object.hasOwn(given, arg.name) ? given[arg.name] : undefined
    const filled = value !== undefined && value.trim() !== '' ? value : arg.default
    if (filled === undefined)
      throw new McpError(ErrorCode.InvalidParams, `${name} needs \`${arg.name}\`: ${arg.description}`)
    values.set(arg.name, filled)
  }
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: filledIn(prompt.plan, values) } }],
  }
}

/** `plan` with each `{name}` that names a value replaced by it, in one pass: a value's own text is left as it is. */
function filledIn(plan: string, values: ReadonlyMap<string, string>): string {
  return plan.replace(/\{([a-z]+)\}/g, (placeholder, key: string) => values.get(key) ?? placeholder)
}
