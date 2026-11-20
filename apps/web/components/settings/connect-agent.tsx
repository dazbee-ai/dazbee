'use client'

// The Connect an agent form (ADR-0019): Daz, the agent's name and the host the answer goes back to, each as plain
// text, then the workspace (a choice when the person has several), the brands the agent may open (All brands, which
// follows the brands the person sees from now on, or those ticked) and whether it edits or only views; a Reviewer's
// agent only views, with no choice. Allow and Deny send the person back to the agent, or say why the API refused.
// Once the page has read the request, its id leaves the address bar and stays in the form alone.
import { type ReactNode, useActionState, useEffect, useId, useState } from 'react'

import { type BrandSummary, type MemberRole, roleWrites } from '@dazbee/schema'

import { allow, type ConnectAnswer, deny } from '@/app/agents/connect/actions.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { WarningCircleIcon } from '@/components/ui/icons.tsx'
import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { Mascot } from '@/components/ui/mascot.tsx'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { offersChoice, Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { BrandsChoice, type BrandsPick } from './brands-choice.tsx'

/** A workspace the person may connect the agent in: their role there and the brands they see in it. */
export interface ConnectWorkspace {
  id: string
  name: string
  role: MemberRole
  brands: BrandSummary[]
}

/** Whether the agent edits or only views. */
type Access = 'edit' | 'view'

const ACCESSES = ['edit', 'view'] as const satisfies readonly Access[]

/** Every brand the person sees, which a new workspace's brands choice starts at. */
const EVERY_BRAND: BrandsPick = { all: true, ticked: [] }

/** The parts of a sentence before and after its `{name}`, so what fills it is drawn as text of its own. */
const around = (sentence: string, name: string): [string, string] => {
  const [before = '', after = ''] = sentence.split(`{${name}}`)
  return [before, after]
}

/** Takes the request's id out of the address bar, leaving the page's address, so no history or copied link holds it. */
function useRequestOutOfAddress() {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('request')) return
    url.searchParams.delete('request')
    window.history.replaceState(null, '', url)
  }, [])
}

export function ConnectAgent({
  request,
  clientName,
  redirectHost,
  workspaces,
}: {
  /** The sign-in request's id, sent with Allow or Deny. */
  request: string
  /** The name the agent's client gave itself. */
  clientName: string
  /** The host the client hears back at. */
  redirectHost: string
  /** The person's workspaces, the one picked first. */
  workspaces: ConnectWorkspace[]
}) {
  const t = useMessages()
  const words = t.connectAgent
  const ids = useId()
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [pick, setPick] = useState<BrandsPick>(EVERY_BRAND)
  const [access, setAccess] = useState<Access>('edit')
  const [allowed, allowAction, allowing] = useActionState<ConnectAnswer, FormData>(allow, null)
  const [denied, denyAction, denying] = useActionState<ConnectAnswer, FormData>(deny, null)
  useRequestOutOfAddress()
  const workspace = workspaces.find((each) => each.id === workspaceId) ?? workspaces[0]
  if (!workspace) return null
  const writes = roleWrites(workspace.role)
  const busy = allowing || denying
  const refused = (allowing || denying ? null : (allowed ?? denied))?.error
  const [wantsBefore, wantsAfter] = around(words.wants, 'client')
  const [backBefore, backAfter] = around(words.sendsBack, 'host')
  return (
    <form
      action={allowAction}
      aria-labelledby={`${ids}-title`}
      data-testid="connect-agent"
      className="flex w-full max-w-[30rem] flex-col gap-6 rounded-[20px] surface-frost p-6 sm:p-8"
    >
      <input type="hidden" name="request" value={request} />
      <input type="hidden" name="workspace" value={workspace.id} />
      <input type="hidden" name="brands" value={pick.all ? 'all' : 'chosen'} />
      {!pick.all && pick.ticked.map((id) => <input key={id} type="hidden" name="brand" value={id} />)}
      <input type="hidden" name="access" value={writes ? access : 'view'} />
      <header className="flex flex-col items-center gap-3 text-center">
        <Mascot pose="hello" size={88} />
        <h1
          id={`${ids}-title`}
          className="font-display text-[1.625rem] leading-tight font-extrabold tracking-[-0.01em] text-balance [overflow-wrap:anywhere]"
        >
          {wantsBefore}
          <bdi data-testid="connect-client">{clientName}</bdi>
          {wantsAfter}
        </h1>
        <p className="text-label text-muted [overflow-wrap:anywhere]">
          {backBefore}
          <bdi dir="ltr" data-testid="connect-host" className="font-mono font-semibold text-text">
            {redirectHost}
          </bdi>
          {backAfter}
        </p>
      </header>
      <Part label={words.workspace} labelId={`${ids}-workspace`}>
        {offersChoice(workspaces) ? (
          <Select
            name="workspace-choice"
            label={words.workspace}
            value={workspace.id}
            options={workspaces.map((each) => ({ value: each.id, label: each.name }))}
            onChange={(id) => {
              setWorkspaceId(id)
              setPick(EVERY_BRAND)
            }}
            className="h-10 w-full bg-well px-3 text-small"
            testId="connect-workspace"
          />
        ) : (
          <p className="text-small text-text [overflow-wrap:anywhere]">{workspace.name}</p>
        )}
      </Part>
      <Part label={t.settings.brands.label} labelId={`${ids}-brands`}>
        {workspace.brands.length > 0 ? (
          <BrandsChoice brands={workspace.brands} pick={pick} onPick={setPick} />
        ) : (
          <p className="text-small text-text">{t.settings.brands.all}</p>
        )}
      </Part>
      <Part label={words.access} labelId={`${ids}-access`}>
        {writes ? (
          <>
            <RadioGroup
              labelledBy={`${ids}-access`}
              options={ACCESSES}
              value={access}
              onPick={setAccess}
              testId="connect-access"
              className={cn(SEGMENTS, 'self-start')}
            >
              {ACCESSES.map((each) => (
                <Radio key={each} value={each} className={cn(SEGMENT, 'h-9 px-3')}>
                  {words[each]}
                </Radio>
              ))}
            </RadioGroup>
            <p className="text-label text-muted">{words.accessHints[access]}</p>
          </>
        ) : (
          <p data-testid="connect-view-only" className="text-small text-text">
            {words.viewOnly}
          </p>
        )}
      </Part>
      {refused && (
        <p
          role="alert"
          data-testid="connect-refused"
          className="flex min-w-0 items-center gap-1.5 text-label text-danger [overflow-wrap:anywhere]"
        >
          <WarningCircleIcon size={16} weight="bold" aria-hidden className="shrink-0" />
          <span className="min-w-0">{refused}</span>
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="submit"
          formAction={denyAction}
          disabled={busy}
          data-testid="connect-deny"
          className={cn(buttonStyles({ variant: 'ghost', size: 'lg' }), 'h-11 px-6')}
        >
          {denying ? words.denying : words.deny}
        </button>
        <button
          type="submit"
          disabled={busy}
          data-testid="connect-allow"
          className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-11 px-7 font-semibold')}
        >
          {allowing ? words.allowing : words.allow}
        </button>
      </div>
    </form>
  )
}

/** One part of the form: its label over what it holds. */
function Part({ label, labelId, children }: { label: string; labelId: string; children: ReactNode }) {
  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-2">
      <h2 id={labelId} className="text-label text-muted">
        {label}
      </h2>
      {children}
    </section>
  )
}
