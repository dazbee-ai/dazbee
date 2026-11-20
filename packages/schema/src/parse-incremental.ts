import { carryOverLayer } from './carry-over.ts'
import { deepFreeze, isRecord } from './json.ts'
import { Layer } from './layers.ts'

/** Validated layers by the object they came from; a validated layer maps to itself. */
const layerCache = new WeakMap<object, Layer>()

/**
 * One layer, validated on its own once carried over to this schema's version (`carryOverLayer`):
 * its type, props and defaults, but not its parent. A layer
 * object seen before is not validated again: a design read again after one edit only validates
 * what the edit replaced. So an input is never changed after being passed in; replace the object
 * instead. Frozen: the layer is shared by every later parse of the same object.
 */
export function parseLayer(input: unknown): { success: true; layer: Layer } | { success: false; errors: string[] } {
  const cached = isRecord(input) ? layerCache.get(input) : undefined
  if (cached) return { success: true, layer: cached }
  const parsed = Layer.safeParse(carryOverLayer(input))
  if (!parsed.success)
    return { success: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  const layer = deepFreeze(parsed.data)
  if (isRecord(input)) layerCache.set(input, layer)
  layerCache.set(layer, layer)
  return { success: true, layer }
}
