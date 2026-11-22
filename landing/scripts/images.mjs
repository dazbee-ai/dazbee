// Makes every picture the page uses from one photograph (scripts/meadow-source.jpeg). Run: node scripts/images.mjs
// 1. the plain photo in three widths (the hero's lens shows it; it is also the fallback under the dither)
// 2. the dithered meadow (cobalt sky, green and lime field): the same recipe as the hero shader, for the closing
//    and for reduced motion
// 3. a two-colour halftone of the clouds (cobalt and peach) for the dark band
import sharp from 'sharp';
const here = (p) => new URL(p, import.meta.url).pathname;
const src = here('./meadow-source.jpeg');
const out = here('../public/images/');

for (const w of [1600, 1200, 800]) {
  await sharp(src).resize({ width: w }).webp({ quality: 80 }).toFile(`${out}meadow-${w}.webp`);
}

// keep these two ramps in step with the ones in src/scenes/meadow.js
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const SKY = ['#0a0f5c', '#1e2fd8', '#4f6bff', '#aab8ff', '#f6efe2'].map(hex);
const GND = ['#0a2347', '#0f6a52', '#27b07e', '#c6ee5a', '#f5d63a'].map(hex);
const B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => v / 64);
const clamp = (x) => Math.min(1, Math.max(0, x));

async function dither(width, cell, file) {
  const { data, info } = await sharp(src).resize({ width: Math.round(width / cell) }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = Buffer.alloc(info.width * info.height * 3);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 3;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const lum = .2126 * r + .7152 * g + .0722 * b;
    const ground = g > b + .03;
    const t = ground ? clamp((lum - .22) / (.9 - .22)) : clamp((lum - .42) / (.97 - .42));
    const q = Math.min(4, Math.max(0, Math.floor(t * 4 + B8[(y % 8) * 8 + (x % 8)])));
    const c = (ground ? GND : SKY)[q];
    o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2];
  }
  await sharp(o, { raw: { width: info.width, height: info.height, channels: 3 } })
    .resize({ width: info.width * cell, kernel: 'nearest' }).png({ palette: true, colours: 10 }).toFile(`${out}${file}`);
}
await dither(1600, 3, 'meadow-dither-1600.png');
await dither(800, 2, 'meadow-dither-800.png');

// halftone: square dots on a grid, bigger where the clouds are brighter
async function halftone(width, cell, file) {
  const { data, info } = await sharp(src).extract({ left: 0, top: 0, width: 1600, height: 640 })
    .resize({ width: Math.round(width / cell) }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let rects = '';
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const l = clamp((data[y * info.width + x] / 255 - .55) / .4);
    const s = Math.sqrt(l) * cell * .92;
    if (s > .8) rects += `<rect x="${(x * cell + (cell - s) / 2).toFixed(1)}" y="${(y * cell + (cell - s) / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width * cell}" height="${info.height * cell}"><rect width="100%" height="100%" fill="#1d33c9"/><g fill="#f3c9a0">${rects}</g></svg>`;
  await sharp(Buffer.from(svg)).png({ palette: true, colours: 8 }).toFile(`${out}${file}`);
}
await halftone(1600, 8, 'clouds-halftone-1600.png');

// share card: the dithered meadow with the dots mark
const mark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect x="64" y="64" width="112" height="112" rx="28" fill="#f6efe2"/><circle cx="100" cy="100" r="14" fill="#1e2fd8"/><circle cx="140" cy="100" r="14" fill="#14161c"/><circle cx="140" cy="140" r="14" fill="#14161c"/></svg>`);
await sharp(`${out}meadow-dither-1600.png`).resize({ width: 1200, height: 630, fit: 'cover', position: 'bottom', kernel: 'nearest' })
  .composite([{ input: mark }]).jpeg({ quality: 82, mozjpeg: true }).toFile(here('../public/share.jpg'));
console.log('done');
