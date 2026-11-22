import { gsap } from 'gsap'
import { CATEGORIES, pickCategory } from '../content/concepts.js'
import { cad, esc } from '../ui/cad.js'

// The try-out: brief or prompt → email → four angles → a dithered "making" moment → four concepts in every size.
// Concepts come from the ready-made sets in content/concepts.js; nothing is generated live (the page says so).
// "Make it editable" carries the email and brief into the pilot form below.

// the making moment: the banner's own colours resolve out of ordered-dither noise, like the meadow
const BAYER = (() => {
  const m = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30,
    54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
    61, 29, 53, 21,
  ]
  return (x, y) => m[(y % 8) * 8 + (x % 8)] / 64
})()
function dither(canvas, pal, dur, delay) {
  const W = 36,
    H = Math.round((36 * canvas.clientHeight) / Math.max(1, canvas.clientWidth)) || 45
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  const noise = [pal[1], pal[2], '#f6efe2', '#1d33c9', '#d9f24f']
  const st = { p: 0 }
  const draw = () => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = BAYER(x, y) * 0.85 + (y / H) * 0.15
        g.fillStyle = t < st.p ? pal[0] : noise[(Math.random() * noise.length) | 0]
        if (t >= st.p && Math.random() < 0.35) g.fillStyle = pal[0]
        g.fillRect(x, y, 1, 1)
      }
  }
  draw()
  return gsap.to(st, { p: 1.05, duration: dur, delay, ease: 'power1.inOut', onUpdate: draw })
}

export function tryOut(section, { still = false } = {}) {
  if (!section) return null
  const studio = section.querySelector('[data-studio]')
  const panes = Object.fromEntries([...section.querySelectorAll('[data-pane-try]')].map((p) => [p.dataset.paneTry, p]))
  const dots = [...section.querySelectorAll('[data-dot]')]
  const briefForm = panes.brief,
    emailForm = panes.email
  const catsEl = section.querySelector('[data-cats]')
  const state = { mode: 'brief', cat: null, catByHand: false, brand: '', text: '', email: '', made: new Set() }

  // category chips
  catsEl.innerHTML = Object.entries(CATEGORIES)
    .map(
      ([k, c]) => `<label class="chip-r"><input type="radio" name="cat" value="${k}"><span>${c.label}</span></label>`,
    )
    .join('')
  const setCat = (k, byHand = false) => {
    state.cat = k
    if (byHand) state.catByHand = true
    catsEl.querySelectorAll('input').forEach((i) => {
      i.checked = i.value === k
    })
  }
  catsEl.addEventListener('change', (e) => setCat(e.target.value, true))

  // brief or prompt
  const modeBox = (m) => briefForm.querySelector(`[data-mode="${m}"]`)
  briefForm.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      state.mode = r.value
      modeBox('brief').hidden = r.value !== 'brief'
      modeBox('prompt').hidden = r.value !== 'prompt'
    }),
  )
  const textNow = () =>
    state.mode === 'brief'
      ? briefForm.brief.value.trim()
      : [briefForm.what.value.trim(), briefForm.who.value.trim()].filter(Boolean).join(' · ')
  briefForm.addEventListener('input', (e) => {
    if (e.target.name === 'cat' || state.catByHand) return
    const k = pickCategory(textNow())
    if (k) setCat(k)
  })
  section.querySelector('[data-sample]').addEventListener('click', () => {
    const k = state.cat || 'food'
    const c = CATEGORIES[k]
    setCat(k)
    briefForm.brief.value = c.sample.brief
    briefForm.what.value = c.sample.what
    briefForm.who.value = c.sample.who
    briefForm.brand.value = c.brand
  })

  const go = (name) => {
    const order = ['brief', 'email', 'ideas', 'make']
    Object.entries(panes).forEach(([k, p]) => {
      p.hidden = k !== name
      p.classList.toggle('is-on', k === name)
    })
    dots.forEach((d) => {
      const i = order.indexOf(d.dataset.dot),
        j = order.indexOf(name)
      d.classList.toggle('is-on', i === j)
      d.classList.toggle('is-done', i < j)
    })
    const p = panes[name]
    if (!still) gsap.fromTo(p, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'expo.out' })
    const r = studio.getBoundingClientRect()
    if (r.top < 0) studio.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    p.querySelector('input:not([type=radio]), textarea, button')?.focus({ preventScroll: true })
  }

  briefForm.addEventListener('submit', (e) => {
    e.preventDefault()
    state.text = textNow()
    const err = briefForm.querySelector('[data-err-brief]')
    if (state.text.length < 3) {
      err.textContent = 'Add a few words about the product first, or use a sample.'
      err.hidden = false
      return
    }
    if (!state.cat) {
      err.textContent = 'Pick the closest category so we show the right examples.'
      err.hidden = false
      return
    }
    err.hidden = true
    state.brand = briefForm.brand.value.trim() || CATEGORIES[state.cat].brand
    go('email')
  })
  emailForm.querySelector('[data-back]').addEventListener('click', () => go('brief'))
  emailForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const v = emailForm.email.value.trim()
    const err = emailForm.querySelector('[data-err-email]')
    const ok = /.+@.+\..+/.test(v)
    err.hidden = ok
    emailForm.email.setAttribute('aria-invalid', String(!ok))
    if (!ok) {
      emailForm.email.focus()
      return
    }
    state.email = v
    // until a form service is chosen there is nowhere to send this; set data-endpoint on the studio to post it
    const url = studio.dataset.endpoint
    if (url)
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: v, brief: state.text, category: state.cat, brand: state.brand }),
      }).catch(() => {})
    showIdeas()
    go('ideas')
  })

  // the four angles
  const ideasEl = section.querySelector('[data-ideas]')
  const routes = () => CATEGORIES[state.cat].routes
  const showIdeas = () => {
    section.querySelector('[data-brand-name]').textContent = state.brand
    ideasEl.innerHTML = routes()
      .map(
        (r, i) => `
      <li class="idea" style="--acc:${r.pal[2]};--bg:${r.pal[0]};--fg:${r.pal[1]}${r.img ? `;--img:url(/images/brimble/${r.img}.webp);--pos:${r.pos}` : ''}">
        <span class="idea__n px">0${i + 1}</span>
        <span class="idea__wire wire--${r.tpl}" aria-hidden="true"><i></i><i></i><i></i></span>
        <h4>${esc(r.name)}</h4>
        <p>${esc(r.angle)}</p>
        <span class="idea__tags">${r.tags.map((t) => `<em>${esc(t)}</em>`).join('')}</span>
        <button class="btn btn--quiet btn--sm" type="button" data-gen="${i}">Generate this one</button>
      </li>`,
      )
      .join('')
    if (!still)
      gsap.from(ideasEl.children, { y: 18, autoAlpha: 0, duration: 0.55, stagger: 0.08, ease: 'expo.out', delay: 0.1 })
  }
  section.querySelector('[data-gen-all]').addEventListener('click', () => make([0, 1, 2, 3]))
  ideasEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gen]')
    if (b) make([+b.dataset.gen])
  })

  // making + results
  const conceptsEl = section.querySelector('[data-concepts]')
  const status = section.querySelector('[data-make-status]')
  const foot = section.querySelector('[data-make-foot]')
  const title = section.querySelector('[data-make-title]')
  const LINES = [
    'Reading the brief',
    'Holding each route to one angle',
    'Setting the type',
    'Placing the product',
    'Refitting 1:1, 4:5, 9:16 and 1.91:1',
  ]

  // one size for all four, picked above the banners; each banner sits in a fixed 4:5 stage so nothing below moves
  const szpick = section.querySelector('[data-szpick]')
  state.size = 'k-45'
  const card = (r, i) => `
    <article class="concept" data-i="${i}">
      <div class="concept__stage">
        <div class="concept__frame ${state.size}" data-frame>
          ${state.made.has(i) ? cad(r, state.brand, CATEGORIES[state.cat].obj, state.size) : `<button class="concept__wait" type="button" data-more="${i}"><span class="px">0${i + 1}</span>${esc(r.name)}<em>Generate</em></button>`}
          <canvas class="concept__noise" aria-hidden="true"></canvas>
          <span class="concept__scan" aria-hidden="true"></span>
        </div>
      </div>
      <div class="concept__meta">
        <h4>${esc(r.name)}</h4>
        <p>${esc(r.angle)}</p>
      </div>
    </article>`
  szpick.addEventListener('click', (e) => {
    const b = e.target.closest('[data-size-btn]')
    if (!b) return
    const size = b.dataset.sizeBtn
    state.size = size
    szpick.querySelectorAll('[data-size-btn]').forEach((x) => {
      const on = x === b
      x.classList.toggle('is-on', on)
      x.setAttribute('aria-pressed', String(on))
    })
    conceptsEl.querySelectorAll('[data-frame]').forEach((frame) => {
      frame.className = `concept__frame ${size}`
      const c = frame.querySelector('.cad')
      if (!c) return
      c.classList.remove('k-11', 'k-45', 'k-916', 'k-191')
      c.classList.add(size)
      if (!still) gsap.fromTo(c.children, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.03 })
    })
  })

  // one making run at a time: a new one stops the last, whose cards it redraws
  let making = null
  const make = (which) => {
    making?.kill()
    making = null
    which.forEach((i) => state.made.add(i))
    conceptsEl.innerHTML = routes().map(card).join('')
    foot.hidden = true
    title.textContent = which.length > 1 ? 'Making four concepts' : 'Making your concept'
    go('make')
    if (still) {
      done()
      return
    }
    const tl = gsap.timeline({ onComplete: done })
    making = tl
    const total = 1.6 + which.length * 0.35
    LINES.forEach((l, k) =>
      tl.call(
        () => {
          status.textContent = `${l}…`
        },
        null,
        (k / LINES.length) * total,
      ),
    )
    which.forEach((i, n) => {
      const art = conceptsEl.querySelector(`[data-i="${i}"]`)
      const frame = art.querySelector('[data-frame]')
      const canvas = frame.querySelector('canvas')
      const scan = frame.querySelector('.concept__scan')
      const ad = frame.querySelector('.cad')
      const at = n * 0.35
      art.classList.add('is-making')
      gsap.set(canvas, { autoAlpha: 1 })
      gsap.set(ad.children, { autoAlpha: 0, y: 10 })
      tl.add(dither(canvas, routes()[i].pal, 1.3, 0), at)
        .fromTo(scan, { yPercent: -100, autoAlpha: 1 }, { yPercent: 2400, duration: 1.3, ease: 'none' }, at)
        .set(scan, { autoAlpha: 0 })
        .to(canvas, { autoAlpha: 0, duration: 0.35 }, at + 1.2)
        .to(ad.children, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.06, ease: 'expo.out' }, at + 1.25)
        .call(() => art.classList.remove('is-making'), null, at + 1.6)
    })
  }
  const done = () => {
    status.textContent =
      state.made.size === 4 ? 'Four routes, every size' : `${state.made.size} of 4 made · generate the rest any time`
    title.textContent = `Concepts for ${state.brand}`
    foot.hidden = false
    if (!still) gsap.from(foot, { autoAlpha: 0, y: 10, duration: 0.5 })
  }
  conceptsEl.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]')
    if (more) {
      make([+more.dataset.more])
      return
    }
  })

  section.querySelector('[data-restart]').addEventListener('click', () => {
    state.made.clear()
    go('brief')
  })

  // carry what they made into the pilot form
  section.querySelector('[data-editable]').addEventListener('click', () => {
    const form = document.querySelector('[data-form]')
    if (!form) return
    if (form.email && !form.email.value) form.email.value = state.email
    let note = form.querySelector('input[name="brief"]')
    if (!note) {
      note = document.createElement('input')
      note.type = 'hidden'
      note.name = 'brief'
      form.appendChild(note)
    }
    const names = [...state.made].map((i) => routes()[i].name).join(', ')
    note.value = `${state.brand}: ${state.text} | Routes liked: ${names}`
    form.classList.add('is-from-try')
  })

  return { kill() {} }
}
