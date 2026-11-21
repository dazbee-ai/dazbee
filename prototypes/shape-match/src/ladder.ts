// PROTOTYPE. The Light-then-Medium ladder, from the measured runs: a block takes Light's answer when
// Light makes it shapes in at most two layers; otherwise Medium runs too, and the block takes
// Medium's answer when it is shapes in fewer layers (or Light's isn't shapes). Its time is Light's,
// plus Medium's when Medium ran.
import { load, q } from './summary.ts'

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
for (const [name, lp, mp, key] of [
  ['test-ad', 'out/testads-light.jsonl', 'out/testads-medium.jsonl', (r: Record<string, unknown>) => `${r.ad}/${r.file}`],
  [
    'synthetic held-out',
    'out/synth-light-test.jsonl',
    'out/synth-medium-test.jsonl',
    (r: Record<string, unknown>) => String(r.id),
  ],
] as const) {
  const L = load(lp)
  const M = new Map(load(mp).map((r) => [key(r), r]))
  const rows = L.map((l) => {
    const m = M.get(key(l))!
    const lightDone = l.decision === 'shapes' && l.layers <= 2
    const mediumBetter = m.decision === 'shapes' && (l.decision !== 'shapes' || m.layers < l.layers)
    const useLight = lightDone || !mediumBetter
    const pick = useLight ? l : m
    return { ...pick, ms: l.ms + (lightDone ? 0 : m.ms), light: useLight }
  })
  const by = (kinds: string[] | null) => {
    const rs = kinds ? rows.filter((r) => kinds.includes(String(r.kind))) : rows
    const shapes = rs.filter((r) => r.decision === 'shapes')
    return {
      n: rs.length,
      shapes: shapes.length,
      layers: mean(shapes.map((r) => r.layers)).toFixed(2),
      lightOnly: rs.filter((r) => r.light).length,
      msMedian: q(
        rs.map((r) => r.ms),
        0.5,
      ).toFixed(0),
      msP95: q(
        rs.map((r) => r.ms),
        0.95,
      ).toFixed(0),
    }
  }
  if (name === 'test-ad') {
    console.log(name, 'shape blocks', JSON.stringify(by(['shape', 'graphic', 'background'])))
    console.log(name, 'photo+cutout', JSON.stringify(by(['photo', 'cutout'])))
    const perAd = new Map<string, number>()
    for (const r of rows.filter((r) => ['shape', 'graphic', 'background'].includes(String(r.kind))))
      perAd.set(String(r.ad), (perAd.get(String(r.ad)) ?? 0) + r.ms)
    const ads = [...perAd.values()]
    console.log(
      name,
      'per ad ms',
      JSON.stringify({
        median: q(ads, 0.5).toFixed(0),
        p95: q(ads, 0.95).toFixed(0),
        max: Math.max(...ads).toFixed(0),
      }),
    )
  } else {
    const truthShapes = rows.filter((r) => r.truth === 'shapes')
    const ious = truthShapes.filter((r) => r.decision === 'shapes').map((r) => r.iou as number)
    console.log(
      name,
      JSON.stringify({
        lookSame: `${truthShapes.filter((r) => r.decision === 'shapes').length}/${truthShapes.length}`,
        shapedWrong: rows.filter((r) => r.truth === 'picture' && r.decision === 'shapes').length,
        iou: mean(ious).toFixed(3),
        iouP10: q(ious, 0.1).toFixed(3),
        layers: mean(rows.filter((r) => r.decision === 'shapes').map((r) => r.layers)).toFixed(2),
        lightOnly: rows.filter((r) => r.light).length,
        msMedian: q(
          rows.map((r) => r.ms),
          0.5,
        ).toFixed(0),
        msP95: q(
          rows.map((r) => r.ms),
          0.95,
        ).toFixed(0),
        snaps: `${rows.reduce((a, r) => a + (r.snapsRight as number), 0)}/${rows.reduce((a, r) => a + (r.snapsWanted as number), 0)}`,
        wrongSnaps: rows.reduce((a, r) => a + (r.snapsWrong as number), 0),
      }),
    )
  }
}
