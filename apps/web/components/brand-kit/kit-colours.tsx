'use client'

// The brand kit form's colours, each with its name and value.
import { type BrandColor, type BrandKit, freeToken } from '@dazbee/schema'

import { CheckIcon, PaintBucketIcon, PlusIcon, XIcon } from '@/components/ui/icons.tsx'
import { DASHED_BUTTON } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { hexOf, hexText, parseHex } from '@/lib/colour.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { field, heading, iconButton, type KitBinding } from './kit-parts.ts'

export function KitColours({
  kit,
  change,
  binding,
  section,
}: {
  kit: BrandKit
  change: (next: BrandKit) => void
  binding: KitBinding | undefined
  section: string
}) {
  const t = useMessages().editor.brandKit
  const setColor = (i: number, patch: Partial<BrandColor>) =>
    change({ ...kit, colors: kit.colors.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  return (
    <section key="colours" aria-labelledby="kit-colors" className={section}>
      <h3 id="kit-colors" className={heading}>
        {t.colors}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {kit.colors.map((c, i) => {
          const on = binding?.follows('color', c.token) ?? false
          return (
            <li key={c.token} data-token={c.token} className="flex items-start gap-1.5">
              <input
                name="colour"
                type="color"
                value={hexOf(c.value)}
                aria-label={format(t.pick, { name: c.name })}
                onChange={(e) => setColor(i, { value: `${e.target.value}${c.value.slice(7)}`.toUpperCase() })}
                className="h-16 w-12 shrink-0 cursor-pointer rounded-[12px] border border-line-strong bg-transparent p-0 [&::-webkit-color-swatch]:rounded-[11px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-moz-color-swatch]:rounded-[11px] [&::-moz-color-swatch]:border-0"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <input
                  name="colour-name"
                  key={`name-${c.name}`}
                  defaultValue={c.name}
                  aria-label={format(t.colorName, { n: i + 1 })}
                  maxLength={60}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value.trim() !== c.name &&
                    setColor(i, { name: e.target.value.trim() })
                  }
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className={field}
                />
                <input
                  name="colour-hex"
                  key={`hex-${c.value}`}
                  defaultValue={hexText(c.value)}
                  aria-label={format(t.colorValue, { name: c.name })}
                  spellCheck={false}
                  onBlur={(e) => {
                    const value = parseHex(e.target.value)
                    if (value && value !== c.value) setColor(i, { value })
                    else e.target.value = hexText(c.value)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className={cn(field, 'h-7 font-mono text-tiny uppercase')}
                />
              </div>
              {binding && (
                <button
                  type="button"
                  aria-label={format(on ? t.unbind : t.apply, { name: c.name })}
                  aria-pressed={on}
                  disabled={!binding.canColor}
                  onClick={() => binding.apply('color', c.token)}
                  className={iconButton}
                >
                  {on ? <CheckIcon size={15} aria-hidden /> : <PaintBucketIcon size={15} aria-hidden />}
                </button>
              )}
              <button
                type="button"
                aria-label={format(t.remove, { name: c.name })}
                onClick={() => change({ ...kit, colors: kit.colors.filter((_, j) => j !== i) })}
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
          const name = format(t.newColor, { n: kit.colors.length + 1 })
          change({ ...kit, colors: [...kit.colors, { token: freeToken(kit, name), name, value: '#000000FF' }] })
        }}
        className={DASHED_BUTTON}
      >
        <PlusIcon size={13} aria-hidden />
        {t.addColor}
      </button>
    </section>
  )
}
