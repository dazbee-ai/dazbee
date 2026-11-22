// The phone menu: one button, one sheet, closes on any choice or Escape.
export function initNav() {
  const btn = document.querySelector('.nav__toggle');
  const sheet = document.getElementById('sheet');
  if (!btn || !sheet) return;
  const set = (open) => { btn.setAttribute('aria-expanded', String(open)); sheet.hidden = !open; };
  btn.addEventListener('click', () => set(sheet.hidden));
  sheet.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
}
