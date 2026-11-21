// The two small SVG files the security review found could stall or crash the API while their
// thumbnails were drawn: 50 blurs nested inside each other, and one path of 630,000 points. Tests
// in every workspace that reads SVG files check that both are refused.

/** 50 groups nested inside each other around one square, each blurred as wide as the widest blur an effect may have: 1.3 KB. */
export const NESTED_BLURS = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><filter id="b"><feGaussianBlur stdDeviation="1000"/></filter>${'<g filter="url(#b)">'.repeat(50)}<rect width="100" height="100"/>${'</g>'.repeat(50)}</svg>`

/** One filled path zigzagging across a 1000 × 1000 drawing, as many points as fit in 4.9 MB: 629,800 of them. */
export function hugePath(): string {
  const lines: string[] = []
  let size = 200
  for (let i = 0; size < 4_900_000; i++) {
    const line = `L${i % 1000} ${(i * 7) % 1000}`
    lines.push(line)
    size += line.length
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><path d="M0 0${lines.join('')}"/></svg>`
}
