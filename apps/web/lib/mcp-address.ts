// The address an agent connects to Dazbee's MCP server at: `/mcp` on the host the person reached the web app at,
// as the proxy in front of it saw the request, so each copy of the app names its own and none is written here.

/**
 * `/mcp` on the request's host, over https when the proxy says the person reached it so, else http. The first of
 * the proxy's `x-forwarded-*` values is the one the person's browser sent. Null for a Host that isn't a host
 * name with an optional port.
 */
export function mcpAddress(headers: Pick<Headers, 'get'>): string | null {
  const host = first(headers.get('x-forwarded-host')) || first(headers.get('host'))
  if (!host || !/^[\w.-]+(:\d+)?$|^\[[\d:a-f.]+\](:\d+)?$/i.test(host)) return null
  const protocol = first(headers.get('x-forwarded-proto')).toLowerCase() === 'https' ? 'https' : 'http'
  return `${protocol}://${host}/mcp`
}

/** The first value of a header a proxy may give as a list. */
function first(value: string | null) {
  return value?.split(',')[0]?.trim() ?? ''
}
