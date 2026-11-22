// What the scripts that write the bundled sets share: how they write a JSON file and how they tidy tags.

/** JSON of an object written one entry a line, so a new version's changes read line by line. */
export function linePerEntry(entries: [string, unknown][]) {
  return `{\n${entries.map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`).join(',\n')}\n}\n`
}

/** Lowercase tags, each once, without Phosphor's markers such as `*new*`. */
export function tagsOf(tags: unknown[]): string[] {
  const words = tags.map((tag) => String(tag).trim().toLowerCase()).filter((tag) => tag && !tag.startsWith('*'))
  return [...new Set(words)]
}
