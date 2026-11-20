'use client'

// The brand kit form's fonts, each with its name and family.
import { type BrandFont, type BrandKit, freeToken } from '@dazbee/schema'

import { CheckIcon, PlusIcon, TextAaIcon, XIcon } from '@/components/ui/icons.tsx'
import { DASHED_BUTTON } from '@/components/ui/looks.ts'
import { Select } from '@/components/ui/select.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { field, heading, iconButton, type KitBinding } from './kit-parts.ts'

export function KitFonts({
  kit,
  change,
  binding,
  section,
  families,
}: {
  kit: BrandKit
  change: (next: BrandKit) => void
  binding: KitBinding | undefined
  section: string
  families: string[]
}) {
  const t = useMessages().editor.brandKit
  const setFont = (i: number, patch: Partial<BrandFont>) =>
    change({ ...kit, fonts: kit.fonts.map((f, j) => (j === i ? { ...f, ...patch } : f)) })

  return (
    <section key="fonts" aria-labelledby="kit-fonts" className={section}>
      <h3 id="kit-fonts" className={heading}>
        {t.fonts}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {kit.fonts.map((f, i) => {
          const on = binding?.follows('font', f.token) ?? false
          return (
            <li key={f.token} data-token={f.token} className="flex items-start gap-1.5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <input
                  name="font-name"
                  key={`name-${f.name}`}
                  defaultValue={f.name}
                  aria-label={format(t.fontName, { n: i + 1 })}
                  maxLength={60}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value.trim() !== f.name &&
                    setFont(i, { name: e.target.value.trim() })
                  }
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className={field}
                />
                <Select
                  name="font-family"
                  label={format(t.fontFamily, { name: f.name })}
                  value={f.family}
                  options={[...new Set([f.family, ...families])].map((family) => ({ value: family, label: family }))}
                  onChange={(family) => setFont(i, { family })}
                  className="h-7 bg-bg/40 px-2 text-tiny"
                />
              </div>
              {binding && (
                <button
                  type="button"
                  aria-label={format(on ? t.unbind : t.apply, { name: f.name })}
                  aria-pressed={on}
                  disabled={!binding.canFont}
                  onClick={() => binding.apply('font', f.token)}
                  className={iconButton}
                >
                  {on ? <CheckIcon size={15} aria-hidden /> : <TextAaIcon size={15} aria-hidden />}
                </button>
              )}
              <button
                type="button"
                aria-label={format(t.remove, { name: f.name })}
                onClick={() => change({ ...kit, fonts: kit.fonts.filter((_, j) => j !== i) })}
                className={iconButton}
              >
                <XIcon size={13} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          const name = format(t.newFont, { n: kit.fonts.length + 1 })
          change({
            ...kit,
            fonts: [...kit.fonts, { token: freeToken(kit, name), name, family: families[0] ?? 'Noto Sans' }],
          })
        }}
        className={DASHED_BUTTON}
      >
        <PlusIcon size={13} aria-hidden />
        {t.addFont}
      </button>
    </section>
  )
}
