// The actions' stage with the real pointer, select press, drags and drawing on it, for the tests.
import type { NoticeDetail } from './core-interface.ts'
import { watchFaults } from './faults.ts'
import { editorFrameActions } from './frame-actions.ts'
import { editorDragStart } from './gestures/drag-start.ts'
import { editorDrawing } from './gestures/drawing/drawing.ts'
import { editorHold } from './gestures/hold.ts'
import type { PointerInput } from './gestures/inputs.ts'
import { editorPointer } from './gestures/pointer.ts'
import { editorFrameMove } from './gestures/select/frame-move.ts'
import { editorFrameResize } from './gestures/select/frame-resize.ts'
import { editorSectionMove } from './gestures/select/section-move.ts'
import { editorSelectPress } from './gestures/select/select-press.ts'
import { harness } from './test-actions.ts'
import type { PlacedAsset, Tool } from './tools.ts'

/** The image the image tool places: 400 by 200 pixels. */
export const PHOTO: PlacedAsset = { id: 'a1', name: 'Photo', width: 400, height: 200 }

/**
 * The actions' stage with the real pointer and drawing on it, at zoom 1 with the square frame at
 * the origin, so stage points are its design pixels; a tool in use, the select tool unless told
 * another, and the image tool placing PHOTO; a fault drops the pointer's drag.
 */
export function stage(first: Tool = 'select') {
  const { session, selection, boxes, frame, transformDrag, autoLayoutDrag } = harness()
  const hold = editorHold()
  /** The tool in use, which drawing sets back to select. */
  let tool = first
  const tools = {
    tool: () => tool,
    setTool: (next: Tool) => {
      tool = next
    },
    imageToPlace: () => (tool === 'image' ? PHOTO : null),
    snapping: () => false,
  }
  const camera = () => ({ x: 0, y: 0, zoom: 1 })
  const view = {
    camera,
    design: () => session.design(),
    frames: () => [frame],
    frameOf: (key: string | undefined) => (key === frame.id ? frame : undefined),
    setCamera: () => {},
    stopGlide: () => {},
    viewport: () => ({ width: 1000, height: 800 }),
    zoomTo: () => {},
    redraw: () => {},
    pointOn: (stage: { x: number; y: number }) => ({ frame, p: stage }),
  }
  const typing = {
    editing: () => null,
    caretFromPoint: () => 0,
    caretTo: () => {},
    selectText: () => {},
    start: (_id: string, _frame: string, _offset: number, endGesture?: () => void) => endGesture?.(),
    stop: () => {},
  }
  const frameName = (width: number, height: number) => `${width} by ${height}`
  const frameMove = editorFrameMove({ session, view })
  const sectionMove = editorSectionMove({ session })
  const drawing = editorDrawing({
    hold: hold.hold,
    session,
    selection,
    tools,
    typing,
    boxes,
    page: () => 'p1',
    frames: () => [frame],
    camera,
    frameMove,
    frameName,
    frameActions: editorFrameActions({
      session,
      view: { page: () => 'p1', showWhole: () => {} },
      tools,
      frameName,
      selection,
      typing: { fitText: () => {} },
      rename: () => {},
      shownChanged: () => {},
    }),
    hug: () => {},
    notify: () => {},
    renameSection: () => {},
    shownChanged: () => {},
  })
  const frameResize = editorFrameResize({
    hold: hold.hold,
    session,
    view,
    tools,
    selection,
    typing: { fitText: () => {} },
    transformDrag,
    frameMove,
    onMac: () => false,
  })
  const selectPress = editorSelectPress({
    hold: hold.hold,
    session,
    view,
    selection,
    boxes,
    typing,
    transformDrag,
    autoLayoutDrag,
    frameMove,
    sectionMove,
    frameResize,
    onMac: () => false,
  })
  const none = () => null
  const pointer = editorPointer({
    dragStart: editorDragStart(),
    hold,
    session,
    view,
    tools,
    selection,
    boxes,
    typing,
    pen: {
      drawing: () => false,
      down: () => {},
      move: () => {},
      up: () => {},
      pressPoints: none,
      pointsAt: () => false,
      dragPoints: () => {},
      releasePoints: () => {},
    },
    cropping: { start: () => false, cursorAt: () => '', press: none, drag: () => {}, release: () => {} },
    drawing,
    transformDrag,
    autoLayoutDrag,
    frameResize,
    sectionMove,
    // No rulers: no press is a guide's.
    guideDrag: { press: () => null, drag: () => {}, release: () => {}, hover: () => false, cursorAt: () => '' },
    selectPress,
    // Never picking a colour: every input is the pointer's.
    colourPick: { route: () => false, stop: () => false, picking: () => false },
    renameFrame: () => {},
    renameSection: () => {},
    onMac: () => false,
    shownChanged: () => {},
  })
  const told: string[] = []
  watchFaults({
    session,
    endOpen: () => pointer.dropDrag(),
    notify: (...notice: NoticeDetail) => told.push(notice[0]),
  })
  const send = (type: PointerInput['type'], e: PointerInput) => pointer.route({ ...e, type })
  const x = () => session.design().nodes.a?.props.x
  return { session, selection, pointer, told, send, x, tool: () => tool }
}
