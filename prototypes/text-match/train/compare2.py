"""PROTOTYPE. The round 3 runs side by side, as Markdown: for each run, its checkpoint chosen on the realistic
development sets and that checkpoint's face and family top-1 / top-25 on each set, with its size.

    python train/compare2.py models/r3-ours models/r3-resnet18 ...
"""

import json
import os
import sys


def pct(v):
    return "–" if v is None or v != v else f"{100 * v:.1f}"


rows = []
for run in sys.argv[1:]:
    log = json.load(open(os.path.join(run, "log.json")))
    best = max(log, key=lambda e: e["select"])
    fin = json.load(open(os.path.join(run, "finish.json"))) if os.path.exists(os.path.join(run, "finish.json")) else {}
    rows.append((os.path.basename(run), len(log), best, fin))

print("| Run | Epochs run | Chosen epoch | Score (mean of own and LICA face/family top-1) | Own face top-1 / top-25 | Own family top-1 / top-25 | LICA face top-1 / top-25 | LICA family top-1 / top-25 | Synthetic face / family top-1 | Strips (val) face / family top-1 | Minutes an epoch |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for name, n, b, fin in rows:
    print(
        f"| {name} | {n} | {b['epoch']} | {pct(b['select'])} | {pct(b['own_face1'])} / {pct(b['own_face25'])} | {pct(b['own_fam1'])} / {pct(b['own_fam25'])} | "
        f"{pct(b['lica_face1'])} / {pct(b['lica_face25'])} | {pct(b['lica_fam1'])} / {pct(b['lica_fam25'])} | {pct(b['synthetic_face1'])} / {pct(b['synthetic_fam1'])} | "
        f"{pct(b['val_face1'])} / {pct(b['val_fam1'])} | {b['epoch_seconds'] / 60:.1f} |"
    )
print()
for name, n, b, fin in rows:
    if "choose" in fin:
        ch = fin["choose"]
        parts = [f"{k}: {pct(v['select'])}" for k, v in ch.items() if isinstance(v, dict)]
        print(f"- {name} (epoch {fin['epoch']}), extras by score: " + "; ".join(parts) + f"; gallery chosen: {ch['best_gallery']}")
    if "int8" in fin:
        i8 = fin["int8"]
        print(f"- {name} int8: {i8['bytes'] / 2**20:.1f} MB, score {pct(i8['int8']['select'])} against float {pct(i8['float']['select'])}")
    if "export" in fin:
        print(f"- {name} float ONNX: {fin['export']['onnx_bytes'] / 2**20:.1f} MB, {fin['export']['params'] / 1e6:.2f} M parameters")
