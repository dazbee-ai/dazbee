// How a pattern crops a picture to what it shows: a photo covering a box is scaled and moved so its whole subject,
// with room round it, sits inside the box, as large as the box holds it; a cut-out is fitted by its subject, not by
// the clear round it. Each gives where the subject lands in the frame, so the logo and decoration keep off it.
import type { ImageCrop, Rect } from '@dazbee/schema'

import type { Picture } from './types.ts'

/** A picture placed in a box: the part of it shown, and where its subject lands in the frame. */
export interface Cropped {
  box: Rect
  crop: ImageCrop
  /** The subject's box in the frame's pixels, the part of it the box shows. */
  subject: Rect
  /** Whether the whole subject, with its room, shows. */
  whole: boolean
  /** The subject's area as drawn, in the frame's square pixels; how large it reads. */
  reads: number
}

/** The room kept round a subject, as a share of the box it is in. */
const SUBJECT_ROOM = 0.06
/** The most a photo is scaled past covering its box, so a subject isn't blown up past its pixels' worth. */
const MOST_ZOOM = 2

/** The box of what a picture shows, in its pixels: as read from it, else its middle. */
export function subjectOf(picture: Picture): Rect {
  return (
    picture.look?.subject ?? {
      x: picture.width * 0.2,
      y: picture.height * 0.2,
      width: picture.width * 0.6,
      height: picture.height * 0.6,
    }
  )
}

/**
 * A photo covering `box`: scaled so its subject, with room round it, fits inside `keep` (the part of the box nothing
 * is drawn over, the whole box when left out) and the box is covered, moved so the subject sits in the middle of
 * `keep` as far as the photo's edges let it; where it can't hold the whole subject so, the photo covers the box with
 * its subject in the middle of `keep`.
 */
export function coverCrop(picture: Picture, box: Rect, keep: Rect = box): Cropped {
  const subject = subjectOf(picture)
  const cover = Math.max(box.width / picture.width, box.height / picture.height)
  const fit = Math.min(
    (keep.width * (1 - 2 * SUBJECT_ROOM)) / subject.width,
    (keep.height * (1 - 2 * SUBJECT_ROOM)) / subject.height,
  )
  const whole = fit >= cover
  const scale = whole ? Math.min(fit, cover * MOST_ZOOM) : cover
  const width = box.width / scale
  const height = box.height / scale
  const clamp = (v: number, most: number) => Math.min(Math.max(v, 0), Math.max(0, most))
  // Where in the crop the middle of `keep` falls.
  const midX = (keep.x + keep.width / 2 - box.x) / scale
  const midY = (keep.y + keep.height / 2 - box.y) / scale
  const x = clamp(subject.x + subject.width / 2 - midX, picture.width - width)
  const y = clamp(subject.y + subject.height / 2 - midY, picture.height - height)
  const cropped = placed(box, { x, y, width, height }, subject, scale, whole)
  // Where the photo's edge stops the subject sitting in `keep`, it isn't shown whole there.
  const inKeep = within(cropped.subject, keep, 1)
  return inKeep ? cropped : { ...cropped, whole: false }
}

/**
 * The span of a box's other side over which a photo covering it shows its whole subject with room round it, the box's
 * `fixed` side being `size`: none where no box of that side shows it whole.
 */
export function wholeSpan(
  picture: Picture,
  fixed: 'width' | 'height',
  size: number,
): { least: number; most: number } | undefined {
  const subject = subjectOf(picture)
  const k = 1 - 2 * SUBJECT_ROOM
  const [along, across] = fixed === 'width' ? (['width', 'height'] as const) : (['height', 'width'] as const)
  // Covering a box `size` along and `other` across, the subject fits across it at a scale the cover reaches.
  if (k * picture[along] < subject[along] || k * picture[across] < subject[across]) return undefined
  const least = (subject[across] * size) / (k * picture[along])
  const most = (k * picture[across] * size) / subject[along]
  return least <= most ? { least, most } : undefined
}

/**
 * A cut-out fitted inside `room` by its subject, with `pad` of the subject's size round it, its shape kept, lined up
 * by `align`: the clear round a cut-out is left out of the room it takes.
 */
export function fitCrop(
  picture: Picture,
  room: Rect,
  align: { x: 'start' | 'center' | 'end'; y: 'start' | 'center' | 'end' } = { x: 'center', y: 'center' },
  pad = 0.02,
): Cropped {
  const subject = subjectOf(picture)
  const padX = subject.width * pad
  const padY = subject.height * pad
  const crop = {
    x: subject.x - padX,
    y: subject.y - padY,
    width: subject.width + 2 * padX,
    height: subject.height + 2 * padY,
  }
  const scale = Math.min(room.width / crop.width, room.height / crop.height)
  const width = crop.width * scale
  const height = crop.height * scale
  const at = (start: number, free: number, where: 'start' | 'center' | 'end') =>
    start + { start: 0, center: free / 2, end: free }[where]
  const box = {
    x: at(room.x, room.width - width, align.x),
    y: at(room.y, room.height - height, align.y),
    width,
    height,
  }
  return placed(box, crop, subject, scale, true)
}

/** Whether two boxes share any of their area, `by` apart at least. */
export function meets(a: Rect, b: Rect, by = 0): boolean {
  return a.x < b.x + b.width + by && b.x < a.x + a.width + by && a.y < b.y + b.height + by && b.y < a.y + a.height + by
}

/** Whether `inner` lies inside `outer`, to `slack` pixels. */
function within(inner: Rect, outer: Rect, slack: number): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  )
}

/** A picture placed: its box, crop and subject's box in the frame. */
function placed(box: Rect, crop: ImageCrop, subject: Rect, scale: number, whole: boolean): Cropped {
  const left = Math.max(box.x, box.x + (subject.x - crop.x) * scale)
  const top = Math.max(box.y, box.y + (subject.y - crop.y) * scale)
  const right = Math.min(box.x + box.width, box.x + (subject.x + subject.width - crop.x) * scale)
  const bottom = Math.min(box.y + box.height, box.y + (subject.y + subject.height - crop.y) * scale)
  const shown = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  return { box, crop, subject: shown, whole, reads: shown.width * shown.height }
}
