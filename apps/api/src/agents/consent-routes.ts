// The routes the web app's Connect an agent page asks with the person's session, to answer an agent's sign-in
// (ADR-0019): the request it shows, the person's consent in a workspace, which makes the code the agent swaps,
// and their refusal. Each answers where to send the person back to the agent. An agent's session is refused.
import { Hono, type MiddlewareHandler } from 'hono'

import type { Db } from '@dazbee/db'
import {
  type AgentAuthorizationRequest,
  AgentConsent,
  type AgentRedirect,
  MAX_AGENT_REQUEST_ID,
  roleWrites,
} from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import { findMe } from '../me/me.ts'
import { listBrands } from '../workspace/workspace.ts'
import { consent, deny, findRequest } from './oauth.ts'

/** What a sign-in request that has expired, was answered or never was is told. */
const EXPIRED = 'This sign-in has expired or was answered already; connect the agent again'

/** Answers 403 to an agent's session, which never answers for the person. */
const personOnly: MiddlewareHandler<Env> = async (c, next) => {
  if (c.var.session.agent) return c.json(error('Only the person can answer an agent'), 403)
  await next()
}

/** The consent routes, mounted after the session's check and, in a workspace, the membership's. */
export function agentConsentRoutes({ db }: { db: Db }): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/agent/authorizations/:request', personOnly, async (c) => {
    const pending = await findRequest(db, requestId(c.req.param('request')))
    const me = pending && (await findMe(db, c.var.session.userId))
    if (!pending || !me) return c.json(error(EXPIRED), 404)
    const { host } = new URL(pending.redirectUri)
    return c.json({
      clientName: pending.clientName,
      redirectHost: host,
      workspaces: me.workspaces,
    } satisfies AgentAuthorizationRequest)
  })

  app.post('/agent/authorizations/:request/deny', personOnly, async (c) => {
    const redirect = await deny(db, requestId(c.req.param('request')))
    return redirect ? c.json({ redirect } satisfies AgentRedirect) : c.json(error(EXPIRED), 404)
  })

  app.post('/workspaces/:workspaceId/agent-accesses', personOnly, async (c) => {
    const input = await body(c.req.raw, AgentConsent)
    if (input instanceof Response) return input
    const { workspaceId, role, brandIds: theirs } = c.var.membership
    if (input.writes && !roleWrites(role)) return c.json(error('A Reviewer’s agent can only view'), 403)
    const asked = input.brandIds && [...new Set(input.brandIds)]
    const unseen =
      asked &&
      (asked.some((id) => theirs && !theirs.includes(id)) ||
        (await listBrands(db, workspaceId, asked)).length < asked.length)
    if (unseen) return c.json(error('No such brand'), 404)
    const choice = { userId: c.var.session.userId, workspaceId, brandIds: asked, writes: input.writes }
    const redirect = await consent(db, input.request, choice)
    return redirect ? c.json({ redirect } satisfies AgentRedirect, 201) : c.json(error(EXPIRED), 404)
  })

  return app
}

/** A request id from a path, cut so a long one is never hashed whole. */
function requestId(param: string): string {
  return param.slice(0, MAX_AGENT_REQUEST_ID)
}
