# @dazbee/fonts

The font files Dazbee renders with. They are loaded from these bytes, never from the system or the browser, so Node and browser exports draw the same glyphs.

| Family               | Weights       | Version | Source                         |
| -------------------- | ------------- | ------- | ------------------------------ |
| Noto Sans            | 400, 700, 800 | 2.015   | notofonts/latin-greek-cyrillic |
| Noto Sans Devanagari | 400, 700      | 2.007   | notofonts/devanagari           |
| Noto Naskh Arabic    | 400, 700      | 2.021   | notofonts/arabic               |

The unhinted static TTFs were taken from `notofonts/notofonts.github.io` (`fonts/<Family>/unhinted/ttf/`) on 2026-10-30. They are under the SIL Open Font License 1.1, in `files/OFL.txt`.

To add a face, put its file in `files/` and add a row to `FONT_FACES` in `src/index.ts`.

## Google Fonts

`src/google-fonts.json` lists every Google Fonts family Dazbee offers, about 1,950: each family Google Fonts serves under the OFL, Apache 2.0 or UFL, but the three we ship, in Google Fonts' popularity order, each with its category, scripts (ISO 15924 codes), variable axes and files. `src/google.ts` reads it. Never edit the JSON by hand: `pnpm --filter @dazbee/fonts google-fonts` writes it from google/fonts at its latest commit (or the commit given) and Google Fonts' public listing, and prints each family it leaves out and why. A family is left out when Google Fonts doesn't serve it, google/fonts has no METADATA.pb for it, its licence is another, or a file it names is missing.

The files are not in this package: `pnpm --filter @dazbee/api fonts:google` copies them from google/fonts, at the commit the JSON names, into our storage, with the API's settings, and from then on they load from there like a brand's uploads. It takes about 2.3 GB and is safe to stop and run again: it notes each file it copied in storage and skips those whose face is still recorded, and deletes the files a new copy takes the place of. Run it once per environment, and again after writing the JSON anew. Name families to copy only those, as in `pnpm --filter @dazbee/api fonts:google Inter "Bebas Neue"`.

## Which faces load

Every place that draws a design (the editor, exports, the API's pictures and the MCP server's renders) loads only the faces its texts are drawn in, never a family whole: a CJK family's files run to 100 MB. `fontUses` in `@dazbee/schema` lists each family in each weight and style the texts and their runs set, with the script fonts their characters need. `facesToLoad` (`src/face-match.ts`) gives the faces of a family that CanvasKit could pick for those, scoring each face as Skia's `matchStyleCSS3` does, at each weight its file may say, so the drawing is the one every face would give. The fonts we ship always load whole.

CanvasKit reads a face's weight, width and slant from its file (`src/file-style.ts`), and Google records some files otherwise. `src/whole-families.json` lists the Google families where that would load the wrong face, such as one whose faces have two widths; every face of those loads. Never edit it by hand: run `pnpm --filter @dazbee/fonts whole-families` after `google-fonts` writes a new list. It reads the style tables of every file at the list's commit, a few bytes each, and checks each family at every weight from 100 to 900, upright and italic.

## Script fonts

`src/scripts.ts` lists the script fonts: Noto families text falls back to for characters its own font lacks, of a script we don't ship or colour emoji (Noto Color Emoji). They are Google Fonts families in the list too, copied by the same `fonts:google`, stored without the SVG glyphs CanvasKit never draws (as every Google file is), offered in the chooser like the others, and loaded for a text not set in them only once it has their characters. `FALLBACK_FAMILIES` stays the shipped three; each text tries them, then the script fonts its own characters need (`scriptFamilies`), emoji last.

`test-files/` holds a few glyphs of Noto Color Emoji (OFL, `test-files/OFL.txt`) for tests, read with `@dazbee/fonts/test-fonts`; nothing ships it.
