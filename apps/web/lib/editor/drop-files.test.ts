// Files dropped from the computer on the stage, placed by the editor's core opened in Node: the
// upload into the library is stubbed, each held until the test lets it finish or failed by its name.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Editor, PlacedAsset } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { copyIn, frameDesign, linkedFrames, type Seeded } from '@dazbee/editor/test-matrix'
import type { AssetSummary, DesignInput } from '@dazbee/schema'

import { sendAsset } from '@/lib/upload-asset.ts'

import { dragFills, dropAt, placeDroppedFiles } from './drop-files.ts'

vi.mock('@/lib/upload-asset.ts', async (original) => ({
  ...(await original<typeof import('@/lib/upload-asset.ts')>()),
  sendAsset: vi.fn(),
}))

const WORKSPACE = 'workspace-1'
const BRAND = 'brand-1'
const BLUE = { type: 'solid' as const, color: '#2F6BFFFF' }
/** A box with a solid fill, 100 in from the square's top and left, 400 square. */
const BOX: Seeded = {
  type: 'box',
  parentId: 'sq',
  index: 'a0',
  name: 'Box',
  props: { x: 100, y: 100, width: 400, height: 400, fills: [BLUE] },
}
/** An SVG file's markup: a red square, 100 wide. */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#f00"/></svg>'

/** A picture's data URL: a PNG's signature and a header saying 4 × 4, all the SVG converter reads. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAAAAAAAA'
/** An SVG file's markup: a card, 100 wide, showing a picture over its left half. */
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0f0"/><image id="Photo" width="50" height="50" href="${PNG}"/></svg>`

/** A JPEG photo, an SVG file and a text file, as the computer hands them over. */
const jpeg = (name: string) => new File(['x'], `${name}.jpg`, { type: 'image/jpeg' })
const svgFile = (name: string, markup = SVG) => new File([markup], `${name}.svg`, { type: 'image/svg+xml' })
const textFile = () => new File(['Not a picture.\n'], 'notes.txt', { type: 'text/plain' })

/** The asset the library records for an uploaded file. */
function assetOf(file: File, n: number): AssetSummary {
  return {
    id: `asset-${n}`,
    brandId: BRAND,
    sha256: n.toString(16).padStart(64, '0'),
    contentType: file.type === 'image/svg+xml' ? 'image/svg+xml' : 'image/jpeg',
    byteSize: file.size,
    width: 400,
    height: 300,
    name: file.name.replace(/\.\w+$/, ''),
    tags: [],
    createdAt: new Date(0).toISOString(),
  }
}

/**
 * Answers every upload with its asset, held until `release` when told to hold, and fails the files
 * whose names start with `fail-` with "Storage is down", as storage answering an error does.
 */
function stubUploads({ hold = false } = {}) {
  let release = () => {}
  const held = hold ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()
  let sent = 0
  vi.mocked(sendAsset).mockImplementation(async (_workspaceId, _brandId, file) => {
    const n = ++sent
    await held
    if (file.name.startsWith('fail-')) throw new Error('Storage is down')
    return assetOf(file, n)
  })
  return () => release()
}

/**
 * The test editor as the page's `Editor`, its stage at the page's top left corner so a client
 * point is a stage point. Only the members the dropped files' handler and these tests use are real.
 */
function asEditor({ core }: TestEditor): Editor {
  const unused = () => {
    throw new Error('not used by the dropped files')
  }
  return {
    ...core,
    copyLayers: unused,
    copyPng: unused,
    selectionRect: unused,
    labelRect: unused,
    showFrame: unused,
    showOnStage: unused,
    screenPoint: (x, y, frameId) => core.stagePoint(x, y, frameId),
    drawn: async () => void core.redraw(),
    exportFiles: unused,
    synced: () => true,
    keptOnDevice: () => Promise.resolve(),
    fetchVersion: () => Promise.resolve(null),
    pauseInput: () => () => {},
    startBrief: unused,
    moreLikeThis: unused,
    refine: unused,
    tryAgain: unused,
    designAi: unused,
    onDesignAi: unused,
    destroy: unused,
  }
}

/** The graphics filled with an image, each with its centre in its frame and the asset it shows. */
function images(t: TestEditor) {
  return Object.entries(t.core.session.design().nodes)
    .flatMap(([id, node]) => {
      const fill = 'fills' in node.props ? node.props.fills?.[0] : undefined
      if (node.type !== 'graphic' || fill?.type !== 'image') return []
      const { x, y, width, height } = node.props
      return [{ id, parentId: node.parentId, assetId: fill.assetId, x: x + width / 2, y: y + height / 2 }]
    })
    .sort((a, b) => a.x - b.x)
}

/** The fills of a layer as stored. */
const fillsOf = (t: TestEditor, id: string) => {
  const props = t.core.session.design().nodes[id]?.props
  return props && 'fills' in props ? props.fills : undefined
}

/** The groups the design holds, an SVG file placed each. */
const groups = (t: TestEditor) =>
  Object.entries(t.core.session.design().nodes)
    .filter(([, node]) => node.type === 'group')
    .map(([id]) => id)

let opened: TestEditor[] = []
/** Opens a design in the test editor, ended after the test, uploading an SVG file's pictures with `uploadImage` when given. */
async function open(
  design: DesignInput,
  uploadImage?: (bytes: Uint8Array, type: string, name: string) => Promise<PlacedAsset>,
) {
  const t = await testEditor(design, uploadImage ? { uploadImage } : {})
  opened.push(t)
  return { t, editor: asEditor(t) }
}

beforeEach(() => {
  vi.mocked(sendAsset).mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  for (const t of opened) t.end()
  opened = []
})

describe('placeDroppedFiles', () => {
  it('places several images cascading 24 screen pixels apart from the drop point, each uploaded once, all selected, as one undo step', async () => {
    const { t, editor } = await open(frameDesign({ name: 'Dropped files' }))
    stubUploads()
    const files = [jpeg('one'), jpeg('two')]
    const at = t.core.stagePoint(540, 540)

    const result = await placeDroppedFiles(editor, WORKSPACE, BRAND, files, dropAt(editor, at, files))

    expect(result).toEqual({ failed: [], unplaced: 0 })
    expect(
      vi.mocked(sendAsset).mock.calls.map(([workspaceId, brandId, file]) => [workspaceId, brandId, file.name]),
    ).toEqual([
      [WORKSPACE, BRAND, 'one.jpg'],
      [WORKSPACE, BRAND, 'two.jpg'],
    ])
    const step = 24 / t.core.camera().zoom
    const placed = images(t)
    expect(placed.map((p) => p.assetId).sort()).toEqual(['asset-1', 'asset-2'])
    expect(placed.map((p) => [p.x, p.y])).toEqual([
      [expect.closeTo(540, 0), expect.closeTo(540, 0)],
      [expect.closeTo(540 + step, 0), expect.closeTo(540 + step, 0)],
    ])
    expect(t.core.selection().toSorted()).toEqual(placed.map((p) => p.id).toSorted())
    // One undo takes both away, and one redo puts both back.
    t.core.perform('undo')
    expect(images(t)).toEqual([])
    t.core.perform('redo')
    expect(images(t).map((p) => p.id)).toEqual(placed.map((p) => p.id))
  })

  it("fills a box's linked copy in the second frame with one image dropped beside a text file, lit while dragged over, selected in that frame, as one undo step", async () => {
    const { t, editor } = await open(
      linkedFrames(frameDesign({ name: 'Dropped files', nodes: { box: BOX } }), [
        { id: 'wide', name: 'Wide', width: 1920, height: 1080 },
      ]),
    )
    stubUploads()
    const copy = copyIn('wide', 'box')
    t.core.setCamera({ x: 40, y: 80, zoom: 0.35 })
    const files = [jpeg('photo'), textFile()]
    const at = t.core.stagePoint(300, 300, 'wide')
    // The text file will be left out, so the one image lights the copy it would fill.
    const transfer = { items: files.map((file) => ({ kind: 'file', type: file.type })) }
    expect(dragFills(transfer as unknown as DataTransfer)).toBe(true)
    expect(editor.imageTarget(at)).toBe(copy)
    expect(t.modules.place.dropTarget()).toEqual({ id: copy, frameId: 'wide' })

    const drop = dropAt(editor, at, files)
    expect(t.modules.place.dropTarget()).toBeNull()
    await placeDroppedFiles(editor, WORKSPACE, BRAND, [files[0] as File], drop)

    // The image goes on top of the copy's colour; the box in the square keeps its own, and no layer is new.
    expect(fillsOf(t, copy)).toEqual([BLUE, expect.objectContaining({ type: 'image', assetId: 'asset-1' })])
    expect(fillsOf(t, 'box')).toEqual([BLUE])
    expect(Object.keys(t.core.session.design().nodes).sort()).toEqual(['box', copy])
    expect([t.core.selection(), t.core.selectedFrame()]).toEqual([[copy], 'wide'])
    t.core.perform('undo')
    expect(fillsOf(t, copy)).toEqual([BLUE])
  })

  it('places images dropped on the second page at zoom 0.4 where they were dropped and 24 / 0.4 apart, though the view moves while they upload', async () => {
    const square = frameDesign({ name: 'Dropped files' })
    const { t, editor } = await open({
      ...square,
      pages: { ...square.pages, p2: { name: 'Page 2', order: 'a1' } },
      frames: {
        ...square.frames,
        'p2-sq': { pageId: 'p2', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
      },
    })
    const release = stubUploads({ hold: true })
    t.core.showPage('p2')
    t.core.setCamera({ x: 60, y: 60, zoom: 0.4 })
    const files = [jpeg('one'), jpeg('two')]

    const placing = placeDroppedFiles(
      editor,
      WORKSPACE,
      BRAND,
      files,
      dropAt(editor, t.core.stagePoint(300, 400, 'p2-sq'), files),
    )
    // While they upload the view zooms in and pans.
    t.core.setCamera({ x: -200, y: -150, zoom: 1.1 })
    release()
    await placing

    const placed = images(t)
    expect(placed.map((p) => [p.parentId, p.x, p.y])).toEqual(
      [0, 1].map((i) => ['p2-sq', expect.closeTo(300 + i * 60, 0), expect.closeTo(400 + i * 60, 0)]),
    )
    expect([t.core.selection().toSorted(), t.core.selectedFrame()]).toEqual([
      placed.map((p) => p.id).toSorted(),
      'p2-sq',
    ])
    t.core.perform('undo')
    expect(images(t)).toEqual([])
  })

  it('places two SVG files and a JPEG dropped together as one undo step, the pictures inside the SVGs uploaded first and named in their fills', async () => {
    const pictures: { type: string; name: string }[] = []
    const { t, editor } = await open(frameDesign({ name: 'Dropped files' }), (_bytes, type, name) => {
      pictures.push({ type, name })
      return Promise.resolve({ id: `picture-${pictures.length}`, name, width: 4, height: 4 })
    })
    stubUploads()
    const files = [svgFile('card', PHOTO_SVG), svgFile('badge'), jpeg('photo')]

    const result = await placeDroppedFiles(
      editor,
      WORKSPACE,
      BRAND,
      files,
      dropAt(editor, t.core.stagePoint(540, 540), files),
    )

    expect(result).toEqual({ failed: [], unplaced: 0 })
    expect(pictures).toEqual([{ type: 'image/png', name: 'Photo · card' }])
    const placed = groups(t)
    expect(placed).toHaveLength(2)
    // The card's picture shows the asset it was uploaded as; the JPEG its own.
    expect(
      images(t)
        .map((p) => p.assetId)
        .sort(),
    ).toEqual(['asset-3', 'picture-1'])
    expect(JSON.stringify(t.core.session.design().nodes)).not.toContain('svg-image-')
    expect(t.core.selection()).toHaveLength(3)
    // One undo takes all three away, and one redo puts them back.
    t.core.perform('undo')
    expect([groups(t), images(t)]).toEqual([[], []])
    expect(t.core.canUndo()).toBe(false)
    t.core.perform('redo')
    expect(groups(t).sort()).toEqual(placed.sort())
  })

  it('returns each file that did not upload with its reason, and still places the ones that did', async () => {
    const { t, editor } = await open(frameDesign({ name: 'Dropped files' }))
    stubUploads()
    const files = [jpeg('photo'), jpeg('fail-one'), new File(['x'], 'fail-two.png', { type: 'image/png' })]

    const result = await placeDroppedFiles(
      editor,
      WORKSPACE,
      BRAND,
      files,
      dropAt(editor, t.core.stagePoint(540, 540), files),
    )

    expect(result).toEqual({
      failed: [
        { name: 'fail-one.jpg', reason: 'Storage is down' },
        { name: 'fail-two.png', reason: 'Storage is down' },
      ],
      unplaced: 0,
    })
    expect(images(t).map((p) => [p.assetId, p.x, p.y])).toEqual([
      ['asset-1', expect.closeTo(540, 0), expect.closeTo(540, 0)],
    ])
  })

  it('tells each file once it is sent, uploaded or not, so a notice counts an SVG file out before its pictures upload', async () => {
    const told: string[] = []
    const toldAtPicture: string[][] = []
    const { t, editor } = await open(frameDesign({ name: 'Dropped files' }), (_bytes, _type, name) => {
      toldAtPicture.push([...told])
      return Promise.resolve({ id: 'picture-1', name, width: 4, height: 4 })
    })
    stubUploads()
    const files = [svgFile('card', PHOTO_SVG), jpeg('fail-one')]

    const result = await placeDroppedFiles(
      editor,
      WORKSPACE,
      BRAND,
      files,
      dropAt(editor, t.core.stagePoint(540, 540), files),
      (file) => told.push(file.name),
    )

    expect(result.failed.map((f) => f.name)).toEqual(['fail-one.jpg'])
    expect(toldAtPicture).toEqual([expect.arrayContaining(['card.svg'])])
    expect(told.toSorted()).toEqual(['card.svg', 'fail-one.jpg'])
  })

  describe('while something else goes on', () => {
    /** Two photos dropped low in the square, their uploads held; resolves to what placing them gives. */
    function dropTwo(t: TestEditor, editor: Editor, y = 700) {
      const release = stubUploads({ hold: true })
      const files = [jpeg('one'), jpeg('two')]
      const placing = placeDroppedFiles(
        editor,
        WORKSPACE,
        BRAND,
        files,
        dropAt(editor, t.core.stagePoint(540, y), files),
      )
      return { release, placing }
    }

    it('ends the typing into a text when the uploads finish and places both images at once, as one undo step after the typing', async () => {
      const title: Seeded = {
        type: 'text',
        parentId: 'sq',
        index: 'a0',
        name: 'Title',
        props: {
          x: 100,
          y: 100,
          width: 600,
          height: 60,
          text: 'Hello',
          style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#111111FF' },
        },
      }
      const { t, editor } = await open(frameDesign({ name: 'Dropped files', nodes: { title } }))
      const text = () => {
        const props = t.core.session.design().nodes.title?.props
        return props && 'text' in props ? props.text : undefined
      }
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      const { release, placing } = dropTwo(t, editor)
      // Typing into the title, at the end of its words, when the uploads finish.
      const word = t.core.stagePoint(150, 130)
      t.mouse.dblclick(word.x, word.y)
      expect(t.modules.typing.editing()?.id).toBe('title')
      t.keys.press('End')
      for (const key of 'abc') t.keys.press(key)
      release()
      // Placed straight away, well inside the time a pen path is given.
      await vi.advanceTimersByTimeAsync(100)
      expect([images(t).length, t.modules.typing.editing(), text()]).toEqual([2, null, 'Helloabc'])
      await placing
      // One undo takes both images away and leaves the typing; the next takes the typing back.
      t.core.perform('undo')
      expect([images(t), text()]).toEqual([[], 'Helloabc'])
      t.core.perform('undo')
      expect(text()).toBe('Hello')
    })

    it('places both images as one undo step once the pen limit ends a pen path left open, the path kept as drawn', async () => {
      const { t, editor } = await open(frameDesign({ name: 'Dropped files' }))
      const paths = () =>
        Object.entries(t.core.session.design().nodes)
          .filter(([, node]) => 'shape' in node.props && node.props.shape?.kind === 'path')
          .map(([id]) => id)
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      const { release, placing } = dropTwo(t, editor)
      // A pen path with two anchors, left open, when the uploads finish.
      t.core.setTool('pen')
      for (const [x, y] of [
        [200, 200],
        [420, 260],
      ] as const) {
        const at = t.core.stagePoint(x, y)
        t.mouse.click(at.x, at.y)
      }
      expect([paths().length, t.core.gesturing()]).toEqual([1, true])
      const [path] = paths()
      release()

      await vi.advanceTimersByTimeAsync(2_900)
      expect(images(t)).toEqual([])
      await vi.advanceTimersByTimeAsync(200)
      expect([images(t).length, paths()]).toEqual([2, [path]])
      await placing
      // One undo takes both images away and keeps the path; the next takes the path.
      t.core.perform('undo')
      expect([images(t), paths()]).toEqual([[], [path]])
      t.core.perform('undo')
      expect(paths()).toEqual([])
    })

    it('waits past the pen limit for a drag held on the canvas to be let go, then places both images, the drag and the images one undo step each', async () => {
      const square: Seeded = {
        type: 'graphic',
        parentId: 'sq',
        index: 'a0',
        name: 'Square',
        props: { x: 100, y: 100, width: 200, height: 200, shape: { kind: 'rect' }, fills: [BLUE] },
      }
      const { t, editor } = await open(frameDesign({ name: 'Dropped files', nodes: { square } }))
      const x = () => {
        const props = t.core.session.design().nodes.square?.props
        return props && 'x' in props ? props.x : undefined
      }
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      const { release, placing } = dropTwo(t, editor, 800)
      // The square is pressed and dragged, and still held when the uploads finish, for longer than the pen path's limit.
      const from = t.core.stagePoint(200, 200)
      t.mouse.move(from.x, from.y)
      t.mouse.down()
      t.mouse.move(from.x + 60, from.y + 30, { steps: 5 })
      release()
      await vi.advanceTimersByTimeAsync(4_500)
      expect(images(t)).toEqual([])
      t.mouse.move(from.x + 120, from.y + 60, { steps: 5 })
      t.mouse.up()
      await vi.advanceTimersByTimeAsync(100)
      const moved = x()
      expect([images(t).length, moved]).toEqual([2, expect.not.closeTo(100, 0)])
      await placing
      // One undo takes both images away and leaves the square where it was dragged; the next puts it back.
      t.core.perform('undo')
      expect([images(t), x()]).toEqual([[], moved])
      t.core.perform('undo')
      expect(x()).toBe(100)
    })

    it('counts an SVG file as unplaced when its page was left while it uploaded, though it is shown again before placing', async () => {
      const square = frameDesign({ name: 'Dropped files' })
      const { t, editor } = await open({
        ...square,
        pages: { ...square.pages, p2: { name: 'Page 2', order: 'a1' } },
        frames: {
          ...square.frames,
          'p2-sq': { pageId: 'p2', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
        },
      })
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      const release = stubUploads({ hold: true })
      const files = [svgFile('badge')]
      const placing = placeDroppedFiles(
        editor,
        WORKSPACE,
        BRAND,
        files,
        dropAt(editor, t.core.stagePoint(540, 540), files),
      )
      // Another page is shown when the file has uploaded, and a panel's scrub holds the placing back.
      t.core.showPage('p2')
      t.core.redraw()
      const end = t.core.beginGesture()
      release()
      await vi.advanceTimersByTimeAsync(200)
      // The square's page is shown again before the file could be placed.
      t.core.showPage('p1')
      t.core.redraw()
      end()
      await vi.advanceTimersByTimeAsync(200)

      expect(await placing).toEqual({ failed: [], unplaced: 1 })
      expect(groups(t)).toEqual([])
    })

    it("doesn't place an SVG file whose frame is deleted while it uploads, and counts it as unplaced", async () => {
      const { t, editor } = await open(
        linkedFrames(frameDesign({ name: 'Dropped files' }), [{ id: 'wide', name: 'Wide', width: 1920, height: 1080 }]),
      )
      const release = stubUploads({ hold: true })
      t.core.setCamera({ x: 40, y: 80, zoom: 0.35 })
      const files = [svgFile('badge')]

      const placing = placeDroppedFiles(
        editor,
        WORKSPACE,
        BRAND,
        files,
        dropAt(editor, t.core.stagePoint(500, 500, 'wide'), files),
      )
      t.core.session.run('frame.delete', { frameId: 'wide' })
      t.core.redraw()
      release()

      expect(await placing).toEqual({ failed: [], unplaced: 1 })
      expect(t.core.session.design().nodes).toEqual({})
      expect(Object.keys(t.core.session.design().frames)).toEqual(['sq'])
    })
  })
})
