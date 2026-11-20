'use client'

// The selection as the edit panel and its sections act on it: its layers' own values,
// read as the one value they share or as mixed, and set on every layer at once. Setting a value
// gives them all the same one, and scrubbing, the arrow keys or a shift or a scale typed move each
// from its own. A change stays on these layers: their linked copies in other frames keep their own
// values. Each change is one undo step, and a drag on a number, however long, is one too.
import { constraintsApply, laidOutBox, LEFT_TOP, placedByFlow } from '@dazbee/doc'
import { type Editor, type ImageFill, sharedImageFill } from '@dazbee/editor'
import {
  type Constraints,
  type Design,
  type Features,
  isNonEmpty,
  keepsEachCorner,
  type LetterSpacing,
  type NonEmpty,
  type Paint,
} from '@dazbee/schema'

import { useTextSelection } from '@/components/editor/editor-hooks.ts'
import { type Follows, useLiveDesign } from '@/components/editor/use-live-design.ts'
import { tidy } from '@/lib/editor/size.ts'
import { type Messages } from '@/lib/i18n/index.ts'

import { clamp } from './number-field.tsx'

export type Props = Readonly<Record<string, unknown>>

export type Patch = Record<string, unknown>

export type P = Messages['editor']['props']

export type Style = Record<string, unknown> & {
  fontFamily: string
  fontWeight: number
  fontSize: number
  color: string
  letterSpacing?: LetterSpacing
  lineHeight?: number
  textCase?: string
  features?: Features
}

/** What the edit panels act on: the layers and their values. */
export interface Target {
  editor: Editor
  ids: string[]
  /** Each layer's own values, its x, y, width and height where auto layout places and sizes it. */
  props: NonEmpty<Props>
  types: string[]
  /** The layers' names, for a panel part's note. */
  names: string[]
  /** Each character's style in the selected range while that one text layer is being edited: what text styling then changes. */
  range?: Style[] | undefined
}

/** What each edit panel is given: the selection, the design it is in, and the brand whose kit and pictures it offers. */
export interface PanelProps {
  target: Target
  design: Design
  workspaceId: string
  brandId: string
}

/** The sizes shrink to fit draws text between. */
export type Fit = { min: number; max: number }

export type ShapeKind = 'rect' | 'polygon' | 'star' | 'line'

/** Which kind's tab a selection gets: the kind every one of its layers is, or mixed. */
export type Kind = 'text' | 'photo' | 'shape' | 'box' | 'group' | 'mixed'

/** What the edit panel needs to know of the selected layers beyond their kind (`factsOf`). */
export type Facts = ReturnType<typeof factsOf>

export const set = (target: Target, to: (now: Props, i: number) => Patch | null) => {
  const index = new Map(target.ids.map((id, i) => [id, i]))
  return target.editor.setProps(target.ids, (id, now) => to(now, index.get(id) ?? 0))
}

/** Changes the image fill at `index` of every selected layer. */
export const setImage = (target: Target, index: number, change: (now: ImageFill) => Partial<ImageFill>) =>
  set(target, (now) => {
    const fills = (now.fills ?? []) as Paint[]
    const at = fills[index]
    if (at?.type !== 'image') return null
    return { fills: fills.map((f, i) => (i === index ? { ...at, ...change(at) } : f)) }
  })

export const num = (props: Props, key: string) => props[key] as number

/**
 * The selected layers as the edit panel acts on them, with their own values, rendered
 * again for the changes `follows` names: held, the values keep the x, y, width and height from
 * before a drag until it ends. Null when none of them is in the design.
 */
export function useTarget(
  editor: Editor,
  ids: string[],
  follows: Follows = 'every change',
): { target: Target; design: Design } | null {
  const { design } = useLiveDesign(editor, follows)
  const editing = useTextSelection(editor)
  const target = targetOf(editor, ids, design)
  if (!target) return null
  const { ids: live } = target
  return {
    design,
    target: {
      ...target,
      range:
        editing && live.length === 1 && live[0] === editing.id
          ? ((editor.textSelectionStyles() as Style[] | null) ?? undefined)
          : undefined,
    },
  }
}

/** The layers `ids` of `design` as the edit panels act on them, as they are now; null when none of them is in it. */
export function targetOf(editor: Editor, ids: string[], design: Design): Target | null {
  const live = ids.filter((id) => design.nodes[id])
  if (!isNonEmpty(live)) return null
  const [first, ...rest] = live
  return {
    editor,
    ids: live,
    props: [shownProps(editor, first), ...rest.map((id) => shownProps(editor, id))],
    types: live.map((id) => design.nodes[id]?.type ?? ''),
    names: live.map((id) => design.nodes[id]?.name ?? ''),
  }
}

export function kindOf(target: Target): Kind {
  const all = (...kinds: string[]) => target.types.every((type) => kinds.includes(type))
  if (all('text')) return 'text'
  if (all('graphic', 'box', 'boolean') && imageFillOf(target)) return 'photo'
  if (all('graphic', 'boolean')) return 'shape'
  if (all('box')) return 'box'
  if (all('group', 'instance', 'lottie')) return 'group'
  return 'mixed'
}

/** What the edit panel needs to know of the selected layers beyond their kind. */
export function factsOf(target: Target, design: Design) {
  const shapeKinds = new Set(
    target.ids.map((id) => {
      const node = design.nodes[id]
      return node?.type === 'graphic' ? node.props.shape.kind : null
    }),
  )
  const [shapeKind] = shapeKinds
  const ownShape: ShapeKind | null =
    shapeKinds.size === 1 &&
    (shapeKind === 'rect' || shapeKind === 'polygon' || shapeKind === 'star' || shapeKind === 'line')
      ? shapeKind
      : null
  // Children of an auto layout box, every one of them.
  const inFlow = target.ids.every((id) => laidOutBox(design, design.nodes[id]?.parentId ?? ''))
  return {
    ownShape,
    inFlow,
    // Placed by its auto layout box's flow, every one of them.
    placed: target.ids.every((id) => placedByFlow(design, id)),
    lines: ownShape === 'line',
    // Each corner's own radius kept, as a box and a rectangle keep it, by every one of them.
    eachCorner: target.ids.every((id) => {
      const node = design.nodes[id]
      return node !== undefined && keepsEachCorner(node)
    }),
    booleans: target.types.every((type) => type === 'boolean'),
    boxes: target.types.every((type) => type === 'box'),
    masks: target.props.every((pr) => Boolean(pr.mask)),
    sized: target.types.every((type) => type !== 'group' && type !== 'boolean'),
    texts: target.types.every((type) => type === 'text'),
    // A text among them, which mixed layers keep the Text switcher tab's font for.
    anyText: target.types.some((type) => type === 'text'),
    // Shapes, combined shapes and boxes, every one of them: the layers with fills and strokes.
    shapesOrBoxes: target.types.every((type) => type === 'graphic' || type === 'box' || type === 'boolean'),
    // The layers locked against any change, which every setting but their order would be refused for.
    locked: target.ids.filter((id) => Object.values(design.nodes[id]?.lock ?? {}).some(Boolean)),
  }
}

/**
 * Each axis of the layers' constraints, as the one value they share or mixed, left and top for a
 * layer with none; null unless the rule reads constraints for every one of them (`constraintsApply`).
 */
export function constraintsShown(
  target: Target,
  design: Design,
): { horizontal: Constraints['horizontal'] | 'mixed'; vertical: Constraints['vertical'] | 'mixed' } | null {
  if (!target.ids.every((id) => constraintsApply(design, id))) return null
  const each = target.props.map(ownConstraints)
  return { horizontal: shared(each.map((c) => c.horizontal)), vertical: shared(each.map((c) => c.vertical)) }
}

/** A layer's constraints with one axis set, keeping its own other axis: the whole pair, left or top where it has none. */
export function constraintPatch(now: Props, change: Partial<Constraints>): Patch {
  return { constraints: { ...ownConstraints(now), ...change } }
}

/** The one value every layer has, or 'mixed'. */
export function shared<T>(values: T[]): T | 'mixed' {
  const [first] = values
  const same = values.every((v) => JSON.stringify(v) === JSON.stringify(first))
  return same ? (first as T) : 'mixed'
}

/**
 * The text's style, read and set: of the selected range while one text layer is being edited, so
 * only those characters change, else of the selected layers. A range changed from mixed values
 * starts from its first character's.
 */
export function textStyle(target: Target) {
  const { range } = target
  const styles = range ?? target.props.map((pr) => pr.style as Style)
  /** A layer's style with `key` set, and with shrink to fit on, a size set is its largest size too. */
  const styled = (now: Props, key: string, value: unknown): Patch => ({
    style: { ...(now.style as Style), [key]: value },
    ...(key === 'fontSize' && typeof value === 'number' ? largestAt(now, value) : {}),
  })
  return {
    styles,
    style: (key: string) => shared(styles.map((s) => s[key])),
    setStyle: (key: string, value: unknown) =>
      range ? target.editor.styleTextSelection({ [key]: value }) : set(target, (now) => styled(now, key, value)),
    /** Sets `key` from each layer's own style, or from the selected range's first character's. */
    eachStyle: (key: string, to: (now: Style) => unknown) =>
      range
        ? target.editor.styleTextSelection({ [key]: to(range[0] ?? (target.props[0].style as Style)) })
        : set(target, (now) => styled(now, key, to(now.style as Style))),
    /** Changes a number of the style from each layer's own, `from` where it has none, held between `min` and `max`. */
    changeStyle: (key: string, change: (now: number) => number, min?: number, from = 0, max?: number) =>
      range
        ? target.editor.styleTextSelection({
            [key]: tidy(clamp(change((range[0]?.[key] as number | undefined) ?? from), min, max)),
          })
        : set(target, (now) =>
            styled(now, key, tidy(clamp(change(((now.style as Style)[key] as number | undefined) ?? from), min, max))),
          ),
  }
}

/** The topmost image fill, the one showing, when every selected layer has the same fills; null otherwise (`sharedImageFill`). */
export function imageFillOf(target: Target): { index: number; paint: ImageFill } | null {
  return sharedImageFill(target.props.map((pr) => (pr.fills ?? []) as Paint[]))
}

/** A layer's own values, with its box where auto layout places and sizes it, tidied as shown. */
function shownProps(editor: Editor, id: string): Props {
  const props = editor.drawnPropsOf(id)
  const box = ['x', 'y', 'width', 'height'].flatMap((key) => {
    const value = props[key]
    return typeof value === 'number' ? [[key, tidy(value)]] : []
  })
  return { ...props, ...Object.fromEntries(box) }
}

/**
 * With shrink to fit on, the text is drawn at the largest size that fits between its smallest and
 * largest, whatever its size says, so its size is kept as its largest: a size set becomes the
 * largest, and the smallest comes down to it when it was above it. Selected characters' own sizes
 * are scaled with the text's, so a size set on them needs nothing more.
 */
function largestAt(now: Props, size: number): Patch {
  const fit = now.shrinkToFit as Fit | undefined
  return fit ? { shrinkToFit: { min: Math.min(fit.min, size), max: size } } : {}
}

/** A layer's constraints from its values: its own, or left and top. */
function ownConstraints(props: Props): Constraints {
  return (props.constraints as Constraints | undefined) ?? LEFT_TOP
}
