"""Cleanup: stray copies, copies of what is behind and wrong shadows leave the split layers.

Every split layer but the last is cleaned, back to front, so each is judged against the cleaned layers behind it.
The last layer, the backdrop, is never changed. Three passes, all by the planned parts' boxes and the picture:

1. Outside the boxes. A layer should hold pixels only near the planned parts of that layer: their boxes, padded,
   more so for a part with a shadow. What lies outside is removed, one joined area at a time, unless it shows in
   the stacked layers and brings them clearly closer to the picture there (something the split model drew one
   layer early stays). An area that doesn't reach into the unpadded box of any part of the layer counts as
   outside, however close it is. This takes a piece of the backdrop out of a cut-out's layer, and a logo drawn
   twice.
2. Copies of what is behind. A solid area that looks the same as the layers behind it is removed when it lies
   mostly outside the box of every part in front of the backdrop. It changes nothing in the stacked layers, but
   would show once a piece is moved.
3. Soft alpha matched to the picture. Shadows, glows, fades and veils (alpha below SOFT_MAX, a few pixels away from
   the solid pixels they belong to) are made weaker, never stronger, until the layer changes what is behind it only
   as much as the picture does there, measured along the layer's own colour over a small window. A veil the
   picture doesn't show goes away, a shadow drawn too dark gets lighter, and a right one stays. Where layers in
   front hide the soft pixels, they take the factor of the pixels that show around them, and are left alone when
   none do.

What passes 1 and 2 remove is feathered together, once, so no seam is left where two removed areas meet. At the
end, near-zero alpha far from anything a layer shows is cleared; the fading end of a shadow stays.

The pixel sizes here are pixels of the working size the split model drew the layers at, whichever that is.
"""

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

# The padding around a planned part's box: this share of the layer's long side, and this share of the box's own.
PAD_OF_LAYER = 0.02
PAD_OF_BOX = 0.10
# More padding for a part with a shadow, as a share of the layer's long side.
SHADOW_PAD_OF_LAYER = 0.04
# The side of the window, in pixels, that differences from the picture are averaged over, so an area is judged and
# not its noise.
ERROR_WINDOW = 7
# What lies outside the boxes stays only when it brings the stacked layers this much closer to the picture (0 to 1).
KEEP_GAIN = 0.015
# A copy of what is behind: a solid area that differs from the layers behind by less than COPY_DIFFERENCE (mean of
# RGB, 0 to 1, averaged over a window of COPY_WINDOW pixels), covers at least COPY_MIN_SHARE of the layer, and has at
# least COPY_OUTSIDE of itself outside the box of every part in front of the backdrop.
COPY_DIFFERENCE = 0.04
COPY_WINDOW = 5
COPY_MIN_SHARE = 0.001
COPY_OUTSIDE = 0.5
# Alpha below this is soft: a shadow, glow, fade or veil, which is matched to the picture.
SOFT_MAX = 0.9
# The side of the window, in pixels, over which a soft area's strength is compared with the picture's.
SOFT_WINDOW = 25
# Soft pixels within this many pixels of solid ones are the solid thing's own edge and are left alone.
EDGE_PX = 2
# The matching fades in over this many pixels beyond that edge.
RAMP_PX = 4
# Alpha at or below this shows nothing.
ALPHA_FLOOR = 0.03
# Near-zero alpha stays within this share of the layer's long side of alpha of at least TAIL_ANCHOR: the fading end
# of a shadow.
TAIL_OF_LAYER = 0.03
TAIL_ANCHOR = 0.1


def clean_layers(picture: Image.Image, parts: list[dict], layers: list[np.ndarray]) -> list[np.ndarray]:
    """The split layers, cleaned in place and given back.

    picture: the picture at its own size. parts: the planned parts, each {"id", "kind", "shadow", "layer" (1 is
    the top one), "box": (left, top, right, bottom) in the picture's pixels}. layers: the split layers, top first,
    as float RGBA arrays (0 to 1) at the working size.
    """
    height, width = layers[0].shape[:2]
    sx, sy = width / picture.width, height / picture.height
    target = np.asarray(picture.convert("RGB").resize((width, height), Image.BILINEAR)).astype(np.float32) / 255
    count = len(layers)
    # The unpadded boxes of every part but the backdrop's: a real thing sits inside its own box.
    front_parts = [part for part in parts if part["kind"] not in ("photo", "background")]
    in_a_box = boxes_mask(front_parts, sx, sy, width, height, pad=0) > 0

    # The layers behind the one at hand, drawn over each other as they come out of the cleaning.
    behind = over(layers[count - 1 :])
    for number in range(count - 1, 0, -1):
        layer = layers[number - 1]
        mine = [part for part in parts if part["layer"] == number]
        in_front = np.zeros((height, width), np.float32)
        for other in range(number - 1):
            in_front = 1 - (1 - in_front) * (1 - layers[other][..., 3])
        alpha = layer[..., 3].copy()
        a = layer[..., 3:4]
        with_layer = layer[..., :3] * a + behind * (1 - a)
        window = (ERROR_WINDOW, ERROR_WINDOW)
        gain = cv2.blur(np.abs(behind - target).mean(axis=2), window) - cv2.blur(
            np.abs(with_layer - target).mean(axis=2), window
        )
        shown = (1 - in_front) > 0.5

        # 1. Outside the boxes of this layer's parts.
        padded = cv2.GaussianBlur(boxes_mask(mine, sx, sy, width, height), (0, 0), 3)
        outside = (padded < 0.5) & (alpha > ALPHA_FLOOR)
        unpadded = boxes_mask(mine, sx, sy, width, height, pad=0) > 0
        areas, area_count = ndimage.label(alpha > ALPHA_FLOOR, structure=np.ones((3, 3)))
        if area_count:
            touches = np.zeros(area_count + 1, bool)
            touches[np.unique(areas[unpadded & (areas > 0)])] = True
            touches[0] = False
            outside |= (areas > 0) & ~touches[areas]
        stray = np.zeros((height, width), bool)
        areas, area_count = ndimage.label(outside, structure=np.ones((3, 3)))
        if area_count:
            index = np.arange(1, area_count + 1)
            sizes = ndimage.sum(outside, areas, index=index)
            seen = ndimage.sum(shown, areas, index=index)
            gained = ndimage.sum(np.where(shown, gain, 0), areas, index=index) / np.maximum(seen, 1)
            # Something the picture shows, drawn a layer early, stays.
            stays = (seen >= 0.3 * sizes) & (gained > KEEP_GAIN)
            stray = np.isin(areas, index[~stays])

        # 2. Copies of the layers behind, mostly outside the box of every part in front of the backdrop.
        difference = cv2.blur(np.abs(layer[..., :3] - behind).mean(axis=2), (COPY_WINDOW, COPY_WINDOW))
        same = ndimage.binary_opening(
            (alpha > 0.5) & (difference < COPY_DIFFERENCE) & ~stray, structure=np.ones((5, 5))
        )
        areas, area_count = ndimage.label(same)
        copies = np.zeros((height, width), bool)
        if area_count:
            index = np.arange(1, area_count + 1)
            sizes = ndimage.sum(np.ones((height, width)), areas, index=index)
            share_outside = ndimage.mean(~in_a_box, areas, index=index)
            copies = np.isin(areas, index[(sizes >= COPY_MIN_SHARE * width * height) & (share_outside >= COPY_OUTSIDE)])
            copies = ndimage.binary_dilation(copies, iterations=2) & (alpha > 0) & (difference < COPY_DIFFERENCE * 2)

        # Both are removed together: gaps of a few pixels between two removed areas are closed, and the whole is
        # grown by 2 pixels, so thin strokes (a stray copy of a wordmark) go whole and don't only fade.
        removed = stray | copies
        removed = ndimage.binary_closing(removed, iterations=3) | removed
        removed = ndimage.binary_dilation(removed, iterations=2)
        layer[..., 3] = alpha * np.clip(1 - cv2.GaussianBlur(removed.astype(np.float32), (0, 0), 1.0), 0, 1)

        # 3. Soft alpha matched to the picture.
        from_solid = distance(layer[..., 3] < SOFT_MAX)
        soft = (layer[..., 3] > ALPHA_FLOOR) & (layer[..., 3] < SOFT_MAX) & (from_solid > EDGE_PX)
        if soft.sum() > 30:
            # Judged only where this layer shows in the stacked layers, outside the box of any part in front.
            in_front_box = boxes_mask([part for part in parts if part["layer"] < number], sx, sy, width, height, 4) > 0
            judged = (soft & shown & ~in_front_box).astype(np.float32)
            a = layer[..., 3:4]
            # How this layer changes what is behind it, and how the picture differs from what is behind it.
            change = layer[..., :3] * a + behind * (1 - a) - behind
            wanted = target - behind
            window = (SOFT_WINDOW, SOFT_WINDOW)
            weight = cv2.blur(judged, window)
            change_here = cv2.blur(change * judged[..., None], window) / (weight[..., None] + 1e-6)
            wanted_here = cv2.blur(wanted * judged[..., None], window) / (weight[..., None] + 1e-6)
            strength = np.linalg.norm(change_here, axis=2)
            # The picture's change along the colour of the layer's own.
            wanted_strength = (wanted_here * change_here).sum(axis=2) / (strength + 1e-6)
            known = weight > 0.05
            ratio = np.where(known, np.clip(wanted_strength / np.maximum(strength, 1e-4), 0, 1), 0).astype(np.float32)
            wide = (3 * SOFT_WINDOW, 3 * SOFT_WINDOW)
            known_around = cv2.blur(known.astype(np.float32), wide)
            around = np.where(known_around > 0.01, cv2.blur(ratio, wide) / (known_around + 1e-6), 1.0)
            factor = cv2.GaussianBlur(np.where(known, ratio, around).astype(np.float32), (0, 0), 4)
            ramp = np.clip((from_solid - EDGE_PX) / RAMP_PX, 0, 1)
            scale = 1 - ramp * (1 - np.clip(factor, 0, 1))
            layer[..., 3] = np.where(soft, layer[..., 3] * scale, layer[..., 3])
        behind = layer[..., :3] * layer[..., 3:4] + behind * (1 - layer[..., 3:4])

    # Near-zero alpha far from anything a layer shows is cleared; the fading end of a shadow stays.
    for number in range(1, count):
        alpha = layers[number - 1][..., 3]
        near = distance(alpha < TAIL_ANCHOR) <= TAIL_OF_LAYER * max(width, height)
        alpha[(alpha < ALPHA_FLOOR) & ~near] = 0

    return layers


def boxes_mask(
    parts: list[dict], sx: float, sy: float, width: int, height: int, pad: float | None = None
) -> np.ndarray:
    """A float mask, 1 inside the boxes of `parts` at the working size, each padded by `pad` pixels; with no `pad`,
    by the padding a part's layer may hold pixels in."""
    mask = np.zeros((height, width), np.float32)
    long_side = max(width, height)
    for part in parts:
        left, top, right, bottom = part["box"]
        x0, y0, x1, y1 = left * sx, top * sy, right * sx, bottom * sy
        around = pad
        if around is None:
            around = PAD_OF_LAYER * long_side + PAD_OF_BOX * max(x1 - x0, y1 - y0)
            if part["shadow"] != "none":
                around += SHADOW_PAD_OF_LAYER * long_side
        mask[
            max(0, int(y0 - around)) : min(height, int(y1 + around)),
            max(0, int(x0 - around)) : min(width, int(x1 + around)),
        ] = 1
    return mask


def over(layers: list[np.ndarray]) -> np.ndarray:
    """RGBA layers, top first, drawn over each other, as RGB; the last one is taken as solid."""
    rgb = np.zeros(layers[-1].shape[:2] + (3,), np.float32)
    for layer in reversed(layers):
        alpha = layer[..., 3:4]
        rgb = layer[..., :3] * alpha + rgb * (1 - alpha)
    return rgb


def distance(mask: np.ndarray) -> np.ndarray:
    """How far each set pixel of `mask` is from the nearest unset one, in pixels; 0 on the unset ones."""
    return cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
