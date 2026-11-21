// CSS custom properties read into the values that use them.

/** How many times variables are read inside variables. */
const MAX_VARIABLE_DEPTH = 4

/**
 * What reads values with their `var()`s replaced by the variables' values, or their fallbacks: each variable read
 * once, inside others at most `MAX_VARIABLE_DEPTH` deep, a cycle read as nothing, and every value cut at
 * `MAX_VALUE`, so no CSS makes a value grow past it.
 */
export function variableReader(variables: ReadonlyMap<string, string>, MAX_VALUE: number): (value: string) => string {
  const read = new Map<string, string>()
  return (value) => resolve(value, 0)

  function resolve(value: string, depth: number): string {
    if (!value.includes('var(')) return value
    const pattern = /var\(\s*(--[\w-]{1,100})\s*(?:,([^()]{0,200}))?\)/g
    let out = ''
    let last = 0
    for (let match = pattern.exec(value); match && out.length < MAX_VALUE; match = pattern.exec(value)) {
      const [whole, name = '', fallback] = match
      out += value.slice(last, match.index) + (depth >= MAX_VARIABLE_DEPTH ? '' : variableOf(name, fallback, depth))
      last = match.index + whole.length
    }
    return (out.length < MAX_VALUE ? out + value.slice(last) : out).slice(0, MAX_VALUE)
  }

  function variableOf(name: string, fallback: string | undefined, depth: number): string {
    const value = variables.get(name)
    if (value === undefined) return resolve(fallback?.trim() ?? '', depth + 1)
    let done = read.get(name)
    if (done === undefined) {
      read.set(name, '')
      done = resolve(value, depth + 1)
      read.set(name, done)
    }
    return done
  }
}
