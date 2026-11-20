// The API's calls for the Connect an agent page, from the web app's server only: the agent's sign-in request it
// shows, and the person's answer to it, each of which says where to send the person back to the agent.
import 'server-only'

import { AgentAuthorizationRequest, type AgentConsent, AgentRedirect } from '@dazbee/schema'

import { ApiFailure, call, workspaceRoot } from './api.ts'

/**
 * The sign-in request the agent's client sent the person with, or null when the API has none by that id: it
 * expired, was answered, or never was. A person with no session gets an ApiFailure 401, so the page can send
 * them to sign in and back.
 */
export async function findAgentRequest(request: string): Promise<AgentAuthorizationRequest | null> {
  try {
    return await call(AgentAuthorizationRequest, requestPath(request), undefined, { signIn: false })
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** Gives the agent access in the workspace, and answers where the person goes back to the agent with its code. */
export async function allowAgent(workspaceId: string, consent: AgentConsent) {
  const path = `${workspaceRoot(workspaceId)}/agent-accesses`
  return (await call(AgentRedirect, path, { method: 'POST', body: consent }, { signIn: false })).redirect
}

/** Refuses the agent, and answers where the person goes back to it with `access_denied`. */
export async function denyAgent(request: string) {
  const path = `${requestPath(request)}/deny`
  return (await call(AgentRedirect, path, { method: 'POST', body: {} }, { signIn: false })).redirect
}

/** The API's path of a sign-in request. */
function requestPath(request: string) {
  return `/agent/authorizations/${encodeURIComponent(request)}`
}
