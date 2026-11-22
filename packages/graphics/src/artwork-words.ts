// The words an artwork graphic is found by beside its own: for a word in its name, folder or tags, the words people use
// for the same thing in an ad, so "sparkle" finds a spark, "burst" a star shape and "dots" a pattern of circles.
import { singular } from './search.ts'

/** Each word, and the words it adds to a graphic it names, parted by spaces. */
const WORDS: Readonly<Record<string, string>> = {
  arrow: 'pointer direction',
  line: 'underline squiggle stroke',
  circle: 'ring highlight dot round',
  box: 'frame highlight rectangle',
  misc: 'doodle',
  star: 'sparkle twinkle burst',
  spark: 'sparkle glitter shine',
  magic: 'sparkle glitter shine',
  flare: 'glow shine',
  light: 'glow shine',
  muzzle: 'flash burst',
  flash: 'burst glow',
  explosion: 'burst blast boom',
  fire: 'flame',
  flame: 'fire',
  smoke: 'cloud puff',
  puff: 'smoke cloud',
  twirl: 'swirl',
  scorch: 'burn',
  trace: 'trail',
  slash: 'swoosh',
  wheel: 'gear sun burst',
  flower: 'blob bloom burst',
  ellipse: 'oval',
  moon: 'crescent',
  polygon: 'hexagon',
  wave: 'wavy',
  stripe: 'lines',
}

/** The words `words` add: each word's, looked up as it is and as its singular. */
export function wordsFor(words: readonly string[]): string[] {
  return words.flatMap((word) => (WORDS[word] ?? WORDS[singular(word)] ?? '').split(' ').filter(Boolean))
}
