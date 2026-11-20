'use client'

// The brand kit form's text styles: each a name, its family drawn in the face it sets, and its
// font, weight, slant, line height, letter spacing and case. None holds a size: each text keeps its
// own. A style set in a kit font follows that font as the kit changes.
import {
  BRAND_KIT_LIMITS,
  type BrandKit,
  type BrandTextStyle,
  brandTextStyleFamily,
  type FontFamily,
  newBrandTextStyle,
  NO_LETTER_SPACING,
} from '@dazbee/schema'

import { PlusIcon, TextItalicIcon, XIcon } from '@/components/ui/icons.tsx'
import { DASHED_BUTTON } from '@/components/ui/looks.ts'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { faceFor, nearest, weightsOf } from './font-catalog.ts'
import { FontPreview } from './font-preview.tsx'
import { field, heading, iconButton } from './kit-parts.ts'
import { textStyleFonts, textStyleFontValue } from './text-style-fonts.ts'

/** The cases a style can draw its text in, in the order the menu lists them. */
const CASES = ['none', 'upper', 'lower', 'title'] as const

/** The weights offered for a family the catalog doesn't hold. */
const EVERY_WEIGHT = [100, 200, 300, 400, 500, 600, 700, 800, 900]

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
}: {
  workspaceId: string
  brandId: string
  kit: BrandKit
  change: (next: BrandKit) => void
  section: string
  catalog: FontFamily[]
  wide: boolean
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

/** A style's name and remove button, its family drawn in the face it sets, and its settings. */
function TextStyleRow({
  workspaceId,
  brandId,
  style,
  n,
  kit,
  change,
  catalog,
}: {
  workspaceId: string
  brandId: string
  style: BrandTextStyle
  n: number
  kit: BrandKit
  change: (next: BrandKit) => void
  catalog: FontFamily[]
}) {
  const messages = useMessages()
  const t = messages.editor.brandKit
  const props = messages.editor.props
  const { name } = style
  const family = brandTextStyleFamily(kit, style)
  const known = catalog.find((f) => f.family === family)
  const familyWeights = weightsOf(known)
  const weights = familyWeights.length > 0 ? familyWeights : EVERY_WEIGHT
  const weightChoices = [...new Set([...weights, style.fontWeight])].sort((a, b) => a - b)
  const fonts = textStyleFonts(
    kit,
    catalog.map((f) => f.family),
    t,
  )
  const fontValue = textStyleFontValue(style.font)
  // A family of the style's own that the catalog no longer offers stays its pick.
  if (!fonts.some((f) => f.value === fontValue) && 'family' in style.font)
    fonts.push({ value: fontValue, font: style.font, label: style.font.family })

  /** The kit with this style changed. */
  const set = (patch: Partial<BrandTextStyle>) =>
    change({ ...kit, textStyles: kit.textStyles.map((s) => (s.token === style.token ? { ...s, ...patch } : s)) })
  const remove = () => change({ ...kit, textStyles: kit.textStyles.filter((s) => s.token !== style.token) })
  /** Sets the style in another font, at the weight that font has nearest the style's. */
  const pickFont = (value: string) => {
    const picked = fonts.find((f) => f.value === value)
    if (!picked) return
    const next = brandTextStyleFamily(kit, { ...style, font: picked.font })
    const nextWeights = weightsOf(catalog.find((f) => f.family === next))
    const fontWeight = nextWeights.length > 0 ? nearest(nextWeights, style.fontWeight) : style.fontWeight
    set({ font: picked.font, fontWeight })
  }
  const spacingUnit = style.letterSpacing.unit === 'px' ? 'px' : '%'

  return (
    <li data-token={style.token} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          name="text-style-name"
          key={`name-${name}`}
          defaultValue={name}
          aria-label={format(t.textStyleName, { n })}
          maxLength={60}
          onBlur={(e) =>
            e.target.value.trim() && e.target.value.trim() !== name && set({ name: e.target.value.trim() })
          }
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={cn(field, 'flex-1 font-medium')}
        />
        <button type="button" aria-label={format(t.remove, { name })} onClick={remove} className={iconButton}>
          <XIcon size={13} aria-hidden />
        </button>
      </div>
      <div className="flex h-8 items-center overflow-hidden px-2" data-testid="text-style-sample">
        {known ? (
          <FontPreview
            workspaceId={workspaceId}
            brandId={brandId}
            family={known}
            face={faceFor(known, style.fontWeight, style.fontStyle)}
          />
        ) : (
          <span className="truncate text-small text-muted">{family ?? t.notSet}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Select
          name="text-style-font"
          label={format(t.textStyleFont, { name })}
          value={fontValue}
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
            label: messages.editor.fonts.weights[w as keyof typeof messages.editor.fonts.weights] ?? String(w),
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
        <label className="flex min-w-0 flex-col gap-0.5 text-tiny text-muted">
          {props.lineHeight}
          <input
            name="text-style-line-height"
            key={`line-height-${style.lineHeight}`}
            type="number"
            inputMode="decimal"
            min={0.5}
            max={5}
            step={0.05}
            defaultValue={style.lineHeight ?? ''}
            placeholder={props.lineHeightAuto}
            aria-label={format(t.textStyleLineHeight, { name })}
            onBlur={(e) => {
              const typed = typedNumber(e.target.value)
              const lineHeight = typed !== undefined && typed > 0 ? Math.min(typed, 5) : undefined
              if (lineHeight !== style.lineHeight) set({ lineHeight })
              else e.target.value = String(style.lineHeight ?? '')
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className={cn(field, 'h-7 text-tiny text-text tabular-nums')}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-tiny text-muted">
          {format(t.letterSpacingIn, { unit: spacingUnit })}
          <input
            name="text-style-letter-spacing"
            key={`letter-spacing-${style.letterSpacing.value}`}
            type="number"
            inputMode="decimal"
            step={0.5}
            defaultValue={style.letterSpacing.value}
            aria-label={format(t.textStyleLetterSpacing, { name })}
            onBlur={(e) => {
              const value = typedNumber(e.target.value) ?? NO_LETTER_SPACING.value
              if (value !== style.letterSpacing.value) set({ letterSpacing: { ...style.letterSpacing, value } })
              else e.target.value = String(style.letterSpacing.value)
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className={cn(field, 'h-7 text-tiny text-text tabular-nums')}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-tiny text-muted">
          {props.textCase}
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
