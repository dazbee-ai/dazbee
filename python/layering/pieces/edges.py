"""Edges: the edges of flat-coloured split pieces are read from the picture, so the pieces drawn over each other
show the picture itself.

After the picture's own pixels are kept, a piece is the picture inside its solid pixels and the split model's
drawing along its edge, and the pieces behind it are the split model's drawing for a few pixels around it. The
split model draws at the working size: its edges are soft at the picture's size, and small lettering comes back
misshapen. This step works on those bands only, at the picture's size, and never where something in front hides
a piece.

1. A piece's edge. Around the edge of its solid pixels, the picture's pixel is read as a mix of the piece's own
   colour and what is behind it. Where the two colours differ enough and the picture's pixel lies on the line
   between them, the mix is the pixel's alpha and the pixel takes the piece's own colour.
   - The band reaches as far as the split model can be off: REACH pixels of the working size outside the solid
     pixels, and a rim inside them. Text is read twice as far out, and as deep in as out, with a letter counted
     from half alpha, so lettering with strokes thinner than that is read whole.
   - The piece's own colour: for text, the colour the nearest letter has in the picture, found from the colour the
     split model drew it in (`_ink_colours`); for other pieces, the colour of the nearest solid pixel a little
     inside the edge, and only where the split model drew the pixel in about that colour too, so a rim of another
     colour is left alone.
   - A piece reads only the pixels nearer to it than to any other piece of its split layer.
   Only text, shape, graphic and logo pieces are read. Cut-outs, pieces of no part and the backdrop are not.
   A shape, graphic or logo is read once more for its thin strokes: a line or small lettering the split model drew
   no thicker than twice REACH never comes back solid, so it is read as text is.
   A pixel read as a trace of the piece's colour, away from any stroke and looking like what is behind it, is
   cleared: it is the grain of what is behind, and would stretch the piece's place.
2. Behind an edge that was read this way, the pieces behind take the picture's own pixels up to MARGIN pixels
   from it.

A pixel changes only when the pieces drawn over each other come closer to the picture there, or to clear a trace.
What is still soft after this step is left to the soft pixels step.
"""

import cv2
import numpy as np
from scipy import ndimage

# Alpha from which a pixel is the piece's own colour.
SOLID = 0.98
# The alpha of everything in front up to which a pixel shows in the picture.
FREE = 0.02
# The pixels of the working size outside a piece's solid pixels that its edge is looked for in.
REACH = 3
# The pixels inside the solid pixels that still count as the edge.
RIM = 1.5
# The pixels inside the solid pixels from which a pixel's colour is the piece's own, clear of its edge.
CORE = 2.5
# The piece's colour and what is behind it differ enough to be told apart (the squared difference of RGB, 0 to 1).
CONTRAST = 0.02
# The picture's pixel lies this close to the line between the two colours (0 to 1, the largest channel).
FIT = 0.06
# The split model drew the pixel within this of the piece's own colour (0 to 1, the largest channel).
AGREE = 0.15
# The split model's alpha from which its colour for a pixel counts.
SOFT_MIN = 0.3
# The kinds drawn in flat colours, whose edges are read.
FLAT = ("text", "shape", "graphic", "logo")
# Alpha from which a pixel is part of a letter: thin strokes never come back fully solid.
LETTER = 0.5
# The pixels a piece behind keeps from an edge in front before it shows the picture there.
MARGIN = 2
# The share of a letter's pixels, the ones furthest along from what is behind, that its colour is taken from.
INKIEST = 0.25
# The fewest such pixels a letter's colour is taken from.
INK_PIXELS = 6
# Alpha read from the picture below which a pixel is a trace, kept beside a pixel of at least STROKE.
TRACE = 0.1
STROKE = 0.3
# How far the picture may be from what is behind for a trace to be grain (0 to 1, the largest channel).
GRAIN = 0.05
# The ways an edge is read: around solid pixels, around every letter, around thin strokes only.
EDGE, LETTERS, THIN = "edge", "letters", "thin"


def read_edges(target: np.ndarray, pieces: list[dict], scale: float = 1.0) -> list[dict]:
    """The pieces with their edges read from the picture, in the same order.

    target: the picture as float RGB (0 to 1) at its own size. pieces: front to back, the backdrop last, each with
    "kind", "layer", "place": [x, y, width, height] in the picture's pixels, "pixels": the place's pixels as RGBA
    bytes, and "model": the split model's own pixels of the same place. scale: the pixels of the picture to one of
    the working size.

    Each piece comes back with its new "place" and "pixels", and without "model".
    """
    height, width = target.shape[:2]
    reach = max(REACH, int(round(REACH * scale)))
    pad = 2 * reach + 2
    windows, drawn, models = [], [], []
    for piece in pieces:
        x, y, w, h = piece["place"]
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(width, x + w + pad), min(height, y + h + pad)
        inner = (slice(y - y0, y - y0 + h), slice(x - x0, x - x0 + w))
        pixels = np.zeros((y1 - y0, x1 - x0, 4), np.float32)
        pixels[inner] = piece["pixels"].astype(np.float32) / 255
        model = np.zeros_like(pixels)
        model[inner] = piece["model"].astype(np.float32) / 255
        windows.append((slice(y0, y1), slice(x0, x1)))
        drawn.append(pixels)
        models.append(model)

    count = len(drawn)
    nearest = _nearest(pieces, drawn, windows, height, width)
    covers = _covers(drawn, windows, height, width)
    read = np.zeros((height, width), bool)
    # The pieces behind the one at hand, drawn over each other.
    under = np.zeros((height, width, 3), np.float32)
    for index in range(count - 1, -1, -1):
        window, pixels = windows[index], drawn[index]
        behind = under[window]
        if index < count - 1 and pieces[index]["kind"] in FLAT:
            mine = nearest[pieces[index]["layer"]][window] == index
            for how in (LETTERS,) if pieces[index]["kind"] == "text" else (EDGE, THIN):
                read[window] |= _read_edge(
                    pixels, models[index], target[window], behind, covers[index], mine, how, reach
                )
        alpha = pixels[..., 3:4]
        under[window] = pixels[..., :3] * alpha + behind * (1 - alpha)
    covers = _covers(drawn, windows, height, width)
    for index in range(1, count):
        _show_picture(drawn[index], target[windows[index]], covers[index], read[windows[index]], reach)

    edged = []
    for piece, window, pixels in zip(pieces, windows, drawn, strict=True):
        ys, xs = np.nonzero(pixels[..., 3] > 0)
        y0, y1, x0, x1 = (
            (int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1) if len(xs) else (0, 1, 0, 1)
        )
        edged.append(
            {
                **{key: value for key, value in piece.items() if key != "model"},
                "place": [window[1].start + x0, window[0].start + y0, x1 - x0, y1 - y0],
                "pixels": (np.clip(pixels[y0:y1, x0:x1], 0, 1) * 255 + 0.5).astype(np.uint8),
            }
        )
    return edged


def _nearest(pieces: list[dict], drawn: list[np.ndarray], windows: list[tuple], height: int, width: int) -> dict:
    """For each split layer, the index of the piece of that layer nearest to each pixel of the picture."""
    nearest = {}
    for layer in {piece["layer"] for piece in pieces}:
        owner = np.full((height, width), -1, np.int32)
        for index, piece in enumerate(pieces):
            if piece["layer"] == layer:
                owner[windows[index]][drawn[index][..., 3] >= 0.5] = index
        if (owner >= 0).any():
            _, owner = _nearest_of(owner >= 0, owner)
        nearest[layer] = owner
    return nearest


def _covers(drawn: list[np.ndarray], windows: list[tuple], height: int, width: int) -> list[np.ndarray]:
    """For each piece, how much of each of its pixels the pieces in front hide."""
    clear = np.ones((height, width), np.float32)
    covers = []
    for window, pixels in zip(windows, drawn, strict=True):
        covers.append(1 - clear[window])
        clear[window] *= 1 - pixels[..., 3]
    return covers


def _read_edge(
    pixels: np.ndarray,
    model: np.ndarray,
    target: np.ndarray,
    behind: np.ndarray,
    cover: np.ndarray,
    mine: np.ndarray,
    how: str,
    reach: int,
) -> np.ndarray:
    """Reads one piece's edge from the picture, in place, and gives the pixels whose alpha the picture gave.

    pixels, model: the piece and the split model's own pixels of it, inside the piece's window. target, behind:
    the picture and the pieces behind drawn over each other, there. cover: how much the pieces in front hide. mine:
    the pixels nearer to this piece than to any other of its split layer. how: EDGE, LETTERS or THIN. reach: REACH
    in the picture's pixels.
    """
    alpha, rgb = pixels[..., 3], pixels[..., :3]
    text = how != EDGE
    solid = alpha >= (LETTER if text else SOLID)
    out, rim = (2 * reach, 2 * reach) if text else (reach, RIM)
    none = np.zeros(alpha.shape, bool)
    if solid.sum() < 20:
        return none
    outside = _distance_to(solid)
    inside = _distance_to(~solid)
    band = (((outside > 0) & (outside <= out)) | (solid & (inside <= rim))) & (cover < FREE) & mine
    if not band.any():
        return none

    if text:
        drawn = model[..., 3] >= LETTER
        if how == THIN:
            # What is left of the drawing once every part thicker than twice `reach` is taken away.
            size = 2 * reach + 1
            disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
            thick = cv2.morphologyEx(drawn.astype(np.uint8), cv2.MORPH_OPEN, disc) > 0
            thin = drawn & ~cv2.dilate(thick.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
            band &= _nearest_of(drawn, thin)[1]
            drawn = thin
        letters, count = ndimage.label(drawn)
        if count == 0 or not band.any():
            return none
        index = np.arange(1, count + 1)
        colours = np.stack([ndimage.median(model[..., channel], letters, index) for channel in range(3)], axis=1)
        _, letter = _nearest_of(letters > 0, letters)
        own = _ink_colours(colours.astype(np.float32), letter, target, behind, band)[letter - 1]
        agrees = np.ones(alpha.shape, bool)
    else:
        _, own = _nearest_of(solid, rgb)
        core = inside >= CORE
        if core.sum() >= 20:
            to_core, core_rgb = _nearest_of(core, rgb)
            own = np.where((to_core <= outside + CORE + 2)[..., None], core_rgb, own)
        agrees = (model[..., 3] < SOFT_MIN) | (np.abs(model[..., :3] - own).max(axis=2) <= AGREE)

    # The line from what is behind to the piece's own colour, and where on it the picture's pixel lies.
    line = own - behind
    contrast = (line**2).sum(axis=2)
    mix = np.clip(((target - behind) * line).sum(axis=2) / np.maximum(contrast, 1e-6), 0, 1)
    off_line = np.abs(target - (behind + mix[..., None] * line)).max(axis=2)
    read = band & agrees & (contrast > CONTRAST) & (off_line <= FIT)

    # A trace of the piece's colour away from any stroke, where the picture is within GRAIN of what is behind, is
    # the grain of what is behind, not the piece: the pixel is cleared, whatever the split model drew there.
    by_stroke = cv2.dilate((mix >= STROKE).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    trace = read & (mix < TRACE) & ~by_stroke & (np.abs(target - behind).max(axis=2) <= GRAIN)

    new_alpha = np.where(read, np.where(trace, 0, mix), alpha)
    new_rgb = np.where(read[..., None], own, rgb)

    before = np.abs(rgb * alpha[..., None] + behind * (1 - alpha[..., None]) - target).max(axis=2)
    after = np.abs(new_rgb * new_alpha[..., None] + behind * (1 - new_alpha[..., None]) - target).max(axis=2)
    better = band & ((after <= before) | trace)
    pixels[..., 3] = np.where(better, new_alpha, alpha)
    pixels[..., :3] = np.where(better[..., None], new_rgb, rgb)
    return better & read


def _distance_to(mask: np.ndarray) -> np.ndarray:
    """The distance, in pixels, from each pixel to the nearest pixel of `mask`: 0 inside it."""
    return cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)


def _nearest_of(mask: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """For each pixel, the distance to the nearest pixel of `mask` (to within a few percent) and the value
    `values` has there. `mask` holds at least one pixel."""
    distance, labels = cv2.distanceTransformWithLabels(
        (~mask).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_5, labelType=cv2.DIST_LABEL_PIXEL
    )
    at = np.zeros((int(labels.max()) + 1,) + values.shape[2:], values.dtype)
    at[labels[mask]] = values[mask]
    return distance, at[labels]


def _ink_colours(
    colours: np.ndarray, letter: np.ndarray, target: np.ndarray, behind: np.ndarray, band: np.ndarray
) -> np.ndarray:
    """The colour each letter has in the picture. The split model draws a thin stroke paler than it is, mixed with
    what is behind it, so the picture's pixel lies further along the line from what is behind than the drawn
    colour does. A letter's colour is the median of the picture's pixels furthest along that line; a letter with
    too few of them keeps the colour it was drawn in.

    colours: the colour the split model drew each letter in, one row a letter. letter: the number of the nearest
    letter at each pixel, from 1. target, behind: the picture and the pieces behind drawn over each other. band:
    the pixels the edge is read in.
    """
    line = colours[letter - 1] - behind
    contrast = (line**2).sum(axis=2)
    along = ((target - behind) * line).sum(axis=2) / np.maximum(contrast, 1e-6)
    off_line = np.abs(target - (behind + along[..., None] * line)).max(axis=2)
    ink = band & (contrast > CONTRAST) & (along >= LETTER) & (off_line <= FIT)
    if not ink.any():
        return colours
    index = np.arange(1, len(colours) + 1)
    top = ndimage.labeled_comprehension(
        along, np.where(ink, letter, 0), index, lambda values: np.quantile(values, 1 - INKIEST), np.float32, np.inf
    )
    inkiest = np.where(ink & (along >= top[letter - 1]), letter, 0)
    enough = ndimage.sum(inkiest > 0, inkiest, index) >= INK_PIXELS
    seen = colours.copy()
    for channel in range(3):
        seen[enough, channel] = ndimage.median(target[..., channel], inkiest, index[enough])
    return seen


def _show_picture(pixels: np.ndarray, target: np.ndarray, cover: np.ndarray, read: np.ndarray, reach: int) -> None:
    """Gives a piece the picture's pixels, in place, where it is solid, nothing in front hides it and an edge in
    front of it was read from the picture, fading in over 2 pixels from MARGIN pixels off what is in front and from
    1 pixel inside the piece's own edge.

    pixels: the piece inside its window. target: the picture there. cover: how much the pieces in front hide.
    read: the pixels whose alpha the picture gave. reach: how far from those pixels the piece is changed.
    """
    alpha = pixels[..., 3]
    size = 4 * reach + 5
    near = cv2.dilate(read.astype(np.uint8), np.ones((size, size), np.uint8)) > 0
    shown = (alpha >= SOLID) & (cover <= FREE) & near
    if not shown.any():
        return
    from_cover = cv2.distanceTransform((cover <= FREE).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    from_edge = cv2.distanceTransform((alpha >= SOLID).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    weight = np.clip((from_cover - MARGIN) / 2, 0, 1) * np.clip((from_edge - 1) / 2, 0, 1) * shown
    pixels[..., :3] = weight[..., None] * target + (1 - weight[..., None]) * pixels[..., :3]
