/*
 * form.js — one form renderer, for the three places a form appears.
 *
 * A form can sit on a page (as a block), inside a blog article (as a section)
 * and on the CMS's own preview. Those are three different rendering paths: the
 * page block is an Astro component, the article body is an HTML string built in
 * this package, and the preview runs in React in the browser. Writing the markup
 * three times would guarantee they drift, and the first symptom would be a form
 * that submits on a page and does nothing in an article.
 *
 * So the markup is built here, as a string, once. Astro emits it with
 * `set:html`, the article renderer concatenates it, and the CMS renders the same
 * string into its preview pane — which makes the preview the thing itself rather
 * than an impression of it, the same principle the visual editor's iframe rests
 * on.
 *
 * The submit behaviour lives in `/js/cms-form.js`, loaded once per page. It is
 * not inlined here for the same reason: two copies of a handler is one copy too
 * many, and the article body would have carried the second.
 */

/* ── Escaping ─────────────────────────────────────────────────────────────── */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/* ── Localised values ─────────────────────────────────────────────────────── */

/**
 * Read a per-locale map, falling back to the source language and then to any
 * value that exists.
 *
 * A half-translated form should show French words rather than an empty label:
 * an unlabelled input is unusable, and a French label on a German page is
 * merely untranslated.
 */
export function localised(map, locale, sourceLocale = 'fr') {
  if (map == null) return '';
  if (typeof map === 'string') return map;
  // A Mongoose Map survives `.get`; a lean document is a plain object.
  const read = (key) => (typeof map.get === 'function' ? map.get(key) : map[key]);
  const own = read(locale);
  if (own) return own;
  const source = read(sourceLocale);
  if (source) return source;
  const values = typeof map.get === 'function'
    ? [...map.values()]
    : Object.values(map);
  return values.find(Boolean) || '';
}

/* ── Where a submission goes ──────────────────────────────────────────────── */

/**
 * The path the browser posts to, from a form's `target`.
 *
 *   lead:demo     → /api/v1/forms/demo      stored under Leads
 *   hook:booking  → /api/v1/hooks/booking   stored, then forwarded server-side
 *
 * Both are on this origin. The automation platform's own address never appears
 * in a page, which is the whole point of `routes/hooks.js`.
 */
export function formAction(target) {
  const value = String(target || 'lead:contact');
  const [kind, name] = value.includes(':') ? value.split(':') : ['lead', value];
  return kind === 'hook'
    ? `/api/v1/hooks/${name}`
    : `/api/v1/forms/${name || 'contact'}`;
}

/** Every wire name a form would send, in order. */
export function formFieldNames(form) {
  return (form?.fields || [])
    .filter(f => f?.name && f.submit !== false)
    .map(f => f.name);
}

/**
 * The payload a completed form would post, with plausible values.
 *
 * Used by the CMS to show an editor exactly what will be sent, and to compare it
 * with what the endpoint says it requires — a check that is worth more than any
 * amount of documentation, because both halves are read from the live system.
 */
export function formSamplePayload(form, locale = 'fr') {
  const out = {};
  const SAMPLES = {
    email: 'name@example.com',
    tel: '+33 1 23 45 67 89',
    number: '42',
    url: 'https://example.com',
    date: new Date().toISOString().slice(0, 10),
    checkbox: 'on',
    textarea: 'A sentence a visitor typed.',
  };
  for (const field of form?.fields || []) {
    if (!field?.name || field.submit === false) continue;
    if (field.type === 'hidden') { out[field.name] = field.value || ''; continue; }
    if (field.type === 'select') {
      out[field.name] = field.options?.[0]?.value || '';
      continue;
    }
    out[field.name] = SAMPLES[field.type] || localised(field.label, locale) || field.name;
  }
  return out;
}

/* ── The markup ───────────────────────────────────────────────────────────── */

/** The shape of every text control, so the site's own look is in one place. */
const CONTROL = 'w-full rounded-btn border border-gray-300 bg-white px-4 py-3 text-gray-900 '
  + 'transition-colors placeholder:text-gray-400 focus:border-brand-500 focus:outline-none '
  + 'focus:ring-2 focus:ring-brand-500/20';

const INPUT_TYPE = {
  text: 'text', email: 'email', tel: 'tel', number: 'number', url: 'url', date: 'date',
};

function renderField(field, { locale, sourceLocale, uid, editMode }) {
  const id = `${uid}-${field.name}`;
  const label = localised(field.label, locale, sourceLocale) || field.name;
  const placeholder = localised(field.placeholder, locale, sourceLocale);
  const hint = localised(field.hint, locale, sourceLocale);
  const required = field.required ? ' required' : '';
  const autocomplete = field.autocomplete ? ` autocomplete="${escapeAttr(field.autocomplete)}"` : '';
  // Only in the editor: names which field of which form a click landed on.
  const hook = editMode ? ` data-cms-form-field="${escapeAttr(field.key || field.name)}"` : '';

  if (field.type === 'hidden') {
    return `<input type="hidden" name="${escapeAttr(field.name)}" value="${escapeAttr(field.value || '')}"${hook}>`;
  }

  const wide = field.type === 'textarea' || field.width === 'full';
  const open = `<div class="${wide ? 'sm:col-span-2' : ''}"${hook}>`;
  const star = field.required
    ? '<span class="ml-0.5 text-brand-500" aria-hidden="true">*</span>'
    : '';
  const labelTag = `<label class="mb-1.5 block text-sm font-medium text-gray-700" for="${escapeAttr(id)}">`
    + `${escapeHtml(label)}${star}</label>`;
  const hintTag = hint ? `<p class="mt-1 text-xs text-gray-500">${escapeHtml(hint)}</p>` : '';
  const errorTag = `<p class="mt-1 hidden text-xs text-red-600" data-error-for="${escapeAttr(field.name)}"></p>`;

  let control;
  switch (field.type) {
    case 'textarea':
      control = `<textarea id="${escapeAttr(id)}" name="${escapeAttr(field.name)}" rows="${Number(field.rows) || 4}"`
        + `${required} placeholder="${escapeAttr(placeholder)}" class="${CONTROL}"></textarea>`;
      break;

    case 'select': {
      const choices = (field.options || [])
        .map(option => `<option value="${escapeAttr(option.value)}">`
          + `${escapeHtml(localised(option.label, locale, sourceLocale) || option.value)}</option>`)
        .join('');
      control = `<select id="${escapeAttr(id)}" name="${escapeAttr(field.name)}"${required} class="${CONTROL}">`
        + `<option value="">${escapeHtml(placeholder || '—')}</option>${choices}</select>`;
      break;
    }

    case 'checkbox':
      // The label sits beside the box rather than above it, and carries markup,
      // because this is where the consent sentence and its policy link live.
      return `${open}<label class="flex items-start gap-2.5 text-sm text-gray-600" for="${escapeAttr(id)}">`
        + `<input id="${escapeAttr(id)}" name="${escapeAttr(field.name)}" type="checkbox"${required} `
        + 'class="mt-0.5 size-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500">'
        + `<span>${label}</span></label>${errorTag}</div>`;

    default:
      control = `<input id="${escapeAttr(id)}" name="${escapeAttr(field.name)}" `
        + `type="${INPUT_TYPE[field.type] || 'text'}"${required} `
        + `placeholder="${escapeAttr(placeholder)}"${autocomplete} class="${CONTROL}">`;
  }

  return `${open}${labelTag}${control}${hintTag}${errorTag}</div>`;
}

/**
 * A form, as the markup that ships.
 *
 * `opts.uid` must be stable for a given form on a given page — two forms on one
 * page would otherwise share element ids, and a label would focus the wrong
 * input. `opts.editMode` adds the attributes the visual editor reads and must
 * never be set for a public render.
 */
export function renderForm(form, opts = {}) {
  if (!form) return '';
  const {
    locale = 'fr',
    sourceLocale = 'fr',
    uid = `cms-form-${form.key || 'inline'}`,
    editMode = false,
    action = formAction(form.target),
    redirect = '',
    title = '',
    subtitle = '',
  } = opts;

  const fields = (form.fields || [])
    .filter(f => f?.name)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const columns = Number(form.layout?.columns) === 1 ? 'grid-cols-1' : 'sm:grid-cols-2';
  const centred = form.layout?.align === 'center';
  const consent = localised(form.consent, locale, sourceLocale);
  const submitLabel = localised(form.submitLabel, locale, sourceLocale) || 'Send';
  const sendingLabel = localised(form.sendingLabel, locale, sourceLocale) || '…';
  const successTitle = localised(form.success?.title, locale, sourceLocale) || 'Thank you';
  const successMessage = localised(form.success?.message, locale, sourceLocale) || '';

  const hook = editMode ? ` data-cms-form-key="${escapeAttr(form.key || '')}"` : '';

  return [
    `<div class="mx-auto w-full max-w-3xl px-6${centred ? ' text-center' : ''}"${hook}>`,

    title ? `<h2 class="text-3xl font-bold text-gray-900 sm:text-4xl">${escapeHtml(title)}</h2>` : '',
    subtitle ? `<p class="mt-3 text-lg text-gray-600">${escapeHtml(subtitle)}</p>` : '',

    `<form id="${escapeAttr(uid)}" class="mt-8 text-left" action="${escapeAttr(action)}" method="post"`,
    ` data-cms-form data-redirect="${escapeAttr(redirect || form.success?.redirect || '')}"`,
    ` data-sending="${escapeAttr(sendingLabel)}" novalidate>`,

    `<div class="grid gap-5 ${columns}">`,
    fields.map(field => renderField(field, { locale, sourceLocale, uid, editMode })).join(''),
    '</div>',

    /*
     * The honeypot. Off-screen rather than `display:none`, because some bots
     * skip hidden inputs, and never autofilled, so anything in it came from a
     * script. Not editable and not optional.
     */
    '<div class="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">',
    `<label for="${escapeAttr(uid)}-website">Website</label>`,
    `<input id="${escapeAttr(uid)}-website" name="website" type="text" tabindex="-1" autocomplete="off">`,
    '</div>',

    consent ? `<div class="mt-5 text-xs leading-relaxed text-gray-500">${consent}</div>` : '',

    `<div class="mt-7${centred ? ' text-center' : ''}">`,
    '<button type="submit" class="rounded-btn inline-flex items-center gap-2 bg-brand-500 px-7 py-3',
    ' font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">',
    `<span data-submit-label>${escapeHtml(submitLabel)}</span>`,
    '</button>',
    '</div>',

    '<p class="rounded-btn mt-4 hidden bg-red-50 px-4 py-3 text-sm text-red-700" data-form-error role="alert"></p>',
    '</form>',

    '<div class="mt-8 hidden rounded-2xl border border-green-200 bg-green-50 px-6 py-8 text-center"',
    ' data-form-success role="status" aria-live="polite">',
    `<h3 class="text-xl font-semibold text-green-900">${escapeHtml(successTitle)}</h3>`,
    successMessage
      ? `<p class="mt-2 text-green-800" data-success-message>${escapeHtml(successMessage)}</p>`
      : '',
    '</div>',

    '</div>',
  ].join('');
}

/**
 * What a form is missing, given what its endpoint says it needs.
 *
 * Both halves are read from the live system: the field list from the form, the
 * requirement from the endpoint's own reply to a probe. Neither is transcribed
 * by hand, which is why this can be trusted enough to show as a warning.
 */
export function formContractGaps(form, contract) {
  const required = contract?.requiredFields || [];
  if (!required.length) return { missing: [], extra: [], checked: false };

  const sending = new Set(formFieldNames(form));
  const known = new Set([...(contract.knownFields || []), ...required]);

  /*
   * A form stored under Leads has no "extra" fields.
   *
   * The Lead model keeps the payload whole and shows it, so every field beyond
   * the email is doing its job. Listing them as unrecognised would flag a
   * correct form — and a check that cries wolf on the common case is a check
   * people stop reading.
   */
  const forwarding = contract.kind === 'hook';

  return {
    checked: true,
    missing: required.filter(name => !sending.has(name)),
    // Fields the endpoint was never seen to read. Not an error — a workflow may
    // store the whole payload — so this is stated, not warned about.
    extra: forwarding ? [...sending].filter(name => !known.has(name)) : [],
  };
}
