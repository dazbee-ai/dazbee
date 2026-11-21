// Writes the bundled icon sets from the npm packages pinned in this package's devDependencies: each set's drawings
// by style (`sets/<set>/<style>.json`), its LICENSE beside them, the search index (`sets/index.json`) and the
// notices the app lists (`src/notices.json`). Run `pnpm --filter @dazbee/graphics icons` after changing a pin.
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { IconPath, PathHow } from './icon-svg.ts'
import type { IconIndex, IndexedIcon } from './search.ts'
import { ICON_SETS, type IconSetId } from './sets.ts'

/** A drawing's elements, as the source gives them: each path's data and the attributes that change how it is drawn. */
type SourcePath = { d: string; fill?: string; stroke?: string; opacity?: string }

/** What one set gives: its icons' tags and, by style, each icon's paths. */
interface SourceSet {
  dir: string
  version: string
  licence: string
  tags: Map<string, string[]>
  drawings: Record<string, Map<string, SourcePath[]>>
}

const PACKAGE = join(import.meta.dirname, '..')

const sources: Record<IconSetId, SourceSet> = { tabler: await tabler(), phosphor: await phosphor() }
const index: IconIndex = { tabler: [], phosphor: [] }
const notices: Record<string, { version: string; licence: string; text: string }> = {}

for (const [set, source] of Object.entries(sources) as [IconSetId, SourceSet][]) {
  const { styles, lines } = ICON_SETS[set]
  const out = join(PACKAGE, 'sets', set)
  await mkdir(out, { recursive: true })
  for (const style of styles) {
    const drawings = source.drawings[style] ?? new Map<string, SourcePath[]>()
    const entries = [...drawings].map(([name, paths]): [string, IconPath[]] => [
      name,
      paths.map((path) => compact(path, style === lines?.style)),
    ])
    await writeFile(join(out, `${style}.json`), linePerEntry(entries))
  }
  await copyFile(join(source.dir, 'LICENSE'), join(out, 'LICENSE'))
  index[set] = [...source.tags].map(([name, tags]): IndexedIcon => {
    const has = styles.filter((style) => source.drawings[style]?.has(name))
    return [name, has, tags]
  })
  notices[set] = {
    version: source.version,
    licence: source.licence,
    text: await readFile(join(source.dir, 'LICENSE'), 'utf8'),
  }
  console.log(`${set} ${source.version}: ${source.tags.size} icons`)
}
await writeFile(join(PACKAGE, 'sets', 'index.json'), JSON.stringify(index))
await writeFile(join(PACKAGE, 'src', 'notices.json'), `${JSON.stringify(notices, null, 2)}\n`)

/** Tabler: its outline and filled drawings from its node lists, and each icon's tags with its category. */
async function tabler(): Promise<SourceSet> {
  const dir = packageDir(ICON_SETS.tabler.npm)
  const listed = JSON.parse(await readFile(join(dir, 'icons.json'), 'utf8')) as Record<
    string,
    { category?: string; tags?: unknown[] }
  >
  const nodes = async (style: string) => {
    const file = JSON.parse(await readFile(join(dir, `tabler-nodes-${style}.json`), 'utf8')) as Record<
      string,
      [string, SourcePath][]
    >
    return new Map(Object.entries(file).map(([name, list]) => [name, list.map(([tag, path]) => pathOnly(tag, path))]))
  }
  return {
    ...(await manifest(dir)),
    tags: new Map(
      Object.entries(listed).map(([name, { category, tags = [] }]) => [name, tagsOf([...tags, category ?? ''])]),
    ),
    drawings: { outline: await nodes('outline'), filled: await nodes('filled') },
  }
}

/** Phosphor: each weight's SVG files, and each icon's tags with its categories from the package's catalog. */
async function phosphor(): Promise<SourceSet> {
  const dir = packageDir(ICON_SETS.phosphor.npm)
  const catalog = (await import(ICON_SETS.phosphor.npm)) as {
    icons: { name: string; tags: string[]; categories: string[] }[]
  }
  const drawings: SourceSet['drawings'] = {}
  for (const style of ICON_SETS.phosphor.styles) {
    const folder = join(dir, 'assets', style)
    const suffix = style === 'regular' ? '' : `-${style}`
    const files = (await readdir(folder)).sort().filter((file) => file.endsWith(`${suffix}.svg`))
    drawings[style] = new Map(
      await Promise.all(
        files.map(async (file) => {
          const name = file.slice(0, -`${suffix}.svg`.length)
          return [name, svgPaths(await readFile(join(folder, file), 'utf8'), file)] as const
        }),
      ),
    )
  }
  return {
    ...(await manifest(dir)),
    tags: new Map(catalog.icons.map(({ name, tags, categories }) => [name, tagsOf([...tags, ...categories])])),
    drawings,
  }
}

/** The installed package's folder, where pnpm links it into this package's node_modules. */
function packageDir(name: string) {
  return join(PACKAGE, 'node_modules', name)
}

/** The installed package's version and licence. */
async function manifest(dir: string) {
  const { version, license } = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
    version: string
    license: string
  }
  return { dir, version, licence: license }
}

/** A node list's element as a path, refused when it is anything else. */
function pathOnly(tag: string, path: SourcePath): SourcePath {
  if (tag !== 'path') throw new Error(`a <${tag}> where only paths are expected`)
  return path
}

/** An SVG file's paths, refused when it holds anything else. */
function svgPaths(text: string, file: string): SourcePath[] {
  const body = /^<svg[^>]*>(.*)<\/svg>\s*$/s.exec(text)?.[1]
  if (body === undefined) throw new Error(`${file} is not one <svg>`)
  const paths = [...body.matchAll(/<path([^>]*?)\/>/g)].map(([, attributes = '']) =>
    Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])),
  ) as SourcePath[]
  if (body.replace(/<path[^>]*?\/>/g, '').trim() !== '') throw new Error(`${file} holds more than paths`)
  return paths
}

/** Lowercase tags, each once, without Phosphor's markers such as `*new*`. */
function tagsOf(tags: unknown[]): string[] {
  const words = tags.map((tag) => String(tag).trim().toLowerCase()).filter((tag) => tag && !tag.startsWith('*'))
  return [...new Set(words)]
}

/**
 * A path as the bundle keeps it: its data alone when it is drawn as its style draws, else with what differs. A style
 * of lines strokes each path and fills none, any other fills each and strokes none.
 */
function compact({ d, fill, stroke, opacity }: SourcePath, lines: boolean): IconPath {
  const how: PathHow = {}
  const fills = fill === undefined ? !lines : fill !== 'none'
  const strokes = lines && stroke !== 'none'
  if (fills !== !lines) how.fill = fills
  if (strokes !== lines) how.stroke = strokes
  if (opacity !== undefined) how.opacity = Number(opacity)
  return Object.keys(how).length === 0 ? d : [d, how]
}

/** JSON of an object written one entry a line, so a new version's changes read line by line. */
function linePerEntry(entries: [string, unknown][]) {
  return `{\n${entries.map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`).join(',\n')}\n}\n`
}
