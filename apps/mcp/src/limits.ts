// What the MCP server holds each agent to, so that one busy agent can't slow the one server.

/** The largest request body taken: a bigger one is refused (413) before any of it is parsed. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

/** The largest answer sent: the usual MCP client reads at most 10 MiB, and the rest is room for the JSON-RPC envelope. */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024

/** Room kept in an answer for what wraps a tool's text: its content block, `isError` and the JSON-RPC envelope. */
export const ANSWER_ENVELOPE_BYTES = 2 * 1024

/** How long a session lasts without a call. */
export const MCP_SESSION_IDLE_MS = 30 * 60 * 1000

/** The most sessions an agent access holds at once; a new one ends the oldest. */
export const MAX_MCP_SESSIONS_PER_ACCESS = 4

/** The most sessions held at once, of all accesses; past it, a new one is refused as busy. */
export const MAX_MCP_SESSIONS = 200

/**
 * The most agent tabs open at once in the process, each the editor's core on one design; past it, open_design
 * answers busy. Set from the memory one agent tab takes on the benchmark design (`tests/pixels/src/agent-tab-cost.ts`).
 */
export const MAX_AGENT_TABS = 20

/** The most agent tabs one agent access holds open at once, across its sessions; past it, open_design answers busy. */
export const MAX_AGENT_TABS_PER_ACCESS = 2

/** How long open_design waits for the sync server's welcome. */
export const OPEN_DESIGN_TIMEOUT_MS = 30_000

/** The least `maxBytes` read_frame takes. */
export const MIN_TREE_BYTES = 1024

/** The most `maxBytes` read_frame takes: what an answer may hold. */
export const MAX_TREE_BYTES = MAX_ANSWER_BYTES - ANSWER_ENVELOPE_BYTES

/** How long a request may take before it is answered 503, so no client waits on a call that never ends. */
export const CALL_TIMEOUT_MS = 60_000

/** The largest body an OAuth endpoint takes: a registration or a token request is a few hundred bytes. */
export const MAX_OAUTH_BODY_BYTES = 64 * 1024

/** `bytes` in MiB, as the limits are told to an agent: "8 MiB", "8.5 MiB". */
export function inMiB(bytes: number): string {
  return `${Number((bytes / 1024 / 1024).toFixed(1))} MiB`
}
