import { expect } from 'vitest'
import type { z } from 'zod'

import { type DesignInput, type Shape, type TextLook } from '@dazbee/schema'

import { CommandFault, openSession, type Session, type SessionOptions } from './session.ts'
import type { DesignStore } from './store.ts'
import { brokenDocument, expectInvariants, tiedIndexes } from './test-invariants.ts'

const white = [{ type: 'solid' as const, color: '#FFFFFFFF' }]

const boxProps = {
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  shape: { kind: 'rect' as const },
  fills: [{ type: 'solid' as const, color: '#FF5A36FF' }],
}

/** A brand text style's look, as the kit gives it: what tests bind a text's text style to. */
export const HEADLINE_LOOK: TextLook = {
  fontFamily: 'Playfair Display',
  fontWeight: 700,
  fontStyle: 'normal',
  lineHeight: 1.1,
  letterSpacing: { unit: 'percent', value: -1 },
  textCase: 'upper',
}

const headlineProps = {
  x: 60,
  y: 600,
  width: 960,
  height: 100,
  text: 'Summer sale',
  style: { fontFamily: 'Noto Sans', fontSize: 84, color: '#111111FF' },
  runs: [{ start: 7, end: 11, style: { fontWeight: 800 } }],
}

/**
 * A small design for tests: one page with a square and a banner frame, linked. The square holds a
 * box and a headline; the banner holds their copies, the headline's with its own text and place.
 */
export const testDesign = (): DesignInput => ({
  meta: { designId: 'd1', name: 'Test' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, fills: white, order: 'a0' },
    banner: { pageId: 'p1', name: 'Banner', width: 320, height: 50, x: 1280, y: 0, fills: white, order: 'a1' },
  },
  nodes: {
    box: { type: 'graphic', parentId: 'sq', link: 'box', index: 'a0', name: 'Box', props: boxProps },
    headline: {
      type: 'text',
      parentId: 'sq',
      link: 'headline',
      index: 'a1',
      name: 'Headline',
      role: 'headline',
      props: headlineProps,
    },
    'banner-box': { type: 'graphic', parentId: 'banner', link: 'box', index: 'a0', name: 'Box', props: boxProps },
    'banner-headline': {
      type: 'text',
      parentId: 'banner',
      link: 'headline',
      index: 'a1',
      name: 'Headline',
      role: 'headline',
      props: { ...headlineProps, text: 'Sale', x: 4, runs: [] },
    },
  },
})

/**
 * Three shapes (a rect with its own corners, a star, a triangle) and a text, in a square frame,
 * and their linked copies in a wide frame, where the star sits further right.
 */
export const shapesDesign = (): DesignInput => ({
  meta: { designId: 'd1', name: 'Booleans' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    a: shape({ parentId: 'sq', link: 'a', index: 'a0' }, 100, { kind: 'rect', corners: [0, 10, 20, 30] }, '#FF0000FF'),
    b: shape({ parentId: 'sq', link: 'b', index: 'a1' }, 150, { kind: 'star', points: 6 }, '#00FF00FF'),
    c: shape({ parentId: 'sq', link: 'c', index: 'a2' }, 400, { kind: 'polygon', sides: 3 }, '#0000FFFF'),
    t: text({ parentId: 'sq', link: 't', index: 'a3' }),
    'wide-a': shape(
      { parentId: 'wide', link: 'a', index: 'a0' },
      100,
      { kind: 'rect', corners: [0, 10, 20, 30] },
      '#FF0000FF',
    ),
    'wide-b': shape({ parentId: 'wide', link: 'b', index: 'a1' }, 300, { kind: 'star', points: 6 }, '#00FF00FF'),
    'wide-c': shape({ parentId: 'wide', link: 'c', index: 'a2' }, 400, { kind: 'polygon', sides: 3 }, '#0000FFFF'),
    'wide-t': text({ parentId: 'wide', link: 't', index: 'a3' }),
  },
})

/**
 * Linked frames on one page, as Duplicate and Add size leave them, and one more of each kind. The
 * square holds a background, a group of a title and a price, and a badge; the story holds copies
 * of the background and of the group with the title only; the wide frame holds copies of the
 * background, title and price at its top level; the tall frame holds a copy of the background
 * only. The other frame on the page is linked to none of them, and a second page holds a layer
 * with the background's link id, which never counts.
 */
export const linkedDesign = (): DesignInput => {
  type At = { parentId: string; link: string; index: string }
  type Area = { x: number; y: number; width: number; height: number }
  const rect = (at: At, box: Area) => ({
    type: 'graphic' as const,
    ...at,
    name: at.link,
    props: { ...box, shape: { kind: 'rect' as const }, fills: [{ type: 'solid' as const, color: '#FF5A36FF' }] },
  })
  const words = (at: At, box: Area, size = 60) => ({
    type: 'text' as const,
    ...at,
    name: at.link,
    props: { ...box, text: at.link, style: { fontFamily: 'Noto Sans', fontSize: size, color: '#111111FF' } },
  })
  const group = (at: At, box: Area) => ({
    type: 'group' as const,
    ...at,
    name: 'Group',
    props: box,
  })
  const frame = (name: string, order: string, width: number, height: number, x: number, pageId = 'p1') => ({
    pageId,
    name,
    width,
    height,
    x,
    y: 0,
    order,
  })
  const full = (width: number, height: number) => ({ x: 0, y: 0, width, height })
  return {
    meta: { designId: 'd1', name: 'Linked' },
    pages: { p1: { name: 'Page 1', order: 'a0' }, p2: { name: 'Page 2', order: 'a1' } },
    frames: {
      sq: frame('Square', 'a0', 1080, 1080, 0),
      story: frame('Story', 'a1', 1080, 1920, 1280),
      wide: frame('Wide', 'a2', 1200, 628, 2560),
      tall: frame('Tall', 'a3', 300, 600, 3960),
      other: frame('Other', 'a4', 500, 500, 4460),
      far: frame('Far', 'a0', 1080, 1080, 0, 'p2'),
    },
    nodes: {
      bg: rect({ parentId: 'sq', link: 'bg', index: 'a0' }, full(1080, 1080)),
      grp: group({ parentId: 'sq', link: 'grp', index: 'a1' }, { x: 100, y: 100, width: 600, height: 300 }),
      title: words({ parentId: 'grp', link: 'title', index: 'a0' }, { x: 100, y: 100, width: 600, height: 100 }),
      price: words({ parentId: 'grp', link: 'price', index: 'a1' }, { x: 100, y: 300, width: 200, height: 100 }),
      badge: rect({ parentId: 'sq', link: 'badge', index: 'a2' }, { x: 900, y: 40, width: 120, height: 120 }),
      'story-bg': rect({ parentId: 'story', link: 'bg', index: 'a0' }, full(1080, 1920)),
      'story-grp': group({ parentId: 'story', link: 'grp', index: 'a1' }, { x: 100, y: 400, width: 600, height: 100 }),
      'story-title': words(
        { parentId: 'story-grp', link: 'title', index: 'a0' },
        { x: 100, y: 400, width: 600, height: 100 },
      ),
      'wide-bg': rect({ parentId: 'wide', link: 'bg', index: 'a0' }, full(1200, 628)),
      'wide-title': words(
        { parentId: 'wide', link: 'title', index: 'a1' },
        { x: 40, y: 40, width: 400, height: 60 },
        40,
      ),
      'wide-price': words(
        { parentId: 'wide', link: 'price', index: 'a2' },
        { x: 40, y: 200, width: 150, height: 60 },
        40,
      ),
      'tall-bg': rect({ parentId: 'tall', link: 'bg', index: 'a0' }, full(300, 600)),
      'other-x': rect({ parentId: 'other', link: 'x', index: 'a0' }, full(500, 500)),
      'far-bg': rect({ parentId: 'far', link: 'bg', index: 'a0' }, full(1080, 1080)),
    },
  }
}

/**
 * The linked design with sections, connectors and a star: the square and the story in section
 * "ads", the wide frame in section "banners", a connector from the square to the story and one
 * from the "ads" section to the wide frame; the story is starred. The second page holds a section
 * of its own frame.
 */
export const sectionedDesign = (): DesignInput => {
  const design = linkedDesign()
  const frames = design.frames as Record<string, Record<string, unknown>>
  return {
    ...design,
    frames: {
      ...design.frames,
      sq: { ...frames.sq, sectionId: 'ads' },
      story: { ...frames.story, sectionId: 'ads', starred: true },
      wide: { ...frames.wide, sectionId: 'banners' },
      far: { ...frames.far, sectionId: 'far-section' },
    } as unknown as DesignInput['frames'],
    sections: {
      ads: { pageId: 'p1', title: 'Ads', order: 'a0' },
      banners: { pageId: 'p1', title: 'Banners', order: 'a1' },
      'far-section': { pageId: 'p2', title: 'Far', order: 'a0' },
    },
    connectors: {
      'sq-story': { pageId: 'p1', from: 'sq', to: 'story', order: 'a0' },
      'ads-wide': { pageId: 'p1', from: 'ads', to: 'wide', order: 'a1' },
    },
  }
}

/**
 * One frame holding each layer type and state: a locked background, a turned and a hidden shape, a
 * path, a turned group of a text and a shape, a row box of two shapes with a third out of its flow,
 * a Free box of one shape, a group whose first layer masks the next, a boolean of two shapes, and a
 * text with a run. The frame has a vertical and a horizontal guide.
 */
export const kindsDesign = (): DesignInput => {
  const at = (parentId: string, id: string, index: string) => ({ parentId, link: id, index })
  const rect = { kind: 'rect' as const }
  const area = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
  const locked = { move: true, resize: true, content: true, style: true, delete: true }
  const turned = shape(at('f', 'turned', 'a1'), 300, rect, '#00FF00FF')
  const hidden = shape(at('f', 'hidden', 'a2'), 450, { kind: 'ellipse' }, '#0000FFFF')
  const outOfFlow = shape(at('row', 'r-abs', 'a2'), 40, rect, '#222222FF')
  const mask = shape(at('masks', 'mask', 'a0'), 600, { kind: 'ellipse' }, '#000000FF')
  return {
    meta: { designId: 'd1', name: 'Kinds' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p1',
        name: 'Frame',
        width: 1080,
        height: 1080,
        x: 0,
        y: 0,
        fills: white,
        order: 'a0',
        guides: [
          { axis: 'x', at: 540 },
          { axis: 'y', at: 300 },
        ],
      },
    },
    nodes: {
      bg: { ...shape(at('f', 'bg', 'a0'), 0, rect, '#FFFFFFFF'), lock: locked },
      turned: { ...turned, props: { ...turned.props, rotation: 30 } },
      hidden: { ...hidden, props: { ...hidden.props, visible: false } },
      path: shape(at('f', 'path', 'a3'), 600, { kind: 'path', d: 'M0 0L100 0L50 100Z' }, '#FF00FFFF'),
      grp: {
        type: 'group',
        ...at('f', 'grp', 'a4'),
        name: 'Group',
        props: { ...area(0, 300, 300, 140), rotation: 15 },
      },
      'g-text': text(at('grp', 'g-text', 'a0')),
      'g-rect': shape(at('grp', 'g-rect', 'a1'), 200, rect, '#FF5A36FF'),
      row: {
        type: 'box',
        ...at('f', 'row', 'a5'),
        name: 'Row',
        props: {
          ...area(400, 300, 220, 100),
          layout: { direction: 'row', gap: 20 },
          sizing: { width: 'hug', height: 'hug' },
        },
      },
      r1: shape(at('row', 'r1', 'a0'), 400, rect, '#111111FF'),
      r2: shape(at('row', 'r2', 'a1'), 520, rect, '#333333FF'),
      'r-abs': { ...outOfFlow, props: { ...outOfFlow.props, absolute: true } },
      free: { type: 'box', ...at('f', 'free', 'a6'), name: 'Free', props: area(700, 300, 200, 200) },
      f1: shape(at('free', 'f1', 'a0'), 720, rect, '#444444FF'),
      masks: { type: 'group', ...at('f', 'masks', 'a7'), name: 'Mask group', props: area(600, 100, 200, 100) },
      mask: { ...mask, props: { ...mask.props, mask: 'alpha' } },
      masked: shape(at('masks', 'masked', 'a1'), 700, rect, '#FFC400FF'),
      bool: { type: 'boolean', ...at('f', 'bool', 'a8'), name: 'Union', props: area(100, 600, 150, 100) },
      b1: shape(at('bool', 'b1', 'a0'), 100, rect, '#FF0000FF'),
      b2: shape(at('bool', 'b2', 'a1'), 150, { kind: 'ellipse' }, '#00FF00FF'),
      words: {
        type: 'text',
        ...at('f', 'words', 'a9'),
        name: 'Words',
        role: 'headline',
        props: { ...headlineProps, y: 800 },
      },
    },
  }
}

/** A shape to add with node.create. */
export const badge = {
  type: 'graphic',
  name: 'Badge',
  props: {
    x: 900,
    y: 40,
    width: 120,
    height: 120,
    shape: { kind: 'ellipse' },
    fills: [{ type: 'solid', color: '#FFC400FF' }],
  },
} as const

/**
 * A session whose run, undo, redo, batch and gesture check the invariants on the design after
 * each. A command run on a document with nothing wrong (test-invariants.ts) must leave one with
 * nothing wrong, whether it ran, was refused or faulted; a fault puts back its whole step, so after
 * one in a gesture, the document must be as sound as when the gesture began.
 */
export function openTestSession(store: DesignStore, options?: SessionOptions): Session {
  const session = openSession(store, options)
  const check = () => expectInvariants(session.design())
  /** Whether nothing was wrong with the document after this session's last command, with nothing changed since. */
  let knownSound = false
  /** Whether nothing was wrong with the document when the open gesture began. */
  let soundAtGesture = false
  let running = false
  const changed = () => {
    if (!running) knownSound = false
  }
  const stopWatching = store.onChange(changed)
  const run: Session['run'] = (name, input) => {
    // Inside a batch every command reads the design from before it, so only the batch as a whole counts.
    const wasSound = !store.inTransaction() && (knownSound || brokenDocument(store).length === 0)
    const inGesture = session.inGesture()
    const layers = { ...session.design().nodes }
    /** Checks the design after the command, given what it threw, if anything. */
    const after = (thrown?: unknown) => {
      running = false
      check()
      // A command that threw inserted and moved nothing: its step is as it was, or as before it.
      if (thrown === undefined)
        expect(tiedIndexes(layers, session.design()), `${name} left layers of one parent with one index`).toEqual([])
      if (!(thrown instanceof CommandFault && inGesture ? soundAtGesture : wasSound)) return
      const broken = brokenDocument(store)
      if (broken.length > 0) throw new Error(`${name} left a document with something wrong:\n${broken.join('\n')}`)
      knownSound = true
    }
    running = true
    try {
      const result = session.run(name, input)
      after()
      return result
    } catch (error) {
      if (running) after(error)
      throw error
    }
  }
  /** Notes whether the document is sound as a gesture begins, unless one is open already. */
  const noteGesture = () => {
    if (!session.inGesture()) soundAtGesture = knownSound || brokenDocument(store).length === 0
  }
  const checked =
    <A extends unknown[], R>(f: (...args: A) => R) =>
    (...args: A): R => {
      const result = f(...args)
      check()
      return result
    }
  return {
    ...session,
    run,
    undo: checked(session.undo),
    redo: checked(session.redo),
    batch: (...args) => checked(session.batch)(...args),
    gesture: (...args) => {
      noteGesture()
      return checked(session.gesture)(...args)
    },
    beginGesture: (name) => {
      noteGesture()
      const step = session.beginGesture(name)
      return { end: checked(step.end), cancel: checked(step.cancel) }
    },
    destroy: () => {
      stopWatching()
      session.destroy()
    },
  }
}

/** What a call throws; it fails the test when the call throws nothing. */
export function thrownBy(call: () => unknown): unknown {
  try {
    call()
  } catch (error) {
    return error
  }
  throw new Error('nothing was thrown')
}

/** A shape in its frame at `x`, filled with one colour. */
function shape(
  at: { parentId: string; link: string; index: string },
  x: number,
  kind: z.input<typeof Shape>,
  color: string,
) {
  return {
    type: 'graphic' as const,
    ...at,
    name: `Shape ${at.index}`,
    props: { x, y: 100, width: 100, height: 100, shape: kind, fills: [{ type: 'solid' as const, color }] },
  }
}

/** A short text at the frame's corner. */
function text(at: { parentId: string; link: string; index: string }) {
  return {
    type: 'text' as const,
    ...at,
    name: 'Text',
    props: {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      text: 'Hi',
      style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
    },
  }
}
