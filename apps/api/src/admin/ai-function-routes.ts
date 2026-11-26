// The admin page's routes for which preset each mode uses, under /admin/ai, behind the AI routes' admin check: the
// AI functions with their presets, what each preset's calls measured and the preset each mode uses; adding a pick,
// live for the next job; and an AI function's picks, newest first, with who made each and when.
import { inArray } from 'drizzle-orm'
import { Hono } from 'hono'

import {
  addPick,
  aiFunctionDef,
  isAiFunction,
  PickRefused,
  picksOf,
  type PresetInUse,
  presetMeasured,
  presetsInUse,
} from '@dazbee/ai'
import { type Db, users } from '@dazbee/db'
import {
  AI_FUNCTIONS,
  type AiFunction,
  type AiFunctionView,
  AiPickInput,
  type AiPickView,
  type AiPresetView,
  fromMillionths,
} from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import { ChangedMeanwhile, checkSince } from './ai-changed-meanwhile.ts'

/** How many of an AI function's picks its history gives, the newest. */
const PICKS_SHOWN = 200

export function aiFunctionRoutes(db: Db): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/admin/ai/functions', async (c) => {
    const inUse = await presetsInUse(db)
    const functions: AiFunctionView[] = []
    for (const fn of AI_FUNCTIONS) functions.push(await functionView(db, fn, inUse[fn]))
    return c.json(functions)
  })

  app.post('/admin/ai/picks', async (c) => {
    const input = await body(c.req.raw, AiPickInput)
    if (input instanceof Response) return input
    const pick = { function: input.function, mode: input.mode, preset: input.preset, by: c.var.session.userId }
    try {
      await addPick(db, pick, (pickedAt) => checkSince(pickedAt, input.since))
      return c.body(null, 204)
    } catch (refused) {
      if (refused instanceof PickRefused) return c.json(error(refused.message), 400)
      if (refused instanceof ChangedMeanwhile) return c.json(error(refused.message), 409)
      throw refused
    }
  })

  app.get('/admin/ai/functions/:function/picks', async (c) => {
    const fn = c.req.param('function')
    if (!isAiFunction(fn)) return c.json(error('No such AI function'), 404)
    const picks = await picksOf(db, fn, PICKS_SHOWN)
    const admins = [...new Set(picks.map((pick) => pick.setBy))]
    const emails =
      admins.length === 0
        ? []
        : await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, admins))
    const emailOf = new Map(emails.map((user) => [user.id, user.email]))
    return c.json(
      picks.map((pick) => ({
        id: pick.id,
        mode: pick.mode,
        preset: pick.preset,
        setBy: emailOf.get(pick.setBy) ?? null,
        setAt: pick.setAt.toISOString(),
      })) satisfies AiPickView[],
    )
  })

  return app
}

/** The AI function as an admin reads it: its presets in the order it declares them, each with what its calls measured. */
async function functionView(db: Db, fn: AiFunction, modes: PresetInUse[]): Promise<AiFunctionView> {
  const def = aiFunctionDef(fn)
  const presets: AiPresetView[] = []
  for (const [name, preset] of Object.entries(def.presets)) {
    const measured = await presetMeasured(db, fn, name, preset)
    presets.push({
      name,
      model: preset.model,
      settings: preset.settings,
      ownPrompt: preset.prompt !== undefined,
      measured: {
        done: measured.done,
        cost: fromMillionths(measured.cost),
        seconds: measured.seconds,
        cutOffs: measured.cutOffs,
        failures: measured.failures,
        firstGuess: measured.calls === 0,
      },
    })
  }
  return {
    function: fn,
    kind: def.kind,
    presets,
    modes: modes.map((use) => ({ ...use, pickedAt: use.pickedAt?.toISOString() ?? null })),
  }
}
