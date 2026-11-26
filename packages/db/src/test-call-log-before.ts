// The call log as the build that still serves while the two tables of models are dropped declares it: `step`
// among its columns, and a call's AI feature, AI function, preset and kind allowed to be empty. The query builder
// names every declared column in an insert and in a whole-row read, so the migrations' test writes and reads
// through this declaration to send what that build sends. Imported by tests only.
import { bigint, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { CALL_KINDS, CALL_STATES, type Usage } from '@dazbee/schema'

/** Whole millionths of a rupee, or of the currency the row names. */
const millionths = (name: string) => bigint(name, { mode: 'bigint' })

export const callLogBefore = pgTable('ai_calls', {
  id: text().primaryKey(),
  jobId: text('job_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  callIndex: integer('call_index').notNull(),
  try: integer().notNull(),
  attempt: integer().notNull(),
  step: text(),
  feature: text(),
  function: text(),
  preset: text(),
  kind: text({ enum: CALL_KINDS }),
  settings: jsonb().$type<Record<string, unknown>>(),
  promptHash: text('prompt_hash'),
  model: text().notNull(),
  seller: text().notNull(),
  state: text({ enum: CALL_STATES }).notNull().default('running'),
  sellerRequestId: text('seller_request_id'),
  usage: jsonb().$type<Usage>(),
  currency: text(),
  sellerCost: millionths('seller_cost'),
  reportedCost: millionths('reported_cost'),
  realCost: millionths('real_cost'),
  chargeCost: millionths('charge_cost'),
  error: text(),
  chargedAt: timestamp('charged_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
})
