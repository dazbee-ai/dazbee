"""The split pieces of a drawn test ad: `make_pieces`, and the app's `cut_pieces` around it.

The ad and the split layers a split model would give for it are drawn here, so no picture file is kept: a gradient
backdrop, a pill with a label of small bars on it, a headline of bars, a turned bar, and a grainy disc as a
cut-out. Each layer is blurred a little, as the split model's are, and the disc is a little darker in its layer
than in the picture. The cut-out's layer hides a copy of the pill behind the pill itself, and the shapes' layer
holds a stray patch that is in no part's box and not in the picture.
"""

import base64
import io
import json
import urllib.error
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from PIL import Image

import app
import pieces
from contract import Layer, LayerSplitResult, Part, Pieces
from pieces import make_pieces
from pieces.edges import read_edges
from pieces.soft import solve_soft

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


def test_a_piece_turned_45_degrees_in_a_tall_picture_keeps_its_angle_within_the_contract():
    drawn = draw_diamond()
    made = make_pieces(drawn.picture, drawn.parts, drawn.layers)
    diamond = piece_of(made, "diamond")
    assert near(place(diamond), drawn.bounds, 6)
    assert 44 <= abs(diamond["turned"]["angle"]) <= 45
    assert diamond["turned"]["width"] == pytest.approx(drawn.side, abs=8)
    assert diamond["turned"]["height"] == pytest.approx(drawn.side, abs=8)
    Pieces.model_validate(made)


@pytest.mark.parametrize("part", ["caption", "route"])
def test_a_thin_stroke_the_split_drew_pale_and_soft_is_read_from_the_picture(part):
    thin = draw_thin()
    item = piece_of(make_pieces(thin.picture, thin.parts, thin.layers), part)
    rgba = np.zeros(thin.masks[part].shape + (4,), np.float32)
    rgba[item["y"] : item["y"] + item["height"], item["x"] : item["x"] + item["width"]] = pixels_of(item) / 255
    strokes = thin.thin[part]
    assert np.abs(rgba[..., 3] - thin.masks[part])[strokes].mean() < 0.03
    inked = strokes & (thin.masks[part] > 0.95)
    assert np.abs(rgba[..., :3][inked] - thin.colours[part]).max() < 0.04


def test_the_grain_behind_a_thin_line_does_not_widen_its_piece():
    # A dark line three pixels thick on a light backdrop that is a little darker in a patch above the line.
    target = np.full((60, 120, 3), 0.9, np.float32)
    target[22:27, 40:80] = 0.86
    target[30:33, 10:110] = 0.1
    drawn = np.zeros((60, 120, 4), np.float32)
    drawn[30:33, 10:110] = (0.35, 0.35, 0.35, 1)
    line = (blurred(drawn)[24:39, 4:116] * 255 + 0.5).astype(np.uint8)
    backdrop = np.full((60, 120, 4), 255, np.uint8)
    backdrop[..., :3] = 230
    front = {"kind": "graphic", "layer": 1, "place": [4, 24, 112, 15], "pixels": line, "model": line}
    back = {"kind": "background", "layer": 2, "place": [0, 0, 120, 60], "pixels": backdrop, "model": backdrop}
    edged = read_edges(target, [front, back], 2.0)[0]
    shown = np.nonzero((edged["pixels"][..., 3] >= 8).any(axis=1))[0]
    assert (edged["place"][1] + shown[0], edged["place"][1] + shown[-1] + 1) == (30, 33)


def test_a_soft_piece_drawn_blurred_shows_the_picture_once_solved():
    soft = draw_soft()
    before = stacked_pieces(soft.pieces)
    after = stacked_pieces(solve_soft(soft.target, soft.pieces))
    assert percent_off(before, soft.target) > 10
    assert percent_off(after, soft.target) < 0.5


def test_a_shadow_drawn_too_strong_takes_the_strength_it_has_in_the_picture():
    soft = draw_soft()
    shadow = solve_soft(soft.target, soft.pieces)[1]["pixels"][20:40, 20:100, 3] / 255
    assert soft.pieces[1]["pixels"][30, 60, 3] == 128
    assert np.abs(shadow - 0.25).max() < 0.03


@pytest.mark.parametrize("room", [0, 30])
def test_what_is_behind_a_piece_takes_the_colour_the_picture_shows_through_its_gaps(room):
    grille = draw_grille(room)
    solved = solve_soft(grille.target, grille.pieces)
    backdrop = solved[1]["pixels"] / 255
    bars = np.zeros_like(backdrop)
    bars[room : 160 - room, room : 160 - room] = solved[0]["pixels"] / 255
    # The backdrop was drawn greener behind the bars than the picture has it.
    assert np.abs(grille.pieces[1]["pixels"][60:100, 60:100, :3] / 255 - grille.backdrop).max() > 0.2
    assert np.abs(backdrop[60:100, 60:100, :3] - grille.backdrop).max() < 0.04
    # A gap between two bars is clear, and so is the hole drawn nearly solid.
    assert bars[60:100, 70:74, 3].max() < 0.1
    assert bars[76:82, 76:82, 3].max() < 0.1
    inside = (slice(60, 100), slice(60, 100))
    assert percent_off(stacked_pieces(grille.pieces)[inside], grille.target[inside]) > 50
    assert percent_off(stacked_pieces(solved)[inside], grille.target[inside]) < 2


def test_a_backdrop_drawn_a_little_clear_keeps_its_alpha():
    target = np.full((40, 40, 3), 0.02, np.float32)
    backdrop = np.full((40, 40, 4), 240, np.uint8)
    backdrop[..., :3] = 60
    solved = solve_soft(target, [{"place": [0, 0, 40, 40], "pixels": backdrop}])[0]["pixels"]
    assert (solved[..., 3] == 240).all()


def test_the_backdrop_next_to_a_piece_in_front_keeps_what_the_split_drew():
    target = np.full((60, 120, 3), 0.76, np.float32)
    target[20:40, 30:90] = 0.1
    bar = np.zeros((20, 60, 4), np.uint8)
    bar[...] = (26, 26, 26, 255)
    backdrop = np.full((60, 120, 4), 255, np.uint8)
    backdrop[..., :3] = 204
    pieces = [{"place": [30, 20, 60, 20], "pixels": bar}, {"place": [0, 0, 120, 60], "pixels": backdrop}]
    solved = solve_soft(target, pieces)[1]["pixels"]
    # Beside the bar the backdrop stays as drawn, so the bar leaves no outline; far from it, it is the picture.
    assert solved[30, 27, 0] == 204
    assert solved[30, 5, 0] == 194


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


def test_a_split_waits_through_a_comfyui_that_goes_quiet_while_it_runs_the_graph(monkeypatch):
    done = {"p1": {"status": {"completed": True}, "outputs": {"saved": {"images": [{"filename": "a.png"}]}}}}
    answers = [{"prompt_id": "p1"}, urllib.error.URLError(TimeoutError("timed out")), TimeoutError("timed out"), done]

    def urlopen(_request, timeout):
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return io.BytesIO(json.dumps(answer).encode())

    monkeypatch.setattr(app.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(app.time, "sleep", lambda _seconds: None)
    assert app.run_graph({}) == [{"filename": "a.png"}]
    assert answers == []


@pytest.mark.parametrize(
    "failure",
    [
        urllib.error.HTTPError("http://x", 500, "broken", None, io.BytesIO(b"why")),
        urllib.error.URLError(ConnectionRefusedError("refused")),
    ],
)
def test_a_split_fails_at_once_when_comfyui_answers_an_error_or_is_gone(monkeypatch, failure):
    answers = [{"prompt_id": "p1"}, failure]

    def urlopen(_request, timeout):
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return io.BytesIO(json.dumps(answer).encode())

    monkeypatch.setattr(app.urllib.request, "urlopen", urlopen)
    with pytest.raises(RuntimeError, match="ComfyUI"):
        app.run_graph({})
    assert answers == []


def test_a_split_fails_once_comfyui_has_been_quiet_too_long(monkeypatch):
    clock = iter(range(0, 10_000, 100))

    def urlopen(request, timeout):
        if not isinstance(request, str):
            return io.BytesIO(json.dumps({"prompt_id": "p1"}).encode())
        raise TimeoutError("timed out")

    monkeypatch.setattr(app.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(app.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(app.time, "monotonic", lambda: next(clock))
    with pytest.raises(RuntimeError, match="stopped answering"):
        app.run_graph({})


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


def draw_diamond() -> SimpleNamespace:
    """A tall picture of one square turned 45 degrees on a plain backdrop, with its two split layers at a working
    size of another shape than the picture: its picture, parts and layers, the square's bounds and its side."""
    width, height, working = 400, 712, (384, 680)
    centre, reach = (200, 300), 90
    corners = [(centre[0], centre[1] - reach), (centre[0] + reach, centre[1])]
    corners += [(centre[0], centre[1] + reach), (centre[0] - reach, centre[1])]
    drawn = np.zeros((height, width), np.uint8)
    cv2.fillPoly(drawn, [np.array(corners, np.int32)], 255)
    diamond = drawn.astype(np.float32) / 255
    backdrop = np.full((height, width, 3), (0.9, 0.88, 0.8), np.float32)
    colour = np.array([0.2, 0.5, 0.3], np.float32)
    picture = colour * diamond[..., None] + backdrop * (1 - diamond[..., None])

    small = cv2.resize(diamond, working, interpolation=cv2.INTER_AREA)
    front = np.concatenate([np.broadcast_to(colour, small.shape + (3,)), small[..., None]], axis=2)
    back = np.concatenate([cv2.resize(backdrop, working), np.ones(small.shape + (1,), np.float32)], axis=2)
    parts = [
        {"id": "diamond", "kind": "graphic", "shadow": "none", "layer": 1, "box": grid_box(diamond)},
        {"id": "backdrop", "kind": "background", "shadow": "none", "layer": 2, "box": grid_box(np.ones_like(diamond))},
    ]
    return SimpleNamespace(
        picture=as_picture(picture),
        parts=parts,
        layers=as_saved([blurred(front), back]),
        bounds=bounds(diamond > 0.5),
        side=reach * 2**0.5,
    )


def draw_thin() -> SimpleNamespace:
    """A picture of small text and of a dot with a thin line from it, on a plain backdrop, split at half its
    size: the thin strokes come back pale and soft. Its picture, parts and layers, each part's mask and colour as
    drawn, and for each part the pixels around its thin strokes."""
    working = SIZE // 2
    colours = {"caption": np.array([0.05, 0.1, 0.3], np.float32), "route": np.array([0.1, 0.5, 0.2], np.float32)}

    def route(big: np.ndarray) -> None:
        cv2.circle(big, (240, 600), 70, 255, -1)
        cv2.line(big, (240, 600), (860, 760), 255, 10)

    masks = {"caption": mask(lambda big: bars(big, 120, 100, 14, 3, 14, 5)), "route": mask(route)}
    line_only = mask(lambda big: cv2.line(big, (340, 626), (860, 760), 255, 10))
    thin = {
        "caption": cv2.dilate(masks["caption"], np.ones((9, 9))) > 0,
        "route": cv2.dilate(line_only, np.ones((9, 9))) > 0,
    }
    backdrop = np.full((SIZE, SIZE, 3), (0.97, 0.96, 0.93), np.float32)
    picture = backdrop.copy()
    layers = []
    for part in ("route", "caption"):
        picture = colours[part] * masks[part][..., None] + picture * (1 - masks[part][..., None])
    for part in ("caption", "route"):
        small = cv2.resize(masks[part], (working, working), interpolation=cv2.INTER_AREA)
        layers.append(
            blurred(np.concatenate([np.broadcast_to(colours[part], small.shape + (3,)), small[..., None]], 2))
        )
        # A thin stroke is drawn mixed with what is behind it.
        layers[-1][..., :3] += (1 - layers[-1][..., 3:4]) * (backdrop[:working, :working] - layers[-1][..., :3]) * 0.6
    layers.append(np.concatenate([backdrop[:working, :working], np.ones((working, working, 1), np.float32)], 2))
    parts = [
        {"id": "caption", "kind": "text", "shadow": "none", "layer": 1, "box": grid_box(masks["caption"])},
        {"id": "route", "kind": "graphic", "shadow": "none", "layer": 2, "box": grid_box(masks["route"])},
        {"id": "backdrop", "kind": "background", "shadow": "none", "layer": 3, "box": grid_box(np.ones((SIZE, SIZE)))},
    ]
    return SimpleNamespace(
        picture=as_picture(picture), parts=parts, layers=as_saved(layers), masks=masks, colours=colours, thin=thin
    )


def draw_soft() -> SimpleNamespace:
    """A picture of a grainy disc on a plain backdrop with a shadow band above it, and its pieces as the split
    model draws them: the disc blurred, the shadow twice as strong as it is. The picture as float RGB and the
    pieces front to back, the backdrop last."""
    size = 160
    grain = cv2.GaussianBlur(np.random.default_rng(5).random((size, size, 3)).astype(np.float32), (0, 0), 1)
    disc = np.zeros((size, size), np.uint8)
    cv2.circle(disc, (2 * 80, 2 * 100), 2 * 40, 255, -1, shift=1)
    disc = cv2.GaussianBlur(disc.astype(np.float32) / 255, (0, 0), 0.7)
    backdrop = np.full((size, size, 3), (0.9, 0.85, 0.6), np.float32)
    target = backdrop.copy()
    target[20:40, 20:100] *= 0.75
    target = grain * disc[..., None] + target * (1 - disc[..., None])
    drawn = blurred(np.concatenate([cv2.GaussianBlur(grain, (0, 0), 2), disc[..., None]], axis=2))
    shadow = np.zeros((size, size, 4), np.float32)
    shadow[20:40, 20:100, 3] = 0.5
    full = np.concatenate([backdrop, np.ones((size, size, 1), np.float32)], axis=2)
    pieces = [
        {"place": [0, 0, size, size], "pixels": (layer * 255 + 0.5).astype(np.uint8)} for layer in (drawn, shadow, full)
    ]
    return SimpleNamespace(target=target, pieces=pieces)


def draw_grille(room: int = 0) -> SimpleNamespace:
    """A picture of dark upright bars on a plain backdrop, with a hole through two of them, and its two pieces as
    the split model draws them: the bars with a haze between them and the hole filled in, and the backdrop, greener
    behind the bars than it is. The picture as float RGB, the backdrop's true colour, and the pieces front to back;
    the bars' piece leaves `room` pixels of the picture free on every side.
    """
    size = 160
    true, greener, dark = (0.9, 0.85, 0.6), (0.65, 0.8, 0.35), (0.1, 0.1, 0.12)
    bars = np.zeros((size, size), np.float32)
    for left in range(40, 120, 12):
        bars[40:120, left : left + 4] = 1
    drawn = np.zeros((size, size, 4), np.float32)
    drawn[..., :3] = dark
    drawn[40:120, 40:120, 3] = 0.3
    drawn[..., 3] = np.maximum(drawn[..., 3], bars)
    drawn[76:82, 76:82, 3] = 0.9
    bars[76:82, 76:82] = 0
    target = np.asarray(dark, np.float32) * bars[..., None] + np.asarray(true, np.float32) * (1 - bars[..., None])
    backdrop = np.ones((size, size, 4), np.float32)
    backdrop[..., :3] = true
    backdrop[36:124, 36:124, :3] = greener
    pieces = [
        {"place": [0, 0, size, size], "pixels": (layer * 255 + 0.5).astype(np.uint8)} for layer in (drawn, backdrop)
    ]
    inner = size - 2 * room
    pieces[0] = {
        "place": [room, room, inner, inner],
        "pixels": pieces[0]["pixels"][room : size - room, room : size - room],
    }
    return SimpleNamespace(target=target, backdrop=np.asarray(true, np.float32), pieces=pieces)


def stacked_pieces(pieces: list[dict]) -> np.ndarray:
    """Pieces drawn over each other, back to front, as float RGB. The last one covers the whole picture."""
    stacked = np.zeros(pieces[-1]["pixels"].shape[:2] + (3,), np.float32)
    for piece in reversed(pieces):
        x, y, width, height = piece["place"]
        rgba = piece["pixels"].astype(np.float32) / 255
        under = stacked[y : y + height, x : x + width]
        stacked[y : y + height, x : x + width] = rgba[..., :3] * rgba[..., 3:4] + under * (1 - rgba[..., 3:4])
    return stacked


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
