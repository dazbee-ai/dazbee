// The third-party notices: each icon, sticker, illustration and artwork set Dazbee bundles for agents to place, its
// name linking to its site in a new tab, its maker credited where its notice names one, with its version, its licence's
// name and the licence in full, its paragraphs flowing to the page's width. Open to anyone, signed in or not.
import Link from 'next/link'

import { SET_NOTICES } from '@dazbee/graphics/notices'

import { buttonStyles } from '@/components/ui/button.tsx'
import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { cn } from '@/lib/cn.ts'
import { format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'

export async function generateMetadata() {
  return { title: (await getMessages()).pages.notices.title }
}

/** A version or a licence's name kept left to right in any language's line, so 2026-11-22 never reads 22-11-2026. */
function leftToRight(text: string): string {
  return `\u2066${text}\u2069`
}

export default async function NoticesPage() {
  const words = (await getMessages()).pages.notices
  return (
    <main className="min-h-dvh bg-bg text-text">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 md:py-16">
        <Link href="/" className="self-start" aria-label={words.action}>
          <DazbeeMark size={40} />
        </Link>
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-title font-bold tracking-tight md:leading-tight">{words.title}</h1>
          <p className="text-card text-muted">{words.line}</p>
        </header>
        {SET_NOTICES.map((notice, i) => (
          <section
            key={notice.title}
            aria-labelledby={`notice-${i}`}
            data-testid="notice"
            className="rounded-[20px] border border-line bg-surface p-5 shadow-panel md:p-7"
          >
            <h2 id={`notice-${i}`} className="font-display text-heading font-bold tracking-tight md:leading-tight">
              <a
                href={notice.homepage}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-line-strong decoration-2 underline-offset-4 hover:decoration-current"
              >
                {notice.title}
              </a>
            </h2>
            {notice.creator && (
              <p className="mt-1 text-label text-muted">
                {words.by}{' '}
                <a
                  href={notice.creator.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-line-strong underline-offset-4 hover:decoration-current"
                >
                  {notice.creator.name}
                </a>
              </p>
            )}
            <p className="mt-1 text-label text-muted">
              {format(words.about, { version: leftToRight(notice.version), licence: leftToRight(notice.licence) })}
            </p>
            <div
              dir="ltr"
              lang="en"
              className="mt-4 flex flex-col gap-3 rounded-row border border-line bg-bg p-4 text-small text-muted"
            >
              {notice.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}
        <Link href="/" className={cn(buttonStyles({ variant: 'secondary', size: 'lg' }), 'self-start')}>
          {words.action}
        </Link>
      </div>
    </main>
  )
}
