// The tool that fills a brand kit from the brand's website: its logo, colours and fonts, which the API reads.
import { z } from 'zod'

import { BrandFromWebsite, type BrandFromWebsiteAnswer, type WebsiteFont } from '@dazbee/schema'

import { defineTool, type Tool, WithNotes } from './define-tool.ts'
import { BrandId, viewOnly } from './workspace-tools.ts'

export const BRAND_TOOLS: Tool[] = [
  defineTool({
    name: 'brand_from_website',
    title: 'Fill a brand kit from its website',
    description:
      'Reads a brand’s website and fills its brand kit’s empty roles from it: the logo (added to the brand’s images), the colours Primary, Secondary, Accent, Background and Text, and the fonts Heading and Body. With replace it also replaces roles already set: only when the person asks to replace their kit. A font the site uses that Dazbee doesn’t have becomes the closest Google Font in its catalog, named in the answer. A site that turns Dazbee away comes back as a sentence: ask the person for their logo, colours and fonts. Needs an access that edits, from a member who may edit the kit.',
    readOnly: false,
    openWorld: true,
    input: z.object({
      brand: BrandId,
      link: BrandFromWebsite.shape.url.describe('The website’s address, such as example.com or https://example.com/'),
      replace: z
        .boolean()
        .optional()
        .describe('Whether to replace roles the kit already sets; left out, only empty roles are filled'),
    }),
    run: async ({ brand, link, replace }, { api }) => {
      let answer: BrandFromWebsiteAnswer
      try {
        answer = await api.brandFromWebsite(brand, { url: link, ...(replace === undefined ? {} : { replace }) })
      } catch (error) {
        throw viewOnly(error, 'change the brand kit')
      }
      return new WithNotes(
        {
          site: answer.site,
          filled: answer.filled,
          kept: answer.kept,
          colors: answer.colors,
          fonts: answer.fonts,
          logo: answer.logo && { id: answer.logo.id, name: answer.logo.name },
          otherLogo: answer.candidates.logo,
          shareImage: answer.candidates.shareImage,
        },
        [
          ...answer.fonts.filter((font) => font.match !== 'same').map(matchedNote),
          ...(answer.kept.length > 0
            ? [
                `The kit already sets ${answer.kept.join(', ')}, so ${answer.kept.length === 1 ? 'it was' : 'they were'} kept; call again with replace: true only if the person asks to replace ${answer.kept.length === 1 ? 'it' : 'them'}.`,
              ]
            : []),
          ...answer.notes.map((note) => (/[.?!]$/.test(note) ? note : `${note}.`)),
        ],
      )
    },
  }),
]

/** What an agent is told of a site's font the catalog doesn't have. */
function matchedNote({ role, site, family, match }: WebsiteFont): string {
  const how =
    match === 'fallback'
      ? `the next font its CSS names, ${family}, is in Dazbee’s catalog and was used`
      : `the closest in its catalog is ${family}`
  return `The site’s ${role} font, ${site}, isn’t one Dazbee has; ${how}. Tell the person, as they may want to upload their own font.`
}
