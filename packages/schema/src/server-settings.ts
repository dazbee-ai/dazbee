// A server's settings read from the environment at start: each a whole number with its value when unset, and the
// least and most it may be, so a server refuses to start on a value out of its range; or a text, such as an outside
// service's key, that turns a feature on when set. This module imports nothing.

/** One setting: its environment variable, its value when unset or empty, and the least and most it may be. */
export interface ServerSetting {
  name: string
  value: number
  least: number
  most: number
}

/**
 * The value `env` gives each of `settings`, its default when unset or empty. Throws, naming the variable, on a value
 * that isn't a whole number from its least to its most.
 */
export function serverSettings<K extends string>(
  env: Readonly<Record<string, string | undefined>>,
  settings: Readonly<Record<K, ServerSetting>>,
): Record<K, number> {
  const values = {} as Record<K, number>
  for (const key of Object.keys(settings) as K[]) values[key] = settingOf(env, settings[key])
  return values
}

/** The text `env` gives the variable `name`, without spaces at either end, or null when it is unset or empty. */
export function serverText(env: Readonly<Record<string, string | undefined>>, name: string): string | null {
  return env[name]?.trim() || null
}

/** The value `env` gives `setting`. */
function settingOf(env: Readonly<Record<string, string | undefined>>, { name, value, least, most }: ServerSetting) {
  const given = env[name]?.trim()
  if (!given) return value
  const number = /^\d+$/.test(given) ? Number(given) : NaN
  if (!(number >= least && number <= most))
    throw new Error(`${name} must be a whole number from ${least} to ${most}, not “${given}”`)
  return number
}
