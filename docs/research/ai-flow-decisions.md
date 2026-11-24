# AI flow: what is decided

The AI flow turns a brief into ad drafts, then into a layered design that can be edited. This page lists what the owner has decided for it, so the spec and its tickets don't drift from it. Every line under **Decided** was agreed by the owner on the date given. Lines under **Not decided** are open: don't build them as if they were settled.

The measurements behind these choices are in [ai-flow-image-models.md](ai-flow-image-models.md) and [ai-flow-job-queue.md](ai-flow-job-queue.md).

## Decided

### The screen (25 Nov 2026)

- **Start from the brief box that already exists** on the brand home ([`brief-form.tsx`](../../apps/web/components/brief/brief-form.tsx)): words, pictures, a reference design, brand kit picks. There is no separate AI start page.
- **One size to start.** The AI brief takes a single size; other sizes come later from the chosen draft.
- **Enter makes a round of 4 drafts**, shown below the brief box. The 4 are made at the same time, and each appears as soon as it is ready.
- **The brief box scrolls up**, gets smaller and stays at the top, so the brief can still be changed.
- **More like this** on a draft adds a row of 4 drafts under it. Rounds form a tree.
- **Picking any draft**, in any row, makes the row below show that draft's children.
- **The reference ad is kept** as an input to the brief.
- **Edit opens its own screen**, with a way back to the tree. There a person refines one draft by marking it with pins, a brush or boxes, plus words.
- **Leaving doesn't stop anything.** Jobs run on the server. A refresh, a page change or a closed tab loses nothing, and the person comes back to the same tree.

### Sizes and layers (25 Nov 2026)

- **Other sizes are made as pictures** from the chosen draft, but only when the person asks. Each is an edit call to the image model with the new shape, which keeps the content and changes the layout. The person checks the sizes side by side.
- **All sizes are layered in one batch**, then linked at once.
- **One layer plan for all sizes.** The layer plan is made once, from the chosen draft, and every size is layered with it. That way the same layer in each size can be linked. A size missing a layer has none, and its other links still work.
- **No early work.** Starring a draft doesn't start a layer plan, and asking for drafts doesn't warm up the GPU.

### Models (24–25 Nov 2026)

| Job                   | Model                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| Drafts                | **Muse Image** or **GPT Image 2.5 Sunburst** at medium quality         |
| High-quality final    | **None.** The picked draft goes straight to layering                   |
| Edits and inpainting  | **Seedream 5.5**                                                       |
| Outpainting           | **Self-hosted**, not a hosted API                                      |
| Round plan, reading   | **`gpt-6-luna`**                                                       |
| Layer plan            | **`gpt-6.2-sol`**                                                      |
| Splitting into layers | **Ming-Image-0.1-Design-Layer**, self-hosted on ComfyUI, fp8, 12 steps |

- Layering runs **without guidance by default**; the API takes an optional guidance value.
- Layering resolution is **512 px** for people not paying and for demos, and **1024 px** for paying people.

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

- **Built from the latest official docs.** Every integration (Modal, OpenAI, Meta's Muse API, OpenRouter, ZenMux, Pixazo, pg-boss) is written from the provider's current documentation at build time, not from older code or memory.
- **Layering runs on a Modal H100** with GPU memory snapshots, as a deployed app.
- **Job queue: pg-boss**, in the Postgres we already run ([ai-flow-job-queue.md](ai-flow-job-queue.md)).
- **Sellers:** GPT from OpenAI. Muse from Meta's own API. ZenMux, OpenRouter and Pixazo are also connected, and each model can be bought from any of them that sells it, so one can stand in when another fails.
- **Daily cost check:** every day the call log is compared with each seller's own cost report, with an alert when they differ by more than 2%.
- **Checked against real bills while building.** A small number of real paid calls on our own workspaces are compared with each seller's billing page before taking money. Up to US$1–2 in all may be spent on these checks without asking first; the spend is reported after each round, and going past US$2 needs the owner's OK.
- **Prompts still to write:** a resize prompt, written and tested before resizing is built; prompts for other kinds when each kind is added.

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
- **Which seller is first for each model**, and whether Seedream on OpenRouter adds a watermark.
