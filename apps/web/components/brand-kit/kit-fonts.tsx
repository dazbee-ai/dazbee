'use client'

// The brand kit form's fonts: the brand roles first, each set or not yet set, then the brand's own
// fonts, each with its name and family.
import {
  type BrandFont,
  type BrandKit,
  type BrandRole,
  brandRoleOf,
  brandRolesOf,
  freeToken,
  kitIsFull,
  withBrandRole,
  withoutBrandRole,
} from '@dazbee/schema'

import { CheckIcon, PlusIcon, TextAaIcon, XIcon } from '@/components/ui/icons.tsx'
import { DASHED_BUTTON } from '@/components/ui/looks.ts'
import { Select } from '@/components/ui/select.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { field, heading, iconButton, type KitBinding } from './kit-parts.ts'

/** One row of the form: a role, set (`entry`) or not, or a font of the brand's own and its place among them. */
type Row = { role: BrandRole; entry: BrandFont | undefined } | { role?: undefined; entry: BrandFont; n: number }

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
  const own = kit.fonts.filter((f) => !brandRoleOf('font', f.token))
  // A full kit offers no place it can't fill: no role that isn't set, and no Add.
  const full = kitIsFull(kit, 'font')
  const roles = brandRolesOf(kit, 'font').filter((r) => r.entry || !full)
  const rows: Row[] = [...roles, ...own.map((entry, i) => ({ entry, n: i + 1 }))]

  return (
    <section key="fonts" aria-labelledby="kit-fonts" className={section}>
      <h3 id="kit-fonts" className={heading}>
        {t.fonts}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <FontRow
            key={row.role ?? row.entry.token}
            row={row}
            kit={kit}
            change={change}
            binding={binding}
            families={families}
          />
        ))}
      </ul>
      {!full && (
        <button
          type="button"
          onClick={() => {
            const name = format(t.newFont, { n: own.length + 1 })
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
      )}
    </section>
  )
}

/**
 * A font's name and family, its binding button in the editor, and its remove button. A role's name
 * is fixed; an unset role's family reads Not set until one is picked.
 */
function FontRow({
  row,
  kit,
  change,
  binding,
  families,
}: {
  row: Row
  kit: BrandKit
  change: (next: BrandKit) => void
  binding: KitBinding | undefined
  families: string[]
}) {
  const t = useMessages().editor.brandKit
  const { entry, role } = row
  const name = role ? t.brandRoles[role] : row.entry.name
  const token = role ?? row.entry.token
  const on = entry ? (binding?.follows('font', token) ?? false) : false
  /** The kit with this font's family, or its name, changed. */
  const set = (patch: Partial<BrandFont>) => {
    if (role && patch.family) return change(withBrandRole(kit, 'font', role, patch.family))
    change({ ...kit, fonts: kit.fonts.map((f) => (f.token === token ? { ...f, ...patch } : f)) })
  }
  const remove = () =>
    change(role ? withoutBrandRole(kit, 'font', role) : { ...kit, fonts: kit.fonts.filter((f) => f.token !== token) })
  const choices = entry ? [...new Set([entry.family, ...families])] : families

  return (
    <li data-token={token} data-set={entry ? undefined : 'no'} className="flex items-start gap-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {role ? (
          <span className="flex h-8 items-center px-2 text-small font-medium">{name}</span>
        ) : (
          <input
            name="font-name"
            key={`name-${name}`}
            defaultValue={name}
            aria-label={format(t.fontName, { n: row.n })}
            maxLength={60}
            onBlur={(e) =>
              e.target.value.trim() && e.target.value.trim() !== name && set({ name: e.target.value.trim() })
            }
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className={field}
          />
        )}
        <Select
          name="font-family"
          label={format(t.fontFamily, { name })}
          value={entry?.family ?? ''}
          placeholder={t.notSet}
          options={choices.map((family) => ({ value: family, label: family }))}
          onChange={(family) => set({ family })}
          className="h-7 bg-bg/40 px-2 text-tiny"
        />
      </div>
      {binding && entry && (
        <button
          type="button"
          aria-label={format(on ? t.unbind : t.apply, { name })}
          aria-pressed={on}
          disabled={!binding.canFont}
          onClick={() => binding.apply('font', token)}
          className={iconButton}
        >
          {on ? <CheckIcon size={15} aria-hidden /> : <TextAaIcon size={15} aria-hidden />}
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
