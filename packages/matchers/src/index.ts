export { type Judged, LOOKS_SAME, looksSame, type JudgeOptions } from './looks-same/rule.ts'
export { firstPass } from './shape/first-pass.ts'
export { fullPass } from './shape/full-pass.ts'
export { matchShapes } from './shape/match-shapes.ts'
export { pieceFingerprint } from './text/fingerprint.ts'
export { faceOfKey, type FontKey, parseFontKey } from './text/font-key.ts'
export { type FontSource, loadFaces } from './text/font-source.ts'
export { matchText, type TextMatcherDeps, type TextPieceOfJob, type TextStep } from './text/match-text.ts'
export {
  MODEL_INPUT,
  MODEL_NUMBERS,
  MODEL_OUTPUT,
  type ModelRuntime,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from './text/model-runtime.ts'
export { type PieceReading, readPiece, type ReadPiece, type TextPiece, WORK_LINE_HEIGHT } from './text/read-piece.ts'
export { type Candidate, shortlist, type Shortlist, type ShortlistInput } from './text/shortlist.ts'
export { readTextFiles, TEXT_FILES, type TextFileBytes, type TextFiles } from './text/text-files.ts'
