'use client'

// The Connect an agent form (ADR-0019): Daz, the agent's name and the host the answer goes back to, each as plain
// text, then the workspace (a choice when the person has several), the brands the agent may open (All brands, which
// follows the brands the person sees from now on, or those ticked) and whether it edits or only views; a Reviewer's
// agent only views, with no choice. Allow and Deny send the person back to the agent, or say why the API refused.
// Allow waits until the page has been in view, and the window focused, for a moment, so a click meant for another
// page that opened this one in its place never lands on it. Once the page has read the request, its id leaves the
// address bar and stays in the form alone.
import {
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from 'react'

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

/** The longest host shown whole; a longer one shows its end, which names the site. */
const HOST_SHOWN = 64

/** How long the page is in view, with its window focused, before Allow can be pressed. */
const ARM_MS = 600

/**
 * The client's name as the page draws it: a line or paragraph break as a space, and at most three marks on a
 * letter, so the name stays on its own lines.
 */
export const shownName = (name: string) =>
  name
    .normalize('NFC')
    .replace(/[\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/(\p{M}{3})\p{M}+/gu, '$1')

/** The host as the page draws it: whole, or its end after an ellipsis when it is long. */
export const shownHost = (host: string) => (host.length <= HOST_SHOWN ? host : `…${host.slice(-(HOST_SHOWN - 1))}`)

/** Nothing to listen to: whether the scripts have loaded never changes once they have. */
const subscribeNever = () => () => {}

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

/**
 * Whether Allow can be pressed: once the page has been in view, with its window focused, for ARM_MS; again that
 * long after the window loses focus or the page is hidden. False in the page as sent, before its scripts run.
 */
function useArmed(): boolean {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const disarm = () => {
      clearTimeout(timer)
      setArmed(false)
    }
    const arm = () => {
      disarm()
      if (document.visibilityState === 'visible') timer = setTimeout(() => setArmed(true), ARM_MS)
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? arm() : disarm())
    arm()
    window.addEventListener('focus', arm)
    window.addEventListener('blur', disarm)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', arm)
      window.removeEventListener('blur', disarm)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  return armed
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
  // The button pressed last, which the answer and the busy words are of.
  const [pressed, setPressed] = useState<'allow' | 'deny'>('allow')
  // Whether the last refusal still shows: until the person changes a choice.
  const [shown, setShown] = useState(true)
  const [answer, send, busy] = useActionState<ConnectAnswer, FormData>(
    (before, form) => (form.get('answer') === 'deny' ? deny(before, form) : allow(before, form)),
    null,
  )
  const armed = useArmed()
  // False in the page as sent, true once its scripts run: Deny waits for them, as Allow does.
  const loaded = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  const changed =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setShown(false)
      set(value)
    }
  useRequestOutOfAddress()
  const workspace = workspaces.find((each) => each.id === workspaceId) ?? workspaces[0]
  if (!workspace) return null
  const writes = roleWrites(workspace.role)
  const refused = busy || !shown ? null : answer?.error
  const [wantsBefore, wantsAfter] = around(words.wants, 'client')
  const [backBefore, backAfter] = around(words.sendsBack, 'host')
  return (
    // Sent from the submit event rather than as the form's action, since React resets a form after its action, and
    // the reset would put the brands and access chosen back to where they started.
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)
        setPressed(form.get('answer') === 'deny' ? 'deny' : 'allow')
        setShown(true)
        startTransition(() => send(form))
      }}
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
          className="line-clamp-4 overflow-hidden font-display text-[1.625rem] leading-tight font-extrabold tracking-[-0.01em] text-balance [overflow-wrap:anywhere]"
        >
          {wantsBefore}
          <bdi data-testid="connect-client">{shownName(clientName)}</bdi>
          {wantsAfter}
        </h1>
        <p className="text-card text-text [overflow-wrap:anywhere]">
          {backBefore}
          <bdi dir="ltr" title={redirectHost} data-testid="connect-host" className="font-mono font-bold">
            {shownHost(redirectHost)}
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
              setShown(false)
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
          <BrandsChoice brands={workspace.brands} pick={pick} onPick={changed(setPick)} />
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
              onPick={changed(setAccess)}
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
          name="answer"
          value="deny"
          disabled={busy || !loaded}
          data-testid="connect-deny"
          className={cn(buttonStyles({ variant: 'ghost', size: 'lg' }), 'h-11 px-6')}
        >
          {busy && pressed === 'deny' ? words.denying : words.deny}
        </button>
        <button
          type="submit"
          name="answer"
          value="allow"
          disabled={busy || !armed}
          data-testid="connect-allow"
          className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-11 px-7 font-semibold')}
        >
          {busy && pressed === 'allow' ? words.allowing : words.allow}
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
