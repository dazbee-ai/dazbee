// What an agent is told about a frame it made or changed: plain sentences, each about one layer,
// for what won't look as designed. It reads the design as the export draws it, and writes nothing.
import type { CanvasKit } from '@dazbee/canvaskit'
import {
  familiesOf,
  layoutText,
  missingGraphemes,
  render,
  resourceCache,
  type ResourceBytes,
  type ResourceCache,
  type Resources,
  type SceneLayer,
  textMeasure,
} from '@dazbee/renderer'
import type { Design } from '@dazbee/schema'

/** What a warning is about. */
export type AgentWarningKind = 'missingFont' | 'missingCharacters' | 'overflow' | 'pastMaxLines'

/** One thing in a frame that won't look as designed, as a sentence about the layer it is in. */
export interface AgentWarning {
  layerId: string
  kind: AgentWarningKind
  message: string
}

/** Which layers to check, and the resource cache to draw with. */
export interface AgentWarningOptions {
  /** The layers to check, at any depth; every layer the frame shows when left out. */
  layerIds?: Iterable<string>
  cache?: ResourceCache
}

type TextLayer = Extract<SceneLayer, { type: 'text' }>

/** How far laid-out lines may pass a fixed box's height before they overflow it, as fitting text allows. */
const OVERFLOW_SLACK = 0.01

/**
 * What in frame `frameId` won't look as designed, layer by layer back to front. In a text: a
 * family `bytes` has no file for, so it draws in a fallback font; characters no font has; lines
 * taller than a fixed box; lines past its `maxLines`, cut off. Hidden layers are not checked.
 */
export function frameWarnings(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  { layerIds, cache }: AgentWarningOptions = {},
): AgentWarning[] {
  if (!Object.hasOwn(design.frames, frameId)) throw new Error(`no frame "${frameId}"`)
  const wanted = layerIds === undefined ? undefined : new Set(layerIds)
  const owned = cache ?? resourceCache(ck)
  try {
    const resources = owned.resources(bytes)
    const scene = render(design, frameId, undefined, textMeasure(ck, resources), bytes.variables)
    const have = new Set(bytes.fonts.map((font) => font.family))
    const warnings: AgentWarning[] = []
    const nameOf = (id: string) => design.nodes[id]?.name || id
    const walk = (layers: readonly SceneLayer[]) => {
      for (const layer of layers) {
        if (!wanted || wanted.has(layer.id))
          if (layer.type === 'text') warnings.push(...textWarnings(ck, layer, nameOf(layer.id), have, resources))
        walk(layer.children)
      }
    }
    walk(scene.layers)
    return warnings
  } finally {
    if (!cache) owned.delete()
  }
}

/** What won't draw as designed in one text layer. */
function textWarnings(
  ck: CanvasKit,
  layer: TextLayer,
  name: string,
  have: ReadonlySet<string>,
  resources: Resources,
): AgentWarning[] {
  const warnings: AgentWarning[] = []
  const warn = (kind: AgentWarningKind, message: string) => warnings.push({ layerId: layer.id, kind, message })
  const laid = layoutText(ck, layer.props, resources)
  try {
    for (const family of new Set(familiesOf(layer)))
      if (!have.has(family))
        warn(
          'missingFont',
          `Text "${name}" is set in "${family}", which has no font file, so it draws in a fallback font.`,
        )
    const missing = [...new Set(laid.blocks.flatMap((block) => missingGraphemes(block)))]
    if (missing.length > 0)
      warn(
        'missingCharacters',
        `Text "${name}" has characters no font has, which draw as empty boxes: ${missing.join(' ')}`,
      )
    const { props } = layer
    if (props.boxMode === 'fixed' && laid.height > props.height + OVERFLOW_SLACK)
      warn(
        'overflow',
        `Text "${name}" overflows its fixed box: its lines are ${Math.ceil(laid.height)} px tall in a box ${props.height} px tall.`,
      )
    const paragraphs = props.text.split('\n').length
    if (laid.blocks.length < paragraphs || laid.blocks.some((block) => block.paragraph.didExceedMaxLines()))
      warn('pastMaxLines', `Text "${name}" has more lines than its limit of ${props.maxLines}, so the rest is cut off.`)
  } finally {
    laid.delete()
  }
  return warnings
}
