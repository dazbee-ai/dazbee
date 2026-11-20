// The brand kit laid out as the Brand kit page's form is, for a member who may only view it: each
// colour's swatch, name and value and each font's name and family, the brand roles first, then the
// logo and the tone of voice, and each text style's name and settings, with nothing that changes
// them. A part the kit has nothing in is left out, but for the logo's.
import { type BrandKit, type BrandTextStyle, brandTextStyleFamily, inBrandRoleOrder } from '@dazbee/schema'

import { brandPath } from '@/lib/brand-routes.ts'
import { hexOf, hexText } from '@/lib/colour.ts'
import type { Messages } from '@/lib/i18n/index.ts'

import { weightName } from './font-catalog.ts'
import { kitEntryName } from './kit-names.ts'
import { letterSpacingUnit } from './text-style-fonts.ts'

const HEADING = 'text-caption font-bold tracking-[0.08em] text-subtle uppercase'
const SECTION = 'flex min-w-0 flex-col gap-2.5 rounded-[16px] border border-line bg-bg/40 p-4'

/** A text style's settings in a line: its family, weight and slant, line height, letter spacing and case. */
function textStyleDetails(t: Messages, kit: BrandKit, style: BrandTextStyle) {
  const { props, fonts, actions } = t.editor
  const weight = weightName(fonts.weights, style.fontWeight)
  return [
    brandTextStyleFamily(kit, style) ?? t.editor.brandKit.notSet,
    style.fontStyle === 'italic' ? `${weight} ${actions.italic}` : weight,
    `${props.lineHeight} ${style.lineHeight ?? props.lineHeightAuto}`,
    `${props.letterSpacing} ${style.letterSpacing.value}${letterSpacingUnit(style.letterSpacing)}`,
    props.textCases[style.textCase ?? 'none'],
  ].join(' · ')
}

export function KitView({
  t,
  workspaceId,
  brandId,
  kit,
}: {
  t: Messages
  workspaceId: string
  brandId: string
  kit: BrandKit
}) {
  const w = t.editor.brandKit
  return (
    <div data-testid="kit-view" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {kit.colors.length > 0 && (
        <section aria-labelledby="kit-colors" className={SECTION}>
          <h3 id="kit-colors" className={HEADING}>
            {w.colors}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {inBrandRoleOrder('color', kit.colors).map((colour) => (
              <li key={colour.token} data-token={colour.token} className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="h-12 w-10 shrink-0 rounded-[12px] border border-line-strong"
                  style={{ background: hexOf(colour.value) }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-small font-medium">{kitEntryName(w.brandRoles, 'color', colour)}</span>
                  <span className="font-mono text-tiny text-muted uppercase">{hexText(colour.value)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {kit.fonts.length > 0 && (
        <section aria-labelledby="kit-fonts" className={SECTION}>
          <h3 id="kit-fonts" className={HEADING}>
            {w.fonts}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {inBrandRoleOrder('font', kit.fonts).map((font) => (
              <li key={font.token} data-token={font.token} className="flex min-w-0 flex-col">
                <span className="truncate text-small font-medium">{kitEntryName(w.brandRoles, 'font', font)}</span>
                <span className="truncate text-tiny text-muted">{font.family}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex min-w-0 flex-col gap-3">
        <section aria-labelledby="kit-logo" className={SECTION}>
          <h3 id="kit-logo" className={HEADING}>
            {w.logo}
          </h3>
          {kit.logoAssetId ? (
            <img
              src={brandPath(workspaceId, brandId, 'assets', kit.logoAssetId, 'thumbnail')}
              alt={w.logo}
              className="size-16 rounded-[12px] border border-line bg-bg/40 object-contain"
            />
          ) : (
            <p className="text-small text-muted">{w.noLogo}</p>
          )}
        </section>
        {kit.voice.trim() && (
          <section aria-labelledby="kit-voice" className={SECTION}>
            <h3 id="kit-voice" className={HEADING}>
              {w.voice}
            </h3>
            <p className="text-small whitespace-pre-line">{kit.voice}</p>
          </section>
        )}
      </div>
      {kit.textStyles.length > 0 && (
        <section aria-labelledby="kit-text-styles" className={`${SECTION} md:col-span-2 xl:col-span-3`}>
          <h3 id="kit-text-styles" className={HEADING}>
            {w.textStyles}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {kit.textStyles.map((style) => (
              <li key={style.token} data-token={style.token} className="flex min-w-0 flex-col">
                <span className="truncate text-small font-medium">{style.name}</span>
                <span className="text-tiny text-muted">{textStyleDetails(t, kit, style)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
