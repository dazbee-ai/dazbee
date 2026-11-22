// Renders the valley pictures the page uses. Run: node scripts/valley-render.mjs
import sharp from 'sharp';
import { skyMask, grade, nearest, bayer, PAPER } from './valley.mjs';
const here = (p) => new URL(p, import.meta.url).pathname;
const src = here('./valley-source.jpg');
const out = here('../public/images/');

const maskPng = await skyMask(src);
await sharp(maskPng).toFile(`${out}valley-mask.png`);

async function graded(width) {
  const { data, info } = await sharp(src).resize({ width }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: md } = await sharp(maskPng).resize({ width: info.width, height: info.height }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const o = Buffer.alloc(data.length);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = y * info.width + x;
    const c = grade([data[i * 3] / 255, data[i * 3 + 1] / 255, data[i * 3 + 2] / 255], md[i] / 255, y / info.height);
    o[i * 3] = c[0] * 255; o[i * 3 + 1] = c[1] * 255; o[i * 3 + 2] = c[2] * 255;
  }
  return { o, info, md };
}

// the smooth graded picture: the shader's texture and what the lens shows
for (const w of [2000, 1200]) {
  const { o, info } = await graded(w);
  await sharp(o, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: 88 }).toFile(`${out}valley-${w}.webp`);
}

// the pixel picture for reduced motion and the closing: land in blocks, sky smooth, bottom dissolving into paper
export async function pixel(width, cw, ch, file, fade = true) {
  const { o, info, md } = await graded(width);
  const W = info.width, H = info.height, p = Buffer.from(o);
  for (let cy = 0; cy * ch < H; cy++) for (let cx = 0; cx * cw < W; cx++) {
    const sx = Math.min(W - 1, cx * cw + (cw >> 1)), sy = Math.min(H - 1, cy * ch + (ch >> 1)), si = sy * W + sx;
    const yN = sy / H;
    const toPaper = fade && yN > .84 && bayer(cx, cy) < (yN - .84) / .16;
    if (md[si] > 127 && !toPaper) continue;                         // sky stays smooth
    const d = bayer(cx, cy) - .5;
    let c = toPaper ? PAPER : nearest([o[si * 3] / 255 + d * .1, o[si * 3 + 1] / 255 + d * .1, o[si * 3 + 2] / 255 + d * .1]);
    for (let y = cy * ch; y < Math.min(H, cy * ch + ch); y++) for (let x = cx * cw; x < Math.min(W, cx * cw + cw); x++) {
      const k = toPaper ? 1 : y === cy * ch ? 1.07 : y === cy * ch + ch - 1 ? .9 : 1;
      const j = (y * W + x) * 3;
      p[j] = Math.min(255, c[0] * 255 * k); p[j + 1] = Math.min(255, c[1] * 255 * k); p[j + 2] = Math.min(255, c[2] * 255 * k);
    }
  }
  await sharp(p, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 90 }).toFile(`${out}${file}`);
}
await pixel(1600, 6, 4, 'valley-pixel-1600.webp');
await pixel(800, 4, 3, 'valley-pixel-800.webp');
console.log('valley done');
