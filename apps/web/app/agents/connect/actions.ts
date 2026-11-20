'use server'

// What the Connect an agent page's Allow and Deny do: Allow gives the agent access in the workspace picked, to every
// brand the person sees or those ticked, editing or only viewing; Deny refuses it. Each sends the person back to the
// agent at the address the API answers, or says why the API refused, in the person's language, on the page. A
// person whose session ended goes to sign in and comes back to the request.
import { redirect } from 'next/navigation'

import { AgentConsent } from '@dazbee/schema'

import { getMessages } from '@/lib/i18n/server.ts'
import { allowAgent, denyAgent } from '@/lib/server/agents.ts'
import { ApiFailure } from '@/lib/server/api.ts'
import { signInForRequest } from '@/lib/server/sign-in.ts'

/** What Allow or Deny answered while the person stays on the page: why it was refused, or nothing yet. */
export type ConnectAnswer = { error: string } | null

/**
 * Allows the agent: the form's `request`, its `workspace`, `brands` (`all`, or `chosen` with a `brand` field for
 * each ticked) and `access` (`edit` or `view`). A form a consent can't be made from, such as Chosen brands with
 * none ticked, is refused here.
 */
export async function allow(_before: ConnectAnswer, form: FormData): Promise<ConnectAnswer> {
  const words = await getMessages()
  const request = text(form, 'request')
  const input = AgentConsent.safeParse({
    request,
    brandIds: form.get('brands') === 'all' ? null : form.getAll('brand'),
    writes: form.get('access') === 'edit',
  })
  if (!input.success) {
    const brands = input.error.issues.some((issue) => issue.path[0] === 'brandIds')
    return { error: brands ? words.settings.brands.noneChosen : words.connectAgent.expired }
  }
  return answered(request, words.connectAgent.refused.gone, () => allowAgent(text(form, 'workspace'), input.data))
}

/** Denies the agent the form's `request`. */
export async function deny(_before: ConnectAnswer, form: FormData): Promise<ConnectAnswer> {
  const request = text(form, 'request')
  return answered(request, (await getMessages()).connectAgent.expired, () => denyAgent(request))
}

/** A form's field as text, empty when it is missing or a file. */
function text(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Sends the person where the API's answer says, or gives why it refused: a Reviewer's agent given Edit, `missing`
 * for a 404, or else the API's own message. Without a session, sign-in opens and comes back to the request.
 */
async function answered(request: string, missing: string, ask: () => Promise<string>): Promise<ConnectAnswer> {
  let to: string
  try {
    to = await ask()
  } catch (e) {
    if (!(e instanceof ApiFailure) || e.status >= 500) throw e
    if (e.status === 401) {
      redirect(signInForRequest(request))
    }
    const words = (await getMessages()).connectAgent
    if (e.status === 403) return { error: words.refused.viewOnly }
    if (e.status === 404) return { error: missing }
    return { error: e.message }
  }
  redirect(to)
}
