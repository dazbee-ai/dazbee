# @dazbee/graphics

The icons and stickers agents place in designs (`search_graphics` and `place_graphic` in the MCP server), with their licences. Every set is MIT or CC0: an ad that shows an icon or a sticker owes no credit, and the app lists each licence on its third-party notices page (`/notices`).

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
