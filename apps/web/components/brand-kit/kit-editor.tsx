'use client'

// The brand kit's form (#53, #200): colours with names and values, fonts with names and families,
// text styles, the logo and the tone of voice. Each change shows at once and is saved a moment
// later. The editor's Brand flyout shows it in its Edit mode, with buttons that bind the selected
// layers to a colour or font; the Brand kit page shows it laid out wide, without them.
import { useCallback, useEffect, useRef, useState } from 'react'

import { AssetSummary, type BrandKit } from '@dazbee/schema'

import { UploadSimpleIcon } from '@/components/ui/icons.tsx'
import { Select } from '@/components/ui/select.tsx'
import { brandPath, readJson } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { ASSET_ACCEPT, sendAsset } from '@/lib/upload-asset.ts'

import { useFontCatalog } from './font-catalog.ts'
import { KitColours } from './kit-colours.tsx'
import { KitFonts } from './kit-fonts.tsx'
import { rememberAssets } from './kit-logo.ts'
import { heading, iconButton, type KitBinding } from './kit-parts.ts'
import { KitTextStyles } from './kit-text-styles.tsx'
import { saveKit, showKit } from './use-brand-kit.ts'

/** How long a run of changes (a colour picker's drag) waits before it is saved. */
const SAVE_DELAY_MS = 400

/**
 * Shows a kit change at once and saves it a moment later; a change still waiting is saved when the
 * component using this goes. `onShow` hears each change as it shows, as the editor's layers do.
 */
export function useKitSaver(workspaceId: string, brandId: string, onShow?: (kit: BrandKit) => void) {
  const [error, setError] = useState<string | null>(null)
  const saving = useRef<{ timer: ReturnType<typeof setTimeout> | null; kit: BrandKit | null }>({
    timer: null,
    kit: null,
  })
  const shows = useRef(onShow)
  shows.current = onShow

  const flush = useCallback(() => {
    const { kit: next } = saving.current
    saving.current = { timer: null, kit: null }
    if (!next) return
    saveKit(workspaceId, brandId, next)
      .then(readJson)
      .then(() => setError(null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [workspaceId, brandId])
  useEffect(
    () => () => {
      if (saving.current.timer) clearTimeout(saving.current.timer)
      flush()
    },
    [flush],
  )

  const change = useCallback(
    (next: BrandKit) => {
      showKit(brandId, next)
      shows.current?.(next)
      if (saving.current.timer) clearTimeout(saving.current.timer)
      saving.current = { kit: next, timer: setTimeout(flush, SAVE_DELAY_MS) }
    },
    [brandId, flush],
  )

  return { change, error }
}

export function KitEditor({
  workspaceId,
  brandId,
  kit,
  change,
  error,
  binding,
  wide = false,
}: {
  workspaceId: string
  brandId: string
  kit: BrandKit
  change: (next: BrandKit) => void
  error: string | null
  binding?: KitBinding
  /** Laid out across the brand home's panel instead of down the editor's flyout. */
  wide?: boolean
}) {
  const t = useMessages().editor.brandKit
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [upload, setUpload] = useState<{ progress: number } | { error: string } | null>(null)
  const files = useRef<HTMLInputElement>(null)
  const { catalog } = useFontCatalog(workspaceId, brandId)

  useEffect(() => {
    fetch(brandPath(workspaceId, brandId, 'assets'))
      .then(async (response) => {
        if (!response.ok) return
        const listed = AssetSummary.array().parse(await response.json())
        rememberAssets(listed)
        setAssets(listed)
      })
      .catch(() => undefined)
  }, [workspaceId, brandId])

  const section = wide
    ? 'flex min-w-0 flex-col gap-2.5 rounded-[16px] border border-line bg-bg/40 p-4'
    : 'flex flex-col gap-2.5 border-t border-line px-[18px] py-4'
  const uploadLogo = (file: File) => {
    setUpload({ progress: 0 })
    sendAsset(workspaceId, brandId, file, (progress) => setUpload({ progress }))
      .then((asset) => {
        rememberAssets([asset])
        setAssets((all) => [asset, ...all])
        setUpload(null)
        change({ ...kit, logoAssetId: asset.id })
      })
      .catch((e: unknown) => setUpload({ error: e instanceof Error ? e.message : String(e) }))
  }
  const families = [...new Set(catalog.map((f) => f.family))]
  const colours = <KitColours key="colours" kit={kit} change={change} binding={binding} section={section} />

  const fonts = (
    <KitFonts key="fonts" kit={kit} change={change} binding={binding} section={section} families={families} />
  )

  const textStyles = (
    <KitTextStyles
      key="text-styles"
      workspaceId={workspaceId}
      brandId={brandId}
      kit={kit}
      change={change}
      section={section}
      catalog={catalog}
      wide={wide}
    />
  )

  const logo = (
    <section key="logo" aria-labelledby="kit-logo" className={section}>
      <h3 id="kit-logo" className={heading}>
        {t.logo}
      </h3>
      <div className="flex items-center gap-2">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[12px] border border-line bg-bg/40">
          {kit.logoAssetId && (
            <img
              src={brandPath(workspaceId, brandId, 'assets', kit.logoAssetId, 'thumbnail')}
              alt=""
              className="size-full object-contain"
            />
          )}
        </div>
        <Select
          name="logo"
          label={t.logo}
          value={kit.logoAssetId ?? ''}
          options={[{ value: '', label: t.noLogo }, ...assets.map((a) => ({ value: a.id, label: a.name || a.id }))]}
          onChange={(id) => change({ ...kit, logoAssetId: id || null })}
          className="h-8 min-w-0 flex-1 bg-bg/40 px-2 text-small"
        />
        <button
          type="button"
          aria-label={t.uploadLogo}
          title={t.uploadLogo}
          disabled={upload !== null && 'progress' in upload}
          onClick={() => files.current?.click()}
          className={iconButton}
        >
          <UploadSimpleIcon size={15} aria-hidden />
        </button>
        <input
          ref={files}
          name="logo-file"
          type="file"
          accept={ASSET_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) uploadLogo(file)
          }}
        />
      </div>
      {upload && 'progress' in upload && (
        <p role="status" className="text-tiny text-muted tabular-nums">
          {format(t.uploading, { percent: Math.round(upload.progress * 100) })}
        </p>
      )}
      {upload && 'error' in upload && (
        <p role="alert" className="text-tiny text-danger">
          {format(t.uploadFailed, { reason: upload.error })}
        </p>
      )}
    </section>
  )

  const voice = (
    <section key="voice" aria-labelledby="kit-voice" className={section}>
      <h3 id="kit-voice" className={heading}>
        {t.voice}
      </h3>
      <textarea
        name="voice"
        key={`voice-${kit.voice}`}
        defaultValue={kit.voice}
        aria-label={t.voice}
        placeholder={t.voiceHint}
        maxLength={2000}
        rows={3}
        onBlur={(e) => e.target.value !== kit.voice && change({ ...kit, voice: e.target.value })}
        className="resize-y rounded-[8px] border border-line bg-bg/40 px-2 py-1.5 text-small placeholder:text-subtle hover:border-line-strong focus:border-accent focus:outline-none"
      />
    </section>
  )

  const failed = error && (
    <p role="alert" className={cn('text-tiny text-danger', !wide && 'px-[18px] pb-4')}>
      {format(t.saveFailed, { reason: error })}
    </p>
  )

  // Wide: the logo and voice beside the colours and fonts, as the mock's panel, and the text styles
  // across under them; the flyout keeps the editor's order, colours first.
  return wide ? (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {colours}
        {fonts}
        <div className="flex min-w-0 flex-col gap-3">
          {logo}
          {voice}
        </div>
        {textStyles}
      </div>
      {failed}
    </div>
  ) : (
    <>
      {colours}
      {fonts}
      {textStyles}
      {logo}
      {voice}
      {failed}
    </>
  )
}
