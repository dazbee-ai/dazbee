// PROTOTYPE. Checks CIEDE2000 against pairs from Sharma, Wu and Dalal's test data.
import { ciede2000 } from './score.ts'
const pairs: [number[], number[], number][] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
]
for (const [a, b, want] of pairs) {
  const got = ciede2000(a, b)
  console.log(got.toFixed(4), want, Math.abs(got - want) < 1e-4 ? 'ok' : 'WRONG')
}
