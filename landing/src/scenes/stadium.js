import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ROUTES, BRIEF, banner } from '../content/routes.js';

// The concert (v3.5, pass 5: the launch show from Yuvaraj's reference). Painted for this one camera (art/concert/launch,
// prompts in raw/launch-prompts.json): an indoor arena seen from a few rows back, a round stage deck with lit steps,
// a big LED wall, two tall side screens and balconies either side; then a standing crowd seen from behind.
// All the painted light is white; the route colours are added here. The brief's six routes stand on the deck in a
// shallow arc, each ad on a plinth that names its audience; the route on stage stands forward in the middle and the
// arc slides round when the song changes. Each ad lights the deck in its own colour; the stage light takes the colour
// of the route on stage. The LED wall shows the brief; the side screens show the front route in two other sizes.
// In the crowd, that route's people hold up a glowing phone and the light pools on them; now and then someone else
// lights up in their own route's colour. Hovering (tapping, on a phone) a person shows who they are: a face (DiceBear
// "Notionists", CC0), name, age, city, one line about them and the audience they belong to. The card stays still.

const F = { w: 1536, h: 1024 };                     // the frame, in art px (the art is 1536 x 1024)
const SRC = '/sprites/concert/launch/';
const TAU = Math.PI * 2;
const CROWD_Y = 140;                                 // the crowd layer is moved down so its front edge meets the steps
// where each layer sits in the frame and how much it pushes in on scroll
const LAYERS = [['room', .02], ['deck', .05], ['crowd', .12]];
// the screens in the arena art (frame px): the LED wall shows the brief, the side screens the route at the front
const SCREENS = { mid: [384, 300, 772, 364], left: [204, 250, 148, 394, '916'], right: [1184, 250, 148, 394, '916'] };
const LAMPS = [134, 182, 226, 270, 319, 362, 406, 450, 497, 541, 589, 635].map((x) => [x * 2, 120]);
const VP = [768, 520];
// the arc the ads stand on, on the deck (frame px)
const ARC = { x: 768, y: 708, rx: 470, ry: 26, cw: 128 };
const SLOT = [0, 36, 72, 180, 288, 324, 360];      // 0 the front, 1 and 5 beside it, 2 and 4 at the ends, 3 hidden behind
const CROWD_TOP = 790;

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const ok = (...v) => v.every(Number.isFinite);       // a background tab can hand back NaN sizes; skip that frame's light

const rnd = (() => { let a = 11; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
// people: made up, the same on every visit. Lines describe the person, not the ad; no he or she
const NAMES = ['Maya', 'Tom', 'Priya', 'Josh', 'Aisha', 'Ben', 'Chloe', 'Sam', 'Nadia', 'Leo', 'Grace', 'Ollie', 'Zara', 'Dan', 'Mei', 'Luke',
  'Hannah', 'Ravi', 'Ella', 'Marcus', 'Sophie', 'Kofi', 'Isla', 'Jack', 'Amara', 'Finn', 'Lucy', 'Omar', 'Ruby', 'Theo', 'Jade', 'Arjun',
  'Carmen', 'Yusuf', 'Freya', 'Diego', 'Noor', 'Callum', 'Hana', 'Mateo'];
const PLACES = ['Leeds', 'Austin', 'Brisbane', 'Bristol', 'Denver', 'Perth', 'Manchester', 'Portland', 'Melbourne', 'Glasgow', 'Chicago',
  'Adelaide', 'Brighton', 'Seattle', 'Sydney', 'Cardiff', 'Boston', 'Auckland', 'Toronto', 'Dublin'];
const LINES = [
  ['Has tried three cleansers this year and kept none.', 'Reads every before-and-after photo twice.', 'Wants to see results first, then the price.'],
  ['Gets two kids out of the door by eight.', 'Has five minutes for skincare on a good day.', 'Keeps the routine short so it actually happens.'],
  ['Tries to eat healthy and looks at ingredients.', 'Avoids anything with added fragrance.', 'Looks up any ingredient that sounds made up.'],
  ['Reads the reviews before the product page.', 'Trusts someone with the same skin over any brand.', 'Asks friends before trying anything new.'],
  ['Has used the same foam cleanser for years.', 'Notices skin feels tight after washing.', 'Compares pack sizes and prices before buying.'],
  ['Turns the evening wash into a quiet ritual.', 'Likes a bathroom that feels calm.', 'Picks the bottle that looks and feels soft.'],
];
const AGES = [[24, 52], [30, 45], [22, 48], [19, 34], [27, 58], [22, 35]];

// the people in the painted crowd: rows of heads (frame px), nearer rows lower, bigger and further apart
const PEOPLE = [];
[[800, .3], [818, .36], [838, .44], [862, .54], [892, .66], [930, .82], [978, 1.02], [1030, 1.25]].forEach(([y, s], row) => {
  const gap = 70 * s;
  for (let x = 10 + rnd() * gap; x < F.w; x += gap * (.85 + rnd() * .3)) {
    const r = Math.floor(rnd() * ROUTES.length), [a0, a1] = AGES[r];
    PEOPLE.push({ x, y: y + (rnd() - .5) * 8 * s, s, row, route: r, arm: rnd() < .5 ? -1 : 1, ph: rnd() * TAU, on: rnd() < .55, flash: 0,
      name: pick(NAMES), age: a0 + Math.floor(rnd() * (a1 - a0 + 1)), place: pick(PLACES), line: pick(LINES[r]) });
  }
});

export function stadium(root, { still = false } = {}) {
  if (!root) return null;
  const sec = root.closest('[data-orbit-sec]') || root.parentElement;
  const nameEl = sec.querySelector('[data-picked-name]');
  const whoEl = sec.querySelector('[data-picked-who]');
  const whyEl = sec.querySelector('[data-picked-why]');
  const list = sec.querySelector('[data-setlist]');
  const N = ROUTES.length;

  // ---- build the frame
  const frame = document.createElement('div'); frame.className = 'sd__frame';
  const layer = {};
  const el = (tag, cls, parent) => { const e = document.createElement(tag); e.className = cls; parent.appendChild(e); return e; };
  const canvas = (cls, parent) => { const c = el('canvas', `sd__cv sd__${cls}`, parent); c.width = F.w; c.height = F.h; return c; };
  const img = (name, cls, parent, y = 0) => { const i = el('img', `sd__l ${cls}`, parent); i.src = `${SRC}${name}.webp`; i.alt = ''; i.decoding = 'async'; i.draggable = false; i.style.top = `${y}px`; return i; };
  for (const [key] of LAYERS) layer[key] = el('div', `sd__g sd__g--${key}`, frame);
  // the room: arena, the colour of the stage light, the screens, beams
  img('ls-arena', 'sd__arena', layer.room);
  el('div', 'sd__tint', layer.room);
  for (const [kk, [x0, y0, w0, h0, size]] of Object.entries(SCREENS)) {
    const s = el('div', `sd__screen sd__screen--${kk}`, layer.room);
    Object.assign(s.style, { left: `${x0}px`, top: `${y0}px`, width: `${w0}px`, height: `${h0}px` });
    s.innerHTML = size ? '<div class="sd__ad"></div><i class="sd__led"></i>'
      : `<div class="sd__brief-scr"><span class="px">— Tonight's brief —</span><b>${BRIEF.title}</b><span>${BRIEF.line}</span></div><i class="sd__led"></i>`;
  }
  const beamsCv = canvas('beams', layer.room);
  // the deck: light on it, and the ads standing on their plinths
  const deckCv = canvas('deck', layer.deck);
  const arc = el('div', 'sd__arc', layer.deck);
  arc.innerHTML = ROUTES.map((r, i) => `<button type="button" class="sd__card" data-i="${i}" tabindex="-1" style="--acc:${r.acc};width:${ARC.cw}px">${banner(r, '45')}<span class="sd__plinth"><b>${r.who}</b></span></button>`).join('');
  const cards = [...arc.children];
  // the crowd and the light on it
  img('ls-crowd', 'sd__crowd', layer.crowd, CROWD_Y);
  const front = canvas('front', layer.crowd);
  const flash = el('div', 'sd__flash', frame);
  root.appendChild(frame);
  const tip = el('div', 'orbit__tip', root); tip.setAttribute('aria-hidden', 'true');

  // ---- the frame is drawn at art size and scaled to the column; on a phone it is drawn bigger and cut at the sides
  let k = 1, cropX = 0, cropY = 0;
  const fit = () => {
    const w = root.clientWidth;
    if (!w) return;
    k = w / F.w;
    let h = Math.min(F.h * k, Math.max(420, window.innerHeight * .9));
    cropX = 0;
    if (w < 760) { h = Math.min(window.innerHeight * .72, 560); k = h / 900; cropX = (F.w - w / k) / 2; }
    cropY = (F.h - h / k) * .45;
    frame.style.transform = `scale(${k}) translate(${-cropX}px, ${-cropY}px)`;
    root.style.height = `${h}px`;
  };
  const ro = new ResizeObserver(fit); ro.observe(root); fit();

  list.innerHTML = ROUTES.map((r, i) => `<li><button type="button" data-i="${i}" style="--acc:${r.acc}"><span class="mono">${String(i + 1).padStart(2, '0')}</span>${r.name}</button></li>`).join('');
  const btns = [...list.querySelectorAll('button')];

  // ---- the arc: each ad's place (0 at the front) runs round the deck; st.p turns the whole arc
  const st = { p: 0 };
  const mod = (v, m) => ((v % m) + m) % m;
  const slotAngle = (p) => { const i = Math.floor(p), f = p - i; return SLOT[i] + (SLOT[i + 1] - SLOT[i]) * f; };
  const where = (i) => {
    const a = (90 + slotAngle(mod(i - st.p, N))) * Math.PI / 180;
    const near = (Math.sin(a) + 1) / 2;
    return [ARC.x + Math.cos(a) * ARC.rx, ARC.y + Math.sin(a) * ARC.ry, .78 + .34 * near ** 4, near];
  };
  const placeCards = (now) => {
    cards.forEach((c, i) => {
      const [x, y, s, near] = where(i);
      const breathe = still ? 0 : Math.sin(now / 2100 + i * 1.3) * 2.5 * near;
      c.style.transform = `translate(${x.toFixed(1)}px, ${(y + breathe).toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      c.style.zIndex = String(Math.round(near * 100));
      c.style.opacity = Math.min(1, Math.max(0, (near - .12) / .2)).toFixed(3);
      c.style.filter = `brightness(${(.6 + .4 * near ** 2).toFixed(2)})`;
      c.classList.toggle('is-front', mod(i - st.p + .5, N) < 1);
    });
  };

  // ---- light
  const bx = beamsCv.getContext('2d'), dx = deckCv.getContext('2d'), fx = front.getContext('2d');
  const ACC = ROUTES.map((r) => rgb(r.acc));
  let colour = ACC[0], burst = 0, cur = -1, jump = 0;
  const glowV = ROUTES.map(() => ({ v: 0 }));
  const scaleOf = (key) => { const v = +gsap.getProperty(layer[key], 'scale'); return Number.isFinite(v) && v > 0 ? v : 1; };
  const shown = (p) => {
    const sc = scaleOf('crowd');
    return [VP[0] + (p.x - VP[0]) * sc, VP[1] + (p.y + jump * p.s - VP[1]) * sc, p.s * sc];
  };
  // coloured beams over the painted white ones: each lamp leans toward the ad nearest below it, in that ad's colour
  const drawBeams = (now) => {
    bx.clearRect(0, 0, F.w, F.h);
    bx.globalCompositeOperation = 'lighter';
    LAMPS.forEach(([lx, ly], i) => {
      let best = 0, bd = Infinity;
      cards.forEach((_, j) => { const [x0, , , near] = where(j); const d = Math.abs(x0 - lx) - near * 160; if (near > .2 && d < bd) { bd = d; best = j; } });
      const [x0, y0] = where(best), c = i % 3 === 1 ? colour : ACC[best], hot = mix(c, [255, 255, 255], .4);
      const tx = x0 + (still ? 0 : Math.sin(now / (2400 + i * 80) + i) * 40), ty = y0 - 20;
      if (!ok(tx, ty)) return;
      const len = Math.hypot(tx - lx, ty - ly), ang = Math.atan2(ty - ly, tx - lx);
      const a = (.05 + .03 * Math.max(0, Math.sin(now / 650 + i * 2.1))) * (1 + burst);
      const g = bx.createLinearGradient(lx, ly, tx, ty);
      g.addColorStop(0, rgba(hot, a * 2.2)); g.addColorStop(1, rgba(c, a * .5));
      bx.fillStyle = g; bx.save(); bx.translate(lx, ly); bx.rotate(ang);
      bx.beginPath(); bx.moveTo(0, -5); bx.lineTo(len, -46); bx.lineTo(len, 46); bx.lineTo(0, 5); bx.closePath(); bx.fill(); bx.restore();
      const glow = bx.createRadialGradient(lx, ly, 0, lx, ly, 34);
      glow.addColorStop(0, rgba(hot, .5)); glow.addColorStop(1, rgba(c, 0));
      bx.fillStyle = glow; bx.beginPath(); bx.arc(lx, ly, 34, 0, TAU); bx.fill();
    });
    bx.globalCompositeOperation = 'source-over';
  };
  // the deck: each ad's colour pooled under it and reflected in the glossy floor; the steps' edges take the stage colour
  const drawDeck = (now) => {
    dx.clearRect(0, 0, F.w, F.h);
    dx.globalCompositeOperation = 'lighter';
    const hot = mix(colour, [255, 255, 255], .4);
    for (let s = 0; s < 4; s++) {                              // the lit step edges (painted white), washed in colour
      const y = 712 + s * 24, rx = 660 + s * 22;
      dx.save(); dx.shadowColor = rgba(colour, .8); dx.shadowBlur = 14;
      dx.strokeStyle = rgba(hot, .35 - s * .05); dx.lineWidth = 3;
      dx.beginPath(); dx.ellipse(768, y - 34, rx, 34 + s * 3, 0, .05, Math.PI - .05); dx.stroke(); dx.restore();
    }
    cards.forEach((_, i) => {
      const [px, py, s, near] = where(i);
      if (near < .15) return;
      const r = 170 * s, a = (i === cur ? .55 : .3) * near;
      const g = dx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, rgba(ACC[i], a)); g.addColorStop(1, rgba(ACC[i], 0));
      dx.save(); dx.translate(px, py); dx.scale(1, .28); dx.translate(-px, -py);
      dx.fillStyle = g; dx.beginPath(); dx.arc(px, py, r, 0, TAU); dx.fill(); dx.restore();
      const rw = ARC.cw * s * .7, rf = dx.createRadialGradient(px, py + 4, 0, px, py + 4, rw * .6);
      rf.addColorStop(0, rgba(ACC[i], .3 * near)); rf.addColorStop(1, rgba(ACC[i], 0));
      dx.save(); dx.translate(px, py + 4); dx.scale(1, .35); dx.translate(-px, -py - 4);
      dx.fillStyle = rf; dx.beginPath(); dx.arc(px, py + 4, rw * .6, 0, TAU); dx.fill(); dx.restore();
    });
    dx.globalCompositeOperation = 'source-over';
  };
  // the crowd: the front route's people hold up a glowing phone, beams pool on some of them, others flash now and then
  const glowAt = (x, y, r, c, a) => {
    if (!ok(x, y, r) || r <= 0) return;
    const g = fx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba([255, 255, 255], a)); g.addColorStop(.3, rgba(mix(c, [255, 255, 255], .5), a * .45)); g.addColorStop(1, rgba(c, 0));
    fx.fillStyle = g; fx.beginPath(); fx.arc(x, y, r, 0, TAU); fx.fill();
  };
  const drawFront = (now, dt) => {
    fx.clearRect(0, 0, F.w, F.h);
    fx.globalCompositeOperation = 'lighter';
    if (!still && Math.random() < dt * 6) {
      const p = PEOPLE[Math.floor(Math.random() * PEOPLE.length)];
      if (p.route !== cur) gsap.fromTo(p, { flash: 0 }, { flash: 1, duration: .5, yoyo: true, repeat: 1, repeatDelay: 1 + Math.random() * 1.5, ease: 'sine.inOut' });
    }
    for (const p of PEOPLE) {
      const L = glowV[p.route].v, Fl = p.flash;
      if (L < .02 && Fl < .02) continue;
      const [x, y, s] = shown(p);
      // a rim of the route's colour on the head and shoulders
      const rim = Math.max(L * .55, Fl * .8);
      fx.save(); fx.translate(x, y - 6 * s); fx.scale(1, .7);
      const g = fx.createRadialGradient(0, 0, 0, 0, 0, 34 * s);
      g.addColorStop(0, rgba(ACC[p.route], rim * .5)); g.addColorStop(.5, rgba(ACC[p.route], rim * .3)); g.addColorStop(1, rgba(ACC[p.route], 0));
      fx.fillStyle = g; fx.beginPath(); fx.arc(0, 0, 34 * s, 0, TAU); fx.fill(); fx.restore();
      if (L > .3 && p.on) {
        const fl = still ? 1 : .8 + .2 * Math.sin(now / 280 + p.ph);
        glowAt(x + p.arm * 24 * s, y - 52 * s, 12 * s, ACC[p.route], .5 * L * fl);
      }
    }
    if (hover) {                                               // the follow spot on the person under the pointer
      const [x, y, s] = shown(hover);
      if (ok(x, y, s)) {
        const g = fx.createLinearGradient(x, 300, x, y);
        g.addColorStop(0, 'rgba(255,250,235,0)'); g.addColorStop(1, 'rgba(255,250,235,.18)');
        fx.fillStyle = g; fx.beginPath(); fx.moveTo(x - 6, 300); fx.lineTo(x + 6, 300); fx.lineTo(x + 34 * s, y); fx.lineTo(x - 34 * s, y); fx.fill();
        glowAt(x, y - 20 * s, 40 * s, [255, 245, 225], .3);
      }
    }
    fx.globalCompositeOperation = 'source-over';
  };

  // ---- a route takes the stage: the arc slides round until it stands in the middle
  let timer = 0, spin = null, running = false, hover = null;
  const show = (i, { quiet = false } = {}) => {
    let d = mod(i - st.p, N); if (d > N / 2) d -= N;
    spin?.kill();
    if (quiet || still) st.p += d; else spin = gsap.to(st, { p: st.p + d, duration: 1.4 + Math.abs(d) * .15, ease: 'power3.inOut' });
    if (i === cur) return;
    cur = i;
    const r = ROUTES[i];
    btns.forEach((b, n) => { b.classList.toggle('is-on', n === i); b.setAttribute('aria-pressed', String(n === i)); });
    nameEl.textContent = r.name; whoEl.textContent = r.who.charAt(0).toLowerCase() + r.who.slice(1); whyEl.textContent = r.why;
    const swap = () => {
      for (const kk of ['left', 'right']) frame.querySelector(`.sd__screen--${kk} .sd__ad`).innerHTML = banner(r, SCREENS[kk][4]);
      sec.style.setProperty('--front', r.acc); frame.style.setProperty('--front', r.acc);
      colour = ACC[i];
      glowV.forEach((g, n) => gsap.to(g, { v: n === i ? 1 : 0, duration: quiet || still ? 0 : .9, ease: 'power2.out', overwrite: true }));
    };
    if (quiet || still) { swap(); return; }
    gsap.timeline()
      .to(flash, { opacity: .4, duration: .25, ease: 'power2.in' })
      .add(swap)
      .to(flash, { opacity: 0, duration: 1, ease: 'power2.out' })
      .fromTo(frame.querySelectorAll('.sd__screen'), { filter: 'brightness(1.8) saturate(.7)' }, { filter: 'brightness(1) saturate(1)', duration: .9, stagger: .06 }, '<')
      .to({ v: 0 }, { v: 1, duration: .35, ease: 'power2.out', onUpdate() { burst = this.targets()[0].v; } }, '<')
      .to({ v: 1 }, { v: 0, duration: 2.4, ease: 'sine.inOut', onUpdate() { burst = this.targets()[0].v; } }, '>.4');
  };
  const next = () => show((cur + 1) % N);
  const loop = () => { clearTimeout(timer); if (!still && running) timer = setTimeout(() => { if (!hover) next(); loop(); }, 6500); };
  btns.forEach((b, n) => b.addEventListener('click', () => { show(n); loop(); }));
  cards.forEach((c, n) => c.addEventListener('click', () => { show(n); loop(); }));

  // ---- hover: the person under the pointer shows who they are; the card is placed once and stays still
  const faces = new Map();
  let maker = null, loading = null;
  const loadFaces = () => loading || (loading = Promise.all([import('@dicebear/core'), import('@dicebear/notionists')])
    .then(([core, style]) => { maker = (seed) => core.createAvatar(style, { seed, size: 96, backgroundColor: ['dcebf5', 'efe2cf', 'e5ead6', 'f6dfdc', 'f3e7c6'], backgroundType: ['solid'] }).toDataUri(); if (hover) showTip(hover); })
    .catch(() => {}));
  root.addEventListener('pointerenter', loadFaces, { once: true });
  const face = (p) => {
    const key = `${p.name}-${p.age}-${p.place}`;
    if (!maker) { loadFaces(); return ''; }
    if (!faces.has(key)) faces.set(key, maker(key));
    return faces.get(key);
  };
  const showTip = (p) => {
    const r = ROUTES[p.route], f = face(p);
    tip.style.setProperty('--acc', r.acc);
    tip.innerHTML = `<div class="tip__top">${f ? `<img src="${f}" alt="" width="56" height="56">` : '<span class="tip__face"></span>'}<div><b>${p.name}, ${p.age}</b><span>${p.place}</span></div></div>
      <p>${p.line}</p>
      <div class="tip__foot"><span>Audience</span><b>${r.who}</b></div>`;
  };
  const toFrame = (e) => { const b = root.getBoundingClientRect(); return [(e.clientX - b.left) / k + cropX, (e.clientY - b.top) / k + cropY]; };
  const placeTip = () => {
    if (!hover) return;
    const [x, y, s] = shown(hover);
    if (!ok(x, y, s)) return;
    const half = tip.offsetWidth / 2 + 8, tx = Math.min(root.clientWidth - half, Math.max(half, (x - cropX) * k));
    tip.style.transform = `translate(${tx.toFixed(0)}px, ${((y - 70 * s - cropY) * k).toFixed(0)}px) translate(-50%, -100%)`;
  };
  const pickAt = (mx, my) => {
    let best = null, bd = Infinity;
    if (my > CROWD_TOP - 20) for (const p of PEOPLE) {
      const [x, y, s] = shown(p);
      const d = Math.hypot(mx - x, (my - (y - 20 * s)) * 1.2);
      if (d < 32 * s && d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const setHover = (p) => {
    if (p === hover) return;
    hover = p;
    if (hover) { showTip(hover); placeTip(); }
    tip.classList.toggle('is-on', !!hover);
    root.classList.toggle('is-over-crowd', !!hover);
    if (still) paint(0, 0);
  };
  root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { const [mx, my] = toFrame(e); setHover(pickAt(mx, my)); } });
  root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setHover(null); });
  root.addEventListener('click', (e) => { if (e.target.closest('.sd__card')) return; const [mx, my] = toFrame(e); setHover(pickAt(mx, my)); });

  const paint = (now, dt) => { placeCards(now); drawBeams(now); drawDeck(now); drawFront(now, dt); };
  show(0, { quiet: true });
  if (still) { paint(0, 0); return { kill() { ro.disconnect(); } }; }

  // ---- motion: the crowd jumps a little on each song change, the light breathes
  let last = 0;
  const tick = () => {
    const now = performance.now(), dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
    jump = -burst * 8 * Math.abs(Math.sin(now / 160));
    layer.crowd.querySelector('.sd__crowd').style.translate = `0 ${jump.toFixed(2)}px`;
    paint(now, dt);
  };
  const watch = ScrollTrigger.create({ trigger: root, start: 'top bottom', end: 'bottom top', onToggle: (self) => {
    running = self.isActive;
    if (running) { last = 0; gsap.ticker.add(tick); loop(); } else { gsap.ticker.remove(tick); clearTimeout(timer); }
  } });
  const push = gsap.timeline({ scrollTrigger: { trigger: root, start: 'top bottom', end: 'bottom top', scrub: .6 } });
  for (const [key, depth] of LAYERS) {
    layer[key].style.transformOrigin = `${VP[0]}px ${VP[1]}px`;
    push.fromTo(layer[key], { scale: 1 }, { scale: 1 + depth * 1.4, ease: 'none' }, 0);
  }
  return { kill() { ro.disconnect(); watch.kill(); push.scrollTrigger?.kill(); push.kill(); gsap.ticker.remove(tick); clearTimeout(timer); spin?.kill(); } };
}
