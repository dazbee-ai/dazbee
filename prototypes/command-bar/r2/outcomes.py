"""PROTOTYPE, never merged. Round 2's outcomes: what a request should do in the editor, apart
from how any model or tool schema writes it.

An outcome is a class (one of 84, or no call) plus, for some classes, a value (a number or a hex
code). `call_of` writes it as round 1's call (tools.py), the canonical form every model's answer
is turned into before scoring; `outcome_of` reads a round 1 call back. Defaults are filled in, so
"make it bigger" and "make it 20% bigger" are the same outcome, as they run the same command.

  python outcomes.py          checks the frozen test set and prints how many of each class
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

WEIGHTS = ["thin", "light", "regular", "medium", "semibold", "bold", "black"]
CASES = {"upper": "uppercase", "lower": "lowercase", "title": "title case", "normal": "normal"}
STYLES = {"it": "italic", "ul": "underline", "st": "strikethrough"}
TEXT_ALIGN = ["left", "center", "right", "justify"]
ROLES = ["primary", "secondary", "accent", "background", "text"]
COLOURS = ["red", "orange", "yellow", "green", "teal", "blue", "navy", "purple", "pink", "brown",
           "black", "white", "grey", "gold"]
EDGES = ["left", "center", "right", "top", "middle", "bottom"]
ORDER = ["forward", "backward", "front", "back"]
DIRS = ["left", "right", "up", "down"]
NOCALL = ["big", "unrel", "unsup", "vague", "neg", "multi"]

# Every class, in a fixed order (the classifier's label ids). A class ending in "#" takes a number
# (optional for big, small, rc, mv:*); "hex" takes a hex code.
CLASSES = ([f"w:{w}" for w in WEIGHTS] + [f"case:{c}" for c in CASES]
           + [f"{s}{o}" for s in STYLES for o in "+-"] + [f"ta:{a}" for a in TEXT_ALIGN]
           + ["ls+", "ls-", "lh+", "lh-"]
           + ["big", "small", "fs", "rot+", "rot-", "flipH", "flipV", "rc", "rc0"]
           + [f"brand:{r}" for r in ROLES] + [f"col:{c}" for c in COLOURS]
           + ["hex", "op", "tr", "font:heading", "font:body"]
           + [f"al:{e}" for e in EDGES] + ["dist:h", "dist:v"] + [f"order:{o}" for o in ORDER]
           + [f"mv:{d}" for d in DIRS]
           + ["dup", "del", "group", "ungroup", "lock", "unlock", "hide", "show"])
NONE = "none"
LABELS = CLASSES + [NONE]
NUMBERED = {"big", "small", "fs", "rot+", "rot-", "rc", "op", "tr"} | {f"mv:{d}" for d in DIRS}
NUMBER_NEEDED = {"fs", "rot+", "rot-", "op", "tr"}
DEFAULTS = {"big": 20, "small": 20, "rc": 16, **{f"mv:{d}": 10 for d in DIRS}}


def parse_code(code):
    """A test-file code -> (class, value). No-call codes -> ("none", category)."""
    if code.startswith("-"):
        assert code[1:] in NOCALL, code
        return NONE, code[1:]
    if code.startswith("hex:"):
        return "hex", code[4:].upper()
    m = re.match(r"^(big|small|fs|rot|rc|op|tr):(-?\d+)$", code)
    if m:
        k, n = m.group(1), int(m.group(2))
        if k == "rot":
            return ("rot+" if n > 0 else "rot-"), abs(n)
        if k == "rc" and n == 0:
            return "rc0", None
        return k, n
    m = re.match(r"^mv:(left|right|up|down)(?::(\d+))?$", code)
    if m:
        return f"mv:{m.group(1)}", int(m.group(2)) if m.group(2) else None
    assert code in CLASSES, code
    return code, None


def call_of(cls, value=None):
    """An outcome as round 1's call ([] for no call), defaults filled in."""
    if cls == NONE:
        return []
    if value is None and cls in DEFAULTS:
        value = DEFAULTS[cls]
    k, _, v = cls.partition(":")
    if k == "w":
        return [{"name": "set_text_weight", "arguments": {"weight": v}}]
    if k == "case":
        return [{"name": "set_text_case", "arguments": {"case": CASES[v]}}]
    if cls[:2] in STYLES and cls[2:] in ("+", "-"):
        return [{"name": "style_text", "arguments": {"style": STYLES[cls[:2]], "on": cls[2] == "+"}}]
    if k == "ta":
        return [{"name": "align_text", "arguments": {"align": v}}]
    if cls in ("ls+", "ls-", "lh+", "lh-"):
        return [{"name": "change_spacing", "arguments": {
            "spacing": "letter spacing" if cls[1] == "s" else "line spacing",
            "direction": "more" if cls[2] == "+" else "less"}}]
    if cls in ("big", "small"):
        return [{"name": "resize", "arguments": {"direction": "bigger" if cls == "big" else "smaller",
                                                  "percent": value}}]
    if cls == "fs":
        return [{"name": "set_font_size", "arguments": {"size": value}}]
    if cls in ("rot+", "rot-"):
        return [{"name": "rotate", "arguments": {"degrees": value if cls == "rot+" else -value}}]
    if cls in ("flipH", "flipV"):
        return [{"name": "flip", "arguments": {"axis": "horizontal" if cls == "flipH" else "vertical"}}]
    if cls == "rc":
        return [{"name": "round_corners", "arguments": {"radius": value}}]
    if cls == "rc0":
        return [{"name": "round_corners", "arguments": {"radius": 0}}]
    if k == "brand":
        return [{"name": "use_brand_colour", "arguments": {"role": v}}]
    if k == "col":
        return [{"name": "set_colour", "arguments": {"colour": v}}]
    if cls == "hex":
        return [{"name": "set_hex_colour", "arguments": {"hex": value.upper()}}]
    if cls in ("op", "tr"):
        return [{"name": "set_opacity", "arguments": {
            "percent": value, "measure": "opacity" if cls == "op" else "transparency"}}]
    if k == "font":
        return [{"name": "use_brand_font", "arguments": {"font": v}}]
    if k == "al":
        return [{"name": "align_layers", "arguments": {"edge": v}}]
    if k == "dist":
        return [{"name": "distribute_layers", "arguments": {
            "direction": "horizontally" if v == "h" else "vertically"}}]
    if k == "order":
        return [{"name": "change_layer_order", "arguments": {"to": v}}]
    if k == "mv":
        return [{"name": "move_layers", "arguments": {"direction": v, "pixels": value}}]
    simple = {"dup": ("duplicate_layers", {}), "del": ("delete_layers", {}),
              "group": ("group_layers", {"action": "group"}), "ungroup": ("group_layers", {"action": "ungroup"}),
              "lock": ("lock_layers", {"action": "lock"}), "unlock": ("lock_layers", {"action": "unlock"}),
              "hide": ("hide_layers", {"action": "hide"}), "show": ("hide_layers", {"action": "show"})}
    name, args = simple[cls]
    return [{"name": name, "arguments": args}]


def outcome_of(calls):
    """A round 1 call (list of at most one) -> (class, value); (None, None) if it fits no outcome."""
    if not calls:
        return NONE, None
    c = calls[0]
    n, a = c.get("name"), c.get("arguments") or {}
    try:
        if n == "set_text_weight":
            return (f"w:{a['weight']}", None) if a["weight"] in WEIGHTS else (None, None)
        if n == "set_text_case":
            inv = {v: k for k, v in CASES.items()}
            return f"case:{inv[a['case']]}", None
        if n == "style_text":
            inv = {v: k for k, v in STYLES.items()}
            on = a.get("on", True)
            return f"{inv[a['style']]}{'+' if on else '-'}", None
        if n == "align_text":
            return (f"ta:{a['align']}", None) if a["align"] in TEXT_ALIGN else (None, None)
        if n == "change_spacing":
            s = {"letter spacing": "ls", "line spacing": "lh"}[a["spacing"]]
            return s + {"more": "+", "less": "-"}[a.get("direction", "more")], None
        if n == "resize":
            cls = {"bigger": "big", "smaller": "small"}[a["direction"]]
            return cls, int(a.get("percent", 20))
        if n == "set_font_size":
            return "fs", int(a["size"])
        if n == "rotate":
            d = int(a["degrees"])
            return ("rot+" if d > 0 else "rot-"), abs(d)
        if n == "flip":
            return {"horizontal": "flipH", "vertical": "flipV"}[a["axis"]], None
        if n == "round_corners":
            r = int(a.get("radius", 16))
            return ("rc0", None) if r == 0 else ("rc", r)
        if n == "use_brand_colour":
            return (f"brand:{a['role']}", None) if a["role"] in ROLES else (None, None)
        if n == "set_colour":
            return (f"col:{a['colour']}", None) if a["colour"] in COLOURS else (None, None)
        if n == "set_hex_colour":
            return "hex", str(a["hex"]).upper()
        if n == "set_opacity":
            return ("op" if a.get("measure", "opacity") == "opacity" else "tr"), int(a["percent"])
        if n == "use_brand_font":
            return f"font:{a['font']}", None
        if n == "align_layers":
            return (f"al:{a['edge']}", None) if a["edge"] in EDGES else (None, None)
        if n == "distribute_layers":
            return {"horizontally": "dist:h", "vertically": "dist:v"}[a["direction"]], None
        if n == "change_layer_order":
            return (f"order:{a['to']}", None) if a["to"] in ORDER else (None, None)
        if n == "move_layers":
            return f"mv:{a['direction']}", int(a.get("pixels", 10))
        if n == "duplicate_layers":
            return "dup", None
        if n == "delete_layers":
            return "del", None
        if n in ("group_layers", "lock_layers", "hide_layers"):
            return a["action"], None
    except (KeyError, TypeError, ValueError):
        return None, None
    return None, None


def same(gold_calls, calls):
    """Whether two round 1 calls are the same outcome (defaults filled)."""
    g, p = outcome_of(gold_calls), outcome_of(calls)
    if g[0] is None or p[0] is None:
        return False
    if g[0] != p[0]:
        return False
    gv = g[1] if g[1] is not None else DEFAULTS.get(g[0])
    pv = p[1] if p[1] is not None else DEFAULTS.get(p[0])
    return gv == pv


def read_test(path=os.path.join(HERE, "data", "test.frozen.txt")):
    """The frozen test set: rows with query, cls, value, answers (round 1 calls), category, style."""
    rows, style = [], None
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip() or line.startswith("#"):
            continue
        if line.startswith("@ "):
            style = line[2:].strip()
            continue
        code, _, query = line.partition(" | ")
        cls, value = parse_code(code.strip())
        category = value if cls == NONE else "action"
        value = None if cls == NONE else value
        rows.append({"query": query.strip(), "cls": cls, "value": value, "answers": call_of(cls, value),
                     "category": category, "style": style})
    return rows


if __name__ == "__main__":
    rows = read_test()
    from collections import Counter
    seen = Counter(r["query"].lower() for r in rows)
    dups = [q for q, k in seen.items() if k > 1]
    assert not dups, dups
    for r in rows:
        assert outcome_of(r["answers"])[0] == r["cls"], r
    by = Counter(r["cls"] for r in rows)
    missing = [c for c in CLASSES if c not in by]
    print(len(rows), "requests;", sum(1 for r in rows if r["cls"] == NONE), "no call;",
          "styles", dict(Counter(r["style"] for r in rows)))
    print("classes missing:", missing)
    print(json.dumps(dict(sorted(by.items())), indent=None))
