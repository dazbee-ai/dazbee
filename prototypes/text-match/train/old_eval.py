"""PROTOTYPE. Round 2's fingerprint model (32-px strips, 128-px windows) measured on the same realistic
development sets as round 3's runs (exported at 32 px), for a before-and-after at the fingerprint level.

    python train/old_eval.py --model models/big-w48-p96 --proto samples/lib-proto8 --dev samples/own-dev32,samples/lica-dev32,samples/synthetic-dev32
"""

import argparse
import json
import os

import torch

from evaluate2 import Evaluator
from train import Fingerprint


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--proto", required=True)
    p.add_argument("--dev", required=True)
    a = p.parse_args()
    dev = torch.device("cuda")
    args = json.load(open(os.path.join(a.model, "metrics.json")))["args"]
    model = Fingerprint(args["width"], args["dim"])
    model.load_state_dict(torch.load(os.path.join(a.model, "model.pt"), map_location="cpu"))
    model = model.to(dev).eval()
    faces = json.load(open(os.path.join(a.proto, "meta.json")))["faces"]
    ev = Evaluator(a.proto, None, a.dev.split(","), faces, dev, win=128)
    print(json.dumps({k: round(v, 4) for k, v in ev.run(model).items()}))


if __name__ == "__main__":
    main()
