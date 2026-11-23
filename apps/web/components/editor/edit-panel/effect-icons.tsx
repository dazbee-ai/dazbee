// An icon for each effect choice, drawn in Iconoir's style (a 24 px box, 1.6 px round strokes),
// since Iconoir has none for them: what each effect does to a square.
import type { ReactNode } from 'react'

import type { Effect } from '@dazbee/schema'

/** The effect choices: none, an effect, or text's outline or 3D. */
export type EffectChoice = 'none' | Effect['type'] | 'outline' | 'extrusion'

const DRAWINGS: Record<EffectChoice, ReactNode> = {
  none: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.5 17.5l11-11" />
    </>
  ),
  dropShadow: (
    <>
      <rect x="4" y="4" width="13" height="13" rx="3" />
      <path d="M8 20h9a3 3 0 0 0 3-3V8" opacity=".55" />
    </>
  ),
  innerShadow: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M7.5 15V9.5a2 2 0 0 1 2-2H15" opacity=".55" />
    </>
  ),
  glow: (
    <>
      <rect x="7.5" y="7.5" width="9" height="9" rx="2" />
      <path
        d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"
        opacity=".6"
      />
    </>
  ),
  layerBlur: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="3" strokeDasharray="2.2 2.6" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" opacity=".55" />
    </>
  ),
  backgroundBlur: (
    <>
      <path d="M3 9l6-6M3 15 15 3M3 21 21 3M9 21 21 9M15 21l6-6" opacity=".35" />
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="var(--icon-ground, transparent)" />
    </>
  ),
  outline: (
    <>
      <path d="M5.5 19.5 11 4.5h2l5.5 15h-3l-1.2-3.5H9.7l-1.2 3.5Z" />
      <path d="M10.6 13.5h2.8L12 9.3Z" />
    </>
  ),
  extrusion: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="2" />
      <path d="M15.5 4.5l4 4V18a1.5 1.5 0 0 1-1.5 1.5H8.5l-4-4M16 16l3.5 3.5" opacity=".55" />
    </>
  ),
}

/** The choice's icon, 16 px, in the text colour around it. */
export function EffectIcon({ choice }: { choice: EffectChoice }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {DRAWINGS[choice]}
    </svg>
  )
}
