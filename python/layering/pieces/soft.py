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

    # The pieces behind the one at hand, drawn over each other.
    under = np.zeros_like(target)
    for index in range(len(drawn) - 1, -1, -1):
        window, pixels = windows[index], drawn[index]
        _solve(pixels, target[window], under[window], covers[index])
        alpha = pixels[..., 3:4]
        under[window] = pixels[..., :3] * alpha + under[window] * (1 - alpha)
    return [
        {**piece, "pixels": (np.clip(pixels, 0, 1) * 255 + 0.5).astype(np.uint8)}
        for piece, pixels in zip(pieces, drawn, strict=True)
    ]


def _solve(pixels: np.ndarray, target: np.ndarray, behind: np.ndarray, cover: np.ndarray) -> None:
    """Solves one piece's soft pixels, in place.

    pixels: the piece as float RGBA. target, behind: the picture and the pieces behind drawn over each other, in
    the piece's place. cover: how much the pieces in front hide.
    """
    alpha, rgb = pixels[..., 3], pixels[..., :3]
    shows = (cover <= FREE) & (alpha > FREE)
    if not shows.any():
        return
    open_to = cv2.distanceTransform((cover <= FREE).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    free = np.clip((open_to - COVER_PX) / BLEND_PX, 0, 1) * shows

    line = rgb - behind
    off = target - (behind + alpha[..., None] * line)
    # The less the two colours differ, the less the alpha is moved: it can't be told from there.
    moved = alpha + free * (off * line).sum(axis=2) / ((line**2).sum(axis=2) + CONTRAST)
    alpha = np.where(alpha < EDGE, np.clip(moved, 0, 1), alpha)

    off = target - (behind + alpha[..., None] * line)
    pixels[..., :3] = np.clip(rgb + (free / np.maximum(alpha, FAINT))[..., None] * off, 0, 1)
    pixels[..., 3] = alpha
