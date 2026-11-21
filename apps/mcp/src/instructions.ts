// What `initialize` tells an agent about working in Dazbee. Where a layer sits and how it turns are as the renderer
// draws it (`packages/renderer`'s scene and draw): in its frame's pixels wherever it is nested, turned clockwise
// about its centre with the layers it holds; `instructions.test.ts` draws both.

/** The instructions an agent gets when it connects. */
export const INSTRUCTIONS = [
  'Dazbee is a design editor for brands: a brand holds designs, images and a brand kit; a design holds pages, a page holds frames (one per ad size), and a frame holds layers.',
  'Find your way with list_brands, list_designs and list_assets; create_design makes a new design.',
  'open_design opens one design in your agent tab: the editor without a screen, joined to the design as a person’s tab is, so everyone with the design open sees your steps once they are stored. One design is open at a time; opening another closes it.',
  'Coordinates are design pixels, x right and y DOWN. Frames are placed on their page by x and y. A layer’s x and y are measured from its frame’s top-left corner, also for a layer inside a box or group, never from the box or group. rotation is in degrees, clockwise about the layer’s centre, and a box or group turns the layers in it about its own centre too. Inside an auto layout box, the box places its children (set its layout instead), unless a child is absolute.',
  'Commands are the only way to change a design: list_commands names them (use a filter) and describe_command gives one’s input. run_command runs one; batch runs several as one agent batch: one undo step, all or nothing, where a step’s `as` names its result and a later step’s input refers to it with {"$ref": name}. undo and redo take back and redo only your own steps.',
  'Read what you change: read_design, read_frame (a compact tree), read_layer; the resources dazbee://design, dazbee://frame/{id}, dazbee://commands and dazbee://command/{name} give the same. Before saying a frame is done, look at it with render_frame and fix what check_frame warns about. The prompts make_ad, add_sizes and review_frames give a plan for each.',
  'The people with the design open see you as they see each other, marked as an agent: your cursor at what your last call changed or read, those layers or that frame outlined in your colour. Give run_command and batch a short `note` of what the step does, such as “Writing the headline”: it shows beside your cursor for a few seconds.',
  'Before your first change to a design, and before your first change after a person’s edit, Dazbee keeps a version of the design named for you (Before agent), so the person can restore it as it was from the design’s versions. Your undo never takes back a person’s steps, and theirs never takes back yours.',
  'A failure comes back as a tool error in a sentence: read it, correct the input and try again.',
].join('\n\n')
