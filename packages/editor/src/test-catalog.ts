// A font catalog for tests, as the web app and the MCP server give one: each family's faces listed by
// `fontFaces` and their files given by `fontFile`, noting what was asked of each.
import { type FontSources, type ListedFace, SHIPPED_FAMILIES } from './font-loads.ts'

/** A face of the test catalog: upright 400 unless it says otherwise. */
export interface TestFace {
  family: string
  weight?: number
  weights?: { min: number; max: number }
  style?: 'normal' | 'italic'
  bytes: Uint8Array
}

/**
 * Whether every family asked for is one we ship: a catalog of a brand with no upload of their names answers none, which a
 * test that holds its catalog's answers gives at once.
 */
export function shippedOnly(families: readonly string[]): boolean {
  return families.every((family) => SHIPPED_FAMILIES.has(family))
}

/**
 * The catalog of `faces`, answering at once: `asked` holds each `fontFaces` call's families, and
 * `fetched` each file given, as `<family> <weight> <style>`.
 */
export function testCatalog(faces: readonly TestFace[]) {
  const listed: ListedFace[] = faces.map((face, i) => ({
    id: `face-${i}`,
    family: face.family,
    weight: face.weight ?? 400,
    ...(face.weights ? { weights: face.weights } : {}),
    style: face.style ?? 'normal',
    source: 'upload',
  }))
  const bytesOf = new Map(listed.map((face, i) => [face.id, faces[i]?.bytes ?? new Uint8Array()]))
  const asked: string[][] = []
  const fetched: string[] = []
  const sources: Required<FontSources> = {
    fontFaces: (families) => {
      asked.push(families)
      return Promise.resolve(listed.filter((face) => families.includes(face.family)))
    },
    fontFile: (face) => {
      fetched.push(`${face.family} ${face.weight} ${face.style}`)
      return Promise.resolve(bytesOf.get(face.id) ?? new Uint8Array())
    },
  }
  return { asked, fetched, sources }
}
