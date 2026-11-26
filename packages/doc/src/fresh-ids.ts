// A copy of a design that shares no ids with it (#54): every page, frame, layer, section and
// connector gets a new id, and everything naming them (a frame's page and section, a layer's
// parent, a section's and a connector's page, a connector's ends) follows. Each link id gets one
// new link id, so linked copies stay linked to each other and to nothing outside the copy. Stars
// are kept. Starting a design from a template makes one, so the two never collide when layers are
// copied between them.
import { nanoid } from 'nanoid'

import type { Design } from '@dazbee/schema'

export function withFreshIds(design: Design, newId: () => string = nanoid): Design {
  const fresh = (ids: Iterable<string>) => new Map([...ids].map((id) => [id, newId()]))
  const pages = fresh(Object.keys(design.pages))
  const frames = fresh(Object.keys(design.frames))
  const nodes = fresh(Object.keys(design.nodes))
  const sections = fresh(Object.keys(design.sections))
  const connectors = fresh(Object.keys(design.connectors))
  const links = fresh(new Set(Object.values(design.nodes).map((node) => node.link)))
  const to = (map: Map<string, string>, id: string) => map.get(id) ?? id
  const end = (id: string) => frames.get(id) ?? to(sections, id)
  const rekey = <T>(record: Record<string, T>, map: Map<string, string>, value: (v: T) => T) =>
    Object.fromEntries(Object.entries(record).map(([id, v]) => [to(map, id), value(v)]))
  return {
    ...design,
    pages: rekey(design.pages, pages, (page) => page),
    frames: rekey(design.frames, frames, (frame) => ({
      ...frame,
      pageId: to(pages, frame.pageId),
      ...(frame.sectionId === undefined ? {} : { sectionId: to(sections, frame.sectionId) }),
    })),
    nodes: rekey(design.nodes, nodes, (node) => ({
      ...node,
      parentId: frames.get(node.parentId) ?? to(nodes, node.parentId),
      link: to(links, node.link),
    })),
    sections: rekey(design.sections, sections, (section) => ({ ...section, pageId: to(pages, section.pageId) })),
    connectors: rekey(design.connectors, connectors, (connector) => ({
      ...connector,
      pageId: to(pages, connector.pageId),
      from: end(connector.from),
      to: end(connector.to),
    })),
  }
}
