import { describe, expect, it } from 'vitest'

import type { SkPicture } from '@dazbee/canvaskit'
import type { Session } from '@dazbee/doc'
import { makeResources, type Resources } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import type { DrawInfo, NoticeDetail } from '../core-interface.ts'
import type { Gesture } from '../gestures/pointer.ts'
import { editorLeftOut } from '../layers-left-out.ts'
import type { EditorResources } from '../resources.ts'
import type { Frame } from './frames.ts'
import { editorRedraw, type Paint, type RedrawDeps } from './redraw.ts'
import { frameScenes } from './scenes.ts'
import { design } from './test-design.ts'

const SQUARE: Frame = { id: 'one-sq', pageId: 'one', name: 'Sale', x: 0, y: 0, width: 1080, height: 1080 }
const STORY: Frame = { id: 'one-story', pageId: 'one', name: 'Story', x: 1280, y: 0, width: 1080, height: 1920 }
/** What the screen draws with, by identity. */
const SCREEN = {} as Resources
const picture = (name: string) => ({ name }) as unknown as SkPicture

/** The scenes that log what they are asked and give pictures by name, and the resources they are asked with. */
function loggedScenes(log: string[], outlinePaths: () => number): Pick<RedrawDeps, 'scenes' | 'resources'> {
  return {
    resources: {
      screen: (current, frameIds) => {
        // The screen is asked for the images of the shown frames only.
        const shownFrames = frameIds?.join() === [SQUARE, STORY].map((f) => f.id).join()
        log.push(
          `${current === design ? 'screen' : 'screen of another design'}${shownFrames ? '' : ' of other frames'}`,
        )
        return SCREEN
      },
      show: (uses, pixelsPerUnit) => log.push(`show ${uses.size} images at ${pixelsPerUnit}`),
    },
    scenes: {
      shownScene: (frame) => ({ frameId: frame.id, width: frame.width, height: frame.height, fills: [], layers: [] }),
      pictures: (all, inView, screen) => {
        log.push(`pictures ${inView.map((f) => f.id).join()} of ${all.length}${screen === SCREEN ? '' : ' unscreened'}`)
        return { pictures: inView.map((frame) => ({ frame, picture: picture(frame.id) })), recorded: 1 }
      },
      ghost: (frame, ids, screen) => {
        log.push(`ghost ${ids.join()} in ${frame.id}${screen === SCREEN ? '' : ' unscreened'}`)
        return picture('ghost')
      },
      outlinePaths,
    },
  }
}

/**
 * The redraw pass over modules that log what they are asked, in order: a page of two frames with the
 * square in view, one picture recorded, and two outline paths made while what is shown is built.
 * `gesture` is the drag held; `leftOut` the layers the design leaves out; `drawing` the scenes and
 * resources the pass records with, in place of the logged ones.
 */
function harness({
  gesture = null,
  leftOut = 0,
  drawing,
}: { gesture?: Gesture | null; leftOut?: number; drawing?: Pick<RedrawDeps, 'scenes' | 'resources'> } = {}) {
  const log: string[] = []
  const reports: DrawInfo[] = []
  let outlinePaths = 0
  const deps: RedrawDeps = {
    ...(drawing ?? loggedScenes(log, () => outlinePaths)),
    view: {
      update: () => log.push('update'),
      design: () => design,
      previewed: () => design,
      frames: () => [SQUARE, STORY],
      camera: () => ({ x: 0, y: 0, zoom: 0.5 }),
      dpr: () => 2,
      findInView: () => {
        log.push('find in view')
        return [SQUARE]
      },
      inView: () => [SQUARE],
      redraw: () => log.push('redraw asked'),
    },
    selection: {
      keep: () => log.push('keep'),
      tellListeners: () => log.push('tell listeners'),
      pickedSection: () => null,
    },
    typing: { stopWhenGone: () => log.push('stop when gone') },
    pointer: {
      gesture: () => gesture,
      rehover: () => {
        log.push('rehover')
        return false
      },
    },
    sections: () => ({ outlines: [], lit: null }),
    leftOut: editorLeftOut({
      session: { leftOut: () => Array.from({ length: leftOut }, () => ({ part: 'layer' })) } as unknown as Session,
      listening: () => true,
      notify: (...told: NoticeDetail<'layersLeftOut'>) => log.push(`notice ${JSON.stringify(told)}`),
    }),
    report: (drawn, _at, info) => {
      log.push(drawn === design ? 'report' : 'report of another design')
      reports.push(info)
    },
  }
  const pass = editorRedraw(deps)
  pass.onShown(() => {
    outlinePaths += 2
    log.push('shown')
  })
  /** A paint that logs what it is handed and answers `painted`. */
  const paint =
    (painted: boolean): Paint =>
    (pictures, ghost) => {
      const names = pictures.map((p) => (p.picture as unknown as { name: string }).name).join()
      log.push(`paint ${names}${ghost ? ` and ${(ghost.picture as unknown as { name: string }).name}` : ''}`)
      return painted
    }
  return { pass, log, reports, paint }
}

const BEFORE_PICTURES = ['update', 'keep', 'stop when gone', 'find in view', 'show 0 images at 1', 'screen']
const BEFORE_PAINT = [...BEFORE_PICTURES, 'pictures one-sq of 2']
const AFTER_PAINT = ['rehover', 'shown', 'tell listeners', 'report']

describe('editorRedraw', () => {
  describe('redraw', () => {
    it('runs the whole pass in order with no paint, and gives what it did', () => {
      const { pass, log, reports } = harness()
      const info = pass.redraw()
      expect(log).toEqual([...BEFORE_PAINT, ...AFTER_PAINT])
      expect(info).toMatchObject({ outlined: 2, drawn: 1, frames: 2, recorded: 1 })
      expect(info?.ms).toBeGreaterThanOrEqual(0)
      expect(reports).toEqual([info])
    })

    it('hands the pictures to a paint between recording them and checking the hover', () => {
      const { pass, log, reports, paint } = harness()
      const info = pass.redraw(paint(true))
      expect(log).toEqual([...BEFORE_PAINT, 'paint one-sq', ...AFTER_PAINT])
      expect(reports).toEqual([info])
    })

    it('stops once a paint answers false: no hover check, nothing shown, no listener told and no report', () => {
      const { pass, log, reports, paint } = harness({ leftOut: 1 })
      expect(pass.redraw(paint(false))).toBeNull()
      expect(log).toEqual([...BEFORE_PAINT, 'paint one-sq'])
      expect(reports).toEqual([])
    })

    it("records what a move carries before the frames' pictures and hands both to the paint, asking for the resources once", () => {
      const gesture = { kind: 'move', frame: SQUARE, roots: ['a', 'b'] } as unknown as Gesture
      const { pass, log, paint } = harness({ gesture })
      pass.redraw(paint(true))
      expect(log).toEqual([
        ...BEFORE_PICTURES,
        'ghost a,b in one-sq',
        'pictures one-sq of 2',
        'paint one-sq and ghost',
        ...AFTER_PAINT,
      ])
      expect(log.filter((line) => line === 'screen')).toHaveLength(1)
    })

    it("hands a paint pictures it can draw, the frames' and the ghost, while the brand kit's variables are a new object each time they are read", async () => {
      const ck = await loadCanvasKit()
      const screen = makeResources(ck, { fonts: [], fallbackFamilies: [], images: {} })
      const resources = {
        resources: () => screen,
        bytes: () => ({ variables: {} }),
        alpha: () => undefined,
        onArrive: () => () => true,
      } as unknown as EditorResources
      const scenes = frameScenes({ ck, resources, drawn: () => design, changes: () => 0 })
      const gesture = { kind: 'move', frame: SQUARE, roots: [] } as unknown as Gesture
      const { pass } = harness({ gesture, drawing: { scenes, resources: { screen: () => screen, show: () => {} } } })
      const surface = ck.MakeSurface(16, 16)
      if (!surface) throw new Error('no surface')
      let drawn = 0
      const info = pass.redraw((pictures, ghost) => {
        for (const { picture } of [...pictures, ...(ghost ? [ghost] : [])]) {
          surface.getCanvas().drawPicture(picture)
          drawn++
        }
        return true
      })
      expect(drawn).toBe(2)
      expect(info).toMatchObject({ recorded: 1 })
      surface.delete()
      scenes.destroy()
    })

    it('records nothing for a drag that carries no layer', () => {
      const gesture = { kind: 'marquee' } as unknown as Gesture
      const { pass, log } = harness({ gesture })
      pass.redraw()
      expect(log).toEqual([...BEFORE_PAINT, ...AFTER_PAINT])
    })

    it('asks for the resources once in each redraw', () => {
      const { pass, log } = harness()
      pass.redraw()
      pass.redraw()
      expect(log.filter((line) => line === 'screen')).toHaveLength(2)
    })

    it('tells the page of the layers the design leaves out last, with no paint, and once however often it runs', () => {
      const { pass, log } = harness({ leftOut: 2 })
      pass.redraw()
      expect(log).toEqual([...BEFORE_PAINT, ...AFTER_PAINT, 'notice ["layersLeftOut",{"layers":2}]'])
      pass.redraw()
      expect(log.filter((line) => line.startsWith('notice'))).toHaveLength(1)
    })
  })

  describe('shownChanged', () => {
    it("raises onShown, then tells the selection's listeners, and nothing else", () => {
      const { pass, log } = harness()
      pass.shownChanged()
      expect(log).toEqual(['shown', 'tell listeners'])
    })

    it("tells the selection's listeners once in a redraw, as once by itself", () => {
      const { pass, log } = harness()
      pass.redraw()
      expect(log.filter((line) => line === 'tell listeners')).toHaveLength(1)
      pass.shownChanged()
      expect(log.filter((line) => line === 'tell listeners')).toHaveLength(2)
    })
  })

  describe('onShown', () => {
    it('stops telling a listener that stopped listening, and still tells the selection', () => {
      const { pass, log } = harness()
      const heard: string[] = []
      const stop = pass.onShown(() => heard.push('heard'))
      pass.shownChanged()
      stop()
      pass.shownChanged()
      expect(heard).toEqual(['heard'])
      expect(log.filter((line) => line === 'tell listeners')).toHaveLength(2)
    })
  })
})
