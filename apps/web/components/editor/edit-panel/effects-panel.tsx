'use client'

// The Effects panel: a small chip for each effect, then each effect's numbers and colour, and
// text's outline and 3D.
import { type DropShadow, type Effect, type TextStyle } from '@dazbee/schema'

import { RemoveButton } from '@/components/editor/reorder-list.tsx'
import { ICON_CHIP, KNOBS, PANEL_PART } from '@/components/editor/styles.ts'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { LIMITS } from '@/lib/editor/limits.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { ColorField } from './colour-field.tsx'
import { type EffectChoice, EffectIcon } from './effect-icons.tsx'
import { pickExtrusion, sharedExtrusion } from './extrusion.ts'
import { ExtrusionFields } from './extrusion-fields.tsx'
import { Choice, SwitchRow } from './fields.tsx'
import { clamp, NumberField } from './number-field.tsx'
import { kindOf, type P, type PanelProps, type Props, set, shared, type Style, type Target } from './target.ts'

/** The effect chips, in the order the panel shows them; Outline and 3D are text's alone. */
type Tile = EffectChoice

/** A text's outline: its width and colour, and whether it is drawn under the letters. */
type TextOutline = NonNullable<TextStyle['outline']>

const EFFECT_FIELDS = {
  dropShadow: ['x', 'y', 'blur', 'spread'],
  innerShadow: ['x', 'y', 'blur', 'spread'],
  glow: ['blur', 'spread'],
  layerBlur: ['radius'],
  backgroundBlur: ['radius'],
} as const

const NEW_EFFECT: Record<Effect['type'], Effect> = {
  dropShadow: { type: 'dropShadow', x: 0, y: 8, blur: 24, spread: 0, color: '#00000040' },
  innerShadow: { type: 'innerShadow', x: 0, y: 4, blur: 12, spread: 0, color: '#00000040' },
  glow: { type: 'glow', blur: 24, spread: 0, color: '#FF48B080' },
  layerBlur: { type: 'layerBlur', radius: 8 },
  backgroundBlur: { type: 'backgroundBlur', radius: 16 },
}

const TILES: Tile[] = [
  'none',
  'dropShadow',
  'innerShadow',
  'glow',
  'outline',
  'extrusion',
  'layerBlur',
  'backgroundBlur',
]

/** The tiles offered for texts alone. */
const TEXT_TILES = ['outline', 'extrusion'] as const satisfies readonly Tile[]

/** The tiles that aren't an entry in the effects list: None, and text's own. */
const OWN_TILES = ['none', ...TEXT_TILES] as const satisfies readonly Tile[]

const OUTLINE_PLACES = ['over', 'under'] as const

/** Whether a tile is None, or text's outline or 3D, rather than an entry in the effects list. */
function isOwnTile(tile: Tile): tile is (typeof OWN_TILES)[number] {
  return (OWN_TILES as readonly Tile[]).includes(tile)
}

/** An outline drawn over the letters or under them; over, it says nothing of it. */
function placed(outline: TextOutline, place: (typeof OUTLINE_PLACES)[number]): TextOutline {
  if (place === 'under') return { ...outline, under: true }
  const { width, color } = outline
  return { width, color }
}

/**
 * The Effects panel: one grid of chips, each an icon and a short name, its full name its tooltip. A
 * chip adds its effect, or takes every effect of its type off; None takes them all off. Under the tiles, shown only while an effect is on: each effect with
 * its numbers and its own remove button, text's outline with its width, colour and place, over or under the letters, text's 3D, and Add another,
 * which adds a second effect of a type.
 */
export function EffectsPanel({ target, brandId, workspaceId }: PanelProps) {
  const t = useMessages()
  const p = t.editor.props
  const b = t.editor.bar
  const lists = target.props.map((pr) => (pr.effects ?? []) as Effect[])
  const list = shared(lists)
  const write = (to: (now: Effect[]) => Effect[]) =>
    set(target, (now) => ({ effects: to((now.effects ?? []) as Effect[]) }))
  const kind = kindOf(target)
  const text = kind === 'text'
  const tiles = TILES.filter((tile) => text || !(TEXT_TILES as readonly Tile[]).includes(tile))
  const extrusion = text ? sharedExtrusion(target.props) : null
  const outlined = (pr: Props) =>
    ((pr.style as Style | undefined)?.outline as { width: number } | undefined)?.width ?? 0
  const on = (tile: Tile): boolean => {
    if (tile === 'outline') return target.props.every((pr) => outlined(pr) > 0)
    if (tile === 'extrusion') return extrusion !== null
    if (tile === 'none')
      return (
        lists.every((l) => l.length === 0) &&
        (!text || target.props.every((pr) => outlined(pr) === 0 && pr.extrusion === undefined))
      )
    return lists.every((l) => l.some((e) => e.type === tile))
  }
  const press = (tile: Tile) => {
    if (tile === 'none') {
      set(target, (now) => ({
        effects: [],
        ...(text ? { style: { ...(now.style as Style), outline: undefined }, ...pickExtrusion(now, false) } : {}),
      }))
      return
    }
    if (tile === 'extrusion') {
      const off = on('extrusion')
      set(target, (now) => pickExtrusion(now, !off))
      return
    }
    if (tile === 'outline') {
      const off = on('outline')
      set(target, (now) => ({
        style: {
          ...(now.style as Style),
          outline: off
            ? undefined
            : {
                width: 2,
                color: ((now.style as Style).outline as { color?: string } | undefined)?.color ?? '#000000FF',
              },
        },
      }))
      return
    }
    const off = on(tile)
    write((now) =>
      off ? now.filter((e) => e.type !== tile) : now.some((e) => e.type === tile) ? now : [...now, NEW_EFFECT[tile]],
    )
  }
  const outline = shared(target.props.map((pr) => (pr.style as Style | undefined)?.outline as TextOutline | undefined))
  const setOutline = (to: (was: TextOutline) => TextOutline) =>
    set(target, (now) => {
      const was = (now.style as Style).outline as TextOutline | undefined
      return was ? { style: { ...(now.style as Style), outline: to(was) } } : null
    })
  const empty =
    list !== 'mixed' &&
    list.length === 0 &&
    !(text && outline && outline !== 'mixed' && outline.width > 0) &&
    extrusion === null
  return (
    <>
      <section aria-label={p.effects} className={PANEL_PART} data-testid="effect-tiles">
        <div role="group" aria-label={p.effects} className={cn('grid grid-cols-3 gap-1', TOUCH_GAP)}>
          {tiles.map((tile) => {
            const own = isOwnTile(tile)
            const name = own ? p.tiles[tile] : p.effect[tile]
            const short = own ? p.tiles[tile] : p.effectShort[tile]
            return (
              <button
                key={tile}
                type="button"
                aria-pressed={on(tile)}
                aria-label={name}
                title={name}
                data-tile={tile}
                onClick={() => press(tile)}
                className={ICON_CHIP}
              >
                <EffectIcon choice={tile} />
                <span className="min-w-0 truncate">{short}</span>
              </button>
            )
          })}
        </div>
      </section>
      {/* The effects' settings show only while an effect is on: there is nothing to tune before one is picked. */}
      {!empty && (
        <div className={PANEL_PART} data-testid="effects-card">
          {text && outline && outline !== 'mixed' && outline.width > 0 && (
            <div className="flex flex-col gap-1.5" data-item="text-outline">
              <div className="flex items-center justify-between">
                <span className="text-tiny font-bold text-text">{p.tiles.outline}</span>
                <RemoveButton
                  label={format(p.remove, { name: p.tiles.outline.toLowerCase(), n: 1 })}
                  onClick={() => press('outline')}
                />
              </div>
              <div className={cn('flex items-center gap-1', TOUCH_GAP)}>
                <div className="w-24 shrink-0">
                  <NumberField
                    label="W"
                    name={p.outlineWidth}
                    value={outline.width}
                    min={0.5}
                    step={0.5}
                    editor={target.editor}
                    onSet={(width) => setOutline((was) => ({ ...was, width }))}
                    onEach={(change) => setOutline((was) => ({ ...was, width: tidy(clamp(change(was.width), 0.5)) }))}
                  />
                </div>
                <ColorField
                  name={p.outline}
                  value={outline.color}
                  editor={target.editor}
                  brandId={brandId}
                  onSet={(to) => setOutline((was) => ({ ...was, color: to(was.color) }))}
                />
              </div>
              <Choice
                name={p.outlinePlace}
                value={outline.under ? 'under' : 'over'}
                options={OUTLINE_PLACES}
                labels={p.outlinePlaces}
                testId="outline-place"
                onSet={(place) => setOutline((was) => placed(was, place))}
              />
            </div>
          )}
          {extrusion && (
            <ExtrusionFields
              extrusion={extrusion}
              target={target}
              brandId={brandId}
              workspaceId={workspaceId}
              p={p}
              onRemove={() => press('extrusion')}
            />
          )}
          {list === 'mixed' ? (
            <div className="flex items-center justify-between gap-2 text-tiny text-muted">
              {p.mixedList}
              <button
                type="button"
                onClick={() => write(() => [])}
                className="cursor-pointer font-medium text-accent-text hover:underline"
              >
                {p.useOne}
              </button>
            </div>
          ) : (
            list.map((effect, i) => (
              <EffectRow key={i} effect={effect} i={i} target={target} brandId={brandId} p={p} write={write} />
            ))
          )}
          <Select
            name="add-effect"
            label={b.addAnother}
            value=""
            placeholder={b.addAnother}
            options={(Object.keys(NEW_EFFECT) as Effect['type'][]).map((type) => ({
              value: type,
              label: p.effect[type],
            }))}
            onChange={(type) => {
              const fresh = NEW_EFFECT[type as Effect['type']]
              write((now) => [...(list === 'mixed' ? [] : now), fresh])
            }}
            className="h-8 w-full rounded-row border border-field-line bg-field px-2.5 text-label"
          />
        </div>
      )}
    </>
  )
}

/**
 * One effect's numbers and colour, with its remove button; a drop shadow's, its switch to show it
 * through the layer.
 */
function EffectRow({
  effect,
  i,
  target,
  brandId,
  p,
  write,
}: {
  effect: Effect
  i: number
  target: Target
  brandId: string
  p: P
  write: (to: (now: Effect[]) => Effect[]) => void
}) {
  const change = (to: (now: Effect) => Effect) => write((now) => now.map((x, j) => (j === i ? to(x) : x)))
  const effectName = p.effect[effect.type]
  return (
    <div className={cn('flex flex-col gap-1.5', TOUCH_GAP)} data-item={`effects-${i}`}>
      <div className="flex items-center justify-between">
        <span className="text-tiny font-bold text-text">{effectName}</span>
        <RemoveButton
          label={format(p.remove, { name: effectName.toLowerCase(), n: i + 1 })}
          onClick={() => write((now) => now.filter((_, j) => j !== i))}
        />
      </div>
      <div className={KNOBS}>
        {EFFECT_FIELDS[effect.type].map((field) => {
          const value = (effect as unknown as Record<string, number>)[field] ?? 0
          const far =
            field === 'x' || field === 'y'
              ? LIMITS.effectOffset
              : field === 'spread'
                ? LIMITS.effectSpread
                : LIMITS.effectBlur
          const min = field === 'x' || field === 'y' || (field === 'spread' && effect.type === 'dropShadow') ? -far : 0
          return (
            <NumberField
              key={field}
              label={p.effectField[field].charAt(0)}
              name={format(p.effectFieldName, { effect: effectName, n: i + 1, field: p.effectField[field] })}
              value={value}
              min={min}
              max={far}
              editor={target.editor}
              onSet={(v) => change((now) => ({ ...now, [field]: v }) as Effect)}
              onEach={(next) =>
                change(
                  (now) =>
                    ({
                      ...now,
                      [field]: tidy(clamp(next((now as unknown as Record<string, number>)[field] ?? 0), min, far)),
                    }) as Effect,
                )
              }
            />
          )
        })}
      </div>
      {'color' in effect && (
        <ColorField
          name={format(p.effectNamed, { effect: effectName, n: i + 1 })}
          value={effect.color}
          editor={target.editor}
          brandId={brandId}
          onSet={(to) => change((now) => ({ ...now, color: to('color' in now ? now.color : undefined) }) as Effect)}
        />
      )}
      {effect.type === 'dropShadow' && (
        <SwitchRow
          name={p.showBehind}
          label={format(p.effectFieldName, { effect: effectName, n: i + 1, field: p.showBehind })}
          on={effect.showBehind === true}
          onSet={(on) => change((now) => (now.type === 'dropShadow' ? showBehind(now, on) : now))}
        />
      )}
    </div>
  )
}

/** A drop shadow shown through its layer, or hidden behind it by leaving `showBehind` out: never stored false. */
function showBehind(shadow: DropShadow, on: boolean): DropShadow {
  const hidden = { ...shadow }
  delete hidden.showBehind
  return on ? { ...hidden, showBehind: true } : hidden
}
