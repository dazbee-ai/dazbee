// The editor's commands for an agent: their list, one line each, and one command's whole catalog entry; and the
// tools that run them on the open design (one command, an agent batch, undo and redo), each answered once the sync
// server has stored the step. A restore is left out, since an agent has no way to read a version's records.
import { z } from 'zod'

import {
  type AgentStep,
  type CatalogEntry,
  commandCatalog,
  CommandError,
  CommandFault,
  type Session,
  VIEW_ONLY,
} from '@dazbee/doc'
import { type AgentBatchWarned, runAgentBatchWithWarnings } from '@dazbee/export'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { SYNC_LIMITS } from '@dazbee/schema'

import { MAX_BATCH_STEPS } from '../limits.ts'
import type { OpenDesign } from '../open-design.ts'
import { NOT_CONFIRMED, notKeptSentence, type Written } from '../store-wait.ts'
import { defineTool, type Tool, type ToolContext, ToolRefusal, WithNotes, withoutDialect } from './define-tool.ts'

/** The command agents can't run: a restore needs a version's records, which an agent has no way to read. */
const RESTORE = 'design.restore'

/** A command's name, as list_commands gives it. */
const CommandName = z.string().max(200).describe('The command’s name, as list_commands gives it, such as node.create')

/** The commands an agent may run, as the catalog describes them. */
export const AGENT_CATALOG: CatalogEntry[] = commandCatalog().filter((entry) => entry.name !== RESTORE)

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
  defineTool({
    name: 'run_command',
    title: 'Run a command',
    description:
      'Runs one command on the open design as one undo step, and answers once Dazbee has stored it: its result (such as the id of what it made) and the warnings for the layers it touched. A refused command or a bad input changes nothing and answers why. describe_command gives a command’s input.',
    readOnly: false,
    input: z.object({
      command: CommandName,
      input: z.unknown().optional().describe('The command’s input, as describe_command gives its schema'),
    }),
    run: ({ command, input }, context) =>
      writing(context, [command], async (open) => {
        const step: AgentStep = input === undefined ? { command } : { command, input }
        const done = await agentBatchOn(open, [step], context.answerBy)
        const [outcome] = done.value.steps
        if (!outcome || !outcome.ok) throw new ToolRefusal(refusalOf(outcome))
        const { warnings, warningsError } = done.value
        return answered(open, done, {
          result: outcome.result,
          warnings,
          ...(warningsError === undefined ? {} : { warningsError }),
        })
      }),
  }),
  defineTool({
    name: 'batch',
    title: 'Run an agent batch',
    description: `Runs steps on the open design as one agent batch: one undo step, all or nothing, answered once Dazbee has stored it. Each step is { command, input?, as? }; a step named with \`as\` is reached from a later step’s input as { "$ref": name }, with "field" for a part of its result (a key, or a path such as "0"). Answers whether the batch was kept, each step’s outcome up to the one refused, and the warnings for the layers it touched. 1 to ${MAX_BATCH_STEPS} steps.`,
    readOnly: false,
    input: z.object({
      steps: z
        .array(
          z
            .object({
              command: CommandName,
              input: z
                .unknown()
                .optional()
                .describe('The command’s input; { "$ref": name } stands for a step’s result'),
              as: z.string().min(1).max(200).optional().describe('A name later steps reach this step’s result by'),
            })
            .strict(),
        )
        .min(1, 'a batch takes at least one step')
        .max(MAX_BATCH_STEPS, `a batch takes at most ${MAX_BATCH_STEPS} steps; split it`)
        .describe('The steps, run in order'),
    }),
    run: ({ steps }, context) =>
      writing(
        context,
        steps.map(({ command }) => command),
        async (open) => {
          const given = steps.map(({ command, input, as }) => ({
            command,
            ...(input === undefined ? {} : { input }),
            ...(as === undefined ? {} : { as }),
          }))
          const done = await agentBatchOn(open, given, context.answerBy)
          return answered(open, done, done.value)
        },
      ),
  }),
  defineTool({
    name: 'undo',
    title: 'Undo',
    description:
      'Takes back this agent’s last step on the open design (a command or a whole agent batch), never a person’s, and answers its name once Dazbee has stored it, or that there is none.',
    readOnly: false,
    input: z.object({}),
    run: (_input, context) => pressed(context, 'undo'),
  }),
  defineTool({
    name: 'redo',
    title: 'Redo',
    description:
      'Does again the step of this agent’s that undo last took back on the open design, and answers its name once Dazbee has stored it, or that there is none.',
    readOnly: false,
    input: z.object({}),
    run: (_input, context) => pressed(context, 'redo'),
  }),
]

/** A command as one line: its name, what it does, and its input's fields, `?` marking those that may be left out. */
function commandLine({ name, description, input }: CatalogEntry): string {
  const required = new Set(input.required ?? [])
  const fields = Object.keys(input.properties ?? {}).map((field) => (required.has(field) ? field : `${field}?`))
  return `${name}: ${description.replace(/\s+/g, ' ')} Input: ${fields.length > 0 ? fields.join(', ') : 'none'}.`
}

/**
 * Runs `work` on the open design once it may be changed: refused before anything runs for a command agents can't
 * run or a tab that may only view the design, and a command's fault told as a tool error. What the agent is to be
 * told of the design first (that it was opened again) comes after the answer, or after the refusal's sentence.
 */
async function writing(
  { api, agent, design }: ToolContext,
  commands: readonly string[],
  work: (open: OpenDesign) => Promise<unknown>,
): Promise<unknown> {
  if (commands.includes(RESTORE))
    throw new ToolRefusal(
      `${RESTORE} is a command agents can’t run, so nothing ran; the person can restore a version from the design’s Versions`,
    )
  return design.use({ api, agent }, async (open) => {
    let value: unknown
    try {
      if (open.tab.readOnly()) throw new ToolRefusal(capitalised(VIEW_ONLY))
      value = await work(open)
    } catch (error) {
      const refusal =
        error instanceof CommandFault
          ? new ToolRefusal(
              `${error.command} failed inside Dazbee, so nothing was kept; try it another way, and tell the person if it fails again`,
            )
          : error
      if (refusal instanceof ToolRefusal && open.notes.length > 0)
        throw new ToolRefusal([refusal.message, ...open.notes].join('. '))
      throw refusal
    }
    if (open.notes.length === 0) return value
    return value instanceof WithNotes
      ? new WithNotes(value.value, [...open.notes, ...value.notes])
      : new WithNotes(value, open.notes)
  })
}

/** Runs `steps` as an agent batch with its warnings on the open design, once its fonts are here, waiting for the store. */
async function agentBatchOn(
  open: OpenDesign,
  steps: readonly AgentStep[],
  answerBy: number,
): Promise<Written<AgentBatchWarned>> {
  const { tab } = open
  await tab.fontsLoaded()
  const ck = await loadCanvasKit()
  return open.write(
    () => runAgentBatchWithWarnings(ck, withinDesignLimits(tab.session), steps, tab.bytes(), tab.cache),
    answerBy,
  )
}

/**
 * `session`, its `run` refusing a command that leaves the design holding more layers, frames or pages than a design
 * may: the sync server would refuse the step, and a batch growing the design step after step would hold it all in
 * memory first.
 */
function withinDesignLimits(session: Session): Session {
  return {
    ...session,
    run(name, input) {
      const result = session.run(name, input)
      const { nodes, frames, pages } = session.design()
      const over = (
        [
          [nodes, SYNC_LIMITS.designLayers, 'layers'],
          [frames, SYNC_LIMITS.designFrames, 'frames'],
          [pages, SYNC_LIMITS.designPages, 'pages'],
        ] as const
      ).find(([records, most]) => Object.keys(records).length > most)
      if (over)
        throw new CommandError(name, {
          kind: 'refused',
          reason: `the design would hold more than its ${over[1]} ${over[2]}`,
        })
      return result
    },
  }
}

/** The sentence a refused step is told with: the command, why it was refused, and that nothing changed. */
function refusalOf(outcome: AgentBatchWarned['steps'][number] | undefined): string {
  if (!outcome || outcome.ok) return 'The command was refused; nothing was changed'
  return `${outcome.command}: ${outcome.reason}; nothing was changed`
}

/**
 * `value` for a step whose store `done` tells: a tool error when the server didn't keep it; with a note when it
 * wasn't confirmed in time, and one with the tab's notices since the last answer.
 */
function answered(open: OpenDesign, done: Written<unknown>, value: unknown): unknown {
  if (done.stored.kind === 'notKept') throw new ToolRefusal(notKeptSentence(done.stored.why))
  const notices = open.tab.takeNotices().map(([notice, detail]) => ({ notice, ...detail }))
  const notes = [
    ...(done.stored.kind === 'unconfirmed' ? [NOT_CONFIRMED] : []),
    ...(notices.length > 0 ? [`What happened to the design since the last answer: ${JSON.stringify(notices)}`] : []),
  ]
  return notes.length > 0 ? new WithNotes(value, notes) : value
}

/** Undoes or redoes the agent's last step, answering its name once stored, or that there is none. */
function pressed(context: ToolContext, side: 'undo' | 'redo'): Promise<unknown> {
  return writing(context, [], async (open) => {
    const { session } = open.tab
    const [can, name] =
      side === 'undo' ? [session.canUndo(), session.undoName()] : [session.canRedo(), session.redoName()]
    if (!can) return `There is no step of this agent’s to ${side}`
    const done = await open.write(() => (side === 'undo' ? session.undo() : session.redo()), context.answerBy)
    return answered(open, done, `${side === 'undo' ? 'Undid' : 'Redid'} “${name ?? 'the step'}”`)
  })
}

/** `text` with its first letter a capital. */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
