// The valley's colours, shared by scripts/valley.mjs (build-time pictures) and src/scenes/valley.js (the live shader).
export const PALETTE_HEX = [
  '#1b2f22', '#2c4f2d', '#46703a', '#6f9440', '#a5bd55', '#d7d27a',   // shadow to sunlit grass
  '#3b5a40', '#56625c', '#8f9a92', '#c9cdc4',                         // shaded slope, rock and stone
  '#f8f6ef', '#f3c6cf', '#e98aa2', '#e66f55', '#f2c650',              // white, pink, rose, coral, yellow flowers
  '#9cc3df', '#2b2f2d',                                               // lake, roofs and deep shade
];
export const PAPER_HEX = '#f7f5ef';
export const hex3 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
