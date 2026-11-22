// The valley look, shared by the build script and (in GLSL) src/scenes/valley.js. Keep the two in step.
// 1. a sky mask: bright, unsaturated, not-green pixels joined to the top edge (the far hazy hills count as sky)
// 2. the sky redrawn: light blue by height, distant hills as soft blue silhouettes, clouds white with cool shade
// 3. the land in pixels: each cell sampled once, snapped to a small palette with ordered dither,
//    and given a light top edge and dark bottom edge so the cells read as stacked blocks
import sharp from 'sharp';
import { PALETTE_HEX, PAPER_HEX, hex3 } from '../src/content/valley-look.js';

export const PALETTE = PALETTE_HEX.map(hex3);
export const SKY_TOP = [0.58, 0.80, 0.96], SKY_LOW = [0.88, 0.95, 0.99], HAZE = [0.55, 0.69, 0.82];
export const PAPER = hex3(PAPER_HEX);
const B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => v / 64);
export const bayer = (x, y) => B8[(y & 7) * 8 + (x & 7)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export async function skyMask(src, w = 480) {
  const { data, info } = await sharp(src).resize({ width: w }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, n = W * H;
  const ok = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    const v = Math.max(r, g, b), s = v ? (v - Math.min(r, g, b)) / v : 0;
    const green = g > r * 1.02 && g > b;
    ok[i] = v > .6 && s < .5 && !green ? 1 : 0;
  }
  const m = new Uint8Array(n), stack = [];
  for (let x = 0; x < W; x++) if (ok[x]) { m[x] = 1; stack.push(x); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (j >= 0 && ok[j] && !m[j]) { m[j] = 1; stack.push(j); }
    }
  }
  const buf = Buffer.from(m.map((v) => v * 255));
  return sharp(buf, { raw: { width: W, height: H, channels: 1 } }).blur(1.2).png().toBuffer();
}

// the smooth picture: redrawn sky, gently cooled land (what the lens shows)
export function grade(rgb, m, yN) {
  const [r, g, b] = rgb;
  const v = Math.max(r, g, b), s = v ? (v - Math.min(r, g, b)) / v : 0;
  const base = mix(SKY_TOP, SKY_LOW, sstep(0, .55, yN));
  const hazy = mix(base, HAZE, sstep(.86, .6, v) * .85);
  const cloud = sstep(.9, 1.1, v + .6 * s);
  const shade = mix([1, 1, 1], [.86, .9, .95], sstep(.18, .36, s) * .9);
  const sky = mix(hazy, shade, cloud);
  const land = [clamp(r * .97 + .01), clamp(g * 1.01 + .01), clamp(b * 1.06 + .02)];
  return mix(land, sky, m);
}

export function nearest(c) {
  let best = 0, bd = 1e9;
  for (let k = 0; k < PALETTE.length; k++) {
    const p = PALETTE[k];
    const d = (c[0] - p[0]) ** 2 * .3 + (c[1] - p[1]) ** 2 * .59 + (c[2] - p[2]) ** 2 * .11;
    if (d < bd) { bd = d; best = k; }
  }
  return PALETTE[best];
}
