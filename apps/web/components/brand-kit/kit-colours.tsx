'use client'

// The brand kit form's colours: the brand roles first, each set or not yet set, then the brand's own
// colours, each with its name and value.
import {
  type BrandColor,
  type BrandKit,
  type BrandRole,
  brandRoleOf,
  freeToken,
  roleSlots,
  withoutRole,
  withRole,
} from '@dazbee/schema'

import { CheckIcon, PaintBucketIcon, PlusIcon, XIcon } from '@/components/ui/icons.tsx'
import { DASHED_BUTTON } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { hexOf, hexText, parseHex } from '@/lib/colour.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { field, heading, iconButton, type KitBinding } from './kit-parts.ts'

/** One row of the form: a role, set (`entry`) or not, or a colour of the brand's own and its place among them. */
type Row = { role: BrandRole; entry: BrandColor | undefined } | { role?: undefined; entry: BrandColor; n: number }

const SWATCH =
  'h-16 w-12 shrink-0 cursor-pointer rounded-[12px] border border-line-strong bg-transparent p-0 [&::-webkit-color-swatch]:rounded-[11px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-moz-color-swatch]:rounded-[11px] [&::-moz-color-swatch]:border-0'
/** An unset role's swatch: a dashed outline with nothing in it, which picking a colour fills. */
const EMPTY_SWATCH =
  'border-dashed [&::-webkit-color-swatch]:opacity-0 [&::-moz-color-swatch]:opacity-0 hover:border-accent'

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
  const own = kit.colors.filter((c) => !brandRoleOf('color', c.token))
  const rows: Row[] = [...roleSlots(kit, 'color'), ...own.map((entry, i) => ({ entry, n: i + 1 }))]

  return (
    <section key="colours" aria-labelledby="kit-colors" className={section}>
      <h3 id="kit-colors" className={heading}>
        {t.colors}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <ColourRow key={row.role ?? row.entry.token} row={row} kit={kit} change={change} binding={binding} />
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          const name = format(t.newColor, { n: own.length + 1 })
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

/**
 * A colour's swatch, name and hex value, its binding button in the editor, and its remove button.
 * A role's name is fixed; an unset role shows an empty swatch and hex field, either of which sets it.
 */
function ColourRow({
  row,
  kit,
  change,
  binding,
}: {
  row: Row
  kit: BrandKit
  change: (next: BrandKit) => void
  binding: KitBinding | undefined
}) {
  const t = useMessages().editor.brandKit
  const { entry, role } = row
  const name = role ? t.roles[role] : (entry?.name ?? '')
  const token = role ?? entry?.token ?? ''
  const on = entry ? (binding?.follows('color', token) ?? false) : false
  /** The kit with this colour's value, or its name, changed. */
  const set = (patch: Partial<BrandColor>) => {
    if (role && patch.value) return change(withRole(kit, 'color', role, patch.value))
    change({ ...kit, colors: kit.colors.map((c) => (c.token === token ? { ...c, ...patch } : c)) })
  }
  const remove = () =>
    change(role ? withoutRole(kit, 'color', role) : { ...kit, colors: kit.colors.filter((c) => c.token !== token) })

  return (
    <li data-token={token} data-set={entry ? undefined : 'no'} className="flex items-start gap-1.5">
      <input
        name="colour"
        type="color"
        value={hexOf(entry?.value ?? '#000000FF')}
        aria-label={format(t.pick, { name })}
        onChange={(e) => set({ value: `${e.target.value}${entry?.value.slice(7) ?? 'FF'}`.toUpperCase() })}
        className={cn(SWATCH, !entry && EMPTY_SWATCH)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {role ? (
          <span className="flex h-8 items-center px-2 text-small font-medium">{name}</span>
        ) : (
          <input
            name="colour-name"
            key={`name-${name}`}
            defaultValue={name}
            aria-label={format(t.colorName, { n: row.n })}
            maxLength={60}
            onBlur={(e) =>
              e.target.value.trim() && e.target.value.trim() !== name && set({ name: e.target.value.trim() })
            }
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className={field}
          />
        )}
        <input
          name="colour-hex"
          key={`hex-${entry?.value ?? ''}`}
          defaultValue={entry ? hexText(entry.value) : ''}
          placeholder={entry ? undefined : t.notSet}
          aria-label={format(t.colorValue, { name })}
          spellCheck={false}
          onBlur={(e) => {
            const value = parseHex(e.target.value)
            if (value && value !== entry?.value) set({ value })
            else e.target.value = entry ? hexText(entry.value) : ''
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={cn(field, 'h-7 font-mono text-tiny uppercase placeholder:font-sans placeholder:normal-case')}
        />
      </div>
      {binding && entry && (
        <button
          type="button"
          aria-label={format(on ? t.unbind : t.apply, { name })}
          aria-pressed={on}
          disabled={!binding.canColor}
          onClick={() => binding.apply('color', token)}
          className={iconButton}
        >
          {on ? <CheckIcon size={15} aria-hidden /> : <PaintBucketIcon size={15} aria-hidden />}
        </button>
      )}
      {entry && (
        <button type="button" aria-label={format(t.remove, { name })} onClick={remove} className={iconButton}>
          <XIcon size={13} aria-hidden />
        </button>
      )}
    </li>
  )
}
