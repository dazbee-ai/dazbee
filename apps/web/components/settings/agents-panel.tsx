'use client'

// This workspace's Agents: the accesses the person gave agents here, each with its client's name, its brands,
// Edit or View only, when it was given and last used, and End access, which asks once, in rows like the
// members', lit by a tint under the pointer and with no outlines. With none, one line says what an agent is.
// Under them, how to connect one: the MCP server's address and the Claude Code command, each with Copy, and
// where the address goes in Claude Desktop or claude.ai. Why the API refused shows under the heading, so it
// stays when the access has left the list.
import { useEffect, useRef, useState, useTransition } from 'react'

import type { AgentAccessSummary, BrandSummary } from '@dazbee/schema'

import { endAgentAccess } from '@/app/w/[workspaceId]/(workspace)/settings/actions.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { brandsLabel } from './brands-choice.tsx'
import { ConfirmMenu } from './confirm-menu.tsx'
import { shownName } from './connect-agent.tsx'
import { Note } from './note.tsx'

/** The client's name set apart inside a sentence, so a name written right to left can't reorder the words around it. */
const isolated = (name: string) => `⁨${shownName(name)}⁩`

/** How long "Copied" shows under a field once its value is copied. */
const COPIED_MS = 3000

/** The Claude Code command that connects it to the MCP server at `address`. */
const claudeCodeCommand = (address: string) => `claude mcp add --transport http dazbee ${address}`

export function AgentsPanel({
  workspaceId,
  accesses,
  brands,
  address,
}: {
  workspaceId: string
  /** The person's accesses here that haven't ended, newest first. */
  accesses: AgentAccessSummary[]
  /** The workspace's brands the person sees, which name an access's. */
  brands: BrandSummary[]
  /** The MCP server's address, or null when the request named no host to give. */
  address: string | null
}) {
  const a = useMessages().settings.agents
  // Why the API refused the last End access, kept here rather than in its row, which may be gone.
  const [refusal, setRefusal] = useState<string | null>(null)
  return (
    <div data-testid="agents">
      <h3 id="agents-title" className="mt-7 text-label font-medium">
        {a.title}
      </h3>
      {refusal && <Note refused text={refusal} />}
      {accesses.length > 0 ? (
        <ul aria-labelledby="agents-title" className="-mx-2 mt-2 flex flex-col gap-0.5">
          {accesses.map((access) => (
            <AccessRow
              key={access.id}
              workspaceId={workspaceId}
              access={access}
              brands={brands}
              onAct={() => setRefusal(null)}
              onRefused={(error) => setRefusal(format(a.refused, { client: isolated(access.clientName), error }))}
            />
          ))}
        </ul>
      ) : (
        <p data-testid="agents-none" className="mt-2 text-small text-muted">
          {a.none}
        </p>
      )}
      {address && <ConnectAgent address={address} />}
    </div>
  )
}

/** One access: its client's name, brands, access and dates, with End access. */
function AccessRow({
  workspaceId,
  access,
  brands,
  onAct,
  onRefused,
}: {
  workspaceId: string
  access: AgentAccessSummary
  brands: BrandSummary[]
  /** Hears that End access started, so the last refusal goes. */
  onAct: () => void
  /** Hears why the API refused End access. */
  onRefused: (error: string) => void
}) {
  const s = useMessages().settings
  const a = s.agents
  const locale = useLocale()
  const [busy, startTransition] = useTransition()
  // In UTC, so the server and the browser draw the same date.
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso))
  const name = shownName(access.clientName)
  const label = format(a.endFor, { client: isolated(access.clientName) })

  function end() {
    onAct()
    startTransition(async () => {
      const error = await endAgentAccess(workspaceId, access.id)
      if (error) onRefused(error)
    })
  }

  return (
    <li
      data-access={access.id}
      aria-busy={busy || undefined}
      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-row px-2 py-1.5 transition-colors duration-[var(--chrome-fast)] hover:bg-hover"
    >
      <span className="flex min-w-0 flex-1 basis-48 flex-col">
        <span title={name} className="truncate text-small font-semibold text-text">
          <bdi data-testid="agent-client">{name}</bdi>
        </span>
        <span className="text-caption text-subtle [overflow-wrap:anywhere]">
          {brandsLabel(access.brandIds, brands, s.brands)} · {access.writes ? a.edit : a.view} ·{' '}
          <time dateTime={access.createdAt}>{format(a.given, { date: date(access.createdAt) })}</time> ·{' '}
          {access.lastUsedAt ? (
            <time dateTime={access.lastUsedAt}>{format(a.lastUsed, { date: date(access.lastUsedAt) })}</time>
          ) : (
            a.notUsed
          )}
        </span>
      </span>
      <ConfirmMenu
        trigger={
          <button
            type="button"
            disabled={busy}
            className={cn(
              buttonStyles({ variant: 'ghost', size: 'md' }),
              'h-8 shrink-0 px-2.5 text-label font-semibold text-danger hover:text-danger',
            )}
          >
            {a.end}
          </button>
        }
        label={label}
        question={format(a.endConfirm, { client: isolated(access.clientName) })}
        confirm={a.end}
        cancel={a.cancel}
        danger
        onConfirm={end}
      />
    </li>
  )
}

/** How to connect an agent: the address and the Claude Code command, each to copy, and where else the address goes. */
function ConnectAgent({ address }: { address: string }) {
  const a = useMessages().settings.agents
  return (
    <div className="mt-5 flex flex-col gap-2">
      <label htmlFor="mcp-address" className="text-label font-medium">
        {a.address}
      </label>
      <CopyField id="mcp-address" value={address} copyLabel={a.copyAddress} />
      <label htmlFor="mcp-command" className="mt-2 text-small text-muted">
        {a.claudeCode}
      </label>
      <CopyField id="mcp-command" value={claudeCodeCommand(address)} copyLabel={a.copyCommand} />
      <p className="mt-2 text-small text-muted">{a.connector}</p>
    </div>
  )
}

/**
 * A value to copy, in a field that reads left to right in any language, with Copy beside it. Once copied, "Copied"
 * shows under it for a moment; a browser that won't copy, as on a page served over plain http, selects the value to
 * copy by hand.
 */
function CopyField({ id, value, copyLabel }: { id: string; value: string; copyLabel: string }) {
  const a = useMessages().settings.agents
  const field = useRef<HTMLInputElement>(null)
  // When the value was last copied, while "Copied" shows; 0 once it has gone.
  const [copiedAt, setCopiedAt] = useState(0)
  useEffect(() => {
    if (!copiedAt) return
    const timer = setTimeout(() => setCopiedAt(0), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copiedAt])

  function copy() {
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(
        () => setCopiedAt(Date.now()),
        () => field.current?.select(),
      )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <input
        ref={field}
        id={id}
        readOnly
        dir="ltr"
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 min-w-0 flex-1 basis-64 rounded-row border border-line bg-bg px-3 font-mono text-small text-text outline-none hover:border-line-strong focus:border-accent"
      />
      <button
        type="button"
        onClick={copy}
        aria-label={copyLabel}
        className={cn(buttonStyles({ variant: 'ghost', size: 'md' }), 'h-11 shrink-0 px-3 text-label font-semibold')}
      >
        {a.copy}
      </button>
      {copiedAt > 0 && (
        <div className="basis-full">
          <Note text={a.copied} />
        </div>
      )}
    </div>
  )
}
