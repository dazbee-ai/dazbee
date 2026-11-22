import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ROUTES, banner } from '../content/routes.js';
import { build, life, CELL, P } from './town.js';

// The audience town (replaces the concert, 2026-11-21). The same painted iso town as the sizes section, but six of its
// blocks are neighbourhoods, one for each route of the brief: a roadside board shows that route's banner, and the
// people it speaks to stand in front of it. The camera visits one neighbourhood at a time (every 6.5 s, or when a
// route is picked); that route's people stand on a ring of its colour and one of them says why it works for them.
// Hovering (tapping, on a phone) any of them shows who they are: a face (DiceBear "Notionists", CC0), name, age,
// city, one line about them and their audience. The card is placed once and stays still.

// made-up people, the same on every visit; lines describe the person, not the ad; no he or she
const PEOPLE = [
  [['Maya', 34, 'Leeds', 'Has tried three cleansers this year and kept none.'], ['Ravi', 29, 'Austin', 'Reads every before-and-after photo twice.'], ['Isla', 38, 'Denver', 'Wants to see results first, then the price.'], ['Noor', 27, 'Perth', 'Keeps a note of what made the redness worse.']],
  [['Tom', 41, 'Bristol', 'Gets two kids out of the door by eight.'], ['Aisha', 36, 'Brisbane', 'Has five minutes for skincare on a good day.'], ['Callum', 44, 'Glasgow', 'Keeps the routine short so it actually happens.'], ['Mei', 33, 'Toronto', 'Buys whatever is on the school-run route.']],
  [['Grace', 31, 'Portland', 'Avoids anything with added fragrance.'], ['Arjun', 26, 'Melbourne', 'Looks up any ingredient that sounds made up.'], ['Hana', 45, 'Seattle', 'Shops the farmers market every Saturday.'], ['Leo', 30, 'Brighton', 'Tries to eat healthy and looks at labels.']],
  [['Zara', 22, 'Manchester', 'Reads the reviews before the product page.'], ['Finn', 24, 'Dublin', 'Trusts someone with the same skin over any brand.'], ['Amara', 19, 'Cardiff', 'Asks friends before trying anything new.'], ['Diego', 27, 'Chicago', 'Has never spent much on skincare.']],
  [['Marcus', 39, 'Boston', 'Has used the same foam cleanser for years.'], ['Sophie', 33, 'Adelaide', 'Notices skin feels tight after washing.'], ['Kofi', 47, 'Sydney', 'Compares pack sizes and prices before buying.'], ['Jade', 29, 'Auckland', 'Washes twice a day after the gym.']],
  [['Ella', 26, 'Sydney', 'Turns the evening wash into a quiet ritual.'], ['Theo', 31, 'Brighton', 'Likes a bathroom that feels calm.'], ['Ruby', 23, 'Melbourne', 'Picks the bottle that looks and feels soft.'], ['Omar', 34, 'Toronto', 'Books a slow Sunday every month.']],
];
// six blocks in two rows of three (block indices); the back row first
const BLOCKS = [[3, 3], [2, 4], [4, 2], [4, 4], [3, 5], [5, 3]];
// route -> block, and who stands there (sprite names)
const PLAN = [
  { block: 0, who: ['p-talk-phone', 'p-walk-a-se', 'p-talk-pointing', 'p-walk-b-sw'] },    // proof: sensitive skin
  { block: 4, who: ['p-buggy-se', 'p-talk-waving', 'p-walk-a-sw', 'p-dog-se'] },          // routine: working parents
  { block: 2, who: ['p-talk-pointing', 'p-walk-b-se', 'p-talk-phone', 'p-walk-a-sw'] },    // ingredient: clean beauty shoppers
  { block: 1, who: ['p-talk-waving', 'p-talk-phone', 'p-walk-b-sw', 'p-walk-a-se'] },      // voice: first-time buyers
  { block: 5, who: ['p-runner-se', 'p-talk-pointing', 'p-walk-a-se', 'p-runner-sw'] },     // versus: foam cleanser users
  { block: 3, who: ['p-talk-phone', 'p-walk-b-se', 'p-talk-waving', 'p-walk-a-sw'] },      // feel: self-care fans
];
// where the four people stand, in cells from the block's lots corner: in front of the board's face (x = 2)
const TALK = 3;                                     // who says the route's line: the one at the front
const SPOTS = [[2.75, 3.5], [3.75, 4.15], [2.85, 5.0], [4.3, 5.35]];

function layout({ sprite, paint, flat, free, cellTree, figure, el }) {
  const boards = [], groups = [];
  ROUTES.forEach((r, ri) => {
    const [bi, bj] = BLOCKS[PLAN[ri].block], i = bi * P + 2, j = bj * P + 2;
    const park = r.id === 'feel';
    flat(park ? 't-park' : 't-plaza', i, j, 7, 7);
    if (park) flat('t-pave', i + 2, j + 3, 3.2, 2.6);
    // the board, on the left, facing the people
    const b = sprite('s-billboard-wide', i + 1, j + 1);
    const face = paint(b, 's-billboard-wide', null, 'fill', `r${ri}`, `<div class="aud__face">${banner(r, '191')}</div>`);
    face.style.setProperty('--acc', r.acc);
    boards.push(face);
    // what stands behind them, at the back on the right: the kind of place these people pass
    const back = {
      proof: () => { sprite('b-apartments', i + 3, j); sprite('b-corner-cafe', i + 5, j); },
      routine: () => { sprite('b-house-a', i + 3, j); sprite('b-house-c', i + 5, j); cellTree(i + 6.4, j + 3, .8); },
      ingredient: () => { sprite('b-market', i + 3, j); cellTree(i + 6.5, j + .6, .8); },
      voice: () => { sprite('b-shop-row', i + 3, j); sprite('b-shop-row-b', i + 5, j); },
      versus: () => { sprite('b-gym', i + 3, j); sprite('b-gym', i + 5, j, true); },
      feel: () => { sprite('n-fountain', i + 4, j + .6); sprite('s-kiosk', i + 6, j + 2.2); free('n-bench', (i + 5.6) * 64, (j + 4.2) * 64); },
    }[r.id];
    back();
    [[i + 5.6, j + 6.2, .8], [i + 6.4, j + 5.2, .9], [i + .6, j + 6.2, .85]].forEach(([a, c, k]) => cellTree(a, c, k));
    free('n-lamp', (i + 2.2) * 64, (j + 6.6) * 64);
    // the people, each on a ring of the route's colour (shown while the route is on)
    const g = PLAN[ri].who.map((name, n) => {
      const [a, c] = SPOTS[n];
      const ring = flat('aud__ring', i + a - .45, j + c - .45, .9, .9);
      ring.style.setProperty('--acc', r.acc);
      const [nm, age, place, line] = PEOPLE[ri][n];
      return figure((i + a) * 64, (j + c) * 64, name, n % 2 === 1, { route: ri, ring, name: nm, age, place, line }, 1.25);
    });
    groups.push(g);
  });
  return { boards, groups };
}

export function audience(root, { still = false } = {}) {
  if (!root) return null;
  const sec = root.closest('[data-orbit-sec]') || root.parentElement;
  const stage = root.querySelector('.aud__stage');
  const camera = root.querySelector('[data-camera]');
  const world = root.querySelector('[data-world]');
  const list = sec.querySelector('[data-setlist]');
  const nameEl = sec.querySelector('[data-picked-name]');
  const whoEl = sec.querySelector('[data-picked-who]');
  const whyEl = sec.querySelector('[data-picked-why]');
  const own = new Set(BLOCKS.map(([a, b]) => `${a},${b}`));
  const parts = build(world, { layout, own, crowd: 24 });
  const { boards, groups } = parts.extra;
  // a roadside board is wider than 1.91:1: the banner sits in the middle and its own paper fills the rest
  boards.forEach((b) => { const a = b.querySelector('.ad, .cad'); if (a) b.firstChild.style.background = getComputedStyle(a).backgroundColor; });
  const tl = life(parts);
  const N = ROUTES.length;

  // the camera: close on one neighbourhood (its board and its people), measured with no camera transform
  let shots = [];
  const measure = () => {
    const prev = camera.style.transform;
    camera.style.transform = 'none';
    const sr = stage.getBoundingClientRect();
    const cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2, W = sr.width, H = sr.height, wide = W >= 760;
    shots = ROUTES.map((r, i) => {
      const rs = [boards[i], ...groups[i].map((p) => p.head)].map((n) => n.getBoundingClientRect());
      const l = Math.min(...rs.map((x) => x.left)), t = Math.min(...rs.map((x) => x.top));
      const rr = Math.max(...rs.map((x) => x.right)), b = Math.max(...rs.map((x) => x.bottom));
      const S = Math.min(1.5, (W * (wide ? .5 : .9)) / (rr - l), (H * .62) / (b - t));
      const dx = (l + rr) / 2 - cx, dy = (t + b) / 2 - cy;
      return { x: (wide ? 0 : 0) - S * dx, y: H * .06 - S * dy, scale: S };
    });
    camera.style.transform = prev;
  };
  measure();

  // the speech bubble: the route's first person says why it works for them
  const talk = document.createElement('div'); talk.className = 'town__talk'; talk.setAttribute('aria-hidden', 'true');
  talk.innerHTML = '<div class="bubble"><div class="bubble__in"><b></b><span class="mono"></span></div></div>';
  stage.appendChild(talk);
  const bubble = talk.firstChild;
  let cur = -1;
  const follow = () => {
    if (cur < 0) return;
    const pr = stage.getBoundingClientRect(), h = groups[cur][TALK].head.getBoundingClientRect();
    const x = h.left + h.width / 2 - pr.left;
    // talk to the right if it fits, else to the left; if neither fits (a phone), slide the bubble back inside
    const bw = bubble.firstChild.offsetWidth || 260, left = x + bw > pr.width - 12 && x - bw > 12;
    bubble.classList.toggle('is-left', left);
    const shift = left ? 0 : Math.min(0, pr.width - 12 - (x + bw));
    bubble.style.setProperty('--shift', `${shift.toFixed(0)}px`);
    bubble.style.transform = `translate(${x.toFixed(1)}px, ${(h.top - pr.top).toFixed(1)}px)`;
  };

  list.innerHTML = ROUTES.map((r, i) => `<li><button type="button" data-i="${i}" style="--acc:${r.acc}"><span class="mono">${String(i + 1).padStart(2, '0')}</span>${r.name}</button></li>`).join('');
  const btns = [...list.querySelectorAll('button')];

  const show = (i, jump = false) => {
    if (i === cur) return;
    cur = i;
    const r = ROUTES[i];
    btns.forEach((b, n) => { b.classList.toggle('is-on', n === i); b.setAttribute('aria-pressed', String(n === i)); });
    nameEl.textContent = r.name; whoEl.textContent = r.who.charAt(0).toLowerCase() + r.who.slice(1); whyEl.textContent = r.why;
    boards.forEach((b, n) => b.classList.toggle('is-on', n === i));
    groups.forEach((g, n) => g.forEach((p) => { p.ring.classList.toggle('is-on', n === i); p.m.classList.toggle('is-talking', n === i && p === g[TALK]); }));
    bubble.classList.remove('is-on');
    bubble.querySelector('b').textContent = r.why;
    bubble.querySelector('span').textContent = `${r.name} · ${r.who}`;
    setHover(null);
    if (!shots.length) measure();
    const to = shots[i];
    if (jump || still) { gsap.set(camera, to); follow(); bubble.classList.add('is-on'); return; }
    gsap.to(camera, { ...to, duration: 1.6, ease: 'power2.inOut', overwrite: true, onUpdate: follow, onComplete: () => { follow(); bubble.classList.add('is-on'); } });
  };

  // ---- hover: the person under the pointer shows who they are
  const tip = document.createElement('div'); tip.className = 'orbit__tip'; tip.setAttribute('aria-hidden', 'true'); stage.appendChild(tip);
  const faces = new Map();
  let maker = null, loading = null, hover = null;
  const loadFaces = () => loading || (loading = Promise.all([import('@dicebear/core'), import('@dicebear/notionists')])
    .then(([core, style]) => { maker = (seed) => core.createAvatar(style, { seed, size: 96, backgroundColor: ['dcebf5', 'efe2cf', 'e5ead6', 'f6dfdc', 'f3e7c6'], backgroundType: ['solid'] }).toDataUri(); if (hover) showTip(hover); })
    .catch(() => {}));
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
    const pr = stage.getBoundingClientRect(), h = p.head.getBoundingClientRect();
    const half = tip.offsetWidth / 2 + 8, x = Math.min(pr.width - half, Math.max(half, h.left + h.width / 2 - pr.left));
    tip.style.transform = `translate(${x.toFixed(0)}px, ${(h.top - pr.top - 6).toFixed(0)}px) translate(-50%, -100%)`;
  };
  const all = groups.flat();
  function setHover(p) {
    if (p === hover) return;
    hover = p;
    tip.classList.toggle('is-on', !!p);
    if (p) { showTip(p); bubble.classList.remove('is-on'); } else if (cur >= 0 && !gsap.isTweening(camera)) bubble.classList.add('is-on');
  }
  stage.addEventListener('pointerenter', loadFaces, { once: true });
  all.forEach((p) => {
    p.m.classList.add('aud__who');
    p.m.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setHover(p); });
    p.m.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setHover(null); });
    p.m.addEventListener('click', (e) => { e.stopPropagation(); setHover(hover === p ? null : p); });
  });
  stage.addEventListener('click', () => setHover(null));

  // ---- the tour: a new neighbourhood every 6.5 s while the section is on screen (not while someone is hovered)
  let timer = 0, running = false;
  const loop = () => { clearTimeout(timer); if (!still && running) timer = setTimeout(() => { if (!hover) show((cur + 1) % N); loop(); }, 6500); };
  btns.forEach((b, n) => b.addEventListener('click', () => { show(n); loop(); }));
  boards.forEach((b, n) => { b.style.pointerEvents = 'auto'; b.addEventListener('click', () => { show(n); loop(); }); });

  const onRefreshInit = () => { measure(); if (cur >= 0) gsap.set(camera, shots[cur]); };
  ScrollTrigger.addEventListener('refreshInit', onRefreshInit);
  const ro = new ResizeObserver(() => { measure(); if (cur >= 0) { gsap.set(camera, shots[cur]); follow(); } });
  ro.observe(stage);
  show(0, true);

  if (still) return { kill() { ro.disconnect(); ScrollTrigger.removeEventListener('refreshInit', onRefreshInit); } };

  const watch = ScrollTrigger.create({ trigger: root, start: 'top bottom', end: 'bottom top', onToggle: (self) => {
    running = self.isActive;
    tl.paused(!running); world.style.visibility = running ? '' : 'hidden';
    if (running) { loop(); gsap.ticker.add(follow); } else { clearTimeout(timer); gsap.ticker.remove(follow); }
  } });
  if (!watch.isActive) world.style.visibility = 'hidden';
  return {
    kill() { tl.kill(); watch.kill(); gsap.ticker.remove(follow); clearTimeout(timer); ro.disconnect(); ScrollTrigger.removeEventListener('refreshInit', onRefreshInit); },
  };
}
