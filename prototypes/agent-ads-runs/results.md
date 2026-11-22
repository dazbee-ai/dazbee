# Agents' ads: the before and after runs

The measurements of spec #123's goals: the 10 briefs of `briefs.md`, run word for word by headless Claude Code (`claude-opus-5-5`, the settings in `run.py`) through the live MCP server in the brand named Ikea, before the spec's tickets (#125, 2026-11-21) and after them (#139, 2026-11-22). Each run's stream, pictures and counts are in `out/` (git-ignored); `python -I run.py goals` and `table` print these tables again from them.

The after runs: 21:51 to 22:21 UTC on 2026-11-22, one at a time, on production running `9a3520a` (Deploy run 45074230373), which holds every ticket of the spec, the artwork graphics (#214) with their files stored, and the design check's image fix (#249).

## Goals

| Goal                                                                                                                                                                 | Target                  | Before            | After                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------- | --------------------------------------------------------------------- |
| Agent-made ads look professional: the owner, shown each pair blind, prefers the after design                                                                         | 8 of 10                 |                   | the owner's picks, on the comparison page                             |
| Agents bring real pictures (photo, icon or sticker besides the logo)                                                                                                 | 8 of 10                 | 4 of 10           | 7 of 10                                                               |
| Type with character (a family other than Noto Sans)                                                                                                                  | 8 of 10                 | 3 of 10           | 6 of 10                                                               |
| Runs told a catalog font has no file                                                                                                                                 | 0                       | 0                 | 0                                                                     |
| No defects (`check_frame` clean on every frame)                                                                                                                      | 9 of 10                 | 8 of 10           | 10 of 10                                                              |
| Agent ads don't all look alike: runs changing the pattern's draft                                                                                                    | 8 of the runs using one | no patterns       | 0 of 0                                                                |
| Agent ads don't all look alike: briefs ending with the same pattern and style unchanged                                                                              | none                    | no patterns       | none                                                                  |
| Refused calls (all runs)                                                                                                                                             |                         | 5                 | 27                                                                    |
| Minutes (all runs)                                                                                                                                                   |                         | 20.8              | 23.6                                                                  |
| Every pattern works at every size: `tests/pixels` draws 18 patterns in 4 styles at the 12 Meta, TikTok, YouTube and Google Display sizes, design check clean on each | every frame             | no patterns       | 864 of 864 frames clean (240 sweep tests pass)                        |
| Bigger sizes stay readable: Add size unit tests over every channel size                                                                                              | all pass                | text at 4 to 6 px | 50 of 50 pass (`frame-add-size.test.ts`, `add-size-readable.test.ts`) |
| No cost per ad: no paid API call by any tool                                                                                                                         | none                    | none              | none: stock from Pixabay's free API, no image generation tool exists  |

Type, counted strictly: outside the whole Noto family (Noto Sans Display counted as Noto), 2 of 10 before (5 and 8, Inter) and 2 of 10 after (4 and 5, DM Serif Display with DM Sans).

## Before

| #   | Brief          | Frames | Fonts used                                                 | Pictures placed (from)                                                                                            | `check_frame` warnings left | Refused calls | Minutes |
| --- | -------------- | ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------- | ------- |
| 1   | Sale           | 1      | Noto Sans 500, Noto Sans 700, Noto Sans 800, Noto Sans 900 | 2: airbnb-villa-pool (brand's asset library), logo (brand's asset library)                                        | 0                           | 0             | 1.8     |
| 2   | Product launch | 1      | Noto Sans 400, Noto Sans 600, Noto Sans 700, Noto Sans 800 | 1: logo (brand's asset library)                                                                                   | 5                           | 1             | 2.6     |
| 3   | Single product | 1      | Noto Sans 400, Noto Sans 700, Noto Sans 800                | 1: logo (brand's asset library)                                                                                   | 0                           | 0             | 1.3     |
| 4   | Lifestyle      | 1      | Noto Sans 500, Noto Sans 600, Noto Serif 400               | 2: airbnb-ocean-bedroom (brand's asset library), logo (brand's asset library)                                     | 0                           | 0             | 1.7     |
| 5   | Testimonial    | 1      | Inter 400, Inter 600, Inter 700, Inter 800                 | 1: logo (brand's asset library)                                                                                   | 0                           | 0             | 1.4     |
| 6   | Event          | 1      | Noto Sans 400, Noto Sans 700, Noto Sans 800                | 2: kivik-3-seat-sofa-with-chaise-longue-tresund-light-beige (brand's asset library), logo (brand's asset library) | 6                           | 0             | 1.6     |
| 7   | App download   | 1      | Noto Sans 400, Noto Sans 500, Noto Sans 700, Noto Sans 800 | 2: kivik-3-seat-sofa-with-chaise-longue-tresund-light-beige (brand's asset library), logo (brand's asset library) | 0                           | 2             | 1.9     |
| 8   | Big number     | 1      | Inter 700, Inter 800, Inter 900                            | 1: logo (brand's asset library)                                                                                   | 0                           | 0             | 1.1     |
| 9   | Words only     | 1      | Noto Sans 500, Noto Sans 800                               | 1: logo (brand's asset library)                                                                                   | 0                           | 0             | 1.1     |
| 10  | A set of sizes | 4      | Noto Sans 400, Noto Sans 700, Noto Sans 800                | 4: logo (brand's asset library)                                                                                   | 0                           | 2             | 6.3     |

## After

| #   | Brief          | Frames | Fonts used                                                                                 | Pictures placed (from)                                                                                                                                                                                                                                      | `check_frame` warnings left | Refused calls | Minutes |
| --- | -------------- | ------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------- | ------- |
| 1   | Sale           | 1      | Noto Sans 500, Noto Sans 800, Noto Sans 900                                                | 2: White, outdoor, patio, furniture, table, two (stock), logo (brand's asset library)                                                                                                                                                                       | 0                           | 5             | 2.4     |
| 2   | Product launch | 1      | Noto Sans Display 400, Noto Sans Display 700, Noto Sans Display 800, Noto Sans Display 900 | 2: Lamp, lighting, light games, contrasts, oval (stock), logo (brand's asset library)                                                                                                                                                                       | 0                           | 6             | 2.1     |
| 3   | Single product | 1      | Noto Sans 400, Noto Sans 600, Noto Sans 700, Noto Sans 800                                 | 2: Chair, wood, furniture, to sit (stock), logo (brand's asset library)                                                                                                                                                                                     | 0                           | 1             | 1.6     |
| 4   | Lifestyle      | 1      | DM Sans 500, DM Serif Display 400                                                          | 2: airbnb-ocean-bedroom (brand's asset library), logo (brand's asset library)                                                                                                                                                                               | 0                           | 6             | 1.9     |
| 5   | Testimonial    | 1      | DM Sans 400, DM Sans 700, DM Serif Display 400                                             | 2: Shelf, white, living world, bookshelf, books (stock), logo (brand's asset library)                                                                                                                                                                       | 0                           | 2             | 1.6     |
| 6   | Event          | 1      | Noto Sans 500, Noto Sans 700, Noto Sans 800                                                | 2: Interior, room, couch, window, living room (stock), logo (brand's asset library)                                                                                                                                                                         | 0                           | 1             | 1.6     |
| 7   | App download   | 1      | Noto Sans Display 400, Noto Sans Display 600, Noto Sans Display 700, Noto Sans Display 800 | 7: Interior, room, couch, window, living room (stock), logo (brand's asset library), phosphor/armchair (bundled icon), phosphor/check (bundled icon), phosphor/cube (bundled icon), phosphor/cube-focus (bundled icon), phosphor/list-checks (bundled icon) | 0                           | 1             | 2.8     |
| 8   | Big number     | 1      | Noto Sans 700, Noto Sans Display 800, Noto Sans Display 900                                | 1: logo (brand's asset library)                                                                                                                                                                                                                             | 0                           | 3             | 2.1     |
| 9   | Words only     | 1      | Noto Sans Display 500, Noto Sans Display 700, Noto Sans Display 900                        | 1: logo (brand's asset library)                                                                                                                                                                                                                             | 0                           | 0             | 1.3     |
| 10  | A set of sizes | 4      | Noto Sans 400, Noto Sans 700, Noto Sans 800                                                | 4: logo (brand's asset library)                                                                                                                                                                                                                             | 0                           | 2             | 6.2     |

Pictures: 7 of 10 place a photo or icon besides the logo: 6 a stock photo (3, 5 and 6 saved theirs in the run; 1 and 2 reused the photo their own first try had saved, see below; 7 reused 6's), 4 a photo from the library, and 7 five Phosphor icons. 8 (big number), 9 (words only, no photos asked) and 10 (four sizes) place only the logo.

Fonts: no run was told a catalog font has no file. Seven runs call `list_fonts`. Runs 4 and 5 use DM Serif Display with DM Sans; 2, 7, 8 and 9 Noto Sans Display; 1, 3, 6 and 10 Noto Sans alone.

Defects: every run ends with `check_frame` clean on every frame. The check found and the runs fixed a missing arrow glyph (1), an overflowing price (2) and a low-contrast button text (10).

## Variety

| #   | Brief          | Pattern (style)             | Sizes built | Layers built | Changed after it |
| --- | -------------- | --------------------------- | ----------- | ------------ | ---------------- |
| 1   | Sale           | none: designed from scratch |             |              |                  |
| 2   | Product launch | none: designed from scratch |             |              |                  |
| 3   | Single product | none: designed from scratch |             |              |                  |
| 4   | Lifestyle      | none: designed from scratch |             |              |                  |
| 5   | Testimonial    | none: designed from scratch |             |              |                  |
| 6   | Event          | none: designed from scratch |             |              |                  |
| 7   | App download   | none: designed from scratch |             |              |                  |
| 8   | Big number     | none: designed from scratch |             |              |                  |
| 9   | Words only     | none: designed from scratch |             |              |                  |
| 10  | A set of sizes | none: designed from scratch |             |              |                  |

No after run used a pattern: none called `list_patterns` or `apply_pattern`, so the variety goal has nothing to measure (0 of 0 changed after applying one; no two briefs share a pattern and style). Sameness by eye: the comparison page shows the 10 after designs side by side.

## Refused calls

27 in the after runs, 5 before:

- 14 `add_stock`: "Dazbee couldn’t download Pixabay’s photo …; try again in a moment, or pick another photo." Of 17 `add_stock` calls in the after runs, 3 saved a photo.
- 7 `node.update` or `text.replace` given `{ id, props }` or `{ id, text }` instead of `{ ids, patch }` / `{ ids, find, replace }`.
- 3 batch steps that used an earlier step's result (a string id) as `{ "$ref": …, "field": "id" }`.
- 1 `node.bind` on a text's fill ("a text has no fill to bind"), 1 `describe_command` of `frame.create`, which doesn't exist.
- 1 `Bash` (10), which the runner doesn't allow.

## First tries

The first after runs of briefs 1 and 2 (21:12 to 21:20 UTC, production `4ce0f37`) found the design check failing on every frame that draws an image: `check_frame` answered "check_frame failed on Dazbee’s side" and every batch `warningsError: no image for asset "…"` (the logo, or a stock photo). The runs were stopped, the fix (#249) was deployed at 21:50, and all 10 briefs ran again. The first tries' designs stay in the brand under the same names, with ids `aw9r5in0qkat` and `43rezji7l15q`; the stock photos they saved stayed in the brand's library, where the second tries of 1 and 2 found them.

Also in the brand: the design "MCP after – artwork check", made at 20:49 and 21:11 UTC to see the artwork files were stored before the runs, with a Fluent Emoji gift sticker and a Streamline Plump gift in the library.
