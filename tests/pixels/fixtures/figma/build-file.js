/* global figma, document */
// Builds the recorded Figma file of RECIPE.md through Figma's plugin API.
// Paste it into the browser console of a new, empty Figma Design file (figma.com in Chrome, where the page exposes
// `figma`), then choose the six images of tests/pixels/assets in the file picker it shows at the page's top left.
;(async () => {
  const NAMES = ['sneaker', 'card-1', 'card-2', 'card-3', 'tile', 'cutout']
  const ARABIC = 'Noto Sans Arabic'

  const chooseImages = () =>
    new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.accept = 'image/png,image/jpeg'
      input.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;background:#fff;padding:8px'
      input.addEventListener('change', () => {
        input.remove()
        resolve([...input.files])
      })
      document.body.appendChild(input)
    })

  const files = await chooseImages()
  const img = {}
  for (const file of files) {
    const name = file.name.replace(/\.(jpg|png)$/, '')
    img[name] = figma.createImage(new Uint8Array(await file.arrayBuffer())).hash
  }
  const missing = NAMES.filter((n) => !img[n])
  if (missing.length) throw new Error(`Choose all six images; missing ${missing.join(', ')}`)
  for (const [family, style] of [
    ['Noto Sans', 'Regular'],
    ['Noto Sans', 'Bold'],
    [ARABIC, 'Regular'],
  ])
    await figma.loadFontAsync({ family, style })

  const hex = (h) => {
    h = h.replace('#', '')
    const at = (i) => parseInt(h.slice(i, i + 2), 16) / 255
    return { r: at(0), g: at(2), b: at(4), a: h.length > 6 ? at(6) : 1 }
  }
  const solid = (h, opacity) => {
    const { r, g, b, a } = hex(h)
    return { type: 'SOLID', color: { r, g, b }, opacity: opacity ?? a }
  }
  const stops = (list) => list.map(([h, position]) => ({ position, color: hex(h) }))
  const inverse = ([[a, b, c], [d, e, f]]) => {
    const det = a * e - b * d
    return [
      [e / det, -b / det, (b * f - c * e) / det],
      [-d / det, a / det, (c * d - a * f) / det],
    ]
  }
  const multiply = ([[a, b, c], [d, e, f]], [[g, h, i], [j, k, l]]) => [
    [a * g + b * j, a * h + b * k, a * i + b * l + c],
    [d * g + e * j, d * h + e * k, d * i + e * l + f],
  ]
  // A gradient from its three handles in the layer's unit box: p0 the start (or centre), p1 the end, p2 the width.
  const handles = (type, s, p0, p1, p2) => {
    const linear = type === 'GRADIENT_LINEAR'
    const k = linear ? 1 : 2
    const c1 = [(p1[0] - p0[0]) * k, (p1[1] - p0[1]) * k]
    const c2 = [(p2[0] - p0[0]) * 2, (p2[1] - p0[1]) * 2]
    const t = linear
      ? [p0[0] - 0.5 * c2[0], p0[1] - 0.5 * c2[1]]
      : [p0[0] - 0.5 * c1[0] - 0.5 * c2[0], p0[1] - 0.5 * c1[1] - 0.5 * c2[1]]
    return {
      type,
      gradientStops: stops(s),
      gradientTransform: inverse([
        [c1[0], c2[0], t[0]],
        [c1[1], c2[1], t[1]],
      ]),
    }
  }
  // A linear gradient whose width handle is square to its line, where Figma puts it.
  const linear = (s, p0, p1) =>
    handles('GRADIENT_LINEAR', s, p0, p1, [p0[0] - (p1[1] - p0[1]) / 2, p0[1] + (p1[0] - p0[0]) / 2])
  const plain = (type, s) => ({
    type,
    gradientStops: stops(s),
    gradientTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
  })
  const image = (name, scaleMode, more = {}) => ({ type: 'IMAGE', imageHash: img[name], scaleMode, ...more })
  const shadow = (x, y, blur, spread, h, more = {}) => ({
    type: 'DROP_SHADOW',
    color: hex(h),
    offset: { x, y },
    radius: blur,
    spread,
    visible: true,
    blendMode: 'NORMAL',
    ...more,
  })
  const centre = (n) => {
    const [[a, b, c], [d, e, f]] = n.relativeTransform
    return [(a * n.width) / 2 + (b * n.height) / 2 + c, (d * n.width) / 2 + (e * n.height) / 2 + f]
  }
  // Rotation about the layer's centre, as typing a rotation in the design panel does.
  const turn = (n, deg) => {
    const r = (deg * Math.PI) / 180
    const co = Math.cos(r)
    const si = Math.sin(r)
    const [cx, cy] = centre(n)
    n.relativeTransform = multiply(
      [
        [co, si, cx - co * cx - si * cy],
        [-si, co, cy + si * cx - co * cy],
      ],
      n.relativeTransform,
    )
    return n
  }
  // A flip across the layer's centre, as Shift + H (across) and Shift + V do.
  const flip = (n, across) => {
    const [cx, cy] = centre(n)
    const m = across
      ? [
          [-1, 0, 2 * cx],
          [0, 1, 0],
        ]
      : [
          [1, 0, 0],
          [0, -1, 2 * cy],
        ]
    n.relativeTransform = multiply(m, n.relativeTransform)
    return n
  }
  const put = (parent, n, name, x, y, w, h) => {
    parent.appendChild(n)
    if (name != null) n.name = name
    if (w != null) n.resize(w, h)
    if (x != null) {
      n.x = x
      n.y = y
    }
    return n
  }
  const rect = (parent, name, x, y, w, h, fills) => {
    const n = put(parent, figma.createRectangle(), name, x, y, w, h)
    if (fills) n.fills = fills
    return n
  }
  const oval = (parent, name, x, y, w, h, fills) => {
    const n = put(parent, figma.createEllipse(), name, x, y, w, h)
    if (fills) n.fills = fills
    return n
  }
  const star = (parent, name, x, y, size, points, ratio, fills) => {
    const n = put(parent, figma.createStar(), name, x, y, size, size)
    n.pointCount = points
    n.innerRadius = ratio
    n.fills = fills
    return n
  }
  const vector = (parent, name, x, y, data, windingRule = 'NONZERO') => {
    const n = put(parent, figma.createVector(), name)
    n.vectorPaths = [{ windingRule, data }]
    n.strokes = []
    n.x = x
    n.y = y
    return n
  }
  const text = (
    parent,
    name,
    characters,
    { family = 'Noto Sans', style = 'Regular', size, fill = '#1A1A1A', x = 0, y = 0 },
  ) => {
    const n = figma.createText()
    parent.appendChild(n)
    n.fontName = { family, style }
    n.characters = characters
    n.fontSize = size
    n.fills = [solid(fill)]
    n.name = name ?? characters
    n.x = x
    n.y = y
    return n
  }
  const range = (n, words, change) => {
    const start = n.characters.indexOf(words)
    if (start < 0) throw new Error(`"${words}" is not in "${n.characters}"`)
    change(start, start + words.length)
  }
  const nextX = (page) => page.children.reduce((m, c) => Math.max(m, c.x + c.width), -200) + 200
  const frame = (page, name, w, h, fill = '#FFFFFF') => {
    const x = nextX(page)
    const f = put(page, figma.createFrame(), name, x, 0, w, h)
    f.fills = [solid(fill)]
    return f
  }
  const nested = (parent, name, x, y, w, h, fills) => {
    const f = put(parent, figma.createFrame(), name, x, y, w, h)
    f.fills = fills
    return f
  }
  const auto = (f, mode, { padding, gap }) => {
    f.layoutMode = mode
    if (padding) [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft] = padding
    if (gap != null) f.itemSpacing = gap
    return f
  }
  const hug = (n) => {
    n.layoutSizingHorizontal = 'HUG'
    n.layoutSizingVertical = 'HUG'
    return n
  }
  const fillWidth = (n) => {
    n.layoutSizingHorizontal = 'FILL'
    return n
  }
  const asMask = (n, maskType = 'ALPHA') => {
    n.isMask = true
    n.maskType = maskType
    return n
  }
  const bold = { family: 'Noto Sans', style: 'Bold' }
  const RAINBOW = [
    ['#FF0000', 0],
    ['#00FF00', 0.5],
    ['#0000FF', 1],
  ]

  const risks = figma.root.children[0]
  risks.name = 'Risks'
  const themes = figma.createPage()
  themes.name = 'Themes'
  await figma.setCurrentPageAsync(risks)
  let f, r, t, g

  // Angular
  f = frame(risks, 'Angular', 400, 400)
  rect(f, 'Default', 20, 20, 160, 160, [plain('GRADIENT_ANGULAR', RAINBOW)])
  rect(f, 'Turned', 220, 20, 160, 160, [handles('GRADIENT_ANGULAR', RAINBOW, [0.5, 0.5], [0.5, 1], [0, 0.5])])
  rect(f, 'Reversed', 20, 220, 160, 160, [handles('GRADIENT_ANGULAR', RAINBOW, [0.5, 0.5], [1, 0.5], [0.5, 0])])
  rect(f, 'Wide', 220, 220, 160, 80, [plain('GRADIENT_ANGULAR', RAINBOW)])

  // Resized gradients: handles set on a square keep their unit-box places when the layer is widened
  f = frame(risks, 'Resized gradients', 440, 460)
  rect(f, 'Linear', 20, 20, 400, 200, [
    linear(
      [
        ['#FF006E', 0],
        ['#3A86FF', 1],
      ],
      [0, 0],
      [1, 1],
    ),
  ])
  rect(f, 'Radial', 20, 240, 400, 200, [
    handles(
      'GRADIENT_RADIAL',
      [
        ['#FFFFFF', 0],
        ['#8338EC', 1],
      ],
      [0.5, 0.5],
      [1, 0],
      [0.75, 0.75],
    ),
  ])

  // Skewed gradients: a group stretched in one direction skews its turned layers
  f = frame(risks, 'Skewed gradients', 600, 600)
  r = turn(
    rect(f, 'Slanted bar', 60, 60, 200, 100, [
      linear(
        [
          ['#FB5607', 0],
          ['#FFBE0B', 1],
        ],
        [0, 0.5],
        [1, 0.5],
      ),
    ]),
    30,
  )
  g = figma.group([r], f)
  g.name = 'Slant 1'
  g.resize(g.width * 1.6, g.height)
  r = turn(
    oval(f, 'Slanted oval', 340, 60, 160, 160, [
      plain('GRADIENT_RADIAL', [
        ['#FFFFFF', 0],
        ['#06D6A0', 1],
      ]),
    ]),
    45,
  )
  g = figma.group([r], f)
  g.name = 'Slant 2'
  g.resize(g.width, g.height * 2)
  t = turn(text(f, 'Skew', 'Skew', { ...bold, size: 64, x: 60, y: 380 }), 20)
  r = turn(rect(f, 'Box', 300, 380, 120, 80, [solid('#118AB2')]), 20)
  g = figma.group([t, r], f)
  g.name = 'Slant 3'
  g.resize(g.width * 1.5, g.height)

  // Turned shadow
  f = frame(risks, 'Turned shadow', 400, 400, '#F0F0F0')
  r = rect(f, 'Upright', 30, 30, 100, 100, [solid('#FFFFFF')])
  r.cornerRadius = 12
  r.effects = [shadow(16, 0, 8, 0, '#00000099')]
  r = rect(f, 'Turned', 160, 160, 160, 160, [solid('#FFFFFF')])
  r.cornerRadius = 16
  r.effects = [shadow(24, 0, 8, 0, '#00000099')]
  turn(r, 90)

  // Emoji run
  f = frame(risks, 'Emoji run', 400, 300)
  t = text(f, 'Wave', 'Hi 👋 there friend', { size: 40, x: 20, y: 40 })
  range(t, 'there', (s, e) => {
    t.setRangeFontName(s, e, bold)
    t.setRangeFills(s, e, [solid('#E63946')])
  })
  const two = text(f, 'Two emoji', '😀😀 ok then', { size: 40, x: 20, y: 160 })
  range(two, 'ok', (s, e) => {
    two.setRangeFontName(s, e, bold)
    two.setRangeFills(s, e, [solid('#2A9D8F')])
    two.setRangeTextDecoration(s, e, 'UNDERLINE')
  })

  // Nested group
  f = frame(risks, 'Nested group', 400, 400)
  const a = rect(f, 'A', 40, 40, 80, 80, [solid('#2A9D8F')])
  const b = rect(f, 'B', 200, 200, 80, 80, [solid('#E9C46A')])
  const c = oval(f, 'C', 300, 100, 60, 60, [solid('#F4A261')])
  const box = nested(f, 'Turned box', 60, 260, 120, 80, [solid('#264653')])
  turn(rect(box, 'D', 10, 10, 40, 40, [solid('#E76F51')]), 30)
  turn(box, 15)
  const inner = figma.group([b, c], f)
  inner.name = 'Inner'
  turn(inner, 20)
  const outer = figma.group([a, inner, box], f)
  outer.name = 'Outer'
  turn(outer, 10)

  // Flipped text
  f = frame(risks, 'Flipped text', 400, 400)
  const mirror = (name, y) => text(f, name, 'Mirror', { ...bold, size: 64, fill: '#1D3557', x: 40, y })
  flip(mirror('Left to right', 40), true)
  flip(mirror('Top to bottom', 160), false)
  flip(turn(mirror('Turned and flipped', 280), 30), true)

  // Flipped box
  f = frame(risks, 'Flipped box', 500, 400)
  const flipBox = (name, x, y) => {
    const n = nested(f, name, x, y, 200, 120, [
      linear(
        [
          ['#457B9D', 0],
          ['#A8DADC', 1],
        ],
        [0, 0.5],
        [1, 0.5],
      ),
    ])
    n.topLeftRadius = 24
    n.topRightRadius = 0
    n.bottomRightRadius = 0
    n.bottomLeftRadius = 0
    n.clipsContent = true
    rect(n, 'Marker', 10, 10, 60, 40, [solid('#E63946')])
    return n
  }
  flip(flipBox('Box flipped across', 20, 20), true)
  flip(flipBox('Box flipped down', 260, 20), false)
  flip(turn(flipBox('Box turned and flipped', 140, 220), 15), true)

  // Flipped image
  f = frame(risks, 'Flipped image', 560, 220)
  flip(rect(f, 'Across', 20, 30, 240, 160, [image('card-1', 'FILL')]), true)
  flip(rect(f, 'Down', 300, 30, 240, 160, [image('card-1', 'FILL')]), false)

  // Stretched image: Crop keeps the photo's shape, so each crop box is as tall as the layer's shape allows
  f = frame(risks, 'Stretched image', 560, 260)
  const { width: W, height: H } = await figma.getImageByHash(img.sneaker).getSizeAsync()
  const half = Math.min(1, (0.5 * W) / 1.5 / H)
  rect(f, 'Cropped', 20, 30, 300, 200, [
    image('sneaker', 'CROP', {
      imageTransform: [
        [0.5, 0, 0.5],
        [0, half, (1 - half) / 2],
      ],
    }),
  ])
  const third = Math.min(1, ((1 / 3) * H) / W)
  rect(f, 'Cropped and turned', 340, 30, 200, 200, [
    image('sneaker', 'CROP', {
      imageTransform: [
        [0, third, (1 - third) / 2],
        [-1 / 3, 0, 2 / 3],
      ],
    }),
  ])

  // Filters
  f = frame(risks, 'Filters', 560, 248)
  for (const [name, x, y, filters] of [
    ['None', 16, 16, null],
    ['Exposure', 152, 16, { exposure: 0.5 }],
    ['Contrast', 288, 16, { contrast: 0.5 }],
    ['Saturation', 424, 16, { saturation: -1 }],
    ['Temperature', 16, 132, { temperature: 0.5 }],
    ['Tint', 152, 132, { tint: 0.5 }],
    ['Highlights', 288, 132, { highlights: 0.5 }],
    ['Shadows', 424, 132, { shadows: -0.5 }],
  ])
    rect(f, name, x, y, 120, 100, [image('card-2', 'FILL', filters ? { filters } : {})])

  // Two masks: the same four layers in a group, then straight in a box
  f = frame(risks, 'Two masks', 840, 400)
  const four = (parent) => [
    oval(parent, 'Mask 1', 50, 50, 300, 300, [solid('#000000')]),
    rect(parent, 'Photo', 0, 0, 400, 400, [image('card-3', 'FILL')]),
    star(parent, 'Mask 2', 80, 80, 240, 5, 0.4, [solid('#000000')]),
    rect(parent, 'Band', 0, 100, 400, 200, [solid('#FF006E')]),
  ]
  const grouped = four(f)
  figma.group(grouped, f).name = 'Mask group'
  asMask(grouped[0])
  asMask(grouped[2])
  const boxed = four(nested(f, 'Masks box', 420, 0, 400, 400, []))
  asMask(boxed[0])
  asMask(boxed[2])

  // Hidden mask
  f = frame(risks, 'Hidden mask', 400, 400)
  const hidden = oval(f, 'Hidden mask', 100, 100, 200, 200, [solid('#000000')])
  rect(f, 'Photo', 0, 0, 400, 400, [image('card-3', 'FILL')])
  figma.group([...f.children], f).name = 'Group'
  hidden.isMask = true
  hidden.visible = false

  // Fixed text
  f = frame(risks, 'Fixed text', 400, 600)
  const fixed = (name, characters, style, align, w, h) => {
    const n = text(f, name, characters, style)
    n.textAutoResize = 'NONE'
    n.resize(w, h)
    n.textAlignHorizontal = align
    n.lineHeight = { unit: 'AUTO' }
  }
  fixed(
    'Wide',
    'The quick brown fox jumps over the lazy dog while the market opens at nine.',
    { size: 28, x: 20, y: 20 },
    'LEFT',
    300,
    200,
  )
  fixed(
    'Narrow',
    'Wrapping changes when widths change by a pixel.',
    { ...bold, size: 32, x: 20, y: 240 },
    'CENTER',
    180,
    260,
  )
  fixed(
    'Arabic',
    'النص العربي يلتف داخل مربع ثابت العرض',
    { family: ARABIC, size: 28, x: 220, y: 240 },
    'LEFT',
    160,
    260,
  )

  await figma.setCurrentPageAsync(themes)

  // Photo card ad
  f = frame(themes, 'Photo card ad', 1080, 1080, '#F4EFE6')
  r = rect(f, 'Card', 140, 140, 800, 800, [solid('#FFFFFF')])
  r.cornerRadius = 32
  r.effects = [shadow(0, 24, 48, 0, '#00000033')]
  r = rect(f, 'Photo', 140, 140, 800, 500, [image('sneaker', 'FILL')])
  r.topLeftRadius = 32
  r.topRightRadius = 32
  r.bottomRightRadius = 0
  r.bottomLeftRadius = 0
  t = text(f, 'Headline', 'Run lighter', { ...bold, size: 72, x: 200, y: 690 })
  t.letterSpacing = { unit: 'PIXELS', value: -1 }
  r = rect(f, 'Price pill', 720, 820, 220, 80, [solid('#FF5A36')])
  r.cornerRadius = 40
  r.effects = [{ ...shadow(0, -4, 8, 0, '#00000040'), type: 'INNER_SHADOW' }]
  const centred = (n, x, y, w, h) => {
    n.x = Math.round(x + (w - n.width) / 2)
    n.y = Math.round(y + (h - n.height) / 2)
  }
  centred(text(f, 'Price', '$89', { ...bold, size: 40, fill: '#FFFFFF' }), 720, 820, 220, 80)
  r = oval(f, 'Badge', 840, 80, 160, 160, [solid('#1A1A1A', 0.8)])
  r.effects = [shadow(0, 8, 16, 4, '#00000066', { showShadowBehindNode: true })]
  centred(text(f, 'Badge word', 'NEW', { ...bold, size: 36, fill: '#FFFFFF' }), 840, 80, 160, 160)
  r = rect(f, 'Cutout', 100, 760, 260, 260, [image('cutout', 'FIT')])
  r.effects = [shadow(12, 12, 20, 0, '#0000004D')]
  turn(r, -12)

  // Auto layout story
  f = auto(frame(themes, 'Auto layout story', 1080, 1920, '#0E1B2C'), 'VERTICAL', {
    padding: [96, 96, 96, 96],
    gap: 48,
  })
  f.primaryAxisSizingMode = 'FIXED'
  f.counterAxisSizingMode = 'FIXED'
  f.primaryAxisAlignItems = 'MIN'
  f.counterAxisAlignItems = 'MIN'
  t = text(f, 'Headline', 'Summer drop', { ...bold, size: 120, fill: '#FFFFFF' })
  t.lineHeight = { unit: 'PERCENT', value: 110 }
  t.letterSpacing = { unit: 'PIXELS', value: -2 }
  t.textAutoResize = 'HEIGHT'
  fillWidth(t)
  const body = text(f, 'Body', 'Three new colours, one weekend only. Free returns on everything.', {
    size: 44,
    fill: '#D9E2EC',
  })
  body.lineHeight = { unit: 'PIXELS', value: 64 }
  body.textAutoResize = 'HEIGHT'
  fillWidth(body)
  range(body, 'one weekend only', (s, e) => {
    body.setRangeFontName(s, e, bold)
    body.setRangeFills(s, e, [solid('#FFC83D')])
  })
  range(body, 'Free returns', (s, e) => body.setRangeTextDecoration(s, e, 'UNDERLINE'))
  range(body, 'everything', (s, e) => body.setRangeFontSize(s, e, 56))
  const tags = auto(nested(f, 'Tags', null, null, null, null, []), 'HORIZONTAL', { gap: 24 })
  tags.layoutWrap = 'WRAP'
  tags.counterAxisSpacing = 16
  fillWidth(tags).layoutSizingVertical = 'HUG'
  for (const word of ['Linen', 'Sand', 'Olive', 'Clay', 'Midnight']) {
    const tag = auto(nested(tags, word, null, null, null, null, [solid('#FFFFFF', 0.1)]), 'HORIZONTAL', {
      padding: [16, 28, 16, 28],
    })
    tag.cornerRadius = 999
    text(tag, word, word, { size: 36, fill: '#FFFFFF' })
    hug(tag)
  }
  const cards = nested(f, 'Cards', null, null, null, null, [])
  cards.layoutMode = 'GRID'
  cards.gridColumnCount = 2
  cards.gridRowCount = 2
  cards.gridColumnGap = 24
  cards.gridRowGap = 32
  fillWidth(cards).layoutSizingVertical = 'HUG'
  for (let i = 1; i <= 4; i++) {
    const card = rect(cards, `Card ${i}`, null, null, 200, 200, [solid('#23364F')])
    card.cornerRadius = 24
    fillWidth(card)
  }
  t = text(f, 'Small caps', 'limited stock', { size: 36, fill: '#FFC83D' })
  t.letterSpacing = { unit: 'PIXELS', value: 2 }
  t.textCase = 'SMALL_CAPS'
  t = text(f, 'Truncated', 'Ends Sunday at midnight, while stock lasts, in every store we run', {
    size: 36,
    fill: '#D9E2EC',
  })
  t.textAutoResize = 'HEIGHT'
  fillWidth(t)
  t.textTruncation = 'ENDING'
  t.maxLines = 1
  text(f, 'Arabic', 'تخفيضات الصيف', { family: ARABIC, size: 56, fill: '#FFFFFF' }).textAlignHorizontal = 'LEFT'
  const button = auto(nested(f, 'Button', null, null, null, null, [solid('#FFC83D')]), 'HORIZONTAL', {
    padding: [28, 56, 28, 56],
  })
  button.primaryAxisAlignItems = 'CENTER'
  button.counterAxisAlignItems = 'CENTER'
  button.cornerRadius = 999
  text(button, 'Shop now', 'Shop now', { ...bold, size: 44, fill: '#0E1B2C' })
  hug(button).minWidth = 360
  const sticker = oval(f, 'Sticker', null, null, 160, 160, [solid('#FF5A36')])
  sticker.layoutPositioning = 'ABSOLUTE'
  sticker.x = 860
  sticker.y = 60

  // Vectors and masks
  f = frame(themes, 'Vectors and masks', 1080, 1080)
  r = vector(
    f,
    'Wave',
    40,
    60,
    'M 0 60 C 44 -20 89 -20 133 60 C 178 140 222 140 267 60 C 311 -20 356 -20 400 60',
    'NONE',
  )
  r.fills = []
  r.strokes = [solid('#2B59C3')]
  r.strokeWeight = 12
  r.strokeCap = 'ROUND'
  r = vector(f, 'Cup', 520, 60, 'M 0 0 L 0 110 C 0 138 22 160 50 160 L 190 160 C 218 160 240 138 240 110 L 240 0')
  r.fills = [solid('#FFD166')]
  r.strokes = [solid('#073B4C')]
  r.strokeWeight = 8
  // The layer's fill first: setting fills afterwards would paint over each region's own fill
  r = put(f, figma.createVector(), 'Regions')
  r.fills = [solid('#CCCCCC')]
  r.strokes = []
  await r.setVectorNetworkAsync({
    vertices: [
      [0, 0],
      [100, 0],
      [200, 0],
      [200, 200],
      [100, 200],
      [0, 200],
    ].map(([x, y]) => ({ x, y })),
    segments: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      [1, 4],
    ].map(([start, end]) => ({ start, end })),
    regions: [
      { windingRule: 'NONZERO', loops: [[0, 6, 4, 5]], fills: [solid('#EF476F')] },
      { windingRule: 'NONZERO', loops: [[1, 2, 3, 6]], fills: [solid('#CCCCCC')] },
    ],
  })
  r.x = 820
  r.y = 40
  turn(star(f, 'Star', 40, 300, 200, 7, 0.45, [solid('#EF476F')]), 20)
  r = put(f, figma.createPolygon(), 'Hexagon', 300, 300, 200, 200)
  r.pointCount = 6
  r.fills = [solid('#118AB2')]
  flip(turn(r, 30), true)
  g = figma.subtract(
    [
      oval(f, 'Ellipse', 560, 300, 240, 240, [solid('#06D6A0')]),
      oval(f, 'Ellipse', 640, 320, 160, 160, [solid('#06D6A0')]),
    ],
    f,
  )
  g.name = 'Crescent'
  g.fills = [solid('#06D6A0')]
  g = figma.union(
    [
      rect(f, 'Rectangle', 820, 390, 200, 60, [solid('#FFD166')]),
      turn(rect(f, 'Rectangle', 890, 320, 60, 200, [solid('#FFD166')]), 15),
    ],
    f,
  )
  g.name = 'Cross'
  g.fills = [solid('#FFD166')]
  g = figma.exclude(
    [
      rect(f, 'Rectangle', 40, 580, 260, 160, [solid('#073B4C')]),
      text(f, 'AB', 'AB', { ...bold, size: 160, x: 60, y: 570 }),
    ],
    f,
  )
  g.name = 'Letters'
  g.fills = [solid('#073B4C')]
  const small = star(f, 'Star', 340, 600, 120, 5, 0.4, [
    linear(
      [
        ['#8338EC', 0],
        ['#FF006E', 1],
      ],
      [0, 0.5],
      [1, 0.5],
    ),
  ])
  r = vector(f, 'Wave', 480, 630, 'M 0 30 C 18 -10 35 -10 53 30 C 71 70 89 70 107 30 C 124 -10 142 -10 160 30', 'NONE')
  r.fills = []
  r.strokes = [solid('#8338EC')]
  r.strokeWeight = 8
  g = figma.group([small, r], f)
  g.name = 'Mirrored pair'
  flip(g, true)
  turn(vector(f, 'Turned path', 740, 600, 'M 0 30 L 120 30 L 120 0 L 200 50 L 120 100 L 120 70 L 0 70 Z'), 45).fills = [
    solid('#E76F51'),
  ]
  const circle = oval(f, 'Ellipse', 40, 760, 300, 300, [solid('#000000')])
  g = figma.group([circle, rect(f, 'Photo', 0, 760, 400, 300, [image('sneaker', 'FILL')])], f)
  g.name = 'Masked photo'
  asMask(circle)
  const fade = rect(f, 'Fade', 600, 780, 400, 280, [
    linear(
      [
        ['#FFFFFF', 0],
        ['#000000', 1],
      ],
      [0, 0.5],
      [1, 0.5],
    ),
  ])
  g = figma.group([fade, rect(f, 'Photo', 600, 780, 400, 280, [image('card-1', 'FILL')])], f)
  g.name = 'Faded photo'
  asMask(fade, 'LUMINANCE')

  // Gradients and images
  f = frame(themes, 'Gradients and images', 1080, 1080)
  rect(f, 'Oval radial', 40, 40, 400, 200, [
    plain('GRADIENT_RADIAL', [
      ['#FFFFFF', 0],
      ['#3A0CA3', 1],
    ]),
  ])
  rect(f, 'Skewed linear', 520, 40, 400, 200, [
    linear(
      [
        ['#F72585', 0],
        ['#4CC9F0', 1],
      ],
      [0, 0],
      [1, 1],
    ),
  ])
  rect(f, 'Skewed radial', 40, 300, 400, 200, [
    handles(
      'GRADIENT_RADIAL',
      [
        ['#FFFFFF', 0],
        ['#F72585', 1],
      ],
      [0.5, 0.5],
      [1, 0],
      [0.75, 0.75],
    ),
  ])
  oval(f, 'Angular', 520, 300, 200, 200, [
    handles(
      'GRADIENT_ANGULAR',
      [
        ['#F72585', 0],
        ['#4CC9F0', 0.5],
        ['#F72585', 1],
      ],
      [0.5, 0.5],
      [0.5, 0],
      [1, 0.5],
    ),
  ])
  rect(f, 'Diamond', 780, 300, 200, 200, [
    plain('GRADIENT_DIAMOND', [
      ['#FFFFFF', 0],
      ['#7209B7', 1],
    ]),
  ])
  rect(f, 'Gradient stack', 40, 560, 400, 200, [
    image('card-2', 'FILL'),
    linear(
      [
        ['#00000000', 0],
        ['#000000CC', 1],
      ],
      [0.5, 0],
      [0.5, 1],
    ),
  ])
  rect(f, 'Tiles', 520, 560, 400, 300, [image('tile', 'TILE', { scalingFactor: 0.5 })])
  rect(f, 'Fitted', 40, 820, 300, 200, [solid('#E0E0E0'), image('cutout', 'FIT')])
  r = oval(f, 'Gradient stroke', 520, 860, 200, 200, [])
  r.strokes = [
    linear(
      [
        ['#F72585', 0],
        ['#4CC9F0', 1],
      ],
      [0, 0.5],
      [1, 0.5],
    ),
  ]
  r.strokeWeight = 16
  r.strokeAlign = 'INSIDE'

  // Components, sections and loose layers
  const component = put(themes, figma.createComponent(), 'Button', nextX(themes), 0, 320, 100)
  auto(component, 'HORIZONTAL', { padding: [24, 24, 24, 24] })
  component.primaryAxisSizingMode = 'FIXED'
  component.counterAxisSizingMode = 'FIXED'
  component.primaryAxisAlignItems = 'CENTER'
  component.counterAxisAlignItems = 'CENTER'
  component.fills = [solid('#2B59C3')]
  component.cornerRadius = 16
  text(component, 'Buy', 'Buy', { ...bold, size: 40, fill: '#FFFFFF' })
  const copy = put(themes, component.createInstance(), 'Button copy', nextX(themes), 0)
  copy.findOne((n) => n.type === 'TEXT').characters = 'Buy now'

  f = frame(themes, 'Components', 1080, 1080)
  put(f, component.createInstance(), null, 40, 40).fills = [solid('#EF476F')]
  put(f, figma.createSlice(), 'Slice', 400, 40, 300, 300)
  rect(f, 'Pinned', 40, 300, 200, 200, [solid('#118AB2')]).constraints = { horizontal: 'MAX', vertical: 'MAX' }
  const overflow = nested(f, 'Overflow', 820, 300, 300, 200, [solid('#FFD166')])
  overflow.clipsContent = false
  rect(overflow, 'Past the edge', 200, 150, 200, 100, [solid('#073B4C')])
  r = rect(f, 'Locked', 40, 600, 200, 100, [solid('#06D6A0')])
  r.blendMode = 'MULTIPLY'
  r.locked = true
  text(f, 'Corner', 'Corner', { size: 32, x: 300, y: 600 }).blendMode = 'LINEAR_BURN'
  // createTextPath puts the new text on the page, so it is moved back into the frame
  const curve = vector(f, 'Text path', 40, 800, 'M 0 100 C 100 0 300 0 400 100', 'NONE')
  curve.fills = []
  const onPath = figma.createTextPath(curve, 0, 0)
  onPath.fontName = { family: 'Noto Sans', style: 'Regular' }
  onPath.characters = 'Text along a curve'
  onPath.fontSize = 32
  onPath.fills = [solid('#1A1A1A')]
  put(f, onPath, null, 40, 800)

  const section = put(themes, figma.createSection(), 'Section', nextX(themes), 0)
  section.resizeWithoutConstraints(1000, 600)
  for (const [name, x, fill] of [
    ['In section A', 67, '#F4A261'],
    ['In section B', 533, '#2A9D8F'],
  ])
    nested(section, name, x, 100, 400, 400, [solid(fill)])

  const looseX = nextX(themes)
  rect(themes, 'Loose box', looseX, 0, 200, 200, [solid('#E63946')])
  text(themes, 'Loose', 'Loose', { ...bold, size: 48, x: looseX + 240, y: 70 })

  f = frame(themes, 'Hidden frame', 400, 400)
  rect(f, 'Rectangle', 100, 100, 200, 200, [solid('#2B59C3')])
  f.visible = false
  f = frame(themes, 'Locked frame', 400, 400)
  oval(f, 'Ellipse', 100, 100, 200, 200, [solid('#2A9D8F')])
  f.locked = true
  f = frame(themes, 'Turned frame', 400, 300)
  rect(f, 'Rectangle', 100, 100, 200, 100, [solid('#118AB2')])
  turn(f, 15)
  f = frame(themes, 'Small frame', 24, 24)
  oval(f, 'Ellipse', 4, 4, 16, 16, [solid('#E63946')])
  f = frame(themes, 'Wide frame', 2000, 100, '#FFD166')
  text(f, null, 'A banner twenty times as wide as it is tall', { ...bold, size: 48, x: 40, y: 20 })
  f = frame(themes, 'Tall frame', 1440, 9000, '#F0F0F0')
  rect(f, 'Top', 100, 100, 1240, 200, [solid('#2B59C3')])
  rect(f, 'Bottom', 100, 8700, 1240, 200, [solid('#2B59C3')])
  f = frame(themes, 'Unnamed frame', 200, 200)
  rect(f, 'Rectangle', 50, 50, 100, 100, [solid('#8338EC')])
  f.name = ''

  figma.viewport.scrollAndZoomIntoView(themes.children)
  figma.notify('Dazbee recording built')
})()
