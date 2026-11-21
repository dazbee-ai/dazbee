export { SvgError, svgToLayers, type ConvertOptions, type Converted, type SvgProblem } from './convert.ts'
export type { SvgImage } from './images.ts'
export { boundsOf, pathData, transformed } from './path-data.ts'
export { svgMarkup, SVG_TYPE } from './sniff.ts'
export {
  apply,
  ckMatrix,
  invert,
  type Matrix,
  multiply,
  nearestTurnAndFlipOf,
  turnAndFlipOf,
  type TurnAndFlip,
} from './transform.ts'
export type { Skipped } from './types.ts'
export { parseXml, XmlError, type XmlElement } from './xml.ts'
