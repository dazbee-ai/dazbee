// Every command, by the name a session runs it with.
import { designPlace, nodeDuplicate, nodeMove, nodeReorder } from './arrange.ts'
import { nodeAutoLayout } from './auto-layout.ts'
import { connectorAdd, connectorDelete } from './connectors.ts'
import { nodeCopyToFrames } from './copy-to-frames.ts'
import { nodeFlip } from './flip.ts'
import {
  frameAdd,
  frameAddSize,
  frameDelete,
  frameDuplicate,
  frameResize,
  frameShowPicture,
  frameUpdate,
} from './frames.ts'
import { nodeBoolean, nodeBox, nodeEnclose, nodeGroup, nodeHug, nodeUngroup } from './groups.ts'
import { guideAdd, guideClear, guideMove, guideRemove } from './guides.ts'
import { nodeBind, nodeCreate, nodeDelete, nodeLock, nodeMask, nodeRename, nodeUpdate } from './layers.ts'
import { pageAdd, pageAddMany, pageDelete, pageDuplicate, pageMove, pageUpdate } from './pages.ts'
import { nodeReshape } from './paths.ts'
import { designRestore } from './restore.ts'
import {
  frameSetSection,
  sectionAdd,
  sectionDelete,
  sectionDuplicate,
  sectionMove,
  sectionUngroup,
  sectionUpdate,
} from './sections.ts'
import { nodeStyle } from './style.ts'
import { textEdit, textFit, textReplace } from './text.ts'

export const COMMANDS = {
  'node.create': nodeCreate,
  'node.update': nodeUpdate,
  'node.move': nodeMove,
  'node.delete': nodeDelete,
  'node.lock': nodeLock,
  'node.rename': nodeRename,
  'node.mask': nodeMask,
  'node.bind': nodeBind,
  'node.style': nodeStyle,
  'node.reorder': nodeReorder,
  'node.duplicate': nodeDuplicate,
  'design.place': designPlace,
  'node.copyToFrames': nodeCopyToFrames,
  'node.group': nodeGroup,
  'node.box': nodeBox,
  'node.enclose': nodeEnclose,
  'node.boolean': nodeBoolean,
  'node.ungroup': nodeUngroup,
  'node.hug': nodeHug,
  'node.reshape': nodeReshape,
  'node.flip': nodeFlip,
  'node.autoLayout': nodeAutoLayout,
  'text.edit': textEdit,
  'text.replace': textReplace,
  'text.fit': textFit,
  'page.add': pageAdd,
  'page.addMany': pageAddMany,
  'page.update': pageUpdate,
  'page.duplicate': pageDuplicate,
  'page.move': pageMove,
  'page.delete': pageDelete,
  'frame.add': frameAdd,
  'frame.update': frameUpdate,
  'frame.showPicture': frameShowPicture,
  'frame.resize': frameResize,
  'frame.duplicate': frameDuplicate,
  'frame.addSize': frameAddSize,
  'frame.delete': frameDelete,
  'guide.add': guideAdd,
  'guide.move': guideMove,
  'guide.remove': guideRemove,
  'guide.clear': guideClear,
  'design.restore': designRestore,
  'section.add': sectionAdd,
  'section.update': sectionUpdate,
  'section.ungroup': sectionUngroup,
  'section.delete': sectionDelete,
  'section.move': sectionMove,
  'section.duplicate': sectionDuplicate,
  'frame.setSection': frameSetSection,
  'connector.add': connectorAdd,
  'connector.delete': connectorDelete,
} as const
export type CommandName = keyof typeof COMMANDS
