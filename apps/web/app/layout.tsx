import './globals.css'

import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'

import { PageScroll } from '@/components/ui/overlay-scroll.ts'
import { PhoneSoon } from '@/components/ui/phone-soon.tsx'
import { PressMarks } from '@/components/ui/press-marks.tsx'
import { RenderProbe } from '@/components/ui/render-probe.tsx'
import { TooltipProvider } from '@/components/ui/tooltip.tsx'
import { fontVariables } from '@/lib/fonts.ts'
import { I18nProvider } from '@/lib/i18n/client.tsx'
import { dirOf } from '@/lib/i18n/index.ts'
import { getLocale, getMessages } from '@/lib/i18n/server.ts'
import { themeOf, themeScript } from '@/lib/theme.ts'
import { ThemePickProvider } from '@/lib/theme-pick.tsx'

export const metadata: Metadata = { title: 'Dazbee' }
export const viewport: Viewport = { themeColor: '#0e0c11', colorScheme: 'dark light' }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  const { phoneSoon } = (await getMessages()).pages
  const pick = themeOf((await cookies()).get('theme')?.value)
  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={fontVariables}
      // The commit the image was built from, which says which build a tab is on; `dev` from a checkout.
      data-build={process.env.BUILD_ID || 'dev'}
      {...(pick === 'system' ? {} : { 'data-theme': pick })}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* Shown in place of the app on a phone, by globals.css; hidden everywhere else. */}
        <PhoneSoon title={phoneSoon.title} line={phoneSoon.line} />
        <I18nProvider locale={locale}>
          <ThemePickProvider pick={pick}>
            <TooltipProvider>{children}</TooltipProvider>
          </ThemePickProvider>
          <RenderProbe />
          <PressMarks />
          <PageScroll />
        </I18nProvider>
      </body>
    </html>
  )
}
