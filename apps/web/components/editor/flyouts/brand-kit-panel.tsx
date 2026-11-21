'use client'

// The brand kit, in the Brand flyout. It opens as a picker, as in the final mock: the logo, the
// colours as named tiles, the fonts in their own face, the brand roles first, and the text styles
// each in its look. Picking a colour, font or text style binds the selected layers to it, so they
// follow the brand: change the colour and every design using it changes. The logo is placed as a
// logo that follows the brand, and selected pictures can follow it too. Edit turns the flyout into the kit's form (kit-editor.tsx), where
// each change is saved as it is made. A kit with nothing in it shows Daz asleep under Edit.
import { useEffect, useState } from 'react'

import type { Editor } from '@dazbee/editor'
import {
  type AssetSummary,
  bindablePropertyOf,
  boundValueOf,
  brandRef,
  brandTextStyleFamily,
  brandVariables,
  type Design,
  inBrandRoleOrder,
  LOGO_ROLE,
  type ValueKind,
} from '@dazbee/schema'

import { useFontCatalog } from '@/components/brand-kit/font-catalog.ts'
import { FontPreview } from '@/components/brand-kit/font-preview.tsx'
import { KitEditor, useKitSaver } from '@/components/brand-kit/kit-editor.tsx'
import { kitIsEmpty } from '@/components/brand-kit/kit-empty.ts'
import { kitLogo, knownAsset } from '@/components/brand-kit/kit-logo.ts'
import { kitEntryName } from '@/components/brand-kit/kit-names.ts'
import { KitTroubleNotice } from '@/components/brand-kit/kit-trouble-notice.tsx'
import { KitUnreadable } from '@/components/brand-kit/kit-unreadable.tsx'
import { TextStyleSample } from '@/components/brand-kit/text-style-sample.tsx'
import { loadKit, useBrandKit, useKitTrouble } from '@/components/brand-kit/use-brand-kit.ts'
import { useEditorDesign, useSelection } from '@/components/editor/editor-hooks.ts'
import { CHIP } from '@/components/editor/styles.ts'
import { useViewOnly, ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { CheckIcon, PencilSimpleIcon } from '@/components/ui/icons.tsx'
import { overlayScroll } from '@/components/ui/overlay-scroll.ts'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { hexOf, hexText } from '@/lib/colour.ts'
import { placeAsset } from '@/lib/editor/place-asset.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** The look of a font's or text style's row in the picker, which binds the selected texts with a press. */
const PICK_ROW =
  'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-[8px] py-2 text-start enabled:hover:bg-hover enabled:hover:lit enabled:active:bg-pressed enabled:active:lit disabled:cursor-default aria-pressed:text-accent-text'

/** Whether every selected layer that can follow a token of this kind follows this one. */
function follows(design: Design, ids: string[], kind: ValueKind, token: string) {
  const refs = ids.flatMap((id) => {
    const node = design.nodes[id]
    if (!node) return []
    const property = bindablePropertyOf(node.type, kind)
    // A layer with no colour to bind counts as not following; one with no font, picture or look is left out.
    if (!property) return kind === 'color' ? [undefined] : []
    if (kind === 'image' && !showsPicture(design, id)) return []
    return [node.bindings?.[property]]
  })
  return refs.length > 0 && refs.every((ref) => ref === brandRef(token))
}

/** Whether a layer shows a picture that can follow the logo: a graphic's or box's image fill. */
function showsPicture(design: Design, id: string) {
  const node = design.nodes[id]
  return !!node && boundValueOf(node.type, node.props, 'image') !== undefined
}

/** The kit's logo as an asset of the brand's library, once it is known; undefined for no logo. */
function useKitLogo(workspaceId: string, brandId: string, logoAssetId: string | null) {
  const [found, setFound] = useState<AssetSummary | undefined>(() => knownAsset(logoAssetId))
  useEffect(() => {
    let live = true
    void kitLogo(workspaceId, brandId, logoAssetId).then((asset) => {
      if (live) setFound(asset)
    })
    return () => {
      live = false
    }
  }, [workspaceId, brandId, logoAssetId])
  return found
}

export function BrandKitPanel({
  editor,
  workspaceId,
  brandId,
}: {
  editor: Editor
  workspaceId: string
  brandId: string
}) {
  const t = useMessages().editor.brandKit
  const kit = useBrandKit(workspaceId, brandId)
  const trouble = useKitTrouble(brandId)
  const [editingKit, setEditing] = useState(false)
  // A tab that may only view shows the kit: it applies, places and edits nothing (C35).
  const viewOnly = useViewOnly()
  const editing = editingKit && !viewOnly
  // Turning view-only ends the kit's editing, so it doesn't come back by itself with the tab's access.
  useEffect(() => {
    if (viewOnly) setEditing(false)
  }, [viewOnly])
  const { catalog } = useFontCatalog(workspaceId, brandId)
  const { design } = useEditorDesign(editor)
  const selection = useSelection(editor)
  // A change shows at once in every bound layer too (KitVariables); one waiting to be saved is saved
  // when the flyout closes.
  const { change } = useKitSaver(workspaceId, brandId)
  const logoAsset = useKitLogo(workspaceId, brandId, kit?.logoAssetId ?? null)

  useEffect(() => {
    void loadKit(workspaceId, brandId)
  }, [workspaceId, brandId])
  if (!kit)
    return trouble?.kind === 'unreadable' ? (
      <KitUnreadable brandId={brandId} tight />
    ) : (
      <div className="p-4 text-small text-muted" aria-busy="true" />
    )

  const apply = (kind: ValueKind, token: string) => {
    // A second press on what the selection already follows lets it go.
    editor.bindSelection(kind, follows(design, selection, kind, token) ? null : brandRef(token))
  }
  // As the mock's flyouts: small spaced capitals over each part, quiet fields, round swatches.
  const heading = 'text-caption font-bold tracking-[0.08em] text-subtle uppercase'
  const modeButton = cn(CHIP, 'h-8 shrink-0 gap-1.5')
  const textSelected = selection.some((id) => design.nodes[id]?.type === 'text')
  const pictureSelected = selection.some((id) => showsPicture(design, id))
  const followsLogo = follows(design, selection, 'image', LOGO_ROLE)
  // Pictures follow an image logo; an SVG file is placed as layers that don't follow. Pictures that
  // follow it can always be let go.
  const logoFollowable = brandVariables(kit, logoAsset)[brandRef(LOGO_ROLE)] !== undefined || followsLogo

  /**
   * Puts the kit's logo on the design: an SVG file as layers, an image as a graphic filled with it
   * whose picture follows the brand's logo.
   */
  const placeLogo = () => {
    kitLogo(workspaceId, brandId, kit.logoAssetId).then(
      (asset) => {
        if (asset) placeAsset(editor, workspaceId, brandId, asset, undefined, { logo: { name: t.logo } })
      },
      () => undefined,
    )
  }

  if (!editing) {
    const logo = kit.logoAssetId ? brandPath(workspaceId, brandId, 'assets', kit.logoAssetId, 'thumbnail') : null
    return (
      <div
        ref={overlayScroll}
        data-testid="brand-kit"
        data-mode="pick"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {!viewOnly && (
          <div className="flex justify-end px-[18px] pb-3">
            <button type="button" onClick={() => setEditing(true)} className={modeButton}>
              <PencilSimpleIcon size={13} aria-hidden />
              {t.edit}
            </button>
          </div>
        )}
        <KitTroubleNotice brandId={brandId} className="px-[18px] pb-3" />
        {kitIsEmpty(kit) ? (
          <EmptyState pose="sleep" tight {...t.empty} />
        ) : (
          <ViewOnlyFieldset>
            {logo && (
              <section aria-labelledby="kit-logo" className="flex flex-col gap-2.5 border-t border-line px-[18px] py-4">
                <h3 id="kit-logo" className={heading}>
                  {t.logo}
                </h3>
                {/* The one logo on a light and a dark ground, to see how it reads on each; either places it. */}
                <div className="grid grid-cols-2 gap-2">
                  {['bg-white', 'bg-[#1A1420]'].map((ground) => (
                    <button
                      key={ground}
                      type="button"
                      aria-label={t.placeLogo}
                      title={t.placeLogo}
                      data-testid="kit-logo-place"
                      onClick={() => placeLogo()}
                      className={cn(
                        'grid aspect-[1.3] cursor-pointer place-items-center overflow-hidden rounded-[10px] border border-line p-3 hover:border-accent',
                        ground,
                      )}
                    >
                      <img src={logo} alt="" className="size-full object-contain" />
                    </button>
                  ))}
                </div>
                {logoFollowable && (
                  <button
                    type="button"
                    aria-pressed={followsLogo}
                    disabled={!pictureSelected}
                    onClick={() => apply('image', LOGO_ROLE)}
                    className={cn(CHIP, 'h-8 justify-center gap-1.5 aria-pressed:text-accent-text')}
                  >
                    {followsLogo && <CheckIcon size={13} aria-hidden />}
                    {followsLogo ? t.unfollowLogo : t.followLogo}
                  </button>
                )}
              </section>
            )}

            <section aria-labelledby="kit-colors" className="flex flex-col gap-2.5 border-t border-line px-[18px] py-4">
              <h3 id="kit-colors" className={heading}>
                {t.colors}
              </h3>
              {kit.colors.length === 0 ? (
                <p className="text-tiny text-muted">{t.noColors}</p>
              ) : (
                <ul className="grid grid-cols-5 gap-[8px]">
                  {inBrandRoleOrder('color', kit.colors).map((c) => {
                    const on = follows(design, selection, 'color', c.token)
                    const name = kitEntryName(t.brandRoles, 'color', c)
                    return (
                      <li key={c.token} data-token={c.token}>
                        <button
                          type="button"
                          aria-label={format(on ? t.unbind : t.apply, { name })}
                          aria-pressed={on}
                          disabled={selection.length === 0}
                          title={`${name} · ${hexText(c.value)}`}
                          onClick={() => apply('color', c.token)}
                          className="group flex w-full cursor-pointer flex-col gap-1 text-start disabled:cursor-default"
                        >
                          <span
                            style={{ backgroundColor: hexOf(c.value) }}
                            className={cn(
                              'block aspect-square w-full rounded-[10px] border border-line-strong transition-transform duration-[var(--chrome-fast)] group-enabled:group-hover:scale-105',
                              // The followed colour is ringed in pink with a gap, a shape and not only a colour.
                              on && 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]',
                            )}
                          />
                          <span className="truncate font-mono text-micro text-muted">{name}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="kit-fonts" className="flex flex-col gap-1 border-t border-line px-[18px] py-4">
              <h3 id="kit-fonts" className={cn(heading, 'pb-1.5')}>
                {t.fonts}
              </h3>
              {kit.fonts.length === 0 ? (
                <p className="text-tiny text-muted">{t.noFonts}</p>
              ) : (
                <ul className="flex flex-col">
                  {inBrandRoleOrder('font', kit.fonts).map((f) => {
                    const on = follows(design, selection, 'font', f.token)
                    const name = kitEntryName(t.brandRoles, 'font', f)
                    const family = catalog.find((x) => x.family === f.family)
                    return (
                      <li key={f.token} data-token={f.token} className="border-t border-line first:border-t-0">
                        <button
                          type="button"
                          aria-label={format(on ? t.unbind : t.apply, { name })}
                          aria-pressed={on}
                          disabled={!textSelected}
                          onClick={() => apply('font', f.token)}
                          className={PICK_ROW}
                        >
                          <span className="min-w-0 flex-1">
                            {family ? (
                              <FontPreview workspaceId={workspaceId} brandId={brandId} family={family} big />
                            ) : (
                              <span className="block truncate text-heading font-semibold">{f.family}</span>
                            )}
                          </span>
                          <span className="shrink-0 text-caption text-muted">{name}</span>
                          {on && <CheckIcon size={14} aria-hidden className="shrink-0" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="kit-text-styles"
              className="flex flex-col gap-1 border-t border-line px-[18px] py-4"
            >
              <h3 id="kit-text-styles" className={cn(heading, 'pb-1.5')}>
                {t.textStyles}
              </h3>
              {kit.textStyles.length === 0 ? (
                <p className="text-tiny text-muted">{t.noTextStyles}</p>
              ) : (
                <ul className="flex flex-col">
                  {kit.textStyles.map((style) => {
                    const on = follows(design, selection, 'textLook', style.token)
                    const family = brandTextStyleFamily(kit, style)
                    return (
                      <li key={style.token} data-token={style.token} className="border-t border-line first:border-t-0">
                        <button
                          type="button"
                          aria-label={format(on ? t.unbind : t.apply, { name: style.name })}
                          aria-pressed={on}
                          disabled={!textSelected}
                          onClick={() => apply('textLook', style.token)}
                          className={PICK_ROW}
                        >
                          <span className="min-w-0 flex-1">
                            <TextStyleSample
                              workspaceId={workspaceId}
                              brandId={brandId}
                              style={style}
                              known={catalog.find((f) => f.family === family)}
                              family={family}
                            />
                          </span>
                          <span className="max-w-[45%] min-w-0 truncate text-caption text-muted">{style.name}</span>
                          {on && <CheckIcon size={14} aria-hidden className="shrink-0" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </ViewOnlyFieldset>
        )}
      </div>
    )
  }

  return (
    <div
      ref={overlayScroll}
      data-testid="brand-kit"
      data-mode="edit"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="flex justify-end px-[18px] pb-3">
        <button type="button" onClick={() => setEditing(false)} className={modeButton}>
          <CheckIcon size={13} aria-hidden />
          {t.done}
        </button>
      </div>
      <KitTroubleNotice brandId={brandId} className="px-[18px] pb-3" />

      <KitEditor
        workspaceId={workspaceId}
        brandId={brandId}
        kit={kit}
        change={change}
        binding={{
          follows: (kind, token) => follows(design, selection, kind, token),
          apply,
          canColor: selection.length > 0,
          canFont: textSelected,
          canTextStyle: textSelected,
        }}
      />
    </div>
  )
}
