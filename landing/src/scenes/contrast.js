import { SplitText } from 'gsap/SplitText';

// Headline contrast: each letter of the hero headline (and each word of the lead) takes ink or paper, whichever reads
// better over the part of the valley behind it. The valley picture is sampled small, with the same "cover" fit and
// focal point the hero uses, so a letter over the bright sky stays dark and a letter over the green hills turns light.
// No glow and no veil: the text itself changes colour. Recomputed on resize.

const FIT_Y = .74;   // the valley's vertical focal point on desktop (matches valley.js and .valley__still)

export function contrast(hero, { src = '/images/valley-2000.webp' } = {}) {
  const h1 = hero.querySelector('h1');
  const lead = hero.querySelector('.lead');
  const valley = hero.querySelector('.valley');
  if (!h1 || !valley) return () => {};
  const chars = SplitText.create(h1, { type: 'words,chars', charsClass: 'ch' }).chars;
  const words = lead ? SplitText.create(lead, { type: 'words', wordsClass: 'wd' }).words : [];

  const img = new Image();
  img.src = src;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  let data = null, iw = 0, ih = 0;

  const lum = (x, y) => {   // x, y in 0..1 of the picture
    const px = Math.min(iw - 1, Math.max(0, Math.round(x * (iw - 1))));
    const py = Math.min(ih - 1, Math.max(0, Math.round(y * (ih - 1))));
    const i = (py * iw + px) * 4;
    const f = (c) => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
    return .2126 * f(data[i]) + .7152 * f(data[i + 1]) + .0722 * f(data[i + 2]);
  };
  const paint = () => {
    if (!data) return;
    const vr = valley.getBoundingClientRect();
    const ra = vr.width / vr.height, ri = iw / ih;
    const sx = ra > ri ? 1 : ra / ri, sy = ra > ri ? ri / ra : 1;
    const uv = (x, y) => [((x - vr.left) / vr.width) * sx + (1 - sx) * .5, ((y - vr.top) / vr.height) * sy + (1 - sy) * FIT_Y];
    // the darkest part under a box decides: thin letters are lost over the darkest pixels, not the average
    const under = (r) => {
      const ls = [];
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const [u, v] = uv(r.left + r.width * (a + .5) / 4, r.top + r.height * (.15 + .7 * (b + .5) / 4));
        ls.push(lum(u, v));
      }
      ls.sort((p, q) => p - q);
      return ls[Math.floor(ls.length * .3)];
    };
    // light text when the ground is darker than about mid grey (contrast against ink vs paper crosses near .18)
    chars.forEach((c) => c.classList.toggle('on-dark', under(c.getBoundingClientRect()) < .2));
    words.forEach((w) => w.classList.toggle('on-dark', under(w.getBoundingClientRect()) < .2));
  };
  img.onload = () => {
    iw = 320; ih = Math.round(320 * img.naturalHeight / img.naturalWidth);
    cv.width = iw; cv.height = ih;
    ctx.drawImage(img, 0, 0, iw, ih);
    data = ctx.getImageData(0, 0, iw, ih).data;
    paint();
  };
  const ro = new ResizeObserver(paint);
  ro.observe(hero);
  return () => ro.disconnect();
}
