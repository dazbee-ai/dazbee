// The pilot form: checked on submit, each error under its field, the first one focused.
// Until a form service is chosen it opens a mail to the stand-in address, so it shows no "sent" line.
export function initForm(form) {
  if (!form) return;
  const status = form.querySelector('[data-status]');
  const rules = {
    name: (v) => v.trim().length > 0,
    agency: (v) => v.trim().length > 0,
    email: (v) => /.+@.+\..+/.test(v),
    concepts: (v) => v.trim() === '' || /^\d+$/.test(v.trim()),
  };
  form.addEventListener('submit', (e) => {
    let first = null, bad = 0;
    for (const input of form.querySelectorAll('input')) {
      const ok = rules[input.name] ? rules[input.name](input.value) : true;
      const err = document.getElementById(input.getAttribute('aria-describedby'));
      input.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (err) err.hidden = ok;
      if (!ok) { bad++; first ??= input; }
    }
    if (bad) {
      e.preventDefault();
      first.focus();
      status.textContent = bad === 1 ? 'One field needs a fix.' : `${bad} fields need a fix.`;
    } else {
      status.textContent = 'Opening your email app';
    }
  });
}
