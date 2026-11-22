// The ad topics an illustration is found by beside its own words: each topic with the words in a scene's name or
// keywords that put the scene in it, so "food" finds a scene named "breakfast" and "payment" one named "mobile pay".

/** Each topic, and the words that put a scene in it, parted by spaces; a topic's own word puts a scene in it too. */
const TOPICS: Readonly<Record<string, string>> = {
  delivery: [
    'deliver delivered deliveries courier package packages parcel shipping shipment truck logistics',
    'mailbox warehouse',
  ].join(' '),
  payment: [
    'pay paid payments paying credit card cards wallet checkout cash money bank banking invoice bill',
    'bills transaction transfer bitcoin crypto coin coins finance savings purchase pos receipt salary',
  ].join(' '),
  team: [
    'teams teamwork coworkers co-workers colleagues collaboration collaborate collaborating meeting',
    'together group partners partnership community brainstorming conference workshop',
  ].join(' '),
  shopping: [
    'shop shops store cart buy buying bag bags ecommerce e-commerce sale sales discount product products',
    'retail boutique market supermarket grocery groceries fashion clothes wishlist',
  ].join(' '),
  food: [
    'eat eating breakfast lunch dinner meal meals cooking cook chef kitchen recipe recipes pizza burger',
    'coffee tea cake bakery bread fruit fruits vegetables vegan restaurant barbecue bbq snack dessert',
    'ice-cream cream ramen steak sushi donut picnic diet nutrition groceries cafe',
  ].join(' '),
  travel: [
    'trip travelling traveling traveler journey airplane plane flight flying airport passport luggage',
    'suitcase vacation beach hiking hike tourist tourism map maps explore exploring adventure camping',
    'camp train destination landmark sightseeing road boarding hotel mountain mountains sea island',
    'backpack',
  ].join(' '),
  fitness: [
    'workout gym exercise exercising yoga running run runner jogging training sport sports cycling bike',
    'bicycle stretching weight weights dumbbell weightlifting swimming basketball football soccer tennis',
    'baseball boxing skateboard skating surfing athlete marathon strength muscle active',
  ].join(' '),
  health: [
    'healthy medical medicine doctor doctors nurse hospital healthcare care wellness mental meditation',
    'meditating vaccine pill pills pharmacy dentist sleep therapy mindfulness self-care',
  ].join(' '),
  celebration: [
    'celebrate celebrating celebrations party birthday gift gifts present presents confetti festival',
    'christmas xmas new-year anniversary wedding cheers balloon balloons fireworks winner congratulations',
    'halloween valentine easter achievement champion trophy',
  ].join(' '),
  app: [
    'apps application mobile phone smartphone iphone android tablet ui ux interface screen website web',
    'online download notification notifications dashboard login chat messaging browser digital software',
    'social',
  ].join(' '),
  learning: [
    'learn education study studying student students school teacher teaching book books reading read',
    'course courses class classroom graduation graduate exam knowledge library university college lesson',
    'tutorial webinar homework',
  ].join(' '),
  work: [
    'working office desk business job jobs career remote freelancer laptop productivity productive',
    'presentation startup entrepreneur manager interview hiring employee coworking deadline project tasks',
    'task agreement contract',
  ].join(' '),
  home: 'house apartment living room cozy family moving interior furniture garden',
  pets: 'pet dog dogs cat cats puppy animal animals',
  music: 'song songs singing concert guitar piano headphones podcast dj audio band',
  seasons: 'season winter summer spring autumn fall snow snowman sunny rain christmas halloween',
  marketing: [
    'advertising ads ad campaign promotion social-media seo email newsletter growth analytics audience',
    'influencer brand branding',
  ].join(' '),
}

/** The topics, each with its own word among the words that put a scene in it, read once. */
const WORDS: ReadonlyMap<string, readonly string[]> = (() => {
  const topicsOf = new Map<string, string[]>()
  for (const [topic, words] of Object.entries(TOPICS))
    for (const word of [topic, ...words.split(' ')]) topicsOf.set(word, [...(topicsOf.get(word) ?? []), topic])
  return topicsOf
})()

/** The topics a scene of these words is in: a word's own, or its hyphened neighbours' joined (`ice-cream`). */
export function topicsOf(words: readonly string[]): string[] {
  const found = new Set<string>()
  const lower = words.map((word) => word.toLowerCase())
  const joined = lower.slice(1).map((word, i) => `${lower[i]}-${word}`)
  for (const word of [...lower, ...joined]) for (const topic of WORDS.get(word) ?? []) found.add(topic)
  return [...found]
}
