// the app's own faces (apps/web/lib/fonts.ts): Bricolage Grotesque for headings, Geist for text, Geist Mono for numbers
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/sections.css';
import './styles/try.css';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { initValley } from './scenes/valley.js';
import { city } from './scenes/city.js';
import { tryOut } from './scenes/try.js';
import { howScene } from './scenes/how.js';
import { initNav } from './ui/nav.js';
import { initForm } from './ui/form.js';

gsap.registerPlugin(ScrollTrigger, SplitText);
gsap.defaults({ ease: 'power3.out' });

initNav();
initForm(document.querySelector('[data-form]'));

// the nav is clear over the hero's sky and turns to paper glass once the page moves
const nav = document.querySelector('[data-nav]');
const onScroll = () => nav?.classList.toggle('is-top', window.scrollY < 24);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const $ = (s) => document.querySelector(s);
const mm = gsap.matchMedia();
mm.add(
  { motion: '(prefers-reduced-motion: no-preference)', still: '(prefers-reduced-motion: reduce)' },
  (ctx) => {
    const still = !ctx.conditions.motion;
    document.documentElement.classList.toggle('is-reduced', still);

    // the scenes, in page order; each one takes care of itself, and under reduced motion shows its end state
    const scenes = [
      city($('[data-city]'), { still }),            // pinned sections must be made top to bottom
      howScene($('[data-how]'), { still }),
    ];
    ScrollTrigger.sort();
    tryOut($('[data-try]'), { still });
    if (still) return () => scenes.forEach((s) => s?.kill());

    // the hero arrives once: the headline line by line, then the rest
    const h1 = $('[data-split]');
    document.fonts.ready.then(() => {
      const split = SplitText.create(h1, { type: 'lines', mask: 'lines', linesClass: 'line' });
      const tl = gsap.timeline();
      tl.from(split.lines, { yPercent: 105, duration: .9, stagger: .09, ease: 'expo.out' })
        .from('[data-rise]', { y: 14, autoAlpha: 0, duration: .6, stagger: .07 }, '-=.6')
        .from('.valley', { scale: 1.05, duration: 1.8, ease: 'expo.out' }, 0);
      tl.eventCallback('onComplete', () => { split.revert(); });
    });

    const stopValley = initValley($('[data-valley]'));

    // sections rise a touch as they arrive, so one runs into the next instead of cutting
    gsap.utils.toArray('[data-arrive]').forEach((el) => {
      gsap.from(el, { y: 40, autoAlpha: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 86%', once: true } });
    });

    return () => { stopValley(); scenes.forEach((s) => s?.kill()); };
  }
);
