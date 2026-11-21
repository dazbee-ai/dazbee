// Writes `google-fonts.json`, the Google Fonts families Dazbee offers, and `shipped-ranks.json`, the
// place in Google Fonts' popularity order of each family we ship, from Google's own metadata:
// google/fonts at its latest commit, or the one given (`pnpm --filter @dazbee/fonts google-fonts
// <commit>`), Google Fonts' public family listing and Unicode's script names. Run it to take in
// Google's new families and updates, then copy them into storage with the API's `fonts:google`.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { GoogleFamily } from './google.ts'
import { googleFontList, type ListedFamily, type TreeEntry } from './google-metadata.ts'
import { FONT_FACES } from './index.ts'

const REPOSITORY = 'https://api.github.com/repos/google/fonts'
const LISTING = 'https://fonts.google.com/metadata/fonts'
const ALIASES = 'https://www.unicode.org/Public/UCD/latest/ucd/PropertyValueAliases.txt'
/** How many METADATA.pb files are fetched at once. */
const AT_ONCE = 16
const OUT = join(import.meta.dirname, 'google-fonts.json')
const SHIPPED_OUT = join(import.meta.dirname, 'shipped-ranks.json')

const commit = process.argv[2] ?? (await text(`${REPOSITORY}/commits/main`, 'application/vnd.github.sha')).trim()
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`not a commit: ${commit}`)
const tree = JSON.parse(await text(`${REPOSITORY}/git/trees/${commit}?recursive=1`)) as {
  truncated: boolean
  tree: (TreeEntry & { type: string })[]
}
if (tree.truncated) throw new Error('GitHub cut the tree of google/fonts short')
const blobs = tree.tree.filter((entry) => entry.type === 'blob')
const folders = blobs.flatMap((entry) => /^((?:ofl|apache|ufl)\/[^/]+)\/METADATA\.pb$/.exec(entry.path)?.[1] ?? [])
console.log(`google/fonts ${commit.slice(0, 12)}: reading ${folders.length} METADATA.pb files`)
const metadata = await inBatches(folders, async (path) => ({
  path,
  text: await text(`https://raw.githubusercontent.com/google/fonts/${commit}/${path}/METADATA.pb`),
}))
const listing = (JSON.parse(await text(LISTING)) as { familyMetadataList: ListedFamily[] }).familyMetadataList
const { families, shipped, leftOut } = googleFontList({
  metadata,
  tree: blobs,
  listing,
  aliases: await text(ALIASES),
  shipped: new Set(FONT_FACES.map((face) => face.family)),
})

await writeFile(OUT, format(commit, families))
await writeFile(SHIPPED_OUT, `${JSON.stringify(Object.fromEntries(shipped.map((f) => [f.family, f.rank])), null, 2)}\n`)
const faces = families.flatMap((family) => family.faces)
const gigabytes = faces.reduce((sum, face) => sum + face.bytes, 0) / 1e9
console.log(`Wrote ${families.length} families, ${faces.length} files, ${gigabytes.toFixed(2)} GB, to ${OUT}`)
console.log(`Left out ${leftOut.length}:`)
for (const { family, reason } of leftOut) console.log(`  ${family}: ${reason}`)

/** The list as JSON, one family to a line, so a new commit's changes read family by family. */
function format(at: string, list: readonly GoogleFamily[]): string {
  return `{\n  "commit": ${JSON.stringify(at)},\n  "families": [\n${list.map((f) => `    ${JSON.stringify(f)}`).join(',\n')}\n  ]\n}\n`
}

/** A URL's text, tried three times; GitHub's API is asked with a token when GITHUB_TOKEN holds one. */
async function text(url: string, accept?: string): Promise<string> {
  const headers: Record<string, string> = accept ? { accept } : {}
  if (url.startsWith(REPOSITORY) && process.env.GITHUB_TOKEN)
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers }).catch((reason: unknown) => reason as Error)
    if (response instanceof Response && response.ok) return response.text()
    if (attempt === 3)
      throw new Error(`${url} answered ${response instanceof Response ? response.status : response.message}`)
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
  }
}

/** Runs `work` on every item, `AT_ONCE` at a time, keeping the items' order. */
async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += AT_ONCE)
    out.push(...(await Promise.all(items.slice(i, i + AT_ONCE).map(work))))
  return out
}
