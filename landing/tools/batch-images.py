#!/usr/bin/env python3
"""Generate the sprite images in raw/isometric raw/batch-prompts.json with the OpenAI Images API.

Run from landing/:   python3 tools/batch-images.py --test     (first 2 images only)
                     python3 tools/batch-images.py            (all the rest)
                     python3 tools/batch-images.py --dry      (list what it would make, no calls)
                     python3 tools/batch-images.py --models   (only show which model it would use)
                     --model=<id> forces a model; otherwise it uses the newest gpt-image model the key can access.

- The key is read from raw/isometric raw/.env.local (or .env next to it): OPENAI_API_KEY=...
  It is never printed or written anywhere else.
- Every image is asked for with a transparent background, as a PNG.
- Each one is saved under its save_to path (relative to landing/) with its proper name.
- New images are skipped if their file already exists, so it is safe to run again.
- Images marked "regenerate" replace the old file; the old one is moved to raw/archive/<name>-old.png first
  (and moved back if the call fails). Once raw/archive has the -old copy, it counts as done.
- Stops at once on a key, billing or quota error, and after 3 failures in a row.
"""
import base64, json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
LANDING = os.path.dirname(HERE)
SRC = os.path.join(LANDING, 'raw', 'isometric raw')
ARCHIVE = os.path.join(LANDING, 'raw', 'archive')
LOG = os.path.join(LANDING, 'raw', 'batch-log.txt')

def key(var='OPENAI_API_KEY'):
    for name in ('.env.local', '.env'):
        p = os.path.join(SRC, name)
        if os.path.exists(p):
            for line in open(p, encoding='utf-8'):
                line = line.strip()
                if line.startswith(var + '='):
                    k = line.split('=', 1)[1].strip().strip('"').strip("'")
                    if k: return k
    sys.exit(f'No key found. Put {var}=sk-... in raw/isometric raw/.env.local and save the file.')

def log(msg):
    print(msg, flush=True)
    with open(LOG, 'a', encoding='utf-8') as f: f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')

def pick_model(k, fallback):
    """Newest full gpt-image model this key can use (skips mini/dated snapshots). Falls back to the json's model."""
    try:
        req = urllib.request.Request('https://api.openai.com/v1/models', headers={'Authorization': 'Bearer ' + k})
        with urllib.request.urlopen(req, timeout=60) as r:
            models = json.load(r)['data']
    except Exception as e:
        log(f'could not list models ({type(e).__name__}), using {fallback}'); return fallback
    import re
    imgs = [m for m in models if m['id'].startswith('gpt-image') and 'mini' not in m['id'] and not re.search(r'\d{4}-\d{2}-\d{2}$', m['id'])]
    if not imgs: return fallback
    def ver(i):
        v = re.match(r'gpt-image-(\d+(?:\.\d+)?)', i)
        return float(v.group(1)) if v else 0
    imgs.sort(key=lambda m: (ver(m['id']), m.get('created', 0)))
    return imgs[-1]['id']

OR_MODEL = None   # set by --openrouter=<model>: send to OpenRouter instead of OpenAI (never falls back to OpenAI)
LAST_COST = None

def generate_or(k, model, it):
    global LAST_COST
    w, h = (int(x) for x in it['size'].split('x'))
    body = json.dumps({'model': model, 'prompt': it['prompt'], 'size': it['size'], 'quality': it.get('quality', 'high'),
                       'background': 'opaque' if it.get('background') == 'opaque' else 'transparent',
                       'output_format': 'png', 'n': 1, 'response_format': 'b64_json'}).encode()
    req = urllib.request.Request('https://openrouter.ai/api/v1/images', data=body,
                                 headers={'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=600) as r:
        j = json.load(r)
    LAST_COST = (j.get('usage') or {}).get('cost')
    item = j['data'][0]
    if item.get('b64_json'): return base64.b64decode(item['b64_json'])
    with urllib.request.urlopen(item['url'], timeout=120) as r2: return r2.read()

def generate(k, model, it):
    if OR_MODEL: return generate_or(k, model, it)
    body = json.dumps({'model': model, 'prompt': it['prompt'], 'size': it['size'], 'quality': it.get('quality', 'high'),
                       'background': it.get('background', 'transparent') if it.get('background') in ('transparent', 'opaque') else ('opaque' if 'no transparency' in str(it.get('background')) else 'transparent'), 'output_format': 'png', 'n': 1}).encode()
    req = urllib.request.Request('https://api.openai.com/v1/images/generations', data=body,
                                 headers={'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return base64.b64decode(json.load(r)['data'][0]['b64_json'])

def main():
    args = sys.argv[1:]
    pf = next((a.split('=', 1)[1] for a in args if a.startswith('--prompts=')), None)
    data = json.load(open(os.path.join(LANDING, pf) if pf else os.path.join(SRC, 'batch-prompts.json'), encoding='utf-8'))
    todo = []
    for it in data['items']:
        out = os.path.join(LANDING, it['save_to'])
        regen = it.get('why', '').startswith('regenerate')
        old = os.path.join(ARCHIVE, it['file'].rsplit('.', 1)[0] + '-old.png')
        if regen and os.path.exists(old): continue
        if not regen and os.path.exists(out): continue
        todo.append((it, out, regen, old))
    only = next((a.split('=', 1)[1] for a in args if a.startswith('--only=')), None)
    if only: todo = [t for t in todo if t[0]['file'] == only]
    if '--test' in args: todo = todo[:2]
    print(f'{len(todo)} to make' + (' (test run)' if '--test' in args else ''))
    if '--dry' in args:
        for it, out, regen, _ in todo: print(('  regenerate ' if regen else '  new        ') + it['save_to'])
        return
    global OR_MODEL
    OR_MODEL = next((a.split('=', 1)[1] for a in args if a.startswith('--openrouter=')), None)
    k = key(next((a.split('=', 1)[1] for a in args if a.startswith('--key-var=')), 'OPENROUTER_API_KEY' if OR_MODEL else 'OPENAI_API_KEY')); fails = 0; made = 0
    model = OR_MODEL or next((a.split('=', 1)[1] for a in args if a.startswith('--model=')), None) or pick_model(k, data.get('model', 'gpt-image-1'))
    log(f'model: {model}')
    if '--models' in args: return
    for n, (it, out, regen, old) in enumerate(todo, 1):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        moved = False
        if regen and os.path.exists(out):
            os.makedirs(ARCHIVE, exist_ok=True); os.rename(out, old); moved = True
        t0 = time.time()
        try:
            png = generate(k, model, it)
            with open(out, 'wb') as f: f.write(png)
            made += 1; fails = 0
            log(f'[{n}/{len(todo)}] ok   {it["save_to"]}  ({time.time() - t0:.0f}s)  model={model}  cost=' + (f'${LAST_COST}' if OR_MODEL and LAST_COST is not None else 'n/a'))
        except urllib.error.HTTPError as e:
            if moved: os.rename(old, out)
            try: err = json.load(e).get('error', {})
            except Exception: err = {}
            log(f'[{n}/{len(todo)}] FAIL {it["save_to"]}  HTTP {e.code}: {err.get("message", "")[:200]}')
            if e.code in (401, 403) or err.get('code') in ('insufficient_quota', 'billing_hard_limit_reached', 'invalid_api_key'):
                sys.exit('Stopped: the key, billing or quota was refused. Nothing more was sent.')
            fails += 1
            if e.code == 429: time.sleep(30)
        except Exception as e:
            if moved: os.rename(old, out)
            log(f'[{n}/{len(todo)}] FAIL {it["save_to"]}  {type(e).__name__}: {str(e)[:200]}')
            fails += 1
        if fails >= 3: sys.exit('Stopped after 3 failures in a row.')
    log(f'done: {made} made, {len(todo) - made} not made')

main()
