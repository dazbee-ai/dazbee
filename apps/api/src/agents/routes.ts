// Settings' routes of a member's agent accesses in a workspace: listing the ones that haven't ended, and
// ending one. Each is mounted under the workspace it is for, and answers a person's session only: an agent's
// token is refused before it reaches them.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'

import { type Env, error } from '../http.ts'
import { endAccess, listAccesses } from './agent-accesses.ts'

export function agentAccessRoutes({ db }: { db: Db }): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/agent-accesses', async (c) =>
    c.json(await listAccesses(db, c.var.membership.workspaceId, c.var.session.userId)),
  )

  app.delete('/agent-accesses/:accessId', async (c) => {
    const member = { workspaceId: c.var.membership.workspaceId, userId: c.var.session.userId }
    const ended = await endAccess(db, member, c.req.param('accessId'))
    return ended ? c.body(null, 204) : c.json(error('No such agent access'), 404)
  })

  return app
}
