import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ROUTES, banner } from '../content/routes.js';
import { ad } from '../ui/cad.js';

// Why (v3.3): a versus slider. Two rows of the same six slots sit on top of each other: underneath, six tweaks of one
// ad (same layout, new colours), all reaching the same one audience; on top, six distinct routes, each with its own
// audience. The VS handle is the seam: everything right of it is upgraded. Drag it (or use the arrow keys) and each
// slot it passes upgrades with a little burst. The line under it counts ideas and audiences as you go.
// The faces under each slot come from DiceBear (Notionists, CC0), loaded when the section is near.

const TWEAKS = [
  ['#efe2cf', '#c4693f'], ['#f1dcd3', '#b4573a'], ['#dfe8ee', '#3f6f97'],
  ['#e5ead6', '#5e7f3e'], ['#f3e7c6', '#a8782a'], ['#e9e2da', '#7a5a44'],
];
// three made-up people per audience, as avatar seeds
const FACES = [['Maya-34', 'Tom-29', 'Priya-38'], ['Ben-41', 'Aisha-36', 'Kofi-44'], ['Mei-27', 'Leo-31', 'Nadia-35'],
  ['Zara-19', 'Finn-24', 'Ruby-22'], ['Dan-52', 'Grace-47', 'Omar-39'], ['Isla-26', 'Theo-30', 'Jade-23']];
const BG = ['dcebf5', 'efe2cf', 'e5ead6', 'f6dfdc', 'f3e7c6'];

const faces = (k) => `<span class="faces" data-faces="${k}">${FACES[k].map(() => '<i></i>').join('')}</span>`;

export function whyScene(section, { still = false } = {}) {
  if (!section) return null;
  const vs = section.querySelector('[data-vs]');
  const stage = section.querySelector('[data-vs-stage]');
  const a = section.querySelector('[data-vs-a]');
  const b = section.querySelector('[data-vs-b]');
  const fx = section.querySelector('[data-vs-fx]');
  const handle = section.querySelector('[data-vs-handle]');
  if (!vs || !stage) return null;
  const q = (s) => section.querySelector(s);

  a.innerHTML = '<span class="vs__tag">Six tweaks of one ad</span>' + TWEAKS.map(([bg, acc]) => `<div class="vs__slot"><div class="bn r45">${ad('proof', 's-45', `--bg:${bg};--acc:${acc}`)}</div>
    <div class="vs__who">${faces(0)}<span class="aud">${ROUTES[0].who}</span></div></div>`).join('');
  b.innerHTML = '<span class="vs__tag">Six distinct routes, with Dazbee</span>' + ROUTES.map((r, i) => `<figure class="vs__slot" style="--acc:${r.acc}">${banner(r, '45')}
    <figcaption class="vs__who">${faces(i)}<span><b>${r.name}</b><span class="aud">${r.who}</span></span></figcaption></figure>`).join('');
  const slotsB = [...b.querySelectorAll('.vs__slot')];

  // faces, once the section is near
  const fill = () => import('@dicebear/core').then((core) => import('@dicebear/notionists').then((style) => {
    section.querySelectorAll('[data-faces]').forEach((el) => {
      const k = +el.dataset.faces;
      [...el.children].forEach((i, j) => {
        const seed = FACES[k][j];
        i.style.backgroundImage = `url("${core.createAvatar(style, { seed, size: 64, backgroundColor: [BG[(k + j) % BG.length]], backgroundType: ['solid'] }).toDataUri()}")`;
      });
    });
  })).catch(() => {});
  const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { near.disconnect(); fill(); } }, { rootMargin: '800px 0px' });
  near.observe(section);

  // the seam: p runs 0 (all routes) to 1 (all tweaks); right of the seam is upgraded
  const st = { p: 1 };
  let upgraded = new Set(), W = 1;
  const measure = () => { W = stage.clientWidth || 1; };
  const centres = () => slotsB.map((s) => (s.offsetLeft + s.offsetWidth / 2) / W);
  let C = [];
  const render = (burst = true) => {
    const x = st.p * W;
    b.style.clipPath = `inset(-40px 0 -10px ${x}px)`;
    handle.style.transform = `translateX(${x}px)`;
    const now = new Set(C.map((c, i) => (c > st.p ? i : -1)).filter((i) => i >= 0));
    if (burst && !still) now.forEach((i) => { if (!upgraded.has(i)) pop(i); });
    upgraded = now;
    const routes = now.size, ideas = new Set(ROUTES.map((r, i) => (now.has(i) ? r.id : 'proof'))).size;
    q('[data-vs-ideas]').textContent = ideas;
    q('[data-vs-ideas-w]').textContent = ideas === 1 ? 'idea' : 'ideas';
    q('[data-vs-aud]').textContent = ideas;
    q('[data-vs-aud-w]').textContent = ideas === 1 ? 'audience' : 'audiences';
    handle.setAttribute('aria-valuenow', String(routes));
    handle.setAttribute('aria-valuetext', `${routes} of 6 upgraded to distinct routes`);
    vs.classList.toggle('is-all', routes === 6);
  };
  // the upgrade: the card jumps, a ring and sparks fly from it, a small "new idea" tag rises
  const pop = (i) => {
    const s = slotsB[i], card = s.querySelector('.bn');
    gsap.fromTo(card, { scale: .9, rotate: -2 }, { scale: 1, rotate: 0, duration: .7, ease: 'elastic.out(1, .45)' });
    const cx = s.offsetLeft + s.offsetWidth / 2, cy = s.offsetTop + card.offsetTop + card.offsetHeight / 2;
    const ring = document.createElement('i');
    ring.className = 'vs__ring'; ring.style.cssText = `left:${cx}px;top:${cy}px;--acc:${ROUTES[i].acc}`;
    b.appendChild(ring);
    gsap.fromTo(ring, { scale: .3, opacity: .9 }, { scale: 1.6, opacity: 0, duration: .7, ease: 'power2.out', onComplete: () => ring.remove() });
    for (let k = 0; k < 14; k++) {
      const sp = document.createElement('i');
      sp.className = 'vs__spark'; sp.style.cssText = `left:${cx}px;top:${cy}px;--acc:${k % 3 ? ROUTES[i].acc : '#d9f24f'}`;
      b.appendChild(sp);
      const ang = (k / 14) * Math.PI * 2 + Math.random() * .4, d = 70 + Math.random() * 60;
      gsap.to(sp, { x: Math.cos(ang) * d, y: Math.sin(ang) * d * .8, rotate: Math.random() * 360, opacity: 0, duration: .8 + Math.random() * .3, ease: 'power3.out', onComplete: () => sp.remove() });
    }
    s.querySelector('.vs__new')?.remove();
    const tag = document.createElement('span');
    tag.className = 'vs__new'; tag.textContent = 'New idea'; tag.style.setProperty('--acc', ROUTES[i].acc);
    s.appendChild(tag);
    gsap.fromTo(tag, { y: 8, opacity: 0, scale: .7 }, { y: 0, opacity: 1, scale: 1, duration: .45, ease: 'back.out(2.4)' });
    gsap.to(tag, { opacity: 0, y: -8, duration: .35, delay: 1.1, onComplete: () => tag.remove() });
  };

  const setup = () => { measure(); C = centres(); render(false); };
  const ro = new ResizeObserver(setup);
  ro.observe(stage);
  setup();
  if (still) { st.p = .5; render(false); return { kill() { ro.disconnect(); near.disconnect(); } }; }

  // drag the seam anywhere on the stage
  let drag = false, tween = null, touched = false;
  const toP = (clientX) => Math.min(1, Math.max(0, (clientX - stage.getBoundingClientRect().left) / W));
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = true; touched = true; tween?.kill(); intro?.kill();
    stage.setPointerCapture(e.pointerId); vs.classList.add('is-drag');
    gsap.to(st, { p: toP(e.clientX), duration: .25, ease: 'power2.out', onUpdate: render });
  });
  stage.addEventListener('pointermove', (e) => { if (drag) { gsap.killTweensOf(st); st.p = toP(e.clientX); render(); } });
  const end = () => { drag = false; vs.classList.remove('is-drag'); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -6, End: 6 }[e.key];
    if (!step) return;
    e.preventDefault(); touched = true; intro?.kill();
    const routes = Math.min(6, Math.max(0, upgraded.size - step));
    const target = routes === 0 ? 1 : routes === 6 ? 0 : (C[6 - routes] + C[6 - routes - 1]) / 2;
    tween = gsap.to(st, { p: target, duration: .4, ease: 'power2.out', onUpdate: render });
  });

  // the first time it comes into view: sweep all the way (every slot upgrades), then rest in the middle
  let intro = null;
  const trig = ScrollTrigger.create({
    trigger: stage, start: 'top 70%', once: true,
    onEnter: () => {
      if (touched) return;
      intro = gsap.timeline()
        .to(st, { p: 0, duration: 2.2, ease: 'power1.inOut', onUpdate: render })
        .to(st, { p: .5, duration: 1, ease: 'power2.inOut', onUpdate: render }, '+=.5')
        .add(() => vs.classList.add('is-hint'));
    },
  });
  return { kill() { ro.disconnect(); near.disconnect(); trig.kill(); intro?.kill(); tween?.kill(); } };
}
