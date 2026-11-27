"""Cutout: each cleaned split layer is cut into one split piece per planned part.

The split model gives a few layers: all the text, all the shapes and logos, a cut-out or two, the backdrop. This
step cuts them by the planned parts' boxes and the layers' alpha only, with no model. Every pixel of a layer goes
to one piece, so the pieces drawn over each other show what the cleaned layers show.

1. The backdrop. The frontmost layer behind which every layer is nearly empty, drawn over anything behind it, is
   one piece. It is never cut.
2. Solid areas (joined pixels of alpha above SOLID) of each layer in front are matched to parts:
   - an area that fits the box of a part planned in another layer is that part (the split model drew it a layer
     early or late; the piece keeps the layer it is in, so the stacked pieces don't change);
   - otherwise it goes to the part of this layer whose box holds most of it, and when boxes tie, to the one that
     fits the area best, so a subline inside a headline's box stays the subline;
   - an area that reaches into other boxes is thinned until it falls apart (two texts touching, a card touching a
     person). A bit of it leaves the area's part only when it fits another part's box better (a whole card) or
     lies outside the part's own box, so a tilted headline whose letters dip into a subline's box is never cut
     through its letters. An area that never falls apart is cut only where one box alone holds a fair share.
3. Soft pixels (shadows, glows, smoothed edges) follow the solid area they are joined to through alpha that can be
   seen; a soft area between two parts is cut where the two meet. A faint area joined to nothing goes to the part
   whose box holds it (a thin grey line); other loose bits (a shadow under a shoe) join the nearest piece when they
   lie within its part's padded box; the rest is the layer's piece of no part, of kind "other". Alpha too faint to
   see joins the nearest piece last, so it can't join a faint area to its neighbour.
4. Copies. A part drawn twice: where an area of one layer repeats, roughly, what the part's own layer has in its
   box (a card drawn again against the person in front of it), that bit is cut off along the strongest colour edge
   and is the part's piece. A second piece of a part that is almost hidden behind its first is drawn into the
   first, so the bits that show stay. A piece in front that repeats a part behind it loses those pixels. Copies are
   looked for only in layers in front of the part: a layer behind it can have its colours there by nature (a pale
   panel under a pale chip).

Every piece but the backdrop also gets its turned box, measured from its pixels.

The pixel sizes here are pixels of the working size the split model drew the layers at, whichever that is.
"""

import cv2
import numpy as np
from scipy import ndimage
from skimage.filters import sobel
from skimage.segmentation import watershed

# Alpha at or below this can't be seen: nothing is joined through it, and it joins the nearest piece.
ALPHA_FLOOR = 0.03
# Alpha above this is solid: solid areas are matched to parts, and softer pixels follow them.
SOLID = 0.5
# A layer with solid pixels on less than this share of itself is empty, when the backdrop is looked for.
EMPTY_LAYER = 0.005
# A box is padded by this share of the layer's long side when what it holds is measured.
BOX_PAD = 0.01
# An area belongs to a box that holds at least this share of it.
HOLD_MIN = 0.5
# Boxes that hold within this of the most tie, and the tie goes to the box that fits the area best.
TIE = 0.1
# An area reaches into a part of another layer when it covers this share of that part's box.
REACH = 0.25
# A part grown into an area of another layer: that layer repeats the part's own to within REPEAT_DIFFERENCE (mean of
# RGB, 0 to 1, averaged over a window of REPEAT_WINDOW pixels; the split model draws a copy again, never the same),
# on at least REPEAT_SHARE of the part's solid pixels.
REPEAT_DIFFERENCE = 0.15
REPEAT_WINDOW = 9
REPEAT_SHARE = 0.4
# An area that never falls apart is cut when at least two boxes alone hold this share of its solid pixels each.
CUT_MIN = 0.1
# An area is a part of another layer when its bounds overlap that part's box this well (the shared area over the
# joined area).
CLAIM_OVERLAP = 0.5
# Loose bits join a piece within this padding of its part's box, the same padding as the cleanup's.
PAD_OF_LAYER = 0.02
PAD_OF_BOX = 0.10
SHADOW_PAD_OF_LAYER = 0.04
# A loose bit whose alpha adds up to less than this joins the nearest piece wherever it is.
SMALL_BIT = 200
# Alpha below this is noise that can't be seen: it changes a pixel by at most 2 of 255. It is dropped from the
# pieces of the TRIMMED kinds, so their boxes hug what can be seen, a faint shadow or glow included; cut-outs and
# photos keep every pixel.
NOISE = 3 / 255
TRIMMED = ("text", "shape", "logo", "graphic")
# A second piece of a part is a hidden copy when this share of its alpha is covered by what is in front.
HIDDEN = 0.9
# A copy in front matches the part behind it to within COPY_DIFFERENCE (mean of RGB, 0 to 1, averaged over a window
# of COPY_WINDOW pixels), on at least COPY_SHARE of the part's solid pixels.
COPY_DIFFERENCE = 0.04
COPY_WINDOW = 5
COPY_SHARE = 0.5
# A piece turned by less than this many degrees is upright.
ANGLE_SNAP = 1.0
# So is one whose turned box isn't at least a tenth smaller than its upright box.
ANGLE_GAIN = 0.9


def cut_layers(parts: list[dict], layers: list[np.ndarray], size: tuple[int, int]) -> list[dict]:
    """The split pieces of the cleaned split layers, front to back, the backdrop last.

    parts: the planned parts, each {"id", "kind", "shadow", "layer" (1 is the top one), "box": (left, top, right,
    bottom) in the picture's pixels}. layers: the cleaned split layers, top first, as float RGBA arrays (0 to 1)
    at the working size. size: the picture's own (width, height).

    A piece is {"part": its part's id, None for a piece of no part, "kind": the part's kind or "other", "layer":
    the split layer it is in, "box": [x, y, width, height] at the working size, "turned": its turned box there,
    None for the backdrop and for a piece too small to measure, "picture": the box's pixels as RGBA bytes}.
    """
    height, width = layers[0].shape[:2]
    sx, sy = width / size[0], height / size[1]
    long_side = max(width, height)
    count = len(layers)

    planned = []
    for part in parts:
        left, top, right, bottom = part["box"]
        box = (int(left * sx), int(top * sy), int(np.ceil(right * sx)), int(np.ceil(bottom * sy)))
        planned.append({**part, "box": box, "area": max(1, (box[2] - box[0]) * (box[3] - box[1]))})
    front_parts = [part for part in planned if part["kind"] not in ("photo", "background")]
    # The number a part's pixels are marked with in a layer's labels; 0 is no part.
    label_of = {part["id"]: index + 1 for index, part in enumerate(front_parts)}

    def box_mask(part, pad=0):
        """A mask of the part's box, padded by `pad` pixels."""
        mask = np.zeros((height, width), bool)
        x0, y0, x1, y1 = part["box"]
        mask[max(0, y0 - pad) : min(height, y1 + pad), max(0, x0 - pad) : min(width, x1 + pad)] = True
        return mask

    def in_box(part, pad, rows, cols):
        """`box_mask(part, pad)` inside a window, without a mask of the whole layer."""
        x0, y0, x1, y1 = part["box"]
        yy, xx = np.arange(rows.start, rows.stop)[:, None], np.arange(cols.start, cols.stop)[None, :]
        return (yy >= y0 - pad) & (yy < y1 + pad) & (xx >= x0 - pad) & (xx < x1 + pad)

    def layer_pad(part):
        """The padding around the part's box that its layer may hold pixels in, as the cleanup pads it."""
        x0, y0, x1, y1 = part["box"]
        around = PAD_OF_LAYER * long_side + PAD_OF_BOX * max(x1 - x0, y1 - y0)
        return int(around + (SHADOW_PAD_OF_LAYER * long_side if part["shadow"] != "none" else 0))

    def window(mask, pad=0):
        """The slices of the layer that hold every set pixel of `mask`, with `pad` pixels around them."""
        rows, cols = np.nonzero(mask.any(axis=1))[0], np.nonzero(mask.any(axis=0))[0]
        return (
            slice(max(0, rows[0] - pad), min(height, rows[-1] + 1 + pad)),
            slice(max(0, cols[0] - pad), min(width, cols[-1] + 1 + pad)),
        )

    def reaches(part, pad, rows, cols):
        """Whether the part's box, padded, reaches into a window at all."""
        x0, y0, x1, y1 = part["box"]
        return rows.start < y1 + pad and rows.stop > y0 - pad and cols.start < x1 + pad and cols.stop > x0 - pad

    def overlap(bounds, part):
        """How well `bounds` and the part's box fit each other: their shared area over their joined area."""
        x0, y0, x1, y1 = part["box"]
        across = max(0, min(bounds[2], x1) - max(bounds[0], x0))
        down = max(0, min(bounds[3], y1) - max(bounds[1], y0))
        shared = across * down
        return shared / ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) + part["area"] - shared)

    def bounds_of(area, rows, cols):
        """The bounds in the layer, (left, top, right, bottom), of an area given inside a window."""
        yy, xx = np.nonzero(area)
        return (cols.start + xx.min(), rows.start + yy.min(), cols.start + xx.max() + 1, rows.start + yy.max() + 1)

    # 1. The backdrop: the frontmost layer behind which every layer is nearly empty.
    back = count
    while back > 1 and (layers[back - 1][..., 3] > SOLID).mean() < EMPTY_LAYER:
        back -= 1
    box_pad = int(BOX_PAD * long_side)
    masks = {part["id"]: box_mask(part, box_pad) for part in front_parts}

    def best_of(area, rows, cols, candidates):
        """The share of the area that the best box holds, the part that wins the area, and every part whose box
        holds some of it."""
        pixels = area.sum()
        held = [
            ((masks[part["id"]][rows, cols] & area).sum() / pixels, part)
            for part in candidates
            if reaches(part, box_pad, rows, cols)
        ]
        held = [(share, part) for share, part in held if share > 0]
        if not held:
            return 0.0, None, []
        best = max(share for share, _ in held)
        bounds = bounds_of(area, rows, cols)
        winner = max([part for share, part in held if share >= best - TIE], key=lambda part: overlap(bounds, part))
        return best, winner, [part for _, part in held]

    def held_by(area, rows, cols, part):
        """The share of the area that the part's padded box holds."""
        return (masks[part["id"]][rows, cols] & area).sum() / area.sum()

    def cut_area(area, rows, cols, winner, others):
        """The labels of a solid area that reaches into the boxes of `others`, or None when it is all `winner`'s.

        The area is thinned until it falls apart (letters joined by an outline, a card touching a person). A bit
        goes to another part only when its bounds fit that part's box better than the winner's (a whole card), or
        when it lies outside the winner's box and in the other's. So bits of a tilted headline that dip into a
        subline's box stay with the headline. An area that never falls apart (two shapes grown together) is cut by
        the pixels that one box alone holds, when two boxes each hold a fair share.
        """
        for thinning in (1, 2, 3):
            bits, bit_count = ndimage.label(
                ndimage.binary_erosion(area, iterations=thinning), structure=np.ones((3, 3))
            )
            if bit_count < 2:
                continue
            seeds = np.zeros(area.shape, np.int32)
            for index in range(1, bit_count + 1):
                bit = bits == index
                bounds = bounds_of(bit, rows, cols)
                fits = [(overlap(bounds, part), part) for part in others]
                fits = [(fit, part) for fit, part in fits if fit >= CLAIM_OVERLAP and fit > overlap(bounds, winner)]
                if fits:
                    seeds[bit] = label_of[max(fits, key=lambda fit: fit[0])[1]["id"]]
                elif held_by(bit, rows, cols, winner) >= HOLD_MIN:
                    seeds[bit] = label_of[winner["id"]]
                else:
                    share, part, _ = best_of(bit, rows, cols, others)
                    if part is not None and share >= HOLD_MIN:
                        seeds[bit] = label_of[part["id"]]
            if len(np.unique(seeds[seeds > 0])) >= 2:
                return watershed(np.zeros(area.shape, np.float32), seeds, mask=area)
            # Its bits all belong to the winner.
            return None
        boxes = [winner] + others
        stack = np.stack([masks[part["id"]][rows, cols] for part in boxes])
        owner = np.zeros(area.shape, np.int32)
        for index, part in enumerate(boxes):
            owner[stack[index] & (stack.sum(axis=0) == 1) & area] = label_of[part["id"]]
        shares = [(owner == label).sum() / area.sum() for label in np.unique(owner[area]) if label]
        if sum(1 for share in shares if share >= CUT_MIN) >= 2:
            return watershed(np.zeros(area.shape, np.float32), owner, mask=area)
        return None

    # 2 and 3. Every layer in front of the backdrop is cut. The pieces, front to back, each {"layer", "part",
    # "kind", "colours": the RGBA picture its colours are read from, "alpha": its own alpha over the whole layer}.
    pieces = []
    for number in range(1, back):
        layer = layers[number - 1]
        alpha = layer[..., 3]
        here = [part for part in front_parts if part["layer"] == number]
        elsewhere = [part for part in front_parts if part["layer"] != number and part["kind"] != "text"]
        solid, _ = ndimage.label(alpha > SOLID, structure=np.ones((3, 3)))
        labels = np.zeros((height, width), np.int32)
        for index, (rows, cols) in enumerate(ndimage.find_objects(solid), 1):
            area = solid[rows, cols] == index
            bounds = bounds_of(area, rows, cols)
            held, winner, inside = best_of(area, rows, cols, here)
            # A part of another layer, drawn a layer early or late: the area fits that part's box better than any
            # box of this layer.
            fit_here = max([overlap(bounds, part) for part in here], default=0.0)
            fits = [(overlap(bounds, part), part) for part in elsewhere]
            fits = [(fit, part) for fit, part in fits if fit >= CLAIM_OVERLAP and fit > fit_here]
            if fits:
                labels[rows, cols][area] = label_of[max(fits, key=lambda fit: fit[0])[1]["id"]]
                continue
            if held < HOLD_MIN:
                # No box of this layer holds it: it is a part of another layer whose box does, or it is left for
                # the soft pixels' pass below.
                share, part, _ = best_of(area, rows, cols, elsewhere)
                if share >= HOLD_MIN:
                    labels[rows, cols][area] = label_of[part["id"]]
                continue
            # The other parts this area reaches into: boxes of this layer, and boxes of other layers it covers a
            # good share of (a card that touches the person in front of it).
            others = [part for part in inside if part is not winner] + [
                part
                for part in elsewhere
                if reaches(part, box_pad, rows, cols)
                and (masks[part["id"]][rows, cols] & area).sum() >= REACH * part["area"]
            ]
            cut = cut_area(area, rows, cols, winner, others) if others else None
            labels[rows, cols][area] = cut[area] if cut is not None else label_of[winner["id"]]
        # A part of a layer behind this one, grown into an area of this layer (a card drawn against the person in
        # front of it): where this layer repeats, roughly, what the part's own layer has inside its box, that bit
        # is the part. Those pixels seed it, the rest of the area outside the part's box seeds the area's own
        # part, and the cut between them follows the strongest colour edge. Only parts of a layer behind: a layer
        # behind a part often has its colours there (a pale panel under a pale chip) without being a copy of it,
        # and a cut there would tear a hole in that layer.
        for part in elsewhere:
            planned_in = part["layer"]
            if not number < planned_in < back:
                continue
            own = (layers[planned_in - 1][..., 3] > SOLID) & box_mask(part)
            other_parts = (alpha > SOLID) & masks[part["id"]] & (labels > 0) & (labels != label_of[part["id"]])
            if own.sum() < 500 or (other_parts & own).sum() < REPEAT_SHARE * own.sum():
                continue
            difference = np.abs(layer[..., :3] - layers[planned_in - 1][..., :3]).mean(axis=2)
            close = cv2.blur(difference, (REPEAT_WINDOW, REPEAT_WINDOW)) < REPEAT_DIFFERENCE
            repeated = ndimage.binary_erosion(other_parts & own & close, iterations=2)
            if repeated.sum() < REPEAT_SHARE * own.sum():
                continue
            involved = np.isin(labels, np.unique(labels[repeated]))
            seeds = np.where(involved & ~masks[part["id"]], labels, 0)
            seeds[repeated] = label_of[part["id"]]
            edges = sum(sobel(layer[..., channel]) for channel in range(3))
            labels = np.where(involved, watershed(edges, seeds, mask=involved), labels)

        # Soft pixels, and solid areas no part took, follow what they are joined to through alpha that can be seen.
        seen = alpha > ALPHA_FLOOR
        labels = watershed(np.zeros((height, width), np.float32), labels * seen, mask=seen) if labels.any() else labels
        # Areas joined to no part: the part whose box holds them, else the nearest piece when they lie within its
        # part's padded box, and small bits wherever they are; the rest is the layer's piece of no part.
        loose = seen & (labels == 0)
        no_part = np.zeros((height, width), bool)
        if loose.any() and labels.any():
            distance, (near_y, near_x) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
            nearest = labels[near_y, near_x]
            bits, bit_count = ndimage.label(loose, structure=np.ones((3, 3)))
            indexes = np.arange(1, bit_count + 1)
            weights = ndimage.sum(alpha, bits, indexes)
            # Each bit's pixel nearest to a piece.
            closest = ndimage.minimum_position(distance, bits, indexes)
            for index, (rows, cols), weight, pixel in zip(
                indexes, ndimage.find_objects(bits), weights, closest, strict=True
            ):
                bit = bits[rows, cols] == index
                share, part, _ = best_of(bit, rows, cols, here)
                if part is not None and share >= HOLD_MIN:
                    labels[rows, cols][bit] = label_of[part["id"]]
                    continue
                label = nearest[pixel]
                part = front_parts[label - 1]
                if weight < SMALL_BIT or in_box(part, layer_pad(part), rows, cols)[bit].mean() > 0.5:
                    labels[rows, cols][bit] = label
                else:
                    no_part[rows, cols] |= bit
        elif loose.any():
            no_part = loose
        # Alpha too faint to see joins the nearest piece.
        faint = (alpha > 0) & (labels == 0) & ~no_part
        if faint.any() and labels.any():
            _, (near_y, near_x) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
            labels[faint] = labels[near_y[faint], near_x[faint]]
        elif faint.any():
            no_part |= faint
        present = set(np.unique(labels).tolist())
        for part in front_parts:
            if label_of[part["id"]] not in present:
                continue
            mine = labels == label_of[part["id"]]
            if part["kind"] in TRIMMED:
                mine = mine & (alpha >= NOISE)
            if (alpha * mine).sum() > 0:
                pieces.append(
                    {
                        "layer": number,
                        "part": part["id"],
                        "kind": part["kind"],
                        "colours": layer,
                        "alpha": np.where(mine, alpha, 0).astype(np.float32),
                    }
                )
        if no_part.any():
            pieces.append(
                {
                    "layer": number,
                    "part": None,
                    "kind": "other",
                    "colours": layer,
                    "alpha": np.where(no_part, alpha, 0).astype(np.float32),
                }
            )

    backdrop = over(layers[back - 1 :])
    backdrop_parts = [part for part in planned if part["kind"] in ("photo", "background")]
    pieces.append(
        {
            "layer": back,
            "part": backdrop_parts[0]["id"] if backdrop_parts else None,
            "kind": backdrop_parts[0]["kind"] if backdrop_parts else "background",
            "colours": backdrop,
            "alpha": backdrop[..., 3],
        }
    )

    # 4. Copies.
    # A copy in front: another piece repeats, in front of it, a part whose own piece is behind (the copy came along
    # with an area it touches). The repeated pixels leave that piece; the part's own piece shows the same there.
    for index, piece in enumerate(pieces):
        if piece["part"] is None or piece["kind"] in ("photo", "background", "text"):
            continue
        own = (piece["alpha"] > SOLID) & masks[piece["part"]]
        total = own.sum()
        if total < 500:
            continue
        around = window(own, 8)
        own = own[around]
        for front in pieces[:index]:
            if (
                front["layer"] >= piece["layer"]
                or front["part"] == piece["part"]
                or front["kind"] in ("photo", "background")
            ):
                continue
            both = (front["alpha"][around] > SOLID) & own
            if both.sum() < COPY_SHARE * total:
                continue
            difference = cv2.blur(
                np.abs(front["colours"][around][..., :3] - piece["colours"][around][..., :3]).mean(axis=2),
                (COPY_WINDOW, COPY_WINDOW),
            )
            same = both & (difference < COPY_DIFFERENCE)
            if same.sum() < COPY_SHARE * total:
                continue
            removed = ndimage.binary_closing(same, iterations=3) | same
            removed = (
                ndimage.binary_dilation(removed, iterations=2)
                & (piece["alpha"][around] > ALPHA_FLOOR)
                & masks[piece["part"]][around]
            )
            alpha = front["alpha"].copy()
            alpha[around][removed] = 0
            front["alpha"] = alpha
    pieces = [piece for piece in pieces if piece["alpha"].max() > ALPHA_FLOOR]

    def cover_in_front(index):
        """How much of each pixel the pieces of the layers in front of piece `index` hide."""
        cover = np.zeros((height, width), np.float32)
        for piece in pieces[:index]:
            if piece["layer"] < pieces[index]["layer"]:
                cover = 1 - (1 - cover) * (1 - piece["alpha"])
        return cover

    # A hidden copy: a second piece of a part, almost hidden by what is in front of it, is drawn into the part's
    # front piece. The hidden pixels are behind it there, and the few that show stay where they are.
    for index in range(len(pieces) - 1, -1, -1):
        piece = pieces[index]
        if piece["part"] is None or piece["kind"] in ("photo", "background"):
            continue
        in_front = [
            front for front in pieces[:index] if front["part"] == piece["part"] and front["layer"] < piece["layer"]
        ]
        if not in_front:
            continue
        alpha = piece["alpha"]
        hidden = float((alpha * cover_in_front(index)).sum() / max(alpha.sum(), 1e-6))
        if hidden >= HIDDEN:
            front = in_front[0]
            both = over([drawn(front), drawn(piece)])
            front["colours"], front["alpha"] = both, both[..., 3]
            pieces.pop(index)

    cut = []
    for piece in pieces:
        ys, xs = np.nonzero(piece["alpha"] > 0)
        x0, y0, x1, y1 = (
            (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else (0, 0, 1, 1)
        )
        backdrop_kind = piece["kind"] in ("photo", "background")
        cut.append(
            {
                "part": piece["part"],
                "kind": piece["kind"],
                "layer": piece["layer"],
                "box": [x0, y0, x1 - x0, y1 - y0],
                "turned": None if backdrop_kind else turned_box(piece["alpha"], piece["kind"]),
                "picture": (np.clip(drawn(piece)[y0:y1, x0:x1], 0, 1) * 255 + 0.5).astype(np.uint8),
            }
        )
    return cut


def over(layers: list[np.ndarray], alphas: list[np.ndarray] | None = None) -> np.ndarray:
    """RGBA layers, top first, drawn over each other, as RGBA with its colours not multiplied by its alpha. With
    `alphas`, each layer is drawn with that alpha in place of its own."""
    height, width = layers[0].shape[:2]
    alphas = alphas or [layer[..., 3] for layer in layers]
    rgb = np.zeros((height, width, 3), np.float32)
    covered = np.zeros((height, width), np.float32)
    for layer, alpha in zip(reversed(layers), reversed(alphas), strict=True):
        rows, cols = np.nonzero(alpha.any(axis=1))[0], np.nonzero(alpha.any(axis=0))[0]
        if len(rows) == 0:
            continue
        window = (slice(rows[0], rows[-1] + 1), slice(cols[0], cols[-1] + 1))
        a = alpha[window]
        rgb[window] = layer[window][..., :3] * a[..., None] + rgb[window] * (1 - a[..., None])
        covered[window] = a + covered[window] * (1 - a)
    out = np.zeros((height, width, 4), np.float32)
    out[..., :3] = np.where(covered[..., None] > 1e-6, rgb / np.maximum(covered[..., None], 1e-6), 0)
    out[..., 3] = covered
    return out


def drawn(piece: dict) -> np.ndarray:
    """A piece over the whole layer, as RGBA: the colours it reads, with its own alpha."""
    out = piece["colours"].copy()
    out[..., 3] = piece["alpha"]
    return out


def turned_box(alpha: np.ndarray, kind: str) -> dict | None:
    """A piece's turned box, {"cx", "cy", "width", "height", "angle"}: its centre, its size along and across the
    piece, and the angle in degrees, clockwise with y down. None when the piece has too few solid pixels to measure.

    The angle is measured on the solid pixels. For text it is the angle at which the lines stack most sharply, so a
    short last line doesn't turn the box; for any other piece, the angle of the smallest box around the pixels. It
    is 0 unless it is at least ANGLE_SNAP degrees and the turned box is clearly tighter than the upright one: a
    circle, a starburst or one letter fits any angle about as well. The box holds the letters of a text, and all
    that any other piece shows, a shadow or glow included.
    """
    ys, xs = np.nonzero(alpha > SOLID)
    if len(xs) < 20:
        return None
    xs, ys = xs.astype(np.float64), ys.astype(np.float64)
    if kind == "text":
        best, angle = -1.0, 0.0
        for candidate in np.arange(-45, 45.01, 0.5):
            turn = np.deg2rad(candidate)
            across = -xs * np.sin(turn) + ys * np.cos(turn)
            rows = np.bincount((across - across.min()).astype(np.int64)).astype(np.float64)
            score = (rows**2).sum()
            if score > best:
                best, angle = score, float(candidate)
    else:
        (_, _), (_, _), angle = cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))
        # The turn nearest to upright.
        angle = ((angle + 45) % 90) - 45

    def turned(angle, xs, ys):
        """The angle in radians, and the pixels' places along and across a box turned by it."""
        turn = np.deg2rad(angle)
        return turn, xs * np.cos(turn) + ys * np.sin(turn), -xs * np.sin(turn) + ys * np.cos(turn)

    _, along, across = turned(angle, xs, ys)
    upright = (xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1)
    if (
        abs(angle) < ANGLE_SNAP
        or (along.max() - along.min() + 1) * (across.max() - across.min() + 1) > ANGLE_GAIN * upright
    ):
        angle = 0.0
    if kind != "text":
        ys, xs = np.nonzero(alpha > 0)
        xs, ys = xs.astype(np.float64), ys.astype(np.float64)
    turn, along, across = turned(angle, xs, ys)
    centre_along, centre_across = (along.min() + along.max() + 1) / 2, (across.min() + across.max() + 1) / 2
    return {
        "cx": round(float(centre_along * np.cos(turn) - centre_across * np.sin(turn)), 1),
        "cy": round(float(centre_along * np.sin(turn) + centre_across * np.cos(turn)), 1),
        "width": round(float(along.max() - along.min() + 1), 1),
        "height": round(float(across.max() - across.min() + 1), 1),
        "angle": round(float(angle), 1),
    }
