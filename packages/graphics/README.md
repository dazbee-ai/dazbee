# @dazbee/graphics

The icon sets agents place in designs (`search_graphics` and `place_graphic` in the MCP server), with their licences. Both are MIT: an ad that shows an icon owes no credit, and the app lists each licence on its third-party notices page (`/notices`).

| Set            | Styles                                       | npm package (pinned)         |
| -------------- | -------------------------------------------- | ---------------------------- |
| Tabler Icons   | outline, filled                              | `@tabler/icons` 3.52.0       |
| Phosphor Icons | regular, thin, light, bold, fill and duotone | `@phosphor-icons/core` 2.1.1 |

`sets/<set>/` holds each set's LICENSE as its package ships it and one JSON file of path data per style; `sets/index.json` holds each icon's name, styles and tags for search; `src/notices.json` holds what the notices page lists. Never edit them by hand: change a pin in `package.json`, install, and run `pnpm --filter @dazbee/graphics icons`, which writes them all from the installed packages. `notices.test.ts` fails while they are from another version than the pin.

An icon is placed as an SVG file every shape of which is filled with one colour (`iconSvg`), so each layer the SVG reader makes of it has a fill a brand colour binds. Tabler's outline style is drawn with lines, which are outlined when placed, 2 of 24 wide with round ends and corners, finely enough for the size it is placed at.
