import { isDeepStrictEqual } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { CommandError, openSession, readDesign, type Session } from '@dazbee/doc'
import { COMMAND_INPUTS, sweepWorld } from '@dazbee/doc/test-commands'
import { kindsDesign } from '@dazbee/doc/test-design'
import { forkTestStore, openTestStore } from '@dazbee/doc/test-store'
import { seeded } from '@dazbee/doc/test-walk'
import type { DesignInput, DesignRecords } from '@dazbee/schema'

import { type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }

/** What `session.run` gives for `command` and `input`: its result with new ids named by order, or its refusal as run_command tells it. */
function ranOn(session: Session, command: string, input: unknown, before: ReadonlySet<string>) {
  try {
    const result: unknown = session.run(command as never, input as never)
    return { result: newIdsIn(result, idsOf(session.design()), before) }
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
    return { refused: `${error.command}: ${error.reason}; nothing was changed.` }
  }
}

/** The ids of a design's pages, frames, layers, sections and connectors. */
function idsOf(design: Pick<DesignRecords, 'pages' | 'frames' | 'nodes' | 'sections' | 'connectors'>): Set<string> {
  const { pages, frames, nodes, sections = {}, connectors = {} } = design
  return new Set([pages, frames, nodes, sections, connectors].flatMap((records) => Object.keys(records)))
}

/**
 * `value` as JSON, each id in `after` but not in `before` named by the order it first appears in, since the ids a
 * command makes at random differ between two runs.
 */
function newIdsIn(value: unknown, after: ReadonlySet<string>, before: ReadonlySet<string>): unknown {
  const names = new Map<string, string>()
  return JSON.parse(JSON.stringify(value ?? null), (_key, inner: unknown) => {
    if (typeof inner !== 'string' || before.has(inner) || !after.has(inner)) return inner
    if (!names.has(inner)) names.set(inner, `new id ${names.size + 1}`)
    return names.get(inner)
  })
}

describe('the sweep', () => {
  it('answers what session.run gives on a copy of the design, for every command but design.restore', async () => {
    const world = openTestStore(kindsDesign())
    const made = openSession(world)
    const { random, ...inputs } = sweepWorld(made, seeded(1))
    made.destroy()
    // The sweep makes more calls at once than an access may.
    server = testServer({
      designs: { 'design-launch': readDesign(world) as DesignInput },
      limits: { callsBurst: 10_000 },
    })
    const agent = await server.connect(server.api.addAccess().token())
    expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
    const sync = server.sync('design-launch')
    const before = idsOf(readDesign(world))
    const problems: string[] = []
    for (const [command, inputsOf] of Object.entries(COMMAND_INPUTS)) {
      if (command === 'design.restore' || !inputsOf) continue
      for (const [i, given] of inputsOf({ ...inputs, random }).entries()) {
        const input = JSON.parse(JSON.stringify(given)) as unknown
        const copy = openSession(forkTestStore(world))
        const expected = ranOn(copy, command, input, before)
        const result = await agent.call('run_command', { command, input })
        const got = result.isError
          ? { refused: textOf(result) }
          : {
              result: newIdsIn(
                (JSON.parse(textOf(result)) as { result?: unknown }).result,
                idsOf(sync.state()),
                before,
              ),
            }
        if (!isDeepStrictEqual(got, expected)) problems.push(`${command} #${i}: ${JSON.stringify({ got, expected })}`)
        if (!result.isError) expect((await agent.call('undo')).isError).toBeFalsy()
        copy.destroy()
      }
    }
    expect(problems).toEqual([])
  })
})
