import { gsap } from 'gsap';
import { BRIEF, ROUTES, SIZES, banner } from '../content/routes.js';

// The board: the brief beside three of its routes, each in all four sizes and named with the buyer it speaks to,
// a line for the rest, and two teammates' cursors at work. Built once; only the cursors move. (v2.2: kept plain.)

const SHOWN = ['proof', 'routine', 'ingredient'];

export function board(root, { still = false } = {}) {
  if (!root) return null;
  const routes = SHOWN.map((id) => ROUTES.find((r) => r.id === id));
  root.innerHTML = `
    <div class="board__brief">
      <p class="core__label px">Brief</p>
      <p class="board__title">${BRIEF.title}</p>
      <dl>
        <div><dt>Proposition</dt><dd>${BRIEF.line}</dd></div>
        <div><dt>Audience</dt><dd>25 to 40, sensitive skin</dd></div>
        <div><dt>Must have</dt><dd>Pack shot, “fragrance free”</dd></div>
      </dl>
      <div class="board__kit"><i style="--c:#f3e7d3"></i><i style="--c:#6f8f5a"></i><i style="--c:#c4693f"></i><i style="--c:#2b2a26"></i><span>Sorrel &amp; Oat kit</span></div>
    </div>
    <div class="board__rows">
      ${routes.map((r) => `
        <div class="brow" data-row>
          <p class="brow__name"><i style="--c:${r.acc}"></i><b>${r.name}</b><span>for ${r.who.toLowerCase()}</span></p>
          <div class="brow__sizes">${SIZES.map((s) => `<figure>${banner(r, s.id)}<figcaption class="mono">${s.label}</figcaption></figure>`).join('')}</div>
        </div>`).join('')}
      <p class="board__more">And three more routes: social proof, comparison and feeling.</p>
    </div>
    <span class="cursor cursor--a" data-cursor style="--c:#1f5f9e"><svg viewBox="0 0 16 16"><path d="M1 1l5.5 13 2-5.5L14 6.5z"/></svg><b>Asha, planner</b></span>
    <span class="cursor cursor--b" data-cursor style="--c:#c4693f"><svg viewBox="0 0 16 16"><path d="M1 1l5.5 13 2-5.5L14 6.5z"/></svg><b>Tom, designer</b></span>`;

  const brief = root.querySelector('.board__brief');
  if (still) return { kill() {} };

  // the cursors wander between banners: each hop picks a banner and rests on it a moment
  const cursors = [...root.querySelectorAll('[data-cursor]')];
  const targets = () => [...root.querySelectorAll('.bn')];
  const hop = (c, k) => {
    const list = targets();
    const t = list[(k * 5 + (c === cursors[0] ? 2 : 7)) % list.length];
    const b = root.getBoundingClientRect(), r = t.getBoundingClientRect();
    gsap.to(c, {
      x: r.left - b.left + r.width * .62, y: r.top - b.top + r.height * .55, duration: 1.4, ease: 'power2.inOut',
      onComplete: () => { c.classList.add('is-click'); gsap.delayedCall(.25, () => c.classList.remove('is-click')); },
    });
  };
  let k = 0, loop = null;
  const run = () => { cursors.forEach((c, i) => gsap.delayedCall(i * .7, () => hop(c, k + i * 3))); k++; };
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !loop) { run(); loop = setInterval(run, 2600); }
    if (!e.isIntersecting && loop) { clearInterval(loop); loop = null; }
  });
  io.observe(root);

  // a little depth under the pointer
  const layers = [brief, root.querySelector('.board__rows')];
  const onMove = (e) => {
    const b = root.getBoundingClientRect();
    const px = (e.clientX - b.left) / b.width - .5, py = (e.clientY - b.top) / b.height - .5;
    gsap.to(layers[0], { x: px * -8, y: py * -6, duration: .8 });
    gsap.to(layers[1], { x: px * 6, y: py * 4, duration: .8 });
  };
  root.addEventListener('pointermove', onMove);
  return { kill() { io.disconnect(); clearInterval(loop); root.removeEventListener('pointermove', onMove); } };
}

// the services card for routes: three different routes fanned out
export function svcRoutes(el) {
  if (!el) return;
  el.innerHTML = ['proof', 'voice', 'feel'].map((id, i) => `<span class="svc__fan" style="--i:${i}">${banner(ROUTES.find((r) => r.id === id), '45')}</span>`).join('');
}
