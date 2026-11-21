"""PROTOTYPE, never merged. The quick command bar's tools, as Needle reads them.

Two turns: the first offers the five AREAS, the second only the picked area's tools (five or
fewer each, so Needle never retrieves among them). Every tool acts on the editor's current
selection; `DAZBEE` says which Dazbee command or editor action each call runs.
"""
import json

E = lambda *values: {"type": "string", "enum": list(values)}

AREAS = [
    {"name": "text_style",
     "description": "Change how text is set: bold, light or other weights, italic, underline, "
                    "strikethrough, capitals (all caps, uppercase, lowercase, title case), aligning "
                    "the lines of a text left, center, right or justified, letter spacing and line spacing.",
     "parameters": {"type": "object", "properties": {}, "required": []}},
    {"name": "size_and_shape",
     "description": "Change size, turn and shape: make it bigger or smaller, larger or "
                    "tinier, scale it, set the font size, rotate or turn it, flip or mirror it, "
                    "round the corners or make them square.",
     "parameters": {"type": "object", "properties": {}, "required": []}},
    {"name": "colour_and_brand",
     "description": "Change colour and see-through: a named colour such as red or blue, a hex "
                    "code, the brand kit's colours (primary, secondary, accent, background, text) "
                    "and fonts (heading, body), opacity and transparency.",
     "parameters": {"type": "object", "properties": {}, "required": []}},
    {"name": "arrange",
     "description": "Line up, space out and order layers: align them left, center, right, top, "
                    "middle or bottom, distribute or spread them evenly, bring forward or send "
                    "back, move or nudge them up, down, left or right.",
     "parameters": {"type": "object", "properties": {}, "required": []}},
    {"name": "layers",
     "description": "Copy, duplicate, delete, remove, group, ungroup, lock, unlock, hide or show "
                    "the selected layers.",
     "parameters": {"type": "object", "properties": {}, "required": []}},
]


def tool(name, description, properties=None, required=None):
    properties = properties or {}
    return {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties,
                           "required": list(properties) if required is None else required}}


ACTIONS = {
    "text_style": [
        tool("set_text_weight", "Make text bold, heavier, lighter or regular weight.",
             {"weight": {**E("thin", "light", "regular", "medium", "semibold", "bold", "black"),
                         "description": "How heavy the letters are; regular is normal, not bold."}}),
        tool("set_text_case", "Set text in all caps (uppercase), lowercase, title case, or back "
             "to normal case as typed.",
             {"case": {**E("uppercase", "lowercase", "title case", "normal"),
                       "description": "uppercase is all caps or capitals; normal is as typed."}}),
        tool("style_text", "Turn italic, underline or strikethrough on or off.",
             {"style": {**E("italic", "underline", "strikethrough"),
                        "description": "The text style; strikethrough is crossed out."},
              "on": {"type": "boolean", "description": "true to add the style, false to remove it."}}),
        tool("align_text", "Align the lines of a text inside its own box: left, center, right "
             "or justified.",
             {"align": {**E("left", "center", "right", "justify"),
                        "description": "Where each line of the text sits in its box."}}),
        tool("change_spacing", "Loosen or tighten the space between letters (letter spacing, "
             "tracking) or between lines (line spacing, leading).",
             {"spacing": {**E("letter spacing", "line spacing"), "description": "Which space."},
              "direction": {**E("more", "less"),
                            "description": "more is looser or wider, less is tighter."}}),
    ],
    "size_and_shape": [
        tool("resize", "Make the selection bigger or smaller, by a percentage when one is "
             "given; for text this is its font size.",
             {"direction": {**E("bigger", "smaller"),
                            "description": "bigger is larger or scale up; smaller is scale down."},
              "percent": {"type": "integer", "minimum": 1, "maximum": 400,
                          "description": "How much, as a percentage, e.g. 20."}},
             required=["direction"]),
        tool("set_font_size", "Set the font size of text to a number, in pixels or points.",
             {"size": {"type": "integer", "minimum": 1, "maximum": 1000,
                       "description": "The font size, e.g. 48."}}),
        tool("rotate", "Rotate or turn the selection by a number of degrees; negative turns "
             "it anticlockwise (counterclockwise, to the left).",
             {"degrees": {"type": "integer", "minimum": -360, "maximum": 360,
                          "description": "Degrees to turn, e.g. 90 or -45."}}),
        tool("flip", "Flip or mirror the selection: horizontal swaps left and right, vertical "
             "turns it upside down.",
             {"axis": {**E("horizontal", "vertical"), "description": "Which way to mirror."}}),
        tool("round_corners", "Round the corners by a radius in pixels; 0 makes them square "
             "or sharp.",
             {"radius": {"type": "integer", "minimum": 0, "maximum": 1000, "default": 16,
                         "description": "Corner radius in pixels, e.g. 16."}}),
    ],
    "colour_and_brand": [
        tool("use_brand_colour", "Colour the selection with one of the brand kit's colours.",
             {"role": {**E("primary", "secondary", "accent", "background", "text"),
                       "description": "The brand colour's role in the kit."}}),
        tool("set_colour", "Colour the selection with a plain named colour.",
             {"colour": {**E("red", "orange", "yellow", "green", "teal", "blue", "navy",
                             "purple", "pink", "brown", "black", "white", "grey", "gold"),
                         "description": "The colour's name; gray is grey."}}),
        tool("set_hex_colour", "Colour the selection with an exact hex colour code.",
             {"hex": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$",
                      "description": "The hex code with its #, e.g. #1A2B3C."}}),
        tool("set_opacity", "Set how see-through the selection is, as a percentage of opacity "
             "or of transparency.",
             {"percent": {"type": "integer", "minimum": 0, "maximum": 100,
                          "description": "The percentage the request names, e.g. 50."},
              "measure": {**E("opacity", "transparency"),
                          "description": "opacity when the number is how solid it is, "
                                         "transparency when it is how see-through it is."}}),
        tool("use_brand_font", "Set text in one of the brand kit's fonts.",
             {"font": {**E("heading", "body"), "description": "The brand font's role in the kit."}}),
    ],
    "arrange": [
        tool("align_layers", "Line up the selected layers along an edge or a center line; one "
             "layer lines up with its frame.",
             {"edge": {**E("left", "center", "right", "top", "middle", "bottom"),
                       "description": "center lines up across, middle lines up down the page."}}),
        tool("distribute_layers", "Spread the selected layers out with even gaps, across or down.",
             {"direction": {**E("horizontally", "vertically"),
                            "description": "horizontally is across, side by side; vertically is down."}}),
        tool("change_layer_order", "Bring the selection forward or send it backward a step, or "
             "all the way to the front or the back.",
             {"to": {**E("forward", "backward", "front", "back"),
                     "description": "front is on top of everything; back is behind everything."}}),
        tool("move_layers", "Move or nudge the selection up, down, left or right by pixels.",
             {"direction": {**E("left", "right", "up", "down"), "description": "Which way."},
              "pixels": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 10,
                         "description": "How far in pixels, e.g. 10."}}),
    ],
    "layers": [
        tool("duplicate_layers", "Duplicate or copy the selection, the copy right above it."),
        tool("delete_layers", "Delete or remove the selection."),
        tool("group_layers", "Group the selected layers together, or ungroup them.",
             {"action": {**E("group", "ungroup"), "description": "group or ungroup."}}),
        tool("lock_layers", "Lock the selection so it cannot be changed, or unlock it.",
             {"action": {**E("lock", "unlock"), "description": "lock or unlock."}}),
        tool("hide_layers", "Hide the selection, or show it again.",
             {"action": {**E("hide", "show"), "description": "hide or show."}}),
    ],
}

AREA_OF = {t["name"]: area for area, tools in ACTIONS.items() for t in tools}
TOOL = {t["name"]: t for tools in ACTIONS.values() for t in tools}

# What each call runs in Dazbee, on the selection, as one undo step (packages/doc commands and
# packages/editor actions as on main).
DAZBEE = {
    "set_text_weight": "node.style {text: {fontWeight: thin 100, light 300, regular 400, medium 500, semibold 600, bold 700, black 900}}",
    "set_text_case": "node.style {text: {textCase: upper | lower | title | none}}",
    "style_text": "node.style {text: {fontStyle: italic|normal}} or {text: {underline}} or {text: {strikethrough}}",
    "align_text": "node.update {patch: {align: start | center | end | justify}} on text layers",
    "change_spacing": "node.style {text: {letterSpacing: +/-2 percent}} or {text: {lineHeight: x1.15 or /1.15}}",
    "resize": "node.update: text layers {style.fontSize x (1 +/- percent/100)}, other layers width and height about the centre; percent defaults to 20",
    "set_font_size": "node.update {patch: {style: {fontSize}}} on text layers (as the edit panel's size field)",
    "rotate": "node.update {patch: {rotation: current + degrees}}",
    "flip": "editor action flipHorizontal | flipVertical (node.flip)",
    "round_corners": "node.style {corners: radius}",
    "use_brand_colour": "node.bind {property: textColor for text layers else fill, ref: brand:<role>, value: the kit's colour}",
    "set_colour": "node.style {fills: [solid colour]} or {text: {color}} for text layers; names map to a fixed palette",
    "set_hex_colour": "as set_colour, with the hex given (alpha FF)",
    "set_opacity": "node.style {opacity: percent/100}, or 1 - percent/100 for transparency",
    "use_brand_font": "node.bind {property: fontFamily, ref: brand:heading | brand:body, value: the kit's family}",
    "align_layers": "editor action alignLeft | alignCentre | alignRight | alignTop | alignMiddle | alignBottom",
    "distribute_layers": "editor action distributeHorizontal | distributeVertical",
    "change_layer_order": "node.reorder {to: forward | backward | front | back}",
    "move_layers": "the arrow-key nudge (editor nudge) by pixels in the direction",
    "duplicate_layers": "editor action duplicate (node.duplicate)",
    "delete_layers": "editor action delete (node.delete)",
    "group_layers": "editor action group (node.group) | ungroup (node.ungroup)",
    "lock_layers": "node.lock with every flag true (lock) or false (unlock)",
    "hide_layers": "editor action hide (node.update visible false/true)",
}

assert all(len(tools) <= 5 for tools in ACTIONS.values()) and len(AREAS) <= 5
assert set(DAZBEE) == set(TOOL)

if __name__ == "__main__":
    print(json.dumps({"areas": AREAS, "actions": ACTIONS}, indent=1))
    print(len(TOOL), "tools in", len(AREAS), "areas")
