import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanvasKit, SkPicture } from '@dazbee/canvaskit'

import { arrowheadOf } from './connectors.ts'
import { editorSurface } from './surface.ts'
import { design } from './test-design.ts'
import { editorView } from './view.ts'

/** The stroke caps the surface's paints were given. */
const strokeCaps: string[] = []

/** A CanvasKit that logs what the surface makes, draws and frees, with a canvas that logs its calls. */
function fakeCanvasKit(log: string[]) {
  const drawn = {
    clear: () => log.push('clear'),
    save: () => log.push('save'),
    restore: () => log.push('restore'),
    scale: (x: number, y: number) => log.push(`scale ${x} ${y}`),
    translate: (x: number, y: number) => log.push(`translate ${x} ${y}`),
    drawRect: (rect: number[]) => log.push(`rect ${rect.join(' ')}`),
    drawRRect: (rrect: { rect: number[]; radius: number }, paint: { colour: string }) =>
      log.push(`outline ${rrect.rect.join(' ')} round ${rrect.radius} in ${paint.colour}`),
    drawPicture: (picture: { name: string }) => log.push(`picture ${picture.name}`),
    clipRect: (rect: number[], op: string) => log.push(`clip ${op} ${rect.join(' ')}`),
    saveLayer: () => log.push('save layer'),
    drawPath: (path: { d: string }, paint: { colour: string; width: number }) =>
      log.push(`path ${path.d} in ${paint.colour}${paint.width ? ` ${paint.width} wide` : ''}`),
    drawCircle: (x: number, y: number, r: number, paint: { colour: string; width: number }) =>
      log.push(`circle ${x} ${y} round ${r} in ${paint.colour}${paint.width ? ` ${paint.width} wide` : ''}`),
  }
  /** Builds a path as words: each step's letter and points. */
  class PathBuilder {
    d: string[] = []
    moveTo(x: number, y: number) {
      this.d.push(`M ${x} ${y}`)
      return this
    }
    lineTo(x: number, y: number) {
      this.d.push(`L ${Math.round(x)} ${Math.round(y)}`)
      return this
    }
    cubicTo(...points: number[]) {
      this.d.push(`C ${points.join(' ')}`)
      return this
    }
    addCircle(x: number, y: number, r: number) {
      this.d.push(`O ${x} ${y} ${r}`)
      return this
    }
    detachAndDelete() {
      return { d: this.d.join(' '), delete: () => {} }
    }
  }
  const ck = {
    GetWebGLContext: () => 1,
    MakeWebGLContext: () => ({ delete: () => log.push('delete gl') }),
    MakeOnScreenGLSurface: (_gl: unknown, width: number, height: number) => {
      log.push(`surface ${width}×${height}`)
      return { getCanvas: () => drawn, flush: () => log.push('flush'), delete: () => log.push('delete surface') }
    },
    PathBuilder,
    Paint: class {
      colour = ''
      width = 0
      setColor(colour: string) {
        this.colour = colour
      }
      setAntiAlias() {}
      setStyle() {}
      setStrokeCap(cap: string) {
        strokeCaps.push(cap)
      }
      setStrokeWidth(width: number) {
        this.width = width
      }
      setAlphaf() {}
      setImageFilter() {}
      delete() {
        log.push('delete paint')
      }
    },
    WHITE: 'white',
    TRANSPARENT: 'clear',
    PaintStyle: { Stroke: 'stroke' },
    StrokeCap: { Round: 'round' },
    ClipOp: { Difference: 'out of' },
    ImageFilter: { MakeBlur: () => ({ delete: () => log.push('delete blur') }) },
    TileMode: { Decal: 'decal' },
    ColorSpace: { SRGB: 'srgb' },
    Color: () => 'edge',
    XYWHRect: (x: number, y: number, w: number, h: number) => [x, y, w, h],
    RRectXY: (rect: number[], radius: number) => ({ rect, radius }),
    parseColorString: (colour: string) => colour,
  }
  return ck as unknown as CanvasKit
}

/** The canvas on a stage of a size, 10 pixels from the page's corner. */
function fakeCanvas(width: number, height: number) {
  return {
    clientWidth: width,
    clientHeight: height,
    width: 300,
    height: 150,
    getBoundingClientRect: () => ({ left: 10, top: 10, x: 10, y: 10, width, height }),
  }
}

/** Animation frames waiting to run. */
let frames: Map<number, () => void>
let observed: string[]
beforeEach(() => {
  frames = new Map()
  observed = []
  let next = 0
  vi.stubGlobal('window', { devicePixelRatio: 2 })
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
    next += 1
    frames.set(next, run)
    return next
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        observed.push('observe')
      }
      disconnect() {
        observed.push('disconnect')
      }
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})
/** Runs the animation frames waiting now. */
function runFrames() {
  const waiting = [...frames.values()]
  frames.clear()
  for (const run of waiting) run()
}

/** The surface of a 1000×800 stage over the view of the test design, logging what it draws and its draws. */
function harness() {
  const log: string[] = []
  const canvas = fakeCanvas(1000, 800) as unknown as HTMLCanvasElement
  const view = editorView({ session: { design: () => design, changes: () => 0 }, onZoom: () => {} })
  const surface = editorSurface({ ck: fakeCanvasKit(log), canvas, view, draw: () => log.push('draw') })
  return { view, surface, log, canvas }
}
const picture = (name: string) => ({ name }) as unknown as SkPicture

describe('editorSurface', () => {
  describe('onStage', () => {
    it('reads a client point as a point on the stage, from the corner of the canvas', () => {
      const { surface } = harness()
      expect(surface.onStage({ x: 110, y: 60 })).toEqual({ x: 100, y: 50 })
    })
  })

  describe('screenPoint', () => {
    it("finds where a frame's pixels are on screen, the shown page's first frame by default", () => {
      const { view, surface } = harness()
      view.setCamera({ x: 100, y: 50, zoom: 2 })
      expect(surface.screenPoint(5, 6, 'one-mpu')).toEqual({ x: 10 + 100 + (2560 + 5) * 2, y: 10 + 50 + 6 * 2 })
      expect(surface.screenPoint(0, 0)).toEqual({ x: 10 + 100, y: 10 + 50 })
    })

    it('throws for a frame not on the shown page', () => {
      const { surface } = harness()
      expect(() => surface.screenPoint(0, 0, 'gone')).toThrow('no frame "gone" on the shown page')
    })
  })

  describe('scheduled and redraw', () => {
    it('draws once at the next animation frame however often it is asked', () => {
      const { view, surface, log } = harness()
      expect(surface.scheduled()).toBe(false)
      view.redraw()
      view.redraw()
      expect(surface.scheduled()).toBe(true)
      runFrames()
      expect(surface.scheduled()).toBe(false)
      expect(log).toEqual(['draw'])
    })
  })

  describe('paint', () => {
    it('draws nothing before the stage has a surface', () => {
      const { surface } = harness()
      expect(surface.paint([], null, [], [])).toBe(false)
    })

    it('draws the pictures it is handed at the camera, each on its page over white on a soft shadow, and shows them', () => {
      const { view, surface, log } = harness()
      surface.resize()
      view.setCamera({ x: 0, y: 0, zoom: 0.5 })
      log.length = 0
      const painted = surface.paint(
        view
          .findInView()
          .slice(0, 1)
          .map((frame) => ({ frame, picture: picture(frame.id) })),
        null,
        [],
        [],
      )
      expect(painted).toBe(true)
      expect(log).toEqual([
        'clear',
        'save',
        'scale 2 2',
        // The shadows, on the stage at 540 across: one 1 down, one 6 in from each side and 6 down.
        'rect 0 1 540 540',
        'rect 6 12 528 528',
        'translate 0 0',
        'scale 0.5 0.5',
        'rect 0 0 1080 1080',
        'save',
        'translate 0 0',
        'picture one-sq',
        'restore',
        'restore',
        'flush',
      ])
    })
  })

  describe('paint with outlines', () => {
    it("draws the sections' outlines first, round, in soft grey or the stage's accent while lit, so every frame covers them", () => {
      // The page's CSS names no accent here: the outline takes the accent's own colour.
      vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
      const { view, surface, log } = harness()
      surface.resize()
      view.setCamera({ x: 0, y: 0, zoom: 0.5 })
      log.length = 0
      surface.paint(
        view
          .findInView()
          .slice(0, 1)
          .map((frame) => ({ frame, picture: picture(frame.id) })),
        null,
        [
          { box: { x: -24, y: -84, width: 588, height: 648 }, lit: false },
          { box: { x: 600, y: -84, width: 100, height: 100 }, lit: true },
        ],
        [],
      )
      expect(log.slice(0, 6)).toEqual([
        'clear',
        'save',
        'scale 2 2',
        'outline -24 -84 588 648 round 22 in #c4b9cd',
        'outline 600 -84 100 100 round 22 in #2f5be0',
        'rect 0 1 540 540',
      ])
    })
  })

  describe('paint with connectors', () => {
    it('draws each connector after the outlines and before the frames: a grey curve, its arrowhead and its start dot in the canvas colour, or picked, in the accent with a dot at both ends', () => {
      vi.stubGlobal('getComputedStyle', () => ({
        getPropertyValue: (name: string) => (name === '--canvas' ? '#100d14' : ''),
      }))
      const { view, surface, log } = harness()
      surface.resize()
      view.setCamera({ x: 0, y: 0, zoom: 0.5 })
      log.length = 0
      const curve = { from: { x: 10, y: 50 }, c1: { x: 60, y: 50 }, c2: { x: 60, y: 90 }, to: { x: 110, y: 90 } }
      surface.paint(
        view
          .findInView()
          .slice(0, 1)
          .map((frame) => ({ frame, picture: picture(frame.id) })),
        null,
        [{ box: { x: -24, y: -84, width: 588, height: 648 }, lit: false }],
        [
          { curve, picked: false },
          { curve: { ...curve, from: { x: 10, y: 150 }, to: { x: 110, y: 150 } }, picked: true },
          // Wholly off the stage: left out.
          {
            curve: { from: { x: -500, y: 0 }, c1: { x: -400, y: 0 }, c2: { x: -300, y: 0 }, to: { x: -200, y: 0 } },
            picked: false,
          },
        ],
      )
      // Each line stops at its arrowhead's base.
      const { line, head } = arrowheadOf(curve)
      const { c1, c2, to } = line
      expect(log.slice(3, 12)).toEqual([
        'outline -24 -84 588 648 round 22 in #c4b9cd',
        // The grey ones together: their curves, their arrowheads, and their start dots filled, then ringed.
        `path M 10 50 C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y} in #574c61 1.5 wide`,
        `path M 110 90 L ${Math.round(head.left.x)} ${Math.round(head.left.y)} L ${Math.round(head.right.x)} ${Math.round(head.right.y)} in #574c61`,
        'path O 10 50 3.5 in #100d14',
        'path O 10 50 3.5 in #574c61 1.5 wide',
        // Then the picked one, in the accent, with a dot at both ends.
        expect.stringMatching(/^path M 10 150 C .* in #2f5be0 2 wide$/),
        expect.stringMatching(/^path M 110 150 L .* in #2f5be0$/),
        'path O 10 150 5 O 110 150 5 in #100d14',
        'path O 10 150 5 O 110 150 5 in #2f5be0 2 wide',
      ])
      expect(log[12]).toBe('rect 0 1 540 540')
    })
  })

  describe('the connectors’ line', () => {
    it('has round ends', () => {
      strokeCaps.length = 0
      harness()
      expect(strokeCaps).toEqual(['round'])
    })
  })

  describe("the frames' shadow", () => {
    it('is as far down and as soft on the stage at any zoom, wherever the camera is', () => {
      const shadowsAt = (camera: { x: number; y: number; zoom: number }) => {
        const { view, surface, log } = harness()
        surface.resize()
        view.setCamera(camera)
        log.length = 0
        surface.paint(
          view
            .findInView()
            .slice(0, 1)
            .map((frame) => ({ frame, picture: picture(frame.id) })),
          null,
          [],
          [],
        )
        return log.slice(3, 5)
      }
      expect(shadowsAt({ x: 0, y: 0, zoom: 0.15 })).toEqual(['rect 0 1 162 162', 'rect 6 12 150 150'])
      expect(shadowsAt({ x: 40, y: 30, zoom: 2 })).toEqual(['rect 40 31 2160 2160', 'rect 46 42 2148 2148'])
    })
  })

  describe('paint with a ghost', () => {
    it('draws the ghost after the frames, faintly and only past the edge of its frame', () => {
      const { view, surface, log } = harness()
      surface.resize()
      view.setCamera({ x: 0, y: 0, zoom: 0.5 })
      const story = view.frameOf('one-story')
      log.length = 0
      surface.paint(
        view.findInView().map((frame) => ({ frame, picture: picture(frame.id) })),
        story ? { frame: story, picture: picture('ghost') } : null,
        [],
        [],
      )
      expect(log.slice(-9)).toEqual([
        'save',
        'clip out of 1280 0 1080 1920',
        'save layer',
        'translate 1280 0',
        'picture ghost',
        'restore',
        'restore',
        'restore',
        'flush',
      ])
    })
  })

  describe('showArea', () => {
    it('pans a part of the canvas that lies under a panel, at their places on the page, clear of it', () => {
      const { view, surface } = harness()
      surface.resize()
      view.setCamera({ x: 400, y: 100, zoom: 1 })
      const before = view.camera()
      const area = { x: 0, y: 0, width: 400, height: 300 }
      surface.showArea(area, { x: 610, y: 610, width: 300, height: 150 })
      expect(view.camera()).toBe(before)
      surface.showArea(area, { x: 610, y: 110, width: 300, height: 400 })
      expect(view.camera().x + area.width).toBeLessThanOrEqual(600)
    })
  })

  describe('resize', () => {
    it("matches the canvas's backing store to the screen's pixels, making the surface again only when they change", () => {
      const { view, surface, log, canvas } = harness()
      expect(observed).toEqual(['observe'])
      surface.resize()
      expect(canvas).toMatchObject({ width: 2000, height: 1600 })
      expect(view.viewport()).toEqual({ width: 1000, height: 800 })
      surface.resize()
      expect(log).toEqual(['surface 2000×1600'])
      expect(surface.scheduled()).toBe(true)
    })
  })

  describe('destroy', () => {
    it('stops watching the stage and the next frame, and frees what it made', () => {
      const { surface, log } = harness()
      surface.resize()
      surface.destroy()
      runFrames()
      expect(observed).toEqual(['observe', 'disconnect'])
      expect(log).toEqual([
        'surface 2000×1600',
        'delete surface',
        'delete paint',
        'delete paint',
        'delete paint',
        'delete paint',
        'delete paint',
        'delete blur',
        'delete paint',
        'delete blur',
        'delete paint',
        'delete gl',
      ])
    })

    it('stops listening to the view: a redraw asked for after it waits for no animation frame and draws nothing', () => {
      const { view, surface, log } = harness()
      surface.destroy()
      log.length = 0
      view.redraw()
      expect(frames.size).toBe(0)
      expect(surface.scheduled()).toBe(false)
      runFrames()
      expect(log).toEqual([])
    })
  })
})
