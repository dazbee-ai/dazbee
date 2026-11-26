import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Gesture } from '../gestures/pointer.ts'
import type { Measured } from '../layers/measure.ts'
import { HANDLES } from '../layers/transform.ts'
import { BOX, type Fake, fake, harness, PATHS, SQUARE, STORY } from './test-overlay.ts'

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editorOverlay', () => {
  describe('draw', () => {
    it('puts an outline over its box in its frame at the camera, turned as the layer is', () => {
      const { overlay, part } = harness({ x: 10, y: 20, zoom: 2, box: { ...BOX, x: 5, y: 5, width: 50, height: 25 } })
      overlay.draw()
      expect(part('selection')?.style).toMatchObject({ left: '20px', top: '30px', width: '100px', height: '50px' })
      expect(part('selection')?.style.transform).toBeUndefined()
      const turned = harness({ box: { ...BOX, rotation: 30 } })
      turned.overlay.draw()
      expect(turned.part('selection')?.style.transform).toBe('rotate(30deg)')
    })

    it("draws each module's parts in order", () => {
      const { overlay, log, drawn } = harness()
      overlay.draw()
      expect(drawn()).toEqual([
        'frame-label',
        'entered',
        'hover',
        'drop-target',
        'selection',
        'selection-size',
        'svg',
        'path-anchor',
        'selection',
        'crop-image',
        'reorder-leave',
        'snap-line',
        'caret',
      ])
      expect(log).toEqual(['replace'])
    })

    it('draws the loupe picking a colour shows last, over everything else, and none while it shows nothing', () => {
      const picking = {
        at: { x: 200, y: 300 },
        pointerType: 'mouse',
        state: 'drawing' as const,
        hex: null,
        window: null,
      }
      const { overlay, drawn, part } = harness({ picking })
      overlay.draw()
      expect(drawn().slice(-2)).toEqual(['caret', 'loupe'])
      // At the stage's zoom, centred on the hot spot.
      expect(part('loupe')?.style).toMatchObject({ left: '145px', top: '245px' })
      const none = harness()
      none.overlay.draw()
      expect(none.drawn()).not.toContain('loupe')
    })

    it("draws the other people's selections after the drop target, before the tab's own, and their cursors over all but the loupe", () => {
      const bob = { tabId: 7, name: 'Bob', colour: '#9747FF', cursor: { x: 40, y: 50 }, frame: SQUARE }
      const picking = { at: { x: 2, y: 3 }, pointerType: 'mouse', state: 'drawing' as const, hex: null, window: null }
      const { overlay, drawn, part } = harness({ people: [{ ...bob, layers: [{ frame: SQUARE, id: 'b' }] }], picking })
      overlay.draw()
      expect(drawn().slice(3, 7)).toEqual(['drop-target', 'presence-layer', 'presence-frame', 'selection'])
      expect(drawn().slice(-3)).toEqual(['caret', 'presence-cursor', 'loupe'])
      expect(part('presence-layer')?.style).toMatchObject({ color: '#9747FF', left: '10px', top: '110px' })
      expect(part('presence-frame')?.style).toMatchObject({ color: '#9747FF', width: '1080px' })
    })

    it("draws the picked frame's part after the labels, its own label lit and marked picked", () => {
      const { overlay, drawn, part } = harness({ selected: false, picked: true })
      overlay.draw()
      expect(drawn().slice(0, 3)).toEqual(['frame-label', 'frame-picked', 'hover'])
      expect(part('frame-picked')?.dataset).toEqual({ frame: 'one-sq' })
      expect(part('frame-label')?.dataset).toEqual({ frame: 'one-sq', active: '', picked: '' })
    })

    it('outlines the frame lit from outside the stage round the whole of it, after the labels, its own label lit', () => {
      const { overlay, drawn, part } = harness({ selected: false, lit: true })
      overlay.draw()
      expect(drawn().slice(0, 3)).toEqual(['frame-label', 'frame-lit', 'hover'])
      expect(part('frame-lit')?.dataset).toEqual({ frame: 'one-sq' })
      expect(part('frame-label')?.dataset).toEqual({ frame: 'one-sq', lit: '' })
      const unlit = harness({ selected: false })
      unlit.overlay.draw()
      expect(unlit.drawn()).not.toContain('frame-lit')
      expect(unlit.part('frame-label')?.dataset).toEqual({ frame: 'one-sq' })
    })

    it('leaves out the label of the frame the page renames in its place, outlining the frame still', () => {
      const { overlay, drawn } = harness({ selected: false, picked: true, renaming: true })
      overlay.draw()
      expect(drawn().slice(0, 2)).toEqual(['frame-picked', 'hover'])
    })

    it("draws the line where a move would drop the layers in a laid-out box's flow after the flow's own parts", () => {
      const drop = { boxId: 'row', around: [], slot: 0, near: null }
      const { overlay, drawn } = harness({ gesture: { kind: 'move', frame: SQUARE, drop } as unknown as Gesture })
      overlay.draw()
      expect(drawn().slice(-4)).toEqual(['reorder-leave', 'reorder-line', 'snap-line', 'caret'])
    })

    it('outlines the frame a move would drop its layers into round the whole of it, and none while they stay in theirs', () => {
      const onto = { kind: 'move', frame: SQUARE, target: STORY, drop: null } as unknown as Gesture
      const { overlay, part } = harness({ selected: false, linked: true, gesture: onto })
      overlay.draw()
      expect(part('frame-lit')?.dataset).toEqual({ frame: 'one-story' })
      const flowOnto = { kind: 'reorder', frame: SQUARE, target: STORY, drop: null } as unknown as Gesture
      const fromFlow = harness({ selected: false, linked: true, gesture: flowOnto })
      fromFlow.overlay.draw()
      expect(fromFlow.part('frame-lit')?.dataset).toEqual({ frame: 'one-story' })
      const staying = { kind: 'move', frame: SQUARE, target: null, drop: null } as unknown as Gesture
      const own = harness({ selected: false, linked: true, gesture: staying })
      own.overlay.draw()
      expect(own.drawn()).not.toContain('frame-lit')
    })

    it("outlines no hovered layer while a gesture runs, and shows a drawing's parts before the marquee's", () => {
      const { overlay, drawn } = harness({ gesture: { kind: 'textBox' } as Gesture })
      overlay.draw()
      expect(drawn()).toEqual([
        'frame-label',
        'entered',
        'drop-target',
        'selection',
        'selection-size',
        'svg',
        'path-anchor',
        'selection',
        'crop-image',
        'reorder-leave',
        'marquee',
        'snap-line',
        'caret',
      ])
    })

    it('labels each frame in view over its top with its own name and size, by its id, lit while its layer is selected', () => {
      const { overlay, part } = harness()
      overlay.draw()
      const label = part('frame-label')
      expect(label?.dataset).toEqual({ frame: 'one-sq', active: '' })
      expect(label?.style).toEqual({ left: '8px', top: '76px', width: '1072px' })
      expect(label?.children.map((c) => `${c.className} ${c.textContent}`)).toEqual([
        'frame-title ',
        'frame-size 1080 × 1080',
      ])
    })

    it('keeps a narrow frame its name, without the size, however narrow it is on screen', () => {
      for (const zoom of [0.1, 0.02]) {
        const { overlay, part } = harness({ zoom })
        overlay.draw()
        expect(part('frame-label')?.children.map((c) => c.className)).toEqual(['frame-title'])
      }
    })

    it('outlines the selected layer’s linked copies in the frames in view, dashed, before the selection', () => {
      const { overlay, drawn, part } = harness({ linked: true })
      overlay.draw()
      expect(drawn().filter((name) => name === 'linked-copy')).toHaveLength(1)
      expect(part('linked-copy')?.dataset).toEqual({ layer: 'story-a', frame: 'one-story' })
      expect(drawn().indexOf('linked-copy')).toBeLessThan(drawn().indexOf('selection'))
      // A copy selected too has none, and the copy of both selected layers has one.
      const across = harness({ linked: true, across: true })
      across.overlay.draw()
      expect(across.drawn().filter((name) => name === 'linked-copy')).toHaveLength(1)
      const none = harness({ linked: true, selected: false })
      none.overlay.draw()
      expect(none.drawn()).not.toContain('linked-copy')
    })

    it('outlines each hidden layer the frames in view draw, dashed, under the hover, while hidden layers are shown', () => {
      const { overlay, drawn, parts } = harness({ hidden: true })
      overlay.draw()
      expect(parts('hidden-layer').map((p) => p.dataset.layer)).toEqual(['faded', 'deep'])
      expect(drawn().lastIndexOf('hidden-layer')).toBeLessThan(drawn().indexOf('hover'))
      const off = harness()
      off.overlay.draw()
      expect(off.drawn()).not.toContain('hidden-layer')
    })

    it("draws a selection across frames with its box and handles in the first frame, an outline with none in each other, and every frame's label lit", () => {
      const { overlay, drawn, part, parts } = harness({ copies: ['story-a', 'mpu-a'] })
      overlay.draw()
      expect(part('selection')?.dataset.frame).toBe('one-sq')
      expect(part('selection')?.children.map((c) => `${c.className} ${c.dataset.handle}`)).toEqual(['handle nw'])
      expect(parts('selection-copy').map((p) => p.dataset)).toEqual([
        { frame: 'one-story', count: '1' },
        { frame: 'one-mpu', count: '1' },
      ])
      expect(parts('selection-copy').flatMap((p) => p.children)).toEqual([])
      expect(drawn()).not.toContain('linked-copy')
      expect(parts('frame-label').map((l) => l.dataset)).toEqual([
        { frame: 'one-sq', active: '' },
        { frame: 'one-story', active: '' },
        { frame: 'one-mpu', active: '' },
      ])
    })

    it('outlines a linked copy selected beside the layer as its frame’s part of the selection, not dashed, and keeps the dashed outline of a copy left out', () => {
      const { overlay, parts } = harness({ copies: ['story-a'] })
      overlay.draw()
      expect(parts('selection-copy').map((p) => p.dataset.frame)).toEqual(['one-story'])
      expect(parts('linked-copy').map((p) => p.dataset)).toEqual([{ layer: 'mpu-a', frame: 'one-mpu' }])
    })

    it('leaves off the handles and the size while the selection is moved, keeping its outlines, and shows them on a resize', () => {
      const moving = harness({
        handles: HANDLES,
        shaped: true,
        several: true,
        gesture: { kind: 'move', moved: true } as Gesture,
      })
      moving.overlay.draw()
      expect(moving.part('selection')?.children).toEqual([])
      expect(moving.drawn()).not.toContain('selection-size')
      expect(moving.drawn().filter((name) => name === 'selection-member')).toHaveLength(2)
      expect(moving.drawn()).toContain('selection')
      const pressed = harness({ handles: HANDLES, gesture: { kind: 'move', moved: false } as Gesture })
      pressed.overlay.draw()
      expect(pressed.part('selection')?.children).toHaveLength(4)
      expect(pressed.drawn()).toContain('selection-size')
      const resizing = harness({
        handles: HANDLES,
        gesture: { kind: 'resize', texts: new Map() } as unknown as Gesture,
      })
      resizing.overlay.draw()
      expect(resizing.drawn()).toContain('selection-size')
    })

    it("keeps one moved layer's real outline in its SVG path inside the selection, with no handles or size", () => {
      const { overlay, part, drawn } = harness({
        handles: HANDLES,
        shaped: true,
        gesture: { kind: 'move', moved: true } as Gesture,
      })
      overlay.draw()
      const selected = part('selection')
      expect(selected?.dataset.shape).toBe('')
      expect(selected?.children.map((c) => c.className)).toEqual(['svg'])
      expect(selected?.children[0]?.children[0]?.attributes.d).toBe(PATHS.a?.d)
      expect(drawn()).not.toContain('selection-size')
    })

    it('draws the radius dots the transform drag shows in the selection’s box after its handles, none while typing', () => {
      const dots = (h: ReturnType<typeof harness>) =>
        h
          .part('selection')
          ?.children.flatMap((c) =>
            c.className === 'radius-dot'
              ? [`${c.dataset.corner} ${c.style.left} ${c.style.top} ${'big' in c.dataset}`]
              : [],
          )
      const shown = harness({ dots: true })
      shown.overlay.draw()
      expect(shown.part('selection')?.children.map((c) => c.className)).toEqual(['handle', 'radius-dot', 'radius-dot'])
      expect(dots(shown)).toEqual(['0 12px 12px false', '1 88px 12px false'])
      const dragged = harness({ dots: true, gesture: { kind: 'radius' } as Gesture })
      dragged.overlay.draw()
      expect(dots(dragged)).toEqual(['0 12px 12px false', '1 88px 12px true'])
      expect(dragged.drawn()).toContain('selection-size')
      const resizing = harness({ dots: true, gesture: { kind: 'resize', texts: new Map() } as unknown as Gesture })
      resizing.overlay.draw()
      expect(dots(resizing)).toEqual([])
      const typing = harness({ dots: true, editing: { id: 'a', frameId: 'one-sq' } })
      typing.overlay.draw()
      expect(dots(typing)).toEqual([])
    })

    it('draws the radius pill over the selection while a dot is dragged, beside the pointer, off the size label and on the stage', () => {
      const radius = { kind: 'radius' } as Gesture
      const pill = (pointerAt: { x: number; y: number }, gesture: Gesture | null = radius) => {
        const h = harness({ dots: true, gesture, pointerAt })
        h.overlay.draw()
        return { h, el: h.part('gap-size radius-value') }
      }
      const free = pill({ x: 300, y: 300 })
      expect([free.el?.textContent, free.el?.style]).toEqual(['Radius 12', { left: '312px', top: '312px' }])
      expect(free.h.drawn().indexOf('gap-size radius-value')).toBeGreaterThan(free.h.drawn().indexOf('selection-size'))
      // The size label is 70 × 14 at 25, 218: below the pointer the pill would cover it.
      expect(free.h.part('selection-size')?.style).toMatchObject({ left: '25px', top: '218px' })
      expect(pill({ x: 60, y: 200 }).el?.style).toEqual({ left: '72px', top: '174px' })
      expect(pill({ x: 980, y: 300 }).el?.style).toEqual({ left: '898px', top: '312px' })
      expect(pill({ x: 300, y: 300 }, null).el).toBeUndefined()
    })

    it('keeps the radius pill clear of the chrome along the stage, as the size label is', () => {
      const pill = (
        pointerAt: { x: number; y: number },
        insets?: { top: number; right: number; bottom: number; left: number },
      ) => {
        const h = harness({ dots: true, gesture: { kind: 'radius' } as Gesture, pointerAt, ...(insets && { insets }) })
        h.overlay.draw()
        return h.part('gap-size radius-value')?.style
      }
      // Below the pointer it would sit in the dock's 72 px at the stage's bottom: it goes above.
      expect(pill({ x: 400, y: 720 })).toEqual({ left: '412px', top: '694px' })
      // Taller chrome at the bottom keeps it out of that too.
      expect(pill({ x: 400, y: 670 }, { top: 0, right: 0, bottom: 121, left: 0 })).toEqual({
        left: '412px',
        top: '644px',
      })
      // And chrome at the right side sends it left.
      expect(pill({ x: 860, y: 300 }, { top: 0, right: 80, bottom: 0, left: 0 })).toEqual({
        left: '778px',
        top: '312px',
      })
    })

    it("labels one line's size with its length alone, with its linked copy too", () => {
      const { overlay, part } = harness({ handles: HANDLES, line: true, box: { ...BOX, width: 300, height: 0 } })
      overlay.draw()
      expect(part('selection-size')?.textContent).toBe('300')
      const copy = harness({ handles: HANDLES, line: true, across: true, box: { ...BOX, width: 300, height: 0 } })
      copy.overlay.draw()
      expect(copy.part('selection-size')?.textContent).toBe('300')
      expect(copy.part('selection')?.dataset.handles).toBe('e w')
    })

    it("adds one text's font size, from what it was to what the corner scales it to, to the size while a corner scales it", () => {
      const texts = new Map([['a', { style: { fontSize: 40 }, runs: [] }]])
      const scaling = { kind: 'resize', texts, factor: 1.55 } as unknown as Gesture
      const one = harness({ handles: HANDLES, gesture: scaling })
      one.overlay.draw()
      expect(one.part('selection-size')?.textContent).toBe('100 × 100 · 40 → 62')
      const several = harness({ handles: HANDLES, several: true, gesture: scaling })
      several.overlay.draw()
      expect(several.part('selection-size')?.textContent).toBe('100 × 100')
    })

    it('gives the selection its handles and size, and leaves them off while text is typed into', () => {
      const shown = harness()
      shown.overlay.draw()
      expect(shown.part('selection')?.dataset).toEqual({ frame: 'one-sq', count: '1', layer: 'a', handles: 'nw' })
      expect(shown.part('selection')?.children.map((h) => `${h.className} ${h.dataset.handle}`)).toEqual(['handle nw'])
      expect(shown.part('selection-size')?.textContent).toBe('100 × 100')
      const typing = harness({ editing: { id: 'a', frameId: 'one-sq' } })
      typing.overlay.draw()
      expect(typing.part('selection')?.children).toEqual([])
      expect(typing.drawn()).not.toContain('selection-size')
    })

    describe('the handles and outlines', () => {
      /** What a part holds, by class and the handle or end it is. */
      const inside = (p: Fake | undefined) =>
        p?.children.map((c) => [c.className, c.dataset.handle, 'end' in c.dataset && 'end'].filter(Boolean).join(' '))

      it('draws only the four corners of the handles a selection has, and none on a box under 16 px on screen', () => {
        const all = harness({ handles: HANDLES })
        all.overlay.draw()
        expect(inside(all.part('selection'))).toEqual(['handle nw', 'handle ne', 'handle se', 'handle sw'])
        // The corners and edges a press resizes from, drawn or not.
        expect(all.part('selection')?.dataset.handles).toBe('nw n ne e se s sw w')
        const corner = all.part('selection')?.children[2]
        expect(corner?.style).toEqual({ left: '100%', top: '100%' })
        // 100 px at 0.15 is 15 px on screen.
        const small = harness({ handles: HANDLES, zoom: 0.15 })
        small.overlay.draw()
        expect(inside(small.part('selection'))).toEqual([])
        const locked = harness({ handles: [] })
        locked.overlay.draw()
        expect(inside(locked.part('selection'))).toEqual([])
      })

      it('draws the four corners of a box with one side under 16 px on screen, and none with both', () => {
        const text = harness({ handles: HANDLES, box: { ...BOX, width: 300, height: 12 } })
        text.overlay.draw()
        expect(inside(text.part('selection'))).toEqual(['handle nw', 'handle ne', 'handle se', 'handle sw'])
        const rule = harness({ handles: HANDLES, box: { ...BOX, width: 300, height: 1 } })
        rule.overlay.draw()
        expect(inside(rule.part('selection'))).toHaveLength(4)
        const dot = harness({ handles: HANDLES, box: { ...BOX, width: 15, height: 15 } })
        dot.overlay.draw()
        expect(inside(dot.part('selection'))).toEqual([])
      })

      it('draws a flat selection’s two ends, at the middles of its box’s sides, and lists them as what a press resizes from', () => {
        const { overlay, part } = harness({ handles: HANDLES, several: true, box: { ...BOX, height: 0 } })
        overlay.draw()
        expect(inside(part('selection'))).toEqual(['handle e', 'handle w'])
        expect(part('selection')?.dataset.handles).toBe('e w')
        expect(part('selection')?.children.map((c) => c.style)).toEqual([
          { left: '100%', top: '50%' },
          { left: '0%', top: '50%' },
        ])
      })

      it("draws one line's two ends as round handles, at the middles of its box's sides", () => {
        const { overlay, part } = harness({ handles: HANDLES, line: true })
        overlay.draw()
        expect(inside(part('selection'))).toEqual(['handle w end', 'handle e end'])
        expect(part('selection')?.dataset.handles).toBe('w e')
        const locked = harness({ handles: [], line: true })
        locked.overlay.draw()
        expect(locked.part('selection')?.dataset.handles).toBe('')
        expect(part('selection')?.children.map((c) => c.style)).toEqual([
          { left: '0%', top: '50%' },
          { left: '100%', top: '50%' },
        ])
      })

      it("follows the layer's real outline in one SVG path inside the selection, its handles after it", () => {
        const { overlay, part } = harness({ handles: HANDLES, shaped: true })
        overlay.draw()
        const selected = part('selection')
        expect(selected?.dataset.shape).toBe('')
        const [svg, ...handles] = selected?.children ?? []
        expect(svg?.className).toBe('svg')
        expect(svg?.attributes).toMatchObject({ class: 'outline-path', viewBox: '10 10 100 100' })
        expect(svg?.children[0]?.attributes.d).toBe(PATHS.a?.d)
        expect(handles).toHaveLength(4)
        const plain = harness({ handles: HANDLES })
        plain.overlay.draw()
        expect(plain.part('selection')?.dataset.shape).toBeUndefined()
      })

      it('follows each selected layer’s real outline, and outlines the shared box with the handles', () => {
        const { overlay, drawn, part } = harness({ handles: HANDLES, shaped: true, several: true })
        overlay.draw()
        expect(drawn().filter((name) => name === 'selection-member')).toHaveLength(2)
        expect(part('selection')?.dataset.shape).toBeUndefined()
        expect(part('selection-member')?.children[0]?.children[0]?.attributes.d).toBe(PATHS.a?.d)
      })

      it('outlines a layer lit from outside the stage as a hovered one', () => {
        const { overlay, part } = harness({ shaped: true, outside: true })
        overlay.draw()
        expect(part('hover')?.dataset.shape).toBe('')
      })

      it("follows the hovered layer's real outline", () => {
        const { overlay, part } = harness({ shaped: true })
        overlay.draw()
        expect(part('hover')?.dataset.shape).toBe('')
        expect(part('hover')?.children[0]?.children[0]?.attributes.d).toBe(PATHS.h?.d)
      })

      it('outlines no hovered layer that is selected', () => {
        const selected = harness({ hovered: 'a' })
        selected.overlay.draw()
        expect(selected.drawn()).not.toContain('hover')
        const beside = harness({ hovered: 'b', several: true })
        beside.overlay.draw()
        expect(beside.drawn()).not.toContain('hover')
        const other = harness({ hovered: 'b' })
        other.overlay.draw()
        expect(other.part('hover')).toBeDefined()
      })
    })

    describe('the size', () => {
      type Insets = { top: number; right: number; bottom: number; left: number }
      /**
       * Where the size is on the stage, with the page's origin at `x`, `y`: the selection 100 px
       * square from 10 px in (times the zoom), its size 70 px wide; the stage 1000 × 800.
       */
      const sizeAt = ({ insets, ...camera }: { x?: number; y?: number; zoom?: number; insets?: Insets }) => {
        const { overlay, part } = harness({ ...camera, ...(insets && { insets }) })
        overlay.draw()
        return part('selection-size')?.style
      }
      const leftOf = (x: number, insets?: Insets) => sizeAt({ x, ...(insets && { insets }) })?.left
      const topOf = (y: number, rest: { zoom?: number; insets?: Insets } = {}) => sizeAt({ y, ...rest })?.top
      const NONE = { top: 0, right: 0, bottom: 0, left: 0 }

      it('centres under the selection, kept inside the stage by 8 px at either edge', () => {
        expect(leftOf(0)).toBe('25px')
        expect(leftOf(-50)).toBe('8px')
        expect(leftOf(900)).toBe('922px')
      })

      it('keeps clear of the chrome along either side', () => {
        expect(leftOf(0, { ...NONE, left: 72 })).toBe('72px')
        expect(leftOf(880, { ...NONE, right: 72 })).toBe('858px')
      })

      it('stays clear of the chrome while any of the selection is on the stage, and goes off the stage with it', () => {
        expect(leftOf(-80, { ...NONE, left: 72 })).toBe('72px')
        expect(leftOf(-200)).toBe('-175px')
        expect(leftOf(1000)).toBe('1025px')
      })

      it('goes wholly off the stage with a selection narrower than itself', () => {
        // 10 px wide at a tenth: from 1001 px, and up to -9 px.
        expect(sizeAt({ x: 1000, zoom: 0.1 })?.left).toBe('1000px')
        expect(sizeAt({ x: -20, zoom: 0.1 })?.left).toBe('-70px')
      })

      it('goes under the selection, over it when the chrome along the bottom would cover it', () => {
        // The selection's bottom at 680 px: room under it for the dock, not for a phone's dock and tab bar,
        // where over it the size goes above its frame's label rather than on it.
        expect(topOf(570)).toBe('688px')
        expect(topOf(570, { insets: { ...NONE, bottom: 121 } })).toBe('522px')
      })

      it('keeps over the chrome along the bottom when the selection is beside it, and under the chrome along the top', () => {
        // From 740 px, in a phone's dock and tab bar 121 px tall.
        expect(topOf(730, { insets: { ...NONE, bottom: 121 } })).toBe('655px')
        // Down to 16 px, under the islands 60 px tall.
        expect(topOf(-94, { insets: { ...NONE, top: 60 } })).toBe('60px')
      })

      it('stays on the stage, over the selection, when the selection is taller than the stage', () => {
        // From -40 px to 960 px at ten times.
        expect(topOf(-140, { zoom: 10 })).toBe('704px')
      })

      it('goes wholly off the stage with a selection above or below it', () => {
        expect(topOf(-115)).toBe('-20px')
        expect(topOf(800)).toBe('800px')
      })
    })
  })

  describe('selectionRect', () => {
    it('is the box round the selection and the size label under it, the box alone while typing, none with nothing selected', () => {
      expect(harness().overlay.selectionRect()).toEqual({ x: 10, y: 110, width: 100, height: 128 })
      expect(harness({ editing: { id: 'a', frameId: 'one-sq' } }).overlay.selectionRect()).toEqual({
        x: 10,
        y: 110,
        width: 100,
        height: 100,
      })
      expect(harness({ selected: false }).overlay.selectionRect()).toBeNull()
    })
  })

  describe('labelRect', () => {
    it("is where a shown frame's label is drawn on the stage, none for a frame not shown", () => {
      const { overlay } = harness()
      expect(overlay.labelRect('one-sq')).toEqual({ x: 8, y: 76, width: 1072, height: 20 })
      expect(overlay.labelRect('gone')).toBeNull()
    })
  })
  describe('measuring', () => {
    /** From BOX to a box round it in the square, 200 × 150: a line to each side of it. */
    const MEASURED: Measured = {
      frame: SQUARE,
      from: { x: 10, y: 10, width: 100, height: 100 },
      to: { x: 0, y: 0, width: 200, height: 150 },
    }

    it('draws what Alt measures over the selection with its handles and size, and no hover outline', () => {
      const { overlay, part, drawn } = harness({ measured: MEASURED })
      overlay.draw()
      expect(drawn()).toContain('measure-box')
      expect(drawn()).not.toContain('hover')
      // The box and lines under the selection, so none crosses its outline or size label.
      expect(drawn().indexOf('measure-box')).toBeLessThan(drawn().indexOf('selection'))
      // The pills over it, so no handle covers one.
      expect(drawn().indexOf('gap-size measure-value')).toBeGreaterThan(drawn().indexOf('selection-size'))
      expect(part('selection')?.children.some((c) => c.className === 'handle')).toBe(true)
      expect(drawn()).toContain('selection-size')
    })

    it('moves a pill that would cover the size label along its line', () => {
      const { overlay, parts, part } = harness({ measured: MEASURED })
      overlay.draw()
      expect(part('selection-size')?.style).toMatchObject({ left: '25px', top: '218px' })
      // The last pill, on the line under the box, sits below the size label, 14px tall here, that it would cover at 223px.
      expect(parts('gap-size measure-value').map((p) => p.style.top)).toEqual(['153px', '153px', '98px', '234px'])
    })
  })
})
