// Banners drawn in code. cad(): the try-out's templates (stat, quote, poster, split, steps, macro), styled in try.css.
// photo: a concept visual (public/images/brimble) with the headline, brand and button set in code, so it fits any ratio.
export const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// one concept as a banner, drawn in code
export function cad(r, brand, objKind, size = 'k-45') {
  const [bg, fg, acc] = r.pal
  const obj = `<i class="obj obj--${r.obj || objKind}" aria-hidden="true"></i>`
  const cta = `<span class="cad__cta">${esc(r.cta)}</span>`
  let body = ''
  if (r.tpl === 'stat')
    body = `<b class="cad__big">${esc(r.big)}</b><span class="cad__unit">${esc(r.unit)}</span><p class="cad__sub">${esc(r.sub)}</p>${obj}${cta}`
  if (r.tpl === 'quote')
    body = `<div class="cad__bubble"><p>“${esc(r.quote.replace(/^“|”$/g, ''))}”</p></div><span class="cad__who"><i class="cad__stars" aria-hidden="true"></i>${esc(r.who)}</span>${obj}${cta}`
  if (r.tpl === 'poster')
    body = `<b class="cad__word">${esc(r.word)}</b><span class="cad__sticker">${esc(r.sub)}</span>${obj}${cta}`
  if (r.tpl === 'split')
    body = `<span class="cad__top">${esc(r.top)}</span><div class="cad__half cad__half--a"><span>${esc(r.a[0])}</span><b>${esc(r.a[1])}</b></div><div class="cad__half cad__half--b"><span>${esc(r.b[0])}</span><b>${esc(r.b[1])}</b></div>${cta}`
  if (r.tpl === 'steps')
    body = `<b class="cad__title">${esc(r.title)}</b><ol class="cad__steps">${r.steps.map((s, i) => `<li><i>${i + 1}</i>${esc(s)}</li>`).join('')}</ol>${obj}${cta}`
  if (r.tpl === 'photo') body = `<b class="cad__head">${esc(r.head)}</b>${cta}`
  if (r.tpl === 'macro')
    body = `<b class="cad__title">${esc(r.title)}</b>${obj}${r.calls.map((c, i) => `<span class="cad__call cad__call--${i + 1}">${esc(c)}</span>`).join('')}${cta}`
  const img = r.img ? `;--img:url(/images/brimble/${r.img}.webp);--pos:${r.pos || '50% 50%'}` : ''
  return `<div class="cad cad--${r.tpl} ${size}" style="--bg:${bg};--fg:${fg};--acc:${acc}${img}"><span class="cad__brand">${esc(brand)}</span>${body}</div>`
}
