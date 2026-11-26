// What a tab and the sync server say to each other: the changes a tab sends and the server orders
// (D2), the messages each side sends, why the server rejects a change set or closes a connection,
// and the limits of the sync core (D11). The server and the editor both read these, so each has one
// meaning.
import { z } from 'zod'

import { isRecord } from './json.ts'
import { Id } from './primitives.ts'
import { RestoreMark } from './versions.ts'

/**
 * The close codes the sync server ends a connection with, by reason; each is in the range a
 * WebSocket leaves to applications.
 */
export const SYNC_CLOSE = {
  /** The connection sent messages faster than the rate limit; the one over it was not applied. */
  tooManyMessages: 4429,
  /** The tab was built with an older schema version than the design's: it must reload to edit it. */
  tabTooOld: 4426,
  /** The connection's token expired and no fresh one came, or the fresh one was refused. */
  tokenExpired: 4440,
  /** A member opened more connections to the design than the limit; the newest was closed. */
  tooManyConnections: 4409,
  /** A message the sync core does not read: malformed, sent before hello, or for another protocol. */
  protocol: 4400,
  /** The server couldn't store the latest changes: the tab reconnects and sends again what wasn't stored. */
  storeFailed: 4503,
  /** The tab connected again on another connection, which takes over: the tab does not reconnect on this one. */
  replaced: 4408,
  /** The server holds as many designs as it may: the tab tries again later. */
  serverBusy: 4507,
  /** The design was deleted while open: the tab does not reconnect. */
  designDeleted: 4410,
} as const
export type SyncClose = keyof typeof SYNC_CLOSE

/** The query parameter of the sync URL that carries the schema version the tab was built with. */
export const TAB_VERSION_PARAM = 'schemaVersion'

/** The query parameter of the sync URL that names the design the tab opens: its token must be for it. */
export const DESIGN_PARAM = 'design'

// ---------------------------------------------------------------------------------------------
// The sync core's wire: the records a design is synced as, the changes that write them, the
// messages between a tab and the sync server, and their limits (#677, D1–D3, D11; C39).

/** The version of the messages a tab and the sync server speak. */
export const PROTOCOL = 1

/**
 * The limits of the sync core, each defined once (C39, D11). A change set may write at most as many
 * records of each part as a design may hold.
 */
export const SYNC_LIMITS = {
  /** A design: its layers, frames, pages and the UTF-8 size of its records' JSON. */
  designLayers: 15_000,
  designFrames: 5_000,
  designPages: 1_000,
  /** A design's sections and connectors (ADR-0024). */
  designSections: 1_000,
  designConnectors: 5_000,
  designBytes: 8 * 1024 * 1024,
  /** The changes one change set holds. */
  changeSetChanges: 60_000,
  /** One message, before it is parsed. */
  messageBytes: 10 * 1024 * 1024,
  /** The share of a design limit at which a tab is warned. */
  warnAt: 0.8,
  /** The catch-up log: past either, a whole-design catch-up is cheaper. */
  logChangeSets: 5_000,
  logBytes: 4 * 1024 * 1024,
  /** Missed change sets × change sets waiting past which a tab catches up with the whole design. */
  catchUpWork: 1_000_000,
  /** A preview's size and how often a tab sends one. */
  previewBytes: 128 * 1024,
  previewsPerSecond: 30,
  /**
   * A presence's size, and how many a second a tab hears from one sender: twice what a tab sends (30
   * a second), so presence bunched on the network is not held back; one that comes sooner waits.
   */
  presenceBytes: 40 * 1024,
  presencePerSecond: 60,
  /** Tab ids a design keeps, and rejected change set ids per tab. */
  tabIds: 4_096,
  rejectedIds: 1_024,
  /** A tab id not connected for this long is dropped first when a design keeps too many. */
  tabIdleMs: 30 * 24 * 60 * 60 * 1000,
  /** The journal is folded into the state past either. */
  foldEntries: 1_000,
  foldBytes: 4 * 1024 * 1024,
  /**
   * How deep a value may nest: twice the deepest a design holds, a stroke whose paint is a gradient
   * (strokes, a stroke, its paint, the stops, a stop).
   */
  valueDepth: 10,
} as const

/** The most selected layer ids a presence carries: the most outlined for one person (FigCraft's `MAX_OUTLINES`). */
export const PRESENCE_SELECTION = 500

/** The longest note a presence carries, in UTF-16 units: FigCraft's cursor chat's 100 characters. */
export const PRESENCE_NOTE = 100

/**
 * The colours people are shown in, as FigCraft's: the server gives each person (a member, or an agent
 * working for one) one by its index, the first no other person connected to the design has.
 */
export const PEOPLE_COLOURS = [
  '#0D99FF',
  '#9747FF',
  '#14AE5C',
  '#F24822',
  '#D9730D',
  '#E83E8C',
  '#00A3A3',
  '#665CE0',
] as const

/** The parts of a design a change names: its meta, a page, a frame, a layer, a section or a connector. */
export const Part = z.enum(['meta', 'page', 'frame', 'layer', 'section', 'connector'])
export type Part = z.infer<typeof Part>

/** The parts a change creates and deletes: a design always has its one meta. */
export const HeldPart = z.enum(['page', 'frame', 'layer', 'section', 'connector'])
export type HeldPart = z.infer<typeof HeldPart>

/** A record's id on the wire: the meta's is `meta`; ids hold no `/`. */
const RecordId = z.string().min(1).max(256)

/**
 * One synced value, replaced whole: a top-level key of a record (`prop` left out), or `prop` names
 * one key of a layer's props (`key` is `props`) or one of its bindings, by bindable property
 * (`key` is `bindings`). A text layer's text and runs are one value, the prop `text`, holding
 * `{text, runs}`, since the schema ties the runs to the text's length (K16).
 */
export const Target = z.strictObject({
  part: Part,
  id: RecordId,
  key: z.string().min(1),
  prop: z.string().min(1).optional(),
})
export type Target = z.infer<typeof Target>

/**
 * One change (D2): a record created whole, rejected while its id is live (C27); a value set, unset
 * when `to` is left out; or a record deleted with everything it holds (deleting what is gone does
 * nothing).
 */
export const Change = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('create'),
    part: HeldPart,
    id: RecordId,
    // Taken as the object JSON gave, uncopied: the sync server parses it whole with the schema
    // of its part when it checks the change set, so a copy here would cost a 15,000-layer paste twice.
    record: z.custom<Record<string, unknown>>(isRecord, 'a record is an object'),
  }),
  z.strictObject({ op: z.literal('set'), value: Target, to: z.unknown().optional() }),
  z.strictObject({ op: z.literal('delete'), part: HeldPart, id: RecordId }),
])
export type Change = z.infer<typeof Change>

/**
 * A design's records as plain JSON, before they are read: any of them possibly not what the schema
 * takes. Its sections and connectors are left out while it holds none, as a design stored before
 * them is, and read as none when absent.
 */
export const DesignRecords = z.strictObject({
  meta: z.record(z.string(), z.unknown()),
  pages: z.record(z.string(), z.unknown()),
  frames: z.record(z.string(), z.unknown()),
  nodes: z.record(z.string(), z.unknown()),
  sections: z.record(z.string(), z.unknown()).optional(),
  connectors: z.record(z.string(), z.unknown()).optional(),
})
export type DesignRecords = z.infer<typeof DesignRecords>

/** What a change set is: a step's edit, its undo or redo, or a follow-up of derived values (D6). */
export const ChangeSetKind = z.enum(['edit', 'undo', 'redo', 'followUp'])
export type ChangeSetKind = z.infer<typeof ChangeSetKind>

/**
 * Why the sync server rejected a change set, as a code the editor shows in words (D3). A rejection
 * goes to its author only and never closes the connection.
 */
export const REJECT_REASONS = [
  /** The tab's member may only view the design (C35). */
  'viewOnly',
  /** The change set names a sequence number the server has not reached. */
  'baseInFuture',
  /** It writes more records of a part than a design may hold, or more changes than a change set may. */
  'tooManyChanges',
  /** A change can't apply: a create of a live id, a set on a record that is gone, or a key with no place. */
  'cannotApply',
  /** A record it writes is not what the schema takes. */
  'invalidRecord',
  /** It breaks a structure rule: a holder, a cycle, a frame's page, the last page, a link held twice. */
  'structure',
  /** An undo's or redo's delete would take what another tab placed after its base (C46). */
  'placedSince',
  /** It grows the design past a limit (D11). */
  'designTooBig',
] as const
export const RejectReason = z.enum(REJECT_REASONS)
export type RejectReason = z.infer<typeof RejectReason>

/** What a tab gives to take its tab id back after a dropped connection (C44). */
export const Resume = z.strictObject({
  syncId: z.string().min(1),
  tabId: z.number().int().min(1),
  /** The last sequence number the tab applied. */
  seq: z.number().int().min(0),
  /** The secret its tab id was given with. */
  secret: z.string().min(1),
})
export type Resume = z.infer<typeof Resume>

/**
 * A preview's change, as a compact tuple (D7): a set, an unset, a create, a delete. `prop` is null
 * for a top-level key.
 */
export const PreviewChange = z.union([
  z.tuple([z.literal('s'), Part, RecordId, z.string(), z.string().nullable(), z.unknown()]),
  z.tuple([z.literal('u'), Part, RecordId, z.string(), z.string().nullable()]),
  z.tuple([z.literal('c'), HeldPart, RecordId, z.record(z.string(), z.unknown())]),
  z.tuple([z.literal('d'), HeldPart, RecordId]),
])
export type PreviewChange = z.infer<typeof PreviewChange>

/**
 * Where a tab's person is and what they have selected, as the other people in the design see it:
 * never stored, ordered or undone, and the latest wins. `pointer` is in page coordinates, null while
 * it is off the stage or the tab is hidden; `frame` is the picked frame; `note` is what an agent says
 * it is doing, shown beside its cursor, which a tab sends only on a connection whose welcome says
 * `presenceNote`: a server without it closes the connection on one.
 */
export const Presence = z.strictObject({
  page: Id,
  pointer: z.tuple([z.number(), z.number()]).nullable(),
  selection: Id.array().max(PRESENCE_SELECTION),
  frame: Id.nullable(),
  note: z.string().max(PRESENCE_NOTE).optional(),
})
export type Presence = z.infer<typeof Presence>

/** The messages a tab sends: the sync server parses each with this before it reads it. */
export const TabMessage = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('hello'),
      protocol: z.number().int(),
      token: z.string().min(1),
      resume: Resume.optional(),
      /** How many change sets the tab's queue holds: with the change sets it missed, it decides the catch-up. */
      waiting: z.number().int().min(0),
    }),
    z.strictObject({
      type: z.literal('changes'),
      /** The change set's id: it counts up per tab id. */
      id: z.number().int().min(1),
      /** The sequence number of the design the change set was made on. */
      base: z.number().int().min(0),
      kind: ChangeSetKind,
      changes: Change.array().max(SYNC_LIMITS.changeSetChanges),
      /** The version a restore puts back: only on the restore's own edit, never its undo or redo. */
      restore: RestoreMark.optional(),
    }),
    z.strictObject({
      type: z.literal('preview'),
      /** The id of the last change set the tab made: the step's comes after it. */
      after: z.number().int().min(0),
      /** The open step's net changes so far; empty clears the preview. */
      changes: PreviewChange.array(),
    }),
    /** Sent only on a connection whose welcome said the server takes presence. */
    z.strictObject({ type: z.literal('presence'), ...Presence.shape }),
    z.strictObject({ type: z.literal('token'), token: z.string().min(1) }),
    z.strictObject({ type: z.literal('ping') }),
    /** Asks for the records of a version of the design. */
    z.strictObject({ type: z.literal('version'), id: Id }),
  ])
  .refine((message) => message.type !== 'changes' || !message.restore || message.kind === 'edit', {
    message: 'a restore mark goes only on an edit change set',
    path: ['restore'],
  })
export type TabMessage = z.infer<typeof TabMessage>

/** What a tab may do with the design: edit it, or only view it. */
export type Access = 'edit' | 'view'

/** A change set the server accepted, with its sequence number, as every tab gets it and the journal stores it. */
export const Accepted = z.strictObject({
  seq: z.number().int().min(1),
  /** The tab id that sent it. */
  author: z.number().int().min(1),
  changeSetId: z.number().int().min(1),
  changes: Change.array(),
})
export type Accepted = z.infer<typeof Accepted>

/** What the server did with a tab's change sets: the last id it took in, and the latest ids it rejected. */
export interface Processed {
  lastChangeSet: number
  rejected: number[]
}

/** What a joining tab missed: the change sets since its sequence number, or the whole design. */
export type CatchUp = { changeSets: Accepted[] } | { design: DesignRecords }

/** A design's size against its limits, told in the welcome and each `accepted` (D11's warning). */
export interface DesignSize {
  layers: number
  frames: number
  pages: number
  sections: number
  connectors: number
  bytes: number
}

/** The messages the sync server sends a tab. */
export type ServerMessage =
  | {
      type: 'welcome'
      syncId: string
      tabId: number
      seq: number
      secret: string
      access: Access
      size: DesignSize
      /** The connected tabs' members' names, by tab id. */
      tabs: Record<number, string>
      processed: Processed
      catchUp: CatchUp
      /** The server takes presence: a tab sends it only when its welcome says so. */
      presence?: true
      /** The server takes a presence's note: a tab sends one only when its welcome says so. */
      presenceNote?: true
    }
  /** To every tab, the author too as its confirmation, once the change set is stored. */
  | ({ type: 'accepted'; size: DesignSize } & Accepted)
  /** To the author only. */
  | { type: 'reject'; changeSetId: number; reason: RejectReason }
  /** Another tab's preview, passed on unchecked but for shape, size and role. */
  | { type: 'preview'; tabId: number; after: number; changes: PreviewChange[] }
  /**
   * Another person's tab's presence: `person` is their number while the design is loaded, the same
   * for each of their tabs, and `colour` their index into `PEOPLE_COLOURS`. `agent` marks an agent's
   * tab, as its token says: an agent is a person of its own, apart from the member it works for.
   */
  | { type: 'presence'; tabId: number; person: number; colour: number; agent?: true; presence: Presence }
  | { type: 'joined'; tabId: number; name: string }
  | { type: 'left'; tabId: number }
  /** Asks for a renewed token. */
  | { type: 'token' }
  | { type: 'access'; access: Access }
  | { type: 'notice'; kind: 'nearLimit'; size: DesignSize }
  /** To every tab but the restorer's, once a restore's change set is stored: who restored which version. */
  | { type: 'restored'; tabId: number; by: string; mark: RestoreMark }
  /** To the tab that asked only: a version's records and the schema version they were stored under; both null for no such version of this design. */
  | { type: 'version'; id: string; schemaVersion: number | null; design: DesignRecords | null }
  | { type: 'pong' }

/** The member a tab is for, as its token says: a user in a workspace. */
export const Member = z.strictObject({ userId: z.string().min(1), workspaceId: z.string().min(1) })
export type Member = z.infer<typeof Member>

/** The change set that last created a record or moved it to another holder: its sequence number and author (C46). */
export const Placed = z.strictObject({ seq: z.number().int().min(1), author: z.number().int().min(1) })
export type Placed = z.infer<typeof Placed>

/** A tab id the server gave out, as stored (D8). */
export const SavedTab = z.strictObject({
  member: Member,
  /** The hash of the secret it resumes with: the secret itself is never stored. */
  secretHash: z.string().min(1),
  /** The last change set id the server took in from it, and the ids it rejected (the latest). */
  lastChangeSet: z.number().int().min(0),
  rejected: z.number().int().min(1).array(),
  /** When it last connected, in milliseconds since the epoch: the tab ids longest gone are dropped first. */
  lastSeen: z.number(),
})
export type SavedTab = z.infer<typeof SavedTab>

/** The state a fold stores: the design, its sync id and sequence number, placements and tab ids (D8). */
export const Saved = z.strictObject({
  /** The identity of the design's stored history: a tab resumes only under the one it knows. */
  syncId: z.string().min(1),
  /** The number of the last journal entry the state holds (0: none). Entries count up for the design's whole life. */
  entry: z.number().int().min(0),
  /** The sequence number of the last change set the state holds. */
  seq: z.number().int().min(0),
  state: DesignRecords,
  placed: z.record(z.string(), Placed),
  /** The tab ids still kept, by id. */
  tabs: z.record(z.string(), SavedTab),
  /** Above every tab id ever given out, so none is given out twice. */
  nextTabId: z.number().int().min(1),
  /** The sequence number at which the design last counted as unchanged: a version taken, or a restore accepted. */
  versioned: z.number().int().min(0),
})
export type Saved = z.infer<typeof Saved>

/** One journal entry: what changed the stored state since the last fold, under its number (D8). */
export const Entry = z.discriminatedUnion('kind', [
  z.strictObject({
    entry: z.number().int().min(1),
    kind: z.literal('issued'),
    tabId: z.number().int().min(1),
    member: Member,
    secretHash: z.string().min(1),
    /** When it was given out, in milliseconds since the epoch: its `lastSeen`. */
    at: z.number(),
    /** The tab ids dropped to keep under the limit when it was given out. */
    dropped: z.number().int().min(1).array(),
  }),
  z.strictObject({
    entry: z.number().int().min(1),
    kind: z.literal('accepted'),
    member: Member,
    changeSet: Accepted,
    /** The change set's message size, which the catch-up log counts. */
    bytes: z.number().int().min(0),
  }),
  z.strictObject({
    entry: z.number().int().min(1),
    kind: z.literal('rejected'),
    tabId: z.number().int().min(1),
    changeSetId: z.number().int().min(1),
  }),
])
export type Entry = z.infer<typeof Entry>

/**
 * The schema version a tab says it was built with, from `TAB_VERSION_PARAM`: a whole number from 1,
 * written plainly; null for anything else, which the sync server refuses as too old.
 */
export function readTabVersion(sent: string | null): number | null {
  if (sent === null || !/^[1-9][0-9]*$/.test(sent)) return null
  const version = Number(sent)
  return Number.isSafeInteger(version) ? version : null
}

/**
 * `text` as a presence's note is shown: control characters as spaces (FigCraft's cursor chat), the
 * characters that change the writing direction taken out, so a note can't turn the words around it,
 * and trimmed.
 */
export function cleanNote(text: string): string {
  return text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim()
}

/** Whether two members are the same user in the same workspace. */
export function sameMember(a: Member, b: Member): boolean {
  return a.userId === b.userId && a.workspaceId === b.workspaceId
}

/**
 * A design's records as the sync core stores them: its sections and connectors only while it holds
 * some, so a design without them is stored as one from before them.
 */
export function designRecords(design: {
  meta: object
  pages: object
  frames: object
  nodes: object
  sections?: object | undefined
  connectors?: object | undefined
}): DesignRecords {
  const { meta, pages, frames, nodes, sections, connectors } = design as DesignRecords
  return {
    meta,
    pages,
    frames,
    nodes,
    ...(sections && Object.keys(sections).length > 0 ? { sections } : {}),
    ...(connectors && Object.keys(connectors).length > 0 ? { connectors } : {}),
  }
}
