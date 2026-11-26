// The AI tables (ADR-0022, ADR-0023): the AI settings, the price list, which model each AI step runs and
// the sellers of each model, the grants and the allowance ledger, the AI jobs and the call log, and the AI
// flow's briefs, AI frames and refines. Amounts are whole millionths: of a rupee for allowance and real cost,
// of the seller's currency for its prices and costs. Workspace and person ids carry no foreign key, so
// deleting an account keeps the metering rows for good; the flow's rows go with their design.
import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import {
  AI_FRAME_KINDS,
  AI_FRAME_STATES,
  AI_JOB_KINDS,
  AI_JOB_STATES,
  AI_MODES,
  CALL_KINDS,
  CALL_STATES,
  type CallOutput,
  DAILY_CHECK_SOURCES,
  DAILY_CHECK_STATES,
  GRANT_SOURCES,
  LEDGER_KINDS,
  type RoundPlanAnswer,
  UPLOADED_SELLERS,
  type Usage,
  USAGE_UNITS,
} from '@dazbee/schema'

import { assets, designs } from './tables.ts'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
/** Whole millionths of a rupee, or of the currency the row names. */
const millionths = (name: string) => bigint(name, { mode: 'bigint' })
/** A design's id, the flow's rows going with the design. */
const designId = () =>
  text('design_id')
    .notNull()
    .references(() => designs.id, { onDelete: 'cascade' })

/**
 * The one row of AI settings: the usage rate new grants keep (millionths: 1,000,000 is a rate of 1), the
 * daily spending stop on real cost across every workspace, how many AI jobs a workspace runs at once, and
 * the layer split's fixed amount at each size, counted as its real cost.
 */
export const aiSettings = pgTable(
  'ai_settings',
  {
    id: integer().primaryKey().default(1),
    usageRate: millionths('usage_rate').notNull(),
    spendingStop: millionths('spending_stop').notNull(),
    jobLimit: integer('job_limit').notNull(),
    layerSplit512: millionths('layer_split_512').notNull(),
    layerSplit1024: millionths('layer_split_1024').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [check('ai_settings_one_row', sql`${t.id} = 1`)],
)

/** What one unit of a currency costs in millionths of a rupee, the bank's forex fee included. */
export const currencyRates = pgTable('currency_rates', {
  currency: text().primaryKey(),
  rate: millionths('rate').notNull(),
  updatedAt: updatedAt(),
})

/**
 * The price list: what a seller charges for a million units of usage on a model, in millionths of its
 * currency, and the GST or fee its bill adds, as millionths of the price (180,000 is 18%).
 */
export const aiPrices = pgTable(
  'ai_prices',
  {
    seller: text().notNull(),
    model: text().notNull(),
    unit: text({ enum: USAGE_UNITS }).notNull(),
    currency: text().notNull(),
    pricePerMillion: millionths('price_per_million').notNull(),
    fee: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.seller, t.model, t.unit] })],
)

/** The sellers of each model, tried in order of position, with the seller's own name for it when it differs. */
export const modelSellers = pgTable(
  'model_sellers',
  {
    model: text().notNull(),
    seller: text().notNull(),
    position: integer().notNull(),
    sellerModel: text('seller_model'),
  },
  (t) => [primaryKey({ columns: [t.model, t.seller] }), uniqueIndex('model_sellers_position').on(t.model, t.position)],
)

/** The default model of each kind of AI call, with the options the call passes it; every AI step of the kind runs it unless the step has its own. */
export const aiKindModels = pgTable('ai_kind_models', {
  kind: text({ enum: CALL_KINDS }).primaryKey(),
  model: text().notNull(),
  options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
})

/** An AI step's own model, in place of its kind's default, with the options the call passes it (such as a picture's quality). */
export const aiStepModels = pgTable('ai_step_models', {
  step: text().primaryKey(),
  model: text().notNull(),
  options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
})

/**
 * Allowance given to a workspace: an amount in millionths of a rupee of allowance, the usage rate of the
 * day it was given, and when it expires. What is left on it is its amount plus its ledger rows.
 */
export const aiGrants = pgTable(
  'ai_grants',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    source: text({ enum: GRANT_SOURCES }).notNull(),
    amount: millionths('amount').notNull(),
    usageRate: millionths('usage_rate').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** The admin who gave it. */
    givenBy: text('given_by'),
    note: text().notNull().default(''),
    /** The size in px a layering job splits at when its hold draws from this grant first: 512 or 1024. */
    layerSize: integer('layer_size').notNull().default(512),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_grants_workspace').on(t.workspaceId, t.expiresAt),
    check('ai_grants_amount', sql`${t.amount} >= 0`),
    check('ai_grants_usage_rate', sql`${t.usageRate} > 0`),
    check('ai_grants_layer_size', sql`${t.layerSize} in (512, 1024)`),
  ],
)

/**
 * The allowance ledger: rows are only ever added (a trigger refuses any change). A hold and a charge are
 * minus, a give-back plus. A charged try of an AI call has one charge row on each grant it is charged to.
 */
export const aiLedger = pgTable(
  'ai_ledger',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    grantId: text('grant_id').notNull(),
    jobId: text('job_id').notNull(),
    callId: text('call_id'),
    kind: text({ enum: LEDGER_KINDS }).notNull(),
    amount: millionths('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_ledger_grant').on(t.grantId),
    index('ai_ledger_job').on(t.jobId),
    uniqueIndex('ai_ledger_one_charge')
      .on(t.callId, t.grantId)
      .where(sql`${t.kind} = 'charge'`),
  ],
)

/** An AI job: who started it in which workspace, what it runs, how far it got, and each call's output. */
export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    memberId: text('member_id').notNull(),
    kind: text({ enum: AI_JOB_KINDS }).notNull(),
    state: text({ enum: AI_JOB_STATES }).notNull().default('waiting'),
    /** The run on now: each run of the job takes the next one. */
    attempt: integer().notNull().default(0),
    input: jsonb().notNull(),
    output: jsonb(),
    /** The pg-boss queue it runs from, and the pg-boss job that runs it now; a job sent again to start later gets a new one. */
    queue: text(),
    queueJobId: text('queue_job_id'),
    /** Each done call's output by its call index, so a job run again reuses it. */
    callOutputs: jsonb('call_outputs').$type<Record<string, CallOutput>>().notNull().default({}),
    error: text(),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('ai_jobs_workspace').on(t.workspaceId, t.state)],
)

/**
 * The call log: one row per try of an AI call, with what it cost the seller in millionths of its currency
 * (and the cost the seller reported, where it gives one), its real cost in millionths of a rupee, and the
 * real cost the workspace is charged (a fixed amount for the layer split). No prompt and no picture.
 */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: text().primaryKey(),
    jobId: text('job_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    callIndex: integer('call_index').notNull(),
    try: integer().notNull(),
    attempt: integer().notNull(),
    step: text().notNull(),
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
    /** When this try was charged to its job's hold; one try of an AI call at most is ever charged. */
    chargedAt: timestamp('charged_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('ai_calls_try').on(t.jobId, t.callIndex, t.try),
    uniqueIndex('ai_calls_one_charge')
      .on(t.jobId, t.callIndex)
      .where(sql`${t.chargedAt} is not null`),
    index('ai_calls_started').on(t.startedAt),
    index('ai_calls_seller').on(t.seller, t.startedAt),
  ],
)

/**
 * The daily check: for each seller and UTC day, our call log's cost and the seller's own figure, both in
 * millionths of the seller's currency before GST or fee, and for Modal the cost outside our calls.
 */
export const aiDailyChecks = pgTable(
  'ai_daily_checks',
  {
    seller: text().notNull(),
    day: text().notNull(),
    currency: text().notNull(),
    ourCost: millionths('our_cost').notNull(),
    sellerCost: millionths('seller_cost'),
    outsideCalls: millionths('outside_calls'),
    state: text({ enum: DAILY_CHECK_STATES }).notNull(),
    source: text({ enum: DAILY_CHECK_SOURCES }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.seller, t.day] })],
)

/** A seller's usage file an admin uploaded, with the days it covered and each day's cost it gave. */
export const aiSellerFiles = pgTable(
  'ai_seller_files',
  {
    id: text().primaryKey(),
    seller: text({ enum: UPLOADED_SELLERS }).notNull(),
    name: text().notNull(),
    uploadedBy: text('uploaded_by').notNull(),
    currency: text().notNull(),
    /** Each day's cost, by UTC day, in millionths of the currency. */
    days: jsonb().$type<Record<string, string>>().notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_seller_files_seller').on(t.seller, t.uploadedAt)],
)

/**
 * A brief of the AI flow: its words, pictures, reference ad, kit logo, size and mode, the section it made, the liked
 * draft's picture for more like this, and once planned the round plan's answer, which Try again draws from.
 */
export const aiBriefs = pgTable(
  'ai_briefs',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    brandId: text('brand_id').notNull(),
    designId: designId(),
    sectionId: text('section_id').notNull(),
    words: text().notNull(),
    /** The storage keys of the brief's pictures. */
    pictureKeys: text('picture_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    referenceKey: text('reference_key'),
    logoKey: text('logo_key'),
    likedKey: text('liked_key'),
    width: integer().notNull(),
    height: integer().notNull(),
    mode: text({ enum: AI_MODES }).notNull(),
    plan: jsonb().$type<RoundPlanAnswer>(),
    /** The person who wrote it. */
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ai_briefs_design').on(t.designId)],
)

/**
 * An AI frame: a frame of a design the AI flow fills, with its brief, the job and call that fill it now, what
 * it holds, its state, and its current picture's asset.
 */
export const aiFrames = pgTable(
  'ai_frames',
  {
    designId: designId(),
    frameId: text('frame_id').notNull(),
    briefId: text('brief_id').references(() => aiBriefs.id, { onDelete: 'set null' }),
    jobId: text('job_id').notNull(),
    callIndex: integer('call_index').notNull(),
    kind: text({ enum: AI_FRAME_KINDS }).notNull(),
    state: text({ enum: AI_FRAME_STATES }).notNull().default('waiting'),
    assetId: text('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.designId, t.frameId] }), index('ai_frames_job').on(t.jobId)],
)

/** One refine of an AI frame: the person's message, their marks, the summary of the change, and the version it made. */
export const aiRefines = pgTable(
  'ai_refines',
  {
    id: text().primaryKey(),
    designId: designId(),
    frameId: text('frame_id').notNull(),
    message: text().notNull(),
    marksKey: text('marks_key'),
    summary: text(),
    resultAssetId: text('result_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    jobId: text('job_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ai_refines_frame').on(t.designId, t.frameId, t.createdAt)],
)
