// The story frame and the fonts, photo and layers the agent warnings' tests check it with.
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import type { ResourceBytes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, parseDesign } from '@dazbee/schema'

import { frameWarnings } from './agent-warnings.ts'

export const ck = await loadCanvasKit()
/** A photo the size of the story, white on its left half and black on its right. */
const halves = (() => {
  const surface = ck.MakeSurface(360, 640)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.WHITE)
  const paint = new ck.Paint()
  paint.setColor(ck.BLACK)
  canvas.drawRect(ck.XYWHRect(180, 0, 180, 640), paint)
  paint.delete()
  const image = surface.makeImageSnapshot()
  const png = image.encodeToBytes()
  image.delete()
  surface.dispose()
  if (!png) throw new Error('no PNG')
  return png
})()
export const bytes: ResourceBytes = {
  fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: { halves },
}

/** Fonts that are all here: `given`, or `bytes`. */
export const fontsHere = (given = bytes) => ({ fontsLoaded: () => Promise.resolve(), bytes: () => given })

export const style = { fontFamily: 'Noto Sans', fontSize: 24, color: '#111111FF' }
/** A text that fits its box, well inside its frame. */
export const title = {
  type: 'text',
  index: 'a1',
  name: 'Title',
  props: { x: 60, y: 200, width: 200, height: 60, boxMode: 'fixed', text: 'Sale', style },
}
/** A square well inside its frame. */
export const square = {
  type: 'graphic',
  index: 'a0',
  name: 'Square',
  props: { x: 20, y: 20, width: 40, height: 40, shape: { kind: 'rect' }, fills: [] },
}
export const white = { type: 'solid', color: '#FFFFFFFF' }
const black = { type: 'solid', color: '#000000FF' }
/** A layer the story holds over the title, as `layer` says. */
export const over = (id: string, layer: { type: string; name: string; props: object; [key: string]: unknown }) => ({
  [id]: { index: 'a2', parentId: 'story', link: id, ...layer },
})
/** A second text over the title, with its look, as `props` changes it. */
export const second = (props: object = {}) =>
  over('second', { type: 'text', name: 'Second', props: { ...title.props, ...props } })
/** A logo over the title: a black square with the logo's role, or what `own` gives, as `props` changes it. */
export const logo = (props: object = {}, own: object = { role: 'logo' }) =>
  over('logo', { type: 'graphic', name: 'Logo', ...own, props: { ...square.props, fills: [black], ...props } })

/**
 * A 9:16 frame, 360 × 640, holding a square and a text, each layer's props changed as `change`
 * says, and the frame's size and place as `frame` says.
 */
export function storyWith(
  change: { square?: object; title?: object; more?: Record<string, object> } = {},
  frame: { width?: number; height?: number; x?: number; y?: number; fills?: object[] } = {},
): Design {
  const layer = (base: { props: object }, id: string, props: object = {}) => ({
    ...base,
    parentId: 'story',
    link: id,
    props: { ...base.props, ...props },
  })
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'Agent' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: { story: { pageId: 'p', name: 'Story', width: 360, height: 640, x: 0, y: 0, order: 'a0', ...frame } },
    nodes: {
      square: layer(square, 'square', change.square),
      title: layer(title, 'title', change.title),
      ...change.more,
    },
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

export const kindsOf = (design: Design, layerIds?: string[]) =>
  frameWarnings(ck, design, 'story', bytes, layerIds ? { layerIds } : {}).map(({ layerId, kind }) => [layerId, kind])
