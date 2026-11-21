// The other people in the design over the stage, each in their colour: their selected layers
// outlined and their picked frame, which the overlay puts under the tab's own selection; and their
// cursor, a notched dart edged in white with their name in a tag beside it, which it puts over
// everything but the loupe. An agent's tag starts with its avatar, Dazbee's sparks, and holds its
// note under its name.
import type { ShownPerson } from '../presence.ts'
import type { Frame } from './frames.ts'
import { px } from './rulers.ts'

/** What `presenceParts` builds: the outlines, and the cursors. */
export interface PresenceParts {
  outlines: HTMLElement[]
  cursors: HTMLElement[]
}

/**
 * How far a tag may reach past its pointer: its offset and its widest (`.presence-tag` in
 * `stage-overlay.css`). A pointer nearer the stage's end than this has its tag on its start side.
 */
export const TAG_ROOM = 12 + 220

/** The dart's outline, its tip at the pointer, pointing up and to the start. */
const DART = 'M0 0 L3.5 15.5 L7.5 8.5 L15.5 4 Z'
/** The dart's box, with room for its white edge. */
const DART_BOX = '-1 -1 18 18'
/** Iconoir's sparks in its 24-unit box: the big star, then the small one; an agent's avatar. */
const SPARKS = [
  'M8 15C12.8747 15 15 12.949 15 8C15 12.949 17.1104 15 22 15C17.1104 15 15 17.1104 15 22C15 17.1104 12.8747 15 8 15Z',
  'M2 6.5C5.13376 6.5 6.5 5.18153 6.5 2C6.5 5.18153 7.85669 6.5 11 6.5C7.85669 6.5 6.5 7.85669 6.5 11C6.5 7.85669 5.13376 6.5 2 6.5Z',
]
const SVG = 'http://www.w3.org/2000/svg'
/** A colour lighter than this, by its weighted mean of red, green and blue out of 255, takes dark text. */
const LIGHT = 170
const DARK_TEXT = '#1E1E1E'
const LIGHT_TEXT = '#FFFFFF'

/**
 * The parts of `people`: each one's layers outlined along their shape by `layerOutline` and their
 * picked frame by `frameOutline`, each given the person's colour as its colour, then each cursor,
 * its tag kept on the stage, `room` wide.
 */
export function presenceParts(
  people: readonly ShownPerson[],
  layerOutline: (frame: Frame, id: string) => HTMLElement | null,
  frameOutline: (frame: Frame) => HTMLElement,
  room = Infinity,
): PresenceParts {
  const outlines: HTMLElement[] = []
  const cursors: HTMLElement[] = []
  for (const person of people) {
    const theirs = [
      ...person.layers.flatMap(({ frame, id }) => layerOutline(frame, id) ?? []),
      ...(person.frame ? [frameOutline(person.frame)] : []),
    ]
    for (const el of theirs) {
      el.style.color = person.colour
      el.dataset.tab = String(person.tabId)
    }
    outlines.push(...theirs)
    if (person.cursor) cursors.push(cursorPart(person, room))
  }
  return { outlines, cursors }
}

/** The colour of text that reads on `colour`, a `#RRGGBB`. */
export function textOn(colour: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16))
  const light = 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0)
  return light > LIGHT ? DARK_TEXT : LIGHT_TEXT
}

/** A person's cursor at their pointer: the dart, and their tag beside it, on its start side near the end of the stage, `room` wide. */
function cursorPart(person: ShownPerson, room: number): HTMLElement {
  const el = document.createElement('div')
  el.className = 'presence-cursor'
  el.dataset.tab = String(person.tabId)
  if ((person.cursor?.x ?? 0) + TAG_ROOM > room) el.dataset.flip = ''
  Object.assign(el.style, { left: px(person.cursor?.x ?? 0), top: px(person.cursor?.y ?? 0), color: person.colour })
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'presence-dart')
  svg.setAttribute('viewBox', DART_BOX)
  const dart = document.createElementNS(SVG, 'path')
  dart.setAttribute('d', DART)
  svg.append(dart)
  el.append(svg, tagPart(person))
  return el
}

/** A person's tag in their colour: an agent's avatar, the name, and an agent's note under it. */
function tagPart(person: ShownPerson): HTMLElement {
  const tag = document.createElement('div')
  tag.className = 'presence-tag'
  Object.assign(tag.style, { background: person.colour, color: textOn(person.colour) })
  if (person.agent) tag.append(avatarPart(person.colour))
  const name = document.createElement('div')
  name.className = 'presence-name'
  // A name or note in a right-to-left script reads in its own direction on the left-to-right stage.
  name.setAttribute('dir', 'auto')
  name.textContent = person.name
  tag.append(name)
  if (person.note !== undefined) {
    const note = document.createElement('div')
    note.className = 'presence-note'
    note.setAttribute('dir', 'auto')
    note.textContent = person.note
    tag.append(note)
  }
  return tag
}

/** An agent's avatar: a disc in the tag's text colour, the sparks on it in the agent's `colour`. */
function avatarPart(colour: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'presence-avatar')
  svg.setAttribute('viewBox', '-4 -4 32 32')
  Object.assign(svg.style, { background: textOn(colour), fill: colour })
  for (const d of SPARKS) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}
