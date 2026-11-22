"""Writes the blind before/after comparison page from out/compare.json (run.py compare) into out/page/.

  python compare.py [--seed 139]   (needs Pillow)

Goals measured outside the runs (the pixel suite, unit tests, the calls made) are read from out/static-goals.json, a
list of {goal, target, before, after, met}, when it is there.

out/page/ holds index.html and pictures/, each frame as a JPEG at most 960 px a side. Each brief's two designs are
shown as A and B, which is before and which after decided by a seeded random so the page and the stored picks agree
on every visit. The owner's picks go to the page's database, collection "picks", one document a brief ("b1" to "b10"):
{brief, pick: "A" | "B" | "same", winner: "before" | "after" | "same", a: "before" | "after", at}.
"""

import argparse
import json
import random
import shutil
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
PAGE = OUT / "page"
LONGEST = 960

sys.stdout.reconfigure(encoding="utf-8")


def picture(set_name, n, frame):
    """The frame's picture copied as a JPEG into the page's folder; its path from the page, or None."""
    if not frame.get("picture"):
        return None
    source = OUT / set_name / str(n) / frame["picture"]
    if not source.exists():
        return None
    name = f"pictures/{set_name}-{n}-{frame['id']}.jpg"
    image = Image.open(source).convert("RGB")
    image.thumbnail((LONGEST, LONGEST), Image.LANCZOS)
    image.save(PAGE / name, "JPEG", quality=86, optimize=True)
    return name


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=139)
    args = parser.parse_args()
    data = json.loads((OUT / "compare.json").read_text(encoding="utf-8"))
    if PAGE.exists():
        shutil.rmtree(PAGE)
    (PAGE / "pictures").mkdir(parents=True)
    chance = random.Random(args.seed)
    briefs = []
    for key in sorted(data["sets"]["after"], key=int):
        n = int(key)
        before, after = data["sets"]["before"].get(key), data["sets"]["after"][key]
        if not before:
            continue
        a_is = chance.choice(["before", "after"])
        sides = {"before": before, "after": after}
        entry = {"n": n, "title": after["title"], "brief": after["brief"].replace("MCP after", "MCP …"), "a": a_is}
        for set_name, design in sides.items():
            entry[set_name] = {
                "frames": [{"src": picture(set_name, n, f), "w": f["width"], "h": f["height"], "name": f["name"]}
                           for f in design["frames"]],
                "counts": design["counts"],
                "pattern": design["pattern"],
            }
        briefs.append(entry)
    static = OUT / "static-goals.json"
    if static.exists():
        data["goals"]["static"] = json.loads(static.read_text(encoding="utf-8"))
    template = (HERE / "compare.html").read_text(encoding="utf-8")
    page = template.replace("/*DATA*/null", json.dumps({"briefs": briefs, "goals": data["goals"],
                                                        "variety": data["variety"]}, ensure_ascii=False))
    (PAGE / "index.html").write_text(page, encoding="utf-8")
    print(PAGE / "index.html", sum(1 for _ in (PAGE / "pictures").iterdir()), "pictures")


if __name__ == "__main__":
    main()
