import { cad } from '../ui/cad.js';

// The example brief's routes (v3.6: Brimble, a made-up sparkling botanical soda, 3 g of sugar a can): six distinct
// concepts on one brief. Each has its own visual (public/images/brimble, made with image AI) with the words set in
// code, so it fits any size. Each route also names the buyer it speaks to (who, why): distinct routes reach more people.
// Used by the city, the how section and the board.
export const BRIEF = { brand: 'Brimble', title: 'Dry-ish January, sparkling soda', line: 'All the fizz, 3 g of sugar' };
const R = (o) => ({ ...o, html: (s) => cad({ tpl: 'photo', ...o }, BRIEF.brand, 'can', s) });
export const ROUTES = [
  R({ id: 'swap', name: 'Comparison', line: 'Against what they drink now', acc: '#ff6b57', who: 'Cutting back on sugar, 30 to 45', why: 'They want the fizz without the sugar.',
    img: 'swap', pos: '64% 60%', head: 'All the fizz. 3 g of sugar.', cta: 'Try the mixed pack', pal: ['#f5f2ed', '#3b1f4a', '#ff6b57'] }),
  R({ id: 'picnic', name: 'Moment', line: 'The plan it belongs to', acc: '#e9a800', who: 'Weekend planners, 25 to 40', why: 'They buy for the plan, not the drink.',
    img: 'picnic', pos: '52% 60%', head: 'Pack it for the long lunch.', cta: 'Shop the summer box', pal: ['#f4f1e4', '#2e2a1a', '#d99a00'] }),
  R({ id: 'night', name: 'Social', line: 'A night out, alcohol-free', acc: '#3f7fd9', who: 'Sober-curious, 24 to 35', why: 'They want something good to hold at the bar.',
    img: 'night', pos: '38% 55%', head: 'Not drinking tonight. Still in the round.', cta: 'Find it near you', pal: ['#17130f', '#fff6ea', '#3f7fd9'] }),
  R({ id: 'kitchen', name: 'Family', line: 'A treat with no catch', acc: '#1fa79e', who: 'Parents of young kids', why: 'They want a treat they don’t have to ration.',
    img: 'kitchen', pos: '44% 55%', head: 'The fizzy drink you can say yes to.', cta: 'Shop mint and lime', pal: ['#f6f0e6', '#1f3530', '#1fa79e'] }),
  R({ id: 'botanical', name: 'Ingredient', line: 'What is on the label', acc: '#7fae2e', who: 'Label readers', why: 'They read the back of the can first.',
    img: 'botanical', pos: '50% 58%', head: 'Mint, cucumber, lime. That’s the label.', cta: 'Read the label', pal: ['#f8efdc', '#2f3f22', '#6f9e26'] }),
  R({ id: 'popart', name: 'Feeling', line: 'One loud word', acc: '#d0306e', who: 'Trend-led, 18 to 24', why: 'They pick what looks good on their feed.',
    img: 'popart', pos: '56% 50%', head: 'Raspberry, turned up.', cta: 'Get the berry can', pal: ['#f6c93b', '#3b1f4a', '#d0306e'] }),
];
// the one ad the city starts with: the same plain can shot on every board (before Dazbee)
export const PLAIN = { id: 'plain', name: 'One ad', acc: '#9a9a9a',
  html: () => `<div class="cad cad--plain" style="--bg:#efe9df;--fg:#3b1f4a"><span class="cad__brand">brimble</span><b class="cad__head">Sparkling soda.</b><i class="cad__can"></i></div>` };

// size names on the page and the class each kind of banner uses
export const SIZES = [
  { id: '11', label: '1:1', name: 'Feed, square', px: '1080 × 1080', cad: 'k-11' },
  { id: '45', label: '4:5', name: 'Feed, portrait', px: '1080 × 1350', cad: 'k-45' },
  { id: '916', label: '9:16', name: 'Stories and Reels', px: '1080 × 1920', cad: 'k-916' },
  { id: '191', label: '1.91:1', name: 'Landscape', px: '1200 × 628', cad: 'k-191' },
];
export const routeHTML = (r, sizeId = '45') => r.html((SIZES.find((x) => x.id === sizeId) || { cad: 'fill' }).cad);
// a banner in a fixed-ratio frame: .bn.r45 etc. (styled in sections.css); the frame decides the size, the banner fills it
export const banner = (r, sizeId = '45', cls = '') => `<div class="bn r${sizeId}${cls ? ` ${cls}` : ''}">${routeHTML(r, sizeId)}</div>`;
