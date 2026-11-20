// What every area's routes share: the context they run in, the error body, reading a request's body,
// the check that a request has a session, the membership of the workspace a route is for, the checks
// that its role writes or manages the workspace, and the brand a brand route is for, within the brands
// the member may see. An agent's session reaches only its access's workspace, with the membership capped
// by the access.
import type { MiddlewareHandler } from 'hono'
import type { z } from 'zod'

import type { Db } from '@dazbee/db'
import {
  type ApiError,
  type BrandSummary,
  type MemberBrands,
  roleManages,
  roleWrites,
  type SignInRefused,
} from '@dazbee/schema'

import type { AgentSession, Session, SessionOf } from './sign-in/session.ts'
import { findAccess, findBrand, type MemberAccess } from './workspace/workspace.ts'

/**
 * A person's place in the workspace a route is for: that workspace, their role there, and the brands
 * they may see, a list for a limited member or null for every brand.
 */
export interface Membership extends MemberAccess {
  workspaceId: string
}

/**
 * A route's context: the session `requireSession` found; on every route of a workspace, the membership
 * `membershipScope` found; and on every route below a brand, the brand `brandScope` found in that
 * membership's workspace.
 */
export type Env = { Variables: { session: Session; membership: Membership; brand: BrandSummary } }

/** The body of every error answer. */
export const error = (message: string): ApiError => ({ error: message })

/**
 * The body parsed with `schema`, or a 400 response saying what's wrong with it. When `optional`, an empty body
 * is read as `{}`.
 */
export async function body<T extends z.ZodType>(
  request: Request,
  schema: T,
  { optional = false } = {},
): Promise<z.infer<T> | Response> {
  let json: unknown
  try {
    const text = await request.text()
    json = optional && text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return Response.json(error('The body is not JSON'), { status: 400 })
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success)
    return Response.json(
      error(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')),
      { status: 400 },
    )
  return parsed.data
}

/**
 * Answers 401 to a request `sessionOf` finds no session for, and to one whose person `refuses` turns away,
 * with its refusal, as for a person whose account is deleted or whose access was removed; otherwise puts its
 * session on the context.
 */
export function requireSession(
  sessionOf: SessionOf,
  refuses: (userId: string) => Promise<ApiError | SignInRefused | null> = () => Promise.resolve(null),
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = await sessionOf(c.req.raw)
    if (!session) return c.json(error('Sign in first'), 401)
    const refused = await refuses(session.userId)
    if (refused) return c.json(refused, 401)
    c.set('session', session)
    await next()
  }
}

/**
 * Answers 404 "No such workspace" unless the session's person is a member of the route's `:workspaceId`, and
 * for an agent's session, unless it is its access's workspace; otherwise puts their membership on the context,
 * read again on every request, capped by an agent's access. It runs after `requireSession`.
 */
export function membershipScope(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const workspaceId = c.req.param('workspaceId') ?? ''
    const { userId, agent } = c.var.session
    const access = agent && agent.workspaceId !== workspaceId ? null : await findAccess(db, workspaceId, userId)
    if (!access) return c.json(error('No such workspace'), 404)
    c.set('membership', { workspaceId, ...(agent ? cappedByAgent(access, agent) : access) })
    await next()
  }
}

/** Answers 403 to a member whose role does not write (a Reviewer); it runs after the membership's check. */
export const requireWriter: MiddlewareHandler<Env> = async (c, next) => {
  if (!roleWrites(c.var.membership.role)) return c.json(error('Only an Owner, Admin or Editor can do this'), 403)
  await next()
}

/**
 * Answers 403 to a member who is not an Owner or Admin, who alone manage the workspace; it runs after the
 * membership's check.
 */
export const requireManager: MiddlewareHandler<Env> = async (c, next) => {
  if (!roleManages(c.var.membership.role)) return c.json(error('Only an Owner or Admin can do this'), 403)
  await next()
}

/**
 * Answers 403 to a member limited to some brands, who can't add one; it runs after the membership's check.
 */
export const requireUnlimited: MiddlewareHandler<Env> = async (c, next) => {
  if (c.var.membership.brandIds) return c.json(error('A member limited to some brands can’t add one'), 403)
  await next()
}

/**
 * Answers 404 "No such brand" when the route's `:brandId` is not a brand of the membership's workspace, or
 * not one of a limited member's; otherwise puts the brand on the context. It runs after the membership's
 * check.
 */
export function brandScope(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { workspaceId, brandIds } = c.var.membership
    const brandId = c.req.param('brandId') ?? ''
    const brand = brandIds && !brandIds.includes(brandId) ? null : await findBrand(db, workspaceId, brandId)
    if (!brand) return c.json(error('No such brand'), 404)
    c.set('brand', brand)
    await next()
  }
}

/**
 * A membership as an agent's access holds it: an Editor's role at most, a Reviewer's for an access that doesn't
 * write, and only the brands both the membership and the access name.
 */
function cappedByAgent(member: MemberAccess, agent: AgentSession): MemberAccess {
  const role = agent.writes && roleWrites(member.role) ? 'editor' : 'reviewer'
  return { role, brandIds: bothBrands(member.brandIds, agent.brandIds) }
}

/** The brands two lists both name, where null names every brand. */
function bothBrands(a: MemberBrands, b: MemberBrands): MemberBrands {
  if (a === null) return b
  if (b === null) return a
  return a.filter((id) => b.includes(id))
}
