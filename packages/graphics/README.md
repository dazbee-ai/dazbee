# @dazbee/graphics

The icons, stickers, scene illustrations and artwork (objects, 3D objects, shapes, hand-drawn accents, effects and backgrounds) agents place in designs (`search_graphics` and `place_graphic` in the MCP server), with their licences. Every icon and sticker set is MIT or CC0, every illustration set's licence lets an ad show its scenes with no credit, and the artwork sets are MIT, CC0 or CC BY 4.0, whose credit the notices page gives; the app lists each licence on its third-party notices page (`/notices`), and `THIRD-PARTY-NOTICES.md` quotes the illustration and artwork sets' licences with their pages.

## Icons

| Set            | Styles                                       | npm package (pinned)         |
| -------------- | -------------------------------------------- | ---------------------------- |
| Tabler Icons   | outline, filled                              | `@tabler/icons` 3.52.0       |
| Phosphor Icons | regular, thin, light, bold, fill and duotone | `@phosphor-icons/core` 2.1.1 |

`sets/<set>/` holds each set's LICENSE as its package ships it and one JSON file of path data per style; `sets/index.json` holds each icon's name, styles and tags for search; `src/notices.json` holds what the notices page lists. Never edit them by hand: change a pin in `package.json`, install, and run `pnpm --filter @dazbee/graphics icons`, which writes them all from the installed packages. `notices.test.ts` fails while they are from another version than the pin.

An icon is placed as an SVG file every shape of which is filled with one colour (`iconSvg`), so each layer the SVG reader makes of it has a fill a brand colour binds. Tabler's outline style is drawn with lines, which are outlined when placed, 2 of 24 wide with round ends and corners, finely enough for the size it is placed at.

## Stickers

| Set          | Styles                                   | Licence | Source (pinned)                                                          |
| ------------ | ---------------------------------------- | ------- | ------------------------------------------------------------------------ |
| Fluent Emoji | 3d (a 256 px PNG picture), flat (an SVG) | MIT     | GitHub `microsoft/fluentui-emoji` at commit `1ffb34c`, default skin tone |
| Open Peeps   | drawing (an SVG)                         | CC0     | The 93 Peeps openpeeps.com offers as SVG files, read 2026-11-22          |
| Humaaans     | drawing (an SVG)                         | CC0     | The 5 illustrations humaaans.com shows as SVG files, read 2026-11-22     |
| Open Doodles | drawing (an SVG)                         | CC0     | The 33 doodles opendoodles.com offers as SVG files, read 2026-11-22      |

A drawing sticker is placed as the layers the SVG reader makes of it, in its own colours. A picture sticker is placed as an image: the API copies the picture it keeps in storage into the brand's asset library, recorded with an upload's checks, once for the same bytes.

`sets/fluent-emoji/flat.json` holds Fluent Emoji's flat drawings, and `sets/<set>/drawing.json` a CC0 set's SVG files, by name. Each set's LICENSE sits beside them; a CC0 set's LICENSE is its makers' words above the CC0 1.0 legal code. `sets/stickers.json` is the stickers' search index and `src/sticker-notices.json` is what the notices page lists. Never edit them by hand: change Fluent Emoji's commit in `src/sets.ts`, or a file's link and SHA-256 in `src/sticker-sources.json`, then run `pnpm --filter @dazbee/graphics stickers`. It downloads every source, refuses a file whose SHA-256 differs from its pin, and writes them all.

The repository doesn't hold the 3D pictures (54 MB). `src/sticker-pictures.json` lists each one's path in Fluent Emoji's repository, its SHA-256, its size and its pixel size, and the pictures themselves live in Dazbee's storage under `bundled/<sha256>`. Store them once per environment, and again after `stickers` writes the list anew:

```sh
pnpm --filter @dazbee/api stickers:upload
```

It uses the API's storage settings from the environment; in a deployed API container, which has no pnpm, run `node apps/api/src/scripts/upload-stickers.ts` from the image's root. It reads the pictures from Fluent Emoji's archive at the pinned commit, refuses one whose SHA-256 isn't the listed one, and stores only those storage doesn't hold yet; a run with nothing to store doesn't download the archive. Until it has run, placing a 3D sticker is refused with a sentence that points the agent to the flat style, and every drawing still places.

## Illustrations

| Set                   | Style     | Licence                                         | Source (pinned)                                                                                                        | Count |
| --------------------- | --------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| unDraw                | flat      | unDraw's (https://undraw.co/license)            | GitHub `balazser/undraw-svg-collection` at commit `9c02f98`, a copy of unDraw's illustrations up to July 2023          | 1,360 |
| ManyPixels Chromablue | flat      | ManyPixels' (https://www.manypixels.co/gallery) | The Chromablue scenes the ManyPixels gallery offers as SVG files, read 2026-11-22, each pinned by its link and SHA-256 | 470   |
| ManyPixels Birdview   | isometric | ManyPixels' (https://www.manypixels.co/gallery) | The Birdview scenes the ManyPixels gallery offers as SVG files, read 2026-11-22, each pinned by its link and SHA-256   | 466   |

Each set is drawn in one style, so a design keeps to one set. An illustration is placed as the layers the SVG reader makes of it, in its own colours, or with its set's accent colour (unDraw's `#6c63ff`, ManyPixels' `#68e1fd`) swapped for a hex colour or a brand kit colour, which the accent's plain fills are bound to. Placing one adds its file to the brand's asset library as an SVG file, recorded with an upload's checks (the SVG reader's thread and limits), once however often it is placed.

The repository doesn't hold the files (41 MB). `src/illustrations.json` lists each one's source, SHA-256, size, drawn size, tags (its own words and its set's) and topics (the ad topics its words put it in, from `src/illustration-topics.ts`, which search matches a little less); `src/illustration-notices.json` quotes each set's licence page. Never edit the manifest by hand: change a pin in `src/sets.ts`, then run

```sh
pnpm --filter @dazbee/graphics illustrations [folder]
```

It reads unDraw from its repository's archive at the pinned commit, writing the accent for the CSS variable the copy paints it with, and reads the gallery's list pages one every 2 seconds for each ManyPixels style, fetching each file 250 ms apart; a file the SVG reader can't read whole, or larger than an SVG upload may be, is left out. A folder given keeps what the gallery served and is read again on the next run. Then store the files once per environment, and again after the manifest changes:

```sh
pnpm --filter @dazbee/api illustrations:upload
```

It uses the API's storage settings from the environment; in a deployed API container, run `node apps/api/src/scripts/upload-illustrations.ts` from the image's root. It reads the files from their pinned sources, refuses one whose SHA-256 isn't the listed one, and stores only those storage doesn't hold yet; a run with nothing to store reads no source. Until it has run, placing an illustration is refused with a sentence that says its file isn't stored yet.

## Artwork

| Set                    | Kind       | Format | Licence   | Source (pinned)                                                                                                      |
| ---------------------- | ---------- | ------ | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Streamline Kameleon    | object     | SVG    | CC BY 4.0 | GitHub `webalys-hq/streamline-vectors` at `52d750c`, `kameleon/colors`                                               |
| Streamline Plump       | object     | SVG    | CC BY 4.0 | the same, `plump/flat` (its colour set: two blues)                                                                   |
| Streamline Freehand    | object     | SVG    | CC BY 4.0 | the same, `freehand/duotone` (its free colour set: black and a blue)                                                 |
| Streamline Stickies    | object     | SVG    | CC BY 4.0 | the same, `stickies/colors`                                                                                          |
| 3dicons                | 3d         | PNG    | CC0       | each icon of GitHub `realvjy/3dicons` at `8884d59`, in 4 colour styles from 3 angles, from the site's 400 px renders |
| Coolshapes             | shape      | SVG    | MIT       | GitHub `realvjy/coolshapes` at `de6c8f9`, `public/shapes/svg` (each shape in one colour, white)                      |
| dddoodle               | accent     | SVG    | CC BY 4.0 | fffuel's `dddoodle-pack.zip`, read 2026-11-22, pinned by its SHA-256                                                 |
| Kenney Particle Pack   | effect     | PNG    | CC0       | GitHub `Calinou/kenney-particle-pack` at `ab70866`, a copy of Kenney's pack                                          |
| Kenney Smoke Particles | effect     | PNG    | CC0       | the copy of Kenney's pack in GitHub `Poipoise/Deadly-Faith` at `ea19f5b`, each file by its link                      |
| Pattern Monster        | background | SVG    | MIT       | GitHub `catchspider2002/svelte-svg-patterns` at `803e30b`, each pattern's tile as the site's download writes it      |

Each set is drawn in one style, except 3dicons, whose styles are its colour styles and angles (`clay-iso`), so a design keeps to one set and style. Placing a graphic adds its file to the brand's asset library, recorded with an upload's checks, once however often it is placed. A picture is placed as an image, an effect drawn light (most of its drawn pixels light, measured when the manifest is written) in the screen blend, so its dark drops out over a photo. An SVG file is placed as the layers the SVG reader makes of it, in its own colours; a set drawn in a few colours (`paints` in `src/artwork-sets.ts`: Coolshapes, dddoodle, Streamline Plump and Freehand) takes a colour given, its first paint written as it, a brand kit colour bound, and its other paints as the same lighter or darker mix of it. A background is its pattern's tile repeated over the box, at the site's default scale for a 1080 px side, its paths in a colour given and its backdrop in another or none.

The repository doesn't hold the files. `src/artwork.json` lists each graphic's tags (its own words, its folder's, the words `src/artwork-words.ts` adds, such as "sparkle" for a spark, and its set's) and each style's source, SHA-256, size and drawn size; `src/artwork-notices.json` holds each set's notice: who made it, where Dazbee takes it from, its makers' licence file, and for a CC set the Creative Commons legal code. Never edit them by hand: change a pin in `src/artwork-sets.ts`, then run

```sh
pnpm --filter @dazbee/graphics artwork [folder]
```

It reads each repository's archive once, lists 3dicons from its repository's meta files and Kenney Smoke Particles from its repository's tree, and fetches each linked file 250 ms apart; a folder given keeps what links served and is read again on the next run. Then store the files once per environment, and again after the manifest changes:

```sh
pnpm --filter @dazbee/api artwork:upload
```

It uses the API's storage settings from the environment; in a deployed API container, run `node apps/api/src/scripts/upload-artwork.ts` from the image's root. It reads the files from their pinned sources, refuses one whose SHA-256 isn't the listed one, and stores only those storage doesn't hold yet; a run with nothing to store reads no source. Until it has run, placing an artwork graphic is refused with a sentence that says its file isn't stored yet.
