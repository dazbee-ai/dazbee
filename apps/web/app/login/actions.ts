'use server'

// Starts sign-in at WorkOS, carrying the token of the invite the person came from and the page to come back to.
// And sends a request to join from the early-access notice, with the person's address as Cloudflare saw it and the
// form's Turnstile token.
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { RequestAccess } from '@dazbee/schema'

import { getMessages } from '@/lib/i18n/server.ts'
import { requestAccess } from '@/lib/server/admin.ts'
import { ApiFailure } from '@/lib/server/api.ts'
import { logSignIn, startSignIn } from '@/lib/server/sign-in.ts'

/** What a request to join answered: sent, why it wasn't, or nothing yet. */
export type RequestAnswer = { sent: true } | { error: string } | null

export async function start(form: FormData) {
  const asked = await headers()
  const url = await startSignIn(
    { invitationToken: form.get('invitation_token'), next: form.get('next') },
    { origin: asked.get('origin'), host: asked.get('host') },
  )
  if (!url) {
    logSignIn('unavailable')
    redirect('/login?unavailable=1')
  }
  redirect(url)
}

/**
 * Sends the form's request to join: its email, name, company, note and Turnstile token. A form a request
 * can't be made from is refused here; the API's refusals are a 429 for too many from one address and a 400
 * for a Turnstile check that failed.
 */
export async function requestToJoin(_before: RequestAnswer, form: FormData): Promise<RequestAnswer> {
  const words = (await getMessages()).signIn.request
  const text = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value : ''
  }
  const input = RequestAccess.safeParse({
    email: text('email'),
    name: text('name'),
    company: text('company'),
    note: text('note'),
    turnstileToken: text('turnstile_token') || undefined,
  })
  if (!input.success) {
    const field = (name: string) => input.error.issues.some((issue) => issue.path[0] === name)
    return { error: field('email') ? words.badEmail : field('name') || field('company') ? words.missing : words.failed }
  }
  try {
    await requestAccess(input.data, (await headers()).get('cf-connecting-ip'))
  } catch (e) {
    if (!(e instanceof ApiFailure)) throw e
    return { error: e.status === 429 ? words.tooMany : e.status === 400 ? words.checkFailed : words.failed }
  }
  return { sent: true }
}
