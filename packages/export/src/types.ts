// What the agent warnings' checks share: the kinds of warning, and what every check of a frame reads.
import type { CanvasKit } from '@dazbee/canvaskit'
import type { Resources, Scene, SceneLayer } from '@dazbee/renderer'

/** What a warning is about. */
export type AgentWarningKind =
  | 'missingFont'
  | 'missingCharacters'
  | 'overflow'
  | 'pastMaxLines'
  | 'outsideFrame'
  | 'cutOff'
  | 'tooSmall'
  | 'lowContrast'
  | 'overlap'

/** A text layer of a frame's scene. */
export type TextLayer = Extract<SceneLayer, { type: 'text' }>

/** What every check of one frame reads. */
export interface Check {
  ck: CanvasKit
  resources: Resources
  scene: Scene
  /** The families `bytes` has files for. */
  have: ReadonlySet<string>
  frame: { name: string; width: number; height: number }
  nameOf: (id: string) => string
  warn: (layerId: string, kind: AgentWarningKind, message: string) => void
}
