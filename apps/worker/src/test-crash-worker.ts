// A worker run as its own process by the worker's tests, which kill it to see what a crash leaves: it runs
// the queue CRASH_QUEUE with a test seller CRASH_SELLER that answers the AI step CRASH_STEP after
// CRASH_AFTER_MS, and prints "ready" once it takes jobs. Run by tests only.
import { PgBoss } from 'pg-boss'

import { STEPS, useSeller } from '@dazbee/ai'
import { testSeller } from '@dazbee/ai/test-sellers'
import { openDatabase } from '@dazbee/db'
import { openStorage, storageSettings } from '@dazbee/storage'

import { startStepsWorker } from './steps-job.ts'
import { DATABASE_URL } from './test-database.ts'

const read = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

STEPS[read('CRASH_STEP')] = { kind: 'text', expected: () => ({ 'input-token': 1000, 'output-token': 500 }) }
useSeller(testSeller(read('CRASH_SELLER'), [], { afterMs: Number(read('CRASH_AFTER_MS')), timeoutMs: 60_000 }))
const { db } = openDatabase(DATABASE_URL)
const storage = openStorage(
  storageSettings({
    STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
    STORAGE_BUCKET: 'dazbee-test',
    STORAGE_ACCESS_KEY_ID: 'dazbee',
    STORAGE_SECRET_ACCESS_KEY: 'dazbee-local-secret',
    STORAGE_REGION: 'us-east-1',
    ...process.env,
  }),
)
const boss = new PgBoss({ connectionString: DATABASE_URL, max: 4, schedule: false })
boss.on('error', () => undefined)
await boss.start()
await startStepsWorker({ db, boss, storage, queue: read('CRASH_QUEUE'), callLimit: 8 })
console.log('ready')
