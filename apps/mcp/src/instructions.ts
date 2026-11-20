// What `initialize` tells an agent about working in Dazbee. Where a layer sits is as the renderer places it
// (`packages/renderer`'s scene): in its frame's pixels, wherever it is nested.

/** The instructions an agent gets when it connects. */
export const INSTRUCTIONS = [
  'Dazbee is a design editor for brands: a brand holds designs, images and a brand kit; a design holds pages, a page holds frames (one per ad size), and a frame holds layers.',
  'Find your way with list_brands, list_designs and list_assets; create_design makes a new design.',
  'open_design opens one design in your agent tab: the editor without a screen, joined to the design as a person’s tab is, so everyone with the design open sees your steps once they are stored. One design is open at a time; opening another closes it.',
  'Coordinates are design pixels, x right and y DOWN. Frames are placed on their page by x and y. A layer’s x and y are measured from its frame’s top-left corner, also for a layer inside a box or group; rotation is in degrees about the layer’s centre. Inside an auto layout box, the box places its children (set its layout instead), unless a child is absolute.',
  'Commands are the only way to change a design: list_commands names them (use a filter) and describe_command gives one’s input. run_command runs one; batch runs several as one agent batch: one undo step, all or nothing, where a step’s `as` names its result and a later step’s input refers to it with {"$ref": name}. undo and redo take back and redo only your own steps.',
  'Read what you change: read_design, read_frame (a compact tree), read_layer. Before saying a frame is done, look at it with render_frame and fix what check_frame warns about.',
  'Before your first change to a design, Dazbee keeps a version of it named for you, so the person can always restore the design as it was.',
  'A failure comes back as a tool error in a sentence: read it, correct the input and try again.',
].join('\n\n')
