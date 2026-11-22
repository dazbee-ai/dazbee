"""PROTOTYPE, never merged. The tool schemas round 2 tries on Needle, each with the way its calls
turn back into round 1's calls (tools.py), the form the scores are taken in.

  r1     round 1's two turns: five areas, then the area's four or five tools.
  words  the same two turns, renamed in the words people type: no shared name prefixes
         (set_, use_, _layers), no area named after a word nearly every request holds ("text"),
         enum options as people say them, defaults for values people leave out.
  flat24 one turn with all 24 of round 1's tools in one engine (Needle then retrieves five).
  one    one turn, five tools, one engine: each tool picks the edit from an enum and takes an
         optional number; every outcome is reachable without a router.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from tools import ACTIONS as R1_ACTIONS, AREAS as R1_AREAS  # noqa: E402

E = lambda *values: {"type": "string", "enum": list(values)}
NOARGS = {"type": "object", "properties": {}, "required": []}


def tool(name, description, properties=None, required=None):
    properties = properties or {}
    return {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties,
                           "required": list(properties) if required is None else required}}


# ---------------------------------------------------------------- words
WORDS_AREAS = [
    {"name": "font_style", "description": "Bold, light or regular weight, italic, underline, "
     "strikethrough, all caps, lowercase, title case, text alignment left/center/right/justify, "
     "letter spacing (tracking) and line spacing (leading, line height) of a text.",
     "parameters": NOARGS},
    {"name": "resize_rotate", "description": "Bigger or smaller, scale up or down, font size as a "
     "number, rotate or tilt by degrees, flip or mirror, rounded or square corners.",
     "parameters": NOARGS},
    {"name": "recolour", "description": "A named colour like red or navy, a hex code, the brand "
     "kit's colours (primary, secondary, accent, background, text) or fonts (heading, body), "
     "opacity and transparency.", "parameters": NOARGS},
    {"name": "align_move", "description": "Line layers up (left, center, right, top, middle, "
     "bottom), spread them evenly, bring to front or send to back, move or nudge them.",
     "parameters": NOARGS},
    {"name": "duplicate_delete", "description": "Copy or duplicate, delete or remove, group or "
     "ungroup, lock or unlock, hide or show.", "parameters": NOARGS},
]
WORDS_ACTIONS = {
    "font_style": [
        tool("weight", "Font weight: bold, or back to regular (unbold), light, thin, medium, "
             "semibold, black.", {"weight": {**E("bold", "regular", "light", "thin", "medium",
                                                 "semibold", "black"), "default": "bold",
                                              "description": "regular removes bold."}}, required=[]),
        tool("capitals", "All caps, lowercase, title case, or back to the case as typed.",
             {"case": {**E("all caps", "lowercase", "title case", "as typed"),
                       "description": "as typed removes caps."}}),
        tool("italic_underline_strike", "Turn italic, underline or strikethrough on, or off.",
             {"style": E("italic", "underline", "strikethrough"),
              "on": {"type": "boolean", "default": True, "description": "false removes it."}},
             required=["style"]),
        tool("text_alignment", "Where the lines of a text sit in their box.",
             {"align": E("left", "center", "right", "justify")}),
        tool("spacing", "Space between letters (tracking) or between lines (leading, line height).",
             {"between": E("letters", "lines"),
              "change": {**E("more", "less"), "description": "more is looser, less is tighter."}}),
    ],
    "resize_rotate": [
        tool("scale", "Make it bigger or smaller, by a percent when given.",
             {"direction": E("bigger", "smaller"),
              "percent": {"type": "integer", "minimum": 1, "maximum": 400, "default": 20}},
             required=["direction"]),
        tool("font_size", "Set a text's font size to a number of pixels or points.",
             {"size": {"type": "integer", "minimum": 1, "maximum": 1000}}),
        tool("rotate", "Rotate by degrees: positive clockwise, negative anticlockwise (to the left).",
             {"degrees": {"type": "integer", "minimum": -360, "maximum": 360}}),
        tool("mirror", "Flip or mirror: left to right, or upside down.",
             {"axis": E("left to right", "upside down")}),
        tool("corners", "Corner radius in pixels; 0 is square or sharp.",
             {"radius": {"type": "integer", "minimum": 0, "maximum": 1000, "default": 16}},
             required=[]),
    ],
    "recolour": [
        tool("brand_colour", "A colour from the brand kit.",
             {"role": E("primary", "secondary", "accent", "background", "text")}),
        tool("colour", "A plain named colour.",
             {"name": E("red", "orange", "yellow", "green", "teal", "blue", "navy", "purple",
                        "pink", "brown", "black", "white", "grey", "gold")}),
        tool("hex_code", "An exact hex colour code like #1A2B3C.",
             {"hex": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"}}),
        tool("opacity", "How solid (opacity) or see-through (transparent) as a percent.",
             {"percent": {"type": "integer", "minimum": 0, "maximum": 100},
              "measure": {**E("opacity", "transparent"), "default": "opacity"}},
             required=["percent"]),
        tool("typeface", "The brand kit's heading or body font.",
             {"font": E("heading", "body")}),
    ],
    "align_move": [
        tool("align", "Line the selected layers up along an edge or center line.",
             {"edge": {**E("left", "center", "right", "top", "middle", "bottom"),
                       "description": "center is across, middle is vertical."}}),
        tool("distribute", "Spread layers out with even gaps.",
             {"direction": E("across", "down")}),
        tool("stack_order", "Bring forward or send backward a step, or to the very front or back.",
             {"to": E("forward", "backward", "front", "back")}),
        tool("nudge", "Move by pixels.",
             {"direction": E("left", "right", "up", "down"),
              "pixels": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 10}},
             required=["direction"]),
    ],
    "duplicate_delete": [
        tool("duplicate", "Copy or duplicate it."),
        tool("delete", "Delete or remove it."),
        tool("grouping", "Group or ungroup.", {"action": E("group", "ungroup")}),
        tool("locking", "Lock so it can't change, or unlock.", {"action": E("lock", "unlock")}),
        tool("visibility", "Hide, or show again.", {"action": E("hide", "show")}),
    ],
}


def words_to_r1(call):
    n, a = call["name"], dict(call.get("arguments") or {})
    m = {
        "weight": lambda: ("set_text_weight", {"weight": a.get("weight", "bold")}),
        "capitals": lambda: ("set_text_case", {"case": {"all caps": "uppercase", "as typed": "normal"}.get(a.get("case"), a.get("case"))}),
        "italic_underline_strike": lambda: ("style_text", {"style": a.get("style"), "on": a.get("on", True)}),
        "text_alignment": lambda: ("align_text", {"align": a.get("align")}),
        "spacing": lambda: ("change_spacing", {"spacing": {"letters": "letter spacing", "lines": "line spacing"}.get(a.get("between")), "direction": a.get("change")}),
        "scale": lambda: ("resize", {"direction": a.get("direction"), "percent": a.get("percent", 20)}),
        "font_size": lambda: ("set_font_size", {"size": a.get("size")}),
        "rotate": lambda: ("rotate", {"degrees": a.get("degrees")}),
        "mirror": lambda: ("flip", {"axis": {"left to right": "horizontal", "upside down": "vertical"}.get(a.get("axis"))}),
        "corners": lambda: ("round_corners", {"radius": a.get("radius", 16)}),
        "brand_colour": lambda: ("use_brand_colour", {"role": a.get("role")}),
        "colour": lambda: ("set_colour", {"colour": a.get("name")}),
        "hex_code": lambda: ("set_hex_colour", {"hex": a.get("hex")}),
        "opacity": lambda: ("set_opacity", {"percent": a.get("percent"), "measure": {"transparent": "transparency"}.get(a.get("measure", "opacity"), "opacity")}),
        "typeface": lambda: ("use_brand_font", {"font": a.get("font")}),
        "align": lambda: ("align_layers", {"edge": a.get("edge")}),
        "distribute": lambda: ("distribute_layers", {"direction": {"across": "horizontally", "down": "vertically"}.get(a.get("direction"))}),
        "stack_order": lambda: ("change_layer_order", {"to": a.get("to")}),
        "nudge": lambda: ("move_layers", {"direction": a.get("direction"), "pixels": a.get("pixels", 10)}),
        "duplicate": lambda: ("duplicate_layers", {}),
        "delete": lambda: ("delete_layers", {}),
        "grouping": lambda: ("group_layers", {"action": a.get("action")}),
        "locking": lambda: ("lock_layers", {"action": a.get("action")}),
        "visibility": lambda: ("hide_layers", {"action": a.get("action")}),
    }
    if n not in m:
        return []
    name, args = m[n]()
    return [{"name": name, "arguments": args}]


# ---------------------------------------------------------------- one
TEXT_CHANGES = {
    "bold": ("set_text_weight", {"weight": "bold"}), "regular weight": ("set_text_weight", {"weight": "regular"}),
    "light weight": ("set_text_weight", {"weight": "light"}), "thin weight": ("set_text_weight", {"weight": "thin"}),
    "medium weight": ("set_text_weight", {"weight": "medium"}), "semibold": ("set_text_weight", {"weight": "semibold"}),
    "black weight": ("set_text_weight", {"weight": "black"}),
    "all caps": ("set_text_case", {"case": "uppercase"}), "lowercase": ("set_text_case", {"case": "lowercase"}),
    "title case": ("set_text_case", {"case": "title case"}), "case as typed": ("set_text_case", {"case": "normal"}),
    "italic": ("style_text", {"style": "italic", "on": True}), "no italic": ("style_text", {"style": "italic", "on": False}),
    "underline": ("style_text", {"style": "underline", "on": True}), "no underline": ("style_text", {"style": "underline", "on": False}),
    "strikethrough": ("style_text", {"style": "strikethrough", "on": True}),
    "no strikethrough": ("style_text", {"style": "strikethrough", "on": False}),
    "align left": ("align_text", {"align": "left"}), "align center": ("align_text", {"align": "center"}),
    "align right": ("align_text", {"align": "right"}), "justify": ("align_text", {"align": "justify"}),
    "more letter spacing": ("change_spacing", {"spacing": "letter spacing", "direction": "more"}),
    "less letter spacing": ("change_spacing", {"spacing": "letter spacing", "direction": "less"}),
    "more line spacing": ("change_spacing", {"spacing": "line spacing", "direction": "more"}),
    "less line spacing": ("change_spacing", {"spacing": "line spacing", "direction": "less"}),
    "brand heading font": ("use_brand_font", {"font": "heading"}), "brand body font": ("use_brand_font", {"font": "body"}),
}
SIZE_CHANGES = ["bigger", "smaller", "font size", "rotate clockwise", "rotate anticlockwise",
                "flip left to right", "flip upside down", "round corners", "square corners"]
COLOURS = ["red", "orange", "yellow", "green", "teal", "blue", "navy", "purple", "pink", "brown",
           "black", "white", "grey", "gold"]
COLOUR_CHANGES = COLOURS + ["brand primary", "brand secondary", "brand accent", "brand background",
                            "brand text", "hex code", "opacity", "transparency"]
ARRANGE_CHANGES = {"align left": ("align_layers", {"edge": "left"}), "align center": ("align_layers", {"edge": "center"}),
                   "align right": ("align_layers", {"edge": "right"}), "align top": ("align_layers", {"edge": "top"}),
                   "align middle": ("align_layers", {"edge": "middle"}), "align bottom": ("align_layers", {"edge": "bottom"}),
                   "spread evenly across": ("distribute_layers", {"direction": "horizontally"}),
                   "spread evenly down": ("distribute_layers", {"direction": "vertically"}),
                   "forward one": ("change_layer_order", {"to": "forward"}), "backward one": ("change_layer_order", {"to": "backward"}),
                   "to front": ("change_layer_order", {"to": "front"}), "to back": ("change_layer_order", {"to": "back"}),
                   "move left": None, "move right": None, "move up": None, "move down": None}
LAYER_ACTIONS = {"duplicate": ("duplicate_layers", {}), "delete": ("delete_layers", {}),
                 "group": ("group_layers", {"action": "group"}), "ungroup": ("group_layers", {"action": "ungroup"}),
                 "lock": ("lock_layers", {"action": "lock"}), "unlock": ("lock_layers", {"action": "unlock"}),
                 "hide": ("hide_layers", {"action": "hide"}), "show": ("hide_layers", {"action": "show"})}

ONE_TOOLS = [
    tool("style_text", "Text styling: weight (bold, regular, light...), caps, italic, underline, "
         "strikethrough, text alignment, letter or line spacing, brand fonts.",
         {"change": E(*TEXT_CHANGES)}),
    tool("resize_rotate", "Size, font size, rotation, flip, corners. amount: percent for "
         "bigger/smaller (default 20), pixels for font size or corners, degrees for rotate.",
         {"change": E(*SIZE_CHANGES),
          "amount": {"type": "integer", "minimum": 0, "maximum": 1000}}, required=["change"]),
    tool("recolour", "Colour, brand colours, hex code, opacity or transparency (percent).",
         {"colour": E(*COLOUR_CHANGES),
          "hex": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
          "percent": {"type": "integer", "minimum": 0, "maximum": 100}}, required=["colour"]),
    tool("arrange", "Align, spread evenly, layer order, move or nudge by pixels (default 10).",
         {"change": E(*ARRANGE_CHANGES),
          "pixels": {"type": "integer", "minimum": 1, "maximum": 5000}}, required=["change"]),
    tool("layer", "Duplicate, delete, group, ungroup, lock, unlock, hide or show the selection.",
         {"action": E(*LAYER_ACTIONS)}),
]


def one_to_r1(call):
    n, a = call["name"], call.get("arguments") or {}
    if n == "style_text" and a.get("change") in TEXT_CHANGES:
        name, args = TEXT_CHANGES[a["change"]]
        return [{"name": name, "arguments": dict(args)}]
    if n == "resize_rotate":
        c, k = a.get("change"), a.get("amount")
        if c in ("bigger", "smaller"):
            return [{"name": "resize", "arguments": {"direction": c, "percent": k if k else 20}}]
        if c == "font size" and k:
            return [{"name": "set_font_size", "arguments": {"size": k}}]
        if c in ("rotate clockwise", "rotate anticlockwise") and k:
            return [{"name": "rotate", "arguments": {"degrees": k if c == "rotate clockwise" else -k}}]
        if c in ("flip left to right", "flip upside down"):
            return [{"name": "flip", "arguments": {"axis": "horizontal" if c == "flip left to right" else "vertical"}}]
        if c == "round corners":
            return [{"name": "round_corners", "arguments": {"radius": k if k else 16}}]
        if c == "square corners":
            return [{"name": "round_corners", "arguments": {"radius": 0}}]
        return []
    if n == "recolour":
        c = a.get("colour")
        if c in COLOURS:
            return [{"name": "set_colour", "arguments": {"colour": c}}]
        if c and c.startswith("brand "):
            return [{"name": "use_brand_colour", "arguments": {"role": c[6:]}}]
        if c == "hex code" and a.get("hex"):
            return [{"name": "set_hex_colour", "arguments": {"hex": a["hex"]}}]
        if c in ("opacity", "transparency") and a.get("percent") is not None:
            return [{"name": "set_opacity", "arguments": {"percent": a["percent"], "measure": c}}]
        return []
    if n == "arrange" and a.get("change") in ARRANGE_CHANGES:
        c = a["change"]
        if c.startswith("move "):
            return [{"name": "move_layers", "arguments": {"direction": c[5:], "pixels": a.get("pixels") or 10}}]
        name, args = ARRANGE_CHANGES[c]
        return [{"name": name, "arguments": dict(args)}]
    if n == "layer" and a.get("action") in LAYER_ACTIONS:
        name, args = LAYER_ACTIONS[a["action"]]
        return [{"name": name, "arguments": dict(args)}]
    return []


def r1_to_one(call):
    """Round 1's call in the one-turn schema (for training rows)."""
    if not call:
        return None
    n, a = call["name"], call["arguments"]
    for k, (name, args) in TEXT_CHANGES.items():
        if name == n and args == {kk: a.get(kk) for kk in args}:
            return {"name": "style_text", "arguments": {"change": k}}
    if n == "resize":
        out = {"change": a["direction"]}
        if a.get("percent") not in (None, 20):
            out["amount"] = a["percent"]
        return {"name": "resize_rotate", "arguments": out}
    if n == "set_font_size":
        return {"name": "resize_rotate", "arguments": {"change": "font size", "amount": a["size"]}}
    if n == "rotate":
        d = a["degrees"]
        return {"name": "resize_rotate", "arguments": {"change": "rotate clockwise" if d > 0 else "rotate anticlockwise", "amount": abs(d)}}
    if n == "flip":
        return {"name": "resize_rotate", "arguments": {"change": "flip left to right" if a["axis"] == "horizontal" else "flip upside down"}}
    if n == "round_corners":
        r = a.get("radius", 16)
        if r == 0:
            return {"name": "resize_rotate", "arguments": {"change": "square corners"}}
        return {"name": "resize_rotate", "arguments": {"change": "round corners", **({"amount": r} if r != 16 else {})}}
    if n == "set_colour":
        return {"name": "recolour", "arguments": {"colour": a["colour"]}}
    if n == "use_brand_colour":
        return {"name": "recolour", "arguments": {"colour": "brand " + a["role"]}}
    if n == "set_hex_colour":
        return {"name": "recolour", "arguments": {"colour": "hex code", "hex": a["hex"]}}
    if n == "set_opacity":
        return {"name": "recolour", "arguments": {"colour": a["measure"], "percent": a["percent"]}}
    if n == "move_layers":
        out = {"change": "move " + a["direction"]}
        if a.get("pixels", 10) != 10:
            out["pixels"] = a["pixels"]
        return {"name": "arrange", "arguments": out}
    for k, v in ARRANGE_CHANGES.items():
        if v and v[0] == n and v[1] == a:
            return {"name": "arrange", "arguments": {"change": k}}
    for k, (name, args) in LAYER_ACTIONS.items():
        if name == n and args == a:
            return {"name": "layer", "arguments": {"action": k}}
    raise ValueError(call)


def r1_to_words(call):
    """Round 1's call in the words schema (for training rows)."""
    if not call:
        return None
    n, a = call["name"], call["arguments"]
    inv = {
        "set_text_weight": lambda: ("weight", {"weight": a["weight"]}),
        "set_text_case": lambda: ("capitals", {"case": {"uppercase": "all caps", "normal": "as typed"}.get(a["case"], a["case"])}),
        "style_text": lambda: ("italic_underline_strike", {"style": a["style"], "on": a["on"]}),
        "align_text": lambda: ("text_alignment", {"align": a["align"]}),
        "change_spacing": lambda: ("spacing", {"between": "letters" if a["spacing"] == "letter spacing" else "lines", "change": a["direction"]}),
        "resize": lambda: ("scale", {"direction": a["direction"], **({"percent": a["percent"]} if a.get("percent") not in (None, 20) else {})}),
        "set_font_size": lambda: ("font_size", {"size": a["size"]}),
        "rotate": lambda: ("rotate", {"degrees": a["degrees"]}),
        "flip": lambda: ("mirror", {"axis": "left to right" if a["axis"] == "horizontal" else "upside down"}),
        "round_corners": lambda: ("corners", {"radius": a.get("radius", 16)}),
        "use_brand_colour": lambda: ("brand_colour", {"role": a["role"]}),
        "set_colour": lambda: ("colour", {"name": a["colour"]}),
        "set_hex_colour": lambda: ("hex_code", {"hex": a["hex"]}),
        "set_opacity": lambda: ("opacity", {"percent": a["percent"], "measure": "opacity" if a["measure"] == "opacity" else "transparent"}),
        "use_brand_font": lambda: ("typeface", {"font": a["font"]}),
        "align_layers": lambda: ("align", {"edge": a["edge"]}),
        "distribute_layers": lambda: ("distribute", {"direction": "across" if a["direction"] == "horizontally" else "down"}),
        "change_layer_order": lambda: ("stack_order", {"to": a["to"]}),
        "move_layers": lambda: ("nudge", {"direction": a["direction"], **({"pixels": a["pixels"]} if a.get("pixels", 10) != 10 else {})}),
        "duplicate_layers": lambda: ("duplicate", {}),
        "delete_layers": lambda: ("delete", {}),
        "group_layers": lambda: ("grouping", {"action": a["action"]}),
        "lock_layers": lambda: ("locking", {"action": a["action"]}),
        "hide_layers": lambda: ("visibility", {"action": a["action"]}),
    }
    name, args = inv[n]()
    return {"name": name, "arguments": args}


WORDS_AREA_OF = {t["name"]: area for area, tools in WORDS_ACTIONS.items() for t in tools}
R1_AREA_OF = {t["name"]: area for area, tools in R1_ACTIONS.items() for t in tools}

SCHEMAS = {
    "r1": {"router": R1_AREAS, "areas": R1_ACTIONS, "to_r1": lambda c: [c], "from_r1": lambda c: c,
           "area_of": R1_AREA_OF},
    "words": {"router": WORDS_AREAS, "areas": WORDS_ACTIONS, "to_r1": words_to_r1, "from_r1": r1_to_words,
              "area_of": WORDS_AREA_OF},
    "flat24": {"router": None, "areas": {"all": [t for ts in R1_ACTIONS.values() for t in ts]},
               "to_r1": lambda c: [c], "from_r1": lambda c: c, "area_of": {}},
    "one": {"router": None, "areas": {"all": ONE_TOOLS}, "to_r1": one_to_r1, "from_r1": r1_to_one,
            "area_of": {t["name"]: "all" for t in ONE_TOOLS}},
}

assert all(len(t) <= 5 for k, s in SCHEMAS.items() if k != "flat24" for t in s["areas"].values())
