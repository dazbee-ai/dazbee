"""PROTOTYPE, never merged. The confidence trade-off: picks the auto-act threshold on validation
and reports what it does on test.

  python confidence_report.py --val results/m-L20-validation-every.jsonl \
      --test results/m-L20-test-every.jsonl --out reports/confidence-m.json

For each way of joining the two turns' confidence (min, product, action turn only) and each
target share of wrong actions (1%, 2%), the threshold acting on the most validation requests
while staying at or under the target; then that threshold on test, with the fallback (best two
guesses) for the requests it does not act on, and the risk-coverage curve on test.
"""
import argparse
import json

from metrics import curve, evaluate, fallback, load, pick

STEPS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.925, 0.95, 0.97, 0.98, 0.99, 0.995, 0.999]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--val", required=True)
    ap.add_argument("--test", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    val, test = load(args.val), load(args.test)
    out = {"val_file": args.val, "test_file": args.test, "choices": []}
    for how in ("min", "prod", "c2"):
        for target in (0.01, 0.02):
            p = pick(val, how, target)
            if not p:
                out["choices"].append({"conf": how, "target": target, "threshold": None})
                continue
            t = p["t"]
            out["choices"].append({
                "conf": how, "target": target, "threshold": t,
                "validation": evaluate(val, how, t), "test": evaluate(test, how, t),
                "test_fallback": fallback(test, how, t)})
        out[f"test_curve_{how}"] = curve(test, how, STEPS)
        out[f"val_curve_{how}"] = curve(val, how, STEPS)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
    for c in out["choices"]:
        if c["threshold"] is None:
            print(c)
            continue
        v, t, fb = c["validation"], c["test"], c["test_fallback"]
        print(f"{c['conf']:5s} target {c['target']:.0%}: t={c['threshold']:.4f} | val acted {v['acted_rate']:.3f} "
              f"wrong {v['wrong_rate_of_acted']:.3%} | test acted {t['acted_rate']:.3f} (on-topic right "
              f"{t['acted_rate_on_topic']:.3f}) wrong {t['wrong_actions']}/{t['acted']} = {t['wrong_rate_of_acted']:.3%} "
              f"| fallback top2 {fb['gold_in_top2']:.3f} of {fb['not_acted_on_topic']}")


if __name__ == "__main__":
    main()
