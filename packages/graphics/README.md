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

A picture sticker joins the brand's asset library through the upload path, once for the same bytes, and is placed as an image; a drawing sticker is placed as the layers the SVG reader makes of it, in its own colours.

`sets/fluent-emoji/` holds each emoji's 3D picture as `3d/<name>.png` and its flat drawings in `flat.json`; `sets/<set>/drawing.json` holds a CC0 set's SVG files by name; each set's LICENSE sits beside them, a CC0 set's being its makers' words above the CC0 1.0 legal code. `sets/stickers.json` is the stickers' search index and `src/sticker-notices.json` what the notices page lists. Never edit them by hand: change Fluent Emoji's commit in `src/sets.ts`, or a file's link and SHA-256 in `src/sticker-sources.json`, and run `pnpm --filter @dazbee/graphics stickers`, which downloads every source, refuses a file whose SHA-256 differs from its pin, and writes them all.
