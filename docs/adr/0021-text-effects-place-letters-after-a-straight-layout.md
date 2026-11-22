# Text effects place each letter after a straight layout

A text with a curve, a bounce or a letter turn is still laid out straight by SkParagraph, as every text is, and then placed letter by letter: each glyph keeps its shape and is moved and turned onto its line's curve, with its bounce, raise and turn, and drawn from text blobs that carry a move and a turn for each glyph (RSXform). Drawing, the layer's bounds and box, the caret, the selection and hit tests all read that one placement, so what is clicked and typed is what is drawn. A text with no such effect keeps drawing its paragraphs as before and pays nothing for the placement.

We chose this because it keeps SkParagraph's shaping (kerning, Arabic joining, Devanagari conjuncts, fallback fonts, features, made-up small caps and superscripts) and keeps every export drawn by the same code on the CPU surface (ADR-0005), so curved and bounced text gives 0 differing pixels between the browser and Node.

## Considered options

- **Bending the glyphs' outlines along the curve** (an envelope warp). Letters change shape, so they are no longer the font's; every glyph becomes a path on every surface, which costs time on the screen; and the text matcher would have to fit a warp. Rejected.
- **Laying out each letter as its own paragraph.** Loses shaping across letters (kerning, joining, conjuncts) and lays out one paragraph per letter. Rejected.
- **A browser's or SVG's text on a path.** Not drawn by CanvasKit, so not identical between the browser and Node, and not drawn in Node at all. Rejected.

## Consequences

- PDF and SVG exports draw placed letters as shapes, not as text, so the PDF's curved words can't be selected or searched. Our build's `TextAsPathsCanvas` draws turned glyphs as shapes for this.
- On a tight curve, letters of a joining script are placed one glyph at a time, so a join can open or overlap a little.
- An effect that adds to the placement (a new curve shape, a per-letter value) is added to the one placement, never as another way of drawing text.
