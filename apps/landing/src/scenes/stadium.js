import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ROUTES, BRIEF, banner } from '../content/routes.js'

// The concert (v3.5 stadium, pass 3). One camera, standing in a stadium crowd looking at the stage. The painted layers
// (art/concert/stadium) give the stands, the stage with its LED screens, haze, the barrier and the far crowd. In front
// of the stage the brief's routes hang in the air on a curved wall of cards that turns like a carousel: the route at
// the front faces you, the others curve away to either side. The big LED screen shows the brief they came from.
// The crowd nearer the stage is drawn: hundreds of small painted figures (art/concert/crowd), dark against the stage,
// rim-lit, bobbing to the beat. Each person belongs to one route. When that route comes to the front its people raise
// a phone that glows, the beams find them and the light pools on their heads; now and then someone else lights up in
// their own route's colour. Hovering (tapping on a phone) a person shows who they are: a face (DiceBear "Notionists",
// CC0), name, age, city, one line about them and the audience they belong to.

const F = { w: 1536, h: 1040 } // the frame, in art px
const SRC = '/sprites/concert/stadium/'
const TAU = Math.PI * 2
// where each layer sits in the frame (art px): x, y, width, height, and how much it pushes in on scroll
const LAYERS = [
  ['backdrop', 'sd-backdrop', 0, -40, 1536, 1024, 0],
  ['stage', 'sd-stage', 0, -70, 1536, 1024, 0.02],
  ['haze', 'sd-haze', 0, 10, 1536, 1024, 0.04],
  ['far', 'sd-crowd-far', 0, 200, 1536, 1024, 0.06],
  ['cards', null, 0, 0, 0, 0, 0.07],
  ['crowd', null, 0, 0, 0, 0, 0.12],
]
// the LED screens in the stage art (frame px): the big one shows the brief, the side ones the route at the front
const SCREENS = { mid: [472, 268, 591, 308], left: [270, 268, 163, 305, '916'], right: [1102, 268, 163, 307, '45'] }
const LAMPS = [197, 307, 459, 587, 705, 830, 948, 1076, 1226, 1338].map((x) => [x, 118])
const VP = [768, 360] // the vanishing point: the camera pushes in toward it
// the carousel: a curved wall of cards seen from its centre (frame px). Each route is on it twice, so it reads as a wall.
const CAR = { x: 768, y: 624, r: 780, p: 1700, cw: 212, n: ROUTES.length * 2 }
const STEP = 360 / CAR.n
const CROWD_TOP = 790

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const ok = (...v) => v.every(Number.isFinite) // a background tab can hand back NaN sizes; skip that frame's light

// a steady random, so the crowd is the same on every visit
const rnd = (() => {
  let a = 11
  return () => {
    a = (a * 16807) % 2147483647
    return a / 2147483647
  }
})()
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
// people: made up, the same on every visit. Lines describe the person, not the ad; no he or she
const NAMES = [
  'Maya',
  'Tom',
  'Priya',
  'Josh',
  'Aisha',
  'Ben',
  'Chloe',
  'Sam',
  'Nadia',
  'Leo',
  'Grace',
  'Ollie',
  'Zara',
  'Dan',
  'Mei',
  'Luke',
  'Hannah',
  'Ravi',
  'Ella',
  'Marcus',
  'Sophie',
  'Kofi',
  'Isla',
  'Jack',
  'Amara',
  'Finn',
  'Lucy',
  'Omar',
  'Ruby',
  'Theo',
  'Jade',
  'Arjun',
  'Carmen',
  'Yusuf',
  'Freya',
  'Diego',
  'Noor',
  'Callum',
  'Hana',
  'Mateo',
]
const PLACES = [
  'Leeds',
  'Austin',
  'Brisbane',
  'Bristol',
  'Denver',
  'Perth',
  'Manchester',
  'Portland',
  'Melbourne',
  'Glasgow',
  'Chicago',
  'Adelaide',
  'Brighton',
  'Seattle',
  'Sydney',
  'Cardiff',
  'Boston',
  'Auckland',
  'Toronto',
  'Dublin',
]
const LINES = [
  [
    'Has tried three cleansers this year and kept none.',
    'Reads every before-and-after photo twice.',
    'Wants to see results first, then the price.',
  ],
  [
    'Gets two kids out of the door by eight.',
    'Has five minutes for skincare on a good day.',
    'Keeps the routine short so it actually happens.',
  ],
  [
    'Tries to eat healthy and looks at ingredients.',
    'Avoids anything with added fragrance.',
    'Looks up any ingredient that sounds made up.',
  ],
  [
    'Reads the reviews before the product page.',
    'Trusts someone with the same skin over any brand.',
    'Asks friends before trying anything new.',
  ],
  [
    'Has used the same foam cleanser for years.',
    'Notices skin feels tight after washing.',
    'Compares pack sizes and prices before buying.',
  ],
  [
    'Turns the evening wash into a quiet ritual.',
    'Likes a bathroom that feels calm.',
    'Picks the bottle that looks and feels soft.',
  ],
]
const AGES = [
  [24, 52],
  [30, 45],
  [22, 48],
  [19, 34],
  [27, 58],
  [22, 35],
]

// the drawn crowd: many rows of small figures, from just behind the barrier down past the bottom edge
const FIG = [
  'c-person-short-hair',
  'c-person-bun',
  'c-person-long-hair',
  'c-person-cap',
  'c-person-beanie',
  'c-person-curly',
  'c-person-ponytail',
  'c-couple',
]
const POSE = 'c-person-phone-up'
const PEOPLE = []
const ROWS = 18
for (let row = 0; row < ROWS; row++) {
  const t = row / (ROWS - 1)
  const y = CROWD_TOP + 300 * Math.pow(t, 1.15),
    s = 0.32 + t * 0.78,
    n = Math.round(104 - t * 58)
  for (let j = 0; j < n; j++) {
    const r = Math.floor(rnd() * ROUTES.length),
      [a0, a1] = AGES[r]
    PEOPLE.push({
      x: -20 + ((F.w + 40) * (j + 0.5 + (rnd() - 0.5) * 0.9)) / n,
      y: y + (rnd() - 0.5) * 8 * s,
      s,
      row,
      route: r,
      fig: Math.floor(rnd() * FIG.length),
      hs: 0.88 + rnd() * 0.24,
      arm: rnd() < 0.5 ? -1 : 1,
      ph: rnd() * TAU,
      on: rnd() < 0.75,
      flash: 0,
      fr: r,
      name: pick(NAMES),
      age: a0 + Math.floor(rnd() * (a1 - a0 + 1)),
      place: pick(PLACES),
      line: pick(LINES[r]),
    })
  }
}

export function stadium(root, { still = false } = {}) {
  if (!root) return null
  const sec = root.closest('[data-orbit-sec]') || root.parentElement
  const nameEl = sec.querySelector('[data-picked-name]')
  const whoEl = sec.querySelector('[data-picked-who]')
  const whyEl = sec.querySelector('[data-picked-why]')
  const list = sec.querySelector('[data-setlist]')

  // ---- build the frame
  const frame = document.createElement('div')
  frame.className = 'sd__frame'
  const layer = {}
  const img = (cls, name, x, y, w, h) => {
    const i = document.createElement('img')
    i.className = `sd__l sd__l--${cls}`
    i.src = `${SRC}${name}.webp`
    i.alt = ''
    i.decoding = 'async'
    i.draggable = false
    Object.assign(i.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
    return i
  }
  const canvas = (cls) => {
    const c = document.createElement('canvas')
    c.className = `sd__cv sd__${cls}`
    c.width = F.w
    c.height = F.h
    return c
  }
  let cards = []
  for (const [key, name, x, y, w, h] of LAYERS) {
    const g = document.createElement('div')
    g.className = `sd__g sd__g--${key}`
    frame.appendChild(g)
    layer[key] = g
    if (name) g.appendChild(img(key, name, x, y, w, h))
    if (key === 'backdrop') {
      const wash = document.createElement('div')
      wash.className = 'sd__wash'
      g.appendChild(wash)
    }
    if (key === 'stage') {
      for (const [kk, [x0, y0, w0, h0, size]] of Object.entries(SCREENS)) {
        const s = document.createElement('div')
        s.className = `sd__screen sd__screen--${kk}`
        Object.assign(s.style, { left: `${x0}px`, top: `${y0}px`, width: `${w0}px`, height: `${h0}px` })
        s.innerHTML = size
          ? '<div class="sd__ad"></div><i class="sd__led"></i>'
          : `<div class="sd__brief-scr"><span class="px">Tonight's brief</span><b>${BRIEF.title}</b><span>${BRIEF.line}</span><span class="mono">${BRIEF.brand} · from 18 March</span></div><i class="sd__led"></i>`
        g.appendChild(s)
      }
    }
    if (key === 'haze') {
      g.appendChild(Object.assign(document.createElement('div'), { className: 'sd__barrier' }))
      layer.beams = canvas('beams')
      g.appendChild(layer.beams)
    }
    if (key === 'cards') {
      layer.aura = canvas('aura')
      g.appendChild(layer.aura)
      const car = document.createElement('div')
      car.className = 'sd__car'
      car.style.perspective = `${CAR.p}px`
      car.style.perspectiveOrigin = `${CAR.x}px ${CAR.y}px`
      const inner = document.createElement('div')
      inner.className = 'sd__car-in'
      Object.assign(inner.style, { left: `${CAR.x}px`, top: `${CAR.y}px` })
      inner.innerHTML = Array.from({ length: CAR.n }, (_, i) => {
        const r = ROUTES[i % ROUTES.length]
        return `<button type="button" class="sd__card" data-i="${i}" tabindex="-1" style="--acc:${r.acc};width:${CAR.cw}px">${banner(r, '45')}<span class="sd__card-name">${r.name}</span></button>`
      }).join('')
      car.appendChild(inner)
      g.appendChild(car)
      cards = [...inner.children]
    }
    if (key === 'crowd') {
      layer.crowdCv = canvas('crowd')
      g.appendChild(layer.crowdCv)
    }
  }
  const rim = document.createElement('div')
  rim.className = 'sd__rim'
  frame.appendChild(rim)
  const front = canvas('front')
  frame.appendChild(front) // light pools on the crowd, phones, the follow spot, confetti
  const flash = document.createElement('div')
  flash.className = 'sd__flash'
  frame.appendChild(flash)
  root.appendChild(frame)
  const tip = document.createElement('div')
  tip.className = 'orbit__tip'
  tip.setAttribute('aria-hidden', 'true')
  root.appendChild(tip)

  // ---- the frame is drawn at art size and scaled to the column; on a phone it is drawn bigger and cut at the sides
  let k = 1,
    cropX = 0,
    cropY = 0
  const fit = () => {
    const w = root.clientWidth
    if (!w) return
    k = w / F.w
    let h = Math.min(F.h * k, Math.max(420, window.innerHeight * 0.9))
    cropX = 0
    if (w < 760) {
      h = Math.min(window.innerHeight * 0.78, 600)
      k = h / 900 // show 900 art px of height: truss to crowd
      cropX = (F.w - w / k) / 2
    }
    cropY = (F.h - h / k) * 0.3
    frame.style.transform = `scale(${k}) translate(${-cropX}px, ${-cropY}px)`
    root.style.height = `${h}px`
  }
  const ro = new ResizeObserver(fit)
  ro.observe(root)
  fit()

  // ---- the setlist: one button per route
  list.innerHTML = ROUTES.map(
    (r, i) =>
      `<li><button type="button" data-i="${i}" style="--acc:${r.acc}"><span class="mono">${String(i + 1).padStart(2, '0')}</span>${r.name}</button></li>`,
  ).join('')
  const btns = [...list.querySelectorAll('button')]

  // ---- the carousel: card i sits at angle i * STEP + a on the outside of a cylinder, so the sides turn and recede
  const st = { a: 0 }
  const wrap = (d) => (((d % 360) + 540) % 360) - 180
  const placeCards = (now) => {
    cards.forEach((c, i) => {
      const th = wrap(i * STEP + st.a),
        off = Math.abs(th)
      const vis = off < 80
      c.style.visibility = vis ? 'visible' : 'hidden'
      if (!vis) return
      const bob = still ? 0 : Math.sin(now / 1900 + i * 1.3) * 7
      const depth = Math.cos((th * Math.PI) / 180)
      c.style.transform = `translateZ(${-CAR.r}px) rotateY(${th.toFixed(2)}deg) translateZ(${CAR.r}px) translate(-50%, calc(-50% + ${bob.toFixed(1)}px))`
      c.style.zIndex = String(Math.round(depth * 100))
      c.style.filter = `brightness(${(0.45 + 0.55 * depth ** 3).toFixed(2)}) saturate(${(0.7 + 0.3 * depth).toFixed(2)})`
      c.classList.toggle('is-front', off < STEP / 2)
    })
  }

  // ---- the drawn crowd: each figure is pre-tinted once (dark in the room, a cool rim from the stage, and lit versions)
  const ART = {},
    TINT = {}
  let artReady = false
  const small = (im, h) => {
    const c = document.createElement('canvas')
    c.height = h
    c.width = Math.round((h * im.width) / im.height)
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height)
    return c
  }
  const tinted = (im, fill, a) => {
    const c = document.createElement('canvas')
    c.width = im.width
    c.height = im.height
    const g = c.getContext('2d')
    g.drawImage(im, 0, 0)
    g.globalCompositeOperation = 'source-atop'
    g.globalAlpha = a
    g.fillStyle = fill
    g.fillRect(0, 0, c.width, c.height)
    return c
  }
  const rimOf = (im, fill) => {
    const c = document.createElement('canvas')
    c.width = im.width
    c.height = im.height
    const g = c.getContext('2d')
    g.drawImage(im, 0, 0)
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = fill
    g.fillRect(0, 0, c.width, c.height)
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(im, 0, Math.max(2, im.height * 0.04))
    return c
  }
  Promise.all(
    [...FIG, POSE].map(
      (n) =>
        new Promise((done) => {
          const i = new Image()
          i.decoding = 'async'
          i.onload = () => {
            ART[n] = i
            done()
          }
          i.onerror = () => done()
          i.src = `/sprites/concert/crowd/${n}.webp`
        }),
    ),
  ).then(() => {
    if (![...FIG, POSE].every((n) => ART[n])) return
    for (const n of [...FIG, POSE]) {
      const base = small(ART[n], 140)
      TINT[n] = {
        dark: tinted(base, '#05080e', 0.82),
        lit: tinted(base, '#0a0e16', 0.4),
        rim: rimOf(base, '#9fb6d6'),
        routeRim: ROUTES.map((r) => rimOf(base, r.acc)),
      }
    }
    artReady = true
  })

  // ---- light: beams from the truss onto that route's people, pools where they land, phones lighting up
  const bx = layer.beams.getContext('2d'),
    ax = layer.aura.getContext('2d'),
    cx = layer.crowdCv.getContext('2d'),
    fx = front.getContext('2d')
  let colour = rgb(ROUTES[0].acc),
    burst = 0,
    cur = -1,
    farBob = 0
  const glowV = ROUTES.map(() => ({ v: 0 }))
  const scaleOf = (key) => {
    const v = +gsap.getProperty(layer[key], 'scale')
    return Number.isFinite(v) && v > 0 ? v : 1
  }
  const BEAT = 60000 / 118
  const beat = (now, off) => Math.pow(Math.sin((((now + BEAT * off) % BEAT) / BEAT) * Math.PI), 2)
  const bobOf = (p, now) => (still ? 0 : -beat(now, p.ph / TAU) * (2 + 3 * p.s) * (1 + burst + glowV[p.route].v * 0.6))
  const shown = (p, now = performance.now()) => {
    // where a person is drawn now, after the push-in and the beat
    const sc = scaleOf('crowd')
    return [VP[0] + (p.x - VP[0]) * sc, VP[1] + (p.y + bobOf(p, now) - VP[1]) * sc, p.s * sc]
  }
  let aims = []
  const aim = () => {
    const mine = PEOPLE.filter((p) => p.route === cur && p.row > 3 && p.row < ROWS - 2)
    aims = LAMPS.map(([lx]) => {
      const near = mine.filter((p) => Math.abs(p.x - lx) < 380)
      const from = near.length ? near : mine
      return from[Math.floor(rnd() * from.length)]
    })
  }
  const sway = (now, i) => (still ? 0 : Math.sin(now / (2300 + i * 90) + i * 1.7) * 30)
  const drawBeams = (now) => {
    bx.clearRect(0, 0, F.w, F.h)
    bx.globalCompositeOperation = 'lighter'
    const c = colour,
      hot = mix(c, [255, 255, 255], 0.45)
    LAMPS.forEach(([lx, ly], i) => {
      const p = aims[i]
      if (!p) return
      const [px, py] = shown(p, now)
      const tx = px + sway(now, i),
        ty = py - 10
      if (!ok(tx, ty)) return
      const len = Math.hypot(tx - lx, ty - ly),
        ang = Math.atan2(ty - ly, tx - lx)
      const spread = 24 + burst * 22
      const a = (0.03 + 0.02 * Math.max(0, Math.sin(now / 520 + i * 2.1))) * (1 + burst * 1.8)
      const g = bx.createLinearGradient(lx, ly, tx, ty)
      g.addColorStop(0, rgba(hot, Math.min(0.5, a * 2.4)))
      g.addColorStop(0.7, rgba(c, a * 0.7))
      g.addColorStop(1, rgba(c, a * 0.9))
      bx.fillStyle = g
      bx.save()
      bx.translate(lx, ly)
      bx.rotate(ang)
      bx.beginPath()
      bx.moveTo(0, -4)
      bx.lineTo(len, -spread)
      bx.lineTo(len, spread)
      bx.lineTo(0, 4)
      bx.closePath()
      bx.fill()
      bx.restore()
      const glow = bx.createRadialGradient(lx, ly, 0, lx, ly, 24)
      glow.addColorStop(0, rgba([255, 255, 255], 0.9))
      glow.addColorStop(0.4, rgba(hot, 0.45))
      glow.addColorStop(1, rgba(c, 0))
      bx.fillStyle = glow
      bx.beginPath()
      bx.arc(lx, ly, 24, 0, TAU)
      bx.fill()
    })
    bx.globalCompositeOperation = 'source-over'
  }

  // the aura behind the cards: a soft column of the route's light rising from the stage, a glow on the deck, motes drifting up
  const MOTES = Array.from({ length: 70 }, () => ({
    x: CAR.x + (rnd() - 0.5) * 1300,
    y: 200 + rnd() * 560,
    v: 6 + rnd() * 14,
    r: 0.8 + rnd() * 2.2,
    ph: rnd() * TAU,
  }))
  const drawAura = (now, dt) => {
    ax.clearRect(0, 0, F.w, F.h)
    const c = colour,
      hot = mix(c, [255, 255, 255], 0.55)
    ax.globalCompositeOperation = 'lighter'
    const col = ax.createLinearGradient(0, 780, 0, 160)
    col.addColorStop(0, rgba(c, 0.16 + burst * 0.12))
    col.addColorStop(1, rgba(c, 0))
    ax.fillStyle = col
    ax.beginPath()
    ax.ellipse(CAR.x, 780, 320, 620, 0, Math.PI, 0)
    ax.fill()
    ax.save()
    ax.translate(CAR.x, CAR.y + 150)
    ax.scale(1, 0.16)
    const pool = ax.createRadialGradient(0, 0, 0, 0, 0, 640)
    pool.addColorStop(0, rgba(hot, 0.35 + burst * 0.2))
    pool.addColorStop(1, rgba(c, 0))
    ax.fillStyle = pool
    ax.beginPath()
    ax.arc(0, 0, 640, 0, TAU)
    ax.fill()
    ax.restore()
    for (const m of MOTES) {
      if (!still) {
        m.y -= m.v * dt
        if (m.y < 160) {
          m.y = 780
          m.x = CAR.x + (rnd() - 0.5) * 1300
        }
      }
      const a = (0.25 + 0.35 * Math.sin(now / 700 + m.ph)) * Math.min(1, (m.y - 160) / 120)
      ax.fillStyle = rgba(hot, Math.max(0, a))
      ax.beginPath()
      ax.arc(m.x + Math.sin(now / 1500 + m.ph) * 8, m.y, m.r, 0, TAU)
      ax.fill()
    }
    ax.globalCompositeOperation = 'source-over'
  }

  // the crowd, back rows first. Lit people (the front route) raise a phone; a few others flash in their own route's colour.
  const drawCrowd = (now, dt) => {
    cx.clearRect(0, 0, F.w, F.h)
    if (!artReady) return
    if (!still && Math.random() < dt * 9) {
      // someone somewhere lights up for a moment
      const p = PEOPLE[Math.floor(Math.random() * PEOPLE.length)]
      if (p.route !== cur)
        gsap.fromTo(
          p,
          { flash: 0 },
          {
            flash: 1,
            duration: 0.5,
            yoyo: true,
            repeat: 1,
            repeatDelay: 1.2 + Math.random() * 1.5,
            ease: 'sine.inOut',
          },
        )
    }
    for (const p of PEOPLE) {
      const L = glowV[p.route].v * (p.on ? 1 : 0.35),
        Fl = p.flash
      const pose = L > 0.3 && p.on
      const n = pose ? POSE : FIG[p.fig],
        t = TINT[n]
      const y = p.y + bobOf(p, now),
        h = 46 * p.s * p.hs * (pose ? 1.3 : 1),
        w = (h * t.dark.width) / t.dark.height
      const X = p.x - w / 2,
        Y = y + 2 * p.s - h
      const flip = pose && p.arm < 0
      if (flip) {
        cx.save()
        cx.translate(p.x, 0)
        cx.scale(-1, 1)
        cx.translate(-p.x, 0)
      }
      cx.drawImage(t.dark, X, Y, w, h)
      const lift = Math.max(L, Fl)
      if (lift > 0.02) {
        cx.globalAlpha = lift
        cx.drawImage(t.lit, X, Y, w, h)
      }
      cx.globalCompositeOperation = 'lighter'
      cx.globalAlpha = 0.18 + 0.12 * lift
      cx.drawImage(t.rim, X, Y, w, h)
      if (L > 0.02) {
        cx.globalAlpha = 0.85 * L
        cx.drawImage(t.routeRim[p.route], X, Y, w, h)
      }
      if (Fl > 0.02) {
        cx.globalAlpha = Fl
        cx.drawImage(t.routeRim[p.route], X, Y, w, h)
      }
      cx.globalCompositeOperation = 'source-over'
      cx.globalAlpha = 1
      if (flip) cx.restore()
      p.px = flip ? p.x + (p.x - (X + w * 0.58)) : X + w * 0.58
      p.py = Y + h * 0.07 // where the phone is, for its glow
    }
    // the floor fades into the dark at the bottom edge
    const fade = cx.createLinearGradient(0, F.h - 120, 0, F.h)
    fade.addColorStop(0, 'rgba(5,8,14,0)')
    fade.addColorStop(1, 'rgba(5,8,14,.85)')
    cx.fillStyle = fade
    cx.fillRect(0, F.h - 120, F.w, 120)
  }

  let hover = null,
    bits = []
  const throwConfetti = (c) => {
    for (let n = 0; n < 120; n++) {
      bits.push({
        x: 200 + Math.random() * 1136,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 60,
        vy: 70 + Math.random() * 90,
        r: Math.random() * 6.3,
        vr: (Math.random() - 0.5) * 8,
        w: 6 + Math.random() * 7,
        h: 3 + Math.random() * 5,
        c: Math.random() < 0.55 ? c : Math.random() < 0.5 ? [255, 255, 255] : mix(c, [255, 255, 255], 0.5),
      })
    }
  }
  const glowAt = (x, y, r, c, a) => {
    if (!ok(x, y, r) || r <= 0) return
    const g = fx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rgba([255, 255, 255], a))
    g.addColorStop(0.3, rgba(mix(c, [255, 255, 255], 0.5), a * 0.45))
    g.addColorStop(1, rgba(c, 0))
    fx.fillStyle = g
    fx.beginPath()
    fx.arc(x, y, r, 0, TAU)
    fx.fill()
  }
  const drawFront = (now, dt) => {
    fx.clearRect(0, 0, F.w, F.h)
    const sc = scaleOf('crowd'),
      at = (x, y) => [VP[0] + (x - VP[0]) * sc, VP[1] + (y - VP[1]) * sc]
    fx.globalCompositeOperation = 'lighter'
    const c = colour,
      hot = mix(c, [255, 255, 255], 0.5)
    // where the beams land: soft pools on heads and shoulders
    LAMPS.forEach((_, i) => {
      const p = aims[i]
      if (!p) return
      const [px0, py, s] = shown(p, now),
        px = px0 + sway(now, i),
        rx = 110 * s + burst * 40
      if (!ok(px, py, rx) || rx <= 0) return
      const g = fx.createRadialGradient(px, py, 0, px, py, rx)
      g.addColorStop(0, rgba(hot, 0.3 + burst * 0.15))
      g.addColorStop(0.5, rgba(c, 0.12 + burst * 0.06))
      g.addColorStop(1, rgba(c, 0))
      fx.fillStyle = g
      fx.save()
      fx.translate(px, py)
      fx.scale(1, 0.45)
      fx.translate(-px, -py)
      fx.beginPath()
      fx.arc(px, py, rx, 0, TAU)
      fx.fill()
      fx.restore()
    })
    // the phones: a small bright screen in each raised hand, kept subtle
    if (artReady)
      for (const p of PEOPLE) {
        const L = glowV[p.route].v
        if (L < 0.3 || !p.on || p.px === undefined) continue
        const fl = still ? 1 : 0.8 + 0.2 * Math.sin(now / 280 + p.ph)
        const [x, y] = at(p.px, p.py)
        glowAt(x, y, 11 * p.s * sc, c, 0.55 * L * fl)
      }
    // the follow spot on the person under the pointer
    if (hover) {
      const [x, y, s] = shown(hover, now)
      if (ok(x, y, s)) {
        const g = fx.createLinearGradient(x, 0, x, y)
        g.addColorStop(0, 'rgba(255,250,235,0)')
        g.addColorStop(1, 'rgba(255,250,235,.2)')
        fx.fillStyle = g
        fx.beginPath()
        fx.moveTo(x - 6, 0)
        fx.lineTo(x + 6, 0)
        fx.lineTo(x + 26 * s, y)
        fx.lineTo(x - 26 * s, y)
        fx.fill()
        glowAt(x, y - 18 * s, 30 * s, [255, 245, 225], 0.35)
      }
    }
    fx.globalCompositeOperation = 'source-over'
    if (hover) {
      const [x, y, s] = shown(hover, now)
      if (ok(x, y, s)) {
        fx.strokeStyle = 'rgba(255,255,255,.9)'
        fx.lineWidth = 2
        fx.beginPath()
        fx.arc(x, y - 22 * s, 20 * s, 0, TAU)
        fx.stroke()
      }
    }
    if (bits.length) {
      bits = bits.filter((b) => b.y < F.h + 20)
      for (const b of bits) {
        b.vy += 26 * dt
        b.x += (b.vx + Math.sin(b.y / 40 + b.r) * 30) * dt
        b.y += b.vy * dt
        b.r += b.vr * dt
        fx.save()
        fx.translate(b.x, b.y)
        fx.rotate(b.r)
        fx.scale(1, Math.cos(b.r * 1.7))
        fx.fillStyle = rgba(b.c, 0.95)
        fx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
        fx.restore()
      }
    }
  }

  // ---- a route takes the stage
  let timer = 0,
    spin = null,
    running = false
  const targetFor = (i) => {
    // the carousel angle that brings route i to the front, the short way
    let best = null
    for (const j of [i, i + ROUTES.length]) {
      const d = wrap(-j * STEP - st.a)
      if (best === null || Math.abs(d) < Math.abs(best)) best = d
    }
    return st.a + best
  }
  const show = (i, { quiet = false, to = null } = {}) => {
    const target = to ?? targetFor(i)
    spin?.kill()
    if (quiet || still) st.a = target
    else spin = gsap.to(st, { a: target, duration: 1.6, ease: 'power3.inOut' })
    if (i === cur) return
    cur = i
    const r = ROUTES[i]
    btns.forEach((b, n) => {
      b.classList.toggle('is-on', n === i)
      b.setAttribute('aria-pressed', String(n === i))
    })
    nameEl.textContent = r.name
    whoEl.textContent = r.who.charAt(0).toLowerCase() + r.who.slice(1)
    whyEl.textContent = r.why
    const swap = () => {
      for (const kk of ['left', 'right'])
        frame.querySelector(`.sd__screen--${kk} .sd__ad`).innerHTML = banner(r, SCREENS[kk][4])
      sec.style.setProperty('--front', r.acc)
      frame.style.setProperty('--front', r.acc)
      colour = rgb(r.acc)
      aim()
      glowV.forEach((g, n) =>
        gsap.to(g, { v: n === i ? 1 : 0, duration: quiet || still ? 0 : 0.9, ease: 'power2.out', overwrite: true }),
      )
    }
    if (quiet || still) {
      swap()
      return
    }
    // the song change: lights drop, the new colour floods in, beams flare, the crowd jumps, confetti
    const tl = gsap.timeline()
    tl.to(flash, { opacity: 0.6, duration: 0.25, ease: 'power2.in' })
      .add(swap)
      .to(flash, { opacity: 0, duration: 1, ease: 'power2.out' })
      .fromTo(
        frame.querySelectorAll('.sd__screen'),
        { filter: 'brightness(2) saturate(.6)' },
        { filter: 'brightness(1) saturate(1)', duration: 0.9, stagger: 0.06 },
        '<',
      )
      .to(
        { v: 0 },
        {
          v: 1,
          duration: 0.35,
          ease: 'power2.out',
          onUpdate() {
            burst = this.targets()[0].v
          },
        },
        '<',
      )
      .to(
        { v: 1 },
        {
          v: 0,
          duration: 2.6,
          ease: 'sine.inOut',
          onUpdate() {
            burst = this.targets()[0].v
          },
        },
        '>.4',
      )
      .add(() => throwConfetti(rgb(r.acc)), 0.3)
  }
  const next = () => show((cur + 1) % ROUTES.length)
  const loop = () => {
    clearTimeout(timer)
    if (!still && running)
      timer = setTimeout(() => {
        if (!hover && !dragging) next()
        loop()
      }, 6500)
  }
  btns.forEach((b, n) =>
    b.addEventListener('click', () => {
      show(n)
      loop()
    }),
  )

  // ---- drag the carousel round; a click on a side card brings it to the front
  let dragging = false,
    downX = 0,
    lastX = 0,
    moved = 0
  const toFrame = (e) => {
    const b = root.getBoundingClientRect()
    return [(e.clientX - b.left) / k + cropX, (e.clientY - b.top) / k + cropY]
  }
  root.addEventListener('pointerdown', (e) => {
    const [, my] = toFrame(e)
    if (my > CROWD_TOP - 20 && !e.target.closest('.sd__card')) return
    dragging = true
    downX = lastX = e.clientX
    moved = 0
    spin?.kill()
  })
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      moved += Math.abs(dx)
      st.a += (dx / k) * 0.09
      if (still) placeCards(0)
    },
    { passive: true },
  )
  window.addEventListener('pointerup', () => {
    if (!dragging) return
    dragging = false
    if (moved < 6) return
    const j = ((Math.round(-st.a / STEP) % CAR.n) + CAR.n) % CAR.n
    show(j % ROUTES.length, { to: -Math.round(-st.a / STEP) * STEP })
    loop()
  })
  cards.forEach((c, n) =>
    c.addEventListener('click', () => {
      if (moved > 6) return
      show(n % ROUTES.length, { to: st.a + wrap(-n * STEP - st.a) })
      loop()
    }),
  )

  // ---- hover: the person under the pointer shows who they are (a tap on touch screens)
  const faces = new Map()
  let maker = null,
    loading = null
  const loadFaces = () =>
    loading ||
    (loading = Promise.all([import('@dicebear/core'), import('@dicebear/notionists')])
      .then(([core, style]) => {
        maker = (seed) =>
          core
            .createAvatar(style, {
              seed,
              size: 96,
              backgroundColor: ['dcebf5', 'efe2cf', 'e5ead6', 'f6dfdc', 'f3e7c6'],
              backgroundType: ['solid'],
            })
            .toDataUri()
        if (hover) showTip(hover)
      })
      .catch(() => {}))
  root.addEventListener('pointerenter', loadFaces, { once: true })
  const face = (p) => {
    const key = `${p.name}-${p.age}-${p.place}`
    if (!maker) {
      loadFaces()
      return ''
    }
    if (!faces.has(key)) faces.set(key, maker(key))
    return faces.get(key)
  }
  const showTip = (p) => {
    const r = ROUTES[p.route],
      f = face(p)
    tip.style.setProperty('--acc', r.acc)
    tip.innerHTML = `<div class="tip__top">${f ? `<img src="${f}" alt="" width="56" height="56">` : '<span class="tip__face"></span>'}<div><b>${p.name}, ${p.age}</b><span>${p.place}</span></div></div>
      <p>${p.line}</p>
      <div class="tip__foot"><span>Audience</span><b>${r.who}</b></div>`
  }
  const placeTip = () => {
    if (!hover) return
    const [x, y, s] = shown(hover)
    if (!ok(x, y, s)) return
    const half = tip.offsetWidth / 2 + 8,
      tx = Math.min(root.clientWidth - half, Math.max(half, (x - cropX) * k))
    tip.style.transform = `translate(${tx}px, ${(y - 52 * s - cropY) * k}px) translate(-50%, -100%)`
  }
  const pickAt = (mx, my) => {
    let best = null,
      bd = Infinity
    if (my > CROWD_TOP - 40)
      for (const p of PEOPLE) {
        const [x, y, s] = shown(p)
        const d = Math.hypot(mx - x, (my - (y - 22 * s)) * 1.2)
        if (d < 20 * s && d < bd) {
          bd = d
          best = p
        }
      }
    return best
  }
  const setHover = (p) => {
    if (p === hover) return
    hover = p
    if (hover) showTip(hover)
    tip.classList.toggle('is-on', !!hover)
    root.classList.toggle('is-over-crowd', !!hover)
    if (still) paint(0, 0)
  }
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !dragging) {
      const [mx, my] = toFrame(e)
      setHover(pickAt(mx, my))
      placeTip()
    }
  })
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') setHover(null)
  })
  root.addEventListener('click', (e) => {
    if (e.target.closest('.sd__card') || moved > 6) return
    const [mx, my] = toFrame(e)
    setHover(pickAt(mx, my))
    placeTip()
  })

  const paint = (now, dt) => {
    placeCards(now)
    drawAura(now, dt)
    drawBeams(now)
    drawCrowd(now, dt)
    drawFront(now, dt)
    placeTip()
  }
  show(0, { quiet: true })

  if (still) {
    const t = setInterval(() => {
      if (artReady) {
        clearInterval(t)
        paint(0, 0)
      }
    }, 200)
    paint(0, 0)
    return {
      kill() {
        ro.disconnect()
        clearInterval(t)
      },
    }
  }

  // ---- motion: the far crowd bobbing, haze drifting, the cards floating, light and confetti
  let last = 0
  const tick = () => {
    const now = performance.now(),
      dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    farBob = -beat(now, 0.6) * 2
    layer.far.style.translate = `0 ${farBob.toFixed(2)}px`
    layer.haze.querySelector('.sd__l--haze').style.translate = `${(Math.sin(now / 5200) * 40).toFixed(1)}px 0`
    paint(now, dt)
  }
  const watch = ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      running = self.isActive
      if (running) {
        last = 0
        gsap.ticker.add(tick)
        loop()
      } else {
        gsap.ticker.remove(tick)
        clearTimeout(timer)
      }
    },
  })
  // scrolling pushes the camera in: near layers grow more than far ones, all toward the vanishing point
  const push = gsap.timeline({ scrollTrigger: { trigger: root, start: 'top bottom', end: 'bottom top', scrub: 0.6 } })
  for (const [key, , , , , , depth] of LAYERS) {
    layer[key].style.transformOrigin = `${VP[0]}px ${VP[1]}px`
    push.fromTo(layer[key], { scale: 1 }, { scale: 1 + depth * 1.4, ease: 'none' }, 0)
  }
  return {
    kill() {
      ro.disconnect()
      watch.kill()
      push.scrollTrigger?.kill()
      push.kill()
      gsap.ticker.remove(tick)
      clearTimeout(timer)
      spin?.kill()
    },
  }
}
