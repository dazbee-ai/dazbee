// The name the app shows for a kit colour or font: a brand role's own name, in the person's
// language, or the name the brand gave its own.
import { brandRoleOf, type KitKind } from '@dazbee/schema'

import type { Messages } from '@/lib/i18n/index.ts'

/** A role's name, or the entry's own; `brandRoles` is the person's catalog's role names. */
export function kitEntryName(
  brandRoles: Messages['editor']['brandKit']['brandRoles'],
  kind: KitKind,
  entry: { token: string; name: string },
) {
  const role = brandRoleOf(kind, entry.token)
  return role ? brandRoles[role] : entry.name
}
