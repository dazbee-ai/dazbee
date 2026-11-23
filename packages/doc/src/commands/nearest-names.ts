// The names nearest one that was not found, by how many letters set them apart, for a refusal to offer.

/** How many names a refusal offers as the nearest to one there is not. */
const NEAREST_NAMES = 5

/** The `count` names of `names` nearest `name` in spelling, nearest first; names as near keep the order given. */
export function nearestNames(name: string, names: readonly string[], count = NEAREST_NAMES): string[] {
  return names
    .map((candidate, place) => ({ candidate, place, distance: editDistance(name, candidate) }))
    .sort((a, b) => a.distance - b.distance || a.place - b.place)
    .slice(0, count)
    .map(({ candidate }) => candidate)
}

/** How many letters must be added, taken away or swapped to make `a` into `b` (the Levenshtein distance). */
function editDistance(a: string, b: string): number {
  const letters = [...b]
  let above = Array.from({ length: letters.length + 1 }, (_, j) => j)
  for (const [i, letter] of [...a].entries()) {
    const row = [i + 1]
    for (const [j, other] of letters.entries())
      row.push(Math.min((above[j + 1] ?? 0) + 1, (row[j] ?? 0) + 1, (above[j] ?? 0) + (letter === other ? 0 : 1)))
    above = row
  }
  return above.at(-1) ?? 0
}
