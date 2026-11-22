// One ask at a time for each key: a caller asking while the key's ask is under way shares it, as a component React's
// strict mode mounts twice in development does; once it settles, the next caller asks again.

/** Asks for a key's answer, or shares the ask for it already under way. */
export function sharedAsks<T>(): (key: string, ask: () => Promise<T>) => Promise<T> {
  const underWay = new Map<string, Promise<T>>()
  return (key, ask) => {
    const sharing = underWay.get(key)
    if (sharing) return sharing
    const asked = ask().finally(() => underWay.delete(key))
    underWay.set(key, asked)
    return asked
  }
}
