"""The split pieces of a drawn test ad: `make_pieces`, and the app's `cut_pieces` around it.

The ad and the split layers a split model would give for it are drawn here, so no picture file is kept: a gradient
backdrop, a pill with a label of small bars on it, a headline of bars, a turned bar, and a grainy disc as a
cut-out. Each layer is blurred a little, as the split model's are, and the disc is a little darker in its layer
than in the picture. The cut-out's layer hides a copy of the pill behind the pill itself, and the shapes' layer
holds a stray patch that is in no part's box and not in the picture.
"""

import base64
import io
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from PIL import Image

import app
import pieces
from contract import Layer, LayerSplitResult, Part
from pieces import make_pieces

SIZE = 512
# The grid a planned part's box is given on.
GRID = 1000
# How far the split model's layers are blurred, in pixels.
BLUR = 1.2
# How much darker than the picture the cut-out's layer draws the disc (0 to 1).
DRIFT = 0.06
PILL = (300, 105, 460, 155)
STRIPE_ANGLE = 20.0
DISC_CENTRE, DISC_RADIUS = (150, 350), 100
# The stray patch in the shapes' layer: (left, top, right, bottom).
STRAY = (420, 440, 490, 480)
# The parts in front of the backdrop, front to back: id, kind, split layer, colour.
FRONT = (
    ("headline", "text", 1, (0.05, 0.1, 0.3)),
    ("label", "text", 1, (1.0, 1.0, 1.0)),
    ("pill", "shape", 2, (0.1, 0.35, 0.9)),
    ("stripe", "graphic", 2, (0.9, 0.3, 0.2)),
    ("disc", "cutout", 3, None),
)
LAYERS = 4


@pytest.fixture(scope="module")
def ad() -> SimpleNamespace:
    """The drawn ad: its picture, its planned parts, its split layers, and each part's mask as it was drawn."""
    return draw_ad()


@pytest.fixture(scope="module")
def made(ad) -> dict:
    return make_pieces(ad.picture, ad.parts, ad.layers)


def test_every_part_has_a_piece_of_its_own_with_the_backdrop_last(ad, made):
    items = made["items"]
    assert [item["part"] for item in items[:-1]] == ["headline", "label", "pill", "stripe", "disc"]
    assert items[-1]["part"] == "backdrop"
    assert (made["width"], made["height"]) == (SIZE, SIZE)
    assert made["stuck"] == []
    planned = {part["id"]: part for part in ad.parts}
    for item in items:
        part = planned[item["part"]]
        assert (item["kind"], item["layer"]) == (part["kind"], part["layer"])
        assert near(place(item), bounds(ad.masks[item["part"]] > 0.5), 6), item["part"]


def test_a_piece_is_cropped_to_what_it_shows(made):
    for item in made["items"]:
        alpha = pixels_of(item)[..., 3]
        assert alpha.shape == (item["height"], item["width"])
        for side in (alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]):
            assert side.max() >= 8, item["part"]


def test_the_pieces_are_ten_times_closer_to_the_picture_than_the_layers(ad, made):
    target = np.asarray(ad.picture).astype(np.float32) / 255
    stacked = np.zeros_like(target)
    for layer in reversed(ad.layers):
        stacked = layer[..., :3] * layer[..., 3:4] + stacked * (1 - layer[..., 3:4])
    assert made["closeness"]["off"] < percent_off(stacked, target) / 10


def test_closeness_is_measured_on_the_pieces_as_returned(ad, made):
    target = np.asarray(ad.picture).astype(np.float32) / 255
    stacked = np.zeros_like(target)
    for item in reversed(made["items"]):
        rgba = pixels_of(item).astype(np.float32) / 255
        rows, cols = slice(item["y"], item["y"] + item["height"]), slice(item["x"], item["x"] + item["width"])
        stacked[rows, cols] = rgba[..., :3] * rgba[..., 3:4] + stacked[rows, cols] * (1 - rgba[..., 3:4])
    difference = np.abs(stacked - target).max(axis=2) * 255
    assert made["closeness"] == {
        "mean": round(float(difference.mean()), 3),
        "off": round(percent_off(stacked, target), 2),
    }


def test_the_turned_bar_knows_its_angle(made):
    turned = piece_of(made, "stripe")["turned"]
    assert turned["angle"] == pytest.approx(STRIPE_ANGLE, abs=1.5)
    assert turned["width"] > 3 * turned["height"]


def test_upright_pieces_have_no_angle_and_the_backdrop_no_turned_box(made):
    for part in ("headline", "label", "pill", "disc"):
        assert piece_of(made, part)["turned"]["angle"] == 0
    assert piece_of(made, "backdrop")["turned"] is None


def test_the_disc_is_cut_to_the_disc(made):
    (x, y), radius = DISC_CENTRE, DISC_RADIUS
    assert near(place(piece_of(made, "disc")), (x - radius, y - radius, x + radius, y + radius), 6)


def test_the_hidden_copy_of_the_pill_is_in_no_other_piece(made):
    for item in made["items"]:
        # The label is drawn on the pill and the backdrop lies behind it: both are solid in its box by the drawing.
        if item["part"] not in ("pill", "label", "backdrop"):
            assert solid_pixels(item, PILL) == 0, item["part"]


def test_the_stray_patch_outside_every_box_is_in_no_piece(made):
    for item in made["items"]:
        if item["part"] != "backdrop":
            assert solid_pixels(item, STRAY) == 0, item["part"]


def test_the_pieces_fit_the_contract_beside_the_layers(ad, made):
    result = LayerSplitResult.model_validate(
        {
            "layers": [layer.model_dump() for layer in as_contract(ad.layers)],
            "pieces": made,
            "seconds": 1,
            "cpuCores": 1,
            "memoryGib": 1,
            "waitSeconds": 1,
        }
    )
    assert len(result.pieces.items) == len(made["items"])


def test_a_part_planned_in_a_layer_the_split_did_not_give_makes_no_pieces(ad):
    assert make_pieces(ad.picture, ad.parts, ad.layers[: LAYERS - 1]) is None


def test_a_cutout_left_in_the_backdrop_is_stuck_and_has_no_piece():
    drawn = draw_ad(disc_in_backdrop=True)
    made = make_pieces(drawn.picture, drawn.parts, drawn.layers)
    assert made["stuck"] == ["disc"]
    assert "disc" not in [item["part"] for item in made["items"]]


def test_the_app_cuts_the_pieces_of_its_layers(ad, made):
    cut = app.cut_pieces(ad.picture, as_parts(ad.parts), as_contract(ad.layers))
    assert {**cut.model_dump(mode="json"), "seconds": 0} == {**made, "seconds": 0}


def test_the_app_cuts_no_pieces_for_a_call_with_no_parts(ad):
    assert app.cut_pieces(ad.picture, None, as_contract(ad.layers)) is None


def test_a_step_that_throws_leaves_the_app_without_pieces_and_prints_why(ad, monkeypatch, capsys):
    def fail(*_):
        raise ValueError("the cutout failed")

    monkeypatch.setattr(pieces, "cut_layers", fail)
    assert app.cut_pieces(ad.picture, as_parts(ad.parts), as_contract(ad.layers)) is None
    printed = capsys.readouterr().err
    assert "Traceback" in printed
    assert "ValueError: the cutout failed" in printed


def test_pieces_that_do_not_fit_the_contract_leave_the_app_without_pieces(ad, made, monkeypatch, capsys):
    stripe = {**piece_of(made, "stripe"), "turned": {**piece_of(made, "stripe")["turned"], "angle": 46.0}}
    misfit = {**made, "items": [stripe if item["part"] == "stripe" else item for item in made["items"]]}
    monkeypatch.setattr(pieces, "make_pieces", lambda *_: misfit)
    assert app.cut_pieces(ad.picture, as_parts(ad.parts), as_contract(ad.layers)) is None
    assert "angle" in capsys.readouterr().err


def test_a_result_with_layers_and_no_pieces_fits_the_contract(ad):
    layers = as_contract(ad.layers)
    result = LayerSplitResult(layers=layers, pieces=None, seconds=1, cpuCores=1, memoryGib=1, waitSeconds=1)
    assert result.model_dump(mode="json")["pieces"] is None
    assert len(result.layers) == LAYERS


def draw_ad(disc_in_backdrop: bool = False) -> SimpleNamespace:
    """The test ad and its split layers. With `disc_in_backdrop`, the split left the cut-out in the backdrop and
    its own layer empty."""
    rows = np.linspace(0, 1, SIZE, dtype=np.float32)[:, None, None]
    top, bottom = np.array([0.55, 0.78, 0.95], np.float32), np.array([0.95, 0.9, 0.75], np.float32)
    backdrop = np.broadcast_to((1 - rows) * top + rows * bottom, (SIZE, SIZE, 3)).copy()
    grain = np.random.default_rng(7).random((SIZE, SIZE, 3)).astype(np.float32)
    grain = cv2.GaussianBlur(grain, (0, 0), 2) * 0.5 + np.array([0.15, 0.3, 0.2], np.float32)
    colours = {part: grain if colour is None else np.asarray(colour, np.float32) for part, _, _, colour in FRONT}
    masks = {
        "headline": mask(lambda big: bars(big, 40, 50, 9, 14, 44, 10)),
        "label": mask(lambda big: bars(big, 330, 122, 8, 6, 16, 6)),
        "pill": mask(lambda big: rectangle(big, PILL)),
        "stripe": mask(turned_bar),
        "disc": mask(lambda big: cv2.circle(big, (2 * DISC_CENTRE[0], 2 * DISC_CENTRE[1]), 2 * DISC_RADIUS, 255, -1)),
        "backdrop": np.ones((SIZE, SIZE), np.float32),
    }

    picture = backdrop.copy()
    for part, _, _, _ in reversed(FRONT):
        picture = colours[part] * masks[part][..., None] + picture * (1 - masks[part][..., None])
    if disc_in_backdrop:
        backdrop = colours["disc"] * masks["disc"][..., None] + backdrop * (1 - masks["disc"][..., None])

    # What each layer in front of the backdrop holds: the parts planned in it, and in the shapes' layer the stray
    # patch, in the pill's colour.
    drawn_in = {number: [part for part, _, layer, _ in FRONT if layer == number] for number in range(1, LAYERS)}
    if disc_in_backdrop:
        drawn_in[3].remove("disc")
    layers = []
    for number in range(1, LAYERS):
        rgba = np.zeros((SIZE, SIZE, 4), np.float32)
        held = [(masks[part], colours[part] - DRIFT * (part == "disc")) for part in drawn_in[number]]
        if number == 2:
            held.append((mask(lambda big: rectangle(big, STRAY)), colours["pill"]))
        for drawn, colour in held:
            rgba[..., :3] = np.where(drawn[..., None] > 0, colour, rgba[..., :3])
            rgba[..., 3] = np.maximum(rgba[..., 3], drawn)
        layers.append(blurred(rgba))
    if not disc_in_backdrop:
        # The copy of the pill in the cut-out's layer, hidden behind the pill itself.
        layers[2][..., :3] = np.where(masks["pill"][..., None] > 0.5, colours["pill"], layers[2][..., :3])
        layers[2][..., 3] = np.maximum(layers[2][..., 3], masks["pill"])
    layers.append(np.concatenate([cv2.GaussianBlur(backdrop, (0, 0), BLUR), np.ones((SIZE, SIZE, 1), np.float32)], 2))

    parts = [
        {"id": part, "kind": kind, "shadow": "none", "layer": layer, "box": grid_box(masks[part])}
        for part, kind, layer, _ in FRONT
    ]
    parts.append(
        {"id": "backdrop", "kind": "background", "shadow": "none", "layer": LAYERS, "box": grid_box(masks["backdrop"])}
    )
    return SimpleNamespace(picture=as_picture(picture), parts=parts, layers=as_saved(layers), masks=masks)


def mask(draw) -> np.ndarray:
    """What `draw` draws, as a float mask (0 to 1): drawn at twice the size and shrunk, so its edge is smooth."""
    big = np.zeros((SIZE * 2, SIZE * 2), np.uint8)
    draw(big)
    return cv2.resize(big, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def bars(big: np.ndarray, x: int, y: int, count: int, width: int, height: int, gap: int) -> None:
    """A row of upright bars standing for the letters of a text."""
    for index in range(count):
        left = x + index * (width + gap)
        rectangle(big, (left, y, left + width, y + height))


def rectangle(big: np.ndarray, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    cv2.rectangle(big, (2 * left, 2 * top), (2 * right, 2 * bottom), 255, -1)


def turned_bar(big: np.ndarray) -> None:
    corners = cv2.boxPoints(((2 * 380, 2 * 330), (2 * 150, 2 * 26), STRIPE_ANGLE))
    cv2.fillPoly(big, [corners.astype(np.int32)], 255)


def blurred(rgba: np.ndarray) -> np.ndarray:
    """A layer as the split model gives it: a little blurred, its colours kept under the blur."""
    alpha = cv2.GaussianBlur(rgba[..., 3], (0, 0), BLUR)
    multiplied = cv2.GaussianBlur(rgba[..., :3] * rgba[..., 3:4], (0, 0), BLUR)
    rgb = np.where(alpha[..., None] > 1e-4, multiplied / np.maximum(alpha[..., None], 1e-4), 0)
    return np.concatenate([rgb, alpha[..., None]], axis=2).astype(np.float32)


def grid_box(drawn: np.ndarray) -> dict:
    """The box of a drawn mask on the plan's grid."""
    left, top, right, bottom = bounds(drawn > 0.02)
    across, down = GRID / drawn.shape[1], GRID / drawn.shape[0]
    return {
        "left": int(left * across),
        "top": int(top * down),
        "right": min(GRID - 1, int((right - 1) * across) + 1),
        "bottom": min(GRID - 1, int((bottom - 1) * down) + 1),
    }


def as_picture(rgb: np.ndarray) -> Image.Image:
    return Image.fromarray((rgb * 255 + 0.5).astype(np.uint8))


def as_saved(layers: list[np.ndarray]) -> list[np.ndarray]:
    """Layers as a split layer's PNG holds them: rounded to 8 bits."""
    return [(np.clip(layer, 0, 1) * 255 + 0.5).astype(np.uint8).astype(np.float32) / 255 for layer in layers]


def bounds(drawn: np.ndarray) -> tuple[int, int, int, int]:
    """The (left, top, right, bottom) of a mask's set pixels, right and bottom just past them."""
    ys, xs = np.nonzero(drawn)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def place(item: dict) -> tuple[int, int, int, int]:
    """A piece's place as (left, top, right, bottom)."""
    return item["x"], item["y"], item["x"] + item["width"], item["y"] + item["height"]


def near(box: tuple, other: tuple, pixels: int) -> bool:
    """Whether every side of `box` is within `pixels` of the same side of `other`."""
    return all(abs(a - b) <= pixels for a, b in zip(box, other, strict=True))


def piece_of(made: dict, part: str) -> dict:
    (item,) = [item for item in made["items"] if item["part"] == part]
    return item


def pixels_of(item: dict) -> np.ndarray:
    """A piece's PNG as RGBA bytes."""
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(item["png"]))).convert("RGBA"))


def solid_pixels(item: dict, box: tuple[int, int, int, int]) -> int:
    """How many of a piece's pixels inside `box`, given in the picture's pixels, have alpha of 128 or more."""
    left, top, right, bottom = box
    alpha = np.zeros((SIZE, SIZE), np.uint8)
    alpha[item["y"] : item["y"] + item["height"], item["x"] : item["x"] + item["width"]] = pixels_of(item)[..., 3]
    return int((alpha[top:bottom, left:right] >= 128).sum())


def percent_off(stacked: np.ndarray, target: np.ndarray) -> float:
    """The percent of pixels where `stacked` is off from `target` by more than 8 of 255."""
    return float((np.abs(stacked - target).max(axis=2) * 255 > 8).mean()) * 100


def as_parts(parts: list[dict]) -> list[Part]:
    return [Part.model_validate(part) for part in parts]


def as_contract(layers: list[np.ndarray]) -> list[Layer]:
    """Split layers as the app reads them from ComfyUI: PNGs, base64."""
    out = []
    for layer in layers:
        buffer = io.BytesIO()
        Image.fromarray((layer * 255 + 0.5).astype(np.uint8)).save(buffer, format="PNG")
        out.append(Layer(png=base64.b64encode(buffer.getvalue()).decode(), width=layer.shape[1], height=layer.shape[0]))
    return out
