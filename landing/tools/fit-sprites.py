# Fit check + warp for the iso object art, so every piece snaps onto the city grid.
# usage: python3 tools/fit-sprites.py art/city public/sprites/city src/scenes/town-sprites.js [debug_dir]
#
# For each image: find the two bottom edges of its ground slab (the lower outline of the picture), then shear and scale
# it so those edges sit exactly on the 2:1 tile grid for the footprint below (W tiles along x, D tiles along y; the
# W edge runs up-left from the nearest corner, the D edge up-right). Vertical lines stay vertical. If an image needs
# more than a small correction it is flagged, so it can be regenerated instead of forced in.
# Output: webp at 128 px per half tile (one tile = 256 px wide), anchored at the footprint's nearest corner.
import sys, os, json, numpy as np
from PIL import Image

FOOT = {  # name: (W, D)  W runs up-left from the nearest corner, D up-right
  'buildings/b-house-a': (2, 2), 'buildings/b-house-b': (2, 2), 'buildings/b-market': (3, 3),
  'buildings/b-office-tower': (3, 3), 'buildings/b-apartments': (2, 3), 'buildings/b-gym': (2, 3),
  'buildings/b-shop-row': (2, 3), 'street/s-kiosk': (1, 1), 'street/s-bus-shelter': (1, 2),
  'street/s-billboard-wide': (1, 4),
  # variants and landmarks (prompt "a x b tiles" -> (b, a), like the ones above)
  'buildings/b-office-tower-glass': (3, 3), 'buildings/b-shop-row-b': (2, 3), 'buildings/b-apartments-brick': (2, 3),
  'buildings/b-house-c': (2, 2), 'buildings/b-house-d': (2, 2), 'buildings/b-corner-cafe': (2, 2), 'buildings/b-hotel': (3, 3),
  'landmarks/l-town-hall': (5, 5), 'landmarks/l-library': (4, 4), 'landmarks/l-museum': (4, 5), 'landmarks/l-school': (3, 5),
  'landmarks/l-cinema': (3, 3), 'landmarks/l-station': (3, 6),
  'nature/n-fountain': (2, 2), 'nature/n-flowerbed': (1, 1), 'nature/n-hedge': (1, 2),
  'buildings/b-pharmacy': (2, 2), 'buildings/b-salon': (2, 2), 'buildings/b-yoga': (2, 3), 'buildings/b-supermarket': (3, 3),
  'buildings/b-flats-pastel': (2, 3), 'buildings/b-tower-teal': (3, 3), 'buildings/b-diner': (2, 2), 'buildings/b-shop-row-c': (2, 3),
  'buildings/b-media-corner': (2, 2), 'buildings/b-flats-wall': (2, 3), 'landmarks/l-skate-park': (4, 4), 'landmarks/l-greenhouse': (4, 4),
  'landmarks/l-metro': (2, 2), 'landmarks/l-wheel-base': (2, 3), 'street/s-digital-stop': (1, 2), 'street/s-food-truck': (1, 2),
  'edge/e-mountains-a': (2, 6), 'edge/e-mountains-b': (2, 6), 'edge/e-hill-trees': (3, 3), 'edge/e-quay': (1, 4), 'edge/e-beach': (1, 4), 'edge/e-pier': (4, 1),
}
HALF = 128            # px per half tile across: one tile is 256 x 128 in the output
src, out, js = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None

def edges(a):
  ys, xs = np.nonzero(a)
  cols = np.arange(xs.min(), xs.max() + 1)
  bot = np.full(cols.shape, -1.0)
  for i, x in enumerate(cols):
    c = np.nonzero(a[:, x])[0]
    if len(c): bot[i] = c.max()
  iF = int(np.argmax(bot)); F = (cols[iF], bot[iF])
  def fit(sl):
    x, y = cols[sl], bot[sl]
    n = len(x); x, y = x[int(n * .2):int(n * .8)], y[int(n * .2):int(n * .8)]
    k, b = np.polyfit(x, y, 1)
    for _ in range(3):   # drop outliers (plants hanging over the edge) and refit
      r = np.abs(y - (k * x + b)); m = r < max(3, np.percentile(r, 70) * 2)
      k, b = np.polyfit(x[m], y[m], 1)
    return k, b
  kl, bl = fit(slice(0, iF)); kr, br = fit(slice(iF + 1, len(cols)))
  # the slab's side corners: furthest columns still on the fitted lines
  okl = [i for i in range(iF) if abs(bot[i] - (kl * cols[i] + bl)) < 6]
  okr = [i for i in range(iF + 1, len(cols)) if abs(bot[i] - (kr * cols[i] + br)) < 6]
  xl, xr = cols[min(okl)], cols[max(okr)]
  # nearest corner = where the two lines meet
  xF = (br - bl) / (kl - kr); yF = kl * xF + bl
  return (xl, kl * xl + bl), (xF, yF), (xr, kr * xr + br)

K = .5                # the grid's slope: 2:1
meta, report = {}, []
for key, (W, D) in FOOT.items():
  f = f'{src}/{key}.png'
  if not os.path.exists(f): continue
  im = Image.open(f).convert('RGBA'); a = np.array(im)[:, :, 3] > 200
  L, F, R = edges(a)
  dxL, dxR = F[0] - L[0], R[0] - F[0]
  sL = (F[1] - L[1]) / dxL; sR = (F[1] - R[1]) / dxR                      # both should be 0.5
  # each side of the nearest corner gets its own across-scale and shear, so both slab edges land exactly on the grid;
  # one vertical scale for the whole image keeps the walls upright and their heights in proportion
  aL, aR = HALF * W / dxL, HALF * D / dxR
  sv = (aL + aR) / 2
  tL, tR = K * aL - sv * sL, sv * sR - K * aR
  stretch = max(aL, aR) / min(aL, aR); shear = max(abs(tL) / aL, abs(tR) / aR)
  ok = stretch <= 1.35 and shear <= .2
  report.append(f"{key:26s} slopes {sL:.2f}/{sR:.2f}  stretch {stretch:.2f}  shear {shear:.2f}  -> {'OK' if ok else 'REGENERATE'}")
  h0, w0 = a.shape
  def fwd(x, y):
    dx = x - F[0]; aa, tt = (aL, tL) if dx < 0 else (aR, tR)
    return aa * dx, sv * (y - F[1]) + tt * dx
  P = [fwd(x, y) for x in (0, F[0] - .01, F[0] + .01, w0) for y in (0, h0)]
  minx = min(p[0] for p in P); maxx = max(p[0] for p in P); miny = min(p[1] for p in P)
  ox, oy = -minx, -miny
  ow, oh = int(np.ceil(maxx - minx)), int(np.ceil(oy)) + 2
  halves = []
  for aa, tt in ((aL, tL), (aR, tR)):
    # input = M * output: x = (X - ox)/aa + xF ; y = (Y - oy - tt (x - xF)) / sv + yF
    coef = (1 / aa, 0, F[0] - ox / aa,
            -tt / (aa * sv), 1 / sv, F[1] + (tt * ox / aa - oy) / sv)
    halves.append(im.transform((ow, oh), Image.AFFINE, coef, resample=Image.BICUBIC))
  img = halves[1].copy(); img.paste(halves[0].crop((0, 0, int(round(ox)), oh)), (0, 0))
  bb = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
  img = img.crop((bb[0], bb[1], bb[2], oh)); ox -= bb[0]; oy -= bb[1]
  name = os.path.basename(key)
  os.makedirs(f'{out}/{os.path.dirname(key)}', exist_ok=True)
  img.save(f'{out}/{key}.webp', quality=88, method=6)
  meta[name] = {'src': f'/sprites/city/{key}.webp', 'w': img.width, 'h': img.height, 'ox': round(float(ox), 1), 'oy': round(float(oy), 1), 'W': W, 'D': D, 'ok': bool(ok)}
  if dbg:
    from PIL import ImageDraw
    g = Image.new('RGBA', img.size, (255, 255, 255, 255)); g.alpha_composite(img); dr = ImageDraw.Draw(g)
    Fx, Fy = ox, oy
    dr.line([(Fx - HALF * W, Fy - HALF / 2 * W), (Fx, Fy), (Fx + HALF * D, Fy - HALF / 2 * D), (Fx + HALF * (D - W), Fy - HALF / 2 * (W + D)), (Fx - HALF * W, Fy - HALF / 2 * W)], fill=(220, 40, 40, 255), width=3)
    g.convert('RGB').save(f'{dbg}/{name}.png')

print('\n'.join(report))
open(js, 'w').write('// made by tools/fit-sprites.py: each sprite is warped onto the tile grid. (ox, oy) is where its footprint\'s nearest\n// corner sits in the image, in px at 256 px per tile; W x D is its footprint in tiles. ok = false: regenerate.\nexport const SPRITES = ' + json.dumps(meta, indent=1) + ';\n')
