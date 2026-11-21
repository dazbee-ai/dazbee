// Draws the stand-in photos the fixtures name and saves them in assets/: as JPEG, or as PNG for a
// cutout, whose clear pixels need alpha.
// They are committed; rerun only to change them: node scripts/make-assets.ts [name ...] (only those named).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Canvas, CanvasKit } from '@dazbee/canvaskit'
import { FONT_FILES_DIR } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'

type Painter = (canvas: Canvas, w: number, h: number) => void

const ASSETS_DIR = join(import.meta.dirname, '..', 'assets')
const ck: CanvasKit = await loadCanvasKit()

const paint = (setup: (p: InstanceType<CanvasKit['Paint']>) => void) => {
  const p = new ck.Paint()
  p.setAntiAlias(true)
  setup(p)
  return p
}
const linear = (x0: number, y0: number, x1: number, y1: number, colors: string[]) =>
  ck.Shader.MakeLinearGradient(
    [x0, y0],
    [x1, y1],
    colors.map((c) => ck.parseColorString(c)),
    null,
    ck.TileMode.Clamp,
  )
const radial = (x: number, y: number, r: number, colors: string[]) =>
  ck.Shader.MakeRadialGradient(
    [x, y],
    r,
    colors.map((c) => ck.parseColorString(c)),
    null,
    ck.TileMode.Clamp,
  )

const studio =
  (top: string, bottom: string, spot: string): Painter =>
  (canvas, w, h) => {
    canvas.drawPaint(paint((p) => p.setShader(linear(0, 0, 0, h, [top, bottom]))))
    canvas.drawPaint(paint((p) => p.setShader(radial(w * 0.5, h * 0.45, h * 0.7, [spot, 'rgba(255,255,255,0)']))))
    canvas.drawOval(
      ck.XYWHRect(w * 0.18, h * 0.78, w * 0.64, h * 0.08),
      paint((p) => {
        p.setColor(ck.Color(0, 0, 0, 0.25))
        p.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, 18, true))
      }),
    )
  }

const sneaker: Painter = (canvas, w, h) => {
  studio('#FFE8D1', '#F2B48C', 'rgba(255,255,255,0.8)')(canvas, w, h)
  shoe(canvas, w, h)
}

/** The sneaker on clear, as a product's cutout is: a PNG with its soft shadow under it. */
const sneakerCutout: Painter = (canvas, w, h) => {
  canvas.drawOval(
    ck.XYWHRect(w * 0.12, h * 0.655, w * 0.76, h * 0.06),
    paint((p) => {
      p.setColor(ck.Color(0, 0, 0, 0.3))
      p.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, 14, true))
    }),
  )
  canvas.save()
  canvas.translate(-286, -374)
  canvas.scale(1.4, 1.4)
  shoe(canvas, w, h)
  canvas.restore()
}

/** The sneaker's upper, sole and stripe. */
function shoe(canvas: Canvas, w: number, h: number) {
  const s = h / 1200
  canvas.save()
  canvas.translate(w * 0.2, h * 0.3)
  canvas.scale(s, s)
  const sole = ck.Path.MakeFromSVGString('M0 520 C 40 600 1100 640 1180 560 L 1180 500 L 0 470 Z')
  const upper = ck.Path.MakeFromSVGString(
    'M40 480 C 60 300 260 180 420 170 C 520 250 640 300 820 320 C 1020 340 1160 420 1180 500 L 40 500 Z',
  )
  const swoosh = ck.Path.MakeFromSVGString('M300 420 C 520 470 820 420 1060 330 C 860 470 560 520 300 420 Z')
  if (!sole || !upper || !swoosh) throw new Error('bad sneaker path')
  canvas.drawPath(
    upper,
    paint((p) => p.setShader(linear(0, 170, 0, 500, ['#2E6BFF', '#123A9C']))),
  )
  canvas.drawPath(
    sole,
    paint((p) => p.setColor(ck.parseColorString('#F7F7F2'))),
  )
  canvas.drawPath(
    swoosh,
    paint((p) => p.setColor(ck.parseColorString('#FF5A36'))),
  )
  for (let i = 0; i < 6; i++) {
    canvas.drawCircle(
      470 + i * 46,
      250 + i * 18,
      9,
      paint((p) => p.setColor(ck.parseColorString('#FFFFFF'))),
    )
  }
  canvas.restore()
}

const card =
  (top: string, bottom: string, shape: string): Painter =>
  (canvas, w, h) => {
    studio(top, bottom, 'rgba(255,255,255,0.6)')(canvas, w, h)
    canvas.drawCircle(
      w * 0.5,
      h * 0.48,
      Math.min(w, h) * 0.26,
      paint((p) => p.setShader(radial(w * 0.44, h * 0.4, Math.min(w, h) * 0.3, ['#FFFFFF', shape]))),
    )
    canvas.drawRect(
      ck.XYWHRect(w * 0.08, h * 0.08, w * 0.12, h * 0.02),
      paint((p) => p.setColor(ck.parseColorString(shape))),
    )
  }

/**
 * A brand's logo, as a PNG on clear: a round mark, an orange disc with three speed bars, and the word "stride" in
 * Noto Sans ExtraBold.
 */
const logo: Painter = (canvas, w, h) => {
  const r = h * 0.44
  canvas.drawCircle(
    h / 2,
    h / 2,
    r,
    paint((p) => p.setColor(ck.parseColorString('#FF5A36'))),
  )
  for (let i = 0; i < 3; i++) {
    const bar = ck.Path.MakeFromSVGString(
      `M${h * 0.3 + i * h * 0.06} ${h * 0.3 + i * h * 0.13} L${h * 0.72} ${h * 0.3 + i * h * 0.13} L${h * 0.68} ${h * 0.38 + i * h * 0.13} L${h * 0.26 + i * h * 0.06} ${h * 0.38 + i * h * 0.13} Z`,
    )
    if (!bar) throw new Error('bad logo bar')
    canvas.drawPath(
      bar,
      paint((p) => p.setColor(ck.parseColorString('#FFFFFF'))),
    )
  }
  const fonts = ck.TypefaceFontProvider.Make()
  fonts.registerFont(new Uint8Array(readFileSync(join(FONT_FILES_DIR, 'NotoSans-ExtraBold.ttf'))), 'Noto Sans')
  const style = new ck.ParagraphStyle({
    textStyle: {
      color: ck.parseColorString('#14213D'),
      fontFamilies: ['Noto Sans'],
      fontSize: h * 0.66,
      fontStyle: { weight: ck.FontWeight.ExtraBold },
      letterSpacing: -h * 0.02,
    },
  })
  const builder = ck.ParagraphBuilder.MakeFromFontProvider(style, fonts)
  builder.addText('stride')
  const words = builder.build()
  words.layout(w)
  canvas.drawParagraph(words, h * 1.08, (h - words.getHeight()) / 2)
  words.delete()
  builder.delete()
  fonts.delete()
}

/** A person's portrait for a quote, drawn: a head and shoulders on a soft studio ground. */
const portrait: Painter = (canvas, w, h) => {
  studio('#E8EEF7', '#B8C6DB', 'rgba(255,255,255,0.7)')(canvas, w, h)
  const shoulders = ck.Path.MakeFromSVGString(
    `M${w * 0.14} ${h} C ${w * 0.16} ${h * 0.74} ${w * 0.32} ${h * 0.66} ${w * 0.5} ${h * 0.66} C ${w * 0.68} ${h * 0.66} ${w * 0.84} ${h * 0.74} ${w * 0.86} ${h} Z`,
  )
  if (!shoulders) throw new Error('bad shoulders')
  canvas.drawPath(
    shoulders,
    paint((p) => p.setShader(linear(0, h * 0.66, 0, h, ['#2F4B7C', '#1B2C4A']))),
  )
  canvas.drawRect(
    ck.XYWHRect(w * 0.44, h * 0.52, w * 0.12, h * 0.16),
    paint((p) => p.setColor(ck.parseColorString('#C98B62'))),
  )
  canvas.drawOval(
    ck.XYWHRect(w * 0.33, h * 0.2, w * 0.34, h * 0.4),
    paint((p) => p.setShader(radial(w * 0.45, h * 0.35, w * 0.25, ['#E3A985', '#C98B62']))),
  )
  canvas.drawArc(
    ck.XYWHRect(w * 0.31, h * 0.16, w * 0.38, h * 0.3),
    180,
    180,
    true,
    paint((p) => p.setColor(ck.parseColorString('#2B1D16'))),
  )
}

/** A small repeating tile, for the tile fit (#48): a dot on a two-tone ground, cut by a stripe. */
const pattern: Painter = (canvas, w, h) => {
  canvas.drawPaint(paint((p) => p.setColor(ck.parseColorString('#FFD23F'))))
  canvas.drawRect(
    ck.XYWHRect(0, 0, w / 2, h / 2),
    paint((p) => p.setColor(ck.parseColorString('#FF48B0'))),
  )
  canvas.drawRect(
    ck.XYWHRect(w / 2, h / 2, w / 2, h / 2),
    paint((p) => p.setColor(ck.parseColorString('#3D6BFF'))),
  )
  canvas.drawCircle(
    w / 2,
    h / 2,
    w * 0.18,
    paint((p) => p.setColor(ck.parseColorString('#15121A'))),
  )
}

/** A cutout, as a PNG: a lemon with a leaf on clear, its edges soft. */
const lemon: Painter = (canvas, w, h) => {
  canvas.drawOval(
    ck.XYWHRect(w * 0.1, h * 0.25, w * 0.8, h * 0.6),
    paint((p) => p.setShader(radial(w * 0.4, h * 0.45, w * 0.5, ['#FFF59D', '#FBC02D']))),
  )
  const leaf = ck.Path.MakeFromSVGString(
    `M${w * 0.5} ${h * 0.28} C ${w * 0.55} ${h * 0.05} ${w * 0.8} ${h * 0.05} ${w * 0.85} ${h * 0.1} C ${w * 0.8} ${h * 0.25} ${w * 0.6} ${h * 0.3} ${w * 0.5} ${h * 0.28} Z`,
  )
  if (!leaf) throw new Error('bad leaf path')
  canvas.drawPath(
    leaf,
    paint((p) => p.setColor(ck.parseColorString('#43A047'))),
  )
}

const assets: Record<string, [number, number, Painter, ('jpg' | 'png')?]> = {
  sneaker: [1920, 1200, sneaker],
  'card-1': [1600, 1040, card('#E3F2FD', '#90CAF9', '#1E88E5')],
  'card-2': [1600, 1040, card('#FCE4EC', '#F48FB1', '#D81B60')],
  'card-3': [1600, 1040, card('#E8F5E9', '#A5D6A7', '#43A047')],
  'card-1-tall': [1200, 1000, card('#E3F2FD', '#90CAF9', '#1E88E5')],
  tile: [120, 120, pattern],
  cutout: [400, 400, lemon, 'png'],
  'sneaker-cutout': [1200, 800, sneakerCutout, 'png'],
  logo: [600, 160, logo, 'png'],
  portrait: [800, 800, portrait],
}

const only = process.argv.slice(2)
for (const [id, [w, h, draw, type = 'jpg']] of Object.entries(assets)) {
  if (only.length > 0 && !only.includes(id)) continue
  const surface = ck.MakeSurface(w, h)
  if (!surface) throw new Error(`no ${w}×${h} surface`)
  draw(surface.getCanvas(), w, h)
  const snapshot = surface.makeImageSnapshot()
  const bytes = type === 'png' ? snapshot.encodeToBytes() : snapshot.encodeToBytes(ck.ImageFormat.JPEG, 82)
  if (!bytes) throw new Error(`could not encode ${id}`)
  writeFileSync(join(ASSETS_DIR, `${id}.${type}`), bytes)
  surface.delete()
  console.log(`${id}.${type} ${w}×${h} ${bytes.length} bytes`)
}
