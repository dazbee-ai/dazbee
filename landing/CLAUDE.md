# Dazbee landing page

Marketing site for Dazbee, kept in `landing/` inside the Dazbee repo. It is separate from the app (`apps/web`) and local only for now: `landing/` is listed in `.git/info/exclude`, so nothing here reaches the shared repo unless Yuvaraj decides to add it.

## What the page must do

A visitor from a paid social agency should know in five seconds what Dazbee does, try it on their own brief, and be led to join the pilot. Positioning (picked 2026-11-18): **more distinct concepts every week for Meta**, with speed and client sign-off as support.

- Audience: practitioners at independent paid social agencies (10 to 60 people) running Meta for DTC brands.
- Copy source: `content/copy.md` (v4.1). Living doc with all versions: https://claude.ai/artifact/WoqnByFuhGfCYpxtx8V5Z6
- Look (v2.1, from `moodboard/`, including the Stillness images and `background.png`): clean, light and roomy. A green valley whose sky stays smooth and light blue and whose land is drawn in blocks, with a lens that shows the smooth picture; the app's own type (Bricolage Grotesque headings, Geist text, Geist Mono numbers); white cards on near-white paper; soft sky-blue glows that rise out of the paper and go back into it so sections run together; a busy voxel city that runs edge to edge and fades into the sections either side; a full-width valley behind the closing call to action. `moodboard/MOODBOARD.md` says what each reference gave.

## Versions

- `versions/v1/`: draft 1 (paper page, Figtree, living meadow photo). Kept as it was on 2026-11-18. Run it from that folder the same way.
- `versions/v2-archive/v2.tgz`: v2 as delivered on 2026-11-19 morning (dithered meadow, cobalt bands).
- Root: v3.5 (2026-11-19): city ground drawn with the iso tile art (art/city/ground, flattened by tools/unproject-tiles.py into public/sprites/city/ground); full pixel valley (framed 1.3x so the hills clear the headline), one colour per headline line (never per letter, no glow, no added background), VS slider, product clip second, a vs screen for the Meta pain, a dark concert venue with real audiences and avatar personas, a talking town (speech bubbles). Order: hero, see it (clip slot), why (vs), try, routes concert, how, city, sign-off, about (founder note slot), pilot, FAQ, footer. No pilot terms line. Audiences are real audience descriptions, never dot-plus-label markers. Tuned for desktop first; phone and tablet get a proper pass once the desktop look is agreed.

## Run it

```
cd landing
npm install        # once, and again after pulling a version with new packages
npm run dev        # local server with live reload, prints the address
npm run build      # production files in dist/
npm run preview    # serve dist/ to check the build
node scripts/valley-render.mjs   # only when scripts/valley-source.jpg changes: rebuilds the valley images
node scripts/images.mjs          # share.jpg and the older meadow images (v2)
```

Opening `index.html` straight from the folder will not work (it needs Vite). Node 20 or later.

## Structure

```
landing/
  index.html                 the page, sections in order: hero, product (orbit), why, try, services, example (board), sizes (town), how, review (sign-off), about, pilot, faq, closing
  src/main.js                entry: fonts, styles, GSAP setup, nav state, starts each scene; reduced motion handled here
  src/styles/tokens.css      colours, type, spacing, radii (one place for every value)
  src/styles/base.css        reset, page ground, type defaults, .wrap
  src/styles/components.css  nav, buttons, tags, app window, the CSS-drawn example ads, phone, toast, form, faq
  src/styles/sections.css    one block per section in page order, including the town's pieces
  src/styles/try.css         the try-out studio and its code-drawn concept banners (.cad)
  src/scenes/valley.js       the hero: one raw WebGL shader over the graded valley; smooth sky, land in palette blocks, a lens
  src/content/valley-look.js the valley palette and paper colour, shared by the shader and scripts/valley.mjs
  src/content/routes.js      the example brief (Sorrel & Oat) and its six routes, the four sizes, banner() helper
  src/ui/cad.js              banners drawn in code: cad() for the try-out templates, ad() for the classic routes
  src/scenes/orbit.js        product section: the brief in the middle, six routes on a tilted ring; drag, click or tabs
  src/scenes/why.js          six cards flip from six tweaks of one ad (one idea) to six routes (six ideas)
  src/scenes/board.js        the example board (brief note, three routes in four sizes, two teammates' cursors) and the services fan
  src/scenes/meadow.js       v2's dithered meadow shader, no longer used by the page
  src/scenes/try.js          the try-out flow: brief or prompt, email, four angles, dither "making", concepts in four sizes
  src/content/concepts.js    the try-out's ready-made concept sets (skincare, food and drink, fitness, software)
  src/scenes/town.js         the voxel town in CSS 3D; starts close on one size, visits the others, then shows the whole town
  src/scenes/how.js          pinned with its title: four steps beside one stage that acts each step out, scrubbed
  src/scenes/review.js       sign-off: notes slide in, then comment, brief check, approve, stamp and toast on loop
  src/ui/nav.js, form.js     phone menu; pilot form checks
  public/                    served as is: images/ (valley-*, plus v2's meadow images), favicon.svg, share.jpg
  scripts/valley.mjs         the valley look (sky mask, sky regrade, palette blocks), kept in step with the shader
  scripts/valley-render.mjs  builds images/valley-* from scripts/valley-source.jpg (the moodboard's background.png)
  scripts/images.mjs         v2: builds share.jpg and the meadow images from scripts/meadow-source.jpeg
  content/                   copy and the earlier style notes
  moodboard/                 v2 reference images and notes
  docs/decisions.md          what was decided, when and why (newest first)
```

## Stack

Vite 7, GSAP 3.13 (ScrollTrigger, SplitText; free). Fonts self-hosted through Fontsource, the same faces as the app (`apps/web/lib/fonts.ts`): Clash Display (headings, from v2.4; self-hosted file public/fonts/ClashDisplay-Variable.woff2 from fontshare.com, falls back to Bricolage Grotesque), Geist variable (text), Geist Mono variable (sizes and tags). No three.js: the valley is a small hand-written shader and the town is plain CSS 3D. board.js is no longer used; src/scenes/voxel.js on the Mac is a leftover from v3 and is not imported.

## Rules

- Values come from `tokens.css`. Raw hex only inside drawn things (ads, town pieces, concept palettes).
- Palette: paper `#f7f5ef`, ink `#14161c`, sky `#dcebf5` and sky ink `#24456b` for italics and small accents, and one bright accent, lime `#d9f24f`, for primary buttons only. No purple or violet, no mascot or bee. Sections sit on paper; colour arrives as soft glows that fade back to paper, never as hard bands.
- Type: serif headlines with the second half in italic; sans for reading; mono for sizes; pixel face only for small tags and labels. Sentence case.
- One button shape (pill). Buttons say a verb and an object ("Join the pilot", "Try it with a brief"). No "Learn more".
- Motion: the hero enters once; the valley, the orbit, the board's cursors, the town's cars and the sign-off loop keep moving (each pauses off screen); town and how are pinned and scrubbed by the scrollbar; why flips once by itself on arrival. The lens follows the pointer with no easing and stays where it stops. Under reduced motion nothing moves and every scene shows its end state.
- CSS 3D town: no opacity, filter or mask on a 3D parent (it flattens the scene). Sizes in world px on a 1000 × 1000 plot.
- The try-out shows ready-made concepts and says so on screen. Never present them as generated live. Its email goes nowhere until a form service is chosen: set `data-endpoint` on `.studio` to POST it.
- Desktop first for now (Yuvaraj, 2026-11-19). Once the look is agreed: works at 360px wide with no sideways scroll. Text contrast 4.5:1.
- Copy: "creative" is the agency's idea, so never claim Dazbee makes it; banners are "assets". A "concept" is a distinct route. Never say "ad film". No competitor names. Made-up brands only (Sorrel & Oat, Ridge Coffee, Stride Lab, Ledgerly).
- Claims: only promise what is built. No Meta facts beyond Meta's own guidance ("creative diversification").
- The pilot is free and there is no pricing on the page. No DeltaX or Stunnr mention anywhere.
- Contact address is a stand-in (`hello@dazbee.example`) until a real inbox exists.
- Checks before a change ships: `npm run build`, then look at 1440 wide (and 820 and 390 once phones are in scope), and walk the try-out once.

## Copy rules added in v2.2
- No eyebrows or tags above headings (the hero's "Free pilot" tag went in v2.3), and no lines that explain how to use the page ("drag the ring", "pick a route").
- Sign-off is described as "your client comments on the banner and approves". Don't say "one link" or "review link": a plugin for existing systems and in-app reviews are planned, and neither is built, so don't claim them either.
- Reach is framed as different kinds of buyer ("different routes speak to different buyers"), never as Meta targeting mechanics.

## Slots waiting for Yuvaraj (v3)
- Product clip: replace `.clip__slot` with the `<video>` noted in index.html (media in public/media/).
- Founder note and photo in About (`.about__slot`, `.about__photo`).
- Pilot terms are a draft: "4 weeks · one client brand · set up with you · free · you keep every file". Confirm or change in index.html (hero, pilot, footer).
- Clash Display font file in public/fonts/.
