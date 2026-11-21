// Builds Figma file JSON for tests, in the shapes Figma's REST API documents: a file's document of
// pages, and nodes with their ids, types, names, boxes and children.

/** A Figma node as the file holds it: any fields beside its id and type. */
export type TestNode = { id: string; type: string; name?: string; children?: TestNode[] } & Record<string, unknown>

export const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

/** A node of `type` at `at` (its absoluteBoundingBox), named after its type unless `extra` names it. */
export const node = (
  type: string,
  id: string,
  at: ReturnType<typeof box>,
  extra: Record<string, unknown> = {},
): TestNode => ({ id, type, name: type.toLowerCase(), absoluteBoundingBox: at, ...extra })

export const frame = (id: string, at: ReturnType<typeof box>, children: TestNode[] = [], extra = {}) =>
  node('FRAME', id, at, { name: `Frame ${id}`, clipsContent: true, children, ...extra })

export const group = (id: string, children: TestNode[], extra = {}) =>
  node('GROUP', id, box(0, 0, 0, 0), { name: `Group ${id}`, children, ...extra })

export const rectangle = (id: string, at: ReturnType<typeof box>, extra = {}) =>
  node('RECTANGLE', id, at, { name: `Rect ${id}`, ...extra })

export const page = (id: string, name: string, children: TestNode[]): TestNode => ({
  id,
  type: 'CANVAS',
  name,
  children,
})

/** A file holding `pages`, as `GET /v1/files/:key` answers, before it is turned into text. */
export const figmaDocument = (pages: TestNode[], extra: Record<string, unknown> = {}) => ({
  name: 'Spring launch',
  editorType: 'figma',
  document: { id: '0:0', type: 'DOCUMENT', name: 'Document', children: pages },
  ...extra,
})

/** The text of a file holding `pages`. */
export const figmaFile = (pages: TestNode[], extra: Record<string, unknown> = {}) =>
  JSON.stringify(figmaDocument(pages, extra))

/** The text of a file of one page holding `children`. */
export const onePage = (children: TestNode[]) => figmaFile([page('0:1', 'Page 1', children)])
