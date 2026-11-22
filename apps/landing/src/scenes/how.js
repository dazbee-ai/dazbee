import { gsap } from 'gsap'
import { ROUTES, SIZES, banner } from '../content/routes.js'

// How it works: the title and four steps stay pinned while one stage acts each step out, scrubbed by the scroll.
// 1 the brief types itself and the brand kit drops in; 2 routes fly out of the brief into the empty slots (with room
// for more); 3 one route refits into all four sizes; 4 the route goes into review, the client comments and approves.

export function howScene(section, { still = false } = {}) {
  if (!section) return null
  const pin = section.querySelector('.how__pin')
  const steps = [...section.querySelectorAll('[data-step]')]
  const bars = [...section.querySelectorAll('.stage__bar i')]
  const brief = section.querySelector('[data-st-brief]')
  const routesEl = section.querySelector('[data-st-routes]')
  const sizesEl = section.querySelector('[data-st-sizes]')
  const reviewEl = section.querySelector('[data-st-review]')
  const lines = [...section.querySelectorAll('[data-type-line]')]
  const sw = [...brief.querySelectorAll('.stage__kit i')]
  const first = ROUTES[0]

  routesEl.innerHTML = `<div class="st-grid">${ROUTES.map((r) => `<div class="st-slot"><div class="st-card">${banner(r, '45')}<span class="px">${r.name}</span></div></div>`).join('')}</div>
    <p class="st-more"><span class="st-plus" aria-hidden="true">+</span>Add another route</p>`
  sizesEl.innerHTML = `<div class="st-sizes">${SIZES.map((s) => `<figure>${banner(first, s.id)}<figcaption class="mono">${s.label}</figcaption></figure>`).join('')}</div>
    <p class="st-note"><span class="px">${first.name}</span> Change the headline once and every size follows.</p>`
  reviewEl.insertAdjacentHTML(
    'beforeend',
    `
    <div class="st-phone">${banner(first, '45')}<span class="pin" style="--x:74%;--y:30%">1</span><span class="stamp px">Approved</span></div>
    <div class="st-bubble"><b>Brand lead</b>Love this. Approving ${first.name.toLowerCase()}.</div>`,
  )

  const cards = [...routesEl.querySelectorAll('.st-card')]
  const slots = [...routesEl.querySelectorAll('.st-slot')]
  const more = routesEl.querySelector('.st-more')
  const sizes = [...sizesEl.querySelectorAll('figure')]
  const note = sizesEl.querySelector('.st-note')
  const link = reviewEl.querySelector('.stage__link')
  const phone = reviewEl.querySelector('.st-phone')
  const pinEl = reviewEl.querySelector('.pin')
  const stamp = reviewEl.querySelector('.stamp')
  const bubble = reviewEl.querySelector('.st-bubble')
  const full = lines.map((l) => l.dataset.typeLine)

  const setStep = (i) => steps.forEach((s, k) => s.classList.toggle('is-on', k === i))

  if (still) {
    lines.forEach((l, k) => {
      l.textContent = full[k]
    })
    section.classList.add('is-static')
    bars.forEach((b) => b.style.setProperty('--p', 1))
    return { kill() {} }
  }

  // where the brief sits relative to each slot, so the cards can start inside it
  const fromBrief = (el) => {
    const b = brief.getBoundingClientRect(),
      r = el.parentElement.getBoundingClientRect()
    return { x: b.left + b.width / 2 - (r.left + r.width / 2), y: b.top + b.height / 2 - (r.top + r.height / 2) }
  }
  const typing = { p: 0 }
  const type = () => {
    const total = full.reduce((a, t) => a + t.length, 0)
    let n = Math.round(typing.p * total)
    lines.forEach((l, k) => {
      const take = Math.max(0, Math.min(full[k].length, n))
      l.textContent = full[k].slice(0, take)
      n -= full[k].length
    })
  }

  const tl = gsap.timeline({ defaults: { ease: 'power2.out', duration: 0.5 } })
  gsap.set([routesEl, sizesEl, reviewEl], { autoAlpha: 1 })
  gsap.set(sizes, { autoAlpha: 0, y: 24 })
  gsap.set(note, { autoAlpha: 0 })
  gsap.set([link, phone, bubble], { autoAlpha: 0 })

  // 1 the brief
  tl.to(typing, { p: 1, duration: 0.75, ease: 'none', onUpdate: type }, 0.05)
    .from(sw, { scale: 0, autoAlpha: 0, duration: 0.25, stagger: 0.05, ease: 'back.out(2)' }, 0.55)
    // 2 the routes come out of the brief
    .fromTo(
      cards,
      {
        x: (i, el) => fromBrief(el).x,
        y: (i, el) => fromBrief(el).y,
        scale: 0.3,
        autoAlpha: 0,
      },
      { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 0.55, stagger: 0.07, ease: 'power3.out' },
      1.05,
    )
    .from(more, { autoAlpha: 0, y: 10, duration: 0.3 }, 1.7)
    // 3 one route, every size
    .to(slots, { autoAlpha: 0, scale: 0.9, duration: 0.3, stagger: 0.02 }, 2.05)
    .to(more, { autoAlpha: 0, duration: 0.2 }, 2.05)
    .to(sizes, { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.08, ease: 'back.out(1.4)' }, 2.25)
    .to(note, { autoAlpha: 1, duration: 0.3 }, 2.6)
    // 4 in review: the client's comment and approval
    .to([...sizes, note], { autoAlpha: 0, y: -16, duration: 0.3, stagger: 0.02 }, 3.05)
    .fromTo(link, { autoAlpha: 0, y: -14 }, { autoAlpha: 1, y: 0, duration: 0.35 }, 3.2)
    .fromTo(phone, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.45 }, 3.3)
    .from(pinEl, { scale: 0, duration: 0.25, ease: 'back.out(3)' }, 3.6)
    .fromTo(bubble, { autoAlpha: 0, x: 16 }, { autoAlpha: 1, x: 0, duration: 0.3 }, 3.62)
    .from(stamp, { scale: 1.8, autoAlpha: 0, rotate: 8, duration: 0.25, ease: 'power4.in' }, 3.8)
    .to({}, { duration: 0.15 }, 3.95)

  let cur = -1
  tl.eventCallback('onUpdate', () => {
    const p = tl.time()
    const i = Math.min(3, Math.floor(p))
    bars.forEach((b, k) => b.style.setProperty('--p', Math.max(0, Math.min(1, p - k))))
    if (i !== cur) {
      cur = i
      setStep(i)
    }
  })
  tl.scrollTrigger?.kill()
  const st = gsap
    .timeline({
      scrollTrigger: {
        trigger: pin,
        start: 'top top',
        end: '+=140%',
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
        anticipatePin: 1,
      },
    })
    .add(tl, 0)
  return {
    kill() {
      st.scrollTrigger?.kill()
      st.kill()
    },
  }
}
