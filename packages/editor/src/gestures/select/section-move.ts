// Moving a section by a drag on its title: its frames go where the pointer takes them, each to whole
// design pixels (`section.move`), and the whole drag is one undo step called `move`.
import type { GestureStep, Session } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'

import { runQuietly } from '../../run-quietly.ts'

/** A section being moved, from the press on its title until it is let go. */
export interface SectionMoveDrag {
  kind: 'sectionMove'
  sectionId: string
  /** Where the press went down, in world units. */
  from: Point
  /** How far the drag has moved the section so far, in whole design pixels. */
  moved: Point
  /** Ends the drag's undo step; null until the drag first moves the section. */
  step: GestureStep | null
}

export interface SectionMoveDeps {
  session: Pick<Session, 'run' | 'beginGesture'>
}

export interface EditorSectionMove {
  /** The drag a press on a section's title starts, at `world` on the page. */
  start(sectionId: string, world: Point): SectionMoveDrag
  /**
   * Follows the pointer, once the press is a drag: the section's frames move by as much as the
   * pointer did, in whole design pixels; Shift keeps them to the axis it went furthest along.
   */
  drag(g: SectionMoveDrag, world: Point, shift: boolean): void
  /** Ends the drag, closing its undo step. */
  release(g: SectionMoveDrag): void
}

export function editorSectionMove({ session }: SectionMoveDeps): EditorSectionMove {
  function start(sectionId: string, world: Point): SectionMoveDrag {
    return { kind: 'sectionMove', sectionId, from: world, moved: { x: 0, y: 0 }, step: null }
  }
  function drag(g: SectionMoveDrag, world: Point, shift: boolean) {
    let dx = Math.round(world.x - g.from.x)
    let dy = Math.round(world.y - g.from.y)
    if (shift && Math.abs(dx) >= Math.abs(dy)) dy = 0
    else if (shift) dx = 0
    const by = { dx: dx - g.moved.x, dy: dy - g.moved.y }
    if (by.dx === 0 && by.dy === 0) return
    g.step ??= session.beginGesture('move')
    // Another tab may delete the section mid-drag; the drag then just leaves it be.
    if (runQuietly(() => session.run('section.move', { sectionId: g.sectionId, ...by }))) g.moved = { x: dx, y: dy }
  }
  function release(g: SectionMoveDrag) {
    g.step?.end()
  }

  return {
    start,
    drag,
    release,
  }
}
