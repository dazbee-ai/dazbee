import { gsap } from 'gsap';
import { ROUTES, banner } from '../content/routes.js';

// The concert (v3.2). The brief is on a stage in a dark venue, its six routes turning on a ring around it. Above the
// stage a truss of lights and an LED screen that names the route at the front and the audience it is for. In front of
// the stage, a crowd seen from behind: every person is one buyer, and one route is made for them. When that route comes
// round to the front, its people light up wherever they stand, raise a phone and the lights swing onto them.
// Hovering a person shows who they are: a face (DiceBear "Notionists", CC0), name, age, city, one line about them and
// the audience they belong to. The ring turns by itself, can be dragged, and a card can be clicked to bring it round.
// Two canvases: the back one (stage, speakers, crowd) under the cards, the front one (light beams, confetti) over them.

const TAU = Math.PI * 2;
const STEP = TAU / ROUTES.length;
const ROWS = 12;

// a steady random, so the crowd is the same on every visit
const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
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
const BODY = ['#1c2536', '#212b3d', '#1a2232', '#252f43', '#1e2839', '#283246'];
const HAIR = ['#0d1119', '#121722', '#171c27', '#0f131c'];

export function orbit(root, { still = false } = {}) {
  if (!root) return null;
  const sec = root.closest('[data-orbit-sec]') || root.parentElement;
  const ring = root.querySelector('[data-ring]');
  const nameEl = sec.querySelector('[data-picked-name]');
  const whoEl = sec.querySelector('[data-picked-who]');
  const whyEl = sec.querySelector('[data-picked-why]');
  const scrName = root.querySelector('[data-screen-name]');
  const scrWho = root.querySelector('[data-screen-who]');

  ring.innerHTML = ROUTES.map((r, i) => `
    <button type="button" class="orbit__card" data-i="${i}" style="--acc:${r.acc}" aria-label="${r.name} route, for ${r.who.toLowerCase()}">
      ${banner(r, '45')}
      <span class="orbit__name">${r.name}</span>
    </button>`).join('');
  const cards = [...ring.children];
  const back = root.querySelector('[data-stands]');
  const fore = root.querySelector('[data-beams]');
  const ctx = back.getContext('2d');
  const fx = fore.getContext('2d');
  const light = ROUTES.map(() => ({ v: 0 }));

  // the painted art (art/concert): crowd figurines and stage pieces. Until it loads, the drawn shapes stand in.
  const ART = {};
  const CROWD = ['c-person-short-hair', 'c-person-bun', 'c-person-long-hair', 'c-person-cap', 'c-person-beanie', 'c-person-curly', 'c-person-ponytail', 'c-couple'];
  const POSES = ['c-person-phone-up', 'c-person-both-arms'];
  const STAGE = ['st-deck', 'st-speaker-stack', 'st-barrier', 'st-truss', 'st-haze'];
  const TINT = {};                                      // per figurine: dark (in the crowd) and one lit version per route
  const tint = (img, fill, a) => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = fill; g.globalAlpha = a; g.fillRect(0, 0, c.width, c.height);
    return c;
  };
  let artReady = false;
  const loadArt = () => Promise.all([...CROWD, ...POSES, ...STAGE].map((n) => new Promise((ok) => {
    const i = new Image(); i.decoding = 'async';
    i.onload = () => { ART[n] = i; ok(); }; i.onerror = () => ok();
    i.src = `/sprites/concert/${n.startsWith('c-') ? 'crowd' : 'stage'}/${n}.webp`;
  }))).then(() => {
    if (![...CROWD, ...POSES].every((n) => ART[n])) return;
    // realistic light: people stay in their own colours, darkened by the dark room, and the stage lights only their top edges (a rim);
    // the people a route lights keep more of their colour and get a stronger rim in that route's colour
    const rim = (img, fill) => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in'; g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-out'; g.drawImage(img, 0, Math.max(2, img.height * .035));
      return c;
    };
    for (const n of [...CROWD, ...POSES]) {
      TINT[n] = { dark: tint(ART[n], '#05080e', .8), rim: rim(ART[n], '#9fb6d6'),
        lit: ROUTES.map((r) => tint(ART[n], '#0a0e16', .42)), litRim: ROUTES.map((r) => rim(ART[n], r.acc)) };
    }
    artReady = true;
    if (W) draw(performance.now());
  });

  // every person: a place in the crowd (row 0 is by the stage), their route, a look, and who they are
  const PEOPLE = [];
  for (let row = 0; row < ROWS; row++) {
    const t = row / (ROWS - 1);
    const n = Math.round(72 - t * 34);
    for (let j = 0; j < n; j++) {
      const r = Math.floor(rnd() * ROUTES.length);
      const [a0, a1] = AGES[r];
      PEOPLE.push({
        row, t, u: (j + .5 + (rnd() - .5) * .95) / n, dy: (rnd() - .5) * 1.6,
        route: r, body: pick(BODY), hair: pick(HAIR), style: Math.floor(rnd() * 7),
        bw: .86 + rnd() * .3, hs: .9 + rnd() * .2, tall: (rnd() - .5) * 4,
        ph: rnd() * TAU, sp: 3 + rnd() * 2.5, arm: rnd() < .5 ? -1 : 1, sway: rnd() * TAU,
        name: pick(NAMES), age: a0 + Math.floor(rnd() * (a1 - a0 + 1)), place: pick(PLACES), line: pick(LINES[r]),
      });
    }
  }
  const rgbOf = (hex) => { const c = parseInt(hex.slice(1), 16); return [c >> 16, (c >> 8) & 255, c & 255]; };
  const lit = ROUTES.map((r) => rgbOf(r.acc));
  const mix = (a, b, m) => a.map((v, i) => Math.round(v + (b[i] - v) * m));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // geometry, from the orbit's own size
  let W = 0, H = 0, dpr = 1, rx = 400, ry = 130, ch = 160, cy = 300, top = 120;
  const size = () => {
    const w = root.clientWidth;
    rx = Math.min(430, w * .38);
    ry = rx * .22;                                  // a low, wide ring (v3.3): less tall
    const cw = Math.min(124, Math.max(92, rx * .27));
    ch = cw * 1.25;
    root.style.setProperty('--rx', `${rx}px`);
    root.style.setProperty('--ry', `${ry}px`);
    root.style.setProperty('--cw', `${cw}px`);
    top = 104;                                         // room for the truss and the screen
    cy = Math.round(top + ry + ch * .8 + 10);
    root.style.setProperty('--cy', `${cy}px`);
    const h = Math.round(cy + ry + ch * .62 + 250);
    root.style.height = `${h}px`;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = sec.clientWidth; H = h;
    for (const c of [back, fore]) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = `${W}px`; c.style.height = `${H}px`;
    }
    place();
    draw(performance.now());
  };

  const st = { a: Math.PI / 2 };
  let front = -1, frontAt = 0;
  const at = (t) => [Math.cos(t) * rx, Math.sin(t) * ry];
  const place = () => {
    cards.forEach((c, i) => {
      const t = st.a + i * STEP;
      const [x, y] = at(t);
      const depth = (Math.sin(t) + 1) / 2;
      const s = .6 + depth * .5;
      c.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
      c.style.zIndex = String(Math.round(depth * 100) + (depth > .5 ? 100 : 0));
      c.style.filter = `${depth < .5 ? `blur(${((.5 - depth) * 2.4).toFixed(2)}px) ` : ''}brightness(${(.32 + .68 * depth ** 3).toFixed(2)}) saturate(${(.75 + .25 * depth).toFixed(2)})`;   // only the card at the front is in the spotlight
    });
    const k = ((Math.round((Math.PI / 2 - st.a) / STEP) % ROUTES.length) + ROUTES.length) % ROUTES.length;
    if (k !== front) {
      const first = front < 0;
      front = k; frontAt = performance.now();
      const r = ROUTES[k];
      nameEl.textContent = r.name;
      whoEl.textContent = r.who.toLowerCase();
      whyEl.textContent = r.why;
      scrName.textContent = r.name;
      scrWho.textContent = `for ${r.who}`;
      root.style.setProperty('--front', r.acc);
      cards.forEach((c, i) => c.classList.toggle('is-front', i === k));
      light.forEach((l, i) => gsap.to(l, { v: i === k ? 1 : 0, duration: still ? 0 : .7, ease: 'power2.out', overwrite: true }));
      if (!still && !first) burst(lit[k]);
      if (still) draw(0);
    }
  };

  // the crowd: rows from just under the stage to the bottom edge, nearer rows lower, larger and wider apart
  const deckFront = () => cy + ry + ch * .62;
  const crowdTop = () => deckFront() + 50;
  const spot = (p, now) => {
    const y0 = crowdTop(), span = H - y0 - 10;
    const k = Math.pow(p.t, 1.2);
    const sc = .66 + k * 1.05;
    const y = y0 + span * k + p.dy * 7 * sc;
    const w = W * (1.02 + k * .1);
    const sway = still ? 0 : Math.sin(now / 1400 + p.sway) * 1.2 * sc;
    const x = W / 2 + (p.u - .5) * w + sway;
    const L = light[p.route].v;
    const bob = still ? 0 : L * Math.max(0, Math.sin(now / 1000 * p.sp + p.ph)) * 3 * sc;
    return [x, y - bob + p.tall * sc * .3, sc, L];
  };

  // the stage: a deck under the ring with a lit front edge, speaker stacks either side, a barrier in front
  const drawStage = (now) => {
    const c = front >= 0 ? lit[front] : [255, 255, 255];
    const mx = W / 2, dx = rx * 1.22, dy = ry * 1.5, dcy = cy + ch * .3, lip = 22;
    // haze behind the stage, in the route's colour
    const hz = ctx.createRadialGradient(mx, cy - ry, 10, mx, cy - ry, rx * 1.6);
    hz.addColorStop(0, rgb(c, .26)); hz.addColorStop(1, rgb(c, 0));
    ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H);
    if (ART['st-haze']) {                                 // haze and beams behind the stage, in the route's light
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .35;
      const hw = rx * 2.6, hh = hw * ART['st-haze'].height / ART['st-haze'].width;
      ctx.drawImage(ART['st-haze'], mx - hw / 2, dcy - hh * .8, hw, hh); ctx.restore();
    }
    if (ART['st-speaker-stack']) {
      [-1, 1].forEach((side) => {
        const img = ART['st-speaker-stack'], h = 170, w = h * img.width / img.height;
        const sx = mx + side * (dx + 46);
        ctx.save(); ctx.filter = 'brightness(.55)';
        if (side > 0) { ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.translate(-sx, 0); }   // the right stack mirrored, so each one turns in toward the crowd
        ctx.drawImage(img, sx - w / 2, dcy - 10 - h, w, h); ctx.restore();
      });
    } else [-1, 1].forEach((side) => {
      const sx = mx + side * (dx + 46), w = 62;
      for (let k = 0; k < 3; k++) {
        const y = dcy - 10 - (k + 1) * 50;
        ctx.fillStyle = '#121a27'; ctx.beginPath(); ctx.roundRect(sx - w / 2, y, w, 48, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#0a0f17';
        ctx.beginPath(); ctx.arc(sx, y + 24, 15, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgb(c, .25); ctx.beginPath(); ctx.arc(sx, y + 24, 15, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#1b2433'; ctx.beginPath(); ctx.arc(sx, y + 24, 5, 0, TAU); ctx.fill();
      }
    });
    // the deck: the painted platform, else its front lip and top drawn
    if (ART['st-deck']) {
      // one stage: the art's top (rows 0 to 170 of 249) stretched to the ring's ellipse, its front lip kept thin below
      const img = ART['st-deck'], k = img.height / 249, TOP = 170 * k;
      ctx.save(); ctx.filter = 'brightness(.8)';
      ctx.drawImage(img, 0, TOP, img.width, img.height - TOP, mx - dx, dcy + dy - 4, dx * 2, lip + 4);
      ctx.drawImage(img, 0, 0, img.width, TOP, mx - dx, dcy - dy, dx * 2, dy * 2);
      ctx.restore();
    } else {
    ctx.fillStyle = '#0b111b';
    ctx.beginPath(); ctx.ellipse(mx, dcy + lip, dx, dy, 0, 0, Math.PI); ctx.lineTo(mx - dx, dcy); ctx.ellipse(mx, dcy, dx, dy, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(0, dcy - dy, 0, dcy + dy);
    g.addColorStop(0, '#1b2638'); g.addColorStop(1, '#2a3850');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(mx, dcy, dx, dy, 0, 0, TAU); ctx.fill();
    }
    // a pool of the route's light on the deck
    const pool = ctx.createRadialGradient(mx, dcy + dy * .4, 4, mx, dcy + dy * .4, dx * .8);
    pool.addColorStop(0, rgb(c, .32)); pool.addColorStop(1, rgb(c, 0));
    ctx.fillStyle = pool; ctx.beginPath(); ctx.ellipse(mx, dcy, dx, dy, 0, 0, TAU); ctx.fill();
    // LED strip along the front edge, with dots that run
    ctx.save();
    ctx.shadowColor = rgb(c, .9); ctx.shadowBlur = 14;
    ctx.strokeStyle = rgb(mix(c, [255, 255, 255], .35), .95); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(mx, dcy + 3, dx - 1, dy - 1, 0, .08, Math.PI - .08); ctx.stroke();
    ctx.restore();
    const run = still ? 0 : now / 3000;
    for (let k = 0; k < 42; k++) {
      const a = .1 + ((k / 42 + run) % 1) * (Math.PI - .2);
      ctx.fillStyle = `rgba(255,255,255,${.25 + .5 * Math.max(0, Math.sin(a * 6 - now / 400))})`;
      ctx.fillRect(mx + Math.cos(a) * dx - 1, dcy + lip * .55 + Math.sin(a) * dy - 1, 2, 2);
    }
    // barrier between the stage and the crowd
    const by = deckFront() + 40;
    if (ART['st-barrier']) {
      const img = ART['st-barrier'], h = 30, w = h * img.width / img.height;
      ctx.save(); ctx.filter = 'brightness(.5)';
      for (let x = W * .06; x < W * .94; x += w * .97) ctx.drawImage(img, x, by - 6, w, h);
      ctx.restore();
      return;
    }
    ctx.strokeStyle = 'rgba(190,205,225,.28)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W * .08, by); ctx.lineTo(W * .92, by); ctx.moveTo(W * .08, by + 16); ctx.lineTo(W * .92, by + 16); ctx.stroke();
    for (let x = W * .08; x <= W * .92; x += 14) { ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, by + 16); ctx.stroke(); }
  };

  // one person seen from behind: shoulders, neck, head and hair, rim-lit by the stage; lit people raise a phone
  const drawPerson = (p, x, y, sc, L, hv, now) => {
    if (artReady) {
      // lit people hold a phone up, its screen glowing; which hand depends on the person
      const pose = L > .3, flip = pose && p.arm < 0;
      const name = pose ? POSES[0] : CROWD[p.style % CROWD.length];
      const t = TINT[name], h = 34 * sc * p.hs * (pose ? 1.32 : 1), w = h * ART[name].width / ART[name].height;
      const X = x - w / 2, Y = y + 3 * sc - h;
      if (flip) { ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
      ctx.drawImage(t.dark, X, Y, w, h);
      if (L > .02) { ctx.globalAlpha = L; ctx.drawImage(t.lit[p.route], X, Y, w, h); }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = .2 + (L > .02 ? .1 : 0); ctx.drawImage(t.rim, X, Y, w, h);
      if (L > .02) { ctx.globalAlpha = .8 * L; ctx.drawImage(t.litRim[p.route], X, Y, w, h); }
      if (pose) {                                         // the phone screen: a small bright light in the raised hand
        const px = X + w * .58, py = Y + h * .07, r = 13 * sc * p.hs, c = lit[p.route];
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(255,255,255,${(.95 * L).toFixed(3)})`); g.addColorStop(.25, rgb(mix(c, [255, 255, 255], .6), .55 * L)); g.addColorStop(1, rgb(c, 0));
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      if (flip) ctx.restore();
      if (hv) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 9 * sc, 17 * sc, 0, TAU); ctx.stroke(); }
      return;
    }
    const c = lit[p.route], fc = front >= 0 ? lit[front] : c;
    const on = L > .02;
    const bodyC = on ? rgb(mix(rgbOf(p.body), c, .55 * L)) : p.body;
    const bw = 9 * sc * p.bw, hr = 4.9 * sc * p.hs;
    if (on && L > .3) {                                  // a raised arm and a glowing phone
      const ax = x + p.arm * 7 * sc, ay = y - 24 * sc;
      ctx.strokeStyle = bodyC; ctx.lineWidth = 2.6 * sc; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x + p.arm * 6 * sc, y - 8 * sc); ctx.quadraticCurveTo(x + p.arm * 9 * sc, y - 16 * sc, ax, ay); ctx.stroke();
      const glow = ctx.createRadialGradient(ax, ay - 4 * sc, 0, ax, ay - 4 * sc, 14 * sc);
      glow.addColorStop(0, rgb(mix(c, [255, 255, 255], .5), .55 * L)); glow.addColorStop(1, rgb(c, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ax, ay - 4 * sc, 14 * sc, 0, TAU); ctx.fill();
      ctx.fillStyle = rgb(mix(c, [255, 255, 255], .7));
      ctx.beginPath(); ctx.roundRect(ax - 2.4 * sc, ay - 8 * sc, 4.8 * sc, 8 * sc, 1 * sc); ctx.fill();
    }
    // shoulders
    ctx.fillStyle = bodyC;
    ctx.beginPath(); ctx.roundRect(x - bw, y - 10 * sc, bw * 2, 13 * sc, [7 * sc, 7 * sc, 1, 1]); ctx.fill();
    // long hair falls over the shoulders, behind the head
    if (p.style === 3) { ctx.fillStyle = p.hair; ctx.beginPath(); ctx.roundRect(x - hr * 1.05, y - 15 * sc, hr * 2.1, 11 * sc, [hr, hr, 3 * sc, 3 * sc]); ctx.fill(); }
    // neck and head
    ctx.fillStyle = '#2b3446'; ctx.fillRect(x - 1.8 * sc, y - 12 * sc, 3.6 * sc, 3 * sc);
    const hy = y - 15.5 * sc;
    ctx.fillStyle = p.hair; ctx.beginPath(); ctx.ellipse(x, hy, hr * .94, hr, 0, 0, TAU); ctx.fill();
    if (p.style === 1) { ctx.beginPath(); ctx.arc(x, hy - hr * 1.05, hr * .45, 0, TAU); ctx.fill(); }                      // bun
    if (p.style === 2) { ctx.beginPath(); ctx.ellipse(x, hy + hr * 1.1, hr * .32, hr * .75, 0, 0, TAU); ctx.fill(); }      // ponytail
    if (p.style === 4) { ctx.fillStyle = '#2d3a52'; ctx.beginPath(); ctx.ellipse(x, hy - hr * .2, hr * 1.02, hr * .86, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - hr * 1.02, hy - hr * .25, hr * 2.04, hr * .28); }                                                      // cap
    if (p.style === 5) { ctx.fillStyle = '#3a2f3f'; ctx.beginPath(); ctx.ellipse(x, hy - hr * .25, hr * 1.02, hr * 1.05, 0, Math.PI, 0); ctx.fill(); } // beanie
    // the rim light from the stage along the top edge
    const rim = .22 + (on ? L * .6 : 0);
    ctx.strokeStyle = rgb(mix(on ? c : fc, [255, 255, 255], .35), rim); ctx.lineWidth = 1.1 * sc;
    ctx.beginPath(); ctx.ellipse(x, hy, hr * .94, hr, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - bw + 3 * sc, y - 9.6 * sc); ctx.lineTo(x - hr * .5, y - 9.6 * sc); ctx.moveTo(x + hr * .5, y - 9.6 * sc); ctx.lineTo(x + bw - 3 * sc, y - 9.6 * sc); ctx.stroke();
    if (hv) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 9 * sc, 17 * sc, 0, TAU); ctx.stroke();
    }
  };

  // the front canvas: the truss, light beams that swing onto the lit people, confetti
  const LAMPS = 9;
  let confetti = [];
  const burst = (c) => {
    for (let k = 0; k < 90; k++) {
      confetti.push({ x: W / 2 + (rnd() - .5) * rx * 2.6, y: top - 20 - rnd() * 60, vx: (rnd() - .5) * 40, vy: 40 + rnd() * 70, r: rnd() * TAU,
        vr: (rnd() - .5) * 8, w: 3 + rnd() * 4, h: 2 + rnd() * 3, c: rnd() < .55 ? c : rnd() < .5 ? [255, 255, 255] : [217, 242, 79], born: performance.now() });
    }
  };
  let target = null;                                     // where the beams point: the middle of the lit people
  const drawFront = (now, dt) => {
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.clearRect(0, 0, W, H);
    const c = front >= 0 ? lit[front] : [255, 255, 255];
    const ty = 30, x0 = W * .12, x1 = W * .88, ly = ART['st-truss'] ? ty + 22 : ty + 8;   // ly: the lamp's lens, where each beam starts
    // beams, drawn first so the truss sits on top
    fx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < LAMPS; k++) {
      const lx = x0 + (x1 - x0) * (k / (LAMPS - 1));
      const sweep = still ? 0 : Math.sin(now / 1700 + k * 1.3);
      let tx, tyy;
      if (k % 2 === 0) { tx = W / 2 + sweep * rx * .35; tyy = cy + ry; }          // even lamps light the stage
      else { const t2 = target || [W / 2, H * .8]; tx = t2[0] + sweep * W * .22; tyy = t2[1]; }   // odd lamps sweep the crowd
      const len = Math.hypot(tx - lx, tyy - ly), ang = Math.atan2(tyy - ly, tx - lx);
      const spread = (k % 2 ? 70 : 54) * (len / 600);
      const g = fx.createLinearGradient(lx, ly, tx, tyy);
      const a = (k % 2 ? .075 : .06) * (.75 + .25 * Math.sin(now / 600 + k));
      g.addColorStop(0, rgb(mix(c, [255, 255, 255], .4), a * 1.6)); g.addColorStop(1, rgb(c, 0));
      fx.fillStyle = g;
      fx.save(); fx.translate(lx, ly); fx.rotate(ang);
      fx.beginPath(); fx.moveTo(0, -3); fx.lineTo(len, -spread); fx.lineTo(len, spread); fx.lineTo(0, 3); fx.closePath(); fx.fill();
      fx.restore();
    }
    // the follow spot on the hovered person
    if (hover) {
      const [hx, hy, sc] = spot(hover, now);
      const g = fx.createLinearGradient(W / 2, 0, hx, hy);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,250,235,.22)');
      fx.fillStyle = g; fx.beginPath(); fx.moveTo(W / 2 - 4, 0); fx.lineTo(W / 2 + 4, 0); fx.lineTo(hx + 22 * sc, hy); fx.lineTo(hx - 22 * sc, hy); fx.closePath(); fx.fill();
      fx.fillStyle = 'rgba(255,250,235,.18)'; fx.beginPath(); fx.ellipse(hx, hy + 2 * sc, 24 * sc, 8 * sc, 0, 0, TAU); fx.fill();
    }
    fx.globalCompositeOperation = 'source-over';
    // the truss and its lamps: the painted truss when it has loaded (its nine heads line up with the beams)
    if (ART['st-truss']) {
      // the bar is tiled from the art's top strip; each of the nine heads is cut from it and hung over its beam
      const img = ART['st-truss'], bh = 16, seg = 172, bw = seg * bh / 86;
      fx.save(); fx.filter = 'brightness(.7)';
      for (let x = x0 - 40; x < x1 + 40; x += bw) fx.drawImage(img, 70, 0, seg, 86, x, ty - 18, bw + .5, bh);
      for (let k = 0; k < LAMPS; k++) {
        const lx = x0 + (x1 - x0) * (k / (LAMPS - 1)), lh = 34, lw = lh * 106 / 148;
        fx.drawImage(img, 68, 80, 106, 148, lx - lw / 2, ty - 4, lw, lh);
      }
      fx.restore();
    } else {
    fx.fillStyle = '#0c121c'; fx.fillRect(x0 - 30, ty - 16, x1 - x0 + 60, 10);
    fx.strokeStyle = 'rgba(200,215,235,.18)'; fx.lineWidth = 1;
    fx.strokeRect(x0 - 30, ty - 16, x1 - x0 + 60, 10);
    for (let x = x0 - 30; x < x1 + 30; x += 12) { fx.beginPath(); fx.moveTo(x, ty - 16); fx.lineTo(x + 6, ty - 6); fx.lineTo(x + 12, ty - 16); fx.stroke(); }
    }
    for (let k = 0; k < LAMPS; k++) {
      const lx = x0 + (x1 - x0) * (k / (LAMPS - 1));
      if (!ART['st-truss']) { fx.fillStyle = '#151d2b'; fx.beginPath(); fx.roundRect(lx - 8, ty - 6, 16, 14, 3); fx.fill(); }
      fx.save(); fx.shadowColor = rgb(c, 1); fx.shadowBlur = 12;
      fx.fillStyle = rgb(mix(c, [255, 255, 255], .6)); fx.beginPath(); fx.ellipse(lx, ART['st-truss'] ? ty + 22 : ty + 8, 6, 2.6, 0, 0, TAU); fx.fill();
      fx.restore();
    }
    // confetti
    if (confetti.length) {
      const s = Math.min(.05, dt / 1000);
      confetti = confetti.filter((q) => now - q.born < 3400 && q.y < H);
      for (const q of confetti) {
        q.vy += 22 * s; q.x += (q.vx + Math.sin(now / 300 + q.r) * 18) * s; q.y += q.vy * s; q.r += q.vr * s;
        fx.save(); fx.translate(q.x, q.y); fx.rotate(q.r);
        fx.globalAlpha = Math.min(1, (3400 - (now - q.born)) / 800);
        fx.fillStyle = rgb(q.c); fx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h * Math.abs(Math.cos(q.r * 1.7)) + .5);
        fx.restore();
      }
    }
  };

  let hover = null, last = 0;
  const draw = (now) => {
    if (!W) return;
    const dt = last ? now - last : 16; last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawStage(now);
    let sx = 0, sy = 0, n = 0;
    for (const p of PEOPLE) {
      const [x, y, sc, L] = spot(p, now);
      if (x < -24 || x > W + 24) continue;
      if (L > .5 && p.row > 3) { sx += x; sy += y; n++; }
      drawPerson(p, x, y, sc, L, p === hover, now);
    }
    if (n) { const tgt = [sx / n, sy / n]; target = target ? [target[0] + (tgt[0] - target[0]) * .05, target[1] + (tgt[1] - target[1]) * .05] : tgt; }
    // the floor fades into the dark at the bottom
    const fade = ctx.createLinearGradient(0, H - 90, 0, H);
    fade.addColorStop(0, 'rgba(12,18,28,0)'); fade.addColorStop(1, 'rgba(12,18,28,.9)');
    ctx.fillStyle = fade; ctx.fillRect(0, H - 90, W, 90);
    drawFront(now, dt);
  };

  // hover: the nearest head under the pointer shows who they are
  const tip = document.createElement('div');
  tip.className = 'orbit__tip';
  tip.setAttribute('aria-hidden', 'true');
  root.appendChild(tip);
  // faces are drawn by DiceBear, loaded the first time the pointer comes over the venue (it is a big library)
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
    const r = ROUTES[p.route];
    tip.style.setProperty('--acc', r.acc);
    tip.innerHTML = `<div class="tip__top">${(() => { const f = face(p); return f ? `<img src="${f}" alt="" width="56" height="56">` : '<span class="tip__face"></span>'; })()}<div><b>${p.name}, ${p.age}</b><span>${p.place}</span></div></div>
      <p>${p.line}</p>
      <div class="tip__foot"><span>Audience</span><b>${r.who}</b></div>`;
  };
  const onHover = (e) => {
    if (dragging) return;
    const sr = back.getBoundingClientRect();
    const mx = e.clientX - sr.left, my = e.clientY - sr.top;
    let best = null;
    if (my > crowdTop() - 30) {
      const now = performance.now();
      for (const p of PEOPLE) {
        const [x, y, sc] = spot(p, now);
        const d = Math.hypot(mx - x, my - (y - 9 * sc));
        if (d < 12 * sc) best = p;
      }
    }
    if (best !== hover) {
      hover = best;
      if (hover) showTip(hover);
      tip.classList.toggle('is-on', !!hover);
      root.classList.toggle('is-over-crowd', !!hover);
      if (still) draw(0);
    }
    if (hover) {
      const [x, y, sc] = spot(hover, performance.now());
      const rr = root.getBoundingClientRect();
      tip.style.transform = `translate(${x + sr.left - rr.left}px, ${y - 28 * sc + sr.top - rr.top}px) translate(-50%, -100%)`;
    }
  };
  root.addEventListener('pointermove', onHover);
  root.addEventListener('pointerleave', () => { hover = null; tip.classList.remove('is-on'); root.classList.remove('is-over-crowd'); });

  let spin = gsap.to({}, {});
  const toFront = (i) => {
    const target2 = Math.PI / 2 - i * STEP;
    let d = (target2 - st.a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    spin.kill();
    pauseAuto();
    if (still) { st.a += d; place(); return; }
    spin = gsap.to(st, { a: st.a + d, duration: .9, ease: 'expo.out', onUpdate: place });
  };

  let autoOn = !still, resume = null, ticking = false;
  const pauseAuto = () => { autoOn = false; resume?.kill(); if (!still) resume = gsap.delayedCall(5, () => { autoOn = true; }); };
  let hold = 0;
  const tick = (_t, dt) => {
    draw(performance.now());
    if (!autoOn || dragging || spin.isActive() || hover) return;
    hold += dt;
    if (hold > 3000) { hold = 0; toFrontAuto(); }
  };
  const toFrontAuto = () => {
    const k = Math.round((Math.PI / 2 - (st.a - STEP)) / STEP);
    spin = gsap.to(st, { a: Math.PI / 2 - k * STEP, duration: 1.4, ease: 'power2.inOut', onUpdate: place });
  };

  let dragging = false, lastX = 0, lastT = 0, vel = 0, moved = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || hover) return;
    dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0; moved = 0;
    spin.kill(); pauseAuto();
    root.classList.add('is-drag');
  });
  const onMove = (e) => {
    if (!dragging) return;
    const now = performance.now(), dx = e.clientX - lastX;
    moved += Math.abs(dx);
    st.a += dx / (rx * 1.1);
    vel = dx / (rx * 1.1) / Math.max(1, now - lastT) * 1000;
    lastX = e.clientX; lastT = now;
    place();
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  const end = () => {
    if (!dragging) return;
    dragging = false; root.classList.remove('is-drag');
    if (still) return;
    const coast = st.a + vel * .35;
    const k = Math.round((Math.PI / 2 - coast) / STEP);
    spin = gsap.to(st, { a: Math.PI / 2 - k * STEP, duration: 1.1, ease: 'power3.out', onUpdate: place });
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  ring.addEventListener('click', (e) => {
    if (moved > 6) return;
    const c = e.target.closest('.orbit__card');
    if (c) toFront(+c.dataset.i);
  });

  loadArt();
  const ro = new ResizeObserver(size);
  ro.observe(root);
  size();

  let io = null;
  if (!still) {
    io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !ticking) { gsap.ticker.add(tick); ticking = true; }
      if (!e.isIntersecting && ticking) { gsap.ticker.remove(tick); ticking = false; }
    });
    io.observe(root);
  }
  return {
    kill() {
      ro.disconnect(); io?.disconnect(); gsap.ticker.remove(tick); spin.kill(); resume?.kill();
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
    },
  };
}
