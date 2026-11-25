// The worker (ADR-0022): runs AI jobs from pg-boss in our Postgres, sweeps every 5 minutes the jobs whose
// pg-boss job ended without them, and answers a health check. The API migrates the database, so the worker
// starts after it. On SIGTERM it stops taking jobs and waits up to 110 s for those running. Settings come
// from the environment only.
import { createServer } from 'node:http'

import { PgBoss } from 'pg-boss'

import { sweepJobs } from '@dazbee/ai'
import { openDatabase } from '@dazbee/db'
import { openStorage, storageSettings } from '@dazbee/storage'

import { startStepsWorker } from './steps-job.ts'

/** The queue of `ai-steps` jobs, named after their kind. */
const STEPS_QUEUE = 'ai-steps'
/** The queue the sweep's schedule sends to. */
const SWEEP_QUEUE = 'ai-sweep'
/** How long a graceful stop waits for running jobs: compose gives the worker 120 s. */
const STOP_WAIT_MS = 110_000

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.WORKER_PORT ?? 8790)
const callLimit = Number(process.env.WORKER_AI_CALLS ?? 8)
if (!Number.isInteger(callLimit) || callLimit < 1) throw new Error('WORKER_AI_CALLS is a whole number from 1')

const { db, close } = openDatabase(databaseUrl)
const storage = openStorage(storageSettings())
const boss = new PgBoss({ connectionString: databaseUrl, max: 4 })
boss.on('error', (error) => console.error(JSON.stringify({ msg: 'pg-boss error', error: String(error) })))
await boss.start()

const steps = await startStepsWorker({ db, boss, storage, queue: STEPS_QUEUE, callLimit })
if (!(await boss.getQueue(SWEEP_QUEUE))) await boss.createQueue(SWEEP_QUEUE)
await boss.schedule(SWEEP_QUEUE, '*/5 * * * *')
await boss.work(SWEEP_QUEUE, async () => {
  const ended = await sweepJobs(db, boss, STEPS_QUEUE)
  if (ended > 0) console.warn(JSON.stringify({ msg: 'AI jobs swept', ended }))
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
console.log(JSON.stringify({ msg: 'worker started', port, callLimit, build }))

process.once('SIGTERM', () => void shutDown())
process.once('SIGINT', () => void shutDown())

async function shutDown(): Promise<void> {
  stopping = true
  await steps.stop('graceful', STOP_WAIT_MS)
  health.close()
  await close()
  process.exit(0)
}
