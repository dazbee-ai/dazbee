// The third-party notices: each icon set Dazbee bundles for agents to place, with its version, its licence's name
// and the licence in full, as the set ships it. Open to anyone, signed in or not.
import Link from 'next/link'

import { ICON_SET_NOTICES } from '@dazbee/graphics/notices'

import { buttonStyles } from '@/components/ui/button.tsx'
import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { cn } from '@/lib/cn.ts'
import { format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'

export async function generateMetadata() {
  return { title: (await getMessages()).pages.notices.title }
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
        {ICON_SET_NOTICES.map((notice, i) => (
          <section
            key={notice.title}
            aria-labelledby={`notice-${i}`}
            data-testid="notice"
            className="rounded-[20px] border border-line bg-surface p-5 shadow-panel md:p-7"
          >
            <h2 id={`notice-${i}`} className="font-display text-heading font-bold tracking-tight md:leading-tight">
              <a href={notice.homepage} target="_blank" rel="noreferrer" className="hover:underline">
                {notice.title}
              </a>
            </h2>
            <p className="mt-1 text-label text-muted">
              {format(words.about, { version: notice.version, licence: notice.licence })}
            </p>
            <pre
              dir="ltr"
              className="mt-4 overflow-x-auto rounded-row border border-line bg-bg p-4 font-mono text-caption whitespace-pre-wrap text-muted"
            >
              {notice.text}
            </pre>
          </section>
        ))}
        <Link href="/" className={cn(buttonStyles({ variant: 'secondary', size: 'lg' }), 'self-start')}>
          {words.action}
        </Link>
      </div>
    </main>
  )
}
