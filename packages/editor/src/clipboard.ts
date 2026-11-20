// What a copy puts on the clipboard and a paste brings from it, as plain data; copied layers as
// one, kept on this device too, so a paste that brings only their plain text still pastes them; and
// the style Copy style keeps on this device for Paste style.
import { carryOverLayers, isRecord, LAYER_CLIPBOARD_TYPE, LayerClipboard, LayerStyle } from '@dazbee/schema'

/** A file on the clipboard: its name and type are known at once, its contents read only when asked for. */
export interface ClipboardFile {
  name: string
  type: string
  text(): Promise<string>
  bytes(): Promise<Uint8Array>
}

/**
 * What a copy or a cut puts on the clipboard, or a paste brings from it: plain text, the editor's
 * own types by name (`LAYER_CLIPBOARD_TYPE`, `SVG_TYPE`), and files.
 */
export interface ClipboardPayload {
  text?: string
  data?: Record<string, string>
  files?: ClipboardFile[]
}

/**
 * The values the editor keeps on a device between designs and visits: a browser gives its
 * `localStorage`, which throws where storage is off, and a test a map.
 */
export interface Remembered {
  get(key: string): string | null
  set(key: string, value: string): void
}

/**
 * The last layers copied, kept on this device too with the plain text the copy wrote: a paste
 * that brings that text but not our own type (Mod+Shift+V pastes plain text only, and Safari
 * drops custom types) still pastes the layers.
 */
const REMEMBERED = 'dazbee.copiedLayers'
/** The style Copy style last took, kept on this device so Paste style works in any design. */
const STYLE = 'dazbee.copiedStyle'

/**
 * Copied layers as a payload, in our own type and as their names in plain text, kept on this device
 * too; `kept` is false without storage, when only a paste that keeps our own type pastes the layers.
 */
export function copyPayload(
  remembered: Remembered,
  copied: LayerClipboard,
): { payload: ClipboardPayload; kept: boolean } {
  const json = JSON.stringify(copied)
  const plain = copied.tree.roots.map((id) => copied.tree.nodes[id]?.name || 'Layer').join('\n')
  const payload = { text: plain, data: { [LAYER_CLIPBOARD_TYPE]: json } }
  try {
    remembered.set(REMEMBERED, JSON.stringify({ plain, json }))
    return { payload, kept: true }
  } catch {
    return { payload, kept: false }
  }
}

/**
 * The layers a paste brings, with where they were copied from: in our own type, or the copy kept on
 * this device when the paste brings only the plain text that copy wrote. Null for anything else.
 */
export function layersOnClipboard(remembered: Remembered, payload: ClipboardPayload): LayerClipboard | null {
  let raw = payload.data?.[LAYER_CLIPBOARD_TYPE]
  const plain = payload.text
  try {
    if (!raw && plain) {
      const kept = JSON.parse(remembered.get(REMEMBERED) ?? 'null') as { plain?: string; json?: string } | null
      if (kept?.plain === plain) raw = kept.json
    }
    const parsed = raw ? readLayers(raw) : null
    return parsed?.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The layers last copied in Dazbee on this device, with where they came from; null when there are none. */
export function rememberedLayers(remembered: Remembered): LayerClipboard | null {
  try {
    const kept = JSON.parse(remembered.get(REMEMBERED) ?? 'null') as { json?: string } | null
    const parsed = kept?.json ? readLayers(kept.json) : null
    return parsed?.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Keeps a copied style on this device; false without storage. */
export function keepStyle(remembered: Remembered, style: LayerStyle) {
  try {
    remembered.set(STYLE, JSON.stringify(style))
    return true
  } catch {
    return false
  }
}

/** Whether a style is the one kept on this device already, so Copy style would keep nothing new. */
export function styleKept(remembered: Remembered, style: LayerStyle) {
  try {
    return remembered.get(STYLE) === JSON.stringify(style)
  } catch {
    return false
  }
}

/** The style last copied on this device; null when there is none, or it can't be read. */
export function rememberedStyle(remembered: Remembered): LayerStyle | null {
  try {
    const parsed = LayerStyle.safeParse(JSON.parse(remembered.get(STYLE) ?? 'null'))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Copied layers read from their JSON, carried over to this schema's version first, as a tab built before it may have copied them. */
function readLayers(json: string) {
  const value: unknown = JSON.parse(json)
  if (isRecord(value) && isRecord(value.tree) && isRecord(value.tree.nodes)) {
    const nodes = carryOverLayers(value.tree.nodes)
    return LayerClipboard.safeParse({ ...value, tree: { ...value.tree, nodes } })
  }
  return LayerClipboard.safeParse(value)
}
