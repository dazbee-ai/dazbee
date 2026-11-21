// What the website read's route tests share: the stored sample pages, the catalog families they need, new brands
// and agent accesses.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { inArray } from 'drizzle-orm'
import type { Hono } from 'hono'

import { brands, fontFaces, newId } from '@dazbee/db'

import { issueTokens, makeAccess } from '../agents/agent-accesses.ts'
import type { Env } from '../http.ts'
import { authorization, db, personA, run, workspace } from '../test-api.ts'

/** The catalog families the sample pages need. */
const FAMILIES = [
  ['Fraunces', 'serif'],
  ['Work Sans', 'sans-serif'],
  ['Hanken Grotesk', 'sans-serif'],
  ['Lora', 'serif'],
  ['Playfair Display', 'serif'],
  ['Inter', 'sans-serif'],
] as const

/** How many brands `newBrand` has made, which numbers the next. */
let brandsMade = 0

/** A stored sample page or style sheet. */
export function sample(file: string): string {
  return readFileSync(join(import.meta.dirname, 'test-websites', file), 'utf8')
}

/**
 * Adds the catalog families the sample pages need, each as one face of its own, and gives what removes the faces
 * it added.
 */
export async function addSampleFamilies(): Promise<() => Promise<void>> {
  const faceIds: string[] = []
  for (const [family, category] of FAMILIES) {
    // A weight no copied Google face has, so the face stands beside the family's own where they are copied.
    const added = await db
      .insert(fontFaces)
      .values({
        id: newId(),
        source: 'google',
        family,
        weight: 401,
        weightMin: 100,
        weightMax: 900,
        style: 'normal',
        category,
        sha256: 'f'.repeat(64),
        byteSize: 1,
      })
      .onConflictDoNothing()
      .returning({ id: fontFaces.id })
    faceIds.push(...added.map((row) => row.id))
  }
  return async () => {
    if (faceIds.length > 0) await db.delete(fontFaces).where(inArray(fontFaces.id, faceIds))
  }
}

/** A new brand of the test workspace, its kit empty. */
export async function newBrand(): Promise<string> {
  const made = { id: `brand-site-${(brandsMade += 1)}-${run}`, workspaceId: workspace.id, name: `Site ${brandsMade}` }
  await db.insert(brands).values(made)
  return made.id
}

/** The bearer header of a new agent access of the Owner's to every brand, which edits when `writes`. */
export async function accessToken(writes: boolean): Promise<{ authorization: string }> {
  const access = await makeAccess(db, {
    userId: personA.id,
    workspaceId: workspace.id,
    brandIds: null,
    writes,
    clientId: null,
    clientName: 'Claude Code',
  })
  const { accessToken: token } = await issueTokens(db, access, new Date())
  return { authorization: `Bearer ${token}` }
}

/** Asks `app` for the brand's kit with `method`, as the Owner. */
export async function kitCall(app: Hono<Env>, method: string, brandId: string, body?: unknown) {
  const response = await app.request(`/workspaces/${workspace.id}/brands/${brandId}/kit`, {
    method,
    headers: { 'content-type': 'application/json', ...authorization('a') },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: (await response.json()) as unknown }
}
