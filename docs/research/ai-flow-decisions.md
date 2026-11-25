# AI flow: what is decided

The AI flow turns a brief into ad drafts, then into a layered design that can be edited. This page lists what the owner has decided for it, so the spec and its tickets don't drift from it. Every line under **Decided** was agreed by the owner on the date given. Lines under **Not decided** are open: don't build them as if they were settled.

The measurements behind these choices are in [ai-flow-image-models.md](ai-flow-image-models.md) and [ai-flow-job-queue.md](ai-flow-job-queue.md).

## Decided

### The canvas (26 Nov 2026)

These replace the screen decided on 25 Nov: the flow runs on a design's canvas, not on a screen of its own.

- **A brief starts a design.** On the brand home a person writes a few words and adds pictures (their product, their logo, an ad whose style they want) at one size. Enter opens a new design named from the brief. Inside a design, a brief box floats just above the tool dock and starts another brief on the same page. One design holds one campaign.
- **Each brief is a section**, titled with the brief and its pictures. Its four drafts are frames placed at once, empty, each filling in as its picture arrives. A section's title offers Edit brief, which runs the changed brief as a new section.
- **Where new work goes.** More like this and Other sizes make a new section in the column to the right of the section the draft is in, at the first free spot going down, with a connector from the draft. A new brief goes below everything on the page. The AI never adds frames to a section that exists and never moves anything: it fills or changes frames that exist, or makes a new section.
- **Actions show on the selected draft only**, in a small bar above it: More like this, Other sizes, Refine with AI, Star and Make editable. Hovering an AI action shows its share of the workspace's AI and about how long it takes.
- **The star decides what goes out.** Export and Share send starred frames and say what they leave out, with a switch to include the rest. Making a frame editable says nothing about sharing.
- **Frame states.** A draft shows nothing. A starred frame shows a small star by its name; an editable frame a small layers icon; a frame can be both. A selected frame shows by its name turning blue, with no outline.
- **Refine with AI happens on the canvas**: a small box under the frame, the latest exchange above it and earlier ones folded, and the versions as small pictures beside the frame. Marks are drawn with a box or a brush, in Dazbee's blue; there are no pins. The new version replaces the picture in its frame. On an editable frame it changes only its image layers. The conversation and the versions are kept outside the design.
- **Making a draft editable is optional, and happens in place.** The picture in the frame turns into layers in the same frame; the picture is kept, hidden, and Back to picture brings it back. The server part runs with no tab open; the matching finishes when a tab next opens the design, so the screen says "almost done: open to finish", never "ready" too early.
- **Other sizes use the editor's Add size card** in the edit panel. On a picture, the AI redraws it in each size picked, as pictures in a section beside it. On an editable frame, Add size makes a new frame from its layers, with Redraw with AI as the other choice. Make all editable turns a set of sizes into layers from one layer plan.
- **Failures and limits.** A draft that didn't come out says so, with Try again, and isn't charged. When the month's AI is used up, the message sits where the brief box is.
- **Leaving stops nothing.** Drafts keep arriving with the tab closed; Designs shows that a design is working, and a note names the design when it's done.
- **Who and where.** Reviewers see no brief box and no actions. On a phone, last: drafts, Refine with AI and download; layers stay on a computer.
- **Words.** Plain words only, never internal ones such as "linked"; no pop-up questions; options open in the panels the editor has.

### Canvas tools (26 Nov 2026)

Built first, as their own spec, because the AI flow stands on them.

- **Sections** group frames on a page under a title. A section has no fill and a soft grey outline that fits around its frames. Frames move freely inside it, out of it onto the canvas and into another section; a section left empty goes. A selected section offers Rename, Ungroup, Delete section (its frames stay) and Delete section and frames.
- **Connectors** join two things on a page (frames or sections) and follow them when they move. Drawn with the Arrow shape on the page outside any frame; a small dot marks where one starts, so it doesn't look like an arrow inside a frame. A connector whose end is gone is hidden.
- **Neither is exported.**
- **The tool dock**: Frame ▾ gains Section, Shapes ▾ makes a connector when an arrow is drawn on the page, and Hand moves into Select ▾. The Pages capsule lists a page's sections, each with zoom to.
- **The star** on frames (see above).
- **Notes, free text on the canvas and freehand drawing come later**, decided together with comments.

### Sizes and layers (25 Nov 2026)

- **Other sizes are made as pictures** from the chosen draft, but only when the person asks. Each is an edit call to the image model with the new shape, which keeps the content and changes the layout. The person checks the sizes side by side.
- **All sizes are layered in one batch**, then linked at once.
- **One layer plan for all sizes.** The layer plan is made once, from the chosen draft, and every size is layered with it. That way the same layer in each size can be linked. A size missing a layer has none, and its other links still work.
- **No early work.** Starring a draft doesn't start a layer plan, and asking for drafts doesn't warm up the GPU.

### Models (24–25 Nov 2026)

| Job                   | Model                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| Drafts                | **Muse Image** or **GPT Image 2.5 Sunburst** at medium quality         |
| High-quality final    | **None.** A draft is used as it is, or made editable when asked        |
| Edits and inpainting  | **Seedream 5.5**                                                       |
| Outpainting           | **Self-hosted**, not a hosted API                                      |
| Round plan, reading   | **`gpt-6-luna`** (light); a full planner for Precise, its own AI step  |
| Layer plan            | **`gpt-6.2-sol`**                                                      |
| Splitting into layers | **Ming-Image-0.1-Design-Layer**, self-hosted on ComfyUI, fp8, 12 steps |

- Layering runs **without guidance by default**; the API takes an optional guidance value.
- Layering resolution is **512 px** for people not paying and for demos, and **1024 px** for paying people. Until payments exist, workspaces given AI as a gift get **1024 px** too, set on the grant, not in code (26 Nov 2026).
- **Fast** runs the light round planner and Muse Image; **Precise** runs the full planner and GPT Image 2.5 (26 Nov 2026).

### Prompts (25 Nov 2026)

- **Each kind of thing has its own prompt set.** Dazbee makes ads, social posts, slides and more, and one prompt won't fit them all. Each AI request names its kind, and the prompts are picked by kind.
- **Ads come first**, using the reference flow's ad prompts as they are. Other kinds are added one at a time.

### Tracking and charging (24–25 Nov 2026)

- **Every AI call is tracked by its step** (round plan, draft, layer plan, layering, edit…), not by endpoint. Two steps calling the same endpoint are logged as two different steps.
- **One shared function makes every AI call.** It holds the expected cost, makes the call, reads the usage the reply reports, prices it, writes the call log row and charges the real cost. A new step adds only its name and expected cost to the step list. A new seller adds one adapter and its prices.
- **Call log:** one row per AI call, with step, model, seller, usage and real cost.
- **Allowance ledger:** rows are only added, never changed: hold, charge, give back.
- **No credits per feature.** The allowance is counted in our real cost and shown to people only as a usage bar. There are no 5-hour or weekly windows.
- **The allowance belongs to the whole workspace.**
- **Grants:** allowance comes in grants, each with an amount and an expiry. A grant can come from a pack, a trial, a gift or a subscription. Spending draws from the grant that expires first.
- **Products are admin data:** price, amount granted, how long it lasts and features are edited by an admin, not in code.
- **Each model is charged at its real cost.** There is no price per model; a dearer call takes more of the bar.
- **Layering is charged at a fixed cost per ad**, kept as admin data and changed over time. The call log still records the real GPU cost, and the daily check shows the difference.
- **Model names are never shown.** People pick a mode with a name of our own, and an admin maps each mode to a model, so changing the model doesn't change the screen.
- **The two draft modes are Fast and Precise.** Fast runs Muse Image and is the default; Precise runs GPT Image 2.5 Sunburst at medium.
- **Build the metering now, set prices later.** Every price and amount is admin data (see [Plans](#plans-25-nov-2026)).

### Building and running (25 Nov 2026)

- **Only the ad prompts are reused.** Everything else, code, architecture and UI, is designed and written fresh for Dazbee, following its ADRs and code layout; the reference flow is never copied.
- **Built from the latest official docs.** Every integration (Modal, OpenAI, Meta's Muse API, OpenRouter, ZenMux, Pixazo, pg-boss) is written from the provider's current documentation at build time, not from older code or memory.
- **Layering runs on a Modal H100** with GPU memory snapshots, as a deployed app.
- **Job queue: pg-boss**, in the Postgres we already run ([ai-flow-job-queue.md](ai-flow-job-queue.md)).
- **Sellers:** GPT from OpenAI. Muse from Meta's own API. ZenMux, OpenRouter and Pixazo are also connected, and each model can be bought from any of them that sells it, so one can stand in when another fails.
- **Daily cost check:** every day the call log is compared with each seller's own cost report, with an alert when they differ by more than 2%.
- **Checked against real bills while building.** A small number of real paid calls on our own workspaces are compared with each seller's billing page before taking money. Up to US$1–2 in all may be spent on these checks without asking first; the spend is reported after each round, and going past US$2 needs the owner's OK. For the AI flow on the canvas, up to US$8 in all, reported after each ticket (26 Nov 2026).
- **Prompts still to write:** a resize prompt, written and tested before resizing is built; prompts for other kinds when each kind is added.

### AI calls and metering (25 Nov 2026)

Settled in the grilling for the first spec, AI calls and metering.

- **Jobs run in their own container,** `apps/worker`, with a 256 MB cap (ADR-0022). The API only checks a job, sets its hold aside and saves it.
- **The layer split lives in `python/layering/`** as a Modal app, deployed by CI. While the first spec is built it is deployed only for each check and deleted after. It stays deployed once the AI flow screen goes live.
- **Seller order to start,** which an admin can change:

  | Model           | First      | Then, in order          |
  | --------------- | ---------- | ----------------------- |
  | GPT Image 2.5   | OpenAI     | ZenMux                  |
  | GPT text models | OpenAI     | OpenRouter, then ZenMux |
  | Muse Image      | Meta       | OpenRouter, then ZenMux |
  | Seedream 5.5    | OpenRouter | ZenMux, then Pixazo     |

- **The allowance is counted in rupees** (ADR-0023). The price list holds each seller's price in the currency it bills in, with any GST or fee it adds, and an admin-set rate per currency that includes the bank's forex fee.
- **Each grant keeps the usage rate of the day it was given,** so a new rate reaches a workspace with its next grant.
- **Holds:** an AI job holds its expected cost. It is refused when its hold is more than what is left. Each AI call that delivers is charged its real cost, a failed call is never charged, and the rest of the hold is given back. A job that costs more than its hold is still charged in full, so a grant can end a little below zero.
- **Grants in the first spec are gifts** an admin gives from the admin page. Trials, plans and packs come with plans and payments, on the same grants.
- **A workspace's Owner, Admins and Editors use AI;** Reviewers don't.
- **The call log keeps no prompt and no picture.**
- **No AI screen for people in the first spec.** It adds the admin page's AI section and a script that runs each AI step once for the bill checks.
- **A daily check that differs by more than 2% shows in red on the admin page.** It is emailed once Dazbee sends email of its own.
- **When a seller fails,** the call is tried once more there, then on the next seller. A call that times out counts as failed. A seller that made and billed it anyway shows up in the daily check.
- **Meta and Pixazo have no cost report to fetch.** Production uses its own keys for them. An unknown call is asked about again the next day where the seller allows it (Pixazo), and is otherwise counted as a cost to us (Meta). An admin uploads each seller's usage file from its dashboard, and the admin page compares it with the call log.

### Plans (25 Nov 2026)

- **Three paid plans: Solo, Team and Agency**, each for one kind of customer: one marketer, a company's team, an agency with clients. Each step up adds what the next customer needs (more people and brands, roles, approval, agents, client access, longer version history), not only more of the same.
- **Plans unlock features.** Each feature that can be locked has a key in the code; a plan is admin data listing its price, the keys it unlocks, its limits (brands, people) and its AI allowance. A new feature gets a key, and an admin picks which plans include it.
- **Prices are admin data** and can change at any time.
- **A 7-day free trial**, not a free plan. The trial opens the app with a small AI allowance of its own.
- **Top-up packs** add AI allowance when the bar runs out. Each lasts 3 months from the day it is bought.
- **When a trial ends, work becomes read-only**: designs can be opened and exported but not edited until the workspace pays. Nothing is deleted.
- **GST is added on top** of the listed price in India, once Dazbee is registered for GST. Until then no GST is charged, and the GST sellers add to their bills counts as part of our AI cost in the price list. The usage bar drains by that real cost, and allowances are not raised to make up for it.
- **Payments: Razorpay in India, Paddle abroad.**
- **The admin page sets everything that can change without code:** plan prices, allowances, limits and features; top-up packs; yearly plans; the trial; the fixed layering cost; which model runs Fast and Precise; seller prices and order; gifts to a workspace. It also shows usage, real cost by step and model, and the daily check.
- **A usage rate** in the admin page scales how much of the bar every AI use takes, for all plans at once.
- **A changed allowance or usage rate applies to everyone from their next month**, with no email. The current month is never changed. Top-up packs already bought keep their full amount.
- **A changed price applies to new customers only**, since Razorpay can't change a subscription made through UPI or e-mandate.

## Not decided

- **Starting numbers:** each plan's price, AI allowance and limits, the trial's AI allowance, top-up pack prices, and any yearly discount. A first guess is under discussion.
- **Whether Seedream on OpenRouter adds a watermark.**
