"""PROTOTYPE, never merged. Writes round 2's training requests through the owner's ChatGPT plan
(the plan-route script given by --plan-script or PLAN_SCRIPT; no paid API).

For every outcome class (outcomes.py) and every no-call kind it asks for batches of varied
requests in the ways people type into a design editor's command bar, then checks each one: the
value it names (number or hex) must be written in the request, within the tool's range, and the
request must not be one of the frozen test set's. Kept rows go to data/gen/<class>.jsonl, one
file per class, so a cut run resumes where it stopped.

  python gen_plan.py --plan-script <path to chatgpt_plan.py> [--model gpt-6.2-sol] [--per-class 2]
"""
import argparse
import asyncio
import importlib.util
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from outcomes import CLASSES, NUMBERED, NUMBER_NEEDED, read_test  # noqa: E402
from slots import number_words_in  # noqa: E402

OUT = os.path.join(HERE, "data", "gen")

TEXT_OBJ = ("the headline, title, subheading, tagline, CTA text, button label, price, offer text, caption, "
            "body copy, disclaimer, quote, hashtag, date, this text, it, the selection")
MANY_OBJ = ("these, them, the selected layers, the icons, the buttons, the product tiles, the logos, the "
            "cards, the badges, the photos, everything selected, the shapes; or a single layer like the logo")
OBJ = ("the headline, title, subheading, tagline, CTA, button, price, offer text, caption, logo, "
       "product shot, packshot, hero image, photo, badge, sticker, icon, shape, box, card, banner, "
       "background shape, frame, this, it, these, them, the selection")

WHAT = {
    "w:thin": "set the selected text to the thinnest font weight (thin, hairline)",
    "w:light": "set the selected text to a light font weight",
    "w:regular": "set the selected text to regular (normal) weight; this includes removing bold: "
                 "'unbold', 'turn off bold', 'not bold anymore', 'remove the bold'",
    "w:medium": "set the selected text to medium font weight",
    "w:semibold": "set the selected text to semibold (semi-bold, demibold) weight",
    "w:bold": "make the selected text bold (bolder, thicker letters, embolden)",
    "w:black": "set the selected text to the heaviest weight (black, ultra bold, extra heavy)",
    "case:upper": "set the selected text in all capitals (all caps, uppercase, block capitals)",
    "case:lower": "set the selected text in all lowercase (small letters, no capitals)",
    "case:title": "set the selected text in title case (capitalise the first letter of each word)",
    "case:normal": "undo a text case transform: remove all caps/uppercase/title case, back to the case as typed",
    "it+": "make the selected text italic (italics, slanted)",
    "it-": "remove italic from the selected text (upright, no italics, un-italic)",
    "ul+": "underline the selected text",
    "ul-": "remove the underline from the selected text",
    "st+": "add a strikethrough to the selected text (cross it out, line through it, slash the old price)",
    "st-": "remove the strikethrough from the selected text (uncross it, remove the line through it)",
    "ta:left": "align the lines of the selected text to the left inside its own text box (text alignment left, flush left)",
    "ta:center": "center-align the lines of the selected text inside its own text box (text alignment center)",
    "ta:right": "align the lines of the selected text to the right inside its own text box (text alignment right)",
    "ta:justify": "justify the lines of the selected text (full justification)",
    "ls+": "increase the letter spacing of the selected text (tracking, space between letters, spread letters out)",
    "ls-": "decrease the letter spacing of the selected text (tighter tracking/kerning, letters closer)",
    "lh+": "increase the line spacing of the selected text (line height, leading, space between lines). "
           "Note words like 'bigger line height' still mean line spacing, not size",
    "lh-": "decrease the line spacing of the selected text (smaller line height, less leading, lines closer). "
           "Note words like 'smaller line height' still mean line spacing, not size",
    "big": "make the selected thing bigger (larger, scale up, enlarge, increase size, increase the font size "
           "with no number); sometimes by a percentage, never a pixel size",
    "small": "make the selected thing smaller (shrink, scale down, reduce size, decrease font size with no "
             "number); sometimes by a percentage, never a pixel size",
    "fs": "set the font size of the selected text to a number (px, pt or just a number)",
    "rot+": "rotate the selected thing clockwise (to the right) by a number of degrees",
    "rot-": "rotate the selected thing anticlockwise (counterclockwise, to the left, minus) by a number of degrees",
    "flipH": "flip/mirror the selected thing horizontally (left to right, face the other way)",
    "flipV": "flip the selected thing vertically (upside down, top to bottom)",
    "rc": "round the corners of the selected shape, sometimes with a radius in pixels",
    "rc0": "make the corners of the selected shape square/sharp (remove the rounding, radius 0)",
    "brand:primary": "colour the selection with the brand kit's primary (main) colour",
    "brand:secondary": "colour the selection with the brand kit's secondary colour",
    "brand:accent": "colour the selection with the brand kit's accent colour",
    "brand:background": "colour the selection with the brand kit's background colour",
    "brand:text": "colour the selection with the brand kit's text colour",
    "hex": "colour the selection with an exact hex colour code like #1A2B3C",
    "op": "set the opacity of the selection to a percentage (how solid it is: 'opacity 40', '40% opaque')",
    "tr": "set the transparency of the selection to a percentage (how see-through: '30% transparent', '30% see-through')",
    "font:heading": "set the selected text in the brand kit's heading font (heading typeface)",
    "font:body": "set the selected text in the brand kit's body font (body/paragraph typeface)",
    "al:left": "align the selected layers to the left (left edges; one layer goes to the frame's left edge)",
    "al:center": "align the selected layers to the horizontal center (center them across; one layer: center it horizontally on the page)",
    "al:right": "align the selected layers to the right (right edges)",
    "al:top": "align the selected layers to the top (top edges)",
    "al:middle": "align the selected layers to the vertical middle (center vertically)",
    "al:bottom": "align the selected layers to the bottom (bottom edges)",
    "dist:h": "distribute the selected layers horizontally with even gaps (space evenly across, side by side)",
    "dist:v": "distribute the selected layers vertically with even gaps (space evenly top to bottom)",
    "order:forward": "bring the selection forward one layer (up one step in the stack)",
    "order:backward": "send the selection backward one layer (down one step in the stack)",
    "order:front": "bring the selection to the very front (on top of everything)",
    "order:back": "send the selection to the very back (behind everything)",
    "mv:left": "move/nudge the selection to the left, sometimes by a number of pixels",
    "mv:right": "move/nudge the selection to the right, sometimes by a number of pixels",
    "mv:up": "move/nudge the selection up, sometimes by a number of pixels",
    "mv:down": "move/nudge the selection down, sometimes by a number of pixels",
    "dup": "duplicate the selection (copy, clone, make another one of it)",
    "del": "delete the selection (remove, get rid of, trash, bin it)",
    "group": "group the selected layers together",
    "ungroup": "ungroup the selection (break apart the group, release from the group, split the group)",
    "lock": "lock the selection so it can't be moved or edited (freeze it, protect it, keep it from being changed)",
    "unlock": "unlock the selection so it can be edited again",
    "hide": "hide the selection (make it invisible for now)",
    "show": "show the hidden selection again (unhide, make visible)",
}
for c in [f"col:{x}" for x in ["red", "orange", "yellow", "green", "teal", "blue", "navy", "purple",
                               "pink", "brown", "black", "white", "grey", "gold"]]:
    name = c[4:]
    WHAT[c] = f"colour the selection {name}" + {"grey": " (grey or gray)", "navy": " (navy, navy blue)",
                                                  "gold": " (gold, golden)", "purple": " (purple, violet)"}.get(name, "")
assert set(WHAT) == set(CLASSES), set(CLASSES) ^ set(WHAT)

NOCALL = {
    "big": "a request for something generative or large that a quick edit bar can't do: make a new ad, "
           "poster, post, story, banner or campaign, write or rewrite copy, headlines, slogans, captions, "
           "suggest ideas or palettes, make variations or other sizes, translate",
    "unrel": "a message that is not about editing a design at all: greetings, thanks, chit-chat, questions "
             "about the world, the time, jokes, keyboard mash, asking what the bar can do, other apps' tasks",
    "unsup": "a single design edit this bar does NOT have: shadows, outlines/strokes/borders, crop, remove "
             "background, blur, filters, gradients, changing the words of a text, choosing a named font "
             "family like Montserrat, adding new layers/text/shapes/images, undo/redo, export/download/share, "
             "zoom, masks, animation, replacing an image, effects",
    "vague": "an edit with its direction or value missing entirely, so the bar can't know which way: "
             "'change the colour' (which colour?), 'resize it' (bigger or smaller?), 'rotate it' or 'tilt it' "
             "(how many degrees?), 'move it' or 'reposition it' (which way?), 'align these' (to which edge?), "
             "'change the font size', 'change the opacity', 'make it more transparent' (to what?), "
             "'use a brand colour' (which one?), 'change the font' or the weight or the case (to what?); or no "
             "clear edit at all: 'make it pop', 'make it look better', 'fix it', 'more premium'. NEVER write "
             "complete edits such as bigger, smaller, larger, up, down, left, right, bold, italic, caps or a "
             "named colour: those are not vague",
    "neg": "a negation or cancel: telling the bar NOT to do something or to stop ('don't make it bold', "
           "'leave the logo alone', 'cancel', 'never mind', 'keep it as it is')",
    "multi": "two different edits in one request ('make it bold and red', 'duplicate it and move it right', "
             "'make the logo smaller and send it back')",
}

STYLES = [
    "plain and casual",
    "very short, one to three words, like a command",
    "with typos and misspellings, lowercase, sloppy",
    "Hinglish (Hindi and English mixed, written in Latin letters, mixing Hindi words and English design words in one sentence)",
    "how marketers and designers talk (jargon: CTA, hero, packshot, lockup, kerning, eyebrow, artboard)",
    "indirect: a complaint about how it looks now, so the fix is implied",
    "as a question ('can you ...?', 'could the ... be ...?')",
    "long and polite, or spoken voice-typing with filler words and no punctuation",
]

# Batches numbered from HINGLISH_FROM ask mostly for Hinglish and implied fixes, the two styles
# a model trained on the first batches read worst; the word list is everyday Hindi, not tied to
# any request.
HINGLISH_FROM = 10
HINGLISH_WORDS = (" (everyday words people mix in: bada/chhota/aur bada/thoda, upar/neeche/baayen/daayen/"
                  "beech mein/kinare, ghumao/ulta/seedha, laal/neela/hara/peela/kala/safed/gulabi/narangi/"
                  "baingani/bhoora/sunehra/aasmani/sleti, gehra/halka, hatao/mitao/nikaalo, chhupao/dikhao/"
                  "wapas laao, jodo/todo/alag karo, lock/taala lagao/kholo, copy/ek aur, mota/patla, "
                  "seedhi line, kar do/karo/kijiye/chahiye/na/yaar/bhai/please)")

SYSTEM = ("You write realistic training data for a command bar inside a design editor (like Canva or "
          "Figma). People select something on their design and type a short request. You write the "
          "requests people would really type, varied in wording, length, tone and the thing they name. "
          "Answer only with the JSON asked for.")


def values_for(cls, rng, k):
    if cls == "fs":
        pool = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 42, 44, 48, 52,
                54, 56, 60, 64, 70, 72, 80, 84, 90, 96, 100, 110, 120, 128, 140, 150, 160, 200]
    elif cls in ("rot+", "rot-"):
        pool = [1, 2, 3, 5, 7, 8, 10, 12, 15, 20, 22, 25, 30, 35, 40, 45, 45, 60, 72, 75, 90, 90, 90,
                120, 135, 150, 180, 180, 200, 270, 300, 330, 360]
    elif cls in ("op", "tr"):
        pool = [0, 5, 10, 12, 15, 20, 25, 30, 33, 35, 40, 45, 50, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]
    elif cls in ("big", "small"):
        pool = [5, 10, 10, 15, 20, 25, 30, 33, 40, 50, 50, 60, 75, 80, 100, 120, 150, 200, 300]
        if cls == "small":
            pool = [p for p in pool if p < 100] + [50, 50, 25, 90]
    elif cls == "rc":
        pool = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 30, 32, 40, 48, 50, 60, 64, 100, 999]
    elif cls.startswith("mv:"):
        pool = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 25, 30, 32, 40, 48, 50, 60, 64, 75, 80, 100,
                120, 150, 200, 250, 300, 500]
    else:
        return None
    return [rng.choice(pool) for _ in range(k)]


def objects_for(cls):
    if cls.split(":")[0] in ("w", "case", "ta", "font") or cls[:2] in ("it", "ul", "st", "ls", "lh") or cls == "fs":
        return TEXT_OBJ
    if cls.split(":")[0] in ("al", "dist") or cls == "group":
        return MANY_OBJ
    return OBJ


def prompt_for(cls, batch, rng, n, nocall=False):
    styles = STYLES[:]
    rng.shuffle(styles)
    focus = styles[:4] if batch % 2 == 0 else [STYLES[1], STYLES[2], STYLES[3], STYLES[5]]
    if batch >= HINGLISH_FROM:
        focus = [STYLES[3] + HINGLISH_WORDS, STYLES[5], "Hinglish with typos and very short"]
    lines = [f"Write {n} different messages of this kind: {NOCALL[cls]}." if nocall else
             f"Write {n} different requests that all mean exactly this one edit: {WHAT[cls]}.",
             f"The thing selected may be named or not (e.g. {objects_for(cls)}); vary it a lot.",
             "Mix these styles, several of each: " + "; ".join(focus) + ".",
             "Each request asks for this edit only: never a second edit in the same request."]
    vals = None
    if nocall:
        lines.append("The value field is always null.")
        return "\n".join(lines)
    if cls in NUMBERED:
        k = n if cls in NUMBER_NEEDED else n // 2
        vals = values_for(cls, rng, k)
        word = "percent" if cls in ("big", "small", "op", "tr") else "degrees" if cls.startswith("rot") \
            else "pixels" if cls in ("rc",) or cls.startswith("mv:") else "font size"
        if cls in NUMBER_NEEDED:
            lines.append(f"Request i must name the {word} value number i of this list, written in digits "
                         f"(sometimes as words): {vals}. Put that value in the answer's value field.")
        else:
            lines.append(f"The first {k} requests must name the {word} value number i of this list, written in "
                         f"digits (sometimes as words): {vals}; put it in the value field. The other "
                         f"{n - k} requests name no number at all (value null).")
    elif cls == "hex":
        codes = ["#" + "".join(rng.choice("0123456789ABCDEF") for _ in range(6)) for _ in range(n)]
        codes = [c.lower() if rng.random() < 0.4 else c for c in codes]
        lines.append(f"Request i must contain hex code number i of this list exactly: {codes}; put it in the value field.")
    else:
        lines.append("The value field is always null.")
    if cls in ("big", "small"):
        lines.append("A number here is always a percentage of the current size (or words like 'double', "
                     "'half'), never a pixel or point size.")
    return "\n".join(lines)


SCHEMA = {"type": "object", "additionalProperties": False, "required": ["requests"], "properties": {
    "requests": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["text", "value"],
        "properties": {"text": {"type": "string"},
                       "value": {"anyOf": [{"type": "integer"}, {"type": "string"}, {"type": "null"}]}}}}}}

RANGE = {"big": (1, 400), "small": (1, 99), "fs": (1, 1000), "rot+": (1, 360), "rot-": (1, 360),
         "rc": (1, 1000), "op": (0, 100), "tr": (0, 100)}
HEX = re.compile(r"#[0-9a-fA-F]{6}\b")


def check(cls, item, banned):
    """The row to keep (query, cls, value) or None."""
    text = re.sub(r"\s+", " ", str(item.get("text", ""))).strip()
    if not text or len(text) > 220 or text.lower() in banned:
        return None
    v = item.get("value")
    if cls == "hex":
        found = HEX.findall(text)
        if len(found) != 1 or not isinstance(v, str) or found[0].upper() != v.upper():
            return None
        return {"query": text, "cls": cls, "value": v.upper()}
    if cls in NUMBERED:
        if v is None or v == "":
            if cls in NUMBER_NEEDED or re.search(r"\d", text) or number_words_in(text):
                return None
            return {"query": text, "cls": cls, "value": None}
        try:
            v = int(v)
        except (TypeError, ValueError):
            return None
        lo, hi = RANGE.get(cls, (1, 5000))
        if not lo <= v <= hi:
            return None
        if str(v) not in re.findall(r"\d+", text) and v not in number_words_in(text):
            return None
        return {"query": text, "cls": cls, "value": v}
    if v not in (None, ""):
        return None
    if cls != "none" and re.search(r"\d", text) and cls not in ("dup", "del"):
        return None
    return {"query": text, "cls": cls, "value": None}


async def run(args):
    spec = importlib.util.spec_from_file_location("plan", args.plan_script)
    plan = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plan)
    banned = {r["query"].lower() for p in ("test.frozen.txt", "test2.frozen.txt")
              for r in read_test(os.path.join(HERE, "data", p))}
    os.makedirs(OUT, exist_ok=True)
    jobs = []
    for cls in CLASSES:
        k = args.per_class + (1 if cls in NUMBERED or cls == "hex" else 0)
        jobs += [(cls, b) for b in range(k)]
    for kind in NOCALL:
        jobs += [(f"none-{kind}", b) for b in range(args.per_nocall)]
    for cls in CLASSES + [f"none-{k}" for k in ("big", "unsup", "vague", "neg", "multi")]:
        jobs += [(cls, HINGLISH_FROM + b) for b in range(args.hinglish)]
    if args.only:
        keep = set(args.only.split(","))
        jobs = [j for j in jobs if j[0] in keep]
    sem = asyncio.Semaphore(args.workers)
    stats = {"asked": 0, "kept": 0, "dropped": 0, "failed": 0}

    async def one(name, batch):
        path = os.path.join(OUT, f"{name.replace(':', '_')}.b{batch}.jsonl")
        if os.path.exists(path):
            return
        cls = "none" if name.startswith("none-") else name
        rng = random.Random(f"{name}/{batch}")
        what = name[5:] if cls == "none" else name
        user = prompt_for(what, batch, rng, args.n, nocall=cls == "none")
        sent = {"model": args.model, "reasoning_effort": "low",
                "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                "response_format": {"type": "json_schema", "json_schema": {"name": "requests", "strict": False,
                                                                           "schema": SCHEMA}}}
        async with sem:
            for attempt in range(3):
                try:
                    body, _ = await plan.answer("/v1/chat/completions", sent)
                    items = json.loads(json.loads(body)["choices"][0]["message"]["content"])["requests"]
                    break
                except Exception as e:  # the plan's limit or a broken answer: wait and ask again
                    print(f"{name} b{batch} attempt {attempt + 1}: {str(e)[:160]}", flush=True)
                    await asyncio.sleep(20 * (attempt + 1))
            else:
                stats["failed"] += 1
                return
        kept = []
        for it in items:
            row = check(cls, it, banned)
            if row:
                if cls == "none":
                    row["category"] = what
                row["batch"] = f"{name}/{batch}"
                row["model"] = args.model
                kept.append(row)
        stats["asked"] += len(items)
        stats["kept"] += len(kept)
        stats["dropped"] += len(items) - len(kept)
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            for r in kept:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.replace(path + ".tmp", path)
        print(f"{name} b{batch}: kept {len(kept)}/{len(items)}  totals {stats}", flush=True)

    await asyncio.gather(*(one(n, b) for n, b in jobs))
    print("DONE", stats, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan-script", default=os.environ.get("PLAN_SCRIPT"))
    ap.add_argument("--model", default="gpt-6.2-sol")
    ap.add_argument("--per-class", type=int, default=2)
    ap.add_argument("--per-nocall", type=int, default=6)
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--only", help="comma-separated job names, for a trial")
    ap.add_argument("--hinglish", type=int, default=0, help="extra Hinglish and implied-fix batches per class")
    args = ap.parse_args()
    assert args.plan_script, "give --plan-script or PLAN_SCRIPT"
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
