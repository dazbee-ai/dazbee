// What the connection and the device copy tell the person, as the page's notices: a change set the
// server rejected (C36), a step put back (C39), change sets lost to a server that no longer knew
// the tab (C43), the device copy stopped or not kept (D9), a design near its limits (D11), and
// another tab's restore of a version.
import type { StepName } from '@dazbee/doc'
import { type DesignSize, SYNC_LIMITS } from '@dazbee/schema'

import type { LinkNotice, LinkNotices, NoticeDetail, NoticeDetails } from './core-interface.ts'

interface LinkNoticesDeps {
  link: LinkNotices
  notify: (...told: NoticeDetail) => void
  /** Aborted when the editor ends: its listeners are let go. */
  signal: AbortSignal
}

/**
 * The largest share of a design limit `size` holds, and `parts` when that is its sections' or
 * connectors' limit. A size that leaves out their counts holds none of them.
 */
export function shareOf(size: DesignSize): NoticeDetails['nearLimit'] {
  const design = Math.max(
    size.layers / SYNC_LIMITS.designLayers,
    size.frames / SYNC_LIMITS.designFrames,
    size.pages / SYNC_LIMITS.designPages,
    size.bytes / SYNC_LIMITS.designBytes,
  )
  const sections = (size.sections || 0) / SYNC_LIMITS.designSections
  const connectors = (size.connectors || 0) / SYNC_LIMITS.designConnectors
  if (design >= sections && design >= connectors) return { share: design }
  return sections >= connectors ? { share: sections, parts: 'sections' } : { share: connectors, parts: 'connectors' }
}

/**
 * Tells the page each notice the connection gives. The design's size is told as `nearLimit` when
 * its largest share reaches the warning, and again only after it fell below. What comes before the
 * page listens, as the design opens or at its first welcome, waits, in order, until it first does
 * (`tellOpened`).
 */
export function editorLinkNotices({ link, notify: tellPage, signal }: LinkNoticesDeps) {
  /** Whether the design is past the warning, as last told. */
  let near = false
  /** What came before the page listened, in order: null once it listens. */
  let waiting: NoticeDetail[] | null = []

  function notify(...told: NoticeDetail) {
    if (waiting) waiting.push(told)
    else tellPage(...told)
  }

  function sized(size: DesignSize | undefined) {
    if (!size) return
    const nearest = shareOf(size)
    if (nearest.share < SYNC_LIMITS.warnAt) near = false
    else if (!near) {
      near = true
      notify('nearLimit', nearest)
    }
  }

  function told(notice: LinkNotice) {
    switch (notice.kind) {
      case 'rejected':
        return notify('rejected', {
          kind: notice.changeSetKind,
          ...(notice.reason === undefined ? {} : { reason: notice.reason }),
        })
      case 'lost':
        return notify('queueLost', { changeSets: notice.changeSets })
      case 'tooBig':
        return notify('putBack', { step: notice.step as StepName | null })
      case 'restored':
        return notify('restored', { by: notice.by, mark: notice.mark })
      case 'nearLimit':
        return sized(notice.size)
      case 'deviceStopped':
        return notify(notice.why === 'full' ? 'deviceFull' : 'deviceCopyFailed')
      case 'noDeviceCopy':
        return notify('noDeviceCopy')
    }
  }

  signal.addEventListener('abort', link.on(told))
  signal.addEventListener(
    'abort',
    link.onSize(() => sized(link.size())),
  )
  sized(link.size())

  return {
    /** The page listens: tells it, once, what came before it did. */
    tellOpened() {
      const told = waiting ?? []
      waiting = null
      for (const notice of told) tellPage(...notice)
    },
  }
}
