// The scripts the text matcher tells apart, which script a piece's words are written in, and the
// letters a face must draw to count as drawing a script.

/** A script the text matcher matches fonts for. */
export type Script = 'latin' | 'arabic' | 'devanagari'

export const SCRIPTS: readonly Script[] = ['latin', 'arabic', 'devanagari']

/** The letters a face must draw, every one, to count as drawing a script. */
export const SCRIPT_LETTERS: Readonly<Record<Script, string>> = {
  latin: 'AaBbEeGgMmRrSsWwZz019$%&',
  arabic: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي',
  devanagari: 'अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह',
}

/** The script words are written in: Arabic or Devanagari when they hold any of its letters, else Latin. */
export function scriptOf(words: string): Script {
  if (/\p{Script=Arabic}/u.test(words)) return 'arabic'
  if (/\p{Script=Devanagari}/u.test(words)) return 'devanagari'
  return 'latin'
}
