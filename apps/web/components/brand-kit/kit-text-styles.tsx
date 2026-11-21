'use client'

// The brand kit form's text styles: each a name, its family drawn in the face it sets, and its
// font, weight, slant, line height, letter spacing and case. None holds a size: each text keeps its
// own. A style set in a kit font follows that font as the kit changes. In the editor, each binds the
// selected texts to it, so they follow it.
import type { KeyboardEvent } from 'react'

import {
  BRAND_KIT_LIMITS,
  type BrandKit,
  type BrandTextStyle,
  brandTextStyleFamily,
  type FontFamily,
  newBrandTextStyle,
} from '@dazbee/schema'

import { CheckIcon, PlusIcon, TextAaIcon, TextItalicIcon, XIcon } from '@/components/ui/icons.tsx'
import { DASHED_BUTTON, TOUCH_FIELD } from '@/components/ui/looks.ts'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { nearest, weightName, weightsOf } from './font-catalog.ts'
import { field, heading, iconButton, type KitBinding } from './kit-parts.ts'
import {
  keptLetterSpacing,
  keptLineHeight,
  letterSpacingUnit,
  textStyleFonts,
  textStyleFontValue,
} from './text-style-fields.ts'
import { TextStyleSample } from './text-style-sample.tsx'

/** The cases a style can draw its text in, in the order the menu lists them. */
const CASES = ['none', 'upper', 'lower', 'title'] as const

/** The weights offered for a family the catalog doesn't hold. */
const EVERY_WEIGHT = [100, 200, 300, 400, 500, 600, 700, 800, 900]

/** The look of a small field's caption, over the field, on one line. */
const CAPTION = 'flex min-w-0 flex-col gap-0.5 text-tiny text-muted [&>span]:truncate'

/** Ends typing in a field with Enter, which saves what it holds as leaving it does. */
const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()

/** A number typed into a field, or undefined for an empty or unreadable one. */
const typedNumber = (text: string) => {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() === '' || !Number.isFinite(value) ? undefined : value
}

export function KitTextStyles({
  workspaceId,
  brandId,
  kit,
  change,
  section,
  catalog,
  wide,
  binding,
}: {
  workspaceId: string
  brandId: string
  kit: BrandKit
  change: (next: BrandKit) => void
  section: string
  catalog: FontFamily[]
  wide: boolean
  binding: KitBinding | undefined
}) {
  const t = useMessages().editor.brandKit
  const full = kit.textStyles.length >= BRAND_KIT_LIMITS.textStyle
  const add = () => {
    const style = newBrandTextStyle(kit, (preset, n) =>
      preset ? t.textStyleNames[preset] : format(t.newTextStyle, { n }),
    )
    change({ ...kit, textStyles: [...kit.textStyles, style] })
  }

  return (
    <section aria-labelledby="kit-text-styles" className={cn(section, wide && 'md:col-span-2 xl:col-span-3')}>
      <h3 id="kit-text-styles" className={heading}>
        {t.textStyles}
      </h3>
      {kit.textStyles.length > 0 && (
        <ul className={cn('grid gap-3', wide && 'md:grid-cols-2 xl:grid-cols-3')}>
          {kit.textStyles.map((style, i) => (
            <TextStyleRow
              key={style.token}
              workspaceId={workspaceId}
              brandId={brandId}
              style={style}
              n={i + 1}
              kit={kit}
              change={change}
              catalog={catalog}
              binding={binding}
            />
          ))}
        </ul>
      )}
      {!full && (
        <button type="button" onClick={add} className={DASHED_BUTTON}>
          <PlusIcon size={13} aria-hidden />
          {t.addTextStyle}
        </button>
      )}
    </section>
  )
}

/**
 * A style's name, its binding button in the editor and its remove button, its family drawn in the
 * face it sets, and its settings.
 */
function TextStyleRow({
  workspaceId,
  brandId,
  style,
  n,
  kit,
  change,
  catalog,
  binding,
}: {
  workspaceId: string
  brandId: string
  style: BrandTextStyle
  n: number
  kit: BrandKit
  change: (next: BrandKit) => void
  catalog: FontFamily[]
  binding: KitBinding | undefined
}) {
  const messages = useMessages()
  const t = messages.editor.brandKit
  const props = messages.editor.props
  const { name } = style
  const on = binding?.follows('textLook', style.token) ?? false
  /** The catalog's family a style set in `font` is drawn in, and its weights; none while it is not set. */
  const drawnIn = (font: BrandTextStyle['font']) => {
    const known = catalog.find((f) => f.family === brandTextStyleFamily(kit, { ...style, font }))
    return { known, weights: weightsOf(known) }
  }
  const family = brandTextStyleFamily(kit, style)
  const { known, weights: familyWeights } = drawnIn(style.font)
  const weights = familyWeights.length > 0 ? familyWeights : EVERY_WEIGHT
  const weightChoices = [...new Set([...weights, style.fontWeight])].sort((a, b) => a - b)
  const fonts = textStyleFonts(
    kit,
    catalog.map((f) => f.family),
    t,
    style.font,
  )

  /** The kit with this style changed. */
  const set = (patch: Partial<BrandTextStyle>) =>
    change({ ...kit, textStyles: kit.textStyles.map((s) => (s.token === style.token ? { ...s, ...patch } : s)) })
  const remove = () => change({ ...kit, textStyles: kit.textStyles.filter((s) => s.token !== style.token) })
  /** Sets the style in another font, at the weight that font has nearest the style's. */
  const pickFont = (value: string) => {
    const picked = fonts.find((f) => f.value === value)
    if (!picked) return
    const nextWeights = drawnIn(picked.font).weights
    const fontWeight = nextWeights.length > 0 ? nearest(nextWeights, style.fontWeight) : style.fontWeight
    set({ font: picked.font, fontWeight })
  }

  return (
    <li data-token={style.token} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          name="text-style-name"
          key={`name-${name}`}
          defaultValue={name}
          aria-label={format(t.textStyleName, { n })}
          maxLength={60}
          onBlur={(e) => {
            const typed = e.target.value.trim()
            if (typed && typed !== name) set({ name: typed })
            else e.target.value = name
          }}
          onKeyDown={blurOnEnter}
          className={cn(field, 'flex-1 font-medium')}
        />
        {binding && (
          <button
            type="button"
            aria-label={format(on ? t.unbind : t.apply, { name })}
            aria-pressed={on}
            disabled={!binding.canTextStyle}
            onClick={() => binding.apply('textLook', style.token)}
            className={iconButton}
          >
            {on ? <CheckIcon size={15} aria-hidden /> : <TextAaIcon size={15} aria-hidden />}
          </button>
        )}
        <button type="button" aria-label={format(t.remove, { name })} onClick={remove} className={iconButton}>
          <XIcon size={13} aria-hidden />
        </button>
      </div>
      <TextStyleSample workspaceId={workspaceId} brandId={brandId} style={style} known={known} family={family} />
      <div className="flex items-center gap-1.5">
        <Select
          name="text-style-font"
          label={format(t.textStyleFont, { name })}
          value={textStyleFontValue(style.font)}
          options={fonts.map(({ value, label }) => ({ value, label }))}
          onChange={pickFont}
          className="h-7 min-w-0 flex-1 bg-bg/40 px-2 text-tiny"
        />
        <Select
          name="text-style-weight"
          label={format(t.textStyleWeight, { name })}
          value={String(style.fontWeight)}
          options={weightChoices.map((w) => ({
            value: String(w),
            label: weightName(messages.editor.fonts.weights, w),
          }))}
          onChange={(w) => set({ fontWeight: Number(w) })}
          className="h-7 w-28 shrink-0 bg-bg/40 px-2 text-tiny"
        />
        <button
          type="button"
          aria-label={format(t.textStyleItalic, { name })}
          aria-pressed={style.fontStyle === 'italic'}
          onClick={() => set({ fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' })}
          className={iconButton}
        >
          <TextItalicIcon size={15} aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <label className={CAPTION}>
          <span>{props.lineHeight}</span>
          <input
            name="text-style-line-height"
            key={`line-height-${style.lineHeight}`}
            type="number"
            inputMode="decimal"
            step={0.05}
            defaultValue={style.lineHeight ?? ''}
            placeholder={props.lineHeightAuto}
            aria-label={format(t.textStyleLineHeight, { name })}
            onBlur={(e) => {
              const lineHeight = keptLineHeight(typedNumber(e.target.value))
              if (lineHeight !== style.lineHeight) set({ lineHeight })
              else e.target.value = String(style.lineHeight ?? '')
            }}
            onKeyDown={blurOnEnter}
            className={cn(field, TOUCH_FIELD, 'h-7 text-tiny text-text tabular-nums')}
          />
        </label>
        <label className={CAPTION}>
          <span title={format(t.letterSpacingIn, { unit: letterSpacingUnit(style.letterSpacing) })}>
            {format(t.letterSpacingIn, { unit: letterSpacingUnit(style.letterSpacing) })}
          </span>
          <input
            name="text-style-letter-spacing"
            key={`letter-spacing-${style.letterSpacing.value}`}
            type="number"
            inputMode="decimal"
            step={0.5}
            defaultValue={style.letterSpacing.value}
            aria-label={format(t.textStyleLetterSpacing, { name })}
            onBlur={(e) => {
              const value = keptLetterSpacing(typedNumber(e.target.value))
              if (value !== style.letterSpacing.value) set({ letterSpacing: { ...style.letterSpacing, value } })
              else e.target.value = String(style.letterSpacing.value)
            }}
            onKeyDown={blurOnEnter}
            className={cn(field, TOUCH_FIELD, 'h-7 text-tiny text-text tabular-nums')}
          />
        </label>
        <label className={CAPTION}>
          <span>{props.textCase}</span>
          <Select
            name="text-style-case"
            label={format(t.textStyleCase, { name })}
            value={style.textCase ?? 'none'}
            options={CASES.map((c) => ({ value: c, label: props.textCases[c] }))}
            onChange={(c) => set({ textCase: c === 'none' ? undefined : (c as BrandTextStyle['textCase']) })}
            className="h-7 bg-bg/40 px-2 text-tiny text-text"
          />
        </label>
      </div>
    </li>
  )
}
