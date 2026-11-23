/** `words` as a list in a sentence: "a", "a and b", "a, b and c". */
export function inWords(words: readonly string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}
