// The database's tables. Every row of a workspace's records has its workspace, and every design and asset a
// brand of that workspace (ADR-0011); the API scopes every query by them. Early access's Dazbee invites and
// waiting list belong to no workspace. Each change comes with its migration (docs/agents/code-layout.md, Data).
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { type BrandTextStyle, INVITE_ROLES, LIMITABLE_ROLES, MEMBER_ROLES, VersionKind } from '@dazbee/schema'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
})

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const workspaces = pgTable('workspaces', {
  id: text().primaryKey(),
  name: text().notNull(),
  /** Its WorkOS organization (#58); null for the development workspace. */
  workosOrganizationId: text('workos_organization_id').unique(),
  createdAt: createdAt(),
})

/** A person who signed in with WorkOS (#58), known by their WorkOS user id. */
export const users = pgTable('users', {
  id: text().primaryKey(),
  workosUserId: text('workos_user_id').notNull().unique(),
  email: text().notNull(),
  name: text().notNull().default(''),
  createdAt: createdAt(),
})

/**
 * A person's place in a workspace (#58, ADR-0011): one per workspace they belong to, with their role.
 * Every request in a workspace is checked against one of these; removing it refuses the person's next.
 */
export const memberships = pgTable(
  'memberships',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text({ enum: MEMBER_ROLES }).notNull(),
    createdAt: createdAt(),
    // When the person last opened the workspace, so sign-in opens it again; null until their first visit.
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    // Whether the member sees only the brands in their membership_brands rows, none when there are none;
    // only an Editor or Reviewer is limited.
    limited: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('memberships_user').on(t.userId),
    // A workspace has at most one Owner: handing over demotes the Owner before it promotes the Admin.
    uniqueIndex('memberships_one_owner')
      .on(t.workspaceId)
      .where(sql`${t.role} = 'owner'`),
    // Only an Editor or Reviewer is limited to some brands; an Owner or Admin sees every brand.
    check(
      'memberships_limited_role',
      sql`not ${t.limited} or ${t.role} in (${sql.raw(LIMITABLE_ROLES.map((role) => `'${role}'`).join(', '))})`,
    ),
  ],
)

/**
 * An Owner's or Admin's invite of an email to their workspace, with a role. It is being sent while it has
 * no provider id yet, and pending once sent while it is neither accepted nor revoked and `expires_at` is
 * ahead; at most one per workspace and email is either, which the API checks in the transaction that
 * writes. Accepted and revoked invites are kept with their date.
 */
export const invites = pgTable(
  'invites',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Lower-cased. */
    email: text().notNull(),
    role: text({ enum: INVITE_ROLES }).notNull(),
    /** The brands the invite limits its Editor or Reviewer to; null for every brand. */
    brandIds: jsonb('brand_ids').$type<string[]>(),
    /** Who invited; null once that person is gone. */
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    /** The invite's id with its provider: WorkOS's invitation, or the development stand-in's; null while being sent. */
    providerInviteId: text('provider_invite_id'),
    /** The link that accepts it; null while being sent. */
    link: text(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('invites_workspace_email').on(t.workspaceId, t.email), index('invites_email').on(t.email)],
)

/**
 * An admin's invite of an email to Dazbee during early access, a Dazbee invite: a provider's invitation to
 * no organization, whose person signs up and gets a workspace of their own. Its states are a workspace
 * invite's: being sent while it has no provider id, pending once sent while it is neither accepted nor
 * revoked and `expires_at` is ahead, then accepted, revoked or expired. At most one per email is being sent
 * or pending, which the API checks in the transaction that writes. An accepted one with `removed_at` is a
 * person whose access an admin removed: sign-in refuses them and the API answers their requests with 401.
 */
export const dazbeeInvites = pgTable(
  'dazbee_invites',
  {
    id: text().primaryKey(),
    /** Lower-cased. */
    email: text().notNull(),
    /** The admin who invited; null once that person is gone. */
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    /** The invite's id with its provider: WorkOS's invitation, or the development stand-in's; null while being sent. */
    providerInviteId: text('provider_invite_id'),
    /** The link that accepts it; null while being sent. */
    link: text(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('dazbee_invites_email').on(t.email)],
)

/**
 * A request to join Dazbee, sent from /login during early access: the waiting list. One per email, which a
 * new request updates; `invited_at` is set once an admin sends its email a Dazbee invite.
 */
export const accessRequests = pgTable('access_requests', {
  id: text().primaryKey(),
  /** Lower-cased. */
  email: text().notNull().unique(),
  name: text().notNull(),
  company: text().notNull(),
  /** What they will make with Dazbee; empty when they left it out. */
  note: text().notNull().default(''),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
})

/**
 * What a deleted account still has outside the database: a storage folder, a WorkOS organization, user or
 * invitation.
 */
export const PENDING_DELETION_KINDS = [
  'storage-folder',
  'workos-organization',
  'workos-user',
  'workos-invitation',
] as const
export type PendingDeletionKind = (typeof PENDING_DELETION_KINDS)[number]

/**
 * One thing outside the database that deleting an account left to delete, written in the transaction that
 * deletes the account's rows and deleted once it is done. The API deletes each after that transaction
 * commits, and again when it starts, so a failure outside the database is tried until it works.
 */
export const pendingDeletions = pgTable(
  'pending_deletions',
  {
    id: text().primaryKey(),
    kind: text({ enum: PENDING_DELETION_KINDS }).notNull(),
    /** The storage folder's prefix, ending in `/`, or the WorkOS id. */
    target: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'pending_deletions_kind',
      sql`${t.kind} in (${sql.raw(PENDING_DELETION_KINDS.map((kind) => `'${kind}'`).join(', '))})`,
    ),
  ],
)

export const brands = pgTable(
  'brands',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text().notNull(),
    // The brand's website, given when it was added, for reading its kit later; null when none was.
    website: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('brands_workspace').on(t.workspaceId),
    // Lets designs require that their brand belongs to their workspace.
    unique('brands_id_workspace').on(t.id, t.workspaceId),
  ],
)

/**
 * A brand a limited member may see, one row each. It goes with the membership or the brand, so a
 * member's limit never names a brand that is gone.
 */
export const membershipBrands = pgTable(
  'membership_brands',
  {
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    brandId: text('brand_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.brandId] }),
    foreignKey({
      name: 'membership_brands_membership',
      columns: [t.workspaceId, t.userId],
      foreignColumns: [memberships.workspaceId, memberships.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'membership_brands_brand_in_workspace',
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brands.id, brands.workspaceId],
    }).onDelete('cascade'),
  ],
)

export const designs = pgTable(
  'designs',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    brandId: text('brand_id').notNull(),
    name: text().notNull(),
    // The schema version (@dazbee/schema's SCHEMA_VERSION) the design is at, written when it is
    // created; a sync token carries it, and the sync server refuses a tab built before it.
    schemaVersion: integer('schema_version').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('designs_workspace_brand').on(t.workspaceId, t.brandId),
    foreignKey({
      name: 'designs_brand_in_workspace',
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brands.id, brands.workspaceId],
    }),
  ],
)

/**
 * The design as the sync server stores it (D8): the state last folded, under its sync id,
 * and the fence every write moves. Folded state is the design's records as JSON.
 */
export const designSaves = pgTable('design_saves', {
  designId: text('design_id')
    .primaryKey()
    .references(() => designs.id, { onDelete: 'cascade' }),
  syncId: text('sync_id').notNull(),
  /** The last journal entry the state holds. */
  entry: bigint({ mode: 'number' }).notNull(),
  /** The sequence number of the last change set the state holds. */
  seq: bigint({ mode: 'number' }).notNull(),
  /** The fence: the last entry any write stored. A write names it, and fails when it moved. */
  lastEntry: bigint('last_entry', { mode: 'number' }).notNull(),
  state: bytea().notNull(),
  placed: jsonb().notNull(),
  tabs: jsonb().notNull(),
  nextTabId: integer('next_tab_id').notNull(),
  /** The sequence number at which the design last counted as unchanged: a version taken, or a restore accepted. */
  versioned: bigint('versioned_seq', { mode: 'number' }).notNull(),
  updatedAt: updatedAt(),
})

/**
 * A design's version history: the design's records as the server stored them at one moment, named
 * by a member or taken automatically. Deleted with the design, its picture with it.
 */
export const designVersions = pgTable(
  'design_versions',
  {
    id: text().primaryKey(),
    designId: text('design_id')
      .notNull()
      .references(() => designs.id, { onDelete: 'cascade' }),
    kind: text({ enum: VersionKind.options as [VersionKind, ...VersionKind[]] }).notNull(),
    name: text().notNull().default(''),
    description: text().notNull().default(''),
    /** Who named it; null for an automatic version, or once that person is gone. */
    savedBy: text('saved_by').references(() => users.id, { onDelete: 'set null' }),
    /** The design's sync id and sequence number when it was taken. */
    syncId: text('sync_id').notNull(),
    seq: bigint({ mode: 'number' }).notNull(),
    /** The schema version its records were stored under. */
    schemaVersion: integer('schema_version').notNull(),
    /** The design's records as JSON. */
    state: bytea().notNull(),
    /** Its picture as PNG bytes; null until first drawn. */
    thumbnail: bytea(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('design_versions_design_taken').on(t.designId, t.takenAt),
    check(
      'design_versions_kind',
      sql`${t.kind} in (${sql.raw(VersionKind.options.map((kind) => `'${kind}'`).join(', '))})`,
    ),
  ],
)

/** The kinds of journal entry: a tab id given out, a change set accepted, one rejected. */
const ENTRY_KINDS = ['issued', 'accepted', 'rejected'] as const

/** The columns a journal entry is stored with, live or dead. */
const journalColumns = () => ({
  designId: text('design_id')
    .notNull()
    .references(() => designs.id, { onDelete: 'cascade' }),
  entry: bigint({ mode: 'number' }).notNull(),
  kind: text({ enum: ENTRY_KINDS }).notNull(),
  /** Who wrote it (`userId`, `workspaceId`); null for a rejection, which holds ids only. */
  member: jsonb(),
  /** The whole entry as JSON. */
  body: bytea().notNull(),
  createdAt: createdAt(),
})

/** What changed a design's stored state since its last fold, entry by entry (D8). */
export const designJournal = pgTable('design_journal', journalColumns(), (t) => [
  primaryKey({ columns: [t.designId, t.entry] }),
  check('design_journal_kind', sql`${t.kind} in ('issued', 'accepted', 'rejected')`),
])

/** Journal entries that no longer applied when their design opened, with why (D8, C43). */
export const designJournalDead = pgTable(
  'design_journal_dead',
  {
    ...journalColumns(),
    error: text().notNull(),
    movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.designId, t.entry] })],
)

/**
 * An image a brand uploaded. The original is stored once per workspace under its SHA-256
 * (workspaces/<workspace>/originals/<sha256>), with a small copy for the asset library next to it
 * (workspaces/<workspace>/thumbnails/<sha256>); each brand that uploads it gets one asset row, with
 * its own name and tags (#52).
 */
export const assets = pgTable(
  'assets',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    brandId: text('brand_id').notNull(),
    sha256: text().notNull(),
    contentType: text('content_type', { enum: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] }).notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    /** What the brand calls it; the file's name when it was uploaded. */
    name: text().notNull().default(''),
    /** Lowercase words the brand searches by, each once. */
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    /**
     * When the brand deleted it from its library. A deleted asset is no longer listed, but a design
     * that still names it (brought back by undo, or from a tab not yet saved) still draws it, and
     * uploading the same bytes again brings it back.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('assets_brand_sha256').on(t.brandId, t.sha256),
    foreignKey({
      name: 'assets_brand_in_workspace',
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brands.id, brands.workspaceId],
    }),
  ],
)

/**
 * A brand's kit (#53): the colours, fonts and text styles designs bind to as `brand:<token>`, its
 * logo and its tone of voice. One row per brand, made the first time the kit is saved.
 */
export const brandKits = pgTable(
  'brand_kits',
  {
    brandId: text('brand_id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    colors: jsonb().$type<{ token: string; name: string; value: string }[]>().notNull().default([]),
    fonts: jsonb().$type<{ token: string; name: string; family: string }[]>().notNull().default([]),
    logoAssetId: text('logo_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    voice: text().notNull().default(''),
    textStyles: jsonb('text_styles').$type<BrandTextStyle[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'brand_kits_brand_in_workspace',
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brands.id, brands.workspaceId],
    }),
  ],
)

/**
 * A design saved to start others from (#54): its own copy of the document, as it was saved, and a
 * thumbnail in storage (workspaces/<workspace>/templates/<id>.png). A workspace template (no brand)
 * is for every brand of the workspace; a brand template for that brand only. Its images are assets
 * of the brand it was saved from; a design started in another brand gets its own assets of them.
 */
export const templates = pgTable(
  'templates',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    /** Null for a workspace template. */
    brandId: text('brand_id'),
    /** The brand whose design it was saved from, which owns the assets its images name. */
    fromBrandId: text('from_brand_id').notNull(),
    name: text().notNull(),
    content: jsonb().notNull(),
    /** The size of its cover frame, so a tile takes its shape before its thumbnail loads. */
    width: integer().notNull(),
    height: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('templates_workspace').on(t.workspaceId),
    foreignKey({
      name: 'templates_brand_in_workspace',
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brands.id, brands.workspaceId],
    }),
    foreignKey({
      name: 'templates_from_brand_in_workspace',
      columns: [t.fromBrandId, t.workspaceId],
      foreignColumns: [brands.id, brands.workspaceId],
    }),
  ],
)

/**
 * One font file (#50): a family in one weight and style, or a variable font's range of weights in
 * one style (its weight is the range's default). Google Fonts faces are shared by every workspace
 * and have no workspace or brand (stored at fonts/google/<sha256>); a brand's uploads are its own
 * (workspaces/<workspace>/fonts/<sha256>). A family name is unique per brand, weight and style, so
 * uploading a face again replaces it.
 */
export const fontFaces = pgTable(
  'font_faces',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    brandId: text('brand_id'),
    source: text({ enum: ['google', 'upload'] }).notNull(),
    family: text().notNull(),
    weight: integer().notNull(),
    /** A variable font's lightest and heaviest weight; both null for a font of one weight. */
    weightMin: integer('weight_min'),
    weightMax: integer('weight_max'),
    style: text({ enum: ['normal', 'italic'] }).notNull(),
    /** Google's category, such as serif; null for uploads. */
    category: text(),
    sha256: text().notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('font_faces_face').on(t.workspaceId, t.brandId, t.family, t.weight, t.style).nullsNotDistinct(),
    index('font_faces_brand').on(t.workspaceId, t.brandId),
    foreignKey({
      name: 'font_faces_brand_in_workspace',
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brands.id, brands.workspaceId],
    }),
    check(
      'font_faces_weights',
      sql`(${t.weightMin} is null and ${t.weightMax} is null) or (${t.weightMin} <= ${t.weight} and ${t.weight} <= ${t.weightMax} and ${t.weightMin} < ${t.weightMax})`,
    ),
    check(
      'font_faces_scope',
      sql`(${t.source} = 'google' and ${t.workspaceId} is null and ${t.brandId} is null) or (${t.source} = 'upload' and ${t.workspaceId} is not null and ${t.brandId} is not null)`,
    ),
  ],
)

/**
 * A program that registered to sign agents in through OAuth (ADR-0019), such as Claude Code: its name and
 * the addresses it may be sent back to. Registration is open, so a name is the client's own word.
 */
export const agentClients = pgTable('agent_clients', {
  id: text().primaryKey(),
  name: text().notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: createdAt(),
})

/**
 * An agent access (ADR-0019): what a member let one agent do in one workspace: the brands it may open, a list
 * or null for every brand the member sees, and whether it writes. It never reaches more than the membership
 * does, read again on every request. It goes with the person or the workspace, and is marked ended when the
 * member ends it, leaves or is removed, so being invited back brings none back.
 */
export const agentAccesses = pgTable(
  'agent_accesses',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandIds: jsonb('brand_ids').$type<string[]>(),
    writes: boolean().notNull(),
    /** The client that signed the agent in; null once its registration is gone, when the name still names it. */
    clientId: text('client_id').references(() => agentClients.id, { onDelete: 'set null' }),
    clientName: text('client_name').notNull(),
    createdAt: createdAt(),
    /** When a token of it was last taken, written at most once a minute; null until its first use. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('agent_accesses_member').on(t.workspaceId, t.userId)],
)

/** The kinds of agent token: an access token, sent with each request, and the refresh token that renews it. */
const AGENT_TOKEN_KINDS = ['access', 'refresh'] as const

/**
 * A token of an agent access, kept only as the SHA-256 of the token, so no row holds a token. A refresh token
 * is swapped once for a new pair; `swapped_at` says when.
 */
export const agentTokens = pgTable(
  'agent_tokens',
  {
    hash: text().primaryKey(),
    accessId: text('access_id')
      .notNull()
      .references(() => agentAccesses.id, { onDelete: 'cascade' }),
    kind: text({ enum: AGENT_TOKEN_KINDS }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    swappedAt: timestamp('swapped_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('agent_tokens_access').on(t.accessId),
    check('agent_tokens_kind', sql`${t.kind} in (${sql.raw(AGENT_TOKEN_KINDS.map((kind) => `'${kind}'`).join(', '))})`),
  ],
)

/** The kinds of agent authorization: a person's sign-in request waiting for their consent, and the code it gives. */
const AGENT_AUTHORIZATION_KINDS = ['request', 'code'] as const

/**
 * An agent's sign-in (ADR-0019), kept only as the SHA-256 of its random id, so no row holds one. A request
 * holds what the client asked for (its redirect URI, state and PKCE challenge) while the person decides; their
 * consent swaps it for a code, which holds their choice too (who, the workspace, brands and writing) and is
 * swapped once for the access and its first tokens.
 */
export const agentAuthorizations = pgTable(
  'agent_authorizations',
  {
    hash: text().primaryKey(),
    kind: text({ enum: AGENT_AUTHORIZATION_KINDS }).notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => agentClients.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    /** The client's `state`, given back with the code; null when it gave none. */
    state: text(),
    /** The PKCE challenge, S256 of the client's verifier. */
    codeChallenge: text('code_challenge').notNull(),
    /** A code's person and workspace; null for a request. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /** A code's brands, or null for every brand the member sees, as an access's. */
    brandIds: jsonb('brand_ids').$type<string[]>(),
    writes: boolean(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** The access a code was swapped for, which a second use of the code ends; null until then. */
    accessId: text('access_id').references(() => agentAccesses.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('agent_authorizations_expires').on(t.expiresAt),
    check(
      'agent_authorizations_kind',
      sql`${t.kind} in (${sql.raw(AGENT_AUTHORIZATION_KINDS.map((kind) => `'${kind}'`).join(', '))})`,
    ),
  ],
)
