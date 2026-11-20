// The tools that need no open design: the access's brands, a brand's designs and images, and a new design.
import { z } from 'zod'

import { RecordId } from '@dazbee/schema'

import { ApiRefusal } from '../api.ts'
import { inSeconds } from '../limits.ts'
import { defineTool, type Tool, ToolRefusal } from './define-tool.ts'

/** A brand's id, as `list_brands` gives it. */
const BrandId = RecordId.describe('The brand’s id, as list_brands gives it')

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
    run: async ({ brand, query }, { api }) =>
      (await api.assets(brand, query)).map(({ id, name, tags, contentType, width, height }) => ({
        id,
        name,
        tags,
        type: contentType,
        width,
        height,
      })),
  }),
  defineTool({
    name: 'create_design',
    title: 'Create a design',
    description:
      'Makes a new design in a brand, holding one page with an empty 1080×1080 frame, and answers its id and name. Needs an access that edits.',
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
        return { id: design.id, name: design.name }
      } catch (error) {
        counted()
        if (error instanceof ApiRefusal && error.status === 403)
          throw new ToolRefusal(
            'This agent may only view designs, so it can’t make one; the person who connected it can connect it again to edit',
          )
        throw error
      }
    },
  }),
]
