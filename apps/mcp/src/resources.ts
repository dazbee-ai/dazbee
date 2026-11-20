// The MCP server's resources, each JSON: the command catalog and one command as describe_command gives it, and the
// open design and one of its frames as read_design and read_frame give them. An unknown one, or one of the design's
// with no design open, answers the SDK's not-found error; any other refusal answers its sentence as an error.
import {
  ErrorCode,
  McpError,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplate,
} from '@modelcontextprotocol/sdk/types.js'

import { DEFAULT_TREE_BYTES } from '@dazbee/doc'

import { ApiRefusal, TokenRefused } from './api.ts'
import { ANSWER_ENVELOPE_BYTES, inMiB, MAX_ANSWER_BYTES } from './limits.ts'
import { NoDesignOpen, type OpenDesign } from './open-design.ts'
import { AGENT_CATALOG, describedCommand } from './tools/command-tools.ts'
import { answerBytes, type ToolContext, ToolRefusal } from './tools/define-tool.ts'
import { designAnswer, treeWithin } from './tools/design-tools.ts'

const JSON_TYPE = 'application/json'
const COMMANDS_URI = 'dazbee://commands'
const DESIGN_URI = 'dazbee://design'
const COMMAND_PREFIX = 'dazbee://command/'
const FRAME_PREFIX = 'dazbee://frame/'

/** The resources every session offers, in `resources/list` order. */
export const RESOURCES: Resource[] = [
  {
    uri: COMMANDS_URI,
    name: 'commands',
    title: 'Command catalog',
    description:
      'Every command an agent may run on a design, each as describe_command gives it: its name, what it does, and its input as JSON Schema.',
    mimeType: JSON_TYPE,
  },
  {
    uri: DESIGN_URI,
    name: 'design',
    title: 'Open design',
    description:
      'The design open in this session’s agent tab, as read_design gives it: its pages and frames, the brand kit’s tokens and what happened to it since the last answer.',
    mimeType: JSON_TYPE,
  },
]

/** The resource templates every session offers, in `resources/templates/list` order. */
export const RESOURCE_TEMPLATES: ResourceTemplate[] = [
  {
    uriTemplate: `${COMMAND_PREFIX}{name}`,
    name: 'command',
    title: 'Command',
    description:
      'One command’s catalog entry, as describe_command gives it, by the name list_commands gives, such as dazbee://command/node.create.',
    mimeType: JSON_TYPE,
  },
  {
    uriTemplate: `${FRAME_PREFIX}{id}`,
    name: 'frame',
    title: 'Frame',
    description:
      'A frame of the open design and the layers it holds as a compact tree, as read_frame gives it without fields, by the id read_design gives.',
    mimeType: JSON_TYPE,
  },
]

/** The resource at `uri`, read for the call in `context`; an `McpError` when there is none or it can't be read. */
export async function readResource(uri: string, context: ToolContext): Promise<ReadResourceResult> {
  try {
    return await contentsOf(uri, context)
  } catch (error) {
    if (error instanceof McpError) throw error
    if (error instanceof NoDesignOpen) throw notFound(uri)
    if (error instanceof ToolRefusal || error instanceof ApiRefusal || error instanceof TokenRefused)
      throw new McpError(ErrorCode.InvalidRequest, error.message)
    console.error(`reading the resource ${uri} failed`, error)
    throw new McpError(ErrorCode.InternalError, 'Dazbee failed to read the resource; try again')
  }
}

/** What reading `uri` gives, or throws. */
async function contentsOf(uri: string, context: ToolContext): Promise<ReadResourceResult> {
  if (uri === COMMANDS_URI)
    return contents(
      uri,
      AGENT_CATALOG.map(({ name }) => describedCommand(name)),
    )
  if (uri === DESIGN_URI) return onOpenDesign(uri, context, designAnswer)
  const command = nameAfter(uri, COMMAND_PREFIX)
  if (command !== undefined) {
    const entry = describedCommand(command)
    if (!entry) throw notFound(uri)
    return contents(uri, entry)
  }
  const frame = nameAfter(uri, FRAME_PREFIX)
  if (frame !== undefined)
    return onOpenDesign(uri, context, ({ tab }) => {
      const design = tab.design()
      if (!Object.hasOwn(design.frames, frame)) throw notFound(uri)
      return treeWithin(design, frame, [], DEFAULT_TREE_BYTES)
    })
  throw notFound(uri)
}

/** The SDK's error for a resource there is none of. */
function notFound(uri: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `Resource ${uri} not found`)
}

/** `value` as the resource's JSON text, then each note as plain text; refused when it would not fit an answer. */
function contents(uri: string, value: unknown, notes: readonly string[] = []): ReadResourceResult {
  const text = JSON.stringify(value)
  const bytes = [text, ...notes].reduce((sum, part) => sum + answerBytes(part) + answerBytes(uri), 0)
  if (bytes > MAX_ANSWER_BYTES - ANSWER_ENVELOPE_BYTES)
    throw new ToolRefusal(
      `The resource is ${inMiB(bytes)}, more than the ${inMiB(MAX_ANSWER_BYTES)} an answer may be; read_frame reads less`,
    )
  return {
    contents: [
      { uri, mimeType: JSON_TYPE, text },
      ...notes.map((note) => ({ uri, mimeType: 'text/plain', text: note })),
    ],
  }
}

/** What `read` gives of the session's open design, with what the agent is to be told of the design first. */
function onOpenDesign(
  uri: string,
  { api, agent, design }: ToolContext,
  read: (open: OpenDesign) => unknown,
): Promise<ReadResourceResult> {
  return design.use({ api, agent }, (open) => contents(uri, read(open), open.notes))
}

/** The part of `uri` after `prefix`, decoded; undefined when it doesn't start with it or holds no name. */
function nameAfter(uri: string, prefix: string): string | undefined {
  if (!uri.startsWith(prefix) || uri.length === prefix.length) return undefined
  try {
    return decodeURIComponent(uri.slice(prefix.length))
  } catch {
    return undefined
  }
}
