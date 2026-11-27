"""The structure check: the cut-outs the split model left in the backdrop.

A cut-out is stuck when no layer in front of the backdrop covers its box: it has no piece of its own to move. The
backdrop is the frontmost layer behind which every layer is nearly empty, since the split model sometimes leaves
the last layer empty and draws the photo or background a layer early.
"""

import numpy as np

# Alpha above this is solid.
SOLID = 0.5
# A layer with solid pixels on less than this share of itself is empty, when the backdrop is looked for.
EMPTY_LAYER = 0.005
# A cut-out is stuck when the layers in front of the backdrop cover less than this share of its box.
STUCK = 0.25


def stuck_cutouts(parts: list[dict], layers: list[np.ndarray], size: tuple[int, int]) -> list[str]:
    """The ids of the cut-outs stuck in the backdrop, in the plan's order.

    parts: the planned parts, each {"id", "kind", "shadow", "layer", "box": (left, top, right, bottom) in the
    picture's pixels}. layers: the cleaned split layers, top first, as float RGBA arrays (0 to 1) at the working
    size. size: the picture's own (width, height).
    """
    height, width = layers[0].shape[:2]
    sx, sy = width / size[0], height / size[1]
    solid = [layer[..., 3] > SOLID for layer in layers]
    back = len(layers)
    while back > 1 and solid[back - 1].mean() < EMPTY_LAYER:
        back -= 1
    front = np.any(solid[: back - 1], axis=0) if back > 1 else np.zeros((height, width), bool)
    stuck = []
    for part in parts:
        if part["kind"] != "cutout":
            continue
        left, top, right, bottom = part["box"]
        box = np.zeros((height, width), bool)
        box[max(0, int(top * sy)) : int(bottom * sy), max(0, int(left * sx)) : int(right * sx)] = True
        if (front & box).sum() < STUCK * box.sum():
            stuck.append(part["id"])
    return stuck
