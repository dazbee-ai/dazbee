// The import report as a Figma file is read: each line in the order first met, how many layers it
// names, and the first few of them by their Figma ids and names.

import {
  FIGMA_REPORT_ITEMS,
  FIGMA_REPORT_LINES,
  FIGMA_REPORT_NODES,
  type FigmaReport,
  type FigmaReportLine,
} from '@dazbee/schema'

/** A layer a report line names: its Figma id and name. */
export interface ReportedNode {
  id: string
  name: string
}

export interface Reporter {
  /** Counts `node` under `line`, once however often it is added; without a node, counts one more. */
  add(line: FigmaReportLine, node?: ReportedNode): void
  /** The report so far, with the font families no font was found for. */
  report(fonts?: string[]): FigmaReport
}

export function newReport(): Reporter {
  const items = new Map<FigmaReportLine, { count: number; seen: Set<string>; nodes: ReportedNode[] }>()

  function add(line: FigmaReportLine, node?: ReportedNode) {
    let item = items.get(line)
    if (!item) {
      if (items.size >= FIGMA_REPORT_ITEMS) return
      item = { count: 0, seen: new Set(), nodes: [] }
      items.set(line, item)
    }
    if (node) {
      if (item.seen.has(node.id)) return
      item.seen.add(node.id)
      if (item.nodes.length < FIGMA_REPORT_NODES) item.nodes.push({ id: node.id, name: node.name })
    }
    item.count++
  }

  function report(fonts: string[] = []): FigmaReport {
    return {
      fonts,
      items: [...items].map(([line, { count, nodes }]) => ({ line, kind: FIGMA_REPORT_LINES[line], count, nodes })),
    }
  }

  return { add, report }
}
