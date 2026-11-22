// An illustration's accent colour, swapped for another in its SVG file's text: wherever the file paints with it, in
// attributes, style sheets and gradient stops alike, and nowhere else.

/** What a colour is written as here: # and six hex digits. */
const HEX = /^#[0-9a-fA-F]{6}$/

/** The SVG file's text with every use of the colour `from` written as `to`, both #rrggbb, whatever case it is in. */
export function swapAccent(text: string, from: string, to: string): string {
  if (!HEX.test(from) || !HEX.test(to)) throw new Error(`an accent is #rrggbb, not ${from} or ${to}`)
  return text.replace(new RegExp(`${from}(?![0-9a-fA-F])`, 'gi'), to.toLowerCase())
}

/** Whether the SVG file's text paints with the colour (#rrggbb), whatever case it is in. */
export function paintsWith(text: string, colour: string): boolean {
  return new RegExp(`${colour}(?![0-9a-fA-F])`, 'i').test(text)
}
