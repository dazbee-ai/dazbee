/** The picture drawn now, or the last one asked for: each starts once the one before it ends. */
let drawingTurn: Promise<unknown> = Promise.resolve()

/**
 * Runs `draw` once every picture asked for before it has been drawn: a picture reads its font and
 * image bytes inside its turn, so the API holds one design's bytes at a time, not every waiting
 * picture's. A CJK family's face runs to 50 MB.
 */
export function inDrawingTurn<T>(draw: () => Promise<T>): Promise<T> {
  const turn = drawingTurn.then(draw, draw)
  drawingTurn = turn.catch(() => undefined)
  return turn
}
