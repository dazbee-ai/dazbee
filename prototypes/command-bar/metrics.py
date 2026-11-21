"""PROTOTYPE, never merged. Scores result files from score.py.

  python metrics.py results/r16-L20-test.jsonl [--conf min|prod|c2] [--threshold 0.6]
  python metrics.py --pick results/x-validation.jsonl --target 0.01   (choose the threshold)

A request's final call is turn two's call after turn one picked an area; no call otherwise.
"Exact" means the same tool and the same arguments; a request needing no call is exact when
none comes back. The bar acts on its own when there is a call and its confidence reaches the
threshold; a wrong action is one it acts on that is not exact.
"""
import argparse
import json
import math


def norm_value(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and v.startswith("#"):
        return v.upper()
    return v


def canon(calls):
    return sorted(json.dumps({"name": c.get("name"),
                              "arguments": {k: norm_value(v) for k, v in (c.get("arguments") or {}).items()}},
                             sort_keys=True) for c in calls)


def final_call(row):
    r1, r2 = row["r1"], row.get("r2")
    if not r1["calls"] or not r2 or not r2["calls"]:
        return []
    return r2["calls"][:1] if len(r2["calls"]) >= 1 else []


def confidence(row, how="min"):
    c1 = row["r1"].get("conf")
    c2 = (row.get("r2") or {}).get("conf")
    c1 = 1.0 if c1 is None else c1
    c2 = 1.0 if c2 is None else c2
    if how == "c2":
        return c2
    if how == "prod":
        return c1 * c2
    if how == "head":
        return row.get("head_conf", min(c1, c2))
    return min(c1, c2)


def load(path):
    return [json.loads(line) for line in open(path, encoding="utf-8")]


def auroc(pos, neg):
    if not pos or not neg:
        return float("nan")
    pairs = sorted([(s, 1) for s in pos] + [(s, 0) for s in neg])
    rank_sum, i = 0.0, 0
    while i < len(pairs):
        j = i
        while j < len(pairs) and pairs[j][0] == pairs[i][0]:
            j += 1
        avg = (i + j + 1) / 2
        rank_sum += avg * sum(1 for k in range(i, j) if pairs[k][1] == 1)
        i = j
    return (rank_sum - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def ece(scores, labels, bins=10):
    total, err = len(scores), 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        idx = [i for i, s in enumerate(scores) if (lo <= s < hi) or (b == bins - 1 and s == 1.0)]
        if idx:
            acc = sum(labels[i] for i in idx) / len(idx)
            conf = sum(scores[i] for i in idx) / len(idx)
            err += len(idx) / total * abs(acc - conf)
    return err


def evaluate(rows, how="min", threshold=None):
    n = len(rows)
    on = [r for r in rows if r["answers"]]
    off = [r for r in rows if not r["answers"]]
    exact = [canon(final_call(r)) == canon(r["answers"]) for r in rows]
    called = [(confidence(r, how), e) for r, e in zip(rows, exact) if final_call(r)]
    route_ok = sum(1 for r in on if r["r1"]["calls"] and r["r1"]["calls"][0]["name"] == r["area"])
    out = {
        "n": n,
        "exact": sum(exact) / n,
        "exact_on_topic": sum(e for r, e in zip(rows, exact) if r["answers"]) / max(1, len(on)),
        "refused_off_topic": sum(e for r, e in zip(rows, exact) if not r["answers"]) / max(1, len(off)),
        "router_on_topic": route_ok / max(1, len(on)),
        "calls_made": len(called),
        "auroc": auroc([s for s, e in called if e], [s for s, e in called if not e]),
        "ece": ece([s for s, _ in called], [int(e) for _, e in called]) if called else float("nan"),
    }
    ms = [r["r1"]["ms"] + ((r.get("r2") or {}).get("ms") or 0) for r in rows]
    out["ms_mean"] = sum(ms) / n
    out["ms_p95"] = sorted(ms)[int(0.95 * (n - 1))]
    if threshold is not None:
        acted = [(s, e) for s, e in called if s >= threshold]
        wrong = sum(1 for _, e in acted if not e)
        out.update(threshold=threshold, acted=len(acted), acted_rate=len(acted) / n,
                   acted_rate_on_topic=sum(1 for s, e in acted if e) / max(1, len(on)),
                   wrong_actions=wrong, wrong_rate_of_acted=wrong / max(1, len(acted)),
                   wrong_per_100_requests=100 * wrong / n)
    return out


def curve(rows, how="min", steps=None):
    """Risk and coverage at each threshold: acted share of all requests, wrong share of acted."""
    exact = [canon(final_call(r)) == canon(r["answers"]) for r in rows]
    called = sorted(((confidence(r, how), e) for r, e in zip(rows, exact) if final_call(r)), reverse=True)
    pts = []
    thresholds = steps or sorted({round(s, 4) for s, _ in called}, reverse=True)
    for t in thresholds:
        acted = [e for s, e in called if s >= t]
        if acted:
            pts.append({"t": t, "coverage": len(acted) / len(rows),
                        "risk": 1 - sum(acted) / len(acted), "acted": len(acted),
                        "wrong": len(acted) - sum(acted)})
    return pts


def pick(rows, how="min", target=0.01):
    """The threshold acting on the most requests while wrong actions stay at or under target."""
    best = None
    for p in curve(rows, how):
        if p["risk"] <= target and (best is None or p["acted"] > best["acted"]):
            best = p
    return best


def candidates(row):
    """Every call turn two wrote, in each area (score.py --every-area), best confidence first."""
    out = []
    picked = row["r1"]["calls"][0]["name"] if row["r1"]["calls"] else None
    turns = dict(row.get("others") or {})
    if picked and row.get("r2"):
        turns[picked] = row["r2"]
    for area, t in turns.items():
        made = t["calls"] or t["held"]
        if made and t.get("conf") is not None:
            out.append((t["conf"], made[0]))
    seen, ranked = set(), []
    for conf, call in sorted(out, key=lambda x: -x[0]):
        key = canon([call])[0]
        if key not in seen:
            seen.add(key)
            ranked.append((conf, call))
    return ranked


def fallback(rows, how="min", threshold=0.5):
    """Requests the bar does not act on: how often the right call is among its two best guesses
    (turn two run in every area, ranked by confidence), and how often it shows nothing."""
    exact = [canon(final_call(r)) == canon(r["answers"]) for r in rows]
    held = [r for r, e in zip(rows, exact)
            if not (final_call(r) and confidence(r, how) >= threshold)]
    on = [r for r in held if r["answers"]]
    top2 = sum(1 for r in on if canon(r["answers"])[0] in [canon([c])[0] for _, c in candidates(r)[:2]])
    top1 = sum(1 for r in on if canon(r["answers"])[0] in [canon([c])[0] for _, c in candidates(r)[:1]])
    return {"not_acted": len(held), "not_acted_on_topic": len(on),
            "gold_in_top1": top1 / max(1, len(on)), "gold_in_top2": top2 / max(1, len(on)),
            "off_topic_not_acted": len(held) - len(on)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--conf", default="min")
    ap.add_argument("--threshold", type=float)
    ap.add_argument("--pick")
    ap.add_argument("--target", type=float, default=0.01)
    args = ap.parse_args()
    if args.pick:
        print(json.dumps(pick(load(args.pick), args.conf, args.target)))
    for path in args.paths:
        print(path, json.dumps(evaluate(load(path), args.conf, args.threshold)))


if __name__ == "__main__":
    main()
