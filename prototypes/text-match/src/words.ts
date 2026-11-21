// PROTOTYPE. Words the samples are set in: everyday English and ad words, Arabic and Hindi words,
// prices and numbers. The test ads' own words are not used, so no sample shows a test text.
import type { Script } from './catalogue.ts'

const LATIN = `the and for you your with our new now get more best free off save shop sale today only all
this from just time day week life home love good great fresh easy fast real taste style power
smart care pure natural made simple better every way open year world city light dark gold summer
winter spring autumn deal offer limited join book order call learn discover explore start try find
quality premium organic healthy beauty skin coffee bread pizza burger travel hotel flight beach
mountain coffee tea wine music party night club event festival concert ticket game play sport team
run fitness yoga studio class course school money bank card loan pay invest crypto secure trust
family kids baby pet dog cat garden house design fashion shoes bag watch phone laptop tech cloud
app download update service support delivery express market store brand original classic modern
vintage luxury comfort warm cool soft bold bright clean green blue red black white pink orange
special exclusive welcome hello thank holiday weekend morning evening lunch dinner breakfast menu
kitchen recipe flavour sweet spicy crispy juicy creamy golden handmade local craft studio gallery
art photo film story news magazine journal guide tips ideas inspire create build grow change move
dream believe enjoy celebrate share connect follow visit meet stay relax refresh restore glow
quick zero plus extra super mega ultra pro max mini daily monthly annual members rewards points`
  .split(/\s+/)
  .filter(Boolean)

const ARABIC = `مرحبا عرض خاص خصم جديد الآن تسوق اليوم مجانا أفضل سعر قهوة طعام لذيذ سفر فندق رحلة صيف
شتاء عائلة بيت تصميم أزياء جمال طبيعي متجر توصيل سريع اشترك احجز اتصل اكتشف جودة فاخر عروض
نهاية الأسبوع مساء صباح حفلة موسيقى رياضة صحة بنك بطاقة ادفع آمن ثقة هدية تخفيضات كبرى`
  .split(/\s+/)
  .filter(Boolean)

const DEVANAGARI = `नमस्ते नया ऑफर आज छूट मुफ्त सबसे अच्छा खरीदें दुकान कॉफी खाना स्वादिष्ट यात्रा होटल गर्मी
सर्दी परिवार घर डिज़ाइन फैशन सुंदर प्राकृतिक डिलीवरी तेज़ बुक करें कॉल खोजें गुणवत्ता प्रीमियम सप्ताहांत
सुबह शाम पार्टी संगीत खेल स्वास्थ्य बैंक कार्ड भुगतान सुरक्षित भरोसा उपहार बड़ी बचत त्योहार दिवाली`
  .split(/\s+/)
  .filter(Boolean)

/** A small seeded random number generator (mulberry32), so samples can be made again. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!

function latinWord(r: () => number): string {
  const u = r()
  if (u < 0.08) return `$${Math.floor(r() * 200)}${r() < 0.5 ? '.99' : ''}`
  if (u < 0.13) return `${Math.floor(r() * 90) + 10}%`
  if (u < 0.17) return `${Math.floor(r() * 9000) + 100}`
  return pick(r, LATIN)
}

/** A line of 1 to `most` words in a script, in a random case for Latin. */
export function line(r: () => number, script: Script, most = 4): string {
  const n = 1 + Math.floor(r() * most)
  const words = Array.from({ length: n }, () =>
    script === 'arabic' ? pick(r, ARABIC) : script === 'devanagari' ? pick(r, DEVANAGARI) : latinWord(r),
  )
  let text = words.join(' ')
  if (script === 'latin') {
    const c = r()
    if (c < 0.3) text = text.toUpperCase()
    else if (c < 0.65) text = text.replace(/\b\p{L}/gu, (m) => m.toUpperCase())
    else if (c < 0.8) text = text.charAt(0).toUpperCase() + text.slice(1)
    if (r() < 0.1) text += pick(r, ['!', '.', '?', ':'])
  }
  return text
}
