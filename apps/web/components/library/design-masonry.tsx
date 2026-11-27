// A brand's designs as the earlier mock's masonry: columns of real pictures, each in its own shape,
// its name under it, with the tile menu (#159) on each for a member who may change them. Each tile goes in the column that ends
// highest so far (lib/masonry.ts), so rows fill left to right across the full width. A design AI works on has a dot
// by its name, and one whose layers wait for a tab to finish them says so under it.
import Link from 'next/link'

import type { DesignSummary, DesignWorking } from '@dazbee/schema'

import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { format, type Messages } from '@/lib/i18n/index.ts'
import { masonryPlaces } from '@/lib/masonry.ts'
import { tileOf } from '@/lib/tile.ts'

import { TileMenu } from './tile-menu.tsx'

/** What a tile's menu does to a design (#159), as server actions. */
export interface DesignActions {
  rename: (designId: string, form: FormData) => Promise<void>
  duplicate: (designId: string) => Promise<void>
  remove: (designId: string) => Promise<void>
}

export interface MasonryDesign extends DesignSummary {
  /** The cover frame's size, when the design has a picture. */
  cover: { width: number; height: number } | null
}

export function DesignMasonry({
  t,
  locale,
  workspaceId,
  brandId,
  designs,
  working = {},
  actions,
}: {
  t: Messages
  locale: string
  workspaceId: string
  brandId: string
  designs: MasonryDesign[]
  /** The designs with AI work on them, by id: a dot while it runs, a line once their layers wait for a tab. */
  working?: Readonly<Record<string, DesignWorking['work']>>
  /** What each tile's menu does; left out, the tiles have no menu. */
  actions?: DesignActions
}) {
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const places = masonryPlaces(designs.map(({ cover }) => (cover ? cover.height / cover.width : 1)))
  return (
    <div className="masonry-frame">
      <ul aria-label={t.home.recent} className="masonry" style={places.list}>
        {designs.map((design, i) => (
          <li
            key={design.id}
            data-design={design.id}
            data-testid="design-tile"
            className="rise group/tile"
            style={{ ...places.tiles[i], animationDelay: `${Math.min(i, 12) * 30}ms` }}
          >
            <Link
              href={brandPath(workspaceId, brandId, 'designs', design.id)}
              prefetch={false}
              className="group flex flex-col gap-(--masonry-pad) rounded-[16px] focus-visible:outline-offset-4"
            >
              <span
                className="lift relative block overflow-hidden rounded-[16px] bg-raised shadow-panel"
                style={{ aspectRatio: design.cover ? `${design.cover.width} / ${design.cover.height}` : '1 / 1' }}
              >
                {design.cover ? (
                  // Our own PNG through our own route; next/image would only re-encode it.
                  <img
                    src={`${brandPath(workspaceId, brandId, 'designs', design.id, 'thumbnail')}?v=${Date.parse(design.updatedAt)}`}
                    alt=""
                    width={design.cover.width}
                    height={design.cover.height}
                    loading={i < 8 ? 'eager' : 'lazy'}
                    className="absolute inset-0 size-full object-cover transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.02]"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="absolute inset-0 grid place-items-center"
                    style={{ background: tileOf(design.id) }}
                  >
                    <span className="font-display text-4xl font-bold text-white/90">
                      {design.name.trim().charAt(0).toUpperCase()}
                    </span>
                  </span>
                )}
              </span>
              <span className="flex h-(--masonry-caption) min-w-0 flex-col px-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  {working[design.id] === 'running' && (
                    <span
                      role="img"
                      aria-label={t.library.aiWorking}
                      title={t.library.aiWorking}
                      data-testid="ai-working-dot"
                      className="size-2 shrink-0 animate-pulse rounded-full bg-accent"
                    />
                  )}
                  <span className={cn('truncate text-small leading-5 font-semibold text-text')}>{design.name}</span>
                </span>
                <span
                  className={cn(
                    'truncate text-caption leading-4',
                    working[design.id] === 'finishing' ? 'font-semibold text-accent-text' : 'text-muted',
                  )}
                >
                  {working[design.id] === 'finishing'
                    ? t.library.layersAlmostDone
                    : format(t.library.edited, { when: when.format(new Date(design.updatedAt)) })}
                </span>
              </span>
            </Link>
            {actions && (
              <TileMenu
                name={design.name}
                rename={actions.rename.bind(null, design.id)}
                duplicate={actions.duplicate.bind(null, design.id)}
                remove={actions.remove.bind(null, design.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
