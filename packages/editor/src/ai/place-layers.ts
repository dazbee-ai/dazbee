// Placing Make editable's layers in a frame: whether the frame's picture layer still shows the picture made editable
// as the split saw it, whether an earlier finish placed the job's layers in it already, and the commands that hide
// the picture layer and place the layers over it, bottom first: a picture layer for a split piece or a split layer,
// and for a piece a matcher rebuilt its live layers, bound to the brand kit as the matcher bound them, a text
// fitted to its words, and several layers of one piece in a group named after the piece.
import { CommandError, type Session } from '@dazbee/doc'
import type { FontUse } from '@dazbee/fonts'
import {
  type AiFrameView,
  BINDABLE_PROPERTIES,
  type BindableProperty,
  frameIdOf,
  type ImageCrop,
  type Layer,
  MAX_SPLIT_PIECES,
  pictureLayerOf,
  textFontUses,
  type TextLook,
  type UnplacedLayer,
  type VariableRef,
} from '@dazbee/schema'

import { type PieceBox, pieceId } from './layer-pieces.ts'
import { shownPicture } from './place-brief.ts'

/** A layer the finish places, for a split piece or a split layer: its id and name, its picture and its box in the frame. */
export interface PlacedLayer {
  id: string
  /** The link id it shares with the same piece or split layer of the job's other sizes; null for none. */
  link: string | null
  name: string
  assetId: string
  box: PieceBox
  /** The part of its picture the box shows, for a split piece; a split layer's cropped picture fills its box. */
  crop?: ImageCrop
  /** The layers a matcher rebuilt a split piece as, bottom first, each with its id, placed in the frame; left out, its picture is placed. */
  matched?: readonly { id: string; layer: UnplacedLayer }[] | undefined
  /** The id of the group its rebuilt layers are put in when they are several. */
  group?: string | undefined
}

export interface PlaceLayersDeps {
  session: Session
  /** Fits a text that grows with its words to them, in the step it is written in. */
  fitText: (id: string) => void
}

export interface PlaceLayers {
  /** Whether frame `frame`'s picture layer still shows the picture made editable as the split saw it. */
  fits(frame: AiFrameView): boolean
  /** Hides the frame's picture layer and places `layers` over it; nothing in a frame an earlier finish placed them in. */
  place(frame: AiFrameView, layers: readonly PlacedLayer[]): void
}

export function placeLayers({ session, fitText }: PlaceLayersDeps): PlaceLayers {
  /**
   * Whether frame `frame`'s picture layer still shows the picture made editable as the split saw it: that picture,
   * filling the whole frame, at the frame's size when the job was asked for.
   */
  function fits(frame: AiFrameView): boolean {
    const own = session.design().frames[frame.frameId]
    const picture = pictureOf(frame.frameId)
    if (!own || !picture || shownPicture(picture) !== frame.assetId) return false
    const props = picture.props as {
      x?: number
      y?: number
      width?: number
      height?: number
      fills?: { fit?: string }[]
    }
    const fill = props.fills?.find((f) => 'fit' in f)
    return (
      props.x === 0 &&
      props.y === 0 &&
      props.width === own.width &&
      props.height === own.height &&
      (fill?.fit === undefined || fill.fit === 'fill')
    )
  }

  /**
   * Hides the frame's picture layer and places the layers over it, bottom first, each with its link id when it has
   * one and the frame doesn't hold it already. A frame that holds a layer of this job already gets nothing: an
   * earlier finish placed them, whether from split pieces or from split layers, whose layers share their ids.
   */
  function place(frame: AiFrameView, layers: readonly PlacedLayer[]): void {
    if (placedBefore(frame)) return
    const pictureId = pictureLayerOf(frame.frameId)
    session.run('node.update', { ids: [pictureId], patch: { visible: false } })
    for (const layer of [...layers].reverse()) {
      const link = layer.link !== null && !holdsLink(frame.frameId, layer.link) ? { link: layer.link } : {}
      if (layer.matched) {
        placeMatched(frame.frameId, layer.name, layer.matched, link, layer.group)
        continue
      }
      session.run('node.create', {
        id: layer.id,
        parentId: frame.frameId,
        ...link,
        layer: {
          type: 'graphic',
          name: layer.name,
          props: {
            ...layer.box,
            shape: { kind: 'rect' },
            fills: [
              layer.crop
                ? { type: 'image', assetId: layer.assetId, fit: 'crop', crop: layer.crop }
                : { type: 'image', assetId: layer.assetId, fit: 'fill' },
            ],
          },
        },
      })
    }
  }

  /**
   * Places the layers `matched` a matcher rebuilt a split piece as on top of frame `frameId`, bottom first: named
   * `name`, numbered when several, the first with the piece's link id when `link` gives one, each bound to the brand
   * kit as the matcher bound it, and a text fitted to its words. Several are then put in one group named `name`,
   * where they were placed, with the id `group` when one is given.
   */
  function placeMatched(
    frameId: string,
    name: string,
    matched: NonNullable<PlacedLayer['matched']>,
    link: { link?: string },
    group: string | undefined,
  ) {
    for (const [nth, { id, layer }] of matched.entries()) {
      session.run('node.create', {
        id,
        parentId: frameId,
        ...(nth === 0 ? link : {}),
        layer: { type: layer.type, name: matched.length > 1 ? `${name} ${nth + 1}` : name, props: layer.props },
      })
      for (const [property, ref] of Object.entries(layer.bindings ?? {})) {
        const value = BINDABLE_PROPERTIES[property as BindableProperty].read(layer.props)
        if (ref && value !== undefined) bind(id, property as BindableProperty, ref, value)
      }
      if (layer.type === 'text') fitText(id)
    }
    if (matched.length < 2) return
    const ids = matched.map(({ id }) => id)
    session.run('node.group', { ids, ...(group === undefined ? {} : { id: group }), name })
  }

  /** Binds `property` of layer `id` to the brand kit's `ref`, whose value now is `value`; a binding the design refuses is left out. */
  function bind(id: string, property: BindableProperty, ref: VariableRef, value: string | TextLook) {
    try {
      session.run('node.bind', { ids: [id], property, ref, value })
    } catch (e) {
      if (!(e instanceof CommandError)) throw e
    }
  }

  /** Whether the design holds a layer the finish of frame `frame`'s job placed in it. */
  function placedBefore(frame: AiFrameView): boolean {
    const { nodes } = session.design()
    for (let n = 0; n < MAX_SPLIT_PIECES; n++) if (nodes[pieceId(frame.jobId, frame.frameId, n)]) return true
    return false
  }

  /** Whether frame `frameId` holds a layer of link id `link` already, as a pasted copy can. */
  function holdsLink(frameId: string, link: string): boolean {
    const { nodes } = session.design()
    return Object.values(nodes).some(
      (node) => node.link === link && frameIdOf(session.design(), node.parentId) === frameId,
    )
  }

  /** Frame `frameId`'s picture layer, when the design has it there. */
  function pictureOf(frameId: string): Pick<Layer, 'props'> | undefined {
    const layer = session.design().nodes[pictureLayerOf(frameId)]
    return layer?.parentId === frameId ? layer : undefined
  }

  return { fits, place }
}

/** A placed layer as its split piece's picture, whatever a matcher rebuilt it as. */
export function asPicture(layer: PlacedLayer): PlacedLayer {
  return { ...layer, matched: undefined }
}

/** The fonts a rebuilt layer is drawn in: a text's; none for a graphic. */
export function fontUses(layer: UnplacedLayer): readonly FontUse[] {
  return layer.type === 'text' ? textFontUses(layer as Extract<Layer, { type: 'text' }>) : []
}
