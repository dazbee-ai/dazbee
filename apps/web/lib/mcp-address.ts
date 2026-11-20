// The address an agent connects to Dazbee's MCP server at: `/mcp` at the public base URL, set as PUBLIC_URL as the
// MCP server's is (https://app.dazbee.com in production), so none is written here. A local copy, which sets none,
// names the host the person reached it at, where its web app passes `/mcp` on to the MCP server.

/**
 * `/mcp` at `publicUrl` when it is set. Else `/mcp` on the request's host, over https when the proxy says the person
 * reached it so, else http; the first of a proxy's `x-forwarded-*` values is the one the person's browser sent. Null
 * with no PUBLIC_URL and a Host that isn't a host name with an optional port.
 */
export function mcpAddress(headers: Pick<Headers, 'get'>, publicUrl = process.env.PUBLIC_URL): string | null {
  const base = publicUrl?.trim().replace(/\/+$/, '')
  if (base) return `${base}/mcp`
  const host = first(headers.get('x-forwarded-host')) || first(headers.get('host'))
  if (!host || !/^[\w.-]+(:\d+)?$|^\[[\d:a-f.]+\](:\d+)?$/i.test(host)) return null
  const protocol = first(headers.get('x-forwarded-proto')).toLowerCase() === 'https' ? 'https' : 'http'
  return `${protocol}://${host}/mcp`
}

/** The first value of a header a proxy may give as a list. */
function first(value: string | null) {
  return value?.split(',')[0]?.trim() ?? ''
}
