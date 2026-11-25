// Before routing: on the pilot host (PILOT_HOST, pilot.dazbee.com in production) `/` shows the admin pages'
// overview, app/pilot/, `/access` early access, app/pilot/access/, and `/ai` the AI section, app/pilot/ai/,
// with the address left as it is. The pages themselves are not found on any other host.
import { type NextRequest, NextResponse } from 'next/server'

import { pilotPath } from '@/lib/pilot-host.ts'

export function proxy(request: NextRequest) {
  const path = pilotPath(request.nextUrl.pathname, request.headers.get('host'))
  if (path === request.nextUrl.pathname) return NextResponse.next()
  const url = request.nextUrl.clone()
  url.pathname = path
  return NextResponse.rewrite(url)
}

export const config = { matcher: ['/', '/access', '/ai'] }
