"""PROTOTYPE, never merged. The call the model wrote in its reasoning line, before the engine's
repair step and grounding gates changed or withheld it.

The tuned model states its call in its reasoning line (`group_layers: action "ungroup".`), then
writes the call. The engine then repairs arguments from the request's words, which undoes right
answers ("release it from its group" names "group", so `ungroup` becomes `group`; "square off the
corners" names no number, so radius 0 becomes the default 16), and withholds some right calls
into suppressed_calls. The reasoning line keeps what the model meant.
"""
import json
import re

from tools import TOOL

_ARG = re.compile(r'([a-z_]+) ("(?:[^"\\]|\\.)*"|-?\d+|true|false)')


def from_reasoning(text):
    """The call in a reasoning line: a list of one call, [] for a refusal, None if unreadable."""
    if not text:
        return None
    t = text.strip()
    if t.startswith("No tool here"):
        return []
    m = re.match(r"^([a-z_]+), no arguments\.$", t)
    if m:
        return [{"name": m.group(1), "arguments": {}}]
    m = re.match(r"^([a-z_]+): (.*)\.$", t)
    if not m:
        return None
    return [{"name": m.group(1), "arguments": {k: json.loads(v) for k, v in _ARG.findall(m.group(2))}}]


def valid(call, tools):
    """Whether a call fits one of the turn's tool schemas (name, enum, bounds, required)."""
    tool = next((t for t in tools if t["name"] == call["name"]), None)
    if not tool:
        return False
    props = tool["parameters"]["properties"]
    for k in tool["parameters"]["required"]:
        if k not in call["arguments"]:
            return False
    for k, v in call["arguments"].items():
        spec = props.get(k)
        if spec is None:
            return False
        if "enum" in spec and v not in spec["enum"]:
            return False
        if spec.get("type") == "integer":
            if not isinstance(v, int) or isinstance(v, bool):
                return False
            if not spec.get("minimum", -10 ** 9) <= v <= spec.get("maximum", 10 ** 9):
                return False
        if spec.get("type") == "boolean" and not isinstance(v, bool):
            return False
        if spec.get("pattern") and not (isinstance(v, str) and re.match(spec["pattern"], v)):
            return False
    return True


def turn_call(turn, tools, include_held=False):
    """A turn's call as the model meant it: from its reasoning line when that is a valid call or a
    refusal, else the engine's call (and, with include_held, the call the engine withheld)."""
    if not turn:
        return []
    r = from_reasoning(turn.get("reasoning"))
    if r == []:
        return []
    if r and valid(r[0], tools):
        return r
    return (turn.get("calls") or (turn.get("held") if include_held else None) or [])[:1]
