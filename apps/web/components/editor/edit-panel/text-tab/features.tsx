'use client'

// The Text switcher tab's Font features section: a switch for each OpenType feature the texts'
// fonts have, from ligatures to small caps, superscript and subscript, for the selected texts or the
// selected run while one is being edited. A feature a font lacks is hidden, but small caps,
// superscript and subscript, which are made up from its standard letters. Superscript and subscript
// turn each other off.
import { withRunStyle } from '@dazbee/schema'

import { SwitchRow } from '@/components/editor/edit-panel/fields.tsx'
import { type P, set, type Style, type Target, textStyle } from '@/components/editor/edit-panel/target.ts'
import { useFontArrivals } from '@/components/editor/editor-hooks.ts'
import { featureOn, shownFeatures, turnedFeatures } from '@/lib/editor/font-features.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** Turns a feature on or off (`turnedFeatures`): for the selected run, over each character's own, else in each text's base style. */
function setFeature(target: Target, tag: string, on: boolean) {
  const turned = turnedFeatures(tag, on)
  if (target.range) return target.editor.styleTextSelection({ features: turned })
  return set(target, (now) => ({ style: withRunStyle(now.style as Style, { features: turned }) }))
}

/** A switch for each feature the section shows for the selected texts (`shownFeatures`), read again as font files arrive. */
export function FeatureRows({ target }: { target: Target }) {
  const t = useMessages()
  useFontArrivals(target.editor)
  const { styles } = textStyle(target)
  return shownFeatures(styles, (family) => target.editor.fontFeatures(family)).map((feature) => (
    <SwitchRow
      key={feature.tag}
      name={t.editor.props.features[feature.tag as keyof P['features']]}
      on={featureOn(styles, feature)}
      onSet={(on) => setFeature(target, feature.tag, on)}
    />
  ))
}
