"""Runs the agents' ads briefs with headless Claude Code through the Dazbee connector, and shows them.

  python -I run.py run <n> [--set before]   runs brief n, renders every frame it made, and counts
  python -I run.py measure <n> [--set before]   renders and counts an earlier run again
  python -I run.py page [--set before]      writes out/<set>/index.html with every run kept
  python -I run.py table [--set before]     prints the counts as a Markdown table
  python -I run.py variety [--set after]    prints each run's pattern use and what was changed after it
  python -I run.py goals                    prints the spec's measured goals, before against after
  python -I run.py compare                  writes out/compare.json, both sets' counts and frames, for the page

A run keeps, in out/<set>/<n>/: stream.jsonl (the run's stream-json), look-NN-<tool>.png (every
picture the run's agent looked at), measure.jsonl (the stream of the short call that renders and
checks the design), frame-<id>.png (each frame as it ends) and summary.json (the counts).

Claude runs in an empty folder outside the repo with no settings files, so no CLAUDE.md or memory
reaches it, and with only the claude.ai connector "Dazbee": the other connectors are turned off and
the only built-in tools are ToolSearch, which loads the connector's tools, and the two that read its
resources.
"""

import argparse
import base64
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRIEFS = HERE / "briefs.md"
MODEL = "claude-opus-5-5"
SERVER = "claude.ai Dazbee"
TOOL_PREFIX = "mcp__claude_ai_Dazbee__"
BUILT_IN_TOOLS = "ToolSearch,ListMcpResourcesTool,ReadMcpResourceTool"
OTHER_CONNECTORS = ["mcp__claude_ai_Claude_Docs", "mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Drive"]
RUN_SECONDS = 40 * 60
MEASURE_SECONDS = 15 * 60
RENDER_SIZES = (16, 8192)
PICTURE_TOOLS = {"add_image", "upload_image", "place_asset", "add_stock", "place_graphic", "brand_from_website"}
PLACING_TOOLS = {"place_asset", "place_graphic"}
ASSET_SOURCES = {"add_image": "link", "upload_image": "upload", "add_stock": "stock",
                 "brand_from_website": "website", "place_graphic": "bundled graphics"}
NO_FONT_FILE = "which has no font file"
ADDING = {"node.create", "node.duplicate", "node.copyToFrames", "node.group", "node.enclose", "node.boolean", "node.mask"}
MOVING = {"node.move", "node.box", "node.reorder", "node.reshape", "node.flip", "node.hug", "node.autoLayout",
          "frame.resize"}
RESTYLING = {"node.style", "node.bind"}
RETEXTING = {"text.replace", "text.edit", "text.fit"}
BOX_KEYS = {"x", "y", "width", "height", "rotation"}

sys.stdout.reconfigure(encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["run", "measure", "page", "table", "variety", "goals", "compare"])
    parser.add_argument("n", nargs="?", type=int)
    parser.add_argument("--set", default="before", choices=["before", "after"])
    args = parser.parse_args()
    briefs, ending = read_briefs()
    out = HERE / "out" / args.set
    if args.action in ("run", "measure"):
        if args.n not in briefs:
            sys.exit(f"No brief {args.n}; briefs.md has {sorted(briefs)}")
        folder = out / str(args.n)
        if args.action == "run":
            run_brief(folder, briefs[args.n], ending, args.set)
        summary = measure(folder, args.n, briefs[args.n], args.set)
        print(json.dumps(counts_of(summary), ensure_ascii=False, indent=1))
    elif args.action == "page":
        write_page(out, args.set)
        print(out / "index.html")
    elif args.action == "variety":
        print(variety_table(out))
    elif args.action == "goals":
        print(goals_table(HERE / "out"))
    elif args.action == "compare":
        write_compare(HERE / "out")
        print(HERE / "out" / "compare.json")
    else:
        print(table(out))


def read_briefs():
    """The briefs by number, each its title and text, and the text every brief ends with."""
    text = BRIEFS.read_text(encoding="utf-8")
    sections = re.findall(r"^## (.+?)\n+```text\n(.*?)\n```", text, re.S | re.M)
    briefs, ending = {}, None
    for heading, body in sections:
        numbered = re.match(r"(\d+)\. (.+)", heading)
        if numbered:
            briefs[int(numbered[1])] = {"title": numbered[2], "text": body.strip()}
        elif heading.startswith("Every brief ends with"):
            ending = body.strip()
    if ending is None:
        sys.exit("briefs.md has no 'Every brief ends with' section")
    return briefs, ending


def design_name(brief, set_name):
    named = re.search(r"Name the design '([^']+)'", brief["text"])
    return named[1].replace("<set>", set_name) if named else None


def claude(prompt, allowed, stream_path, seconds):
    """Runs headless Claude Code on `prompt` in an empty folder, writing its stream to `stream_path`."""
    exe = shutil.which("claude")
    if not exe:
        sys.exit("claude is not on PATH")
    command = [
        exe, "-p", prompt,
        "--model", MODEL,
        "--output-format", "stream-json", "--verbose",
        "--no-session-persistence",
        "--setting-sources", "",
        "--tools", BUILT_IN_TOOLS,
        "--allowedTools", *allowed,
        "--disallowedTools", *OTHER_CONNECTORS,
    ]
    started = time.time()
    with tempfile.TemporaryDirectory(prefix="dazbee-ads-run-") as cwd:
        with open(stream_path, "wb") as stream, open(stream_path.with_suffix(".err"), "wb") as err:
            try:
                code = subprocess.run(command, cwd=cwd, stdout=stream, stderr=err, timeout=seconds).returncode
            except subprocess.TimeoutExpired:
                code = "timeout"
    return code, round(time.time() - started)


def run_brief(folder, brief, ending, set_name):
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.png"):
        old.unlink()
    prompt = f"{brief['text'].replace('<set>', set_name)}\n\n{ending}"
    (folder / "prompt.txt").write_text(prompt, encoding="utf-8")
    code, seconds = claude(prompt, [TOOL_PREFIX + "*"], folder / "stream.jsonl", RUN_SECONDS)
    (folder / "run.json").write_text(json.dumps({"exit": code, "seconds": seconds}), encoding="utf-8")


def events(path):
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def tool_results(path):
    """Each tool call of a stream in order: its tool's short name, input, result texts, pictures and whether it erred."""
    calls, order = {}, []
    final = None
    for event in events(path):
        kind = event.get("type")
        if kind == "assistant":
            for part in event["message"].get("content", []):
                if part.get("type") == "tool_use":
                    call = {"tool": part["name"].removeprefix(TOOL_PREFIX), "input": part.get("input", {}),
                            "texts": [], "images": [], "error": False}
                    calls[part["id"]] = call
                    order.append(call)
        elif kind == "user":
            content = event["message"].get("content", [])
            if isinstance(content, str):
                continue
            for part in content:
                if part.get("type") != "tool_result" or part.get("tool_use_id") not in calls:
                    continue
                call = calls[part["tool_use_id"]]
                call["error"] = bool(part.get("is_error"))
                body = part.get("content")
                for block in [{"type": "text", "text": body}] if isinstance(body, str) else body or []:
                    if block.get("type") == "text":
                        call["texts"].append(block["text"])
                    elif block.get("type") == "image":
                        call["images"].append(base64.b64decode(block["source"]["data"]))
        elif kind == "result":
            final = event
    return order, final


def parsed(call):
    for text in call["texts"]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            continue
    return None


def refusals(calls):
    """Every call the server or client refused, as (tool, sentence): an error answer, or a batch Dazbee didn't keep."""
    refused = []
    for call in calls:
        if call["error"]:
            sentence = " ".join(call["texts"]).strip()
            sentence = re.sub(r"</?tool_use_error>", "", sentence).strip()
            refused.append({"tool": call["tool"], "sentence": sentence[:600]})
            continue
        answer = parsed(call)
        if call["tool"] == "batch" and isinstance(answer, dict) and answer.get("kept") is False:
            failed = [s for s in answer.get("steps", []) if s.get("ok") is False]
            sentence = "; ".join(f"step {s.get('step')} {s.get('command')}: {s.get('reason')}" for s in failed)
            refused.append({"tool": "batch", "sentence": (sentence or json.dumps(answer))[:600]})
    return refused


def measure(folder, n, brief, set_name):
    """Renders and checks every frame of the run's design with a short headless call, and writes summary.json."""
    stream = folder / "stream.jsonl"
    calls, final = tool_results(stream)
    looked = 0
    for call in calls:
        for image in call["images"]:
            looked += 1
            (folder / f"look-{looked:02d}-{call['tool']}.png").write_bytes(image)

    name = design_name(brief, set_name)
    design, brand = None, None
    for call in calls:
        answer = parsed(call)
        if call["tool"] == "create_design" and isinstance(answer, dict) and answer.get("name") == name:
            design, brand = answer.get("id"), call["input"].get("brand")
    where = (f"the design with id '{design}' in the brand with id '{brand}'" if design else
             f"the design named exactly '{name}' in the brand named Ikea (list_brands, then list_designs; if several have that name, the most recently updated)")
    prompt = f"""Measure a Dazbee design without changing it. Open {where} with open_design. Then call read_design, and for every frame on every page, one call at a time:
1. render_frame with that frame's id and maxSize set to the frame's longer side (width or height, whichever is larger, at least 16);
2. read_frame with that frame's id, fields ["fontFamily", "fontWeight", "runs", "fills", "visible"] and maxBytes 1000000;
3. read_layer with the frame's id;
4. check_frame with that frame's id.
Then call list_assets for the brand, and close_design. Change nothing. Answer only "done" when finished."""
    measure_tools = ["list_brands", "list_designs", "open_design", "read_design", "render_frame", "read_frame",
                     "read_layer", "check_frame", "list_assets", "close_design"]
    code, seconds = claude(prompt, [TOOL_PREFIX + t for t in measure_tools], folder / "measure.jsonl", MEASURE_SECONDS)
    measured, _ = tool_results(folder / "measure.jsonl")

    for old in folder.glob("frame-*.png"):
        old.unlink()
    assets, frames = {}, {}
    opened = None
    for call in measured:
        answer = parsed(call)
        if call["tool"] == "open_design" and isinstance(answer, dict):
            opened = answer
            for page in answer.get("pages", []):
                for frame in page.get("frames", []):
                    frames[frame["id"]] = {"id": frame["id"], "name": frame.get("name"), "width": frame.get("width"),
                                           "height": frame.get("height"), "picture": None, "fonts": [], "pictures": [],
                                           "layers": {}, "warnings": None}
        elif call["tool"] == "list_assets" and isinstance(answer, list):
            assets = {a["id"]: a for a in answer}
    for call in measured:
        frame_id = call["input"].get("frame") or call["input"].get("id")
        if frame_id not in frames or call["error"]:
            continue
        frame, answer = frames[frame_id], parsed(call)
        if call["tool"] == "render_frame" and call["images"]:
            file = f"frame-{frame_id}.png"
            (folder / file).write_bytes(call["images"][0])
            frame["picture"] = file
        elif call["tool"] == "read_frame" and isinstance(answer, dict):
            walk(answer, frame, visible=True)
        elif call["tool"] == "read_layer" and isinstance(answer, dict):
            for fill in answer.get("props", answer).get("fills", []) or []:
                if isinstance(fill, dict) and fill.get("type") == "image":
                    frame["pictures"].append({"layer": frame_id, "asset": fill.get("assetId")})
        elif call["tool"] == "check_frame" and isinstance(answer, list):
            frame["warnings"] = answer
    sources = asset_sources(calls)
    placed = placements(calls)
    for frame in frames.values():
        frame["fonts"] = sorted(set(frame["fonts"]))
        for picture in frame["pictures"]:
            asset = assets.get(picture["asset"], {})
            picture["name"] = asset.get("name")
            picture["from"] = sources.get(picture["asset"]) or (
                "stock" if "stock" in (asset.get("tags") or []) else "brand's asset library")
            picture["logo"] = is_logo(picture["name"], frame["layers"].get(picture["layer"]))
        drawn = {p["layer"] for p in frame["pictures"]}
        for place in placed:
            if place["layer"] in frame["layers"] and place["layer"] not in drawn:
                name = place["name"] or frame["layers"][place["layer"]]
                frame["pictures"].append({"layer": place["layer"], "asset": place["asset"], "name": name,
                                          "from": place["from"], "logo": is_logo(name, frame["layers"][place["layer"]])})
    shown = {layer for f in frames.values() for layer in f["layers"]}

    run = json.loads((folder / "run.json").read_text(encoding="utf-8")) if (folder / "run.json").exists() else {}
    summary = {
        "n": n, "title": brief["title"], "brief": brief["text"].replace("<set>", set_name), "set": set_name,
        "design": {"name": name, "id": design or (opened or {}).get("id"), "found": opened is not None},
        "frames": list(frames.values()),
        "looked": looked,
        "refused": refusals(calls),
        "pictureCalls": [{"tool": c["tool"], "input": c["input"]} for c in calls if c["tool"] in PICTURE_TOOLS],
        "placedNotShown": [p for p in placed if p["layer"] not in shown],
        "noFontFile": sum(1 for c in calls for t in c["texts"] if NO_FONT_FILE in t),
        "pattern": pattern_use(calls),
        "toolCalls": len(calls),
        "run": {**run, "turns": (final or {}).get("num_turns"), "costUsd": (final or {}).get("total_cost_usd"),
                "subtype": (final or {}).get("subtype"), "answer": (final or {}).get("result")},
        "measure": {"exit": code, "seconds": seconds, "refused": refusals(measured)},
    }
    (folder / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    return summary


def walk(layer, frame, visible):
    """Adds the fonts and image fills of `layer` and the layers it holds, where they show, to `frame`."""
    shows = visible and layer.get("visible", True) is not False
    if shows and layer.get("id") and layer.get("type") != "frame":
        frame["layers"][layer["id"]] = layer.get("name") or ""
    if shows and layer.get("type") != "frame":
        if layer.get("type") == "text" and layer.get("fontFamily"):
            frame["fonts"].append(f"{layer['fontFamily']} {layer.get('fontWeight', '')}".strip())
            for run in layer.get("runs") or []:
                style = run.get("style", run) if isinstance(run, dict) else {}
                if style.get("fontFamily"):
                    frame["fonts"].append(f"{style['fontFamily']} {style.get('fontWeight', '')}".strip())
        for fill in layer.get("fills") or []:
            if isinstance(fill, dict) and fill.get("type") == "image":
                frame["pictures"].append({"layer": layer.get("id"), "asset": fill.get("assetId")})
    for child in layer.get("children") or []:
        walk(child, frame, shows)


def asset_ids(answer):
    """The asset ids an answer names: each asset it is or holds (an object with an id, a name and a type), and each
    `asset` it holds."""
    found = []
    if isinstance(answer, list):
        for item in answer:
            found += asset_ids(item)
    elif isinstance(answer, dict):
        if isinstance(answer.get("id"), str) and "name" in answer and ("type" in answer or "contentType" in answer):
            found.append(answer["id"])
        for key, value in answer.items():
            if key != "warnings":
                found += asset_ids(value)
    return found


def asset_sources(calls):
    """Where each asset a run added came from, by asset id: a link, an upload, stock, a website or the bundled graphics."""
    sources = {}
    for call in calls:
        source = ASSET_SOURCES.get(call["tool"])
        answer = parsed(call)
        if source and not call["error"] and answer is not None:
            for asset in asset_ids(answer):
                sources.setdefault(asset, source)
    return sources


def graphic_source(graphic):
    """The kind of picture a bundled graphic id is, by its set."""
    kits = {"tabler": "icon", "phosphor": "icon", "fluent-emoji": "sticker", "open-peeps": "sticker",
            "humaaans": "sticker", "undraw": "illustration", "manypixels": "illustration"}
    return f"bundled {kits.get(str(graphic).split('/')[0], 'artwork')}"


def placements(calls):
    """Each layer a run placed with place_graphic or place_asset and Dazbee kept: its id, name, asset and source."""
    placed = []
    for call in calls:
        answer = parsed(call)
        if call["tool"] not in PLACING_TOOLS or call["error"] or not isinstance(answer, dict) or not answer.get("layer"):
            continue
        asset = (answer.get("asset") or {}).get("id") if isinstance(answer.get("asset"), dict) else call["input"].get("asset")
        if call["tool"] == "place_graphic":
            source, name = graphic_source(call["input"].get("graphic")), call["input"].get("graphic")
        else:
            source, name = "brand's asset library", call["input"].get("name") or call["input"].get("asset")
        placed.append({"tool": call["tool"], "layer": answer["layer"], "asset": asset, "name": name, "from": source})
    return placed


def is_logo(*names):
    return any("logo" in (name or "").lower() for name in names)


def steps_of(call):
    """The design commands a successful write call ran, each (command, input); a placing counts as node.create."""
    if call["error"]:
        return []
    answer = parsed(call)
    if call["tool"] == "batch":
        if isinstance(answer, dict) and answer.get("kept") is False:
            return []
        return [(step.get("command"), step.get("input") or {}) for step in call["input"].get("steps", [])]
    if call["tool"] == "run_command":
        return [(call["input"].get("command"), call["input"].get("input") or {})]
    if call["tool"] in PLACING_TOOLS:
        return [("node.create", {})]
    if call["tool"] == "undo":
        return [("undo", {})]
    return []


def change_kind(command, step_input):
    """What a design command did to a draft: added, removed, moved, restyled, retexted, or None for frame and page work."""
    if command in ADDING:
        return "added"
    if command == "node.delete":
        return "removed"
    if command in MOVING:
        return "moved"
    if command in RESTYLING:
        return "restyled"
    if command in RETEXTING:
        return "retexted"
    if command == "undo":
        return "undone"
    if command in ("node.update", "frame.update"):
        patch = step_input.get("patch") or step_input.get("props") or step_input
        keys = set(patch) if isinstance(patch, dict) else set()
        if keys and keys <= BOX_KEYS | {"ids", "frameId", "id"}:
            return "moved"
        return "restyled"
    if command == "node.rename":
        return None
    return None


def pattern_use(calls):
    """Each apply_pattern Dazbee built: its pattern, style and sizes, and the changes the run made after it, by kind."""
    used = []
    for i, call in enumerate(calls):
        if call["tool"] != "apply_pattern" or call["error"]:
            continue
        answer = parsed(call)
        if not isinstance(answer, dict) or "frames" not in answer:
            continue
        changes = {}
        for later in calls[i + 1:]:
            if later["tool"] == "apply_pattern" and not later["error"]:
                break
            for command, step_input in steps_of(later):
                kind = change_kind(command, step_input)
                if kind:
                    changes[kind] = changes.get(kind, 0) + 1
        used.append({"pattern": call["input"].get("pattern"), "style": call["input"].get("style"),
                     "sizes": len(answer.get("frames", [])), "layers": sum(len(f.get("layers") or []) if isinstance(
                         f.get("layers"), list) else len(f.get("layers") or {}) for f in answer.get("frames", [])),
                     "changes": changes})
    return used


def counts_of(summary):
    frames = summary["frames"]
    families = sorted({font.rsplit(" ", 1)[0] if font.rsplit(" ", 1)[-1].isdigit() else font
                       for f in frames for font in f["fonts"]})
    fonts = sorted({font for f in frames for font in f["fonts"]})
    pictures = [p for f in frames for p in f["pictures"]]
    besides = [p for p in pictures if not p.get("logo", is_logo(p.get("name")))]
    unchecked = [f["id"] for f in frames if f["warnings"] is None]
    return {
        "frames": len(frames),
        "rendered": sum(1 for f in frames if f["picture"]),
        "families": families,
        "fonts": fonts,
        "pictures": len(pictures),
        "pictureNames": sorted({f"{p['name'] or p['asset']} ({p['from']})" for p in pictures}),
        "besidesLogo": len(besides),
        "besidesLogoNames": sorted({f"{p['name'] or p['asset']} ({p['from']})" for p in besides}),
        "noFontFile": summary.get("noFontFile", 0),
        "otherThanNoto": any(fam != "Noto Sans" for fam in families),
        "clean": not unchecked and all(not f["warnings"] for f in frames),
        "warningsLeft": sum(len(f["warnings"] or []) for f in frames),
        "framesNotChecked": unchecked,
        "refused": len(summary["refused"]),
        "minutes": round((summary["run"].get("seconds") or 0) / 60, 1),
        "turns": summary["run"].get("turns"),
    }


def summaries(out):
    found = []
    for path in sorted(out.glob("*/summary.json"), key=lambda p: int(p.parent.name)):
        found.append(json.loads(path.read_text(encoding="utf-8")))
    return found


def table(out):
    rows = ["| # | Brief | Frames | Fonts used | Pictures placed (from) | `check_frame` warnings left | Refused calls | Minutes |",
            "|---|---|---|---|---|---|---|---|"]
    for s in summaries(out):
        c = counts_of(s)
        pictures = f"{c['pictures']}: " + ", ".join(c["pictureNames"]) if c["pictures"] else "0"
        rows.append(f"| {s['n']} | {s['title']} | {c['frames']} | {', '.join(c['fonts']) or 'none'} | {pictures} | "
                    f"{c['warningsLeft']} | {c['refused']} | {c['minutes']} |")
    return "\n".join(rows)


def variety_table(out):
    rows = ["| # | Brief | Pattern (style) | Sizes built | Layers built | Changed after it |",
            "|---|---|---|---|---|---|"]
    for s in summaries(out):
        uses = s.get("pattern") or []
        if not uses:
            rows.append(f"| {s['n']} | {s['title']} | none: designed from scratch | | | |")
        for use in uses:
            changes = ", ".join(f"{count} {kind}" for kind, count in sorted(use["changes"].items())) or "nothing"
            rows.append(f"| {s['n']} | {s['title']} | {use['pattern']} ({use['style']}) | {use['sizes']} | {use['layers']} | "
                        f"{changes} |")
    return "\n".join(rows)


def variety(after):
    """The variety goal's counts over the after runs: runs using a pattern, those changed after it, and the briefs
    whose last pattern and style another brief shares with neither changed."""
    using = [s for s in after if s.get("pattern")]
    changed = [s for s in using if any(kind != "undone" for kind in s["pattern"][-1]["changes"])]
    unchanged = {}
    for s in using:
        last = s["pattern"][-1]
        if not any(kind != "undone" for kind in last["changes"]):
            unchanged.setdefault((last["pattern"], last["style"]), []).append(s["n"])
    alike = {f"{p} ({st})": ns for (p, st), ns in unchanged.items() if len(ns) > 1}
    return {"using": len(using), "changed": len(changed), "alike": alike,
            "patterns": {s["n"]: f"{s['pattern'][-1]['pattern']} ({s['pattern'][-1]['style']})" for s in using}}


def goal_counts(found):
    counts = [counts_of(s) for s in found]
    return {
        "runs": len(found),
        "pictures": sum(1 for c in counts if c["besidesLogo"] > 0),
        "type": sum(1 for c in counts if c["otherThanNoto"]),
        "noFontFile": sum(1 for c in counts if c["noFontFile"]),
        "clean": sum(1 for c in counts if c["clean"]),
        "refused": sum(c["refused"] for c in counts),
        "minutes": round(sum(c["minutes"] for c in counts), 1),
    }


def goals_table(root):
    before, after = summaries(root / "before"), summaries(root / "after")
    b, a = goal_counts(before), goal_counts(after)
    v = variety(after)
    alike = "none" if not v["alike"] else "; ".join(f"{k}: briefs {', '.join(map(str, ns))}" for k, ns in v["alike"].items())
    rows = ["| Goal | Target | Before | After |", "|---|---|---|---|",
            f"| Agents bring real pictures (photo, icon or sticker besides the logo) | 8 of 10 | {b['pictures']} of {b['runs']} | {a['pictures']} of {a['runs']} |",
            f"| Type with character (a family other than Noto Sans) | 8 of 10 | {b['type']} of {b['runs']} | {a['type']} of {a['runs']} |",
            f"| Runs told a catalog font has no file | 0 | {b['noFontFile']} | {a['noFontFile']} |",
            f"| No defects (`check_frame` clean on every frame) | 9 of 10 | {b['clean']} of {b['runs']} | {a['clean']} of {a['runs']} |",
            f"| Agent ads don't all look alike: runs changing the pattern's draft | 8 of the runs using one | no patterns | {v['changed']} of {v['using']} |",
            f"| Agent ads don't all look alike: briefs ending with the same pattern and style unchanged | none | no patterns | {alike} |",
            f"| Refused calls (all runs) | | {b['refused']} | {a['refused']} |",
            f"| Minutes (all runs) | | {b['minutes']} | {a['minutes']} |"]
    return "\n".join(rows)


def write_compare(root):
    """Both sets' counts, frames and briefs, for the comparison page."""
    sets = {}
    for name in ("before", "after"):
        sets[name] = {}
        for s in summaries(root / name):
            sets[name][s["n"]] = {"title": s["title"], "brief": s["brief"], "counts": counts_of(s),
                                  "pattern": s.get("pattern") or [],
                                  "frames": [{k: f[k] for k in ("id", "name", "width", "height", "picture", "warnings")}
                                             for f in s["frames"]]}
    data = {"sets": sets, "goals": {"before": goal_counts(summaries(root / "before")),
                                    "after": goal_counts(summaries(root / "after"))},
            "variety": variety(summaries(root / "after"))}
    (root / "compare.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


PAGE_STYLE = """
body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #f4f3f0; color: #1d1d1b; }
main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 80px; }
h1 { font-size: 28px; margin: 0 0 4px; }
.lede { color: #5b5a55; margin: 0 0 32px; }
section { background: #fff; border-radius: 12px; padding: 24px; margin: 0 0 28px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
h2 { font-size: 20px; margin: 0 0 8px; }
blockquote { margin: 0 0 16px; padding: 10px 14px; background: #f7f6f2; border-left: 3px solid #c9c4b5; white-space: pre-wrap; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 16px; }
dt { color: #5b5a55; } dd { margin: 0; }
.frames { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
figure { margin: 0; max-width: 100%; }
figure img { display: block; max-width: min(100%, 520px); max-height: 560px; border: 1px solid #ddd; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
figcaption { font-size: 13px; color: #5b5a55; margin-top: 6px; max-width: 520px; }
ul { margin: 4px 0 0; padding-left: 18px; }
.missing { padding: 40px; border: 1px dashed #bbb; color: #888; }
"""


def write_page(out, set_name):
    parts = [f"<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
             f"<title>Agents' ads: the {set_name} runs</title><style>{PAGE_STYLE}</style></head><body><main>",
             f"<h1>Agents' ads: the {set_name} runs</h1>",
             "<p class='lede'>Ten marketer briefs, each run by headless Claude Code through Dazbee's MCP server, "
             "in the brand named Ikea. Each design is shown frame by frame as it ended, with the brief above it and what was counted.</p>"]
    for s in summaries(out):
        c = counts_of(s)
        e = html.escape
        refused = "".join(f"<li><b>{e(r['tool'])}</b>: {e(r['sentence'])}</li>" for r in s["refused"])
        parts.append(f"<section id='run-{s['n']}'><h2>{s['n']}. {e(s['title'])}</h2><blockquote>{e(s['brief'])}</blockquote><dl>"
                     f"<dt>Design</dt><dd>{e(s['design']['name'] or '')}{'' if s['design']['found'] else ' (not found)'}</dd>"
                     f"<dt>Fonts used</dt><dd>{e(', '.join(c['fonts']) or 'none')}</dd>"
                     f"<dt>Pictures placed</dt><dd>{c['pictures']}{': ' + e(', '.join(c['pictureNames'])) if c['pictures'] else ''}</dd>"
                     f"<dt>Warnings left</dt><dd>{c['warningsLeft']}{' (not checked: ' + e(', '.join(c['framesNotChecked'])) + ')' if c['framesNotChecked'] else ''}</dd>"
                     f"<dt>Refused calls</dt><dd>{c['refused']}{'<ul>' + refused + '</ul>' if refused else ''}</dd>"
                     f"<dt>Run</dt><dd>{c['minutes']} min, {c['turns']} turns, {s['toolCalls']} tool calls, {s['looked']} pictures looked at</dd>"
                     "</dl><div class='frames'>")
        for f in s["frames"]:
            warnings = "".join(f"<li>{e(str(w if isinstance(w, str) else w.get('message', json.dumps(w))))}</li>" for w in f["warnings"] or [])
            picture = (f"<img src='{s['n']}/{f['picture']}' alt='{e(f['name'] or f['id'])}' loading='lazy'>" if f["picture"]
                       else "<div class='missing'>not rendered</div>")
            parts.append(f"<figure>{picture}<figcaption>{e(f['name'] or f['id'])}, {f['width']}×{f['height']}"
                         f"{'<ul>' + warnings + '</ul>' if warnings else ''}</figcaption></figure>")
        parts.append("</div></section>")
    parts.append("</main></body></html>")
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")


if __name__ == "__main__":
    main()
