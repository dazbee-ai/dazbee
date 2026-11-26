// What the editor tells the person, in the app's words: why a key or a gesture did nothing, how a
// placed SVG went, pictures uploading and pasted files not placed, layers a design leaves out, and
// what the connection says (a change set the server rejected, one put back, change sets lost, the
// device copy, a design near its limits, a Reviewer's tab), another tab typing in the text being
// edited, why picking a colour picked none, and another tab's restore of a version. The device copy
// this browser can't keep shows Daz offline beside its words.
import type { Notice, NoticeDetail } from '@dazbee/editor'

import { refusalWords } from '@/components/editor/refusal-words.ts'
import type { MascotPose } from '@/components/ui/mascot.tsx'
import { uploadingWords } from '@/lib/editor/upload-notice.ts'
import { versionTime } from '@/lib/editor/versions.ts'
import { counted, format, type Locale, type Messages } from '@/lib/i18n/index.ts'

/** The words of a notice, filled with what it tells besides itself. */
export function noticeWords(locale: Locale, editor: Messages['editor'], ...[n, detail]: NoticeDetail): string {
  const { notices, svgParts, droppedFiles } = editor
  switch (n) {
    // A refused key says why in the words its greyed item gives.
    case 'refused':
      return refusalWords(detail.why, editor)
    // How many layers the design could not read, in the words that count takes.
    case 'layersLeftOut':
      return counted(locale, notices.layersLeftOut, detail.layers)
    // A layout notice names the layout, as it reads inside a sentence; an SVG's, the parts left out.
    case 'placedByLayout':
    case 'flowEnd':
      return format(notices[n], { layout: notices.layouts[detail.layout] })
    case 'svgLeftOut': {
      const parts = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
        detail.parts.map((part) => svgParts[part]),
      )
      return [
        detail.parts.length > 0 ? format(notices.svgLeftOut, { parts }) : '',
        detail.notUploaded ? counted(locale, notices.svgNotUploaded, detail.notUploaded) : '',
      ]
        .filter(Boolean)
        .join(' ')
    }
    // Pictures uploading, an SVG's or pasted images, in the words of a drop: one by its name, more by their number.
    case 'uploading':
      return uploadingWords(droppedFiles, detail.names)
    // Why Copy as PNG copied nothing.
    case 'pngNotCopied':
      return notices.pngNotCopied[detail.why]
    // The pasted files not placed, by their names.
    case 'imagesNotPasted':
      return format(notices.imagesNotPasted, {
        names: new Intl.ListFormat(locale, { type: 'conjunction' }).format(detail.names),
      })
    // A rejected change set says why by its reason; one learned on reconnecting has none.
    case 'rejected':
      return detail.reason ? notices.rejected[detail.reason] : notices.rejected.offline
    // A tab that came to only view: a drag it put back says what the server's refusal of a change says.
    case 'nowViewOnly':
      return notices.rejected.viewOnly
    case 'queueLost':
      return counted(locale, notices.queueLost, detail.changeSets)
    // A restore put back has words of its own, which offer the copy instead.
    case 'putBack':
      return detail.step === 'restore' ? notices.restoreTooBig : notices.putBack
    // Who restored which version: a named one by its name, an automatic one by when it was taken.
    case 'restored': {
      const name = detail.by.trim() || notices.someone
      if (detail.mark.kind === 'named') return format(notices.restored, { name, version: detail.mark.name })
      return format(notices.restoredAt, { name, time: versionTime(locale, detail.mark.takenAt) })
    }
    // Who else is typing in the text, by their name, or someone when they have none.
    case 'editingElsewhere':
      return detail.name.trim()
        ? format(notices.editingElsewhere, { name: detail.name.trim() })
        : notices.editingElsewhereUnnamed
    // The share of the limit nearest, in words naming the sections or connectors when it is theirs.
    case 'nearLimit': {
      const words =
        detail.parts === 'sections'
          ? notices.nearLimitSections
          : detail.parts === 'connectors'
            ? notices.nearLimitConnectors
            : notices.nearLimit
      return format(words, {
        percent: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(detail.share),
      })
    }
    default:
      return notices[n]
  }
}

/** Daz's pose beside a notice's words, for the one notice that shows it. */
export function noticePose(n: Notice): MascotPose | undefined {
  return n === 'noDeviceCopy' ? 'offline' : undefined
}
