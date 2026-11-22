// The try-out's ready-made concept sets. Each category has a sample brief and four routes that differ in angle,
// layout, palette and type, not just colour. The try-out picks a set from the visitor's words (or their chip);
// nothing here is generated live. Brand names are invented samples; the visitor's own brand name replaces them.

export const CATEGORIES = {
  skincare: {
    label: 'Skincare and beauty',
    brand: 'Sorrel & Oat',
    obj: 'bottle',
    words: /skin|cleanser|serum|beauty|cream|lotion|hair|spf|sunscreen|moistur|cosmetic|makeup|\blipshampoo|soap|fragrance|perfume/i,
    sample: { what: 'A gentle oat cleanser for sensitive skin', who: 'Women 25 to 40 who have tried three cleansers this year', brief: 'Sorrel & Oat, oat cleanser, spring launch. Proposition: clean skin that still feels soft. Audience: 25 to 40, sensitive skin, tried three cleansers this year. Must have: pack shot. No before and after faces.' },
    routes: [
      { id: 'proof', tpl: 'stat', name: 'The two-week test', angle: 'Proof: one number the client can stand behind.', tags: ['Proof', 'Big number'],
        big: '14', unit: 'days', sub: 'Ask your skin, not us. Most testers felt it by week two.', cta: 'Start the test',
        pal: ['#f4e3d3', '#4a2a1a', '#c4693f'] },
      { id: 'voice', tpl: 'quote', name: 'Said by sensitive skin', angle: 'Social proof: a real voice instead of a claim.', tags: ['Social proof', 'Quote'],
        quote: 'It didn’t sting. That’s a first.', who: 'Priya, 31 · sensitive skin', cta: 'Shop the cleanser',
        pal: ['#1f3b2d', '#f1ead8', '#b9d77e'] },
      { id: 'label', tpl: 'macro', name: 'The short label', angle: 'Ingredient: make the short list the hero.', tags: ['Ingredient', 'Callouts'],
        title: 'Three things. That’s the label.', calls: ['Oat', 'Ceramide', 'Glycerin'], cta: 'Read the label',
        pal: ['#e6ecd8', '#2f4a22', '#5e7f3e'] },
      { id: 'routine', tpl: 'steps', name: 'Sixty seconds', angle: 'Routine: show exactly where it fits in the day.', tags: ['Routine', 'Steps'],
        title: 'Sixty seconds, twice a day.', steps: ['Wet', 'Massage', 'Rinse'], cta: 'Shop the cleanser',
        pal: ['#d4e5ee', '#173f62', '#1f5f9e'] },
    ],
  },
  food: {
    label: 'Food and drink',
    brand: 'Brimble',
    obj: 'can',
    words: /coffee|\btea\b|food|snack|drink|soda|fizz|sparkling|bakery|bread|cafe|café|restaurant|chocolate|juice|beer|wine|spirit|kitchen|meal|recipe|sauce|granola|cereal/i,
    sample: { what: 'A sparkling botanical soda with 3 g of sugar a can', who: 'Adults 25 to 45 cutting back on sugar and alcohol', brief: 'Brimble, sparkling botanical soda. Dry-ish January. Proposition: all the fizz, 3 g of sugar a can. Audience: 25 to 45, cutting back on sugar and alcohol. Must have: the can. No sugar-shaming.' },
    routes: [
      { id: 'swap', tpl: 'photo', name: 'Same fizz, less sugar', angle: 'Comparison: the can they reach for today, next to ours.', tags: ['Comparison', 'Photo'],
        img: 'swap', pos: '64% 60%', head: 'All the fizz. 3 g of sugar.', cta: 'Try the mixed pack', pal: ['#f5f2ed', '#3b1f4a', '#ff6b57'] },
      { id: 'night', tpl: 'photo', name: 'Still in the round', angle: 'Social: a night out where nobody asks why.', tags: ['Social', 'Photo'],
        img: 'night', pos: '38% 55%', head: 'Not drinking tonight. Still in the round.', cta: 'Find it near you', pal: ['#17130f', '#fff6ea', '#3f7fd9'] },
      { id: 'botanical', tpl: 'photo', name: 'The short label', angle: 'Ingredient: three plants, nothing to look up.', tags: ['Ingredient', 'Illustration'],
        img: 'botanical', pos: '50% 58%', head: 'Mint, cucumber, lime. That’s the label.', cta: 'Read the label', pal: ['#f8efdc', '#2f3f22', '#6f9e26'] },
      { id: 'popart', tpl: 'photo', name: 'Turned up', angle: 'Feeling: one loud colour for the feed.', tags: ['Feeling', 'Colour'],
        img: 'popart', pos: '56% 50%', head: 'Raspberry, turned up.', cta: 'Get the berry can', pal: ['#f6c93b', '#3b1f4a', '#d0306e'] },
    ],
  },
  fitness: {
    label: 'Fitness and apparel',
    brand: 'Stride Lab',
    obj: 'shoe',
    words: /run|shoe|sneaker|fitness|gym|sport|yoga|apparel|cloth|wear|jacket|athlet|cycling|bike|workout|\btrainswim|hike|outdoor/i,
    sample: { what: 'A cushioned running shoe for new runners', who: 'People who want to start running again', brief: 'Stride Lab, everyday running shoe. Proposition: the shoe that makes the first 5K feel possible. Audience: lapsed runners, 28 to 45. Must have: the shoe. No elite athletes.' },
    routes: [
      { id: 'goal', tpl: 'stat', name: 'Your first 5K', angle: 'Goal: sell the finish line, not the foam.', tags: ['Goal', 'Big number'],
        big: '5K', unit: 'in six weeks', sub: 'For people who haven’t run since school.', cta: 'Get the plan and the shoe',
        pal: ['#e3edc0', '#1f2a10', '#d2402b'] },
      { id: 'feel', tpl: 'poster', name: 'Bounce', angle: 'Feeling: one word for how the first stride feels.', tags: ['Feeling', 'Poster'],
        word: 'BOUNCE', sub: 'Foam that gives back', cta: 'Try them on',
        pal: ['#f0613a', '#fff4e8', '#fff4e8'] },
      { id: 'swap', tpl: 'split', name: 'Old pair, new pair', angle: 'Comparison: the worn-out pair everyone owns.', tags: ['Comparison', 'Split'],
        a: ['Your old pair', '800 km'], b: ['This pair', '0 km'], top: 'Time for a swap?', cta: 'Retire the old ones',
        pal: ['#e6e1d8', '#1d1d1d', '#2a44e0'] },
      { id: 'plan', tpl: 'steps', name: 'Week by week', angle: 'Plan: make the start feel small and certain.', tags: ['Plan', 'Steps'],
        title: 'Walk. Jog. Run.', steps: ['Week 1: walk and jog', 'Week 3: 20 minutes', 'Week 6: 5K'], cta: 'Start week one',
        pal: ['#12305a', '#eef3ff', '#9fd3ff'] },
    ],
  },
  software: {
    label: 'Apps and software',
    brand: 'Ledgerly',
    obj: 'phone',
    words: /\bapps?\b|software|saas|invoic|bank|fintech|finance|platform|startup|crm|accounting|payment|dashboard|\bai\b|b2b/i,
    sample: { what: 'Invoicing app for small studios', who: 'Owners of design and creative studios with under 20 people', brief: 'Ledgerly, invoicing for small studios. Proposition: month-end without the spreadsheet. Audience: studio owners. Must have: the app screen. No stock handshake photos.' },
    routes: [
      { id: 'voice', tpl: 'quote', name: 'Month-end by lunch', angle: 'Social proof: the owner gets their afternoon back.', tags: ['Time back', 'Quote'],
        quote: 'Month-end used to take a day. Now it’s lunch.', who: 'Meera · runs a design studio', cta: 'Try it free',
        pal: ['#f6efe2', '#14161c', '#1d33c9'] },
      { id: 'speed', tpl: 'stat', name: 'Two minutes', angle: 'Speed: one number for the whole job.', tags: ['Speed', 'Big number'],
        big: '2', unit: 'minutes per invoice', sub: 'Pick the client, add the hours, send.', cta: 'Send your first one',
        pal: ['#0f3d3a', '#e8f5ee', '#6fe3b5'] },
      { id: 'versus', tpl: 'split', name: 'Fourteen tabs', angle: 'Comparison: the spreadsheet they already hate.', tags: ['Comparison', 'Split'],
        a: ['Spreadsheet', '14 tabs'], b: ['Ledgerly', '1 screen'], top: 'Same month-end.', cta: 'Leave the spreadsheet',
        pal: ['#eceae4', '#1a1a1a', '#ff7a59'] },
      { id: 'screen', tpl: 'macro', name: 'One screen', angle: 'Product: show everything it does at a glance.', tags: ['Product', 'Callouts'],
        title: 'Invoices, reminders, tax. One screen.', calls: ['Auto reminders', 'Card and bank', 'Tax-ready export'], cta: 'See it working',
        pal: ['#dfe7ff', '#0a0f5c', '#1d33c9'] },
    ],
  },
};

export const pickCategory = (text) => {
  for (const [key, c] of Object.entries(CATEGORIES)) if (c.words.test(text)) return key;
  return null;
};
