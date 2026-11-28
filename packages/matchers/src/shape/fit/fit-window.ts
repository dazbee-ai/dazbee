// Fitting windows: the coverage mask round one patch of a piece, in fitting pixels, with where it lies in the
// piece, which shapes are fitted and judged against.

/** A coverage mask at the fitting scale, `scale` fitting pixels to a piece pixel, around one part. */
export interface FitWindow {
  width: number
  height: number
  mask: Float32Array
  scale: number
  /** The window's size and offset in piece pixels: the mask is this part of the piece. */
  pieceWidth: number
  pieceHeight: number
  offsetX: number
  offsetY: number
  /** Pixels the parts over this one cover: its shape may reach under them at no cost. */
  free?: Float32Array
}
