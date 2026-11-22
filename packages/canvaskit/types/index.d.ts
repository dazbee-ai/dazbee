// CanvasKit's own types (canvaskit.d.ts, from npm's canvaskit-wasm 0.42.0, the same Skia commit)
// plus the PDF and SVG documents, text as shapes and glyph outlines that our build adds
// (build/vector_bindings.cpp), and the text style's baseline shift and each shaped run's fake bold and
// italic it adds (build/build.sh), in canvaskit.d.ts's TextStyle and GlyphRun.
import type {
  Canvas,
  CanvasKit as BaseCanvasKit,
  CanvasKitInitOptions,
  EmbindObject,
  Path,
  SkPicture,
} from './canvaskit'

export * from './canvaskit'

/** Document information a PDF carries, and how it stores what vectors can't hold. */
export interface PDFOptions {
  title: string
  author: string
  creator: string
  producer: string
  /** The document's language, such as `en` or `ar`. */
  lang: string
  /** Resolution Skia draws blurs, shadows and other effects it can't keep as vectors at. */
  rasterDPI: number
  /** JPEG quality for opaque images, or 101 to store every image losslessly. */
  encodingQuality: number
}

/** A PDF being written. Each page is drawn on its own Canvas, which belongs to the document. */
export interface PDFDocument extends EmbindObject<'PDFDocument'> {
  /** Starts a page of the size given in PDF points; null once the document is closed. */
  beginPage(width: number, height: number): Canvas | null
  endPage(): void
  /** Finishes the file and returns its bytes; null when it was already closed. */
  close(): Uint8Array | null
}

/** An SVG being written. Its Canvas belongs to the document. */
export interface SVGDocument extends EmbindObject<'SVGDocument'> {
  canvas(): Canvas | null
  /** Finishes the file and returns its bytes; null when it was already closed. */
  close(): Uint8Array | null
}

export interface CanvasKit extends BaseCanvasKit {
  readonly PDFDocument: new (options: PDFOptions) => PDFDocument
  /** An SVG of the size given, with `SVG_*` flags or 0. */
  readonly SVGDocument: new (width: number, height: number, flags: number) => SVGDocument
  /**
   * Plays a picture onto a canvas with its text drawn as the glyphs' outlines, in the text's own paint,
   * turned (RSXform) glyphs included. A glyph with no outline (a colour emoji) is drawn on the canvas
   * as text, in its place, when `keepColourGlyphs` is set, and left out otherwise.
   */
  DrawTextAsPaths(canvas: Canvas, picture: SkPicture, keepColourGlyphs: boolean): void
  /**
   * The outlines of every glyph a picture draws, placed as drawn (each glyph's position or RSXform,
   * and the canvas's matrix), as one path; nothing else the picture draws, and no clip. Empty when it
   * draws no text.
   */
  GlyphOutlines(picture: SkPicture): Path
  readonly SVG_CONVERT_TEXT_TO_PATHS: number
  readonly SVG_NO_PRETTY_XML: number
  readonly SVG_RELATIVE_PATH_ENCODING: number
}

export default function CanvasKitInit(opts?: CanvasKitInitOptions): Promise<CanvasKit>
