'use client'

// The Text switcher tab's Font features section: a switch for each OpenType feature the texts'
// fonts have, from ligatures to small caps, superscript and subscript, for the selected texts or the
// selected run while one is being edited. A feature a font lacks is hidden, but small caps,
// superscript and subscript, which are made up from its standard letters. Superscript and subscript
// turn each other off. After them, Raise: how far the characters are raised or lowered, as a share
// of their size, shown for every font.
import type { TextProps } from '@dazbee/schema'

import { SwitchRow } from '@/components/editor/edit-panel/fields.tsx'
import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import { type P, set, shared, type Target, textStyle } from '@/components/editor/edit-panel/target.ts'
import { useFontArrivals } from '@/components/editor/editor-hooks.ts'
import { featureOn, shownFeatures, textWithFeature, turnedFeatures } from '@/lib/editor/font-features.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { RAISE_MOST, sharedRaise, textWithRaise } from './raise.ts'

/**
 * Turns a feature on or off (`turnedFeatures`): for the selected run, over each character's own,
 * else in each text's base style and off in its runs where it turns their feature off (`textWithFeature`).
 */
function setFeature(target: Target, tag: string, on: boolean) {
  if (target.range) return target.editor.styleTextSelection({ features: turnedFeatures(tag, on) })
  return set(target, (now) => textWithFeature(now as Pick<TextProps, 'style' | 'runs'>, tag, on))
}

/**
 * Changes the raise from its own, held between −100 and 100: the selected run's, from its first
 * character's, else each whole text's, from its base style's (`textWithRaise`).
 */
function changeRaise(target: Target, change: (now: number) => number) {
  const to = (now: number) => tidy(clamp(change(now), -RAISE_MOST, RAISE_MOST))
  if (target.range) return target.editor.styleTextSelection({ raise: to(target.range[0]?.raise ?? 0) })
  return set(target, (now) => {
    const text = now as Pick<TextProps, 'style' | 'runs'>
    return textWithRaise(text, to(text.style.raise ?? 0))
  })
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

/**
 * The Raise field: how far the selected run's characters, else the selected texts', are raised, as
 * a percentage of their size, up positive; mixed where the characters differ. A drag is one undo step.
 */
export function RaiseField({ target }: { target: Target }) {
  const t = useMessages()
  const p = t.editor.props
  const value = target.range ? shared(target.range.map((style) => style.raise ?? 0)) : sharedRaise(target.props)
  return (
    <NumberField
      label={p.raise}
      name={p.raise}
      value={value}
      unit="%"
      min={-RAISE_MOST}
      max={RAISE_MOST}
      editor={target.editor}
      onSet={(v) => changeRaise(target, () => v)}
      onEach={(change) => changeRaise(target, change)}
    />
  )
}
