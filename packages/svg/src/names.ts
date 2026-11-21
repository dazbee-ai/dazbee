// What a layer made from an element is called: the name a design tool wrote on it, else its id.

import type { XmlElement } from './xml.ts'

/** The most characters a name keeps: a name is copied into every layer a <use> makes of its element. */
const MAX_NAME = 100

export function nameOf(element: XmlElement, fallback: string) {
  return (element.attrs['data-name'] ?? element.attrs.label ?? element.attrs.id ?? fallback).slice(0, MAX_NAME)
}
