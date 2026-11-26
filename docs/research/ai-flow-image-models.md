# AI flow: image models, measured

This is the input for the AI template flow spec. It records which hosted models make, edit and split an ad, what they really cost, and what goes wrong with each. Prices were read or measured on 24 Nov 2026 and use ₹92.92 per US$1 (ECB rate, 23 Nov 2026). Sellers bill in dollars, so the bank's forex fee and any 18% GST come on top.

## Decisions so far

| Job                              | Choice                                                                                             | Why                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Make an ad (drafts)              | **Muse Image** or **GPT Image 2.5 Sunburst** at medium; no high-quality final (owner, 24 Nov 2026) | Picked after a side-by-side test of 6 models; the picked draft goes straight to layering |
| Edit by instruction              | Seedream 5.5 or Muse Image                                                                         | Both kept text, logo and product                                                         |
| Inpaint (change one area)        | **Seedream 5.5** with a `<bbox>` in the prompt; Muse Image as the fast, cheap option               | GPT Image 2.5's mask edit removed the object but didn't add the new one                  |
| Outpaint (extend the background) | **Host it ourselves**                                                                              | Every hosted model tested re-frames the photo                                            |
| Resize a whole ad to a new shape | Any of the three                                                                                   | All three re-laid out a square ad as 9:16 well                                           |
| Split into layers                | Ming Design Layer, self-hosted on ComfyUI; Seedream 5.5 layer split as the hosted option           | See [Layers](#layers)                                                                    |

Dropped models:

- **MAI-Image-2.7 Flash.** It is sold only on Pixazo, only 66.7% of calls succeed there, and each picture takes 150–170 s. It also adds copy nobody asked for and got a logo wrong.
- **GPT Image 2.6 Sunburst.** It made the best-looking ads, but costs about 3× GPT Image 2.5 at medium.
- **Nano Banana 2.1.** It costs about ₹4.1 a picture, not the ₹3.12 listed, because its thinking tokens are billed.

## Draft flow (decided by the owner, 24 Nov 2026)

1. Make 4 drafts with Muse Image or GPT Image 2.5 at medium.
2. The person picks one.
3. Split the picked draft into layers. There is no high-quality final.

Text quality in the picture matters less than it seems: once the ad is layered, its text becomes real Dazbee text.

Cost of one round of 4 drafts (layering is extra; see [Layers](#layers)):

| Drafts                                          | Cost of 4 |
| ----------------------------------------------- | --------- |
| Muse Image (₹0.93 each)                         | ₹3.72     |
| GPT Image 2.5 medium, 1K square (₹1.22 each)    | ₹4.88     |
| GPT Image 2.5 medium, vertical 768×1360 (₹0.71) | ₹2.84     |

## Generation test: 6 models, 24 pictures

The test used two ads for real brands (travel and beauty), with the same prompt on every model, each made as a square at about 1K and as a 9:16 vertical. The total was ₹48.8.

| Model                          | Bought from | Square   | Vertical | Time per picture | What we saw                                      |
| ------------------------------ | ----------- | -------- | -------- | ---------------- | ------------------------------------------------ |
| GPT Image 2.5 Sunburst, medium | OpenAI      | ₹1.27    | ₹0.76    | 18–45 s          | Close to 2.6; added claim icons nobody asked for |
| GPT Image 2.6 Sunburst, medium | OpenAI      | ₹4.09    | ₹2.40    | about 19 s       | The most polished                                |
| Nano Banana 2.1                | ZenMux      | ₹4.0–4.3 | ₹4.1     | 29–66 s          | Clean but plain                                  |
| Seedream 5.5                   | ZenMux      | ₹1.86    | ₹1.86    | 42–50 s          | One misspelled headline; weaker layouts          |
| Muse Image                     | ZenMux      | ₹0.93    | ₹0.93    | 17–26 s          | Simple and clean; strong for its price           |
| MAI-Image-2.7 Flash            | Pixazo      | ₹1.02    | ₹1.02    | 150–170 s        | Rich, but invented copy and a wrong logo         |

Where the costs come from:

- **GPT Image:** OpenAI's usage figures. Image output is $30/M tokens and text input $5/M.
- **ZenMux models:** ZenMux's request logs, which matched our sums to the cent.
- **MAI Flash:** Pixazo's rate card; no bill was read.
- **Failed calls** were not charged on any seller.

## GPT Image pricing works by tiles

OpenAI's price calculator works out output tokens from a grid of tiles. Quality sets the grid (low 16, medium 24, high 48, xhigh 64, max 96 tiles on the long side). The short side gets proportionally fewer tiles. Tokens = ceil(tiles × (2,000,000 + width × height) / 4,000,000). GPT Image 2.6 then multiplies by 4.2 at low and 3.3 at medium. At high and above, 2.5 and 2.6 cost the same.

So **the shape of the picture matters more than its resolution.** A 16:9 picture costs less than a square, and 1080p widescreen costs less than a 1K square.

| Size                                  | 2.5 medium | 2.6 medium | High (2.5 or 2.6) |
| ------------------------------------- | ---------- | ---------- | ----------------- |
| 816×816 (the smallest allowed square) | ₹1.07      | ₹3.53      | ₹4.28             |
| 768×1360 (9:16)                       | ₹0.71      | ₹2.36      | about ₹2.6        |
| 1280×720                              | ₹0.69      | ₹2.26      | ₹2.64             |
| 1024×1024                             | ₹1.22      | ₹4.04      | ₹4.90             |
| 1920×1088                             | ₹0.96      | ₹3.16      | ₹3.69             |
| 2048×2048                             | ₹2.49      | ₹8.21      | ₹9.95             |

Size limits:

- each side a multiple of 16;
- aspect ratio between 1:3 and 3:1;
- longest side at most 3840 px;
- 655,360 to 8,294,400 pixels in total.

That makes 512×512 and 1080×1920 invalid; 1152×2048 is the 9:16 alternative.

Leaderboards test GPT Image at **max** quality (₹19.6 for a 1K square). No leaderboard ranks medium. Transparent output works with `background: "transparent"` and PNG or WebP output.

## Edit test: 3 models, 15 calls, ₹23.1

The inputs were two of the test ads, plus a text-free crop of one for outpainting.

| Job                           | GPT Image 2.5 (OpenAI)                                | Seedream 5.5 (ZenMux)               | Muse Image (ZenMux)         |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------- | --------------------------- |
| Edit: background colour       | ✅                                                    | ✅                                  | ✅                          |
| Inpaint: replace one object   | ⚠️ removed it but added nothing                       | ✅ from a `<bbox>` in the prompt    | ✅ from words alone         |
| Changed outside the area      | 6.3%                                                  | 4.0%                                | 9.0%                        |
| Outpaint to landscape or 9:16 | Re-framed: 34–50% of the original changed             | Re-framed: 68–74%                   | Re-framed: 57–66%           |
| Resize the whole ad to 9:16   | ✅                                                    | ✅                                  | ✅                          |
| Cost per edit                 | ₹1.5–2.1 (a 1K input picture is 1,024 tokens at $8/M) | ₹1.86 (ZenMux charged no input fee) | ₹0.93 (input pictures free) |
| Time per edit                 | 21–25 s                                               | 22–117 s                            | 11–20 s                     |

**None of the three promises to keep pixels outside the edited area.**

- For **inpaint**, paste the original back outside the area after every edit; that fixed it cleanly in the test.
- For **outpaint**, pasting back leaves seams, because each model moves and rescales the original. That is why outpaint will be self-hosted.

How each model edits:

- **GPT Image 2.5:**
  - `POST /v1/images/edits` takes up to 16 images.
  - Inpaint takes a `mask` (an alpha PNG the same size as the image; OpenAI calls it "guidance") or `markup` (a transparent PNG of drawn marks).
  - It has no box or point option, and `input_fidelity` is not documented for 2.5.
- **Seedream 5.5:**
  - Takes up to 10 reference images.
  - It has no mask. Instead, the prompt takes `<point>x y</point>` or `<bbox>x1 y1 x2 y2</bbox>` on a 0–999 grid, or marks drawn on the picture ("interactive editing").
  - BytePlus adds a watermark by default.
- **Muse Image:**
  - Meta's API takes 1–10 input images.
  - A mask, or `input_fidelity`, returns error 400.
  - `size` sets only the aspect ratio; the model picks the resolution.

## Layers

**Ming Design Layer** (inclusionAI, MIT licence) turns a picture into RGBA layers. No hosted API works:

- ZenMux has sunset it.
- Pixazo's calls fail upstream with 403.

Measured on a Modal H100 with ComfyUI v0.46, which has Ming built in:

| Setup | No guidance                | With guidance              |
| ----- | -------------------------- | -------------------------- |
| fp8   | 17.5 s per ad (about 1.9¢) | 33.5 s per ad (about 3.7¢) |
| BF16  | 20.3 s                     | 38.5 s                     |

- **fp8 and BF16** look nearly the same.
- **Cold start:** a GPU memory snapshot restores in 32–38 s, so a cold call returns its first result in about 50–55 s. Snapshots work on deployed apps only. A DiT saved once as fp8 (6.16 GB) cut the first-load ad from 84 s to 57 s.
- **Decisions:**
  - No guidance by default. The API takes an optional guidance value.
  - 512 px for non-paying users and demos (not yet measured), 1024 px for paying users.
  - Don't try guidance on a 48 GB GPU.
- **Best-quality settings,** per the official pipeline: cfg 3.0, 12 steps, euler, simple, and shift about 3.86 at 1024. Guidance doubles the time and mostly improves the fill of hidden areas.
- vLLM-Omni was dropped: its compile is broken and its cold start is about 329 s.
- One wide car-photo ad failed to separate.

**Seedream 5.5 layer split** is the hosted option. It gives named layers with bounding boxes and z-order, and can read the text with its font and colour.

- **Price:** $0.02 per output layer up to 2.6 MP (the base counts as one), plus $0.008 per input picture on Pixazo. A base plus 7 layers at 1.5K is $0.168.
- **Layer count:** up to 99 layers on BytePlus; Pixazo allows 2–20.
- **ZenMux** carries Seedream 5.5 but offers no layer option.
- **To cut cost,** prompt for grouped layers (all text in one, all shapes in one, each cut-out separate) and crop blocks by our own boxes.

## Sizes Seedream 5.5 accepts

- **Exact pixels:** 921,600 to 4,624,220 pixels in total, aspect ratio 1:16 to 16:1. So 1280×720 is the smallest; 512×512 is rejected.
- **Tiers:** 1K, 1.5K or 2K. For 16:9, 1K is 1424×800, 1.5K is 2048×1152 and 2K is 2816×1584.
- **Price:** anything up to 2.6 MP is $0.02 (₹1.86); 2K is $0.035 (₹3.25).
- **On ZenMux,** `generate_images` and `edit_image` accept only the tier names (`imageSize: "1K"`) plus `aspect_ratio`. Pixel sizes are rejected.
- **Other versions:**
  - Seedream 5.0 Flash takes only 1K or 2K.
  - Seedream 5 Lite starts at 2560×1440.

## Seller notes

**ZenMux** (`https://zenmux.ai/api/v1` for the OpenAI protocol, `https://zenmux.ai/api/vertex-ai` for the Vertex protocol):

| Model        | Make                                                                 | Edit                   | Notes                                                                                                  |
| ------------ | -------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Nano Banana  | Vertex `generate_content`, `image_config` with aspect ratio and size |                        |                                                                                                        |
| Seedream 5.5 | Vertex `generate_images`                                             | Vertex `edit_image`    |                                                                                                        |
| Muse Image   | OpenAI `/images/generations`                                         | OpenAI `/images/edits` | The Vertex protocol returns 404; size sets only the aspect ratio (it returned 1600×1600 and 1280×1920) |

ZenMux's logs show the exact charge for every call.

**OpenAI:** usage figures come back with every response and match the price calculator exactly.

**Pixazo:**

- calls are asynchronous: submit, then poll the status;
- output links need a User-Agent header;
- it reserves the maximum charge on submit;
- Seedream layer split needs a public `image_url`.

## Every AI feature run once, 26 Nov 2026

Seven real jobs through a local API and worker on our own workspace: a Fast round with a reference ad, a Precise round, more like this, try again, a refine with no marks, other sizes at two sizes and make editable on one frame. The brief had one picture (2400 × 1343) and asked for square ads. Costs are real cost as the call log keeps it, in rupees: the seller's dollars at the day's rate, OpenAI's with GST. Each preset's first guess is the dearest call here, rounded up to a paisa, and its longest time.

| AI function    | Preset           | Seller | Calls | Real cost a call | Time        | What it used                                   |
| -------------- | ---------------- | ------ | ----- | ---------------- | ----------- | ---------------------------------------------- |
| Reference read | luna             | OpenAI | 1     | ₹0.06            | 5.3 s       | 1,626 tokens in, 203 out, fast tier            |
| Round plan     | light-luna       | OpenAI | 2     | ₹0.33–0.54       | 8.4–9.7 s   | 10,720 in and 2,573 out at the most, fast tier |
| Round plan     | full-terra       | OpenAI | 1     | ₹1.54            | 22.6 s      | 6,934 in, 1,321 out                            |
| Draft          | gpt-image-medium | OpenAI | 13    | ₹3.01–3.04       | 20.9–27.9 s | 439 image tokens out, 1,508 in for the picture |
| Refine plan    | luna             | OpenAI | 1     | ₹0.05            | 2.0 s       | 1,745 in, 131 out, fast tier                   |
| Refine edit    | seedream         | ZenMux | 1     | ₹1.93            | 58.7 s      | US$0.02 flat, the input picture free           |
| Resize         | seedream         | ZenMux | 2     | ₹1.93            | 65.3–85.2 s | US$0.02 flat, the input picture free           |
| Layer plan     | sol              | OpenAI | 1     | ₹3.98            | 37.3 s      | 3,854 in, 2,729 out                            |
| Layer split    | ming             | Modal  | 1     | ₹3.04            | 98.3 s      | 25.8 GPU seconds at 1024 px, from a cold start |
| Reading        | luna             | OpenAI | 1     | ₹0.05            | 4.2 s       | 2,134 in, 531 out                              |

- **A brief's picture more than doubles a draft.** The picture is 1,508 image tokens in, about as much again as the 439 tokens of the square that comes out: ₹3.04 against the ₹1.27 measured with no picture.
- **Whole jobs:** the Fast round ₹12.75 in 43 s, the Precise round ₹13.60 in 52 s, more like this ₹12.47 in 40 s, try again ₹3.04 in 24 s, the refine ₹1.98 in 64 s, two sizes ₹3.85 in 86 s, make editable ₹7.07 in 137 s.
- **Modal billed US$0.19 for the one split,** six times the 25.8 GPU seconds the call is priced at: the rest is the container starting from its snapshot and waiting 60 s after the call.
- **The recording** of these 24 calls replays a Fast and a Precise round with no seller called.
- **Make an image, the same day:** six images through the app on Muse Image, bought from Meta, two at each ratio. Each cost ₹0.93, ₹1.10 with GST, and took 7.1–23.6 s. Asked for 1024 × 1024, 1536 × 1024 and 1024 × 1536, Muse gave back 1600 × 1600, 1920 × 1280 and 1280 × 1920: the ratio asked for, at its own size.

## Not yet known

- **Low-quality previews:** whether GPT Image 2.5 at low quality is good enough to choose from. No picture was made at low.
- **Ming at 512 px:** quality and speed.
- **A self-hosted outpaint model:** none chosen or tested yet.
