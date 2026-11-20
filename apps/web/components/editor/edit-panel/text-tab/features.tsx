'use client'

// The Text switcher tab's Font features section: a switch for each OpenType feature the texts'
// fonts have, from ligatures to small caps, for the selected texts or the selected run while one is
// being edited. A feature a font lacks is hidden, but small caps, which are made up from capitals.
import { type Features, OFFERED_FEATURES, type OfferedFeature, withRunStyle } from '@dazbee/schema'

import { SwitchRow } from '@/components/editor/edit-panel/fields.tsx'
import { set, type Style, type Target, textStyle } from '@/components/editor/edit-panel/target.ts'
import { useFontArrivals } from '@/components/editor/editor-hooks.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** The feature every font may show, as it is drawn from capitals where a font has none. */
const ALWAYS_SHOWN: OfferedFeature = 'smcp'

/** A switch for each feature the selected texts' fonts have, read again as font files arrive. */
export function FeatureRows({ target }: { target: Target }) {
  const t = useMessages()
  useFontArrivals(target.editor)
  const { styles } = textStyle(target)
  const families = [...new Set(styles.map((style) => style.fontFamily))]
  const shown = OFFERED_FEATURES.filter(
    ({ tag }) => tag === ALWAYS_SHOWN || families.every((family) => target.editor.fontFeatures(family)?.has(tag)),
  )
  return shown.map(({ tag, onByDefault }) => (
    <SwitchRow
      key={tag}
      name={t.editor.props.features[tag]}
      on={featureOn(styles, tag, onByDefault)}
      onSet={(on) => setFeature(target, tag, on)}
    />
  ))
}

/** Whether a feature is on in every style (true), in some (mixed) or in none (false); one a style doesn't set is as fonts have it. */
function featureOn(styles: readonly Style[], tag: OfferedFeature, onByDefault: boolean): boolean | 'mixed' {
  const on = styles.map((style) => style.features?.[tag] ?? onByDefault)
  return on.every(Boolean) ? true : on.some(Boolean) ? 'mixed' : false
}

/** Turns a feature on or off: for the selected run, over each character's own, else in each text's base style. */
function setFeature(target: Target, tag: OfferedFeature, on: boolean) {
  const turned: Features = { [tag]: on }
  if (target.range) return target.editor.styleTextSelection({ features: turned })
  return set(target, (now) => ({ style: withRunStyle(now.style as Style, { features: turned }) }))
}
