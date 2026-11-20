// Agents' sign-in (ADR-0019): OAuth 2.1 with PKCE, which the API runs and `apps/mcp` serves at `/oauth/*`, and the
// person's consent on the web app's Connect an agent page. `apps/mcp` passes each OAuth request's parameters on
// as they came, and the API answers in OAuth's own words (RFC 6749, RFC 7591, RFC 7009), which `apps/mcp` gives
// back; the consent's requests and answers are the API's.
import { z } from 'zod'

import { MemberRole, RecordId, WorkspaceSummary } from './api.ts'

/** An OAuth error answer (RFC 6749 §5.2): its code, such as `invalid_grant`, and a sentence. */
export const OAuthError = z.object({ error: z.string(), error_description: z.string().optional() })
export type OAuthError = z.infer<typeof OAuthError>

/** An OAuth request's parameters, as `apps/mcp` passes them on: each name once, with its text. */
export const OAuthParams = z.record(z.string(), z.string())
export type OAuthParams = z.infer<typeof OAuthParams>

/**
 * The answer to an authorization request: the id of the request kept for the person's consent, or the
 * error to send the person back to the client with (`redirect`), or, for an unknown client or redirect URI,
 * an error to show them, never a redirect.
 */
export const AgentAuthorizationStarted = z.union([
  z.object({ request: z.string() }),
  OAuthError.extend({ redirect: z.url().optional() }),
])
export type AgentAuthorizationStarted = z.infer<typeof AgentAuthorizationStarted>

/**
 * A sign-in request as the Connect an agent page shows it: the client's own name for itself, the host it sends
 * the person back to, and the person's workspaces with their role and whether they are limited to some brands.
 */
export const AgentAuthorizationRequest = z.object({
  clientName: z.string(),
  redirectHost: z.string(),
  workspaces: z.array(WorkspaceSummary.extend({ role: MemberRole, limited: z.boolean() })),
})
export type AgentAuthorizationRequest = z.infer<typeof AgentAuthorizationRequest>

/** The longest sign-in request id taken; the API makes them 43 characters long. */
export const MAX_AGENT_REQUEST_ID = 200

/** A person's consent: the request, the brands the agent may open (null for every brand they see), and whether it edits. */
export const AgentConsent = z.object({
  request: z.string().min(1).max(MAX_AGENT_REQUEST_ID),
  brandIds: z.array(RecordId).min(1).max(1000).nullable(),
  writes: z.boolean(),
})
export type AgentConsent = z.infer<typeof AgentConsent>

/** Where to send the person after they allow or deny an agent: the client's redirect URI with the code or the error. */
export const AgentRedirect = z.object({ redirect: z.url() })
export type AgentRedirect = z.infer<typeof AgentRedirect>

/** The header `apps/mcp` names the client's address in, as Cloudflare saw it, which registrations are counted by. */
export const AGENT_CLIENT_IP_HEADER = 'x-agent-client-ip'

/** The header `apps/mcp` names the resource it serves in, `<base>/mcp`, which a client's `resource` must be. */
export const AGENT_RESOURCE_HEADER = 'x-agent-resource'
