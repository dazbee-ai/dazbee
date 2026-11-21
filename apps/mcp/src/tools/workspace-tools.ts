// The tools that need no open design: the access's brands, a brand's designs and images, a new design, a picture
// added from a link, and the one-time link a file on the agent's machine is uploaded to.
import { z } from 'zod'

import {
  AddAssetFromUrl,
  type AssetSummary,
  MAX_ASSET_TAGS,
  MAX_SVG_BYTES,
  MAX_UPLOAD_BYTES,
  RecordId,
  StartUploadLink,
  UPLOAD_LINK_MS,
} from '@dazbee/schema'

import { ApiRefusal } from '../api.ts'
import { inSeconds } from '../limits.ts'
import { defineTool, type Tool, ToolRefusal, WithNotes } from './define-tool.ts'

/** A brand's id, as `list_brands` gives it. */
export const BrandId = RecordId.describe('The brand’s id, as list_brands gives it')

/** What a new design's answer tells the agent to do next. */
const AFTER_CREATE =
  'Next: open_design it, and read ad_rules for each size you will make (with the kind of ad) before you design.'

/** What an upload link's answer tells the agent about sending the file. */
const AFTER_UPLOAD_LINK = `Send the file once, within ${UPLOAD_LINK_MS / 60_000} minutes: its answer is the image as JSON (id, name, type, size), checked as a person’s upload is, or {"error": a sentence}. A used or expired link, a file too big or of another type is refused: ask upload_image for a new link. Then place it with place_asset; list_assets finds it by its name.`

export const WORKSPACE_TOOLS: Tool[] = [
  defineTool({
    name: 'list_brands',
    title: 'List brands',
    description:
      'Lists the brands this agent may open, each with its id and name. A brand holds designs, images and its brand kit; start here to find the brand you are asked to work in.',
    readOnly: true,
    input: z.object({}),
    run: async (_input, { api }) => (await api.brands()).map(({ id, name }) => ({ id, name })),
  }),
  defineTool({
    name: 'list_designs',
    title: 'List designs',
    description:
      'Lists a brand’s designs, each with its id, name and when it was last changed (ISO 8601), so you can find the design you are asked to work on.',
    readOnly: true,
    input: z.object({ brand: BrandId }),
    run: async ({ brand }, { api }) =>
      (await api.designs(brand)).map(({ id, name, updatedAt }) => ({ id, name, updated: updatedAt })),
  }),
  defineTool({
    name: 'list_assets',
    title: 'List images',
    description:
      'Lists a brand’s images and SVG files, each with its id, name, tags, type and size in pixels, to place a product photo or the logo. `query` keeps those whose name or a tag holds it.',
    readOnly: true,
    input: z.object({
      brand: BrandId,
      query: z.string().max(200).optional().describe('A part of a name or tag to look for, at most 200 characters'),
    }),
    run: async ({ brand, query }, { api }) => (await api.assets(brand, query)).map(listedImage),
  }),
  defineTool({
    name: 'create_design',
    title: 'Create a design',
    description:
      'Makes a new design in a brand, holding one page with an empty 1080×1080 frame, and answers its id and name, and what to do next. Needs an access that edits.',
    readOnly: false,
    input: z.object({
      brand: BrandId,
      name: z.string().trim().min(1).max(120).describe('The design’s name, 1 to 120 characters'),
    }),
    run: async ({ brand, name }, { api, takeDesign }) => {
      const counted = takeDesign()
      if (typeof counted === 'number')
        throw new ToolRefusal(
          `This agent has made as many designs as it may in an hour; try again in ${inSeconds(counted)}`,
        )
      try {
        const design = await api.createDesign(brand, name)
        return new WithNotes({ id: design.id, name: design.name }, [AFTER_CREATE])
      } catch (error) {
        counted()
        throw viewOnly(error, 'make one')
      }
    },
  }),
  defineTool({
    name: 'add_image',
    title: 'Add an image from a link',
    description: `Adds the picture at an https link (PNG, JPEG, WebP or SVG, at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB) to a brand’s images, as a person’s upload is, and answers it as list_assets does, with the id to place it by. The same picture twice gives the same image, keeping its name, with the tags given added. A link Dazbee can’t use (a private address, a site that refuses, a web page rather than a picture, too big) comes back as a sentence: ask the person for another link. Needs an access that edits.`,
    readOnly: false,
    openWorld: true,
    input: z.object({
      brand: BrandId,
      link: AddAssetFromUrl.shape.url.describe(
        'The picture’s own https link, such as https://example.com/shoe.jpg, not the page that shows it',
      ),
      name: AddAssetFromUrl.shape.name.describe(
        'The image’s name among the brand’s images; left out, the link’s file name',
      ),
      tags: AddAssetFromUrl.shape.tags.describe(
        `Words the image is found by, such as "product": at most ${MAX_ASSET_TAGS}`,
      ),
    }),
    run: async ({ brand, link, name, tags }, { api }) => {
      try {
        const asset = await api.addAssetFromUrl(brand, {
          url: link,
          ...(name === undefined ? {} : { name }),
          ...(tags === undefined ? {} : { tags }),
        })
        return listedImage(asset)
      } catch (error) {
        throw viewOnly(error, 'add an image')
      }
    },
  }),
  defineTool({
    name: 'upload_image',
    title: 'Upload an image from this machine',
    description: `Answers a one-time link that adds one file from the person’s machine to a brand’s images, as a person’s upload is: a PNG, JPEG or WebP of at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB, or an SVG of at most ${MAX_SVG_BYTES / 1_000_000} MB, of the type given. Send the file to the link within ${UPLOAD_LINK_MS / 60_000} minutes with the command the answer gives (curl -T); its answer is the image, with the id to place it by. Only for an agent that runs commands on the machine holding the file; otherwise use add_image with a link. Needs an access that edits.`,
    readOnly: false,
    input: z.object({
      brand: BrandId,
      name: StartUploadLink.shape.name.describe('The image’s name among the brand’s images, 1 to 120 characters'),
      type: StartUploadLink.shape.contentType.describe(
        'The file’s type: image/png, image/jpeg, image/webp or image/svg+xml; a file of another type is refused',
      ),
      tags: StartUploadLink.shape.tags.describe(
        `Words the image is found by, such as "product": at most ${MAX_ASSET_TAGS}`,
      ),
    }),
    run: async ({ brand, name, type, tags }, { api, baseUrl }) => {
      try {
        const upload = await api.uploadLink(brand, { contentType: type, name, ...(tags === undefined ? {} : { tags }) })
        const link = `${baseUrl}${upload.path}`
        return new WithNotes(
          {
            link,
            expires: upload.expiresAt,
            maxBytes: upload.maxBytes,
            send: `curl -sS -T '<path of the file>' '${link}'`,
          },
          [AFTER_UPLOAD_LINK],
        )
      } catch (error) {
        throw viewOnly(error, 'upload an image')
      }
    },
  }),
]

/** An image as list_assets and add_image answer it. */
export function listedImage({ id, name, tags, contentType, width, height }: AssetSummary) {
  return { id, name, tags, type: contentType, width, height }
}

/**
 * `error` as the tool's refusal: the API's 403 to an agent that may only view, saying it can't `action`; any other
 * error as it is.
 */
export function viewOnly(error: unknown, action: string): unknown {
  if (!(error instanceof ApiRefusal) || error.status !== 403) return error
  return new ToolRefusal(
    `This agent may only view designs, so it can’t ${action}: its access only views, or the member who connected it is a Reviewer. The person who connected it can connect it again to edit, if their role edits`,
  )
}
