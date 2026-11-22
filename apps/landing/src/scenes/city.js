import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'

gsap.registerPlugin(ScrollToPlugin)
import { ROUTES, PLAIN, banner } from '../content/routes.js'
import { build, life, CELL, P } from './town.js'
import { SPRITES } from './town-sprites.js'
import { FREE } from './town-free.js'

// The city (v3.6). One painted iso city replaces three sections: "Meta wants more concepts" (the problem), the
// audience town (who each route is for) and the sizes town. It is pinned and the scroll drives it:
//  1 in through the clouds; "Meta wants more concepts." stands in the middle, the next line arrives, then both dock
//    left. The city is grey, like television before colour, the same plain ad is on every board, and only the few
//    people it was made for are in colour, each on a soft glow.
//  2 the brief goes into Dazbee: a Dazbee chip drops into the middle of the city and colour spreads out from where it
//    lands. As it passes, every board flips to one of six routes and many more people light up, each on a ring of the
//    route that fits them. Point at anyone in colour to see who they are (the card shows that very person).
//  3 the camera visits six boards one by one, each a different size, not only Meta's.
//  4 it pulls back over the busy city, then carries on down past the front of the city into the next section's paper.
// The city is packed like a picture book: every block built, people everywhere, something to find on every street.

const BACK = 66 // cells: where x + y is under this, the land is behind the mountains
const HIT = 2860 // world screen px (x = 0): where the Dazbee chip lands and the colour starts

// ---- who people are. Each painted figure has a look (presentation, age), so its card matches what you see.
// g: f, m or pair; routes: the routes such a person could plausibly be reached by
const LOOK = {
  'p-buggy': { g: 'f', age: [29, 38], routes: ['kitchen', 'picnic'] },
  'p-cafe': { g: 'f', age: [26, 36], routes: ['night', 'botanical', 'picnic'] },
  'p-coffee': { g: 'm', age: [28, 40], routes: ['swap', 'night'] },
  'p-couple': { g: 'pair', age: [66, 74], routes: ['botanical', 'picnic'] },
  'p-cyclist': { g: 'f', age: [22, 30], routes: ['popart', 'picnic', 'swap'] },
  'p-dog': { g: 'f', age: [25, 34], routes: ['picnic', 'night'] },
  'p-dog-walker': { g: 'f', age: [30, 42], routes: ['botanical', 'picnic'] },
  'p-headphones': { g: 'm', age: [18, 23], routes: ['popart', 'night'] },
  'p-jogger': { g: 'f', age: [24, 34], routes: ['swap', 'botanical'] },
  'p-parent-child': { g: 'f', age: [31, 40], routes: ['kitchen'] },
  'p-phone-walk': { g: 'f', age: [30, 42], routes: ['swap', 'night'] },
  'p-runner': { g: 'f', age: [22, 32], routes: ['swap', 'popart'] },
  'p-shopping': { g: 'f', age: [32, 44], routes: ['kitchen', 'botanical'] },
  'p-skater': { g: 'm', age: [17, 22], routes: ['popart'] },
  'p-suit': { g: 'm', age: [33, 45], routes: ['swap', 'night'] },
  'p-talk-phone': { g: 'f', age: [24, 34], routes: ['night', 'popart', 'swap'] },
  'p-talk-pointing': { g: 'f', age: [27, 38], routes: ['picnic', 'kitchen'] },
  'p-talk-waving': { g: 'm', age: [26, 36], routes: ['night', 'picnic'] },
  'p-tote': { g: 'f', age: [26, 38], routes: ['botanical', 'picnic'] },
  'p-walk-a': { g: 'f', age: [28, 40], routes: ['botanical', 'swap', 'kitchen'] },
  'p-walk-b': { g: 'm', age: [24, 36], routes: ['night', 'swap'] },
}
const AGES = {
  swap: [30, 45],
  picnic: [25, 40],
  night: [24, 35],
  kitchen: [28, 45],
  botanical: [18, 80],
  popart: [18, 24],
}
const NAMES = {
  f: [
    'Hannah',
    'Priya',
    'Lucy',
    'Carla',
    'Niamh',
    'Yara',
    'Rosa',
    'Jess',
    'Ines',
    'Emma',
    'Chloe',
    'Aiko',
    'Grace',
    'Maya',
    'Lina',
    'Zoe',
    'Amara',
    'Lola',
    'Sofia',
    'Mei',
    'Ada',
    'Isla',
    'Nora',
    'Leila',
    'Tess',
    'Bea',
    'Kira',
    'Alma',
    'June',
    'Ruby',
  ],
  m: [
    'Dev',
    'Sam',
    'Kwame',
    'Mateo',
    'Ben',
    'Joe',
    'Tariq',
    'Kai',
    'Ravi',
    'Marcus',
    'Owen',
    'Felix',
    'Hugo',
    'Theo',
    'Jay',
    'Finn',
    'Rio',
    'Arjun',
    'Leo',
    'Omar',
    'Tom',
    'Luca',
  ],
  pair: ['Rita and Joe', 'Ann and Malik', 'Vera and Sol', 'Edith and Ray', 'Mona and Gus'],
}
const PLACES = [
  'Leeds',
  'Austin',
  'Lisbon',
  'Bristol',
  'Dublin',
  'Toronto',
  'Brighton',
  'Melbourne',
  'Manchester',
  'Portland',
  'Sydney',
  'Cardiff',
  'London',
  'Chicago',
  'Glasgow',
  'Auckland',
  'Madrid',
  'Seattle',
  'York',
  'Adelaide',
  'Boston',
  'Vancouver',
  'Edinburgh',
  'Berlin',
  'Denver',
  'Oxford',
  'Perth',
  'Brisbane',
]
// what each person is like; never says he or she
const LINES = {
  swap: [
    'Swapped the 4 pm cola for fizzy water and misses it.',
    'Checks the sugar on everything since the last check-up.',
    'Gave up sugar in coffee, not the fizz.',
    'Reads the nutrition panel twice.',
    'Wants a can that doesn’t undo the run.',
    'Keeps a fridge shelf for later.',
  ],
  picnic: [
    'Has the picnic blanket in the car from May.',
    'Plans every weekend by Wednesday.',
    'Hosts the long lunch in the garden.',
    'Brings the drinks, never the food.',
    'Knows the best park for shade.',
    'Packs the cool box like a puzzle.',
  ],
  night: [
    'Doing a dry month and still going out.',
    'Is the designated driver most Fridays.',
    'Wants something good to hold at the bar.',
    'Leaves the party early to run on Saturdays.',
    'Cut back on drinking after the new job.',
    'Orders last at the bar and hates the choices.',
  ],
  kitchen: [
    'Gets asked for something fizzy every afternoon.',
    'Packs lunchboxes before eight.',
    'Says no to sweets more than to anything else.',
    'Keeps treats for Fridays.',
    'Reads the back of every kids’ drink.',
    'Wants a yes that’s easy to give.',
  ],
  botanical: [
    'Looks up any ingredient that sounds made up.',
    'Shops the farmers’ market on Saturdays.',
    'Grows mint on the windowsill.',
    'Turns the can round before buying.',
    'Avoids anything with sweeteners.',
    'Cooks from scratch most nights.',
  ],
  popart: [
    'Picks the drink that looks good on camera.',
    'Tries every new flavour once.',
    'Has a colour for every season.',
    'Shares the shelf, not the ad.',
    'Follows three snack accounts.',
    'Buys the limited one first.',
  ],
}
const PAIR_LINES = {
  botanical: 'Read every label together at the market.',
  picnic: 'Take the long lunch outside every Sunday.',
}
const RID = ROUTES.map((r) => r.id)
const persona = (base, r) => {
  const L = LOOK[base] || LOOK['p-walk-a']
  const ok = L.routes.filter((id) => AGES[id][0] <= L.age[1] && AGES[id][1] >= L.age[0])
  const id = ok[Math.floor(r() * ok.length)] || L.routes[0]
  const lo = Math.max(L.age[0], AGES[id][0]),
    hi = Math.min(L.age[1], AGES[id][1])
  const names = NAMES[L.g]
  return {
    route: Math.max(0, RID.indexOf(id)),
    g: L.g,
    base,
    name: names[Math.floor(r() * names.length)],
    pair: L.g === 'pair',
    age: lo + Math.floor(r() * (hi - lo + 1)),
    place: PLACES[Math.floor(r() * PLACES.length)],
    line: L.g === 'pair' ? PAIR_LINES[id] || LINES[id][0] : LINES[id][Math.floor(r() * 6)],
  }
}
// ---- hover faces: DiceBear Notionists, picked to match the painted figure (hair, beard, glasses, gesture)
const V = (...n) => n.map((i) => `variant${String(i).padStart(2, '0')}`)
const HAIR = {
  f: V(2, 4, 8, 10, 23, 28, 36, 37, 39, 41, 45, 46, 47, 58),
  m: V(
    1,
    5,
    6,
    7,
    9,
    12,
    13,
    15,
    16,
    17,
    18,
    19,
    20,
    21,
    22,
    24,
    25,
    27,
    31,
    33,
    34,
    35,
    38,
    40,
    44,
    49,
    52,
    53,
    54,
    55,
    56,
  ),
  young: { f: V(45, 46, 47, 48, 59, 10), m: V(50, 51, 52, 53, 3, 26, 32) },
  old: { f: V(30, 48, 57, 36), m: V(42, 60, 5, 13) },
}
const GESTURE = {
  'p-phone-walk': 'handPhone',
  'p-talk-phone': 'handPhone',
  'p-talk-waving': 'waveLongArm',
  'p-talk-pointing': 'point',
}
const BG = ['dcebf5', 'efe2cf', 'e5ead6', 'f6dfdc', 'f3e7c6']
let makeFace = null,
  facesLoading = null
const loadFaces = (done) =>
  facesLoading ||
  (facesLoading = Promise.all([import('@dicebear/core'), import('@dicebear/notionists')])
    .then(([core, style]) => {
      makeFace = (o) =>
        core
          .createAvatar(style, {
            size: 96,
            backgroundColor: BG,
            backgroundType: ['solid'],
            bodyIconProbability: 0,
            ...o,
          })
          .toDataUri()
      done && done()
    })
    .catch(() => {}))
const faceOpts = (g, age, base, seed) => {
  const band = age < 24 ? 'young' : age >= 60 ? 'old' : null
  const hair = band ? HAIR[band][g] : HAIR[g]
  const o = {
    seed,
    hair,
    beardProbability: g === 'm' ? (age >= 60 ? 70 : age < 22 ? 0 : 35) : 0,
    glassesProbability: age >= 60 ? 85 : 20,
    gestureProbability: 0,
  }
  if (GESTURE[base]) Object.assign(o, { gesture: [GESTURE[base]], gestureProbability: 100 })
  return o
}
// one face, or two for a couple; cached per person
const faceHTML = (c) => {
  if (!makeFace) return '<span class="tip__face"></span>'
  if (!c._face) {
    const key = `${c.name}-${c.age}-${c.place}`
    c._face = c.pair
      ? [makeFace(faceOpts('f', c.age, '', key + 'a')), makeFace(faceOpts('m', c.age, '', key + 'b'))]
      : [makeFace(faceOpts(c.g, c.age, c.base, key))]
  }
  return `<span class="tip__faces${c.pair ? ' is-pair' : ''}">${c._face.map((f) => `<img src="${f}" alt="" width="56" height="56">`).join('')}</span>`
}
const baseOf = (name) => name.replace(/-(se|sw)$/, '')
const WHO = [
  'p-walk-a',
  'p-walk-b',
  'p-tote',
  'p-coffee',
  'p-dog-walker',
  'p-headphones',
  'p-couple',
  'p-parent-child',
  'p-shopping',
  'p-phone-walk',
  'p-suit',
  'p-buggy',
  'p-dog',
  'p-talk-phone',
  'p-talk-pointing',
  'p-talk-waving',
  'p-cafe',
]
const sideName = (base, r) => (FREE[`${base}-se`] ? `${base}-${r() < 0.5 ? 'se' : 'sw'}` : base)

const SIZE_NAME = { 1: 'Feed, square', 0.8: 'Feed, portrait', 0.5625: 'Stories and Reels', 1.91: 'Landscape' }
const rng = (seed) => () => {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

// the blocks the camera sees: rows x + y = 6 (behind the hills) to 12, at most three blocks either side of the middle
const SEEN = (bi, bj) =>
  bi + bj >= 6 && bi + bj <= 12 && Math.abs(bi - bj) <= 3 && bi >= 0 && bj >= 0 && bi < 8 && bj < 8

function layout({ sprite, paint, flat, free, cellTree, figure, el, things, plan, thing, pick, CORNERS, MIDS, BIG }) {
  const boards = [],
    standers = []
  const r = rng(9091)
  const board = (host, name, route, size, tour = -1) => {
    const face = paint(host, name, null, size, `c${boards.length}`, `<div class="t-face">${PLAIN.html()}</div>`)
    const b = { face, inner: face.firstChild, route, size, tour, name, flipped: false }
    boards.push(b)
    return b
  }
  const at = (bi, bj) => [bi * P + 2, bj * P + 2]
  const stand = (x, y, base = pick(r, WHO), front = false) => {
    const name = sideName(base, r)
    standers.push(figure(x * CELL, y * CELL, name, false, { who: name, front }, 1.25))
  }
  const back3 = (i, j) => {
    sprite(pick(r, BIG), i, j)
    sprite(pick(r, MIDS), i + 3, j)
    sprite(pick(r, MIDS), i + 5, j)
  }

  // (4,4) the square in the middle, where the Dazbee chip lands: the roadside board (1.91:1), a fountain, a food truck
  {
    const [i, j] = at(4, 4)
    flat('t-plaza', i, j, 7, 7)
    board(sprite('s-billboard-wide', i, j + 1), 's-billboard-wide', 2, 1.91, 3)
    sprite('n-fountain', i + 2.6, j + 0.4)
    sprite('s-food-truck', i + 5.6, j + 0.2)
    sprite('s-kiosk', i + 2.4, j + 5.6)
    sprite('b-corner-cafe', i + 5, j + 5)
    ;[
      [1.6, 5.6],
      [3.8, 3.8],
      [4.6, 5],
      [3.4, 6.6],
    ].forEach(([a, b]) => free('n-umbrella-table', (i + a) * CELL, (j + b) * CELL))
    ;[
      [1.9, 4.6],
      [2.6, 3.4],
      [4.4, 2.6],
      [5.2, 3.6],
      [3.3, 4.6],
      [1.4, 6.6],
      [4.8, 6.6],
      [5.8, 2.6],
    ].forEach(([a, b]) => stand(i + a, j + b, undefined, true))
  }
  // (3,4) the office tower's wrap (9:16) on the street, the shop row's roof board (1:1), a media corner on the corner
  {
    const [i, j] = at(3, 4)
    back3(i, j)
    board(sprite('b-office-tower', i, j + 4), 'b-office-tower', 4, 0.5625, 2)
    board(sprite('b-shop-row', i + 3, j + 4), 'b-shop-row', 1, 1, 1)
    board(sprite('b-media-corner', i + 5, j + 5), 'b-media-corner', 0, 'fill')
    thing(r, i + 5.5, j + 4.4)
    thing(r, i + 3.4, j + 3.5)
  }
  // (4,3) the bus shelter (4:5)
  {
    const [i, j] = at(4, 3)
    back3(i, j)
    sprite(pick(r, MIDS), i, j + 4)
    board(sprite('s-bus-shelter', i + 3, j + 5), 's-bus-shelter', 0, 0.8, 0)
    sprite(pick(r, CORNERS), i + 5, j + 5)
    thing(r, i + 2.5, j + 6.4)
    thing(r, i + 5.6, j + 4.4)
  }
  // (3,5) a whole blank wall: a building wrap
  {
    const [i, j] = at(3, 5)
    back3(i, j)
    board(sprite('b-flats-wall', i, j + 4), 'b-flats-wall', 3, 'fill', 4)
    sprite(pick(r, MIDS), i + 2, j + 4)
    sprite('b-pharmacy', i + 5, j + 5)
    thing(r, i + 4.5, j + 5)
    thing(r, i + 4.5, j + 6.5)
  }
  // (5,3) a digital street screen
  {
    const [i, j] = at(5, 3)
    back3(i, j)
    sprite(pick(r, MIDS), i, j + 4)
    sprite(pick(r, MIDS), i + 2, j + 4)
    board(sprite('s-digital-stop', i + 6, j + 3), 's-digital-stop', 1, 'fill', 5) // its screen faces the street on the right
    sprite('b-diner', i + 5, j + 5)
  }
  // (2,4) the skate park with a tall poster
  {
    const [i, j] = at(2, 4)
    flat('t-plaza', i, j, 7, 7)
    sprite('l-skate-park', i, j)
    sprite(pick(r, MIDS), i + 5, j)
    board(free('s-board-tall', (i + 4.5) * CELL, (j + 4.6) * CELL), 's-board-tall', 5, 0.8)
    sprite('b-house-c', i, j + 5)
    sprite('b-house-a', i + 2, j + 5)
    sprite('b-salon', i + 5, j + 5)
    ;[
      [1, 1.4],
      [2.4, 2.6],
      [3.2, 1.2],
    ].forEach(([a, b]) => stand(i + a, j + b, 'p-headphones'))
  }
  // (4,2) the glasshouse garden with an advertising column
  {
    const [i, j] = at(4, 2)
    flat('t-park', i, j, 7, 7)
    sprite('l-greenhouse', i, j)
    sprite(pick(r, MIDS), i + 5, j)
    board(free('s-column', (i + 4.5) * CELL, (j + 4.5) * CELL), 's-column', 4, 'fill')
    sprite('b-house-d', i, j + 5)
    sprite('b-house-b', i + 2, j + 5)
    sprite('b-corner-cafe', i + 5, j + 5)
  }
  // (4,5) the park with the Ferris wheel
  let wheel = null
  {
    const [i, j] = at(4, 5)
    flat('t-park', i, j, 7, 7)
    flat('t-pave', i - 0.2, j + 5, 7.4, 1)
    flat('t-pave', i + 5, j - 0.2, 1, 7.4)
    flat('t-plaza', i + 1.5, j + 0.5, 3, 4)
    const base = sprite('l-wheel-base', i + 2, j + 1)
    wheel = { base, ...SPRITES['l-wheel-base'] }
    sprite('s-kiosk', i + 6, j + 6)
    sprite('n-flowerbed', i + 0.4, j + 0.4)
    sprite('n-flowerbed', i + 6, j + 0.4)
    free('n-bench', (i + 1) * CELL, (j + 5.9) * CELL, 1, true)
    free('n-bench', (i + 3.4) * CELL, (j + 5.9) * CELL, 1, true)
    ;[
      [0.6, 3],
      [0.8, 6.6],
      [6.6, 3.4],
      [4.6, 0.8],
      [3.8, 6.8],
    ].forEach(([a, b]) => cellTree(i + a, j + b, 0.85))
    ;[
      [1.2, 4.6],
      [4.2, 4.4],
      [2.2, 5.6],
      [5.6, 5.6],
      [5.6, 2.2],
      [4.6, 2.6],
      [1.6, 2.2],
    ].forEach(([a, b]) => stand(i + a, j + b, undefined, true))
  }
  // (5,4) the cinema, with the metro on its corner
  {
    const [i, j] = at(5, 4)
    flat('t-plaza', i, j, 7, 7)
    sprite('l-cinema', i, j)
    sprite(pick(r, MIDS), i + 3, j)
    sprite(pick(r, MIDS), i + 5, j)
    sprite(pick(r, MIDS), i, j + 4)
    sprite(pick(r, MIDS), i + 2, j + 4)
    sprite('l-metro', i + 5, j + 5)
    stand(i + 4.5, j + 4.2)
    stand(i + 4.4, j + 6.4)
  }

  // the mountains and hills behind the city, in screen px, behind everything
  const ridge = el('t-ridge')
  ;[
    ['a', -2350, 1.7],
    ['b', -1250, 1.9],
    ['a', 0, 2.1],
    ['b', 1250, 1.8],
    ['a', 2350, 1.7],
    ['b', -1800, 1.4],
    ['a', 1800, 1.5],
  ].forEach(([v, X, k], n) => {
    const m = SPRITES[`e-mountains-${v}`],
      img = document.createElement('img')
    img.src = m.src
    img.alt = ''
    img.className = 't-ridge__m'
    const w = (m.w / 2) * k,
      h = (m.h / 2) * k
    Object.assign(img.style, {
      left: `${X - w / 2}px`,
      top: `${(BACK * CELL) / 2 + 50 - h}px`,
      width: `${w}px`,
      zIndex: n > 4 ? 2 : 1,
    })
    if (n % 2) img.style.transform = 'scaleX(-1)'
    ridge.appendChild(img)
  })
  ;[-1700, -560, 620, 1750].forEach((X, n) => {
    const m = SPRITES['e-hill-trees'],
      img = document.createElement('img')
    img.src = m.src
    img.alt = ''
    img.className = 't-ridge__m'
    const w = (m.w / 2) * 1.3,
      h = (m.h / 2) * 1.3
    Object.assign(img.style, {
      left: `${X - w / 2}px`,
      top: `${(BACK * CELL) / 2 + 95 - h}px`,
      width: `${w}px`,
      zIndex: 3,
    })
    if (n % 2) img.style.transform = 'scaleX(-1)'
    ridge.appendChild(img)
  })
  things.appendChild(ridge)

  // people standing about on every pavement the camera sees, like a picture book (the walkers come on top)
  for (let k = 20; k <= 70; k += P) {
    for (const axis of ['x', 'y']) {
      for (let s = 15; s < 75; s += 0.5 + r() * 2.2) {
        if (s % P < 2.4 || s % P > 8.8) continue // not on the crossings
        const side = r() < 0.5 ? -0.5 : 1.5,
          x = axis === 'x' ? s : k + side,
          y = axis === 'x' ? k + side : s
        const bi = Math.floor(x / P),
          bj = Math.floor(y / P)
        if (!SEEN(bi, bj) || x + y < BACK + 4 || r() < 0.55) continue
        stand(x + (r() - 0.5) * 0.3, y + (r() - 0.5) * 0.3, pick(r, WHO), side < 0)
      }
    }
  }

  // traffic lights at the middle junctions; the little lamps follow the light phase (see life)
  for (const kx of [30, 40, 50])
    for (const ky of [30, 40, 50]) {
      if (kx + ky < 70 || kx + ky > 90) continue
      ;[
        ['x', kx - 0.25, ky - 0.3],
        ['y', kx + 1.25, ky + 1.3],
      ].forEach(([a, x, y]) => {
        const n = free('s-traffic-light', x * CELL, y * CELL)
        n.classList.add('t-light')
        n.dataset.a = a
        n.insertAdjacentHTML('beforeend', '<i class="t-light__r"></i><i class="t-light__g"></i>')
      })
    }
  // where the chip lands: a point the camera maths can find on screen
  const mark = el('t-mark')
  mark.style.left = '0px'
  mark.style.top = `${HIT}px`
  things.appendChild(mark)
  void plan
  return { boards, standers, wheel, mark }
}

export function city(section, { still = false } = {}) {
  if (!section) return null
  const pin = section.querySelector('.city__pin')
  const stage = section.querySelector('.city__stage')
  const camera = section.querySelector('[data-camera]')
  const world = section.querySelector('[data-world]')
  const beats = [...section.querySelectorAll('[data-beat]')]
  const pills = section.querySelector('[data-pills]')
  const sizeEl = section.querySelector('[data-size-now]')
  const clouds = [...section.querySelectorAll('.city__cloud')]
  const lead = section.querySelector('[data-lead]')
  const leadH = lead.querySelector('h2')
  const lines = [...lead.querySelectorAll('[data-ln]')]
  const leadP = lead.querySelector('p')
  const veilFull = section.querySelector('.city__veil--full')
  const veilSide = section.querySelector('.city__veil--side')
  const drop = section.querySelector('[data-drop]')
  const ripple = section.querySelector('[data-ripple]')
  const dropNote = section.querySelector('[data-drop-note]')

  // every block the camera sees is built, densely; the city lays out its special blocks itself
  const OWN = ['4,4', '3,4', '4,3', '3,5', '5,3', '2,4', '4,2', '4,5', '5,4']
  const walk = []
  for (let bi = 0; bi < 8; bi++) for (let bj = 0; bj < 8; bj++) if (SEEN(bi, bj) && bi + bj >= 7) walk.push([bi, bj])
  const parts = build(world, {
    layout,
    own: new Set(OWN),
    land: SEEN,
    back: BACK,
    walk,
    crowd: 110,
    pk: 1.25,
    roads: [20, 30, 40, 50, 60, 70],
    plans: (r, bi, bj) => {
      const v = r()
      return v < 0.14 ? 'park' : v < 0.34 ? 'houses' : 'dense'
    },
    cars: [
      'v-hatchback-red',
      'v-taxi',
      'v-bus-ad',
      'v-hatchback-cream',
      'v-van',
      'v-taxi',
      'v-hatchback-red',
      'v-bus-ad',
      'v-hatchback-cream',
    ],
  })
  const { boards, standers, wheel, mark } = parts.extra

  // the buses carry boards too
  let bus = 0
  parts.movers.forEach((c) => {
    if (!c.m._name?.startsWith('v-bus-ad')) return
    const face = paintOn(c.m._img, c.m._name, `<div class="t-face">${PLAIN.html()}</div>`)
    boards.push({
      face,
      inner: face.firstChild,
      route: [2, 5, 0, 3][bus++ % 4],
      size: 'fill',
      tour: -1,
      flipped: false,
    })
  })

  // the grey wash: one layer over the whole city that takes the colour out (mix-blend saturation). Its hole grows
  // from where the chip lands. Only the few people the plain ad reaches are lifted above it, and only until the
  // colour reaches them (so nobody is drawn over a building for long)
  const wash = document.createElement('div')
  wash.className = 't-wash'
  const WX = -3000,
    WY = 2560 - 2200,
    WW = 6000,
    WH = 5200
  Object.assign(wash.style, { left: `${WX}px`, top: `${WY}px`, width: `${WW}px`, height: `${WH}px` })
  world.appendChild(wash)
  const setWave = (r) => {
    const g =
      r <= 0 ? 'none' : `radial-gradient(circle at ${-WX}px ${HIT - WY}px, transparent ${r}px, #000 ${r + 380}px)`
    wash.style.maskImage = g
    wash.style.webkitMaskImage = g
    wash.style.opacity = r > 3400 ? 0 : 1
  }

  const skyback = document.createElement('div')
  skyback.className = 't-skyback'
  Object.assign(skyback.style, {
    left: '-6000px',
    width: '12000px',
    top: '-3000px',
    height: `${3000 + (BACK * CELL) / 2 - 60}px`,
  })
  world.insertBefore(skyback, parts.things)

  // ---- people: each one's card matches the figure; the route follows from who they are
  const rr = rng(1234)
  const crowd = [
    ...standers.map((s) => ({ m: s.m, head: s.head, who: s.who, front: s.front })),
    ...parts.people.map((p) => ({ m: p.m, head: p.img, who: `${p.who}-se`, walker: true })),
  ]
  crowd.forEach((c, n) => {
    Object.assign(c, persona(baseOf(c.who), rr))
    c.on = rr() < 0.74 // most people fit one of the six routes
    c.few = false // chosen once the camera maths can see them (pickFew)
    c.src = FREE[c.who]?.src || FREE[`${baseOf(c.who)}-se`]?.src
    const ring = document.createElement('i')
    ring.className = 't-ring'
    ring.style.setProperty('--acc', ROUTES[c.route].acc)
    c.m.insertBefore(ring, c.m.firstChild)
    c.ring = ring
    c.m.classList.add('t-who')
  })
  const lift = (c, on) => {
    if (!!c.m._hi === on) return
    c.m._hi = on
    const z = parseInt(c.m.style.zIndex, 10) || 0
    c.m.style.zIndex = on ? z + 60000 : z - 60000
  }

  const tl = life(parts, { lights: true })

  // ---- the Ferris wheel: a ring that turns in the plane of its frame, gondolas that hang straight
  const W = makeWheel(world, wheel)

  // ---- the camera
  let shots = {}
  const measure = () => {
    const prev = camera.style.transform
    camera.style.transform = 'none'
    const sr = stage.getBoundingClientRect()
    const cx = sr.left + sr.width / 2,
      cy = sr.top + sr.height / 2,
      Wd = sr.width,
      H = sr.height
    const s0 = Math.max(Wd / 2 / 1650, H / 2 / 1000)
    shots.W = Wd
    shots.H = H
    shots.wide = { x: Wd * 0.06, y: -(HIT + 10 - 2560) * s0, scale: s0 }
    shots.near = { x: Wd * 0.12, y: -(HIT + 60 - 2560) * s0 * 1.35, scale: s0 * 1.35 }
    shots.top = { x: 0, y: 1150 * s0 * 0.9, scale: s0 * 0.9 }
    shots.hop = { x: Wd * 0.06, y: -(HIT - 200 - 2560) * s0 * 0.92, scale: s0 * 0.92 } // pulled back over the city between boards
    shots.tour = boards
      .filter((b) => b.tour >= 0)
      .sort((a, b) => a.tour - b.tour)
      .map((b) => {
        const r = b.face.getBoundingClientRect()
        const dx = r.left + r.width / 2 - cx,
          dy = r.top + r.height / 2 - cy
        const S = Math.min(5.2, (H * 0.6) / r.height, (Wd * 0.4) / r.width) // close enough to read the banner
        return { x: Wd * 0.2 - S * dx, y: H * 0.04 - S * dy, scale: S, b }
      })
    camera.style.transform = prev
  }
  measure()
  const shot = (k, i) => () => (i === undefined ? shots[k] : shots.tour[i])
  const to = (k, i) => ({ x: () => shot(k, i)().x, y: () => shot(k, i)().y, scale: () => shot(k, i)().scale })
  // where the chip waits: under the copy on the left, in pin px
  const dropHome = () => {
    const pr = pin.getBoundingClientRect(),
      c = section.querySelector('[data-beat="drop"] p').getBoundingClientRect()
    return { x: c.left - pr.left + drop.offsetWidth / 2, y: c.bottom - pr.top + 14 + 50 }
  }
  // where the chip lands, in pin px, in the near shot
  const hitAt = () => ({
    x: shots.W / 2 + shots.near.x,
    y: shots.H / 2 + shots.near.y + (HIT - 2560) * shots.near.scale,
  })

  // ---- the headline: centred at first, then docked on the left (measured with no transforms)
  let L = null
  const measureLead = () => {
    const keep = [lead.style.transform, ...lines.map((l) => l.style.transform)]
    lead.style.transform = 'none'
    lines.forEach((l) => {
      l.style.transform = 'none'
    })
    const pr = pin.getBoundingClientRect(),
      b = leadH.getBoundingClientRect()
    const ws = lines.map((l) => l.getBoundingClientRect().width),
      B = Math.max(...ws)
    const s = Math.min(1.5, (pr.width * 0.82) / B)
    L = {
      s,
      dx: pr.width / 2 - (b.left - pr.left) - (B * s) / 2,
      dy: pr.height * 0.44 - (b.top - pr.top) - (b.height * s) / 2,
      ox: ws.map((w) => (B - w) / 2),
    }
    lead.style.transform = keep[0]
    lines.forEach((l, i) => {
      l.style.transform = keep[i + 1]
    })
  }
  measureLead()

  // ---- the colour wave
  const wave = { r: 0 }
  const R_END = 3600
  const flip = (b, on) => {
    if (b.flipped === on) return
    b.flipped = on
    gsap
      .timeline()
      .to(b.inner, {
        scaleX: 0,
        duration: 0.18,
        ease: 'power2.in',
        onComplete: () => {
          b.inner.innerHTML = on ? ROUTES[b.route].html('fill') : PLAIN.html()
        },
      })
      .to(b.inner, { scaleX: 1, duration: 0.26, ease: 'power2.out' })
  }
  let dists = null
  const measureDists = () => {
    const prev = camera.style.transform
    camera.style.transform = 'none'
    const wr = world.getBoundingClientRect()
    const d = (n) => {
      const r = n.getBoundingClientRect()
      return Math.hypot(r.left + r.width / 2 - wr.left, r.top + r.height / 2 - wr.top - HIT)
    }
    dists = { boards: boards.map((b) => d(b.face)), crowd: crowd.map((c) => d(c.head)) }
    camera.style.transform = prev
    if (!picked) pickFew()
  }
  // the few the one plain ad was made for: people standing in front of the buildings, spread round the near shot
  let picked = false
  const pickFew = () => {
    picked = true
    const near = crowd
      .map((c, i) => [c, dists.crowd[i]])
      .filter(([c, d]) => !c.walker && c.front && d > 120 && d < 1300)
    near
      .filter((_, k) => k % 3 === 1)
      .slice(0, 9)
      .forEach(([c]) => {
        c.few = true
        c.on = true
      })
  }
  let lastR = -1
  const applyWave = () => {
    const r = wave.r
    if (Math.abs(r - lastR) < 1) return
    lastR = r
    setWave(r)
    if (!dists) measureDists()
    boards.forEach((b, i) => flip(b, r > dists.boards[i] - 120))
    crowd.forEach((c, i) => {
      const reached = r > dists.crowd[i]
      const lit = c.few || (c.on && reached)
      lift(c, c.few && !reached)
      if (lit !== c.lit) {
        c.lit = lit
        c.ring.classList.toggle('is-on', lit)
      }
      c.ring.classList.toggle('is-plain', c.few && !reached)
    })
  }

  // the six ads themselves, each with who it is for: they arrive one by one as the colour spreads
  pills.innerHTML = ROUTES.map(
    (r) =>
      `<li style="--acc:${r.acc}">${banner(r, '45')}<span>For ${r.who.charAt(0).toLowerCase() + r.who.slice(1)}</span></li>`,
  ).join('')
  const adCards = [...pills.children]
  const setBeat = (k) =>
    beats.forEach((b) => {
      const on = b.dataset.beat === String(k)
      b.classList.toggle('is-on', on)
      b.setAttribute('aria-hidden', String(!on))
    })
  const setSize = (i) => {
    if (i < 0) {
      sizeEl.classList.remove('is-on')
      return
    }
    const t = shots.tour[i]
    if (!t) return
    const b = t.b,
      r = ROUTES[b.route]
    const ar = typeof b.size === 'number' ? b.size : b.face.offsetWidth / b.face.offsetHeight
    const label =
      SIZE_NAME[b.size] ||
      {
        's-board-tall': 'Street poster',
        'b-flats-wall': 'Building wrap',
        's-digital-stop': 'Digital street screen',
        's-column': 'Street column',
      }[b.name] ||
      'Any size'
    sizeEl.innerHTML = `<b>${ratio(ar)}</b><span>${label}</span><em style="--acc:${r.acc}">${r.name}</em>`
    sizeEl.classList.add('is-on')
  }

  // ---- hover: anyone in colour shows who they are, with their own picture
  const tip = document.createElement('div')
  tip.className = 'orbit__tip city__tip'
  tip.setAttribute('aria-hidden', 'true')
  stage.appendChild(tip)
  let hover = null
  const showTip = (c) => {
    const r = ROUTES[c.route],
      plain = c.ring.classList.contains('is-plain')
    tip.style.setProperty('--acc', plain ? '#b9a27a' : r.acc)
    tip.innerHTML = `<div class="tip__top">${faceHTML(c)}<div><b>${c.name}${c.pair ? '' : `, ${c.age}`}</b><span>${c.pair ? `Both in their ${Math.floor(c.age / 10) * 10}s · ` : ''}${c.place}</span></div></div>
      <p>${c.line}</p><div class="tip__foot"><span>${plain ? 'Reached by' : 'Route'}</span><b>${plain ? 'The one plain ad' : `${r.name} · ${r.who}`}</b></div>`
    const pr = stage.getBoundingClientRect(),
      h = c.head.getBoundingClientRect()
    const half = tip.offsetWidth / 2 + 8,
      x = Math.min(pr.width - half, Math.max(half, h.left + h.width / 2 - pr.left))
    const above = h.top - pr.top > tip.offsetHeight + 90
    tip.classList.toggle('is-below', !above)
    tip.style.transform = above
      ? `translate(${x.toFixed(0)}px, ${(h.top - pr.top - 8).toFixed(0)}px) translate(-50%, -100%)`
      : `translate(${x.toFixed(0)}px, ${(h.bottom - pr.top + 10).toFixed(0)}px) translate(-50%, 0)`
  }
  const setHover = (c) => {
    loadFaces(() => hover && showTip(hover))
    if (c === hover) return
    hover = c
    tip.classList.toggle('is-on', !!c)
    if (c) showTip(c)
  }
  crowd.forEach((c) => {
    c.m.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && c.lit) setHover(c)
    })
    c.m.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && hover === c) setHover(null)
    })
    c.m.addEventListener('click', (e) => {
      if (!c.lit) return
      e.stopPropagation()
      setHover(hover === c ? null : c)
    })
  })
  stage.addEventListener('click', () => setHover(null))
  stage.addEventListener('pointerenter', () => loadFaces(), { once: true })

  setTimeout(() => loadFaces(), 1500)
  applyWave() // the few the plain ad reaches are in colour from the start

  const ro = new ResizeObserver(() => {
    measure()
    measureLead()
    dists = null
    lastR = -1
    applyWave()
  })
  ro.observe(stage)

  if (still) {
    wave.r = R_END
    applyWave()
    boards.forEach((b) => {
      b.inner.innerHTML = ROUTES[b.route].html('fill')
    })
    gsap.set(camera, shots.wide)
    setBeat(4)
    clouds.forEach((c) => (c.style.opacity = 0))
    gsap.set(lead, { autoAlpha: 0 })
    gsap.set(veilFull, { opacity: 0 })
    gsap.set(veilSide, { opacity: 1 })
    return {
      kill() {
        ro.disconnect()
      },
    }
  }

  // ---- the pinned scroll: one timeline, scrubbed
  const cam = gsap.timeline({ defaults: { ease: 'power2.inOut' } })
  gsap.set(camera, to('top'))
  gsap.set(lead, { x: () => L.dx, y: () => L.dy, scale: () => L.s })
  lines.forEach((l, i) => gsap.set(l, { x: () => L.ox[i] }))
  gsap.set(lines.slice(1), { autoAlpha: 0, yPercent: 40 })
  gsap.set(leadP, { autoAlpha: 0 })
  gsap.set(veilSide, { opacity: 0 })
  gsap.set(drop, { autoAlpha: 0 })
  gsap.set(ripple, { autoAlpha: 0 })

  cam
    // 1 in through the clouds, "Meta wants more concepts." in the middle
    .fromTo(camera, to('top'), { ...to('wide'), duration: 1.4, immediateRender: false }, 0)
    .to(
      clouds,
      {
        yPercent: (i) => (i % 2 ? -60 : -40),
        xPercent: (i) => (i % 2 ? 40 : -40),
        opacity: 0,
        duration: 1.2,
        ease: 'power1.in',
        stagger: 0.05,
      },
      0,
    )
    // the second sentence arrives
    .to(lines.slice(1), { autoAlpha: 1, yPercent: 0, duration: 0.6, stagger: 0.15, ease: 'power2.out' }, 1.3)
    // both dock on the left, on a paper margin; the city comes closer
    .to(lead, { x: 0, y: 0, scale: 1, duration: 0.9 }, 2.3)
    .to(lines, { x: 0, duration: 0.9 }, 2.3)
    .to(veilFull, { opacity: 0, duration: 0.9 }, 2.3)
    .to(veilSide, { opacity: 1, duration: 0.9 }, 2.3)
    .to(camera, { ...to('near'), duration: 1.2 }, 2.3)
    .to(leadP, { autoAlpha: 1, duration: 0.4 }, 3.0)
    // 2 the brief goes into Dazbee: the chip appears, flies to the middle of the city and lands
    .to(lead, { autoAlpha: 0, duration: 0.3 }, 3.6)
    .fromTo(
      drop,
      { autoAlpha: 0, x: () => dropHome().x, y: () => dropHome().y, scale: 0.9 },
      { autoAlpha: 1, scale: 1, duration: 0.4, immediateRender: false },
      4.2,
    )
    .to(drop, { x: () => hitAt().x, y: () => hitAt().y, duration: 0.9, ease: 'power2.in' }, 4.7)
    .to(drop, { scale: 0.4, autoAlpha: 0, duration: 0.25, ease: 'power1.in' }, 5.6)
    .fromTo(
      ripple,
      { autoAlpha: 1, x: () => hitAt().x, y: () => hitAt().y, scale: 0.2 },
      { scale: 9, autoAlpha: 0, duration: 1.1, ease: 'power2.out', immediateRender: false },
      5.6,
    )
    .to(wave, { r: R_END, duration: 2.4, ease: 'power1.in', onUpdate: applyWave }, 5.6)
    .fromTo(
      adCards,
      { autoAlpha: 0, y: 18, scale: 0.92 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, stagger: 0.28, ease: 'back.out(1.6)', immediateRender: true },
      5.9,
    )
    .to(camera, { ...to('wide'), duration: 2.4 }, 5.7)
    .to({}, { duration: 0.6 })
  const tourAt = []
  // like a character switch in a game: in on a board, back up over the city, down onto the next one
  shots.tour.forEach((_, i) => {
    if (i) cam.to(camera, { ...to('hop'), duration: 0.6, ease: 'power3.in' }).to({}, { duration: 0.12 })
    const d = i ? 0.8 : 1.2
    tourAt.push(cam.duration() + d - 0.12) // the label shows once the camera is there
    cam.to(camera, { ...to('tour', i), duration: d, ease: i ? 'power3.out' : 'power2.inOut' }).to({}, { duration: 0.8 })
  })
  const wideAt = cam.duration()
  // 4 the whole city
  cam.to(camera, { ...to('wide'), duration: 1.3, ease: 'power3.inOut' }).to({}, { duration: 1 })
  const outAt = cam.duration()
  // out: not back up through the clouds (that's the way in) but on down the street, past the front of the city, into the page
  cam
    .to(
      camera,
      {
        x: () => shots.wide.x,
        y: () => shots.wide.y - shots.H * 0.42,
        scale: () => shots.wide.scale * 1.08,
        duration: 1.6,
        ease: 'power1.in',
      },
      outAt,
    )
    .to(veilSide, { opacity: 0, duration: 0.6 }, outAt)
  const T = { drop: 4.1, wave: 5.9, sizes: tourAt[0] - 1.3, wide: wideAt + 0.3, out: outAt }

  // ---- the trigger: the scroll waits on "Run the brief" until the visitor presses it
  const GATE = 4.7,
    AFTER = 8.2
  let ran = false
  const yAt = (t) => st.start + (t / cam.duration()) * (st.end - st.start)
  const holding = () => !ran && window.scrollY >= yAt(GATE) - 2 && window.scrollY < st.end - 2
  function gate(self, t) {
    if (ran || !st) return
    drop.classList.toggle('is-waiting', t >= GATE - 0.25 && t < AFTER)
    if (self.scroll() > st.end - 2) {
      ran = true
      run(false)
      return
    } // jumped past (a nav link): just let it be done
    if (t > GATE + 0.02) self.scroll(Math.round(yAt(GATE)))
  }
  function run(scroll = true) {
    ran = true
    drop.disabled = true
    drop.classList.remove('is-waiting')
    drop.classList.add('is-ran')
    dropNote.textContent = 'Making 6 routes'
    if (scroll) gsap.to(window, { scrollTo: { y: yAt(AFTER), autoKill: false }, duration: 3.2, ease: 'power1.inOut' })
  }
  drop.addEventListener('click', () => {
    if (!ran) run()
  })
  const down = (e) => {
    if (holding()) e.preventDefault()
  }
  const onWheel = (e) => {
    if (e.deltaY > 0) down(e)
  }
  let ty = 0
  const onTouchStart = (e) => {
    ty = e.touches[0].clientY
  }
  const onTouchMove = (e) => {
    if (e.touches[0].clientY < ty) down(e)
  }
  const onKey = (e) => {
    if ([' ', 'PageDown', 'ArrowDown', 'End'].includes(e.key) && e.target === document.body) down(e)
  }
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('keydown', onKey)

  let st = null
  st = ScrollTrigger.create({
    trigger: pin,
    start: 'top top',
    end: () => `+=${Math.round(window.innerHeight * 8)}`,
    pin: true,
    scrub: 1,
    anticipatePin: 1,
    invalidateOnRefresh: true,
    animation: cam,
    onUpdate: (self) => {
      const t = self.progress * cam.duration()
      setBeat(t < T.drop ? 0 : t < T.wave ? 'drop' : t < T.sizes ? 2 : t < T.out ? (t < T.wide ? 3 : 4) : 0)
      let on = -1
      tourAt.forEach((a, i) => {
        if (t >= a && t < a + 1.05) on = i
      })
      setSize(t < T.wide ? on : -1)
      pin.style.setProperty('--fog-top', t < 1.1 || t > T.out ? 1 : 0.3)
      pin.style.setProperty('--fog-bot', t < 0.6 ? 1 : t > T.out ? Math.min(1, 0.15 + (t - T.out) / 0.9) : 0.15)
      pin.style.setProperty('--fog-rise', t > T.out ? Math.min(1, (t - T.out) / 1.1).toFixed(3) : 0)
      gate(self, t)
      if (hover) setHover(null)
    },
  })
  const onRefreshInit = () => {
    measure()
    measureLead()
    dists = null
  }
  ScrollTrigger.addEventListener('refreshInit', onRefreshInit)

  // keep the city alive while it is on screen (and a screen early, so its first paint happens off screen)
  const spin = () => W.tick()
  const watch = ScrollTrigger.create({
    trigger: section,
    start: 'top bottom+=100%',
    end: 'bottom top-=50%',
    refreshPriority: -1,
    onToggle: (self) => {
      tl.paused(!self.isActive)
      world.style.visibility = self.isActive ? '' : 'hidden'
      if (self.isActive) gsap.ticker.add(spin)
      else gsap.ticker.remove(spin)
    },
  })
  if (!watch.isActive) world.style.visibility = 'hidden'
  else gsap.ticker.add(spin)
  setBeat(0)
  void mark

  return {
    kill() {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('keydown', onKey)
      tl.kill()
      watch.kill()
      st.kill()
      cam.kill()
      ro.disconnect()
      gsap.ticker.remove(spin)
      ScrollTrigger.removeEventListener('refreshInit', onRefreshInit)
    },
  }
}

// a ratio as people say it: 1.91:1, 9:16, 4:5, 1:2 ...
function ratio(ar) {
  const known = [
    [1, '1:1'],
    [0.8, '4:5'],
    [0.5625, '9:16'],
    [1.91, '1.91:1'],
    [0.5, '1:2'],
    [0.667, '2:3'],
    [0.75, '3:4'],
    [1.5, '3:2'],
    [2, '2:1'],
    [3, '3:1'],
    [4, '4:1'],
    [0.4, '2:5'],
  ]
  let best = known[0]
  known.forEach((k) => {
    if (Math.abs(Math.log(k[0] / ar)) < Math.abs(Math.log(best[0] / ar))) best = k
  })
  return best[1]
}

// paint a board onto a bus (the same maths as town.js's paint, for point sprites drawn at a third)
const BUS = {
  'v-bus-ad-se': { x1: 101, x2: 245, y1: 142, h: 33, m: 0.297 },
  'v-bus-ad-sw': { x1: 196, x2: 358, y1: 189, h: 35, m: -0.34 },
}
function paintOn(host, name, html) {
  const p = BUS[name],
    k = 1 / 3,
    n2 = Math.sqrt(1 + p.m * p.m)
  const dx = (p.x2 - p.x1) * k,
    H = p.h * k,
    L = dx * n2
  const w = L * 0.94,
    h = H * 0.86,
    u0 = (L - w) / 2 / n2,
    v0 = (H - h) / 2
  const n = document.createElement('div')
  n.className = 't-panel'
  n.innerHTML = html
  Object.assign(n.style, {
    width: `${w}px`,
    height: `${h}px`,
    transform: `matrix(${1 / n2}, ${p.m / n2}, 0, 1, ${p.x1 * k + u0}, ${p.y1 * k + p.m * u0 + v0})`,
  })
  host.appendChild(n)
  return n
}

// the Ferris wheel: drawn in code over the painted frame. The ring is a circle in the plane of the frame (which runs
// down to the right on screen), so it is drawn flat and sheared into that plane; the gondolas are placed at the
// ring's turning rim points but stay upright, as they hang
function makeWheel(world, wb) {
  if (!wb) return { tick() {} }
  const { base } = wb
  const R = 104,
    N = 12,
    a = 0.894,
    b = 0.447
  const hubX = parseFloat(base.style.left) + 161,
    hubY = parseFloat(base.style.top) + 23
  const g = document.createElement('div')
  g.className = 't-wheel'
  Object.assign(g.style, { left: `${hubX}px`, top: `${hubY}px`, zIndex: String(parseInt(base.style.zIndex, 10) + 1) })
  const spokes = [...Array(N)]
    .map((_, i) => {
      const t = (i / N) * Math.PI * 2
      return `M0 0L${(R * Math.cos(t)).toFixed(1)} ${(R * Math.sin(t)).toFixed(1)}`
    })
    .join('')
  g.innerHTML = `<div class="t-wheel__plane" style="transform:matrix(${a},${b},0,1,0,0)"><svg class="t-wheel__ring" viewBox="-112 -112 224 224" width="224" height="224">
      <g fill="none" stroke-linecap="round">
        <path d="${spokes}" stroke="#bdb2a0" stroke-width="3.4"/><path d="${spokes}" stroke="#f6f1e8" stroke-width="1.8"/>
        <circle r="${R}" stroke="#bdb2a0" stroke-width="7"/><circle r="${R}" stroke="#f8f3ea" stroke-width="4.6"/>
        <circle r="${R - 9}" stroke="#bdb2a0" stroke-width="3"/><circle r="${R - 9}" stroke="#f3ede2" stroke-width="1.6"/>
      </g><circle r="9" fill="#e0574a" stroke="#a83a31" stroke-width="2"/></svg></div>`
  const COL = ['#e0574a', '#f2c94c', '#5fb6c9', '#3fa37a', '#f2994a', '#7fb6e6']
  const pods = [...Array(N)].map((_, i) => {
    const p = document.createElement('i')
    p.className = 't-pod'
    p.style.setProperty('--c', COL[i % COL.length])
    g.appendChild(p)
    return p
  })
  world.querySelector('.t-things').appendChild(g)
  const ring = g.querySelector('.t-wheel__ring')
  let ang = 0,
    last = 0
  const place = () => {
    ring.style.transform = `rotate(${ang}rad)`
    pods.forEach((p, i) => {
      const t = ang + (i / N) * Math.PI * 2,
        u = R * Math.cos(t),
        v = R * Math.sin(t)
      p.style.transform = `translate(${(u * a).toFixed(1)}px, ${(u * b + v).toFixed(1)}px)`
      p.style.zIndex = u * b + v > 0 ? 2 : 0
    })
  }
  place()
  return {
    tick() {
      const now = performance.now(),
        dt = last && now - last < 200 ? (now - last) / 1000 : 0
      last = now
      ang += dt * 0.12
      place()
    },
  }
}
