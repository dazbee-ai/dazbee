# Landing page

The marketing site at dazbee.com: one static page built with Vite and GSAP. It is separate from the app (`apps/web`) and shares only its fonts' faces.

```sh
pnpm install
pnpm dev --filter @dazbee/landing      # http://localhost:3100
pnpm --filter @dazbee/landing build    # static files in apps/landing/dist/
pnpm --filter @dazbee/landing preview  # serve dist/ on http://localhost:3100
pnpm --filter @dazbee/landing valley   # only when scripts/valley-source.jpg changes: rebuilds public/images/valley-*
```

## Deploy

dazbee.com is a Cloudflare Pages site uploaded by hand: build, then upload `dist/`. Nothing in CI or `deploy/` serves it.

## Layout

```
index.html          the page, its sections in order
src/main.js         entry: fonts, styles, GSAP, nav, and each section's scene; reduced motion is handled here
src/styles/         tokens.css holds every colour, type size and space; one file each for base, components, sections and the try-out
src/scenes/         one file per moving section: the valley hero (a WebGL shader), the concert, why, try-out, the city, how, sign-off
src/content/        the example brief, its routes and the try-out's ready-made concepts
src/ui/             the phone menu and the pilot form's checks
public/             served as is: images, sprites, favicon, share image
scripts/            builds the valley images from scripts/valley-source.jpg
```

The try-out shows ready-made concepts and says so on screen; nothing is generated live. It asks for an email before the concepts, and posts it as JSON to the URL in `.studio`'s `data-endpoint`; with none set, the email is not sent anywhere.

The pilot form opens the visitor's mail app with a message to the address in the form's `mailto:` action.
