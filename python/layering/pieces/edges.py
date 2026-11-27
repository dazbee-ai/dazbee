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
   - The piece's own colour: for text, the colour the split model drew the nearest letter in; for other pieces,
     the colour of the nearest solid pixel a little inside the edge, and only where the split model drew the
     pixel in about that colour too, so a rim of another colour is left alone.
   - A piece reads only the pixels nearer to it than to any other piece of its split layer.
   Only text, shape, graphic and logo pieces are read. Cut-outs, pieces of no part and the backdrop are not.
2. Behind an edge that was read this way, the pieces behind take the picture's own pixels up to MARGIN pixels
   from it.

Both run twice, since each reads what the other made. A pixel changes only when the pieces drawn over each other
come closer to the picture there.
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
PASSES = 2


def read_edges(target: np.ndarray, pieces: list[dict], scale: float = 1.0) -> list[dict]:
    """The pieces with their edges read from the picture, in the same order.

    target: the picture as float RGB (0 to 1) at its own size. pieces: front to back, the backdrop last, each with
    "kind", "layer", "box": [x, y, width, height] in the picture's pixels, "picture": the box's pixels as RGBA
    bytes, and "model": the split model's own pixels of the same box. scale: the pixels of the picture to one of
    the working size.

    Each piece comes back with its new "box" and "picture", and without "model".
    """
    height, width = target.shape[:2]
    reach = max(REACH, int(round(REACH * scale)))
    pad = 2 * reach + 2
    windows, pictures, models = [], [], []
    for piece in pieces:
        x, y, w, h = piece["box"]
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(width, x + w + pad), min(height, y + h + pad)
        inner = (slice(y - y0, y - y0 + h), slice(x - x0, x - x0 + w))
        picture = np.zeros((y1 - y0, x1 - x0, 4), np.float32)
        picture[inner] = piece["picture"].astype(np.float32) / 255
        model = np.zeros_like(picture)
        model[inner] = piece["model"].astype(np.float32) / 255
        windows.append((slice(y0, y1), slice(x0, x1)))
        pictures.append(picture)
        models.append(model)

    count = len(pictures)
    nearest = _nearest(pieces, pictures, windows, height, width)
    for _ in range(PASSES):
        covers = _covers(pictures, windows, height, width)
        read = np.zeros((height, width), bool)
        # The pieces behind the one at hand, drawn over each other.
        under = np.zeros((height, width, 3), np.float32)
        for index in range(count - 1, -1, -1):
            window, picture = windows[index], pictures[index]
            behind = under[window]
            if index < count - 1 and pieces[index]["kind"] in FLAT:
                text = pieces[index]["kind"] == "text"
                mine = nearest[pieces[index]["layer"]][window] == index
                read[window] |= _read_edge(
                    picture,
                    models[index],
                    target[window],
                    behind,
                    covers[index],
                    mine,
                    text,
                    2 * reach if text else reach,
                    2 * reach if text else RIM,
                )
            alpha = picture[..., 3:4]
            under[window] = picture[..., :3] * alpha + behind * (1 - alpha)
        covers = _covers(pictures, windows, height, width)
        for index in range(1, count):
            _show_picture(pictures[index], target[windows[index]], covers[index], read[windows[index]], reach)

    edged = []
    for piece, window, picture in zip(pieces, windows, pictures, strict=True):
        ys, xs = np.nonzero(picture[..., 3] > 0)
        y0, y1, x0, x1 = (
            (int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1) if len(xs) else (0, 1, 0, 1)
        )
        edged.append(
            {
                **{key: value for key, value in piece.items() if key != "model"},
                "box": [window[1].start + x0, window[0].start + y0, x1 - x0, y1 - y0],
                "picture": (np.clip(picture[y0:y1, x0:x1], 0, 1) * 255 + 0.5).astype(np.uint8),
            }
        )
    return edged


def _nearest(pieces: list[dict], pictures: list[np.ndarray], windows: list[tuple], height: int, width: int) -> dict:
    """For each split layer, the index of the piece of that layer nearest to each pixel of the picture."""
    nearest = {}
    for layer in {piece["layer"] for piece in pieces}:
        owner = np.full((height, width), -1, np.int32)
        for index, piece in enumerate(pieces):
            if piece["layer"] == layer:
                owner[windows[index]][pictures[index][..., 3] >= 0.5] = index
        if (owner >= 0).any():
            _, (near_y, near_x) = ndimage.distance_transform_edt(owner < 0, return_indices=True)
            owner = owner[near_y, near_x]
        nearest[layer] = owner
    return nearest


def _covers(pictures: list[np.ndarray], windows: list[tuple], height: int, width: int) -> list[np.ndarray]:
    """For each piece, how much of each of its pixels the pieces in front hide."""
    clear = np.ones((height, width), np.float32)
    covers = []
    for window, picture in zip(windows, pictures, strict=True):
        covers.append(1 - clear[window])
        clear[window] *= 1 - picture[..., 3]
    return covers


def _read_edge(
    picture: np.ndarray,
    model: np.ndarray,
    target: np.ndarray,
    behind: np.ndarray,
    cover: np.ndarray,
    mine: np.ndarray,
    text: bool,
    reach: float,
    rim: float,
) -> np.ndarray:
    """Reads one piece's edge from the picture, in place, and gives the pixels whose alpha the picture gave.

    picture, model: the piece and the split model's own pixels of it, inside the piece's window. target, behind:
    the picture and the pieces behind drawn over each other, there. cover: how much the pieces in front hide. mine:
    the pixels nearer to this piece than to any other of its split layer. reach, rim: how far outside and inside
    the solid pixels the edge is read.
    """
    alpha, rgb = picture[..., 3], picture[..., :3]
    solid = alpha >= (LETTER if text else SOLID)
    none = np.zeros(alpha.shape, bool)
    if solid.sum() < 20:
        return none
    outside, (solid_y, solid_x) = ndimage.distance_transform_edt(~solid, return_indices=True)
    inside = ndimage.distance_transform_edt(solid)
    band = (((outside > 0) & (outside <= reach)) | (solid & (inside <= rim))) & (cover < FREE) & mine
    if not band.any():
        return none

    if text:
        letters, count = ndimage.label(model[..., 3] >= LETTER)
        if count == 0:
            return none
        index = np.arange(1, count + 1)
        colours = np.stack([ndimage.median(model[..., channel], letters, index) for channel in range(3)], axis=1)
        _, (letter_y, letter_x) = ndimage.distance_transform_edt(letters == 0, return_indices=True)
        own = colours[letters[letter_y, letter_x] - 1].astype(np.float32)
        agrees = np.ones(alpha.shape, bool)
    else:
        own = rgb[solid_y, solid_x]
        core = inside >= CORE
        if core.sum() >= 20:
            to_core, (core_y, core_x) = ndimage.distance_transform_edt(~core, return_indices=True)
            own = np.where((to_core <= outside + CORE + 2)[..., None], rgb[core_y, core_x], own)
        agrees = (model[..., 3] < SOFT_MIN) | (np.abs(model[..., :3] - own).max(axis=2) <= AGREE)

    # The line from what is behind to the piece's own colour, and where on it the picture's pixel lies.
    line = own - behind
    contrast = (line**2).sum(axis=2)
    mix = np.clip(((target - behind) * line).sum(axis=2) / np.maximum(contrast, 1e-6), 0, 1)
    off_line = np.abs(target - (behind + mix[..., None] * line)).max(axis=2)
    read = band & agrees & (contrast > CONTRAST) & (off_line <= FIT)

    new_alpha = np.where(read, mix, alpha)
    new_rgb = np.where(read[..., None], own, rgb)

    before = np.abs(rgb * alpha[..., None] + behind * (1 - alpha[..., None]) - target).max(axis=2)
    after = np.abs(new_rgb * new_alpha[..., None] + behind * (1 - new_alpha[..., None]) - target).max(axis=2)
    better = band & (after <= before)
    picture[..., 3] = np.where(better, new_alpha, alpha)
    picture[..., :3] = np.where(better[..., None], new_rgb, rgb)
    return better & read


def _show_picture(picture: np.ndarray, target: np.ndarray, cover: np.ndarray, read: np.ndarray, reach: int) -> None:
    """Gives a piece the picture's pixels, in place, where it is solid, nothing in front hides it and an edge in
    front of it was read from the picture, fading in over 2 pixels from MARGIN pixels off what is in front and from
    1 pixel inside the piece's own edge.

    picture: the piece inside its window. target: the picture there. cover: how much the pieces in front hide.
    read: the pixels whose alpha the picture gave. reach: how far from those pixels the piece is changed.
    """
    alpha = picture[..., 3]
    size = 4 * reach + 5
    near = cv2.dilate(read.astype(np.uint8), np.ones((size, size), np.uint8)) > 0
    shown = (alpha >= SOLID) & (cover <= FREE) & near
    if not shown.any():
        return
    from_cover = cv2.distanceTransform((cover <= FREE).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    from_edge = cv2.distanceTransform((alpha >= SOLID).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    weight = np.clip((from_cover - MARGIN) / 2, 0, 1) * np.clip((from_edge - 1) / 2, 0, 1) * shown
    picture[..., :3] = weight[..., None] * target + (1 - weight[..., None]) * picture[..., :3]
