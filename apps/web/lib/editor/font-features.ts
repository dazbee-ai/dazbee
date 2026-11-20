// The OpenType features the Text tab's Font features section offers, which of them it shows for
// the selected texts, and whether each is on.
import type { Features } from '@dazbee/schema'

/** An offered feature: its tag, whether fonts turn it on by default, and whether it is made up where a font lacks it. */
export interface OfferedFeature {
  tag: string
  onByDefault: boolean
  madeUp: boolean
}

/** What a text's style says of its font and features. */
type FeatureStyle = { fontFamily?: string; features?: Features | undefined }

/** The features offered, in the order the section lists them. Small caps a font lacks are drawn from capitals. */
export const OFFERED_FEATURES: readonly OfferedFeature[] = [
  { tag: 'liga', onByDefault: true, madeUp: false },
  { tag: 'calt', onByDefault: true, madeUp: false },
  { tag: 'tnum', onByDefault: false, madeUp: false },
  { tag: 'frac', onByDefault: false, madeUp: false },
  { tag: 'case', onByDefault: false, madeUp: false },
  { tag: 'zero', onByDefault: false, madeUp: false },
  { tag: 'ss01', onByDefault: false, madeUp: false },
  { tag: 'ss02', onByDefault: false, madeUp: false },
  { tag: 'ss03', onByDefault: false, madeUp: false },
  { tag: 'ss04', onByDefault: false, madeUp: false },
  { tag: 'ss05', onByDefault: false, madeUp: false },
  { tag: 'smcp', onByDefault: false, madeUp: true },
]

/**
 * The offered features to show for these styles: those every style's font has (`has` gives a
 * family's features, null until its files are here), those made up where a font lacks them, and
 * any a style has turned away from the fonts' way, so it can be turned back.
 */
export function shownFeatures(
  styles: readonly FeatureStyle[],
  has: (family: string) => ReadonlySet<string> | null,
): OfferedFeature[] {
  const families = [...new Set(styles.map((style) => style.fontFamily ?? ''))]
  return OFFERED_FEATURES.filter(
    (feature) =>
      feature.madeUp ||
      families.every((family) => has(family)?.has(feature.tag)) ||
      styles.some((style) => (style.features?.[feature.tag] ?? feature.onByDefault) !== feature.onByDefault),
  )
}

/** Whether a feature is on in every style (true), in some (mixed) or in none (false); one a style doesn't set is as fonts have it. */
export function featureOn(styles: readonly FeatureStyle[], feature: OfferedFeature): boolean | 'mixed' {
  const on = styles.map((style) => style.features?.[feature.tag] ?? feature.onByDefault)
  return on.every(Boolean) ? true : on.some(Boolean) ? 'mixed' : false
}
