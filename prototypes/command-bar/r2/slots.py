"""PROTOTYPE, never merged. Reads the value a request names (a number or a hex code), for the
classifier models, which pick the outcome class and leave the value to this.

  value_for("rotate it 45 degrees anticlockwise", "rot-")  -> 45
  value_for("make it bigger", "big")                       -> None (the class's default runs)
"""
import re

WANT = {"big": "pct", "small": "pct", "op": "pct", "tr": "pct", "fs": "px", "rc": "px",
        "rot+": "deg", "rot-": "deg", "mv:left": "px", "mv:right": "px", "mv:up": "px", "mv:down": "px"}

ONES = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
        "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
        "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50, "sixty": 60,
        "seventy": 70, "eighty": 80, "ninety": 90}
HINDI = {"das": 10, "bees": 20, "tees": 30, "chalis": 40, "pachas": 50, "pachaas": 50, "sau": 100}
HEX = re.compile(r"#[0-9a-fA-F]{6}\b")
NUM = re.compile(r"(?<![\w#])(-?\d+)(?:\.\d+)?\s*(%|per ?cent|pc\b|px|pixels?|pxl|pts?\b|points?|°|deg(?:rees?|res?|re)?)?",
                 re.I)


def number_words_in(text):
    """Numbers written in words ('forty five', 'a hundred', 'pachas'), in order."""
    words = re.findall(r"[a-z]+", text.lower().replace("-", " "))
    out, i = [], 0
    while i < len(words):
        w = words[i]
        if w in HINDI:
            out.append(HINDI[w])
            i += 1
            continue
        if w in ("hundred",) and (i == 0 or words[i - 1] in ("a", "one")):
            n, i = 100, i + 1
            if i < len(words) and words[i] == "and":
                i += 1
            if i < len(words) and words[i] in TENS:
                n += TENS[words[i]]
                i += 1
                if i < len(words) and words[i] in ONES and ONES[words[i]] < 10:
                    n += ONES[words[i]]
                    i += 1
            elif i < len(words) and words[i] in ONES:
                n += ONES[words[i]]
                i += 1
            out.append(n)
            continue
        if w in ONES or w in TENS:
            n = ONES.get(w, TENS.get(w))
            i += 1
            if w in TENS and i < len(words) and words[i] in ONES and 0 < ONES[words[i]] < 10:
                n += ONES[words[i]]
                i += 1
            if i < len(words) and words[i] == "hundred" and n < 10:
                n *= 100
                i += 1
                if i < len(words) and words[i] == "and":
                    i += 1
                if i < len(words) and words[i] in TENS:
                    n += TENS[words[i]]
                    i += 1
            if w == "one" and n == 1:
                # "one" is mostly "one layer", "this one"
                continue
            out.append(n)
            continue
        i += 1
    return out


def unit_of(word):
    w = (word or "").lower()
    if not w:
        return None
    if w.startswith(("%", "per", "pc")):
        return "pct"
    if w.startswith(("°", "deg")):
        return "deg"
    return "px"


def value_for(text, cls):
    """The value a request names for its class, or None when it names none."""
    if cls == "hex":
        m = HEX.search(text)
        return m.group(0).upper() if m else None
    if cls not in WANT:
        return None
    want = WANT[cls]
    found = []
    for m in NUM.finditer(text):
        found.append((int(m.group(1)), unit_of(m.group(2))))
    pick = next((n for n, u in found if u == want), None)
    if pick is None and found:
        pick = next((n for n, u in found if u is None), found[0][0])
    if pick is None:
        words = number_words_in(text)
        if words:
            pick = words[0]
    low = text.lower()
    if pick is None:
        if cls == "big" and re.search(r"\b(double|twice|2x)\b", low):
            pick = 100
        elif cls == "big" and re.search(r"\btriple\b|\b3x\b", low):
            pick = 200
        elif cls in ("small", "op", "tr") and re.search(r"\bhalf\b|\baadha\b", low):
            pick = 50
        elif cls in ("small", "op", "tr") and re.search(r"\bquarter\b", low):
            pick = 25 if cls != "small" else 75
    if pick is None:
        return None
    return abs(pick)
