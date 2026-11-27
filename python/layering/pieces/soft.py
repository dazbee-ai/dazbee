"""Soft pixels: where a piece is soft and nothing is in front of it, it takes the alpha and the colour with which
the pieces drawn over each other show the picture.

After the picture's own pixels and the edges, a piece still holds the split model's drawing wherever it is not
solid: the soft edge of a cut-out, a wheel the backdrop shows through, a shadow, a letter the edge step could not
read. The split model draws those at the working size, so drawn over what is behind they are a blurred copy of the
picture. The picture's pixel there is the piece's colour over what is behind it, mixed by the piece's alpha, and
what is behind is known: the pieces behind, drawn over each other. So one of the two is solved for.

- First the alpha, where the piece is below EDGE: its colour is kept and its alpha moves along the line from what
  is behind to that colour, to where the picture's pixel lies nearest. A shadow gets the picture's own strength, a
  spoke comes out solid and the gap beside it clear.
- Then the colour, for what is left: the alpha is kept and the colour is solved for. Below FAINT a colour worked
  out this way is mostly noise, so it is moved only as far as a pixel of alpha FAINT would be.

What is behind a piece the split model had to make up, and it may be off in colour: behind a wheel it painted
the field greener than the picture has it. The picture shows what is really there through the piece's gaps, where
its alpha comes out near nothing. So before a piece is solved, the colour difference seen through its gaps is
smoothed and given to the pieces behind wherever they don't already hold the picture's own pixels. It is a smooth
difference, so it leaves no outline. A pixel that then looks like what is behind it is cleared, whatever alpha
it was drawn with: the holes of a brake disc.

Pieces are worked back to front, each over the pieces behind it as they come out. Nothing changes under a piece
in front or within COVER_PX pixels of one, where the picture's pixel may hold some of that piece: a pixel taken
from the picture there would leave the outline of the piece in front once that piece is moved. Nor where a piece
is clear.
"""

import cv2
import numpy as np

# The alpha of everything in front up to which a pixel shows in the picture.
FREE = 0.02
# A piece's pixels are left alone within this many pixels of a piece in front.
COVER_PX = 4
# From there the change fades in over this many pixels.
BLEND_PX = 3
# The alpha below which a pixel's colour is moved no further than a pixel of this alpha would be.
FAINT = 0.2
# The alpha below which a pixel's alpha is moved: above it the pixel is inside the piece.
EDGE = 0.75
# Alpha from which a pixel is the piece and nothing else.
SOLID = 0.98
# The alpha a gap was drawn below: a pixel drawn at least half there is the piece, whatever its alpha moves to.
HALF = 0.5
# The alpha, once moved, below which a pixel is a gap the picture shows what is behind through.
GAP = 0.05
# How far a gap may be from what the gaps around it show and still count (0 to 1, the largest channel).
ODD = 0.1
# The fewest gap pixels a piece's gaps are read from.
GAP_PIXELS = 64
# The pixels over which what is seen through the gaps is smoothed and carried.
GAP_REACH = 12
# The smoothing is worked out at one in this many of the size.
GAP_SCALE = 4
# The share of gap pixels around a pixel from which what they show is carried to it in full.
GAP_ENOUGH = 0.1
# How far what is behind may be from the picture and still be the picture's own pixel (0 to 1).
SAME = 2 / 255
# How far a pixel may be from what is behind it and still be that (0 to 1, the largest channel): a picture's grain.
GRAIN = 0.05
# The squared difference of RGB between the piece's colour and what is behind it at which the alpha is moved half
# the way.
CONTRAST = 0.02


def solve_soft(target: np.ndarray, pieces: list[dict]) -> list[dict]:
    """The pieces with their soft pixels solved from the picture, in the same order.

    target: the picture as float RGB (0 to 1) at its own size. pieces: front to back, the backdrop last, each with
    "place": [x, y, width, height] in the picture's pixels and "pixels": the place's pixels as RGBA bytes.
    """
    windows = [(slice(y, y + h), slice(x, x + w)) for x, y, w, h in (piece["place"] for piece in pieces)]
    drawn = [piece["pixels"].astype(np.float32) / 255 for piece in pieces]
    # How much of each of a piece's pixels the pieces in front hide.
    clear = np.ones(target.shape[:2], np.float32)
    covers = []
    for window, pixels in zip(windows, drawn, strict=True):
        covers.append(1 - clear[window])
        clear[window] *= 1 - pixels[..., 3]

    # The pieces behind the one at hand, drawn over each other, and at each pixel the front-most of them that is
    # at least half there.
    under = np.zeros_like(target)
    top = np.full(target.shape[:2], len(drawn) - 1, np.int32)
    for index in range(len(drawn) - 1, -1, -1):
        window, pixels = windows[index], drawn[index]
        seen = _solve(pixels, target[window], under[window], covers[index])
        if seen is not None:
            under[window] = np.clip(under[window] + seen, 0, 1)
            _carry(seen, window, top, drawn, windows)
        alpha = pixels[..., 3]
        under[window] = pixels[..., :3] * alpha[..., None] + under[window] * (1 - alpha[..., None])
        top[window][alpha >= 0.5] = index
    return [
        {**piece, "pixels": (np.clip(pixels, 0, 1) * 255 + 0.5).astype(np.uint8)}
        for piece, pixels in zip(pieces, drawn, strict=True)
    ]


def _solve(pixels: np.ndarray, target: np.ndarray, behind: np.ndarray, cover: np.ndarray) -> np.ndarray | None:
    """Solves one piece's soft pixels, in place. Gives how far the picture, seen through the piece's gaps, is from
    what is behind it, for the pieces behind to take; None when nothing is seen through it.

    pixels: the piece as float RGBA. target, behind: the picture and the pieces behind drawn over each other, in
    the piece's place. cover: how much the pieces in front hide.
    """
    alpha, rgb = pixels[..., 3], pixels[..., :3]
    shows = (cover <= FREE) & (alpha > FREE)
    if not shows.any():
        return None
    open_to = cv2.distanceTransform((cover <= FREE).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    in_the_open = np.clip((open_to - COVER_PX) / BLEND_PX, 0, 1)
    free = in_the_open * shows
    if not (shows & (alpha < SOLID)).any():
        # Solid wherever it shows: only its colour is left to solve.
        off = target - (behind + alpha[..., None] * (rgb - behind))
        pixels[..., :3] = np.clip(rgb + (free / np.maximum(alpha, FAINT))[..., None] * off, 0, 1)
        return None

    # Where the alpha comes out near nothing, or the piece is clear, the picture shows what is behind the piece.
    moved = _moved(alpha, free, target, behind, rgb)
    through = (in_the_open > 0.5) & (alpha < HALF) & (moved < GAP)
    seen = None
    if (through & shows).sum() >= GAP_PIXELS:
        gap = through.astype(np.float32)
        difference = target - behind
        near, seen = _smoothed(gap), _smoothed(difference * gap[..., None])
        seen /= np.maximum(near, 1e-3)[..., None]
        # A gap far from what the gaps around it show holds some of the piece: it is left out, and they are read again.
        gap *= np.abs(difference - seen).max(axis=2) <= ODD
        near, seen = _smoothed(gap), _smoothed(difference * gap[..., None])
        seen /= np.maximum(near, 1e-3)[..., None]
        # What is behind already is the picture where the two are the same: there nothing is carried.
        made_up = np.abs(difference).max(axis=2) > SAME
        seen *= (np.clip(near / GAP_ENOUGH, 0, 1) * made_up)[..., None]
        behind = np.clip(behind + seen, 0, 1)
        moved = _moved(alpha, free, target, behind, rgb)

    # A pixel that looks like what is behind it is what is behind it, however strongly the piece was drawn there.
    is_behind = (alpha < SOLID) & (np.abs(target - behind).max(axis=2) <= GRAIN)
    alpha = np.where((alpha < EDGE) | is_behind, moved, alpha)

    off = target - (behind + alpha[..., None] * (rgb - behind))
    pixels[..., :3] = np.clip(rgb + (free / np.maximum(alpha, FAINT))[..., None] * off, 0, 1)
    pixels[..., 3] = alpha
    return seen


def _smoothed(values: np.ndarray) -> np.ndarray:
    """`values` smoothed over GAP_REACH pixels, worked out at one in GAP_SCALE of the size: it is smoother than
    that."""
    height, width = values.shape[:2]
    small = (max(1, round(width / GAP_SCALE)), max(1, round(height / GAP_SCALE)))
    blurred = cv2.GaussianBlur(cv2.resize(values, small, interpolation=cv2.INTER_AREA), (0, 0), GAP_REACH / GAP_SCALE)
    return cv2.resize(blurred, (width, height), interpolation=cv2.INTER_LINEAR)


def _moved(alpha: np.ndarray, free: np.ndarray, target: np.ndarray, behind: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    """A piece's alpha moved along the line from what is behind to the piece's colour, to where the picture's pixel
    lies nearest. The less the two colours differ, the less it is moved: the alpha can't be told from there."""
    line = rgb - behind
    off = target - (behind + alpha[..., None] * line)
    return np.clip(alpha + free * (off * line).sum(axis=2) / ((line**2).sum(axis=2) + CONTRAST), 0, 1)


def _carry(seen: np.ndarray, window: tuple, top: np.ndarray, drawn: list[np.ndarray], windows: list[tuple]) -> None:
    """Gives the pieces behind the colour difference seen through a piece's gaps, in place: at each pixel, to the
    front-most piece behind that is at least half there.

    seen: the difference, in the place `window` of the piece it was seen through. top: that front-most piece's
    index at each pixel of the picture. drawn: the pieces as float RGBA. windows: where each lies in the picture.
    """
    owners = np.where(np.abs(seen).max(axis=2) > 0, top[window], -1)
    rows, cols = window
    for index in np.unique(owners[owners >= 0]):
        its_rows, its_cols = windows[index]
        y0, y1 = max(rows.start, its_rows.start), min(rows.stop, its_rows.stop)
        x0, x1 = max(cols.start, its_cols.start), min(cols.stop, its_cols.stop)
        if y0 >= y1 or x0 >= x1:
            continue
        here = (slice(y0 - rows.start, y1 - rows.start), slice(x0 - cols.start, x1 - cols.start))
        there = (slice(y0 - its_rows.start, y1 - its_rows.start), slice(x0 - its_cols.start, x1 - its_cols.start))
        piece = drawn[index][there]
        share = (owners[here] == index) / np.maximum(piece[..., 3], 0.5)
        piece[..., :3] = np.clip(piece[..., :3] + seen[here] * share[..., None], 0, 1)
