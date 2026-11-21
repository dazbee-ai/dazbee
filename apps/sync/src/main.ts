// Starts the sync server (#677, D10); settings come from the environment only, and a limit set out of
// its range stops it from starting (`limitSettings`). A signal to stop closes every tab, which
// reconnects elsewhere, and folds and unloads every design before the process exits.
import { openDatabase } from '@dazbee/db'
import { syncTokenSecret } from '@dazbee/sync-token'

import { limitSettings } from './limits.ts'
import { openSyncServer } from './sync-server.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.SYNC_PORT ?? 1234)
const secret = syncTokenSecret()
const limits = limitSettings(process.env)

const { db, close } = openDatabase(databaseUrl)
const server = openSyncServer({ db, secret, port, limits })
await server.listen()
for (const signal of ['SIGINT', 'SIGQUIT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void server
      .destroy()
      .then(() => close())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          // A design that could not be folded is still in its journal: the next server replays it.
          console.error('the sync server did not stop cleanly', error)
          process.exit(1)
        },
      )
  })
console.log(`sync server on ws://localhost:${port}`)
