// Sign in (#58): one button to WorkOS AuthKit, which signs in or signs up. The API makes the link;
// the state cookie ties WorkOS's answer to this browser. An invite email's link that starts here
// brings its `invitation_token`, which the sign-in link carries on, so WorkOS accepts the invite. A
// sign-in early access refused comes back with its reason, and the notice says what to do; the address to
// write to is the setting SUPPORT_EMAIL. Under the early-access notice, Request access puts the person on the
// waiting list, with Cloudflare Turnstile's check when TURNSTILE_SITE_KEY is set. Right after a person deletes
// their account, it says the account is deleted. Sent from the Connect an agent page, Sign in carries that page
// on, and sign-in comes back to it.
import { buttonStyles } from '@/components/ui/button.tsx'
import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { CheckIcon, WarningCircleIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import type { Messages } from '@/lib/i18n/en.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { pageAfterSignIn } from '@/lib/server/sign-in.ts'

import { start } from './actions.ts'
import { AdFan } from './ad-fan.tsx'
import { RequestAccess } from './request-access.tsx'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: (await getMessages()).signIn.title }
}

// Sign-in has the form on the start half and fanned-out ads on the end half. Phones show the form alone.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string
    unavailable?: string
    invite?: string
    invitation_token?: string
    deleted?: string
    next?: string
  }>
}) {
  const [t, query] = await Promise.all([getMessages(), searchParams])
  // Right after deleting their account, the person is told it is deleted, as news rather than a refusal.
  const next = pageAfterSignIn(query.next)
  const news = query.deleted ? t.signIn.deleted : null
  const notice = query.unavailable ? (
    t.signIn.unavailable
  ) : query.error === 'early-access' ? (
    <EarlyAccessNotice words={t.signIn} email={process.env.SUPPORT_EMAIL?.trim() ?? ''} />
  ) : query.error === 'open-invite' ? (
    t.signIn.openInvite
  ) : query.error ? (
    t.signIn.failed
  ) : query.invite === 'unusable' ? (
    t.signIn.inviteUnusable
  ) : null
  return (
    <main data-theme="dark" className="relative isolate grid min-h-dvh overflow-hidden bg-bg text-text md:grid-cols-2">
      <aside aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <AdFan sample={t.signIn.sample} />
      </aside>
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-[7vw]">
        <form action={start} className="flex w-full max-w-[37rem] flex-col gap-[clamp(1rem,1.2vw,1.375rem)]">
          <DazbeeMark size={46} />
          <h1 className="font-display text-[clamp(2.5rem,3vw,3.5rem)] leading-[1.05] font-extrabold tracking-[-0.02em] text-balance">
            {t.signIn.headline} <br />
            {t.signIn.headlineEnd}
          </h1>
          {news && (
            <p
              role="status"
              data-testid="sign-in-news"
              className="flex items-center gap-2 rounded-[10px] border border-line bg-raised px-3 py-2.5 text-label text-text"
            >
              <CheckIcon aria-hidden size={18} weight="bold" className="shrink-0 text-success" />
              <span className="min-w-0">{news}</span>
            </p>
          )}
          {notice && (
            <p
              role="alert"
              data-testid="sign-in-notice"
              className="flex items-center gap-2 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2.5 text-label text-danger"
            >
              <WarningCircleIcon aria-hidden size={18} weight="bold" className="shrink-0" />
              <span className="min-w-0">{notice}</span>
            </p>
          )}
          {typeof query.invitation_token === 'string' && (
            <input type="hidden" name="invitation_token" value={query.invitation_token} />
          )}
          {next && <input type="hidden" name="next" value={next} />}
          <button
            type="submit"
            data-testid="sign-in"
            className={cn(
              buttonStyles({ variant: 'primary', size: 'lg' }),
              'mt-1 h-11 w-full max-w-[22rem] rounded-[10px] text-card font-bold',
            )}
          >
            {t.signIn.signIn}
          </button>
        </form>
        {query.error === 'early-access' && (
          <div className="mt-4">
            <RequestAccess turnstileSiteKey={process.env.TURNSTILE_SITE_KEY?.trim() ?? ''} />
          </div>
        )}
      </section>
    </main>
  )
}

/** The early access notice, with the address to write to as a mail link, or without it when none is set. */
function EarlyAccessNotice({ words, email }: { words: Messages['signIn']; email: string }) {
  if (!email) return words.earlyAccess
  const [before = '', after = ''] = words.earlyAccessWrite.split('{email}')
  return (
    <>
      {words.earlyAccess} {before}
      <a
        href={`mailto:${email}`}
        dir="ltr"
        className="font-semibold [overflow-wrap:anywhere] underline underline-offset-2"
      >
        {email}
      </a>
      {after}
    </>
  )
}
