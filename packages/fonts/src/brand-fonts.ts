// Which files draw a family the brand has its own files of and we ship too: the brand's, as the font chooser shows it.

/**
 * The fonts a design draws with: the fonts we ship, but those of a family the brand gives files of, then the brand's
 * files. A brand's upload of a shipped family's name draws in place of the shipped file, and a family it has no files
 * of draws in ours.
 */
export function withBrandFonts<F extends { family: string }>(shipped: readonly F[], brand: readonly F[]): F[] {
  const own = new Set(brand.map((font) => font.family))
  return [...shipped.filter((font) => !own.has(font.family)), ...brand]
}
