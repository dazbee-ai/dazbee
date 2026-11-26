// The worker (ADR-0022): runs AI jobs from pg-boss in our Postgres, the `ai-steps` queue and the flow's `ai-flow`
// queue under one limit of calls at once, sweeps every 5 minutes the jobs whose
// pg-boss job ended without them, settles unknown calls and checks the call log against the sellers' own
// figures each day, and answers a health check. The API migrates the database, so the worker
// starts after it. On SIGTERM it stops taking jobs and waits up to 110 s for those running. Settings come
// from the environment only, each seller's key among them.
import { createServer } from 'node:http'

import { PgBoss } from 'pg-boss'

import {
  FLOW_QUEUE,
  reportsOf,
  runDailyCheck,
  settleUnknownCalls,
  STEPS_QUEUE,
  sweepJobs,
  useSellersOf,
} from '@dazbee/ai'
import { openDatabase } from '@dazbee/db'
import { openStorage, storageSettings } from '@dazbee/storage'

import { startFlowWorker } from './flow-job.ts'
import { limiter } from './job-worker.ts'
import { startStepsWorker } from './steps-job.ts'

/** The queue the sweep's schedule sends to. */
const SWEEP_QUEUE = 'ai-sweep'
/** The queue the daily settling of unknown calls is sent to, at 05:30 UTC. */
const SETTLE_QUEUE = 'ai-unknown-calls'
/** The queue the daily check is sent to, at 06:00 UTC. */
const CHECK_QUEUE = 'ai-daily-check'
/** How long a graceful stop waits for running jobs: compose gives the worker 120 s. */
const STOP_WAIT_MS = 110_000

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.WORKER_PORT ?? 8790)
const callLimit = Number(process.env.WORKER_AI_CALLS ?? 8)
if (!Number.isInteger(callLimit) || callLimit < 1) throw new Error('WORKER_AI_CALLS is a whole number from 1')

// Each seller whose keys are set: OPENAI_API_KEY, MUSE_API_KEY, OPENROUTER_API_KEY, ZENMUX_API_KEY,
// PIXAZO_API_KEY, and MODAL_TOKEN_ID with MODAL_TOKEN_SECRET.
const sellers = useSellersOf()
const { db, close } = openDatabase(databaseUrl)
const storage = openStorage(storageSettings())
const boss = new PgBoss({ connectionString: databaseUrl, max: 4 })
boss.on('error', (error) => console.error(JSON.stringify({ msg: 'pg-boss error', error: String(error) })))
await boss.start()

// One limit of calls at once across both queues.
const calls = limiter(callLimit)
const steps = await startStepsWorker({ db, boss, storage, queue: STEPS_QUEUE, callLimit, calls })
const flow = await startFlowWorker({ db, boss, storage, queue: FLOW_QUEUE, callLimit, calls })
if (!(await boss.getQueue(SWEEP_QUEUE))) await boss.createQueue(SWEEP_QUEUE)
await boss.schedule(SWEEP_QUEUE, '*/5 * * * *')
await boss.work(SWEEP_QUEUE, async () => {
  const ended = (await sweepJobs(db, boss, STEPS_QUEUE)) + (await sweepJobs(db, boss, FLOW_QUEUE))
  if (ended > 0) console.warn(JSON.stringify({ msg: 'AI jobs swept', ended }))
})
if (!(await boss.getQueue(SETTLE_QUEUE))) await boss.createQueue(SETTLE_QUEUE)
await boss.schedule(SETTLE_QUEUE, '30 5 * * *')
await boss.work(SETTLE_QUEUE, async () => {
  console.log(JSON.stringify({ msg: 'unknown calls settled', ...(await settleUnknownCalls(db)) }))
})
// Each seller whose report keys are set: OPENAI_ADMIN_API_KEY, OPENROUTER_MANAGEMENT_API_KEY, ZENMUX_PLATFORM_API_KEY and Modal's token.
const reports = reportsOf()
if (!(await boss.getQueue(CHECK_QUEUE))) await boss.createQueue(CHECK_QUEUE)
await boss.schedule(CHECK_QUEUE, '0 6 * * *')
await boss.work(CHECK_QUEUE, async () => {
  const checked = await runDailyCheck(db, reports)
  const red = checked.filter((day) => day.state === 'red')
  console.log(JSON.stringify({ msg: 'daily check', checked: checked.length, red }))
})

// The image sets BUILD_ID to the commit it was built from; a worker run from a checkout is `dev`.
const build = process.env.BUILD_ID || 'dev'
let stopping = false
const health = createServer((request, response) => {
  const ok = request.url === '/health' && !stopping
  response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok, build }))
})
health.listen(port)
console.log(JSON.stringify({ msg: 'worker started', port, callLimit, sellers, build }))

process.once('SIGTERM', () => void shutDown())
process.once('SIGINT', () => void shutDown())

async function shutDown(): Promise<void> {
  stopping = true
  await Promise.all([steps.stop('graceful', STOP_WAIT_MS), flow.stop('graceful', STOP_WAIT_MS)])
  health.close()
  await close()
  process.exit(0)
}
