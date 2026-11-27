"""Split pieces: a picture's split layers cut into one split piece per planned part.

The split model (Ming-Image Design-Layer on ComfyUI, run unguided unless a call asks for guidance) gives a few
layers at a working size of about 512 or 1024 px: all the text, all the shapes and logos, a cut-out or two, the
backdrop. A person wants each headline, button, logo and product as a layer of its own, looking as it does in the
picture. `make_pieces` gets there by the boxes Dazbee's layer plan gives its parts, in five steps, each a module
of its own, on pictures in memory and on the CPU:

1. cleanup: stray copies, copies of what is behind and wrong shadows leave the split layers;
2. cutout: each layer is cut into one piece per planned part, each with its turned box;
3. check: the cut-outs the split model left in the backdrop are found;
4. ad_pixels: each piece is drawn at the picture's own size, with the picture's pixels wherever it shows the piece;
5. edges: the edges of flat-coloured pieces are read from the picture itself.
"""

import base64
import io
import time

import numpy as np
from PIL import Image
from scipy import ndimage

from .ad_pixels import keep_ad_pixels
from .check import stuck_cutouts
from .cleanup import clean_layers
from .cutout import cut_layers
from .edges import read_edges

# Alpha of 255 from which a pixel is part of what a piece shows: a piece's box hugs these.
SEEN = 8
# A speck: a group of at most this many joined pixels, none above this alpha of 255. It is cleared, so one faint
# stray pixel doesn't stretch a piece's box.
SPECK_PIXELS = 4
SPECK_ALPHA = 64
# The difference of 255 above which a pixel of the stacked pieces is off from the picture.
OFF = 8
# The plan's grid: a box's corners are whole numbers from 0 to GRID - 1, laid over the whole picture.
GRID = 1000


def make_pieces(picture: Image.Image, parts: list[dict], layers: list[np.ndarray]) -> dict | None:
    """The split pieces of `picture`, as the contract's `pieces` holds them, or None when a part is planned in a
    layer the split didn't give.

    picture: the picture at its own size. parts: the planned parts, each {"id", "kind", "shadow", "layer" (1 is the
    top one), "box": {"left", "top", "right", "bottom"} on the plan's grid}. layers: the split layers, top first,
    as float RGBA arrays (0 to 1) at the working size.
    """
    if max(part["layer"] for part in parts) > len(layers):
        return None
    started = time.monotonic()
    width, height = picture.size
    working = (layers[0].shape[1], layers[0].shape[0])
    picture = picture.convert("RGB")
    target = np.asarray(picture).astype(np.float32) / 255
    planned = [_in_pixels(part, width, height) for part in parts]

    cleaned = clean_layers(picture, planned, [layer.copy() for layer in layers])
    # The cutout and the check read the layers as they would be saved: rounded to 8 bits.
    cleaned = [(np.clip(layer, 0, 1) * 255 + 0.5).astype(np.uint8).astype(np.float32) / 255 for layer in cleaned]
    cut = cut_layers(planned, cleaned, picture.size)
    stuck = stuck_cutouts(planned, cleaned, picture.size)
    sharp = keep_ad_pixels(picture, cut, working)
    edged = read_edges(target, sharp, max(width, height) / max(working))

    pieces = []
    for piece in edged:
        shown = _shown(piece["box"], piece["picture"])
        if shown is None:
            continue
        (x, y), rgba = shown
        pieces.append(
            {
                "png": rgba,
                "x": x,
                "y": y,
                "width": rgba.shape[1],
                "height": rgba.shape[0],
                "part": piece["part"],
                "kind": piece["kind"],
                "layer": piece["layer"],
                "turned": piece["turned"],
            }
        )
    if not pieces:
        return None
    closeness = _closeness(pieces, target)
    for piece in pieces:
        piece["png"] = _png(piece["png"])
    return {
        "width": width,
        "height": height,
        "items": pieces,
        "stuck": stuck,
        "closeness": closeness,
        "seconds": round(time.monotonic() - started, 3),
    }


def _in_pixels(part: dict, width: int, height: int) -> dict:
    """A planned part as the steps read it: its id, kind, shadow and layer, and its box as (left, top, right,
    bottom) in the picture's pixels, right and bottom just past it. A grid cell is 1/GRID of the picture each way."""
    box = part["box"]
    left, top = int(box["left"] * width / GRID), int(box["top"] * height / GRID)
    right = max(left + 1, int(np.ceil((box["right"] + 1) * width / GRID)))
    bottom = max(top + 1, int(np.ceil((box["bottom"] + 1) * height / GRID)))
    return {
        "id": part["id"],
        "kind": part["kind"],
        "shadow": part["shadow"],
        "layer": part["layer"],
        "box": (left, top, right, bottom),
    }


def _shown(box: list[int], rgba: np.ndarray) -> tuple[tuple[int, int], np.ndarray] | None:
    """A piece with its specks cleared, cropped to the box of the pixels it shows: its new top-left corner and its
    picture; None when it shows nothing."""
    seen = rgba[..., 3] >= SEEN
    groups, count = ndimage.label(seen, structure=np.ones((3, 3)))
    if count > 1:
        index = np.arange(1, count + 1)
        sizes = ndimage.sum(seen, groups, index)
        strongest = ndimage.maximum(rgba[..., 3], groups, index)
        specks = np.isin(groups, index[(sizes <= SPECK_PIXELS) & (strongest < SPECK_ALPHA)])
        if specks.any() and not specks[seen].all():
            rgba = rgba.copy()
            rgba[specks, 3] = 0
            seen &= ~specks
    rows, cols = np.nonzero(seen.any(axis=1))[0], np.nonzero(seen.any(axis=0))[0]
    if len(rows) == 0:
        return None
    return (box[0] + int(cols[0]), box[1] + int(rows[0])), rgba[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]


def _closeness(pieces: list[dict], target: np.ndarray) -> dict:
    """How far the pieces, drawn over each other back to front, are from the picture: the mean difference of 255,
    and the percent of pixels off by more than OFF."""
    stacked = np.zeros_like(target)
    for piece in reversed(pieces):
        x, y, w, h = piece["x"], piece["y"], piece["width"], piece["height"]
        rgba = piece["png"].astype(np.float32) / 255
        alpha = rgba[..., 3:4]
        stacked[y : y + h, x : x + w] = rgba[..., :3] * alpha + stacked[y : y + h, x : x + w] * (1 - alpha)
    off = np.abs(stacked - target).max(axis=2) * 255
    return {"mean": round(float(off.mean()), 3), "off": round(float((off > OFF).mean()) * 100, 2)}


def _png(rgba: np.ndarray) -> str:
    """An RGBA picture as a PNG, base64; packed lightly, as the time is billed and the bytes are stored again."""
    buffer = io.BytesIO()
    Image.fromarray(rgba).save(buffer, format="PNG", compress_level=1)
    return base64.b64encode(buffer.getvalue()).decode()
