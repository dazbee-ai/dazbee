// What the brand kit form's parts share: binding from the editor, and their looks.

/** Binds the selected layers to a kit colour or font, in the editor. */
export interface KitBinding {
  follows: (kind: 'color' | 'font', token: string) => boolean
  apply: (kind: 'color' | 'font', token: string) => void
  /** Whether anything is selected that can follow a colour, or a font. */
  canColor: boolean
  canFont: boolean
}

// As the mock's flyouts: small spaced capitals over each part, quiet fields, round swatches.
export const heading = 'text-caption font-bold tracking-[0.08em] text-subtle uppercase'
export const field =
  'h-8 min-w-0 rounded-[8px] border border-line bg-bg/40 px-2 text-small hover:border-line-strong focus:border-accent focus:outline-none'
export const iconButton =
  'grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-subtle hover:bg-hover hover:text-text active:bg-pressed active:text-text disabled:cursor-default disabled:opacity-40 aria-pressed:bg-accent-soft aria-pressed:text-text'
