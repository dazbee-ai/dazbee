// The API's requests and responses. The API parses every body with these, and the web app reads
// every response with them, so the two can't drift apart.
import { z } from 'zod'

import { BRAND_KIT_LIMITS, BRAND_ROLE_TOKENS, brandRoleOf, LOGO_ROLE } from './brand-roles.ts'
import { BrandTextStyle, brandTextStyleLook } from './brand-text-styles.ts'
import { byCodeUnits, Color } from './primitives.ts'
import { Member } from './sync.ts'
import { brandRef, BrandToken, type Variables } from './variables.ts'

/** Server-made ids of workspaces, brands and designs. A design's id names it on the sync URL too. */
export const RecordId = z.string().regex(/^[\w-]{1,64}$/, 'ids are 1–64 letters, digits, _ and -')
export type RecordId = z.infer<typeof RecordId>

/** The roles a member can have in their workspace (ADR-0012), from the most rights to the fewest. */
export const MEMBER_ROLES = ['owner', 'admin', 'editor', 'reviewer'] as const

/** A member's role in their workspace: an Owner, Admin or Editor changes designs, a Reviewer only reads them. */
export const MemberRole = z.enum(MEMBER_ROLES)
export type MemberRole = z.infer<typeof MemberRole>

/** The roles that can be limited to some of the workspace's brands: an Editor or Reviewer. */
export const LIMITABLE_ROLES = ['editor', 'reviewer'] as const satisfies readonly MemberRole[]

export const WorkspaceSummary = z.object({
  id: RecordId,
  name: z.string(),
})
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>

/** The workspace's new name. */
export const UpdateWorkspace = z.object({
  name: z.string().trim().min(1).max(120),
})
export type UpdateWorkspace = z.infer<typeof UpdateWorkspace>

/**
 * The signed-in person: their id, name and email, the workspaces they are a member of, by name, with their role
 * in each and whether they are limited to some of its brands there, and the workspace to open: the one used
 * last, else the first joined, else null when there is none.
 */
export const Me = z.object({
  id: RecordId,
  name: z.string(),
  email: z.string(),
  workspaces: z.array(WorkspaceSummary.extend({ role: MemberRole, limited: z.boolean() })),
  open: RecordId.nullable(),
})
export type Me = z.infer<typeof Me>

export const BrandSummary = z.object({
  id: RecordId,
  name: z.string(),
})
export type BrandSummary = z.infer<typeof BrandSummary>

export const CreateBrand = z.object({
  name: z.string().trim().min(1).max(120),
  /** The brand's website, kept for reading its kit from it later. */
  website: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional(),
})
export type CreateBrand = z.infer<typeof CreateBrand>

export const DesignSummary = z.object({
  id: RecordId,
  brandId: RecordId,
  name: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type DesignSummary = z.infer<typeof DesignSummary>

/** A design as the editor opens it: its summary, and the member the session is, whose tab copies on this device it takes up (D9). */
export const OpenedDesign = DesignSummary.extend({ member: Member })
export type OpenedDesign = z.infer<typeof OpenedDesign>

export const CreateDesign = z.object({
  name: z.string().trim().min(1).max(120),
  /**
   * The design to start from, checked with parseDesign; its meta.designId and name are replaced
   * by the new design's. Left out, the design starts as one page holding one empty 1080×1080 frame.
   */
  content: z.unknown().optional(),
})
export type CreateDesign = z.infer<typeof CreateDesign>

/** Every error the API sends: a short message a person can read. */
export const ApiError = z.object({
  error: z.string(),
})
export type ApiError = z.infer<typeof ApiError>

/**
 * What deleting the signed-in person's account would do: the workspaces it deletes, those they own alone, and
 * the workspaces they own with other members, which they hand over first; deleting is refused while there
 * are any.
 */
export const AccountDeletion = z.object({
  deletes: z.array(WorkspaceSummary),
  handOver: z.array(WorkspaceSummary),
})
export type AccountDeletion = z.infer<typeof AccountDeletion>

/**
 * Deleting the account, confirmed with the person's email and the workspaces they were shown it deletes,
 * which must still be the ones it deletes.
 */
export const DeleteAccount = z.object({
  email: z.string().trim().max(320),
  deletes: z.array(RecordId).max(1000),
})
export type DeleteAccount = z.infer<typeof DeleteAccount>

/** A refused deletion: why, and the workspaces to hand over first when that is why. */
export const DeleteAccountRefused = ApiError.extend({ handOver: z.array(WorkspaceSummary) })
export type DeleteAccountRefused = z.infer<typeof DeleteAccountRefused>

/** Lets the editor open one design on the sync server until it expires. */
export const SyncToken = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
  /** Who the token is for: a tab kept on this device for another member is never sent with it (C44). */
  member: Member,
})
export type SyncToken = z.infer<typeof SyncToken>

/**
 * Asks for a sync token. An agent's session names the agent its tab is shown as (ADR-0019); a person's
 * session names none.
 */
export const SyncTokenRequest = z.object({ agent: z.string().optional() })
export type SyncTokenRequest = z.infer<typeof SyncTokenRequest>

/**
 * The image types we accept: PNG, JPEG and WebP, decoded with CanvasKit (ADR-0006: images are
 * fills), and SVG, which is never decoded as an image but placed as layers.
 */
export const ImageType = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
export type ImageType = z.infer<typeof ImageType>

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 is 64 lowercase hex digits')

export const AssetSummary = z.object({
  id: RecordId,
  brandId: RecordId,
  sha256: Sha256,
  contentType: ImageType,
  byteSize: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
})
export type AssetSummary = z.infer<typeof AssetSummary>

/** Something of the brand's that shows an asset: a design or a template by its images, or the brand's logo. */
export const AssetUse = z.object({
  kind: z.enum(['design', 'template', 'logo']),
  id: z.string().min(1),
  name: z.string(),
})
export type AssetUse = z.infer<typeof AssetUse>

/** The answer to deleting an asset something still uses: nothing is deleted. */
export const AssetInUse = ApiError.extend({ usedIn: AssetUse.array().min(1) })
export type AssetInUse = z.infer<typeof AssetInUse>

/** Largest original we accept, in bytes. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024
/** The longest side of an image we accept, in pixels. */
export const MAX_IMAGE_SIDE = 16_384
/** The most pixels an image we accept has: 100 million, 400 MB decoded. */
export const MAX_IMAGE_PIXELS = 100_000_000
/** Largest SVG file we accept, in bytes: more is more than a logo or an icon needs. */
export const MAX_SVG_BYTES = 5_000_000

/** Asks to upload an original; the API answers with the asset when it already has those bytes. */
export const StartUpload = z
  .object({
    sha256: Sha256,
    byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    contentType: ImageType,
    /** The asset's name, used when the API records it straight away. */
    name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((u) => u.contentType !== 'image/svg+xml' || u.byteSize <= MAX_SVG_BYTES, {
    message: `An SVG file is at most ${MAX_SVG_BYTES / 1_000_000} MB`,
    path: ['byteSize'],
  })
export type StartUpload = z.infer<typeof StartUpload>

export const UploadTicket = z.union([
  z.object({ asset: AssetSummary, upload: z.null() }),
  /** PUT the bytes to url with these headers, then record the asset with its sha256. */
  z.object({
    asset: z.null(),
    upload: z.object({ url: z.url(), headers: z.record(z.string(), z.string()), expiresAt: z.iso.datetime() }),
  }),
])
export type UploadTicket = z.infer<typeof UploadTicket>

/** What a brand calls an asset (#52). */
export const AssetName = z.string().trim().min(1).max(120)
export type AssetName = z.infer<typeof AssetName>

export const RecordAsset = z.object({ sha256: Sha256, name: AssetName.optional() })
export type RecordAsset = z.infer<typeof RecordAsset>

/** A word a brand finds assets by: lowercase, without spaces at either end (#52). */
export const AssetTag = z.string().trim().toLowerCase().min(1).max(40)
export type AssetTag = z.infer<typeof AssetTag>
/** Most tags one asset has. */
export const MAX_ASSET_TAGS = 20
/** An asset's tags as an ask gives them: at most `MAX_ASSET_TAGS`, kept once each, in the order given. */
const AssetTags = z
  .array(AssetTag)
  .max(MAX_ASSET_TAGS)
  .transform((tags) => [...new Set(tags)])

/** Renames an asset or sets its tags (#52); tags are kept once each, in the order given. */
export const UpdateAsset = z
  .object({
    name: AssetName.optional(),
    tags: AssetTags.optional(),
  })
  .refine((u) => u.name !== undefined || u.tags !== undefined, 'send a name, tags or both')
export type UpdateAsset = z.infer<typeof UpdateAsset>

/** The longest link a picture is added from. */
export const MAX_URL_LENGTH = 2048
/** How long the API takes at most to fetch a picture from a link, redirects and all. */
export const FROM_URL_TIMEOUT_MS = 20_000

/**
 * Adds the picture at an https link to a brand's asset library, under `name` when it is new; `tags` join the
 * asset's own, kept once each.
 */
export const AddAssetFromUrl = z.object({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
  name: AssetName.optional(),
  tags: AssetTags.optional(),
})
export type AddAssetFromUrl = z.infer<typeof AddAssetFromUrl>

/**
 * Adds a file Dazbee bundles and keeps in its storage, such as a picture sticker, to a brand's asset library by its
 * SHA-256, under `name` when it is new; `tags` join the asset's own, kept once each.
 */
export const AddBundledAsset = z.object({
  sha256: Sha256,
  name: AssetName,
  tags: AssetTags.optional(),
})
export type AddBundledAsset = z.infer<typeof AddBundledAsset>

/** How long an upload link works after it is made. */
export const UPLOAD_LINK_MS = 10 * 60 * 1000
/** Where upload links are, on the public address agents reach Dazbee at: the path, then the link's token. */
export const UPLOAD_LINK_PATH = '/uploads/'

/**
 * Asks for a one-time link that adds one file of `contentType` to a brand's asset library, under `name`, or the
 * brand's asset of the same bytes; `tags` join the asset's own.
 */
export const StartUploadLink = z.object({
  contentType: ImageType,
  name: AssetName,
  tags: AddAssetFromUrl.shape.tags,
})
export type StartUploadLink = z.infer<typeof StartUploadLink>

/**
 * An upload link: its path on the public address (`UPLOAD_LINK_PATH` and its token), when it stops working, and the
 * most bytes the file may have. PUT the file's bytes to it, once.
 */
export const UploadLink = z.object({
  path: z.string().startsWith(UPLOAD_LINK_PATH),
  expiresAt: z.iso.datetime(),
  maxBytes: z.number().int().positive(),
})
export type UploadLink = z.infer<typeof UploadLink>

/** A short-lived URL to read something from storage. */
export const SignedLink = z.object({ url: z.url(), expiresAt: z.iso.datetime() })
export type SignedLink = z.infer<typeof SignedLink>

/** The size of a design's cover frame (see `coverFrame`), so a tile takes its shape before its picture loads. */
export const DesignCover = z.object({ width: z.number().int().positive(), height: z.number().int().positive() })
export type DesignCover = z.infer<typeof DesignCover>

/** A design's picture: a short-lived URL, and its cover frame's size. */
export const DesignThumbnail = SignedLink.extend(DesignCover.shape)
export type DesignThumbnail = z.infer<typeof DesignThumbnail>

/** An asset and a short-lived URL to read its original. */
export const AssetLink = z.object({
  asset: AssetSummary,
  url: z.url(),
  expiresAt: z.iso.datetime(),
})
export type AssetLink = z.infer<typeof AssetLink>

/** Where a family comes from: shipped with the app, copied from Google Fonts into our storage, or uploaded by a brand. */
export const FontSource = z.enum(['builtin', 'google', 'upload'])
export type FontSource = z.infer<typeof FontSource>

/** A weight a font file draws, 1 to 1000. */
const FontWeight = z.number().int().min(1).max(1000)

/**
 * One font file: a family in one weight and style, or a variable font's range of weights in one
 * style, whose `weight` is the range's default.
 */
export const FontFace = z
  .object({
    id: RecordId,
    family: z.string().min(1),
    weight: FontWeight,
    weights: z.object({ min: FontWeight, max: FontWeight }).optional(),
    style: z.enum(['normal', 'italic']),
    source: FontSource,
    byteSize: z.number().int().positive(),
  })
  .refine(
    ({ weight, weights }) => !weights || (weights.min <= weight && weight <= weights.max && weights.min < weights.max),
    'a variable face’s weight lies in its range',
  )
export type FontFace = z.infer<typeof FontFace>

/** A family in the catalog, its faces lightest first and upright before italic. */
export const FontFamily = z.object({
  family: z.string().min(1),
  source: FontSource,
  /** Google's category, such as sans-serif or display; null for uploads. */
  category: z.string().nullable(),
  /** A Google family's place in Google Fonts' popularity order, 1 the most used; none for others. */
  rank: z.number().int().positive().optional(),
  /** The writing systems a Google family draws, as ISO 15924 codes such as Latn or Arab; none for others. */
  scripts: z.array(z.string()).optional(),
  faces: FontFace.array().min(1),
})
export type FontFamily = z.infer<typeof FontFamily>

/** The most families one ask for some of a brand's catalog may name, as a design opening asks for its texts'. */
export const MOST_FONT_FAMILIES_ASKED = 100

/** Font files we accept: TrueType and OpenType outlines, which CanvasKit reads itself (#50). */
export const FontType = z.enum(['font/ttf', 'font/otf'])
export type FontType = z.infer<typeof FontType>

/** Largest font file we accept, in bytes; a CJK family's face can be 20 MB. */
export const MAX_FONT_BYTES = 30 * 1024 * 1024

/** Asks to upload a font file; the API answers with the face when the brand already has those bytes. */
export const StartFontUpload = z.object({
  sha256: Sha256,
  byteSize: z.number().int().positive().max(MAX_FONT_BYTES),
  contentType: FontType,
})
export type StartFontUpload = z.infer<typeof StartFontUpload>

export const FontUploadTicket = z.union([
  z.object({ face: FontFace, upload: z.null() }),
  /** PUT the bytes to url with these headers, then record the font with its sha256. */
  z.object({
    face: z.null(),
    upload: z.object({ url: z.url(), headers: z.record(z.string(), z.string()), expiresAt: z.iso.datetime() }),
  }),
])
export type FontUploadTicket = z.infer<typeof FontUploadTicket>

export const RecordFont = z.object({ sha256: Sha256 })
export type RecordFont = z.infer<typeof RecordFont>

/**
 * Where the app serves Google faces' files and previews to anyone, by face id: a face's file never changes (a new
 * file is a new face), so its address never does either, and browsers and Cloudflare keep it for good.
 */
export const GOOGLE_FONT_PATH = '/fonts/google/faces/'

/**
 * Where the app serves Google faces' match copies to anyone, by face id, as `<face id>.ttf`: a face cut to the characters
 * ads use, which the text matcher loads in place of the whole face. A face's copy never changes, so browsers and
 * Cloudflare keep it for good.
 */
export const GOOGLE_MATCH_PATH = '/fonts/google/match/'

/**
 * Where the app serves the Google list, the Google part of the font catalog, to anyone, by the hash of its bytes: the
 * list at one address never changes, so browsers and Cloudflare keep it for good. It is JSON, at a `.js` name because
 * Cloudflare keeps files at its edge by their extension, and `.json` is not one it keeps.
 */
export const GOOGLE_FONT_LIST_PATH = '/fonts/google/lists/'

/**
 * Where the app serves the matchers' files to anyone, by their SHA-256, as `<sha256>.bin`: a file at one address never
 * changes, so browsers and Cloudflare keep it for good; `.bin` is an extension Cloudflare keeps at its edge.
 */
export const MATCHER_FILE_PATH = '/matchers/'

/**
 * A brand's font catalog in its two parts: the address of the Google list, the same for every brand
 * (`googleFontListPath`), and the brand's own uploads. `brandCatalog` joins them.
 */
export const FontCatalogParts = z.object({
  google: z.string().startsWith(GOOGLE_FONT_LIST_PATH),
  uploads: FontFamily.array(),
})
export type FontCatalogParts = z.infer<typeof FontCatalogParts>

/** A face and short-lived URLs to read its file and its preview, the family's name drawn in it as a PNG. */
export const FontLink = z.object({
  face: FontFace,
  url: z.url(),
  previewUrl: z.url(),
  expiresAt: z.iso.datetime(),
})
export type FontLink = z.infer<typeof FontLink>

/** A colour in a brand kit (#53): its token, the name people see, and its value. */
export const BrandColor = z.object({ token: BrandToken, name: z.string().trim().min(1).max(60), value: Color })
export type BrandColor = z.infer<typeof BrandColor>
/** A font in a brand kit (#53), such as the heading or body family. */
export const BrandFont = z.object({
  token: BrandToken,
  name: z.string().trim().min(1).max(60),
  family: z.string().trim().min(1).max(100),
})
export type BrandFont = z.infer<typeof BrandFont>

/** What a kit holds but for its text styles. */
const brandKitFields = {
  colors: BrandColor.array().max(BRAND_KIT_LIMITS.color),
  fonts: BrandFont.array().max(BRAND_KIT_LIMITS.font),
  logoAssetId: RecordId.nullable(),
  voice: z.string().max(2000),
}
const brandTextStyles = BrandTextStyle.array().max(BRAND_KIT_LIMITS.textStyle)

/**
 * A brand's kit (#53): its colours, fonts and text styles, which designs bind to as `brand:<token>`,
 * its logo (an asset of the brand) and its tone of voice. A token names one thing in the kit, and a
 * text style's is never a brand role's. A kit read without text styles has none.
 */
export const BrandKit = z
  .object({ ...brandKitFields, textStyles: brandTextStyles.default(() => []) })
  .superRefine(oneThingPerToken)
export type BrandKit = z.infer<typeof BrandKit>

/**
 * A kit as the API gives it, with when it was last saved: null for a brand that never saved one. A
 * save sends that time back as `basedOn`.
 */
export const StoredBrandKit = z
  .object({ ...brandKitFields, textStyles: brandTextStyles.default(() => []), updatedAt: z.iso.datetime().nullable() })
  .superRefine(oneThingPerToken)
export type StoredBrandKit = z.infer<typeof StoredBrandKit>

/**
 * A kit as a save sends it: one that leaves its text styles out keeps the ones the kit has.
 * `basedOn` is the `updatedAt` of the kit it was made from, and the save is refused when the kit was
 * saved since; one without it, from a tab built before, is never refused for that.
 */
export const SaveBrandKit = z
  .object({
    ...brandKitFields,
    textStyles: brandTextStyles.optional(),
    basedOn: z.iso.datetime().nullable().optional(),
  })
  .superRefine(oneThingPerToken)
export type SaveBrandKit = z.infer<typeof SaveBrandKit>
export const EMPTY_BRAND_KIT: BrandKit = { colors: [], fonts: [], logoAssetId: null, voice: '', textStyles: [] }

/**
 * Who can start from a template (#54): every brand of the workspace (an agency's own templates), or
 * only the brand it was saved for (a client's).
 */
export const TemplateScope = z.enum(['workspace', 'brand'])
export type TemplateScope = z.infer<typeof TemplateScope>

export const TemplateSummary = z.object({
  id: RecordId,
  name: z.string(),
  scope: TemplateScope,
  /** The brand a brand template belongs to; null for a workspace template. */
  brandId: RecordId.nullable(),
  /** The cover frame's size, for the gallery to keep the thumbnail's shape. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.iso.datetime(),
})
export type TemplateSummary = z.infer<typeof TemplateSummary>

/** Saves a design, as the editor holds it now, as a template; the template keeps its own copy. */
export const SaveTemplate = z.object({
  name: z.string().trim().min(1).max(120),
  scope: TemplateScope,
  /** The design, checked with parseDesign. */
  content: z.unknown(),
})
export type SaveTemplate = z.infer<typeof SaveTemplate>

/** A design's or a template's new name. */
export const Rename = z.object({ name: z.string().trim().min(1).max(120) })
export type Rename = z.infer<typeof Rename>

/** Copies a design; named after it with "copy" when no name is given. */
export const DuplicateDesign = z.object({ name: z.string().trim().min(1).max(120).optional() })
export type DuplicateDesign = z.infer<typeof DuplicateDesign>

/** Starts a design of the brand from a template; named after the template when no name is given. */
export const StartFromTemplate = z.object({ name: z.string().trim().min(1).max(120).optional() })
export type StartFromTemplate = z.infer<typeof StartFromTemplate>

// Sign-in (#58). The web app asks the API for WorkOS's sign-in page, hands back the code WorkOS
// returns, and keeps the session token it gets in an httpOnly cookie, sending it as a bearer token.

/** Where to send the person to sign in with WorkOS. */
export const SignInLink = z.object({ url: z.url() })
export type SignInLink = z.infer<typeof SignInLink>

/** The token of a WorkOS invite a sign-in starts from, which the sign-in link carries on so WorkOS accepts it. */
export const InvitationToken = z.string().regex(/^[\w-]{1,256}$/, 'invitationToken: 1–256 letters, digits, _ and -')
export type InvitationToken = z.infer<typeof InvitationToken>

/**
 * Where WorkOS sends a person back after sign-in, when a site other than the web app's own asks, such as the
 * early-access admin page's: an http or https address whose path is `/callback`, with no query. WorkOS refuses one not
 * registered with it.
 */
export const CallbackUrl = z
  .url({ protocol: /^https?$/, error: 'redirectUri: an http or https address' })
  .max(256)
  .refine((url) => /^https?:\/\/[^/?#]+\/callback$/.test(url), 'redirectUri: the path is /callback, with no query')
export type CallbackUrl = z.infer<typeof CallbackUrl>

export const CompleteSignIn = z.object({ code: z.string().min(1).max(512) })
export type CompleteSignIn = z.infer<typeof CompleteSignIn>

/** A session: the token to send as `Authorization: Bearer <token>`, and the workspace to open. */
export const SignedIn = z.object({ token: z.string().min(1), expiresAt: z.number().int(), open: RecordId })
export type SignedIn = z.infer<typeof SignedIn>

/**
 * Why sign-in refused a person while Dazbee is in early access: `open-invite` when they have a pending
 * invite they didn't sign in through, `early-access` otherwise.
 */
export const SignInRefusal = z.enum(['early-access', 'open-invite'])
export type SignInRefusal = z.infer<typeof SignInRefusal>

/** The answer to a sign-in refused during early access: no account or workspace is made. */
export const SignInRefused = ApiError.extend({ reason: SignInRefusal })
export type SignInRefused = z.infer<typeof SignInRefused>

/** Where to send the person to end their WorkOS session too, when they had one. */
export const SignedOut = z.object({ logoutUrl: z.url().nullable() })
export type SignedOut = z.infer<typeof SignedOut>

// Agents (ADR-0019). A member lets an agent into one workspace, to some of its brands or all they see, to
// edit or only view: an agent access, which Settings lists and ends.

/** An agent access as Settings lists it: the client's name, its brands (null for all the member sees), whether it edits, when it was made and last used. */
export const AgentAccessSummary = z.object({
  id: RecordId,
  clientName: z.string(),
  brandIds: z.array(RecordId).nullable(),
  writes: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
})
export type AgentAccessSummary = z.infer<typeof AgentAccessSummary>

/** What every agent access token starts with. */
export const ACCESS_TOKEN_PREFIX = 'dazbee_at_'

/** Who an agent's token is: its access's id, workspace, brands (null for all the member sees), whether it edits, and the client's name. */
export const AgentMe = z.object({
  id: RecordId,
  workspaceId: RecordId,
  brandIds: z.array(RecordId).nullable(),
  writes: z.boolean(),
  clientName: z.string(),
})
export type AgentMe = z.infer<typeof AgentMe>

/** Whether an asset is an SVG file, placed as layers rather than as an image fill. */
export const isVectorAsset = (asset: { contentType: ImageType }) => asset.contentType === 'image/svg+xml'

/** The most bytes a file of `type` may have: an SVG file `MAX_SVG_BYTES`, a picture `MAX_UPLOAD_BYTES`. */
export const maxBytesOf = (type: ImageType): number => (type === 'image/svg+xml' ? MAX_SVG_BYTES : MAX_UPLOAD_BYTES)

/**
 * The values a kit gives its tokens, for drawing designs bound to them: each colour, font and text
 * style's look, its font resolved through the kit. With the kit's logo asset,
 * `brand:logo` is its id when it is an image; an SVG file can't be a fill, so it gives none. The
 * logo's token is reserved: it is the logo's even where a kit holds a colour or font with it, which
 * a layer bound to it then keeps as it stores it.
 */
export const brandVariables = (kit: BrandKit, logo?: Pick<AssetSummary, 'id' | 'contentType'>): Variables =>
  Object.fromEntries([
    ...kit.colors.map((c) => [brandRef(c.token), c.value]),
    ...kit.fonts.map((f) => [brandRef(f.token), f.family]),
    ...kit.textStyles.map((style) => [brandRef(style.token), brandTextStyleLook(kit, style)]),
    ...(logo && logo.id === kit.logoAssetId && !isVectorAsset(logo) ? [[brandRef(LOGO_ROLE), logo.id]] : []),
  ])

/** Whether a member with `role` may change a design: an Owner, Admin or Editor can, a Reviewer only reads. */
export function roleWrites(role: MemberRole): boolean {
  return role !== 'reviewer'
}

/** Whether a member with `role` manages the workspace itself, such as renaming it: an Owner or Admin. */
export function roleManages(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin'
}

/** Whether a member with `role` can be limited to some of the workspace's brands: an Editor or Reviewer. */
export function roleLimitable(role: MemberRole): boolean {
  return (LIMITABLE_ROLES as readonly MemberRole[]).includes(role)
}

/**
 * The weights a face draws, which the weight menu offers: a face of one weight, that weight; a
 * variable face, the hundreds within its range, with its ends and its default where they are not.
 */
export function faceWeights(face: { weight: number; weights?: { min: number; max: number } | undefined }): number[] {
  const range = face.weights
  if (!range) return [face.weight]
  const weights = new Set([range.min, face.weight, range.max])
  for (let w = Math.ceil(range.min / 100) * 100; w <= range.max; w += 100) weights.add(w)
  return [...weights].sort((a, b) => a - b)
}

/**
 * A Google face's file, preview and match copy at their permanent addresses (`GOOGLE_FONT_PATH`, `GOOGLE_MATCH_PATH`);
 * null for a brand's upload, which loads through its brand, and a font we ship.
 */
export function googleFacePaths(face: {
  id: string
  source: FontSource
}): { file: string; preview: string; match: string } | null {
  if (face.source !== 'google') return null
  return {
    file: `${GOOGLE_FONT_PATH}${face.id}.ttf`,
    preview: `${GOOGLE_FONT_PATH}${face.id}.png`,
    match: `${GOOGLE_MATCH_PATH}${face.id}.ttf`,
  }
}

/** The address of the Google list whose bytes hash to `hash`, kept for good (`GOOGLE_FONT_LIST_PATH`). */
export const googleFontListPath = (hash: string) => `${GOOGLE_FONT_LIST_PATH}${hash}.js`

/** The address of the matchers' file whose bytes hash to `sha256`, kept for good (`MATCHER_FILE_PATH`). */
export const matcherFilePath = (sha256: string) => `${MATCHER_FILE_PATH}${sha256}.bin`

/**
 * The families a brand can use, by name in code-unit order: the Google list's and the brand's uploads, where a brand's
 * upload of a family Google also has is the one the brand sees.
 */
export function brandCatalog(google: readonly FontFamily[], uploads: readonly FontFamily[]): FontFamily[] {
  const uploaded = new Set(uploads.map((family) => family.family))
  return [...google.filter((family) => !uploaded.has(family.family)), ...uploads].sort((a, b) =>
    byCodeUnits(a.family, b.family),
  )
}

/**
 * Refuses a kit where one token names two things, a text style takes a brand role's token, the
 * logo's included, or a style follows a token that names no font: `brand:<token>` names one value.
 */
function oneThingPerToken(
  kit: { colors: BrandColor[]; fonts: BrandFont[]; textStyles?: BrandTextStyle[] | undefined },
  ctx: z.RefinementCtx,
) {
  const styles = kit.textStyles ?? []
  const seen = new Set<string>()
  for (const { token } of [...kit.colors, ...kit.fonts, ...styles]) {
    if (seen.has(token)) ctx.addIssue({ code: 'custom', message: `the token "${token}" names two things` })
    seen.add(token)
  }
  const notFonts = new Set([...kit.colors, ...styles].map((x) => x.token))
  for (const { token, font } of styles) {
    if (BRAND_ROLE_TOKENS.includes(token))
      ctx.addIssue({ code: 'custom', message: `the token "${token}" is a brand role's` })
    if (
      'token' in font &&
      (notFonts.has(font.token) || (BRAND_ROLE_TOKENS.includes(font.token) && !brandRoleOf('font', font.token)))
    )
      ctx.addIssue({ code: 'custom', message: `the text style "${token}" follows "${font.token}", which is no font` })
  }
}
