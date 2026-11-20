# Dazbee

The design editor and AI ad flow for solo marketers, companies and agencies. This glossary covers the document model the editor, renderer and AI jobs share, and the workspace records around it.

## Workspace

**Workspace**:
Whoever signs up and pays: its seats, brands, AI credits and billing. A person can belong to several. See ADR-0011.
_Avoid_: Org, account, team, tenant

**Member**:
A person in a workspace, with one role there: Owner, Admin, Editor or Reviewer. Whoever signs up first is its Owner, and a workspace has one Owner, who can hand it to an Admin. An Editor or Reviewer can be limited to some of the workspace's brands and sees only those. See ADR-0012.
_Avoid_: Seat (that is billing), user (a user is the person, a member their place in one workspace)

**Invite**:
An Owner's or Admin's offer to an email address to become a member of their workspace, with a role and, for an Editor or Reviewer, the brands they may see. Accepting it adds the workspace to the person's others; it makes no workspace of their own.
_Avoid_: Invitation, share

**Early access**:
The time before sign-up opens to everyone: only admins, people on the allow-list, people who are already members and people accepting an invite (a workspace's or a Dazbee invite) get in. Anyone else is told Dazbee is in early access, or to open the invite waiting in their email, and gets no account or workspace.
_Avoid_: Beta, waitlist

**Allow-list**:
The emails allowed to sign up during early access, set on the API. A person gets in by it only with an email WorkOS verified; an empty list lets anyone sign up.
_Avoid_: Whitelist, waitlist

**Admin** (of Dazbee):
A Dazbee staff member, named by email in the API's `ADMIN_EMAILS`, who uses the early-access admin page at `pilot.dazbee.com`: sends Dazbee invites, works the waiting list and removes a person's access. Always let in at sign-in. Not a workspace role: a workspace's Admin is a member (see Member).
_Avoid_: Staff, superuser, operator

**Dazbee invite**:
An admin's invite of an email to Dazbee itself during early access, a WorkOS invitation to no organization. Its person signs up and gets a workspace of their own, then adds their team with a workspace's invites. Removing them keeps their account and designs and refuses their sign-in; inviting them again lets them back in.
_Avoid_: Platform invite, beta invite (a workspace's invite is an Invite)

**Waiting list**:
The requests to join Dazbee sent from `/login` during early access, one per email, each with a name, a company and what they will make. An admin sends a request's email a Dazbee invite, which takes it off the list, or dismisses it.
_Avoid_: Waitlist, queue, signups

**Session**:
A signed-in person, in any of their workspaces at once: each page names the workspace it shows, and every API route checks that the person is a member there and may see the brand. It ends when they sign out or after seven days; stopping being a member of a workspace refuses their next request there at once, and closes a design they have open within ten minutes.
_Avoid_: Login, auth

**Account**:
A person's own records: their name and email, their memberships, invites to their email and their request to join. Deleting it from Settings deletes the workspaces they own alone, with everything in them, and takes them out of every other workspace, where what they made stays; an Owner of a workspace with other members hands over Owner first. Signing up again with the same email starts fresh.
_Avoid_: Profile, user (a user is the person's row; the account is all that is theirs)

**Brand**:
What a workspace makes work for: a solo user's business, a company's product line or region, or an agency's client. Every design, brand kit and asset belongs to exactly one brand, and a brand is a wall: nothing crosses from one brand to another.
_Avoid_: Client, customer, project (an agency's clients are brands too, ADR-0013)

**Brand kit**:
A brand's logo, colours, fonts and tone of voice, applied automatically. Its colours, fonts and logo are exposed to designs as variables, `brand:<token>`: a layer's fill, text colour, font family or picture bound to one follows the brand, so changing the brand colour or logo changes every design that uses it. Its colours and fonts are its brand roles (the colours Primary, Secondary, Accent, Background and Text, the fonts Heading and Body), then the brand's own.
_Avoid_: Brand guide, theme, style

**Brand role**:
One of the places every brand kit has: the colours Primary, Secondary, Accent, Background and Text, the fonts Heading and Body, and the Logo, each a reserved token (`brand:primary`, `brand:heading`, `brand:logo`). A layer bound to a role follows whichever brand it is in, so a workspace template started in another brand takes that brand's colours, fonts and logo. The Logo role is the kit's logo when it is an image; an SVG logo is placed as layers, which don't follow. A role is set or not; its name is fixed.
_Avoid_: Role (a layer's meaning in the ad), slot, theme colour

**Binding**:
A layer property that follows a variable, such as a fill bound to `brand:primary`. Editing the property by hand ends it. The layer also keeps the value it had, which it shows wherever the variable has none.
_Avoid_: Link (see Link id), sync, style reference

**Bindable property**:
A property a layer can bind: the colour of its fill, its text's colour, its font family or the picture of its image fill. Each takes one kind of value, such as a colour, and only the layer types that have it can bind it.
_Avoid_: Binding target, slot, field

**Variable**:
A named value a layer's property can follow. For now, the brand kit's tokens (`brand:<token>`).
_Avoid_: Field, slot, column, placeholder

**Asset library**:
A brand's uploaded images and SVG files, each with a name and tags it is found by. Placing an image on a design makes a graphic whose fill is that image; placing an SVG file makes a group of the layers it draws (paths, text, masks, and rects filled with the pictures it shows, which join the library first, each named by the layer that shows it, then the file: "Photo · Card"), its shadows and blurs becoming effects, and an SVG file is never a fill. The original is stored once per workspace, but each brand's asset, name and tags are its own.
_Avoid_: Media library, uploads, gallery

**Armed image**:
An image from the asset library clicked in Assets with a mouse or a pen, held by the pointer until the next click on a frame places it there at its own size or a drag there draws it at that size, after which the select tool is back. Escape, another tool, a press off every frame, clicking it again or closing Assets lets it go with nothing placed. A key or a tap on it places it at once, as an SVG file always is.
_Avoid_: Image tool, picked image

**Template**:
A design saved to start others from, for every brand of the workspace (an agency's own) or for one brand (a client's). Starting from one gives a new design with its own copy and fresh ids; the template never changes after.
_Avoid_: Master, preset, starter

**Reviewer**:
A guest who views, comments on and approves designs without a paid seat.
_Avoid_: Client user, approver

**Agent**:
An AI program outside Dazbee, such as Claude Code or Claude Desktop, that designs in Dazbee for a member through Dazbee's MCP server: it runs the commands the editor runs, in an agent tab, and is shown by the name it gives itself followed by "(agent)". See ADR-0019.
_Avoid_: Bot, assistant (that is Dazbee's own), integration, app

**Agent access**:
A member's leave for one agent to work in one of their workspaces: the brands it may open, and whether it edits or only views, never more than the member may. The member gives it when the agent first connects and ends it in Settings; it ends too when they stop being a member.
_Avoid_: API key, token, grant, connection, integration

**Daz**:
Dazbee's bee, drawn in one of its poses beside the words wherever there is nothing else to see: a link that leads nowhere, an error, a design opening or failing to open, an empty list or brand kit, a brand just made, the editor's stage over a page with no frames, its empty panels and searches with no match, and the notice that this browser can't keep changes. It is decoration: the words beside it carry the meaning. The poses are pictures in `apps/web/public/mascot/`, drawn by `Mascot`.
_Avoid_: Logo, icon

**Empty state**:
Daz, a title, a line under it and, where there is one, a button, centred: what a place shows when it has nothing to show, and what the brand home shows once right after the brand is made. Every such place draws the one layout, `EmptyState`.
_Avoid_: Placeholder, blank slate

## Design document

**Design**:
One editable piece of work: its pages, the frames on them and their layers, and its variables. The sync server holds it as records, stored in Postgres.
_Avoid_: Project, file, canvas, document (in UI copy)

**Page**:
One infinite space of a design, holding frames wherever they were placed. A design lists its pages in order, each page has frames of its own, and the canvas shows one page at a time.
_Avoid_: Sheet, tab, artboard (that is a frame)

**Frame**:
One ad, post or other piece of creative at one size, placed on a page. It has its own name, position, fills (its Background) and layers: every layer is in exactly one frame.
_Avoid_: Artboard, slide

**Guide**:
A line across one frame, vertical or horizontal, that a person drags from a ruler and layers snap to. A frame keeps its own, at most 100, each placed in whole pixels from the frame's top left. A resize with the layers following keeps them at their place from its top left, even past its edge; one with the layers staying where they are on the page shifts them with the layers, by whole pixels. Duplicate keeps them, Add size leaves them out, and no export draws them.
_Avoid_: Ruler guide, guideline, snap line (the line drawn while a layer snaps)

**Safe zone**:
The bands of a 9:16 frame that a platform's own interface covers (its profile, caption, buttons and call to action), as Meta, YouTube and TikTok publish them. From the View menu a person shows one platform's over each 9:16 frame, or all of them together (their union, each edge as deep as the deepest platform's); no export draws them.
_Avoid_: Safe area, title safe, UI overlay

**Size**:
A frame's width × height, such as 1080×1080, shown in its label. Add size makes a new frame of another size from a frame, holding linked copies of its layers, scaled to the new size and placed by their constraints; a layer with none gets them guessed from where it sits, and its copy keeps them.
_Avoid_: Format, dimensions

**Channel**:
A place ads run, such as Meta, TikTok and YouTube, or Google Display, grouping the sizes the Add a frame card offers. One size may sit in two channels, each under its own name: a frame added from a tile takes the tile's name, and a size typed in takes the first one's.
_Avoid_: Platform, network, placement

**Scale**:
How many pixels of an exported PNG, JPG or WebP there are to one of its frame, each way: 1x, 2x or 3x. At 2x a 1080×1080 frame exports as 2160×2160, drawn twice as dense, its file named `Sale@2x.png`. PDF and SVG have none.
_Avoid_: Resolution, density, size (a frame's own)

**Link id**:
The id a layer shares with the layers made from it in other frames of its page. See ADR-0014.

**Linked copies**:
Layers made from one another, in different frames of one page, that share a link id. Each copy is a layer of its own: an edit to one leaves the others as they were.
_Avoid_: Instances (an instance is a layer type), clones, synced layers

**Linked frames**:
Frames of one page that share at least one link id, such as a frame and the ones Duplicate or Add size made from it. Copy to other frames writes into them.

**Layer**:
One element in a frame's tree, stored in the flat `nodes` map with a parent id and fractional index; a top-level layer's parent is its frame. There are seven layer types: box, group, graphic, boolean, text, instance, lottie.
_Avoid_: Element, object, block, item

**Layers panel**:
One frame of the shown page at a time, named by the frame stepper at its top, and that frame's layers as a tree, topmost first: select (Shift and a click select the rows from the last one clicked), reorder, move into and out of groups, rename, lock and hide them. It selects in step with the stage, and shows the frame of a picked frame or of the layer selected last; with nothing selected it keeps the frame it shows. It opens on the selection's frame, else the frame in the middle of the view, else the first; when the frame it shows goes, it shows the frame now at its place, else the last.
_Avoid_: Outline, layer list

**Frame stepper**:
The row at the top of the layers panel: ‹, the shown frame's name and size, and ›. The arrows step through the page's frames in order, wrapping round, and change only which frame's layers the panel lists, never the selection or the view; on a page of one frame they don't show. A click on the name picks the frame, a double click renames it, and a layer dropped on the row goes to the frame's top.
_Avoid_: Switcher (that is the edit panel's), frame picker, pager

**Edit panel**:
The panel at the stage's end side that opens with the selection, layers or a picked frame, and goes when nothing is selected; on a phone or a tablet, a sheet at the bottom that opens low and drags up to show all of it. Its header names what is selected and, while it is locked, shows the lock, which unlocks it; under it the switcher picks one of its switcher tabs. It never takes the keyboard from the stage as it opens: Esc still deselects, and F6 moves the focus into it and back. Every setting for the selection has one home in it. A change sets the value of each selected layer, in whatever frame it is, and a value they don't share shows as mixed. A locked layer's settings are off, with the reason, all but Arrange's order; to a view-only tab, every setting shows its value turned off, and what only acts is left out. The design's own cards open in its place, and the selection's switcher tabs come back when they close: Pages from the Pages button by the zoom, Versions, Add a frame from the Frame tool, Add size, and Find and replace.
_Avoid_: properties panel, inspector, top bar, toolbar, selection bar, pop-up

**Switcher**:
The row of switcher tabs at the top of the edit panel (not browser tabs, see Tab): the kind's tab when the selection has one, then Style and Arrange; a picked frame's are Background and Arrange. It stays on the switcher tab last picked while the next selection has it, and otherwise opens on the first.
_Avoid_: tab bar, segmented control, tab (alone)

**Kind's tab**:
The switcher's first switcher tab, named for what is selected and holding what only that kind has: Text for texts (font, paragraph and spacing, the font chosen from the font chooser in the panel's place), Image for photos (replace, crop, fit, filters and adjust, and the layout of a box holding the photo), Shape for shapes with settings of their own (a polygon's sides, a star's points and inner radius, a line's ends, or how a combined shape or several shapes combine), Layout for a box (its Row, Column, Grid or Free, their spacing and its corners). Several layers of one kind have that kind's tab, but several boxes have no Layout; a rectangle, an ellipse, a drawn path, a group, or layers of mixed kinds have none, but mixed layers holding a text have a Text tab with only its font.

**Style**:
The edit panel's switcher tab for how the selection looks: its colour (a text's, a shape's or a box's fill), outline, corners (a photo's or a rectangle's; a box's are in Layout), transparency and effects, with a mask's settings first.

**Arrange**:
The edit panel's switcher tab for how the selection sits: its size and place, rotation and the flips, constraints where they apply, its order, and lining up, with the frame for one layer and with each other for several, which also have Group and Box. A picked frame's Arrange holds its size and place.
_Avoid_: Position (as the tab's name), transform

**Find and replace**:
The card in the edit panel, opened with Ctrl+F (⌘F) or from Quick actions, that finds the shown page's texts holding what is typed, whatever its case, and counts the matches as it is typed. Select matches selects those texts; Replace all replaces every match in them as one undo step, each replacement taking the style of the first character it replaces. Texts locked against content changes are found but left as they are. It stays open as what it selects changes.
_Avoid_: Search, search and replace

**Small menu**:
The pill by the selection: lock, duplicate, delete and hide, which act on the selected layers only and never on their linked copies, and ⋯ for the full menu.

**Full menu**:
The list the small menu's ⋯ opens, and a right-click on a layer shows: copy, copy style, copy as PNG, paste, paste style, duplicate, Copy to other frames, select copies, Select all with same ▸ (the page's layers with the first one's fill, or a text's font), Group and Box side by side, Ungroup for a group or a box, use as mask or release mask, Flip horizontal and Flip vertical, and at the bottom lock, hide and delete in all frames, which act on the layer and its linked copies. A right-click where two or more layers lie under the pointer starts with Select layer ▸, the list of them, front-most first, and one on a layer ends with Show hidden layers (see Hidden layers shown).
_Avoid_: More menu, context menu

**Copy to other frames**:
The full menu's items that send a layer's style, its text or the layer itself into the frames linked to its own.
_Avoid_: Sync, propagate, apply to all

**Transparency**:
How much a layer shows through (its opacity) and how it blends with what is under it, set in the edit panel's Style tab.
_Avoid_: See-through

**Picked frame**:
A frame chosen as a whole, by clicking its name or its empty area: outlined, its label in the accent colour, and no layer selected meanwhile. To a tab that may edit it shows a layer's handles, which resize it on the stage with its layers following their constraints, or, with Ctrl (⌘ on a Mac) held, staying where they are on the page. Its edit panel holds Background and Arrange, which resizes it from its top left with its layers following their constraints and moves it with its layers, and the panel header's ⋯ holds the frame's actions: duplicate, add size, rename, export, copy as PNG, remove guides while it has guides, and delete. A right-click on the frame's empty area or its name picks it and opens the same actions at the pointer, with Show hidden layers after them (see Hidden layers shown). Esc, a layer selected, or a click on empty canvas lets it go.
_Avoid_: selected frame, frame selection (no layer is selected)

**Box**:
A layer that holds other layers: it paints fills behind them and strokes over them, hides what reaches past its edges (never its own strokes) unless told not to, and has a layout: Free (each layer stays where it is put), or a Row, Column or Grid (see Auto layout). A group, by contrast, draws nothing of its own and fits its layers. The Box action (Ctrl+Alt+G) wraps the selected layers in a new Free box, nothing moving.
_Avoid_: Container, board, frame (see Frame)

**Graphic**:
A layer made of a shape plus fills, strokes and effects. Photos and video are fills on a graphic, not layers of their own.
_Avoid_: Image layer, shape layer, rectangle layer

**Shape**:
The outline a graphic draws: a rectangle (with a radius per corner), ellipse, polygon, star, line or a free path. A line's ends can be arrows, triangles or circles.
_Avoid_: Primitive, vector (a path is one kind of shape)

**Radius dot**:
A small white dot inside a corner of one selected box or rectangle, or at a polygon's or a star's top point, shown to a mouse or a pen: dragged along the corner's bisector, it rounds every corner, or with Alt its own corner alone.
_Avoid_: Corner handle (a handle resizes), radius handle

**Flip**:
Mirroring a layer left to right (Flip horizontal, Shift+H) or top to bottom (Flip vertical, Shift+V) across its own centre line as it is drawn, with what it holds; several selected layers flip about the centre of the box round them in each frame. A graphic, text, box or boolean keeps it as a flag that mirrors only what it draws itself; the layers inside a flipped one are mirrored about its centre, and a laid-out box's flow runs the other way along the flipped axis, a wrapping one each line in turn where its lines would still break there, and across its flow only lining its lines up at the other side. Flipping twice gives back the layer as it was. Shadows keep their offsets. Refused for a layer locked against resizing.
_Avoid_: Mirror (as the action's name), reflect, negative scale

**Lock ratio**:
A graphic's, text's or box's flag, set in Arrange, that keeps its width to its height as the editor resizes it: a drag of its handles while it is the one layer selected, or it and linked copies whose ratio is locked too, and a width or height typed in Arrange. Stored on the layer, so everyone's resizes keep it; Shift keeps the ratio of any resize. A command still sets the sizes it is given. Needs the layer unlocked for resizing.
_Avoid_: Aspect lock, constrain proportions, keep ratio

**Boolean**:
A layer that combines the shapes inside it, live, by union, subtract, intersect or exclude, and paints the result with its own fills and strokes. It holds only graphics and booleans; editing one of them changes the result.
_Avoid_: Compound path, merged shape (it is never flattened)

**Anchor**:
A point a path runs through. It may have a handle on each side that bends the segments meeting there; a smooth anchor's two handles point straight away from each other. The pen places anchors; editing a path moves, adds and deletes them.
_Avoid_: Node (a node is a layer), vertex

**Auto layout**:
A box setting that places the box's children in a row, a column or a grid, a gap apart inside its padding, lined up along and across the flow. A grid places them in a set number of equal-width columns, in layer order, row after row; each row is as tall as its tallest layer. A row or column that wraps, while the box keeps its length along the flow, runs its children onto a new line where the next would pass that length; each line is as tall as its tallest child, and the lines are packed where the box lines its children up across the flow, or spread with the room left between them. The room between a grid's rows and between wrapped lines is the box's own, or the gap where it sets none. It is solved when a scene is built, so the editor and every export lay out alike. A child marked absolute keeps its own place.
Shown as: the box's layout, Row, Column or Grid; a box without it is Free. In a box's Layout tab, a row's or column's wrap is Wrap onto new lines, and the room between lines is Between rows (Between columns for a column)
_Avoid_ (in code and docs): Flexbox, stack, auto frame

**Sizing**:
How a layer takes its width and its height, set beside W and H in Arrange: fixed keeps the one it has, hug (shown as Fit content, or Fit in the field) fits what it holds (a text's words, a laid-out box's children), and fill (only in a laid-out box) takes the room the box has left. Wherever auto layout sizes a layer (in a flow, and a laid-out box's own size), each side is held between the least and most it sets, the least winning where they cross: a text that fits its words wraps at its most width. Shown as Min W, Max W, Min H and Max H in Arrange, added from the W or H field's menu.
_Avoid_: Resizing, constraints (those keep a layer to its parent's edges)

**Constraints**:
How a layer follows its parent's edges when the parent, a frame or a box (in a laid-out box, only the layers its flow doesn't place), is resized: across, left, right, left and right, centre or scale; down, top, bottom, top and bottom, centre or scale. Left out, a layer keeps to its parent's left and top. A layer in a group or a boolean scales with it instead, and one a flow places is placed by the flow. A frame or a box resized on the stage with Ctrl (⌘ on a Mac) held leaves the layers it holds where they are on the page instead. Set across and down in Arrange, which shows them only where they apply; while it does, dashed lines on the stage show what each selected layer keeps to.
_Avoid_: Pins, anchors (an anchor is a path's point), responsive

**Run**:
A range of a text layer's characters that changes some of its base style, such as bold, a colour, an outline, underline or case. Typed text takes the run of the character before it.
_Avoid_: Span, range style

**Paragraph**:
The text between two line breaks in a text layer. Lists, paragraph spacing and selecting with a triple click work a paragraph at a time.
_Avoid_: Block (that is the renderer's laid-out paragraph), line (a paragraph wraps onto lines)

**Letter spacing**:
The room added after each character of a text, in pixels or as a percentage of the font size the characters are set at. A percentage follows the size: shrink to fit, a corner drag and a frame of another size change it with the size, where pixels are scaled. Typed as `2%` or `1.5px` in the Text tab.
_Avoid_: Tracking, kerning (the font's own spacing between two letters)

**Font feature**:
An OpenType feature of a font turned on or off for a text or a run, such as ligatures, tabular figures or small caps; the Text tab's Font features section lists those the texts' fonts have. Small caps a font lacks are drawn as smaller capitals.
_Avoid_: OpenType setting, typography option

**Wrap style**:
Where a text's lines break when a paragraph wraps onto more than one line. Auto fits as many words on each line as fit; Balance breaks each paragraph at the narrowest width that adds no line, so a headline's lines come out near even; Pretty keeps the lines full but leaves no one word alone on a paragraph's last line. Set in the Text tab, below the case. Justified text, and a paragraph that the most lines cut off, break as Auto does.
_Avoid_: Text wrap (whether text wraps at all is the box's size), line breaking

**Shrink to fit**:
A text layer setting that picks the largest font size, between a least and a most, at which the text fits inside the layer; every font size in the text scales with it.
_Avoid_: Auto size, fit text

**Font catalog**:
The families a brand can set text in: the fonts we ship (the fallbacks among them), the Google Fonts families we copied into our storage, and the brand's own uploads. The script fonts are in our storage too, but the menu does not offer them. A brand's upload of a family name is the one it sees. Every font file is loaded from our storage, never from Google, the system or the browser.
_Avoid_: Font library (that is the asset library's word), web fonts

**Font face**:
One font file in the catalog: a family in one weight and style, or a **variable font**'s range of weights in one style.
_Avoid_: Font (when one file is meant), variant

**Variable font**:
One font file that draws a range of weights along its weight axis, read when it is uploaded; a text set to any weight in the range draws that weight. It is the only face of its family and style: an upload of one takes the place of the others, and any upload of that family and style takes its place.
_Avoid_: Axis font

**Script font**:
A Noto family a text falls back to for characters its own font lacks, of a script we don't ship (Japanese, Korean, Chinese, Thai, Hebrew and others) or colour emoji. It is copied into our storage with the Google Fonts families, loaded only once some text in the design has its characters, and never offered in the font menu.
_Avoid_: Fallback font (that is any font in the fallback list, the shipped ones too), emoji font (when every script font is meant)

**Fill**:
One paint on a layer: solid, gradient (linear, radial or angular), image or video. A crop is the fill's transform.
Shown as: Colour
_Avoid_ (in code and docs): Background, colour (when a paint is meant)

**Stroke**:
One paint drawn along a layer's outline, with its own width, inside, centred on or outside the edge, solid or dashed.
Shown as: Outline
_Avoid_ (in code and docs): Border, outline

**Spread**:
How far a shadow's or glow's outline grows past the layer's, or shrinks inside it, following its shape: a rounded corner's shadow stays round. An inner shadow's spread shrinks the shape it is cast from outside of.
_Avoid_: Size, choke

**Crop**:
The part of an image fill's image stretched over the layer's box, in image pixels; it may reach past the image, which shows nothing there. In crop mode the layer's box is the window: handles on its sides and corners size it, and so the layer, with the image staying where it is; handles on the image's corners zoom it, and a drag moves it.
_Avoid_: Frame (that is an ad's canvas), viewport, mask

**Tile scale**:
How big each tile of an image fill set to tile is, as a share of the image's own size: at 50 % it repeats twice as often. Read only while the fit is tile; left out, the image tiles at its own size.
Shown as: Scale
_Avoid_: Zoom, tile size

**Adjustment**:
A change to an image fill's colours, pushed either way from none: exposure, contrast, saturation, temperature or tint. A filter (mono, sepia, vivid, fade, warm, cool) is a look laid on after them.
_Avoid_: Effect (that is a shadow, glow or blur on the layer), edit

**Mask**:
A layer that is not drawn itself: the shown layers above it in the same parent, up to the next shown mask, show only where it is opaque (alpha) or bright (luminance). A hidden mask masks nothing, and a hidden layer is never masked. Use as mask puts the layer in a Mask group.
_Avoid_: Clipping mask, stencil

**Mask group**:
A group whose own layers include exactly one mask, shown or hidden. It is told apart by this structure, never by its name. Use as mask makes one, and so does placing an SVG file with masks or clips.

**Loose mask**:
A mask whose parent is a frame or a box, so it masks every shown layer above it there, up to the next shown mask. Release mask and Ungroup never leave one.

**Release mask**:
The full menu's item in Use as mask's place for a mask, a Mask group or a masked layer: it turns the mask off, and ungroups its Mask group when that group is outside an auto layout box.

**Pass-through**:
How a group or box blends by default: it adds no layer of its own, so each child blends with whatever is under the group. Any other blend mode first draws the children together, then blends the result.
_Avoid_: Isolated (that is any other mode)

**Role**:
A layer's meaning in the ad (headline, price, logo, product, cta, …), used by AI, Ad check and adapt.
_Avoid_: Kind, tag, semantic type

**Property path**:
The typed string that names one property of a layer, such as `x`, `fills` or `text.boxMode`. Commands, bindings and the assistant all address properties this way.

## Editing

**Store**:
What a tab's editing session reads and writes a design through (`packages/doc/src/store.ts`): whole records, one value of a record, text edits. Commands see only the store; in the editor it is a store on the tab's sync client.
_Avoid_: Doc, document; storage (that is the database)

**Tab**:
The editor open on a design in one browser tab: one editing session on one store, with its own undo. Not a page.
_Avoid_: Window, client, page

**Command**:
A named, zod-validated change to a design that runs on the store as one step, ending as one change set and one undo step, unless it runs inside a gesture or a batch. The only way anything writes to a design, except a follow-up. Each says in a sentence what it changes and refuses, and the command catalog lists them with their inputs for a caller that has not read the code.
_Avoid_: Mutation, operation, action (an action is what the editor is asked to do, and runs commands)

**Action**:
One thing the editor can be asked to do by a key, a menu or a button, such as Group, Align left or Zoom in: a row of the shortcut table, with its keys, the group the shortcuts list shows it in and the step name it makes when it writes. It runs commands, or none.
_Avoid_: Command (the change an action runs), shortcut (an action's key)

**Quick actions**:
The searchable list of the actions that can run now, opened with Ctrl+K (⌘K on a Mac): type part of a name, press Enter, and the action runs as its key does, with the focus back where it was. Actions that can't run now aren't listed; the last five run head it as Recent.
_Avoid_: Command palette (an action is not a command), command menu, launcher

**Step name**:
What an undo step is called, from one list in `packages/doc`, such as move, rename or align: Undo and Redo name the step they would take back with it. A command names its step; a gesture or a batch names its own, else takes its first command's.
_Avoid_: Label, undo label

**Refusal**:
A command that wrote nothing because its input or the design ruled it out, told as data: the command, whether its input or its check refused it, the reason in a sentence, and for an input the issues and where each is.
_Avoid_: Fault (a bug, whose writes are put back), error, rejection (the sync server's answer to a change set)

**Agent batch**:
Commands an agent sends together, run in order as one gesture, so they are one undo step, all or nothing: on a refusal nothing is kept. A step may add, move or re-parent layers, which a batch run with `session.batch` refuses, and reach a layer an earlier step made through a step reference. The result gives each step's outcome, up to the refusal it stopped on.
_Avoid_: Batch alone (`session.batch`, which takes only commands that change properties), script, macro

**Step reference**:
`{ "$ref": name }` in an agent batch step's input: the result of the earlier step named `name` with `as`, such as the id of the layer it added, or with `field` a part of that result (`0`, the first id of a list).
_Avoid_: Variable, placeholder

**Compact tree**:
A frame's layers as small JSON for an agent to read: each layer's id, name, type, whether it shows and its text's first 120 characters, the props asked for, and long lists of layers cut to a size budget with how many are not shown.
_Avoid_: Outline (the layers panel), tree alone (a brief's), dump

**Agent render**:
A frame drawn as a PNG for an agent to look at, on the CPU surface: its longer side fitted to 1600 pixels unless the agent asks for another size, never past twice the frame's size, then drawn smaller until the file fits a byte limit. It is not an export: no file is named or kept.
_Avoid_: Screenshot (that is of the screen), preview, thumbnail

**Agent warning**:
A sentence an agent is told about one layer of a frame that won't look as designed, with the layer's id: a font with no file, characters no font has, text that overflows its fixed box (too tall, or a word too wide) or passes its line limit, a layer wholly outside its frame, or text inside a platform's safe-zone edge on a 9:16 frame. An agent batch's result carries those for the layers it touched: those it added, changed or took out, with the layers inside them and the rest of an auto layout box they are in, and every layer of a frame it changed.
_Avoid_: Error, lint, refusal (a refused command wrote nothing)

**Gesture**:
One continuous act of the person editing, such as a drag or typing into a text until they leave it, pause for 2 seconds or hide the tab (the next key starts another). Every command run during a gesture is one undo step, unless Undo is pressed while it is open, which makes what it wrote so far a step of its own. Other tabs draw its preview while it is open and get its change set once it ends.
_Avoid_: Batch, transaction (a gesture spans many)

**Fault**:
A bug in a command, caught as it runs: it threw, the read of the design had to leave out a part after it, or a design that read without repair needed one after it. Everything its step wrote is put back before it is sent, where a step is the command alone or the gesture or batch it ran in, and it leaves no undo step.
_Avoid_: Error, crash, refusal (a refused command wrote nothing: its input or the design ruled it out)

**Left out**:
What a read does with a part of a design that holds a value the schema does not take: the design it gives has no such part, the stored design keeps it, and the read reports it. A layer goes with what it holds, a frame with its layers, a page with its frames.
_Avoid_: Dropped, removed (the stored design still holds it), repaired (that is for what edits made at once break)

**Version**:
A design as the server stored it at one moment, kept in its version history: named on purpose by an Editor, or taken automatically: an Autosave once the design has changed for 30 minutes and when it unloads changed, and Before restore just before a restore replaces it. Before agent, named by the agent ("Before Claude (agent)"), is taken just before an agent's first change to the design, and before an agent's first change after a person's edit. Named versions are never dropped; the newest 20 automatic ones are kept, at most 100 in all.
_Avoid_: Revision, checkpoint, snapshot

**Restore**:
Replacing the design for everyone with a version, as one undo step of the tab that restores it, the design's name kept, after the design as it was is kept as a Before restore version.
_Avoid_: Revert, roll back

**Eyedropper**:
The button, shown as "Pick a colour", that picks a colour from the design for the control it sits in: every colour field with its own swatch, and the Colour and Background panels' "In this design" row, which Shift+I starts. While it picks, a press or a finger lifted on the stage picks the design pixel there as the 1x export draws it, and writes it as its hex typed there would; Esc, the button again or a press elsewhere stops it with nothing picked.
_Avoid_: Colour picker (that is the system's, behind a colour field's swatch), sampler (what draws the frames it reads)

**Loupe**:
The circle that follows the pointer while the eyedropper picks: the design pixels round the hot spot, magnified, the one picked boxed in the middle, with its hex under it. Above the finger on a touch screen.
_Avoid_: Magnifier, zoom lens

**Recent colours**:
The colours last picked with the eyedropper, typed as a hex, chosen in the system picker or picked again from the Recent row, sixteen per brand on a device, newest first, shown as the Recent row of the Colour and Background panels and of the paint editor (eight, leaving out the brand kit's). Kept in the browser, never in the design, its undo or its exports, and not shared with other devices or people: the brand kit is the shared palette.
_Avoid_: History, palette, swatches (those are the brand kit's and the design's)

## Syncing

**Holder**:
What a record sits in: a frame's page, or a layer's parent (a frame or a layer).

**Change**:
One write to a design as the sync server takes it: create a record, set or unset one value, or delete a record with everything it holds.
_Avoid_: Operation, update, patch

**Value**:
What one change sets: a meta field, a field of a page, frame or layer, one key of a layer's `props`, or one of its bindings. A text layer's text and runs are one value. Where two tabs set one value, the change the server orders later wins.

**Change set**:
The changes a tab sends together, from one step or as a follow-up. The server accepts all of them or rejects all of them.
_Avoid_: Batch (several commands run as one step)

**Sequence number**:
How many change sets the server has accepted for a design. Each accepted change set takes the next one.

**Base**:
The sequence number of the confirmed design a change set was made on.
_Avoid_: Parent, version (a version is a stored design of its own)

**Step**:
What a tab writes between opening and ending it: one command, a gesture or a batch. It ends as one change set and, when it has a step name and changed something, one undo step. An undo or redo of it is a change set made again from what the tab holds then, leaving alone what other tabs wrote since.
_Avoid_: Transaction, undo entry

**Tab id**:
Who a tab is to the sync server: given at its first hello with a secret, and kept across reconnects and reloads, so the server knows which of its change sets it already took in. A tab that comes back to another sync id, or whose tab id was dropped, starts over as a new tab.
_Avoid_: Client id, session id (a session is a member's sign-in)

**Sync id**:
The identity of what the server has stored for a design: made when the design is created, and new after a journal entry no longer applies on open. A tab resumes only under the sync id it knows.

**Journal**:
What the server has stored for a design since its last fold: the change sets it accepted, the tab ids it issued and the ids of change sets it rejected.
_Avoid_: Log (the catch-up log is the server's, in memory), history (that is undo's)

**Fold**:
Writing a design's journal into its stored design and emptying the journal, in one transaction: on unload, and once the journal grows past its limit.
_Avoid_: Compaction (what the Yjs server did), snapshot

**Confirmed design**:
The design as a tab knows the server holds it: everything the server accepted, up to the last sequence number the tab heard.
_Avoid_: Server state

**Queue**:
A tab's change sets the server has not yet accepted or rejected, in order: sent, or waiting for the connection to come back.
_Avoid_: Pending, outbox

**Working design**:
What a tab shows and edits: its confirmed design with its queue and its open step's writes on top. Rebuilt when another tab's change set arrives, and its listeners are told exactly the records it now shows otherwise.
_Avoid_: View (that is the read model the editor draws from), optimistic state

**Catch-up**:
What a tab that comes back gets in its welcome: the change sets it missed, or the whole design when the server's log no longer holds them or applying them would cost more than starting over.
_Avoid_: Resync, snapshot

**Follow-up**:
A change set a tab sends to bring derived values (a text's box, a group's box) up to date once another tab's change set was ordered before its own. It is no undo step, and nobody hears when it is rejected.
_Avoid_: Fix-up, repair (repair keeps a read design whole)

**Recompute**:
How a tab works out a follow-up's derived values over the layers a change set touched: each text that grows with its words fitted as typing fits it (the fitted text, measured in the brand kit's font for a bound family), then each group and boolean above them, old holders included, hugged as `node.hug` hugs it. It reads only those chains, and answers "wait" while a font is loading. The server never runs it.
_Avoid_: Derive, refit

**Preview**:
A tab's open step as the other tabs see it while it is open: its changes so far, drawn over their design for display only. Never ordered, stored or undone; the change set the step ends as takes its place.
_Avoid_: Draft, ghost, live update

**Presence**:
Where a tab's person is in a design as the other people there see it: their pointer in page coordinates, while it is on the stage and the tab is shown, their selected layers and picked frame, and their page, drawn in a colour the sync server gives each member. Never stored, ordered or undone, and the latest wins; a person's own other tabs don't show it.
_Avoid_: Awareness, cursors (a cursor is only the pointer part), live users

**Agent tab**:
The tab an agent works in, which Dazbee's MCP server holds for it: the editor without a screen, open on one design and joined to the sync server as a member's tab is, with its own undo. Open tabs get its steps once they are stored, and list it by the agent's name.
_Avoid_: Bot session, headless editor, agent connection

**Tab copy**:
What a tab keeps on its device so a reload, or another tab of the same member, can go on as it: its identity, its confirmed design, its queue and what it owes, written as small entries.
_Avoid_: local cache

**Device copy**:
The database on a device that holds a design's tab copies, one per tab that had it open.
_Avoid_: offline store

**Plain store**:
A design's store on a sync client: commands write its working design, and each step is one change set the server checks. Another tab joins the same server.
_Avoid_: Local store

**Local server**:
A sync server in memory, for tabs in one process: it delivers every message at once, in order, and keeps nothing.
_Avoid_: Mock server, fake server

**Scratch store**:
A plain store on a local server, for a trial run on a copy of the design, such as whether an ungroup keeps every layer where it is drawn. Its server answers at once; a step it rejects faults the command. Nothing of it is kept.
_Avoid_: Sandbox, dry run, copy

## Rendering

**Scene**:
The renderer's output for one frame: a resolved tree ready to draw. `render(design, frameId, …) → scene` is a pure function.

**Surface**:
Where a scene is drawn: the WebGL surface for the editor screen, or the CPU surface for every PNG, JPG and WebP export. A PDF or SVG export draws the scene on Skia's PDF or SVG canvas instead, with the parts the file can't hold as vectors drawn on the CPU surface as images.

**Canvas**:
The editor's infinite view of one page: its frames, where they were placed. The Pages card switches the page it shows.
_Avoid_: Board, workspace

**Composition**:
What an input method is putting together at the caret before it is typed: pinyin on its way to Chinese characters, kana before conversion, a Korean syllable, an accent waiting for its letter, a phone keyboard's word. It is drawn in the text where it will land, underlined, in place of the selected range it replaces, and typed in as one edit when the input method commits it. It is never stored, sent to other tabs or undone; when the input method cancels it, the text is as it was.
_Avoid_: Preedit, marked text, IME text

**Stage field**:
The hidden text area beside the canvas that holds the focus while a text is being typed in, so that what the system types with no key lands in the text: the emoji keyboard's pick, dictation, an input method's committed text, and a Backspace that came with no key. It keeps none of it, and shows only what an input method is composing, at the caret.
_Avoid_: Hidden input, proxy textarea, IME field

**Hidden layers shown**:
A view of the stage, a tab's own like the rulers, that draws every hidden layer of the design, in every frame of every page and inside hidden groups too, faded to a quarter of its opacity with a dashed outline, where a click or a marquee selects it to edit. The layers stay hidden: no export, Copy as PNG, picture, share link, version or other tab draws them, it is never saved and makes no undo step, and every load starts with it off. Show hidden layers in the stage's right-click menu, ticked while it is on, and Quick actions turn it on or off; the pill at the top of the stage says it is on, and its Hide them turns it off. The layers panel's eye and the small menu's Show are what show a layer for real.
_Avoid_: Unhide, reveal, show (alone: that is a layer's own Show), x-ray, ghosts

**Display copy**:
A smaller copy of an image the editor screen draws in its place: 1024, 2048 or 4096 pixels on its long side, the smallest that is at least as long as the image is drawn on the shown page in device pixels, and the image itself past that. Zooming in past a copy's side makes the next one once the zoom settles. Exports never use them: they draw the original.
_Avoid_: Thumbnail, preview, rendition

**Own size** (of an image):
The width and height of the image as stored, in its own pixels, which placement, crop, tile and hit tests go by, whatever size the display copy drawn for it is.

**Export parity**:
CPU renders of the same design in the browser and in Node being pixel-identical (0 differing pixels), at every scale; their PNG, JPG and WebP files are byte-identical. PDF and SVG exports are byte-identical in both; drawn by pdfium and resvg, they match the CPU render within a recorded share of pixels (the vector baselines).

## AI flow

**Brief**:
What starts a tree: a few words, up to four pictures and the sizes to make.

**Tree**:
Everything grown from one brief: its rounds and their drafts.

**Round**:
One planning call and the four drafts it produced.

**Draft**:
One flat AI-generated ad in a round. Starred, used, or refined into draft versions.
_Avoid_: Generation, option, candidate

**Layering**:
The job that turns a chosen draft into real layers: plan, separate, read, live text, vectorise, backdrop, place.
_Avoid_: Decompose, editable-ize, convert
