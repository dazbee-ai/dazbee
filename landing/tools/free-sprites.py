# Sprites that stand on a point instead of a lot (people, vehicles, trees, lamps, benches).
# usage: python3 tools/free-sprites.py art/city public/sprites/city src/scenes/town-free.js
# Each one is trimmed to its picture and scaled to a set on-screen size (css px), stored at 3x for sharp close shots.
# It is drawn with its bottom centre on its spot. walk-b's "se" art faces the wrong way, so its sw art is mirrored for se.
import sys, os, json
from PIL import Image, ImageOps
src, out, js = sys.argv[1:4]
S = 3
SIZE = {  # name: ('h' or 'w', css px)
  'people/p-walk-a-se': ('h', 42), 'people/p-walk-a-sw': ('h', 42), 'people/p-walk-b-sw': ('h', 42),
  'people/p-dog-se': ('h', 42), 'people/p-dog-sw': ('h', 42), 'people/p-buggy-se': ('h', 42), 'people/p-buggy-sw': ('h', 42),
  'people/p-runner-se': ('h', 42), 'people/p-runner-sw': ('h', 42),
  'people/p-talk-pointing': ('h', 46), 'people/p-talk-waving': ('h', 46), 'people/p-talk-phone': ('h', 46), 'people/p-cafe': ('h', 42),
  'vehicles/v-hatchback-red-se': ('w', 84), 'vehicles/v-hatchback-red-sw': ('w', 84),
  'vehicles/v-hatchback-cream-se': ('w', 84), 'vehicles/v-hatchback-cream-sw': ('w', 84),
  'vehicles/v-taxi-se': ('w', 84), 'vehicles/v-taxi-sw': ('w', 84), 'vehicles/v-van-se': ('w', 96), 'vehicles/v-van-sw': ('w', 96),
  'vehicles/v-bus-se': ('w', 150), 'vehicles/v-bus-sw': ('w', 150),
  'nature/n-tree-round': ('h', 104), 'nature/n-tree-tall': ('h', 140), 'nature/n-lamp': ('h', 58), 'nature/n-bench': ('w', 40),
  'people/p-tote-se': ('h', 42), 'people/p-tote-sw': ('h', 42),
  'people/p-coffee-se': ('h', 42), 'people/p-coffee-sw': ('h', 42),
  'people/p-headphones-se': ('h', 42), 'people/p-headphones-sw': ('h', 42),
  'people/p-couple-se': ('h', 42), 'people/p-couple-sw': ('h', 42),
  'people/p-parent-child-se': ('h', 42), 'people/p-parent-child-sw': ('h', 42),
  'people/p-shopping-se': ('h', 42), 'people/p-shopping-sw': ('h', 42),
  'people/p-phone-walk-se': ('h', 42), 'people/p-phone-walk-sw': ('h', 42),
  'people/p-dog-walker-se': ('h', 42), 'people/p-dog-walker-sw': ('h', 42),
  'people/p-jogger-se': ('h', 42), 'people/p-jogger-sw': ('h', 42),
  'people/p-skater-se': ('h', 38), 'people/p-skater-sw': ('h', 38),
  'people/p-cyclist-se': ('h', 48), 'people/p-cyclist-sw': ('h', 48),
  'people/p-suit-se': ('h', 42), 'people/p-suit-sw': ('h', 42),
  'street/s-column': ('h', 64), 'street/s-traffic-light': ('h', 66), 'street/s-aframe': ('h', 20), 'street/s-board-tall': ('h', 78),
  'nature/n-planter': ('w', 44), 'nature/n-umbrella-table': ('w', 44),
  'edge/e-boat-sail': ('w', 110), 'edge/e-ferry': ('w', 170),
  'sky/k-cloud-a': ('w', 700), 'sky/k-cloud-b': ('w', 560), 'sky/k-cloud-c': ('w', 760),
}
MIRROR = {'people/p-walk-b-se': 'people/p-walk-b-sw', 'people/p-tote-sw': 'people/p-tote', 'people/p-coffee-sw': 'people/p-coffee', 'people/p-headphones-sw': 'people/p-headphones', 'people/p-couple-sw': 'people/p-couple', 'people/p-parent-child-sw': 'people/p-parent-child', 'people/p-shopping-sw': 'people/p-shopping', 'people/p-phone-walk-sw': 'people/p-phone-walk', 'people/p-dog-walker-sw': 'people/p-dog-walker', 'people/p-jogger-sw': 'people/p-jogger', 'people/p-skater-sw': 'people/p-skater', 'people/p-cyclist-sw': 'people/p-cyclist', 'people/p-suit-sw': 'people/p-suit'}
# v3.6: the new people are drawn once (facing down-right); -se is the art as is, -sw its mirror
ALIAS = {'people/p-tote-se': 'people/p-tote', 'people/p-coffee-se': 'people/p-coffee', 'people/p-headphones-se': 'people/p-headphones', 'people/p-couple-se': 'people/p-couple', 'people/p-parent-child-se': 'people/p-parent-child', 'people/p-shopping-se': 'people/p-shopping', 'people/p-phone-walk-se': 'people/p-phone-walk', 'people/p-dog-walker-se': 'people/p-dog-walker', 'people/p-jogger-se': 'people/p-jogger', 'people/p-skater-se': 'people/p-skater', 'people/p-cyclist-se': 'people/p-cyclist', 'people/p-suit-se': 'people/p-suit'}
meta = {}
for key in list(SIZE) + list(MIRROR):
  f = f'{src}/{ALIAS.get(key, MIRROR.get(key, key))}.png'
  if not os.path.exists(f): continue
  im = Image.open(f).convert('RGBA')
  im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox())
  if key in MIRROR: im = ImageOps.mirror(im)
  side, v = SIZE.get(key, SIZE.get(MIRROR.get(key)))
  k = v / (im.height if side == 'h' else im.width)
  w, h = im.width * k, im.height * k
  im = im.resize((max(1, round(w * S)), max(1, round(h * S))), Image.LANCZOS)
  os.makedirs(f'{out}/{os.path.dirname(key)}', exist_ok=True)
  im.save(f'{out}/{key}.webp', quality=86, method=6)
  meta[os.path.basename(key)] = {'src': f'/sprites/city/{key}.webp', 'w': round(w, 1), 'h': round(h, 1)}
open(js, 'w').write('// made by tools/free-sprites.py: sprites that stand on a point; w x h in css px, drawn with the bottom centre on the spot\nexport const FREE = ' + json.dumps(meta, indent=1) + ';\n')
print(len(meta), 'free sprites')
