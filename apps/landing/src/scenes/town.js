import { gsap } from 'gsap'
import { SPRITES } from './town-sprites.js'
import { FREE } from './town-free.js'

// The town (a tile map): a 2D isometric city on a fixed grid, like a city-builder game. No 3D: the ground is one
// flat plane sheared into the 2:1 iso view, and every building is a painted sprite (public/sprites/city, warped onto the
// grid, see town-sprites.js) standing on a lot of exactly its footprint. Things are stacked back to front by their nearest
// corner, so nothing overlaps wrongly. build() lays the town out and life() moves its people, cars and clouds; the
// city (city.js) places its own blocks and boards through build()'s layout.
//
// Grid: one cell is 64 world px. Screen: x' = x - y, y' = (x + y) / 2 - z, so a cell is a 128 x 64 diamond.
// The map repeats every 10 cells: road (0), pavement (1), seven cells of lots (2 to 8), pavement (9).

const P = 10,
  M = 80,
  CELL = 64,
  CC = M / 2 // period, map size in cells, cell size, centre cell
const scr = (x, y, z = 0) => [x - y, (x + y) / 2 - z] // world px -> screen px
const depth = (x, y) => Math.round((x + y) * 4) // stacking order: further down the screen is nearer

// blank ad faces on the art, in sprite px: left and right x, top y at the left x, height, and which way the wall runs
// (+1: the wall faces down-left, its top edge falls to the right; -1: faces down-right, the top edge rises)
const PANELS = {
  'b-office-tower': { x1: 120, x2: 344, y1: 137, h: 587, m: 0.5 },
  'b-shop-row': { x1: 300, x2: 444, y1: 96, h: 76, m: -0.5 },
  's-billboard-wide': { x1: 80, x2: 592, y1: 284, h: 185, m: -0.5 },
  's-bus-shelter': { x1: 60, x2: 112, y1: 141, h: 106, m: 0.5 },
  // carriers (measured on the fitted sprites; m is the wall's screen slope, + falls to the right)
  's-digital-stop': { x1: 303, x2: 346, y1: 79, h: 94, m: -0.502 },
  'b-flats-wall': { x1: 41, x2: 199, y1: 163, h: 370, m: 0.527 },
  'b-media-corner': { x1: 192, x2: 321, y1: 241, h: 142, m: 0 },
  's-column': { x1: 14, x2: 55, y1: 73, h: 96, m: 0 },
  's-board-tall': { x1: 13, x2: 100, y1: 56, h: 109, m: -0.404 },
  'v-bus-ad-se': { x1: 101, x2: 245, y1: 142, h: 33, m: 0.297 },
  'v-bus-ad-sw': { x1: 196, x2: 358, y1: 189, h: 35, m: -0.34 },
}

const seeded = (seed) => {
  const r = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 6; i++) r()
  return r
}

function build(
  world,
  {
    layout,
    own = new Set(),
    crowd = 30,
    land = () => true,
    sea = 0,
    roads = null,
    walk = null,
    cars = null,
    back = 0,
    pk = 1,
    plans = null,
  } = {},
) {
  const frag = document.createDocumentFragment()
  const el = (cls, css = {}) => {
    const n = document.createElement('div')
    n.className = cls
    Object.assign(n.style, css)
    return n
  }
  const px = (v) => `${v}px`

  // the ground: one plane, sheared into the iso view; everything on it is laid out in cells
  const ground = el('t-ground', { width: px(M * CELL), height: px(M * CELL) })
  const flat = (cls, i, j, w, h) => {
    const n = el(`t-flat ${cls}`, { left: px(i * CELL), top: px(j * CELL), width: px(w * CELL), height: px(h * CELL) })
    ground.appendChild(n)
    return n
  }
  flat('t-grass', 0, 0, M, M)
  for (let k = 0; k < M; k += P) {
    flat('t-pave', 0, k - 1, M, 3)
    flat('t-pave', k - 1, 0, 3, M)
  }
  for (let k = 0; k < M; k += P) {
    flat('t-road', 0, k, M, 1)
    flat('t-road--v', k, 0, 1, M)
  }
  for (let i = 0; i < M; i += P) for (let j = 0; j < M; j += P) flat('t-cross', i, j, 1, 1)
  for (const ci of [CC - P, CC, CC + P])
    for (const cj of [CC - P, CC, CC + P]) {
      flat('t-zebra', ci - 1, cj, 1, 1)
      flat('t-zebra', ci + 1, cj, 1, 1)
      flat('t-zebra--v', ci, cj - 1, 1, 1)
      flat('t-zebra--v', ci, cj + 1, 1, 1)
    }
  world.appendChild(ground)
  if (sea) {
    const Y = (sea * CELL) / 2
    world.appendChild(el('t-sea', { left: px(-6000), width: px(12000), top: px(Y - 40), height: px(4000) }))
  }

  // every lot sprite's footprint (world px), stacking value and screen box, so moving things can be stacked against it
  const LOTS = []
  // anything standing up is placed in screen px in one layer and stacked by depth
  const things = el('t-things')
  const put = (n, x, y) => {
    n.style.zIndex = depth(x, y)
    things.appendChild(n)
    return n
  }

  // a painted sprite on the lot i..i+W, j..j+D (cells); returns the element and its screen box
  // flip = true mirrors it: the same building seen from the other side, so its footprint turns (W and D swap)
  const sprite = (name, i, j, flip = false, solid = true) => {
    const m = SPRITES[name]
    const W = flip ? m.D : m.W,
      D = flip ? m.W : m.D
    const fx = (i + W) * CELL,
      fy = (j + D) * CELL // the footprint's nearest corner
    const [X, Y] = scr(fx, fy)
    const ox = flip ? m.w - m.ox : m.ox
    const n = el(`t-sprite${flip ? ' is-flip' : ''}`, {
      left: px(X - ox / 2),
      top: px(Y - m.oy / 2),
      width: px(m.w / 2),
      height: px(m.h / 2),
    })
    const img = document.createElement('img')
    img.src = m.src
    img.alt = ''
    img.draggable = false
    n.appendChild(img)
    put(n, fx, fy)
    if (solid)
      LOTS.push({
        x1: i * CELL,
        y1: j * CELL,
        x2: fx,
        y2: fy,
        z: depth(fx, fy),
        l: X - ox / 2,
        r: X - ox / 2 + m.w / 2,
        t: Y - m.oy / 2,
        b: Y - m.oy / 2 + m.h / 2,
      })
    return n
  }
  // paint an ad onto a sprite's blank panel, fitted at its own aspect ratio (size: a Meta size, 'fill' or a number)
  // lot sprites are drawn at half their pixels, point sprites (street furniture, buses) at a third
  const paint = (host, name, route, size, target, html) => {
    const p = PANELS[name]
    const k = FREE[name] ? 1 / 3 : 0.5
    const n2 = Math.sqrt(1 + p.m * p.m)
    const dx = (p.x2 - p.x1) * k,
      H = p.h * k,
      L = dx * n2 // run across, height, true length along the wall
    const fill = size === 'fill' || typeof size === 'number'
    const ar =
      typeof size === 'number'
        ? size
        : { 's-11': 1, 's-45': 0.8, 's-916': 0.5625, 's-191': 1.91, fill: (L * 0.94) / (H * 0.9) }[size]
    let w = L * (fill ? 0.94 : 0.9),
      h = w / ar
    if (h > H * 0.9 + 0.01) {
      h = H * 0.9
      w = h * ar
    }
    const u0 = (L - w) / 2 / n2,
      v0 = (H - h) / 2 // margins, in screen run and height
    const n = el('t-panel')
    n.innerHTML = html
    n.style.width = px(w)
    n.dataset.target = target
    if (fill) n.style.height = px(h)
    n.style.transform = `matrix(${1 / n2}, ${p.m / n2}, 0, 1, ${p.x1 * k + u0}, ${p.y1 * k + p.m * u0 + v0})`
    host.appendChild(n)
    return n
  }

  // a sprite that stands on a point (a tree, lamp, bench, person or car): its bottom centre on the spot
  const freeImg = (name, k = 1, flip = false) => {
    const m = FREE[name],
      w = m.w * k,
      h = m.h * k
    const n = el(`t-sprite${flip ? ' is-flip' : ''}`, { left: px(-w / 2), top: px(-h), width: px(w), height: px(h) })
    const img = document.createElement('img')
    img.src = m.src
    img.alt = ''
    img.draggable = false
    n.appendChild(img)
    return n
  }
  const free = (name, x, y, k = 1, flip = false) => {
    const n = freeImg(name, k, flip)
    const [X, Y] = scr(x, y)
    n.style.left = px(X + parseFloat(n.style.left))
    n.style.top = px(Y + parseFloat(n.style.top))
    return put(n, x, y)
  }
  // trees: mostly round ones, every few a tall poplar; mirrored at random so they don't repeat
  const tree = (x, y, k = 1) => {
    const h = Math.abs(Math.round(x * 7 + y * 13)) % 9
    return free(h < 2 ? 'n-tree-tall' : 'n-tree-round', x, y, k, h % 2 === 1)
  }
  const cellTree = (i, j, k) => tree((i + 0.5) * CELL, (j + 0.5) * CELL, k)

  // which blocks the widest shot can see (the rest is never built)
  const seen = (bi, bj) => {
    const [X, Y] = scr((bi * P + 5 - CC) * CELL, (bj * P + 5 - CC) * CELL)
    return land(bi, bj) && Math.abs(X) < 2300 && Y < 1400 && Y > -1650
  }

  // block plans, in lot cells 0..6 from the block's far corner. Every building sits on a lot of exactly its size.
  // the office tower and the shop row carry blank ad boards, so in the made-up blocks they are rare (most real
  // buildings have none); everything else is mirrored at random so neighbours don't repeat
  const BIG = ['b-market', 'b-office-tower-glass', 'b-hotel', 'b-tower-teal', 'b-supermarket', 'b-office-tower-glass'] // the office tower's blank wall is only for the banner
  const MIDS = [
    'b-gym',
    'b-apartments',
    'b-apartments-brick',
    'b-yoga',
    'b-flats-pastel',
    'b-apartments-brick',
    'b-apartments',
    'b-flats-pastel',
    'b-yoga',
  ]
  const HOUSES = ['b-house-a', 'b-house-b', 'b-house-c', 'b-house-d', 'b-house-c', 'b-house-a']
  const CORNERS = ['b-corner-cafe', 'b-diner', 'b-pharmacy', 'b-salon', 'b-corner-cafe'] // shop fronts on both street sides
  const STREET = ['n-planter', 'n-umbrella-table', 's-aframe', 'n-bench', 'n-lamp', 'n-planter', 'n-umbrella-table']
  const thing = (r, x, y) => free(pick(r, STREET), x * CELL, y * CELL, 1, r() < 0.5)
  const pick = (r, list) => list[Math.floor(r() * list.length)]
  const any = (r, name, i, j) => sprite(name, i, j, r() < 0.5)
  const PLANS = {
    houses: (r, i, j) => {
      flat('t-pave', i - 0.2, j + 2, 7.4, 1)
      flat('t-pave', i + 6, j - 0.2, 1, 7.4) // a walk between the rows, out to both pavements
      for (const a of [0, 2, 4])
        for (const b of [0, 3]) {
          if (r() < 0.12) {
            cellTree(i + a + 0.5, j + b + 0.5, 0.9)
            cellTree(i + a + 1.5, j + b + 1.4, 0.75)
            continue
          }
          a === 4 && b === 3 && r() < 0.6
            ? sprite(pick(r, CORNERS), i + a, j + b)
            : any(r, pick(r, HOUSES), i + a, j + b)
        }
      for (const a of [1, 3, 5]) cellTree(i + a, j + 5.6, 0.8)
      free('n-lamp', (i + 6.15) * CELL, (j + 2.1) * CELL)
      free('n-lamp', (i + 1.5) * CELL, (j + 2.85) * CELL)
    },
    shops: (r, i, j) => {
      flat('t-plaza', i, j, 7, 7)
      any(r, pick(r, BIG), i, j)
      cellTree(i + 3.5, j + 1, 0.8)
      if (r() < 0.5) any(r, pick(r, BIG), i + 4, j)
      else {
        cellTree(i + 4.6, j + 0.8, 0.9)
        cellTree(i + 5.8, j + 2, 0.8)
      }
      // three mid-size lots along the near side, each 2 x 3 (or 3 x 2 when mirrored, so they are placed by footprint)
      for (const a of [0, 2.5, 5]) {
        const nm = pick(r, MIDS)
        sprite(nm, i + a, j + 4, false)
      }
    },
    flats: (r, i, j) => {
      flat('t-plaza', i, j, 7, 7)
      sprite(pick(r, MIDS), i, j)
      sprite(pick(r, MIDS), i + 2, j)
      any(r, pick(r, BIG), i + 4, j)
      any(r, pick(r, BIG), i, j + 4)
      sprite(pick(r, MIDS), i + 4, j + 4)
      cellTree(i + 3.4, j + 5, 0.9)
      cellTree(i + 6.4, j + 5.5, 0.8)
    },
    // a full block: big building and two mid ones at the back, two mid ones at the front, the corner building on
    // the near corner (its two shop fronts on the two streets), street things in the lanes between
    dense: (r, i, j) => {
      flat('t-plaza', i, j, 7, 7)
      any(r, pick(r, BIG), i, j)
      sprite(pick(r, MIDS), i + 3, j)
      sprite(pick(r, MIDS), i + 5, j)
      sprite(pick(r, MIDS), i, j + 4)
      sprite(pick(r, MIDS), i + 2, j + 4)
      sprite(pick(r, CORNERS), i + 5, j + 5)
      thing(r, i + 4.5, j + 4.8)
      thing(r, i + 4.5, j + 6.4)
      thing(r, i + 1.5, j + 3.5)
      thing(r, i + 5.6, j + 4.5)
      cellTree(i + 3.5, j + 3.5, 0.7)
      cellTree(i + 6.5, j + 4.5, 0.7)
    },
    park: (r, i, j) => {
      flat('t-park', i, j, 7, 7)
      flat('t-pave', i - 0.2, j + 3, 7.4, 1)
      flat('t-pave', i + 3, j - 0.2, 1, 7.4) // paths across, to the fountain
      flat('t-pave', i + 2, j + 2, 3, 3)
      sprite('n-fountain', i + 2.5, j + 2.5)
      sprite('s-kiosk', i + 4.2, j + 4.2)
      free('n-bench', (i + 1.4) * CELL, (j + 4.15) * CELL, 1, true)
      free('n-bench', (i + 4.15) * CELL, (j + 1.4) * CELL)
      free('n-lamp', (i + 2.15) * CELL, (j + 2.15) * CELL)
      free('n-lamp', (i + 2.15) * CELL, (j + 5.2) * CELL)
      free('n-lamp', (i + 5.2) * CELL, (j + 2.15) * CELL)
      ;[
        [0.6, 0.6],
        [1.8, 1.6],
        [5.6, 0.8],
        [4.8, 1.8],
        [0.8, 5.6],
        [5.8, 5.6],
        [1.6, 4.9],
      ].forEach(([a, b], t) => cellTree(i + a, j + b, 0.8 + (t % 3) * 0.15))
    },
  }
  // a landmark on a lawn: a paved apron round it, two paths out to the pavements, trees, lamps and benches on the grass
  const civic = (r, i, j, name) => {
    const m = SPRITES[name],
      a = i + Math.floor((7 - m.W) / 2),
      b = j + Math.floor((7 - m.D) / 2)
    flat('t-park', i, j, 7, 7)
    flat('t-plaza', a - 0.5, b - 0.5, m.W + 1, m.D + 1)
    const px0 = a + m.W / 2 - 0.5,
      py0 = b + m.D / 2 - 0.5
    flat('t-pave', px0, b + m.D + 0.5, 1, j + 7.2 - (b + m.D + 0.5)) // out to the near pavements
    flat('t-pave', a + m.W + 0.5, py0, i + 7.2 - (a + m.W + 0.5), 1)
    sprite(name, a, b)
    const clear = (x, y) =>
      (x > a - 0.9 && x < a + m.W + 0.9 && y > b - 0.9 && y < b + m.D + 0.9) ||
      (x > px0 - 0.4 && x < px0 + 1.4 && y > b) ||
      (y > py0 - 0.4 && y < py0 + 1.4 && x > a)
    for (let x = i + 0.5; x < i + 7; x += 1.3)
      for (let y = j + 0.5; y < j + 7; y += 1.3) {
        const tx = x + (r() - 0.5) * 0.5,
          ty = y + (r() - 0.5) * 0.5
        if (!clear(tx, ty) && r() < 0.75) cellTree(tx, ty, 0.85 + r() * 0.3)
      }
    free('n-lamp', (px0 - 0.15) * CELL, (j + 6.6) * CELL)
    free('n-lamp', (i + 6.6) * CELL, (py0 - 0.15) * CELL)
    free('n-bench', (px0 + 1.35) * CELL, (b + m.D + 1.4) * CELL, 1, true)
    free('n-bench', (a + m.W + 1.4) * CELL, (py0 + 1.35) * CELL)
  }
  const CIVIC = { '5,5': 'l-town-hall', '3,5': 'l-library', '5,3': 'l-museum', '2,4': 'l-school', '4,2': 'l-cinema' }
  for (let bi = 0; bi < M / P; bi++)
    for (let bj = 0; bj < M / P; bj++) {
      if (own.has(`${bi},${bj}`) || !seen(bi, bj)) continue
      const r = seeded(bi * 97 + bj * 31 + 11),
        v = r()
      if (CIVIC[`${bi},${bj}`]) {
        civic(r, bi * P + 2, bj * P + 2, CIVIC[`${bi},${bj}`])
        continue
      }
      const plan = plans ? plans(r, bi, bj) : v < 0.14 ? 'park' : v < 0.52 ? 'houses' : v < 0.78 ? 'shops' : 'flats'
      PLANS[plan](r, bi * P + 2, bj * P + 2)
    }

  const speakers = []
  const figure = (x, y, name, flip, data, k = 1) => {
    const g = el('t-mover t-speaker')
    const head = freeImg(name, k, flip)
    g.appendChild(head)
    things.appendChild(g)
    const sp = { m: g, head, x, y, walk: ['x', 0], ...data }
    speakers.push(sp)
    return sp
  }
  const extra = layout({
    sprite,
    paint,
    flat,
    free,
    cellTree,
    figure,
    el,
    things,
    CELL,
    plan: (name, r, i, j) => PLANS[name](r, i, j),
    thing,
    pick,
    CORNERS,
    MIDS,
    BIG,
  })

  // movers: cars both ways on the roads near the middle, people on the pavements
  const movers = []
  // the cars are painted facing the viewer, so every street runs one way, toward the bottom of the screen
  const CARS = cars || [
    'v-hatchback-red',
    'v-hatchback-cream',
    'v-taxi',
    'v-van',
    'v-hatchback-cream',
    'v-hatchback-red',
    'v-taxi',
    'v-bus',
  ]
  const vehicle = (along, name) => {
    const g = el('t-mover')
    const n = freeImg(`${name}-${along === 'x' ? 'se' : 'sw'}`)
    n.style.top = px(parseFloat(n.style.top) + FREE[`${name}-se`].w * 0.2) // the car's middle, not its nearest wheel, on the lane
    g.appendChild(n)
    things.appendChild(g)
    g._img = n
    g._name = `${name}-${along === 'x' ? 'se' : 'sw'}`
    return g
  }
  const rc = seeded(4242)
  for (let k = 0; k < M; k += P) {
    if (roads ? !roads.includes(k) : Math.abs(k - CC) > 2 * P) continue
    for (let n = 0; n < 4; n++) {
      const start = ((n >> 1) * 0.5 + rc() * 0.4) % 1,
        lane = (k + (n % 2 ? 0.3 : 0.7)) * CELL
      const a = CARS[Math.floor(rc() * CARS.length)],
        b = CARS[Math.floor(rc() * CARS.length)]
      movers.push({ m: vehicle('x', a), axis: 'x', at: lane, start, bus: a.startsWith('v-bus') })
      movers.push({ m: vehicle('y', b), axis: 'y', at: lane, start: (start + 0.37) % 1, bus: b.startsWith('v-bus') })
    }
  }

  const people = []
  const rp = seeded(777)
  const WALKERS = walk
    ? [
        'p-walk-a',
        'p-tote',
        'p-coffee',
        'p-dog-walker',
        'p-headphones',
        'p-couple',
        'p-walk-b',
        'p-parent-child',
        'p-shopping',
        'p-phone-walk',
        'p-jogger',
        'p-suit',
        'p-buggy',
        'p-cyclist',
        'p-skater',
        'p-runner',
      ]
    : ['p-walk-a', 'p-walk-b', 'p-dog', 'p-walk-a', 'p-buggy', 'p-walk-b', 'p-runner']
  for (let n = 0; n < crowd; n++) {
    let bi = 2 + Math.floor(rp() * 4),
      bj = 2 + Math.floor(rp() * 4)
    if (walk) [bi, bj] = walk[n % walk.length]
    const horiz = rp() < 0.5,
      side = rp() < 0.5 ? -0.5 : 1.5 // the pavement either side of the road
    const at = ((horiz ? bj : bi) * P + side) * CELL
    const from = ((horiz ? bi : bj) * P + 2 + rp() * 3) * CELL
    const who = WALKERS[n % WALKERS.length]
    const g = el('t-mover')
    const im = freeImg(`${who}-${horiz ? 'se' : 'sw'}`, pk)
    g.appendChild(im)
    things.appendChild(g)
    people.push({
      m: g,
      img: im,
      who,
      axis: horiz ? 'x' : 'y',
      at,
      from,
      to: from + (2 + rp() * 2) * CELL,
      fast: /runner|jogger|cyclist|skater/.test(who),
    })
  }

  world.appendChild(things)

  // clouds: soft shadows drifting over the town (always), and the clouds themselves floating above them once their art
  // exists in /sprites/city/sky (k-cloud-a/b/c.webp). Kept faint so the banners stay the thing you look at.
  const sky = el('t-clouds')
  const rk = seeded(31)
  const clouds = [...Array(6)].map((_, k) => {
    const g = el('t-cloud')
    const w = 1200 + rk() * 900,
      h = w * (0.4 + rk() * 0.12)
    const sh = el('t-cloud__shade', { width: px(w), height: px(h), left: px(-w / 2), top: px(-h / 2) })
    g.appendChild(sh)
    sky.appendChild(g)
    const c = {
      g,
      w,
      x: -2600 + k * 900 + rk() * 300,
      y: 2560 - 1300 + rk() * 2400,
      v: 9 + rk() * 7,
      name: 'abc'[k % 3],
    }
    g.style.transform = `translate(${c.x}px, ${c.y}px)`
    return c
  })
  ;['a', 'b', 'c'].forEach((n) => {
    const probe = new Image()
    probe.onload = () =>
      clouds
        .filter((c) => c.name === n)
        .forEach((c) => {
          const img = document.createElement('img')
          img.src = probe.src
          img.alt = ''
          img.className = 't-cloud__img'
          img.style.width = px(c.w * 0.9)
          img.style.left = px(-c.w * 0.45 - 70)
          img.style.bottom = px(380)
          c.g.appendChild(img)
        })
    probe.src = `/sprites/city/sky/k-cloud-${n}.webp`
  })
  world.appendChild(sky)
  world.appendChild(frag)
  return { movers, people, speakers, clouds, lots: LOTS, extra, things, sea, back }
}

// Stacking moving things. A building's stacking value is its nearest corner, which is right for things on the
// pavements in line with that corner but wrong beside a long wall: someone standing just in front of the south wall,
// near its west end, has a smaller x + y than the corner and would be drawn behind the building (head cut off).
// So each mover is checked against the buildings its picture overlaps: in front of the footprint (x >= x2 or y >= y2)
// means drawn above it, behind it (x < x1 or y < y1) means below it.
const BUCKET = 256
const index = (lots) => {
  const g = new Map()
  lots.forEach((L) => {
    for (let bx = Math.floor(L.l / BUCKET); bx <= Math.floor(L.r / BUCKET); bx++) {
      for (let by = Math.floor(L.t / BUCKET); by <= Math.floor(L.b / BUCKET); by++) {
        const k = bx * 10007 + by
        if (!g.has(k)) g.set(k, [])
        g.get(k).push(L)
      }
    }
  })
  return g
}
const stackAt = (grid, x, y, half = 40, up = 70) => {
  const [X, Y] = scr(x, y)
  let z = depth(x, y),
    lo = -Infinity,
    hi = Infinity
  const seenL = new Set()
  for (let bx = Math.floor((X - half) / BUCKET); bx <= Math.floor((X + half) / BUCKET); bx++) {
    for (let by = Math.floor((Y - up) / BUCKET); by <= Math.floor((Y + 8) / BUCKET); by++) {
      const list = grid.get(bx * 10007 + by)
      if (!list) continue
      for (const L of list) {
        if (seenL.has(L)) continue
        seenL.add(L)
        if (L.r < X - half || L.l > X + half || L.b < Y - up || L.t > Y + 8) continue
        if (x >= L.x2 || y >= L.y2) lo = Math.max(lo, L.z + 1)
        else if (x < L.x1 || y < L.y1) hi = Math.min(hi, L.z - 1)
      }
    }
  }
  if (lo > hi) return lo // can't satisfy both: rather show it than hide it
  return Math.min(Math.max(z, lo), hi)
}
const placer = (grid) => (m, x, y, half, up) => {
  const [X, Y] = scr(x, y)
  m.style.transform = `translate(${X.toFixed(1)}px, ${Y.toFixed(1)}px)`
  m.style.zIndex = stackAt(grid, x, y, half, up) + (m._hi ? 60000 : 0)
}

function life({ movers, people, speakers, clouds, lots, things, sea = 0, back = 0 }, { lights = false } = {}) {
  const tl = gsap.timeline({ paused: true })
  const span = M * CELL
  const place = placer(index(lots))
  const seaPx = sea * CELL
  // traffic lights: one phase for every junction, 12 s round: along x green, all red, along y green, all red
  let phase = 'x',
    clock = 0
  const lightAt = (t) => {
    const c = t % 12
    return c < 5 ? 'x' : c < 6 ? '' : c < 11 ? 'y' : ''
  }
  speakers.forEach((s, k) => {
    const [ax, d] = s.walk
    const o = { t: 0 }
    place(s.m, s.x, s.y, 30, 60)
    if (d)
      tl.add(
        gsap.to(o, {
          t: 1,
          duration: 4 + k * 0.5,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
          onUpdate: () => place(s.m, s.x + (ax === 'x' ? d * o.t : 0), s.y + (ax === 'y' ? d * o.t : 0), 30, 60),
        }),
        0,
      )
  })

  // traffic: each vehicle has its own cruising speed, keeps a gap to the one ahead in its lane, and waits before a
  // junction while something is crossing it (first come, first served)
  const rv = seeded(99)
  const cars = movers.map((c, k) => {
    const v0 = c.bus ? 70 + rv() * 20 : 105 + rv() * 85
    return { ...c, k, s: c.start * span, v: v0 * 0.6, v0, len: c.bus ? 150 : 74 }
  })
  const lanes = new Map()
  cars.forEach((c) => {
    const key = `${c.axis}${c.at}`
    if (!lanes.has(key)) lanes.set(key, [])
    lanes.get(key).push(c)
  })
  const near = (a, b) => (((b - a) % span) + span) % span // distance ahead along a looping road
  let last = 0
  const step = () => {
    const now = performance.now(),
      dt = last && now - last < 200 ? (now - last) / 1000 : 0
    last = now
    if (!dt) return
    for (const [, list] of lanes) list.sort((a, b) => a.s - b.s)
    if (lights) {
      clock += dt
      const ph = lightAt(clock)
      if (ph !== phase) {
        phase = ph
        things?.classList.toggle('is-x', ph === 'x')
        things?.classList.toggle('is-y', ph === 'y')
      }
    }
    for (const c of cars) {
      let target = c.v0
      // the one ahead in the lane
      const list = lanes.get(`${c.axis}${c.at}`)
      if (list.length > 1) {
        const i = list.indexOf(c),
          ahead = list[(i + 1) % list.length]
        const gap = near(c.s, ahead.s) - (c.len + ahead.len) / 2
        if (gap < 26) target = 0
        else if (gap < 110) target = Math.min(target, (ahead.v * (gap - 26)) / 84 + 10)
      }
      // the junction ahead: wait at the line while a crossing vehicle is in it, or about to be and nearer to it
      const front = c.s + c.len / 2,
        kx = Math.ceil(front / (P * CELL)) * P,
        entry = kx * CELL,
        dist = entry - front
      if (lights && phase !== c.axis && dist > 4 && dist < 80) target = Math.min(target, Math.max(0, (dist - 8) * 2))
      if (dist > 0 && dist < 70) {
        const row = Math.floor(c.at / CELL) * CELL // my road, as the crossing car sees it
        for (const o of cars) {
          if (o.axis === c.axis || Math.floor(o.at / CELL) !== kx) continue
          const lo = o.s - o.len / 2,
            hi = o.s + o.len / 2,
            odist = row - hi
          const busy = hi > row - 4 && lo < row + CELL + 4
          const coming = odist > 0 && odist < 46 && o.v > 5 && (odist < dist || (odist === dist && o.k < c.k))
          if (busy || coming) {
            target = Math.min(target, Math.max(0, (dist - 6) * 2))
            break
          }
        }
      }
      const a = target > c.v ? 70 : 260 // gentle pull-away, firmer braking
      c.v += Math.sign(target - c.v) * Math.min(Math.abs(target - c.v), a * dt)
      c.s = (c.s + c.v * dt) % span
      if (c.axis === 'x') place(c.m, c.s, c.at, c.bus ? 80 : 46, 60)
      else place(c.m, c.at, c.s, c.bus ? 80 : 46, 60)
      if (seaPx || back) {
        // off the built city (the sea, behind the hills, past the front): hidden
        const sum = c.s + c.at
        const wet =
          (seaPx && sum > seaPx - 150) || (back && (sum < back * CELL + 200 || sum > 128 * CELL)) || c.s < 2 * CELL
        if (wet !== c.wet) {
          c.wet = wet
          c.m.style.visibility = wet ? 'hidden' : ''
        }
      }
    }
  }
  step()
  tl.add(gsap.to({}, { duration: 1, repeat: -1, onUpdate: step, onRepeat: step }), 0)

  // the clouds drift slowly across, wrapping round
  let cl = 0
  tl.add(
    gsap.to(
      {},
      {
        duration: 1,
        repeat: -1,
        onUpdate: () => {
          const now = performance.now(),
            dt = cl && now - cl < 200 ? (now - cl) / 1000 : 0
          cl = now
          clouds.forEach((c) => {
            c.x += c.v * dt
            c.y += c.v * 0.22 * dt
            if (c.x > 2700) {
              c.x -= 5400
              c.y -= 5400 * 0.22
            }
            if (c.y > 2560 + 1500) c.y -= 2800
            else if (c.y < 2560 - 1500) c.y += 2800
            c.g.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`
          })
        },
      },
    ),
    0,
  )

  people.forEach(({ m, img, who, axis, at, from, to, fast }, k) => {
    // one way (they are painted walking toward the viewer), fading in and out at the ends of their stretch
    const o = { t: 0 },
      dur = (9 + (k % 7) * 1.6) * (fast ? 0.45 : 1)
    const one = gsap.to(o, {
      t: 1,
      duration: dur,
      ease: 'none',
      repeat: -1,
      onUpdate: () => {
        const s = from + (to - from) * o.t
        m.style.opacity = Math.min(1, o.t * 8, (1 - o.t) * 8)
        if (img && !/cyclist|skater|buggy/.test(who)) {
          // a step every ~0.5 s: up on each stride, a slight rock side to side
          const ph = o.t * dur * (fast ? 3.4 : 2.1) * Math.PI
          img.style.transform = `translateY(${(-Math.abs(Math.sin(ph)) * (fast ? 2.2 : 1.4)).toFixed(2)}px) rotate(${(Math.sin(ph) * 2.2).toFixed(2)}deg)`
        }
        if (axis === 'x') place(m, s, at, 20, 50)
        else place(m, at, s, 20, 50)
      },
    })
    one.totalTime((k * 3.7) % dur)
    tl.add(one, 0)
  })
  return tl
}

export { build, life, CELL, P }
