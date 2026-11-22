// What the patterns share: a pattern's style and content, what a pattern is built from, and what it gives.
import type { BrandKit, LayerTree, TextProps } from '@dazbee/schema'

import type { PictureLook } from './picture-look.ts'

/** A pattern's style: it changes the decoration, the type and the spacing, never the structure. */
export type PatternStyle = 'bold' | 'minimal' | 'playful' | 'premium'

/**
 * A picture a pattern places: an image asset of the brand, with its size in pixels, and what it shows where its
 * pixels were read: a photo is cropped to its subject, and a logo set where its ink reads.
 */
export interface Picture {
  assetId: string
  width: number
  height: number
  look?: PictureLook
}

/** The words and pictures a pattern is filled with. */
export interface PatternContent {
  headline: string
  subline?: string
  /** A short line above the headline, such as “New season”. */
  kicker?: string
  /** The button's label, such as “Shop now”. */
  button?: string
  /** Words of the headline to set apart, in another colour or slant. */
  highlight?: string
  /** A badge's few words, such as “−30%” or “New”. */
  badge?: string
  /** The number the big number pattern is built round, such as “50%”. */
  number?: string
  /** Who said a quote, such as “Priya, Mumbai”. */
  attribution?: string
  photo?: Picture
  /** The logo, an image: bound to the Logo brand role when it is the kit's logo. */
  logo?: Picture
}

/** What a part of the content is called, as an agent names it. */
export type ContentPart = keyof PatternContent

/**
 * Lays out a text as it is drawn: its width and height at `width`, or at its own width when `width` is null. The
 * fonts it measures with are the ones the frame is drawn with.
 */
export type Measure = (props: TextProps, width: number | null) => { width: number; height: number }

/** What a pattern is built from at one size. */
export interface PatternInput {
  style: PatternStyle
  kit: BrandKit
  content: PatternContent
  width: number
  height: number
  measure: Measure
}

/** A pattern as an agent is told of it and `buildPattern` builds it. */
export interface Pattern {
  id: string
  name: string
  /** The kinds of ad it suits, such as sale or product launch. */
  kinds: readonly string[]
  description: string
  /** The content it can't be built without. */
  needs: readonly ContentPart[]
  /** The content it uses when given, beside what it needs. */
  takes: readonly ContentPart[]
}

/**
 * A frame's layers as a pattern builds them: each layer's id is the part it is, such as `headline`, and so is its
 * link id, which the caller swaps for one the frames of every size share.
 */
export type PatternLayers = LayerTree
