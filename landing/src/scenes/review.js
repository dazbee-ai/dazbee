import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Sign-off: when the phone comes into view the notes slide in on their threads, then the review plays on the phone:
// a comment is pinned, the request is checked against the brief, the client taps Approve, the stamp lands and the
// toast pops. The phone part repeats while the section is on screen.
export function reviewScene(section, { still = false } = {}) {
  if (!section) return null;
  const q = (s) => section.querySelector(s);
  const notes = [...section.querySelectorAll('.note')];
  const paths = [...section.querySelectorAll('.review__lines path')];
  const pin = q('[data-rv-pin]'), note = q('[data-rv-note]'), flag = note?.querySelector('.flag');
  const approve = q('[data-rv-approve]'), tap = q('[data-rv-tap]'), stamp = q('[data-rv-stamp]'), toast = q('[data-toast]');
  if (still) { section.classList.add('is-done'); return { kill() {} }; }

  gsap.set(notes, { autoAlpha: 0, x: (i) => (i === 2 ? 40 : -40) });
  paths.forEach((p) => { const L = p.getTotalLength(); gsap.set(p, { strokeDasharray: `${L} ${L}`, strokeDashoffset: L }); });

  const play = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 2.2 });
  play.set([pin, note, flag, tap, stamp, toast], { autoAlpha: 0 })
    .set(approve, { clearProps: 'backgroundColor,color' })
    .fromTo(pin, { scale: 0, autoAlpha: 1 }, { scale: 1, duration: .45, ease: 'back.out(3)' }, .3)
    .fromTo(note, { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .45, ease: 'expo.out' }, .55)
    .fromTo(flag, { scale: .6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: .35, ease: 'back.out(2)' }, 1.3)
    .fromTo(tap, { scale: .2, autoAlpha: .9 }, { scale: 1.8, autoAlpha: 0, duration: .55, ease: 'power2.out' }, 2.2)
    .to(approve, { backgroundColor: '#3e8a4f', color: '#fff', duration: .15 }, 2.25)
    .fromTo(stamp, { scale: 1.9, rotate: 6, autoAlpha: 0 }, { scale: 1, rotate: -8, autoAlpha: 1, duration: .3, ease: 'power4.in' }, 2.5)
    .fromTo(toast, { y: 14, scale: .9, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: .5, ease: 'back.out(1.6)' }, 2.85)
    .to({}, { duration: 1.4 });

  const intro = gsap.timeline({ paused: true });
  intro.to(paths, { strokeDashoffset: 0, duration: 1, stagger: .15, ease: 'power2.inOut' })
    .to(notes, { autoAlpha: 1, x: 0, duration: .7, stagger: .15, ease: 'expo.out' }, .3);

  const st = ScrollTrigger.create({
    trigger: q('.review__stage'), start: 'top 70%', end: 'bottom top',
    onEnter: () => { intro.play(); play.play(); },
    onEnterBack: () => play.play(),
    onLeave: () => play.pause(),
    onLeaveBack: () => play.pause(),
  });
  return { kill() { st.kill(); play.kill(); intro.kill(); } };
}
