"""The picture's own pixels: each split piece at the picture's own size, with the picture's pixels wherever the
picture shows the piece.

The split model draws every layer at the working size, where small lettering doesn't hold: words printed on a
product come back misshapen, and every piece is a little soft once it is stretched to the picture's size. Where a
piece is solid and nothing is in front of it, the picture shows that piece and nothing else, so those pixels are
taken from the picture. The split model's pixels stay at the piece's soft edges, next to anything in front (letters
may sit a few pixels off in the picture), and wherever something in front hides the piece, which the model had to
make up. Those take the smooth colour difference to the picture measured around them, so the outline of a text
doesn't show once the text is moved.

Pieces only change colour: each keeps its alpha, stretched to the picture's size, and no piece is added or
dropped. A turned box is stretched the same way, its angle following the stretch when the working size has another
shape than the picture.

Each piece is worked on inside its own window, whose sides lie where the pixel grids of the working size and of the
picture meet, so a window stretched is that part of the whole layer stretched. What the layers in front cover is
built once per layer. The colour difference is worked out at a quarter of the size; it is smoother than that at
every reach it is measured over.
"""

import math
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from PIL import Image

# The piece's alpha from which a pixel is the piece's own colour in the picture.
SOLID = 0.98
# The alpha of everything in front up to which a pixel shows in the picture.
FREE = 0.02
# The split model's pixels are kept within this many pixels, at the picture's size, of the piece's own soft edge.
EDGE_PX = 1
# And within this many of a piece in front.
COVER_PX = 4
# From there the picture's pixels fade in over this many pixels.
BLEND_PX = 3
# The reaches, in pixels, the colour difference is measured over: it comes from the shortest one with enough of the
# picture around.
MATCH_REACHES = (6, 24, 96)
# Enough is this share of the reach's window showing the picture.
MATCH_ENOUGH = 0.15
# The colour difference is worked out at one in this many of the size.
MATCH_SCALE = 4
# The room around a window there, so the blurs fade out as they would on the whole picture.
MATCH_PAD = 3 * MATCH_REACHES[-1] // MATCH_SCALE
# The pixels around a piece that its weights can depend on.
WINDOW_PAD = COVER_PX + BLEND_PX + 2
WORKERS = 8


def keep_ad_pixels(picture: Image.Image, pieces: list[dict], working: tuple[int, int]) -> list[dict]:
    """The pieces at the picture's own size, in the same order.

    picture: the picture at its own size. pieces: front to back, each with "layer", "box": [x, y, width, height]
    at the working size, "turned": its turned box there or None, and "picture": the box's pixels as RGBA bytes.
    working: the working (width, height).

    Each piece comes back with its "box" and "turned" in the picture's pixels, its "picture" there, and "model":
    the split model's own pixels of the same box, stretched and nothing more.
    """
    width, height = picture.size
    target = np.asarray(picture.convert("RGB")).astype(np.float32) / 255
    windows = [_windows(piece["box"], working, picture.size) for piece in pieces]
    with ThreadPoolExecutor(WORKERS) as pool:
        stretched = list(pool.map(_stretch, pieces, windows))

    # How much of each pixel the layers in front let through.
    clear = np.ones((height, width), np.float32)
    results = [None] * len(pieces)
    kx, ky = width / working[0], height / working[1]
    for layer in sorted({piece["layer"] for piece in pieces}):
        here = [index for index, piece in enumerate(pieces) if piece["layer"] == layer]
        with ThreadPoolExecutor(WORKERS) as pool:
            done = pool.map(lambda index: _restore(stretched[index], windows[index][1], target, clear), here)
            for index, result in zip(here, done, strict=True):
                results[index] = result
        for index in here:
            x0, y0, x1, y1 = windows[index][1]
            clear[y0:y1, x0:x1] *= 1 - stretched[index][..., 3]
            results[index] = {
                **pieces[index],
                **results[index],
                "turned": _stretched_box(pieces[index]["turned"], kx, ky),
            }
    return results


def _windows(box: list[int], working: tuple[int, int], size: tuple[int, int]) -> tuple[tuple, tuple]:
    """A piece's window at the working size and the same window at the picture's size, each (left, top, right,
    bottom), with room around the piece for its weights. Their sides lie where the two pixel grids meet."""
    x, y, w, h = box
    sides = []
    for start, length, small, large in ((x, w, working[0], size[0]), (y, h, working[1], size[1])):
        # q pixels of the working size are p pixels of the picture, with nothing left over.
        q, p = small // math.gcd(small, large), large // math.gcd(small, large)
        pad = math.ceil(WINDOW_PAD * q / p) + 2
        first = max(0, (start - pad) // q * q)
        last = min(small, -(-(start + length + pad) // q) * q)
        sides.append((first, last, first * p // q, last * p // q))
    (x0, x1, px0, px1), (y0, y1, py0, py1) = sides
    return (x0, y0, x1, y1), (px0, py0, px1, py1)


def _stretch(piece: dict, windows: tuple[tuple, tuple]) -> np.ndarray:
    """A piece inside its window at the picture's size, as float RGBA. Its colours are stretched multiplied by its
    alpha, so the colours under clear pixels don't run into its edges."""
    (x0, y0, x1, y1), (px0, py0, px1, py1) = windows
    small = np.zeros((y1 - y0, x1 - x0, 4), np.float32)
    x, y, w, h = piece["box"]
    small[y - y0 : y - y0 + h, x - x0 : x - x0 + w] = piece["picture"].astype(np.float32) / 255
    size = (px1 - px0, py1 - py0)
    alpha = cv2.resize(small[..., 3], size, interpolation=cv2.INTER_LINEAR)
    multiplied = cv2.resize(small[..., :3] * small[..., 3:4], size, interpolation=cv2.INTER_LINEAR)
    rgb = np.where(alpha[..., None] > 1e-4, multiplied / np.maximum(alpha[..., None], 1e-4), 0)
    return np.concatenate([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)[..., None]], axis=2).astype(np.float32)


def _restore(stretched: np.ndarray, window: tuple, target: np.ndarray, clear: np.ndarray) -> dict:
    """One piece at the picture's size, as its "box", "picture" and "model": the picture's pixels where the
    picture shows the piece, the split model's, moved by the colour difference, elsewhere. The box is measured
    again, from the stretched alpha."""
    px0, py0, px1, py1 = window
    shows = target[py0:py1, px0:px1]
    alpha = stretched[..., 3]
    cover = 1 - clear[py0:py1, px0:px1]
    weight = _ramp(alpha >= SOLID, EDGE_PX) * _ramp(cover <= FREE, COVER_PX)
    shown = weight > 0.99
    rgb = stretched[..., :3]
    if shown.any():
        rgb = np.clip(rgb + _colour_difference(shows - rgb, shown), 0, 1)
    rgb = weight[..., None] * shows + (1 - weight[..., None]) * rgb

    ys, xs = np.nonzero(alpha > 0)
    x0, y0, x1, y1 = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else (0, 0, 1, 1)
    picture = np.concatenate([rgb, alpha[..., None]], axis=2)[y0:y1, x0:x1]
    return {
        "box": [px0 + x0, py0 + y0, x1 - x0, y1 - y0],
        "picture": (np.clip(picture, 0, 1) * 255 + 0.5).astype(np.uint8),
        "model": (np.clip(stretched[y0:y1, x0:x1], 0, 1) * 255 + 0.5).astype(np.uint8),
    }


def _stretched_box(turned: dict | None, kx: float, ky: float) -> dict | None:
    """A turned box of the working size in the picture's pixels: its centre stretched, each side by how much the
    stretch lengthens its direction, and its angle (clockwise, y down) turned as the stretch turns it."""
    if turned is None:
        return None
    turn = math.radians(turned["angle"])
    along = math.hypot(kx * math.cos(turn), ky * math.sin(turn))
    across = math.hypot(kx * math.sin(turn), ky * math.cos(turn))
    return {
        "cx": round(turned["cx"] * kx, 1),
        "cy": round(turned["cy"] * ky, 1),
        "width": round(turned["width"] * along, 1),
        "height": round(turned["height"] * across, 1),
        "angle": round(math.degrees(math.atan2(ky * math.sin(turn), kx * math.cos(turn))), 1),
    }


def _ramp(mask: np.ndarray, edge: int) -> np.ndarray:
    """0 outside the mask and within `edge` pixels of its outside, rising to 1 over BLEND_PX pixels further in."""
    distance = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    return np.clip((distance - edge) / BLEND_PX, 0, 1)


def _colour_difference(difference: np.ndarray, shown: np.ndarray) -> np.ndarray:
    """The picture minus the split model's pixels, measured where the piece shows the picture and carried into
    the rest of the window: a weighted blur at each of MATCH_REACHES, the shortest reach with enough of the picture
    around deciding, then smoothed once more."""
    height, width = shown.shape
    small = (max(1, round(width / MATCH_SCALE)), max(1, round(height / MATCH_SCALE)))
    known = _padded(cv2.resize(shown.astype(np.float32), small, interpolation=cv2.INTER_AREA))
    measured = _padded(cv2.resize(difference * shown[..., None], small, interpolation=cv2.INTER_AREA))
    carried = np.zeros_like(measured)
    filled = np.zeros(known.shape, bool)
    for reach in MATCH_REACHES:
        share = cv2.GaussianBlur(known, (0, 0), reach / MATCH_SCALE, borderType=cv2.BORDER_CONSTANT)
        total = cv2.GaussianBlur(measured, (0, 0), reach / MATCH_SCALE, borderType=cv2.BORDER_CONSTANT)
        fill = ~filled & (share > MATCH_ENOUGH)
        carried[fill] = total[fill] / share[fill][..., None]
        filled |= fill
    carried = cv2.GaussianBlur(carried, (0, 0), MATCH_REACHES[1] / MATCH_SCALE, borderType=cv2.BORDER_CONSTANT)
    return cv2.resize(
        carried[MATCH_PAD:-MATCH_PAD, MATCH_PAD:-MATCH_PAD], (width, height), interpolation=cv2.INTER_LINEAR
    )


def _padded(picture: np.ndarray) -> np.ndarray:
    """A picture with MATCH_PAD pixels of zeros around it."""
    pad = ((MATCH_PAD, MATCH_PAD), (MATCH_PAD, MATCH_PAD)) + (((0, 0),) if picture.ndim == 3 else ())
    return np.pad(picture, pad)
