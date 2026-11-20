// Whether a brand's kit has anything in it yet, which the Brand kit page asks before showing its form.
import type { BrandKit } from '@dazbee/schema'

/** True for a kit with no colours, no fonts, no text styles, no logo and no voice. */
export const kitIsEmpty = (kit: BrandKit) =>
  kit.colors.length === 0 &&
  kit.fonts.length === 0 &&
  kit.textStyles.length === 0 &&
  kit.logoAssetId === null &&
  kit.voice.trim() === ''
