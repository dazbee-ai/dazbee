// The editor's core opened in Node for the tests, on `buildCore`, with real CanvasKit and the fonts
// the app ships, and a mouse, keys and a clipboard in stage points: each sends the pointer and key
// inputs a browser sends, in a browser's order.
import { readDesign } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type DesignInput, fontUses, imageAssetIds, parseDesign, type Point } from '@dazbee/schema'

import type { Insets, Viewport } from './canvas/camera.ts'
import { labelBox } from './canvas/frames.ts'
import { buildCore } from './core.ts'
import type { CoreOptions, LinkNotices, NoticeDetail, TabAccess } from './core-interface.ts'
import { openedFonts } from './font-loads.ts'
import type { FrameSampler } from './gestures/colour-pick.ts'
import { CORNER_REACH, type Grab, type LineEnd, lineEnds, ROTATE_REACH, screenCorners } from './gestures/hit-zones.ts'
import type { KeyAnswer, KeyInput, KeyTarget, PointerInput } from './gestures/inputs.ts'
import type { Handle } from './layers/transform.ts'
import type { OpenTab } from './open-tab.ts'
import { loadImages, type ResourceSources } from './resources.ts'
import { pressFor, type ShortcutAction } from './shortcuts.ts'

export interface TestEditorOptions {
  /** The stage's size, in CSS pixels: 1280 by 760 unless told another. */
  viewport?: Viewport
  /** The stage's edges floating chrome covers, which the first fit keeps clear of; none unless told. */
  insets?: Insets
  /** Where the design's images and the fonts the app does not ship come from; a design that needs neither needs none. */
  sources?: ResourceSources
  /** Uploads the pictures of an SVG file placed; without it, they are left out. */
  uploadImage?: CoreOptions['uploadImage']
  /** The tab's access, as a Reviewer's tab has; the tab may edit unless told. */
  access?: TabAccess
  /** What the connection tells; nothing unless told. */
  linkNotices?: LinkNotices
  /**
   * The tab the core opens on, as `startEditor` opens it: its store, access and notices, and the
   * core's recompute bound to it. The design is the tab's, and `design` only names its fonts.
   */
  tab?: OpenTab
  /** What draws the frames picking a colour reads; the core draws them itself unless told. */
  sampler?: FrameSampler
  /** Whether the stage may show the hidden layers, as a version viewed may not; it may unless told. */
  hiddenShowable?: boolean
}

/** The keys held with a pointer input, by the names a pointer input gives them. */
export interface Held {
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
  meta?: boolean
}

export interface DragOptions extends Held {
  /** How many moves the drag makes between its press and its release: 6 unless told another. */
  steps?: number
  /** Whether a redraw pass runs after each of the drag's inputs, as it does after every other input; a browser may run none between two events. */
  redraws?: boolean
}

/** A corner of the selection's box. */
export type Corner = 'nw' | 'ne' | 'se' | 'sw'

/** What `at` finds a point for: a corner or an edge to resize by, a line's end, or the turning band outside a corner. */
export type Grabbed = Handle | { turn: Corner }

/** A modifier key by the name a keyboard gives it. */
type Modifier = 'Shift' | 'Alt' | 'Control' | 'Meta'

/** The test editor, as `testEditor` resolves to it. */
export type TestEditor = Awaited<ReturnType<typeof testEditor>>

/** The stage's size unless a test gives another. */
const STAGE: Viewport = { width: 1280, height: 760 }
/** The corners of a box in the order `screenCorners` gives their points. */
const CORNERS: readonly Corner[] = ['nw', 'ne', 'se', 'sw']
/** Each edge with the two corners it runs between. */
const EDGE_ENDS: Readonly<Record<string, readonly [Corner, Corner]>> = {
  n: ['nw', 'ne'],
  e: ['ne', 'se'],
  s: ['se', 'sw'],
  w: ['sw', 'nw'],
}
const MODIFIERS: readonly Modifier[] = ['Shift', 'Alt', 'Control', 'Meta']
/** The character a key types by the code of the key, for the keys that are not letters or digits. */
const TYPED: Readonly<Record<string, string>> = {
  Space: ' ',
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  NumpadAdd: '+',
  NumpadSubtract: '-',
}
/** What the page says of a key pressed with nothing on the page holding the focus: the stage has the keys. */
const ON_STAGE: KeyTarget = {
  field: false,
  control: false,
  dialog: 'none',
  toolbarArrow: false,
  buttonEnter: false,
  stage: true,
}

/**
 * Opens a design's core in Node as `startEditor` opens it in a browser: its first images and fonts
 * loaded with the core's own functions, the stage sized, the page's frames fitted and one redraw
 * pass run. Nothing is stubbed; `end` ends the core and frees what was made.
 */
export async function testEditor(
  design: DesignInput,
  {
    viewport = STAGE,
    insets,
    sources = {},
    uploadImage,
    tab,
    sampler,
    hiddenShowable,
    ...given
  }: TestEditorOptions = {},
) {
  const parsed = parseDesign(design)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const access = tab?.access ?? given.access
  const linkNotices = tab?.linkNotices ?? given.linkNotices
  const ck = await loadCanvasKit()
  const store = tab?.store ?? openTestStore(parsed.design)
  const opened = readDesign(store)
  const [images, fonts] = await Promise.all([
    loadImages(imageAssetIds(opened), sources),
    openedFonts(fontUses(opened), sources),
  ])
  const cache = resourceCache(ck)
  const ending = new AbortController()
  /** What the editor keeps on the device, by key. */
  const remembered = new Map<string, string>()
  const { core, modules, sync } = buildCore({
    ck,
    cache,
    first: {
      fonts: [...loadFontFiles(), ...fonts.files].map(({ family, bytes }) => ({ family, bytes })),
      fallbackFamilies: [...FALLBACK_FAMILIES],
      images,
    },
    firstFonts: fonts,
    store,
    connected: () => true,
    remembered: { get: (key) => remembered.get(key) ?? null, set: (key, value) => void remembered.set(key, value) },
    onMac: () => false,
    signal: ending.signal,
    // The typing pause runs on the test's clock: fake timers move it.
    after: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    ...(access ? { access } : {}),
    ...(linkNotices ? { linkNotices } : {}),
    ...(tab ? { presence: tab.presence } : {}),
    ...(sampler ? { sampler } : {}),
    ...(hiddenShowable === undefined ? {} : { hiddenShowable }),
    options: {
      designId: opened.meta.designId,
      frameName: (width, height) => `${width} × ${height}`,
      layerName: (kind) => ({ group: 'Group', maskGroup: 'Mask group', box: 'Box' })[kind],
      radiusLabel: (radius) => `Radius ${radius}`,
      ...sources,
      ...(uploadImage ? { uploadImage } : {}),
    },
  })
  /** Every notice the core has raised, in order. */
  const told: NoticeDetail[] = []
  /** Where the pointer is, as a stage point. */
  let pointer: Point = { x: 0, y: 0 }
  /** Whether the press in progress asked for the pointer to be held, as a browser then captures it. */
  let captured = false
  /** The modifier keys held down. */
  const held = new Set<Modifier>()
  /** The keys held down, by code, so a key pressed again while held repeats. */
  const down = new Set<string>()

  /** The frame whose label's row holds a stage point, the last drawn of those there, as a press and a double click carry it. */
  function labelUnder(at: Point) {
    return core.frames().findLast((frame) => {
      const row = labelBox(frame, core.camera())
      return row && at.x >= row.x && at.x <= row.x + row.width && at.y >= row.y && at.y <= row.y + row.height
    })?.id
  }
  /** Sends one pointer input at the pointer's place with the modifier keys held, and runs a redraw pass after it unless told not to. */
  function send(type: PointerInput['type'], detail: number, extra: Held = {}, redraws = true) {
    const label = type === 'pointerdown' || type === 'dblclick' ? labelUnder(pointer) : undefined
    const answer = core.input.pointer({
      type,
      at: pointer,
      button: 0,
      detail,
      shiftKey: extra.shift ?? held.has('Shift'),
      altKey: extra.alt ?? held.has('Alt'),
      ctrlKey: extra.ctrl ?? held.has('Control'),
      metaKey: extra.meta ?? held.has('Meta'),
      pointerType: 'mouse',
      ...(label === undefined ? {} : { label }),
    })
    if (answer.hold) captured = true
    if (redraws) core.redraw()
    return answer
  }
  /** Takes the pointer to a stage point in `steps` even steps in a line from where it is, the last on the point itself, calling `each` at each. */
  function walk(to: Point, steps: number, each: () => void) {
    const from = pointer
    for (let step = 1; step <= steps; step++) {
      pointer =
        step === steps
          ? to
          : { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps }
      each()
    }
  }
  /**
   * Lets the press go as a browser does: the release, the capture lost when the press asked for the
   * pointer to be held, then the click the press and release make, with its count.
   */
  function release(count: number, extra: Held = {}, redraws = true) {
    const answer = send('pointerup', 0, extra, redraws)
    if (captured) send('lostpointercapture', 0, extra, redraws)
    captured = false
    send('click', count, extra, redraws)
    return answer
  }
  const mouse = {
    /** Moves the pointer to a stage point, in `steps` moves in a line from where it is (one unless told). */
    move(x: number, y: number, { steps = 1 }: { steps?: number } = {}) {
      walk({ x, y }, steps, () => send('pointermove', 0))
    },
    down: () => send('pointerdown', 0),
    /**
     * Lets the press go: the release and what a browser sends after it, the click counted 1 unless
     * told another, and after a second click the double click.
     */
    up({ count = 1 }: { count?: number } = {}) {
      const answer = release(count)
      if (count === 2) send('dblclick', 2)
      return answer
    },
    /**
     * Clicks at a stage point: the move there, then each press and its release up to `count`, the
     * count on each click, and the double click a browser sends after the second.
     */
    click(x: number, y: number, { count = 1 }: { count?: number } = {}) {
      mouse.move(x, y)
      for (let n = 1; n <= count; n++) {
        send('pointerdown', 0)
        release(n)
        if (n === 2) send('dblclick', 2)
      }
    },
    /** Double-clicks at a stage point: two clicks, then the double click. */
    dblclick: (x: number, y: number) => mouse.click(x, y, { count: 2 }),
    /**
     * Drags between two stage points: the move to the first, the press, `steps` moves in a line to
     * the second, and the release with what follows it. The keys named are held for the whole drag.
     */
    drag(from: Point, to: Point, { steps = 6, redraws = true, ...keys }: DragOptions = {}) {
      pointer = from
      send('pointermove', 0, keys, redraws)
      send('pointerdown', 0, keys, redraws)
      walk(to, steps, () => send('pointermove', 0, keys, redraws))
      release(1, keys, redraws)
    },
  }

  /** A key by its name, a code such as `KeyZ` or `Enter` or the character it types, as a key input. */
  function keyInput(type: KeyInput['type'], name: string, target: Partial<KeyTarget>): KeyInput {
    const modifier = MODIFIERS.find((m) => m === name)
    const letter = /^Key([A-Z])$/.exec(name)?.[1]
    const digit = /^Digit(\d)$/.exec(name)?.[1]
    const shift = held.has('Shift')
    const typed = letter ? (shift ? letter : letter.toLowerCase()) : (digit ?? TYPED[name])
    const code = modifier ? `${modifier}Left` : name.length === 1 ? codeOf(name) : name
    return {
      type,
      code,
      key: modifier ?? typed ?? name,
      shiftKey: shift,
      altKey: held.has('Alt'),
      ctrlKey: held.has('Control'),
      metaKey: held.has('Meta'),
      repeat: type === 'keydown' && down.has(code),
      target: { ...ON_STAGE, ...target },
    }
  }
  const keys = {
    /**
     * Presses a key down, on the stage unless `target` says where: Escape first goes to the drag
     * held, which alone hears it when there is one. What the editor's own key threw is thrown on.
     */
    down(name: string, target: Partial<KeyTarget> = {}) {
      const modifier = MODIFIERS.find((m) => m === name)
      if (modifier) held.add(modifier)
      const input = keyInput('keydown', name, target)
      down.add(input.code)
      const answer = core.input.cancelOnEscape(input) ? { handled: true } : core.input.key(input)
      core.redraw()
      if ('thrown' in answer) throw answer.thrown
      return answer
    },
    /** Lets a key go. */
    up(name: string, target: Partial<KeyTarget> = {}) {
      const modifier = MODIFIERS.find((m) => m === name)
      if (modifier) held.delete(modifier)
      const input = keyInput('keyup', name, target)
      down.delete(input.code)
      const answer = core.input.key(input)
      core.redraw()
      return answer
    },
    /**
     * Presses keys as a person does, such as `Control+Shift+KeyZ`: each goes
     * down in order, `between` runs while all are down, told whether the editor took the last key,
     * and every key gone down comes up, last first, however the press ends. Returns what the editor
     * answered the last key down.
     */
    press(combo: string, target: Partial<KeyTarget> = {}, between?: (taken: boolean) => void) {
      const names = combo === '+' ? ['+'] : combo.split('+')
      const pressed: string[] = []
      try {
        let answer: KeyAnswer | undefined
        for (const name of names) {
          pressed.push(name)
          answer = keys.down(name, target)
        }
        between?.(answer?.handled ?? false)
        return answer
      } finally {
        for (const name of pressed.toReversed()) keys.up(name, target)
      }
    },
  }
  /** Presses an action's first key from the shortcut table. */
  function press(action: ShortcutAction) {
    return keys.press(pressFor(action))
  }

  /**
   * A stage point to press for a corner or an edge of the selection, a line's end, or the turning
   * band outside a corner; null when the selection has none there. The point is worked out from the
   * selection's box, and the press's own question, `handleUnder`, is then asked of it: this throws
   * when the answer is not what was asked for.
   */
  function at(which: Grabbed): Point | null {
    const outer = modules.boxes.selectionBox()
    if (!outer) return null
    const corners = screenCorners(outer.drawn, outer.frame, core.camera())
    const corner = (name: Corner) => corners[CORNERS.indexOf(name)] ?? { x: 0, y: 0 }
    const line = modules.boxes.selectedLine()?.ends ?? false
    const handles = line ? ['w', 'e'] : modules.boxes.handlesFor()
    const point = typeof which === 'string' ? handlePoint(which) : bandPoint(which.turn)
    if (!point) return null
    const grabbed = modules.transformDrag.handleUnder(point)
    if (!asked(which, grabbed, line))
      throw new Error(`a press at ${point.x}, ${point.y} for ${JSON.stringify(which)} grabs ${JSON.stringify(grabbed)}`)
    return point

    /** A corner itself, the middle of an edge, or a line's end; null for a handle the selection lacks. */
    function handlePoint(handle: Handle): Point | null {
      if (!handles.includes(handle)) return null
      if (line) return lineEnds(corners)[handle === 'w' ? 0 : 1]
      const ends = EDGE_ENDS[handle]
      if (!ends) return corner(handle as Corner)
      const [a, b] = [corner(ends[0]), corner(ends[1])]
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
    /** Out from a corner, away from the box's middle, halfway through the band between the corner's reach and the turn's; null where nothing turns. */
    function bandPoint(name: Corner): Point | null {
      if (handles.length === 0 || modules.boxes.selectionBoxes().length !== 1) return null
      const [from, middle] = [corner(name), middleOf(corners)]
      const away = Math.hypot(from.x - middle.x, from.y - middle.y) || 1
      const out = (CORNER_REACH + ROTATE_REACH) / 2
      return { x: from.x + ((from.x - middle.x) / away) * out, y: from.y + ((from.y - middle.y) / away) * out }
    }
  }

  tab?.bind(sync, ending.signal)
  core.onNotice((...notice) => told.push(notice))
  core.setViewport({ ...viewport, dpr: 1 })
  if (insets) core.setInsets(insets)
  core.fitAll()
  core.redraw()

  return {
    core,
    modules,
    told,
    remembered,
    mouse,
    keys,
    press,
    clipboard: core.clipboard,
    at,
    /** Ends the core and frees the cache it drew with. */
    end() {
      ending.abort()
      cache.delete()
    },
  }
}

/** The code of the key that types a character: a letter's or a digit's key, else the character itself. */
function codeOf(character: string) {
  if (/^[a-z]$/i.test(character)) return `Key${character.toUpperCase()}`
  return /^\d$/.test(character) ? `Digit${character}` : character
}

/** The middle of a box by its corners. */
function middleOf(corners: readonly Point[]): Point {
  const sum = corners.reduce((to, p) => ({ x: to.x + p.x, y: to.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / corners.length, y: sum.y / corners.length }
}

/** Whether what a press grabs is what was asked for. */
function asked(which: Grabbed, grabbed: Grab | null, line: boolean) {
  if (typeof which !== 'string') return grabbed?.kind === 'rotate'
  if (line) return grabbed?.kind === 'end' && grabbed.end === (which as LineEnd)
  return grabbed?.kind === 'resize' && grabbed.handle === which
}
