/** One argument of a prompt: its name, what it is, and its default, which an argument that must be given has none of. */
interface PromptArgument {
  name: string
  description: string
  default?: string
}

/** A prompt as it is written: its listing and its plan, `{name}` standing for an argument and `{check}` for CHECK. */
interface PromptDefinition {
  name: string
  title: string
  description: string
  arguments: PromptArgument[]
  plan: string
}

/** The check every plan ends with. */
export const CHECK = `Check as you go, and before you finish:
- After each batch or run_command, read_frame each frame it changed, with fields ["x", "y", "width", "height", "role"], and check that every layer is where and as big as you meant. A refused batch changed nothing: fix the step it names and send the whole batch again.
- At the end, render_frame each frame you made or changed and look at the picture, and run check_frame on it. Fix every warning and anything the picture shows wrong, then render and check that frame again, until check_frame lists nothing and the picture looks as meant.
- Last, read_design: \`waiting\` is 0 and \`notices\` names no change the server refused.
- Report the ids of what you made (a design, frames, layers) and of the frames you changed, and what you could not fix and why.`

/** How a plan reaches the layers it changes without losing the brand kit's bindings. */
const KEEP_BINDINGS =
  'node.update ends the binding of a fill, text colour, font or picture it changes, so change a bound one only with node.bind.'

export const DEFINITIONS: PromptDefinition[] = [
  {
    name: 'make_ad',
    title: 'Make an ad',
    description:
      'Makes a new design in a brand: one frame per ad size, the brand kit’s colours and fonts bound, the logo and a product image from the brand’s images, and each part’s role set.',
    arguments: [
      { name: 'brand', description: 'The brand’s name or id, as list_brands gives it' },
      { name: 'message', description: 'What the ad says: its offer or main line' },
      {
        name: 'sizes',
        description: 'The ad sizes, width x height in pixels, separated by commas',
        default: '1080x1080, 1080x1920, 1200x628',
      },
    ],
    plan: `Make an ad in Dazbee for the brand {brand}. What it says: {message}
Its sizes, width x height in pixels: {sizes}.

1. list_brands, and take the id of the brand with that name or id. list_assets on it for the logo and for a product image (a query such as "logo" or "product", or read their tags), and note their ids.
2. create_design in that brand, named for the ad, then open_design it. read_design gives its one frame (1080x1080) and the brand kit's tokens (brand:<token>) with their values. Read describe_command for node.create, node.bind and frame.addSize before running them for the first time.
3. Make the first size on that frame in one batch, each step named with \`as\` and reached from later steps as {"$ref": name}:
   a. frame.update the frame to the first size, if it is not 1080x1080, and name it for the size.
   b. node.create each part on the frame, setting the role in its layer: a background (a graphic filling the frame, role background); the headline (a text holding the message's main line, role headline); the cta (a box, role cta, holding a text with a short call to action); the logo (a graphic, role logo); and the product (a graphic, role product, its fills an image fill of the product image's asset id: [{"type": "image", "assetId": id, "fit": "fit"}]). Layers' x and y are measured from the frame's top-left corner.
   c. node.bind in the same batch: the background's fill to brand:background; the headline's textColor to brand:text and its fontFamily to brand:heading; the cta's fill to brand:primary, and its text's textColor to brand:background and fontFamily to brand:body; and the logo's image to brand:logo, with the logo's asset id as the value. Each other binding's value is the token's value read_design gives; a role read_design doesn't list is not set in this kit, so bind it with a colour or font that suits the brand as its value, and the layer follows the kit once the role is set.
4. For each other size, one batch each: frame.addSize from the first frame with its width and height. It answers the new frame's id; its layers are linked copies placed by their constraints.
5. Fix each new frame in one batch of its own: move and resize what doesn't fit the shape (node.update, and text.fit for a text's box), keeping the headline, cta, logo and product apart and readable. ${KEEP_BINDINGS}

{check}`,
  },
  {
    name: 'add_sizes',
    title: 'Add sizes',
    description:
      'Adds ad sizes to a frame of the open design with Add size, one new linked frame per size, then checks each new frame and fixes what doesn’t fit.',
    arguments: [
      { name: 'frame', description: 'The frame to copy: its id or name, as read_design gives it' },
      { name: 'sizes', description: 'The sizes to add, width x height in pixels, separated by commas' },
    ],
    plan: `Add sizes to the frame {frame} of the open design in Dazbee. The sizes, width x height in pixels: {sizes}.

1. read_design, and take the id of the frame with that id or name, and the sizes its page's frames already have. read_frame it with fields ["x", "y", "width", "height", "role"] to know what it holds.
2. For each size, one run_command each: frame.addSize with that frame's id and the size's width and height. It answers the new frame's id; every layer is a linked copy placed by its constraints. Skip a size the page already has a frame of, and say so.
3. Fix each new frame in one batch of its own: move and resize what doesn't fit the new shape (node.update, and text.fit for a text's box), keeping the headline, cta, logo and product apart and readable, and text clear of a 9:16 frame's safe-zone edges. ${KEEP_BINDINGS}

{check}`,
  },
  {
    name: 'review_frames',
    title: 'Review frames',
    description:
      'Renders and checks every frame on a page of the open design, then fixes what is wrong in one batch per frame.',
    arguments: [
      {
        name: 'page',
        description: 'The page to review: its id or name, as read_design gives it',
        default: 'the first page read_design lists',
      },
    ],
    plan: `Review the frames of the open design in Dazbee, on this page: {page}.

1. read_design, and take that page's frames, in order.
2. For each frame: render_frame it and look at the picture, run check_frame on it, and read_frame it with fields ["x", "y", "width", "height", "role", "fills"]. read_layer shows a layer's bindings.
3. List what is wrong in each frame: every warning check_frame gives, and what the picture shows: text cut off, crowded or too small to read at the frame's size, parts overlapping or off the frame, text that doesn't stand out from what is behind it, a headline, cta or logo missing, and colours or fonts not bound to the brand kit (brand:<token>).
4. Fix each frame's list in one batch: node.update to move, resize or restyle; text.fit for a text's box; text.replace or text.edit for words; node.bind to bind a colour, font or picture to the brand kit. ${KEEP_BINDINGS} Change nothing that is right.

{check}`,
  },
]
