"""PROTOTYPE, never merged. Round 2's training and validation rows for every model: the requests
written through the ChatGPT plan (data/gen) plus round 1's templated requests, as outcome classes.

Validation holds out a fixed tenth of the generated rows (the same for every model, by a hash
of the request) plus round 1's validation split; round 1's other splits train. The frozen test set is never read here except to drop any request
that equals one of its requests.
"""
import glob
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R2 = os.path.dirname(HERE)
sys.path.insert(0, R2)
sys.path.insert(0, os.path.dirname(R2))

from outcomes import NONE, outcome_of, read_test  # noqa: E402

TESTS = [os.path.join(R2, "data", p) for p in ("test.frozen.txt", "test2.frozen.txt")]


def _held(text):
    return int(hashlib.sha256(text.lower().encode()).hexdigest()[:8], 16) % 10 == 0


def load(gen_dir=os.path.join(R2, "data", "gen"), r1_dir=os.path.join(os.path.dirname(R2), "data"),
         with_r1=True):
    """(train, validation) lists of {query, cls, value, source}."""
    test = {r["query"].lower() for path in TESTS for r in read_test(path)}
    train, val, seen = [], [], set()
    for path in sorted(glob.glob(os.path.join(gen_dir, "*.jsonl"))):
        for line in open(path, encoding="utf-8"):
            r = json.loads(line)
            q = r["query"]
            if q.lower() in test or q.lower() in seen:
                continue
            seen.add(q.lower())
            row = {"query": q, "cls": r["cls"], "value": r.get("value"), "source": "gen",
                   "category": r.get("category", "action")}
            (val if _held(q) else train).append(row)
    if with_r1:
        for split, dest in [("train", train), ("calib", train), ("test", train), ("validation", val)]:
            path = os.path.join(r1_dir, f"{split}.queries.jsonl")
            if not os.path.exists(path):
                continue
            for line in open(path, encoding="utf-8"):
                r = json.loads(line)
                q = r["query"]
                if q.lower() in test or q.lower() in seen:
                    continue
                seen.add(q.lower())
                cls, value = outcome_of(r["answers"])
                if cls is None:
                    continue
                dest.append({"query": q, "cls": cls, "value": value if cls != NONE else None,
                             "source": "r1", "category": r.get("category", "action")})
    return train, val


if __name__ == "__main__":
    from collections import Counter
    tr, va = load()
    print("train", len(tr), Counter(r["source"] for r in tr), "none", sum(r["cls"] == NONE for r in tr))
    print("val", len(va), Counter(r["source"] for r in va), "none", sum(r["cls"] == NONE for r in va))
    c = Counter(r["cls"] for r in tr)
    print("smallest classes", c.most_common()[-8:])
