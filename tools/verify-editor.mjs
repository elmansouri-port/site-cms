#!/usr/bin/env node
/*
 * verify-editor.mjs — prove the builder, the URL model and A/B testing work
 * against a running stack.
 *
 * The other verification tools are read-only. This one is not: it signs in as
 * an administrator, creates scratch pages, moves the pricing page's English and
 * German URLs, attaches experiments and edits the blog segment — then puts all
 * of it back. That is the only way to test behaviour that only exists once
 * content has been changed, but it means this belongs on a development or
 * staging stack, never against production data.
 *
 *   ADMIN_PASSWORD=… node tools/verify-editor.mjs http://localhost:8080 --confirm
 *
 * Everything it creates is keyed `zz-check-*` and removed at the end. If a run
 * fails part-way, delete those keys before running it again.
 */
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = (args.find(a => !a.startsWith('-')) || 'http://localhost:8080').replace(/\/+$/, '');

/*
 * Behind the gateway one origin serves the API, the admin and the site, which is
 * why `BASE` alone is enough in production. Running the three services on their
 * own ports in development splits them, so both can be pointed at separately:
 *
 *   node tools/verify-editor.mjs http://localhost:4000 --site http://localhost:3000 --confirm
 */
const SITE = flag('site', BASE).replace(/\/+$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'admin@rainbow.local';
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!args.includes('--confirm')) {
  console.error(
    'This tool writes to the database: it creates scratch pages, changes the\n'
    + 'pricing page\'s URLs and attaches experiments, then undoes all of it.\n'
    + 'Re-run with --confirm once you are sure this is not production data.\n\n'
    + `  ADMIN_PASSWORD=… node tools/verify-editor.mjs ${BASE} --confirm`,
  );
  process.exit(2);
}

if (!PASSWORD) {
  console.error('Set ADMIN_PASSWORD to the administrator password from your .env.');
  process.exit(2);
}

let pass = 0;
const failures = [];

function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

let token = null;
const auth = () => ({ authorization: `Bearer ${token}` });

async function api(path, options = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? auth() : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: res.status, body, headers: res.headers };
}

async function page(path, { cookie = null, redirect = 'manual' } = {}) {
  const res = await fetch(`${SITE}${path}`, {
    redirect,
    headers: cookie ? { cookie } : {},
  });
  const html = res.status < 300 || res.status >= 400 ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location'), html, headers: res.headers };
}

/* ── 1. Auth ─────────────────────────────────────────────────────────────── */
console.log('\nAuth');
{
  const res = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  token = res.body?.token;
  ok('admin can sign in', res.status === 200 && !!token, `status ${res.status}`);
}

/* ── 2. Localized routes ─────────────────────────────────────────────────── */
console.log('\nLocalized routes');
{
  const before = await api('/pages/tarifs');
  ok('the pricing page exists', before.status === 200, `status ${before.status}`);
  const baseRoute = before.body?.page?.route;

  const patched = await api('/pages/tarifs', {
    method: 'PATCH',
    body: JSON.stringify({ routes: { en: 'pricing', de: 'preise' } }),
  });
  ok('per-locale routes save', patched.status === 200, JSON.stringify(patched.body).slice(0, 160));
  ok('the routes are stored', patched.body?.page?.routes?.en === 'pricing');

  // Redis caches the route table under the site revision; the PATCH bumps it.
  await new Promise(r => setTimeout(r, 1200));

  const en = await page('/en/pricing');
  ok('/en/pricing serves the page', en.status === 200, `status ${en.status}`);
  ok('its canonical is the localized URL',
    en.html.includes('rel="canonical" href="' + SITE + '/en/pricing/'),
    (en.html.match(/rel="canonical"[^>]*/) || [''])[0]);
  ok('hreflang points de at /de/preise',
    en.html.includes('hreflang="de" href="' + SITE + '/de/preise/'),
    (en.html.match(/hreflang="de"[^>]*/) || ['none'])[0]);
  ok('hreflang points fr at the base route',
    en.html.includes(`hreflang="fr" href="${SITE}/fr/${baseRoute}/`),
    (en.html.match(/hreflang="fr"[^>]*/) || ['none'])[0]);

  const old = await page(`/en/${baseRoute}`);
  ok('the untranslated path 301s to the localized one',
    old.status === 301 && old.location === '/en/pricing',
    `status ${old.status} location ${old.location}`);

  const fr = await page(`/fr/${baseRoute}`);
  ok('a locale with no override is untouched', fr.status === 200, `status ${fr.status}`);

  const redirects = await api('/redirects');
  const written = (redirects.body?.items || []).find(r => r.from === `/en/${baseRoute}`);
  ok('a 301 redirect was written for the old path', !!written && written.status === 301,
    JSON.stringify(written || null));

  const map = await page('/sitemap.xml');
  ok('the sitemap lists the localized URL', map.html.includes(`${SITE}/en/pricing/`));
  ok('the sitemap does not list the old English URL',
    !map.html.includes(`${SITE}/en/${baseRoute}/`));

  const de = await page('/de/preise');
  ok('/de/preise serves the page too', de.status === 200, `status ${de.status}`);
}

/* ── 3. Breadcrumbs ──────────────────────────────────────────────────────── */
console.log('\nStructured data');
{
  const res = await page('/en/pricing');
  ok('a BreadcrumbList is emitted', res.html.includes('"@type": "BreadcrumbList"'));
  const home = await page('/fr');
  ok('the homepage keeps Organization + WebSite',
    home.html.includes('"@type": "Organization"') && home.html.includes('"@type": "WebSite"'));
  ok('the homepage gets no breadcrumb', !home.html.includes('"BreadcrumbList"'));
}

/* ── 4. Custom block ─────────────────────────────────────────────────────── */
console.log('\nCustom block');
let testPage;
{
  const created = await api('/pages', {
    method: 'POST',
    body: JSON.stringify({
      key: 'zz-check-page',
      route: 'zz-check-page',
      title: 'Check page',
      pageKind: 'page',
      type: 'hybrid',
    }),
  });
  ok('a new page can be created', [201, 409].includes(created.status), `status ${created.status}`);
  testPage = 'zz-check-page';

  const block = await api(`/pages/${testPage}/sections`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'component',
      componentKey: 'custom_html',
      label: 'Check custom',
      data: {
        html: '<div class="py-10"><h2 class="text-3xl font-bold text-brand-500">Custom heading</h2><p class="card">Scoped</p></div>',
        css: '.card { color: rgb(1, 2, 3); }\n@media (min-width: 600px) { .card { font-weight: 700; } }',
        contained: true,
        containerClass: 'check-wrapper',
      },
    }),
  });
  ok('a custom block can be added', block.status === 201, JSON.stringify(block.body).slice(0, 200));
  const blockKey = block.body?.section?.key;

  await api(`/pages/${testPage}/publish`, { method: 'POST' });
  await new Promise(r => setTimeout(r, 1200));

  const rendered = await page('/fr/zz-check-page');
  ok('the page renders', rendered.status === 200, `status ${rendered.status}`);
  ok('the custom markup is present', rendered.html.includes('Custom heading'));
  ok('Tailwind classes survive', rendered.html.includes('text-brand-500'));
  ok('the wrapper class is applied', rendered.html.includes('check-wrapper'));
  ok('the CSS is scoped to the block',
    rendered.html.includes(`.cms-block-${blockKey} .card`),
    (rendered.html.match(/\.cms-block-[a-z0-9-]+ \.card[^}]*}/) || ['none'])[0]);
  ok('the media query is preserved and scoped',
    rendered.html.includes('@media (min-width: 600px)')
    && rendered.html.match(/@media[^{]*\{\s*\.cms-block-[a-z0-9-]+ \.card/) !== null);
  ok('the unscoped selector does not leak',
    !/(^|[^ ])\.card\s*\{\s*color/.test(rendered.html.replace(/\.cms-block-[a-z0-9-]+ /g, 'SCOPED ')));
}

/* ── 5. Edit mode ────────────────────────────────────────────────────────── */
console.log('\nEdit mode');
{
  const clean = await page('/fr/zz-check-page');
  ok('a public page carries no editor annotations',
    !clean.html.includes('data-cms-block') && !clean.html.includes('cms-editor.js'));
  ok('a public page carries no string annotations', !clean.html.includes('data-cms-key'));
  /*
   * Field annotations are what the link inspector clicks on: a `data-cms-field`
   * on every button a block drew from one of its own fields. They are added in
   * edit mode only, and a leak would put the CMS's internal field names into the
   * markup every visitor and every crawler receives.
   */
  ok('a public page carries no field annotations', !clean.html.includes('data-cms-field'));
  ok('a public page carries no form annotations',
    !clean.html.includes('data-cms-form-key') && !clean.html.includes('data-cms-form-field'));

  const url = await api(`/pages/${testPage}/preview-url?locale=fr&edit=1`);
  ok('an edit preview URL is issued', url.status === 200 && url.body?.url?.includes('edit=1'),
    JSON.stringify(url.body));

  // Exchange the secret for the cookies the way a browser would.
  const exchange = await fetch(url.body.url, { redirect: 'manual' });
  const cookies = (exchange.headers.getSetCookie?.() || [])
    .map(c => c.split(';')[0]).join('; ');
  ok('preview and edit cookies come back',
    cookies.includes('rbw_preview=') && cookies.includes('rbw_edit='), cookies);

  const edit = await page('/fr/zz-check-page', { cookie: cookies });
  ok('edit mode annotates blocks', edit.html.includes('data-cms-block='),
    `status ${edit.status}`);
  ok('edit mode injects the bridge', edit.html.includes('/js/cms-editor.js'));
  ok('the bridge script is served', (await page('/js/cms-editor.js')).status === 200);

  const home = await page('/fr', { cookie: cookies });
  ok('authored blocks are annotated too', home.html.includes('data-cms-block='));
  ok('authored copy is annotated for inline editing', home.html.includes('data-cms-key='));
}

/* ── 6. Converting an authored block ─────────────────────────────────────── */
console.log('\nConvert to a custom block');
{
  const copy = await api('/pages', {
    method: 'POST',
    body: JSON.stringify({
      key: 'zz-check-convert',
      route: 'zz-check-convert',
      title: 'Convert check',
      copyFrom: 'tarifs',
    }),
  });
  ok('a page can be copied from an authored one', [201, 409].includes(copy.status), `status ${copy.status}`);

  const sections = await api('/pages/zz-check-convert/sections');
  const target = (sections.body?.items || []).find(s => s.type === 'html' && !s.locked);
  ok('it has an authored block to convert', !!target);

  const before = await api(`/pages/zz-check-convert/sections/${target.key}`);
  const originalHtml = before.body?.section?.html || '';

  const converted = await api(`/pages/zz-check-convert/sections/${target.key}/convert`, { method: 'POST' });
  ok('the conversion succeeds', converted.status === 200, JSON.stringify(converted.body).slice(0, 200));
  ok('it became a custom block',
    converted.body?.section?.componentKey === 'custom_html'
    && converted.body?.section?.type === 'component');
  ok('the markup is carried over intact', converted.body?.section?.data?.html === originalHtml);
  ok('it is stamped as converted', converted.body?.section?.convertedFrom === 'html');
  ok('spacing is neutral so the layout does not shift',
    converted.body?.section?.layout?.spacingTop === 'none');
  ok('the response says what was given up',
    /fidelity/i.test(converted.body?.note || ''), converted.body?.note);

  const again = await api(`/pages/zz-check-convert/sections/${target.key}/convert`, { method: 'POST' });
  ok('converting twice is refused', again.status === 400, `status ${again.status}`);

  const locked = (sections.body?.items || []).find(s => s.locked);
  if (locked) {
    const refused = await api(`/pages/zz-check-convert/sections/${locked.key}/convert`, { method: 'POST' });
    ok('a structural block cannot be converted', refused.status === 400, `status ${refused.status}`);
  }
}

/* ── 7. Block-level variants on a component ──────────────────────────────── */
console.log('\nComponent block variants');
{
  await api('/experiments', {
    method: 'POST',
    body: JSON.stringify({
      key: 'zz-check-block',
      name: 'Check block test',
      status: 'running',
      mode: 'param',
      paramName: 'version',
      variants: [{ key: 'A', label: 'Control', weight: 50 }, { key: 'B', label: 'B', weight: 50 }],
    }),
  });

  const sections = await api(`/pages/${testPage}/sections`);
  const custom = (sections.body?.items || []).find(s => s.componentKey === 'custom_html');

  const attached = await api(`/pages/${testPage}/sections/${custom.key}`, {
    method: 'PATCH',
    body: JSON.stringify({
      experiment: {
        key: 'zz-check-block',
        variants: [{
          key: 'B',
          label: 'Variant B',
          data: { html: '<div class="py-10"><h2>Variant heading</h2></div>' },
        }],
      },
    }),
  });
  ok('a variant with field overrides saves', attached.status === 200,
    JSON.stringify(attached.body).slice(0, 200));

  await new Promise(r => setTimeout(r, 1200));

  const control = await page('/fr/zz-check-page');
  ok('the control still renders the control', control.html.includes('Custom heading'));

  const variant = await page('/fr/zz-check-page?version=B');
  ok('?version=B renders the variant', variant.html.includes('Variant heading'),
    variant.html.includes('Custom heading') ? 'still showing control' : 'neither found');
  ok('the variant is not indexable',
    /noindex/.test(variant.headers.get('x-robots-tag') || '')
    || variant.html.includes('content="noindex, nofollow"'),
    variant.headers.get('x-robots-tag'));
}

/* ── 8. Whole-page variants ──────────────────────────────────────────────── */
console.log('\nWhole-page variants');
{
  const created = await api(`/pages/${testPage}/variants`, {
    method: 'POST',
    body: JSON.stringify({
      experimentKey: 'zz-check-page-test',
      variant: 'B',
      label: 'Redesign',
      copyControl: true,
    }),
  });
  ok('a page variant arm is created', created.status === 201, JSON.stringify(created.body).slice(0, 200));
  const armKey = created.body?.page?.key;
  ok('the arm is noindex', created.body?.page?.noindex === true);
  ok('the arm is out of the sitemap', created.body?.page?.sitemap?.include === false);
  ok('the arm knows its control', created.body?.page?.experiment?.variantOf === testPage);
  ok('the arm has no public route', String(created.body?.page?.route).startsWith('__variant/'));

  const listed = await api(`/pages/${testPage}/variants`);
  ok('both arms are listed', (listed.body?.items || []).length === 2,
    JSON.stringify(listed.body?.items));
  ok('the control is flagged as such',
    (listed.body?.items || []).some(a => a.isControl && a.variant === 'A'));

  // Give the arm distinguishable content, publish it, and switch the test to a
  // URL parameter so the assignment is deterministic to check.
  const armSections = await api(`/pages/${armKey}/sections`);
  const armCustom = (armSections.body?.items || []).find(s => s.componentKey === 'custom_html');
  await api(`/pages/${armKey}/sections/${armCustom.key}`, {
    method: 'PATCH',
    body: JSON.stringify({
      experiment: { key: null, variants: [] },
      data: { html: '<div class="py-10"><h2>Whole page B</h2></div>', contained: true },
    }),
  });
  await api(`/pages/${armKey}/publish`, { method: 'POST' });
  await api('/experiments/zz-check-page-test', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'running', mode: 'param', paramName: 'pv' }),
  });
  await new Promise(r => setTimeout(r, 1200));

  const control = await page('/fr/zz-check-page');
  ok('the control URL still serves the control', control.html.includes('Custom heading'),
    control.html.includes('Whole page B') ? 'serving the arm' : 'neither');

  const served = await page('/fr/zz-check-page?pv=B');
  ok('the arm is served at the control URL', served.html.includes('Whole page B'),
    served.html.includes('Custom heading') ? 'still control' : 'neither');
  ok('the arm has no URL of its own',
    (await page(`/fr/__variant/${armKey}`)).status === 404);

  const map = await page('/sitemap.xml');
  ok('the arm is absent from the sitemap', !map.html.includes(armKey));
}

/* ── 9. Blog segment per locale ──────────────────────────────────────────── */
console.log('\nBlog segment');
{
  const put = await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ blogSegment: { en: 'insights' } }),
  });
  ok('the blog segment saves', put.status === 200, JSON.stringify(put.body).slice(0, 160));
  ok('it is stored per locale', put.body?.settings?.blogSegment?.en === 'insights');

  await new Promise(r => setTimeout(r, 1200));
  const boot = await api('/site/bootstrap');
  ok('the frontend is told about it', boot.body?.settings?.blogSegment?.en === 'insights');

  // Put it back so the site is left as it was found.
  await api('/settings', { method: 'PUT', body: JSON.stringify({ blogSegment: {} }) });
  ok('it can be cleared again',
    (await api('/settings')).body?.settings?.blogSegment?.en === undefined);
}

/* ── 10. Caching behaviour ───────────────────────────────────────────────── */
console.log('\nCaching');
{
  // A page with no experiment on it must stay shared-cacheable even while a
  // cookie-mode test runs elsewhere on the site.
  await api('/experiments', {
    method: 'POST',
    body: JSON.stringify({
      key: 'zz-check-cookie',
      name: 'Cookie test',
      status: 'running',
      mode: 'cookie',
      cookieDays: 14,
      variants: [{ key: 'A', label: 'A', weight: 50 }, { key: 'B', label: 'B', weight: 50 }],
    }),
  });
  await new Promise(r => setTimeout(r, 1200));

  const unrelated = await page('/fr');
  const cc = unrelated.headers.get('cache-control') || '';
  ok('an unaffected page keeps shared caching', !cc.includes('private'), `cache-control: ${cc}`);
  ok('and sets no variant cookie',
    !(unrelated.headers.getSetCookie?.() || []).some(c => c.startsWith('rbw_ab_zz-check-cookie')),
    JSON.stringify(unrelated.headers.getSetCookie?.() || []));
}

/* ── 11. Shared header and footer ────────────────────────────────────────── */
console.log('\nShared header and footer');
{
  const chrome = await api('/chrome');
  ok('the chrome document exists', chrome.status === 200 && !!chrome.body?.chrome,
    `status ${chrome.status}`);
  const before = chrome.body.chrome;
  ok('the header holds markup', (before.navbar?.html || '').length > 1000);
  ok('the original is recorded for restoring', !!before.navbar?.authoredHtml);
  ok('the header markup starts at its element',
    (before.navbar?.html || '').trimStart().startsWith('<nav'),
    JSON.stringify((before.navbar?.html || '').slice(0, 40)));

  // Change it once; look for it on two unrelated pages.
  const marker = 'zz-chrome-check-marker';
  const patched = await api('/chrome/navbar', {
    method: 'PATCH',
    body: JSON.stringify({
      html: before.navbar.html.replace('<nav', `<nav data-${marker}="1"`),
      css: `.${marker} { outline: 0 }`,
    }),
  });
  ok('the header saves', patched.status === 200, JSON.stringify(patched.body).slice(0, 160));
  await new Promise(r => setTimeout(r, 1500));

  const home = await page('/fr');
  const other = await page('/fr/tarifs');
  ok('the change reaches the homepage', home.html.includes(marker));
  ok('the change reaches another page too', other.html.includes(marker));
  ok('chrome CSS is emitted with it', home.html.includes(`data-cms-chrome="navbar"`));

  const nested = await page('/fr/blog/the-power-of-rainbow');
  ok('it reaches a page that nests its header in a wrapper', nested.html.includes(marker),
    'the article template embeds the navbar inside <header>');

  const restored = await api('/chrome/navbar/restore', { method: 'POST' });
  ok('the original can be restored', restored.status === 200
    && !restored.body?.chrome?.navbar?.html?.includes(marker));
  await new Promise(r => setTimeout(r, 1500));
  ok('the marker is gone from the site', !(await page('/fr')).html.includes(marker));
}

/* ── 12. A page can drop the chrome ──────────────────────────────────────── */
console.log('\nLanding pages without chrome');
{
  const created = await api('/pages', {
    method: 'POST',
    body: JSON.stringify({
      key: 'zz-check-landing',
      route: 'zz-check-landing',
      title: 'Landing check',
      copyFrom: 'tarifs',
    }),
  });
  ok('a landing page can be created', [201, 409].includes(created.status), `status ${created.status}`);
  await api('/pages/zz-check-landing', {
    method: 'PATCH',
    body: JSON.stringify({ chrome: { navbar: false, footer: false } }),
  });
  await api('/pages/zz-check-landing/publish', { method: 'POST' });
  await new Promise(r => setTimeout(r, 1500));

  const landing = await page('/fr/zz-check-landing');
  ok('the landing page renders', landing.status === 200, `status ${landing.status}`);
  ok('it has no header', !/<nav\b[^>]*id="navbar"/.test(landing.html));
  ok('it has no footer', !/<footer\b/.test(landing.html));

  const normal = await page('/fr/tarifs');
  ok('other pages still have theirs', /<nav\b[^>]*id="navbar"/.test(normal.html)
    && /<footer\b/.test(normal.html));
}

/* ── 13. Add-ins ─────────────────────────────────────────────────────────── */
console.log('\nAdd-ins');
{
  const created = await api('/chrome/add-ins', {
    method: 'POST',
    body: JSON.stringify({
      label: 'ZZ check add-in',
      zone: 'bodyEnd',
      html: '<!-- zz-addin-check -->',
      enabled: false,
    }),
  });
  ok('an add-in can be created', created.status === 201, JSON.stringify(created.body).slice(0, 160));
  const key = (created.body?.chrome?.addIns || []).find(a => a.label === 'ZZ check add-in')?.key;
  ok('it starts switched off', !(created.body?.chrome?.addIns || []).find(a => a.key === key)?.enabled);

  await new Promise(r => setTimeout(r, 1500));
  ok('nothing is injected while it is off', !(await page('/fr')).html.includes('zz-addin-check'));

  await api(`/chrome/add-ins/${key}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
  await new Promise(r => setTimeout(r, 1500));
  ok('switching it on injects it everywhere', (await page('/fr')).html.includes('zz-addin-check'));
  ok('and on another page', (await page('/fr/tarifs')).html.includes('zz-addin-check'));

  // Scope it to one page and check it disappears from the others.
  await api(`/chrome/add-ins/${key}`, {
    method: 'PATCH',
    body: JSON.stringify({ pages: ['tarifs'] }),
  });
  await new Promise(r => setTimeout(r, 1500));
  ok('page scoping keeps it on the chosen page', (await page('/fr/tarifs')).html.includes('zz-addin-check'));
  ok('page scoping removes it elsewhere', !(await page('/fr')).html.includes('zz-addin-check'));

  const removed = await api(`/chrome/add-ins/${key}`, { method: 'DELETE' });
  ok('it can be deleted', removed.status === 200);
  await new Promise(r => setTimeout(r, 1500));
  ok('and is gone from the site', !(await page('/fr/tarifs')).html.includes('zz-addin-check'));
}

/* ── 14. The integration proxy ───────────────────────────────────────────── */
console.log('\nIntegration proxy');
{
  const list = await api('/integrations');
  ok('integrations are registered', (list.body?.items || []).length > 0,
    `${(list.body?.items || []).length} found`);
  const raw = JSON.stringify(list.body);
  ok('the admin list never carries a full webhook URL', !/\/webhook\//.test(raw));
  ok('it does show the host, so records are distinguishable',
    (list.body.items[0].upstreamHost || '').includes('.'));
  ok('it shows the path the pages call',
    (list.body.items[0].publicPath || '').startsWith('/api/v1/hooks/'));

  const boot = await page('/api/v1/site/bootstrap');
  ok('the public bootstrap carries no upstream URL', !/\/webhook\//.test(boot.html));

  const gated = await page('/api/v1/site/integrations');
  ok('the endpoint map is not publicly readable', gated.status === 404, `status ${gated.status}`);

  // An unknown slug and a disabled one must be indistinguishable.
  const unknown = await fetch(`${BASE}/api/v1/hooks/zz-not-a-real-endpoint`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  ok('an unknown endpoint is a plain 404', unknown.status === 404, `status ${unknown.status}`);

  const honeypot = await fetch(`${BASE}/api/v1/hooks/livre-blanc-lead`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'bot@example.com', website: 'http://spam' }),
  });
  ok('a honeypot submission is accepted quietly', honeypot.status === 202, `status ${honeypot.status}`);
  const honeypotBody = await honeypot.json();
  ok('and says nothing useful to the bot', JSON.stringify(honeypotBody) === '{"ok":true}',
    JSON.stringify(honeypotBody));

  // Internal addresses must be refused, or the proxy becomes a way in.
  const internal = await api('/integrations', {
    method: 'POST',
    body: JSON.stringify({
      slug: 'zz-check-internal',
      label: 'Internal probe',
      url: 'http://mongo:27017/',
    }),
  });
  ok('an internal address is refused', internal.status === 409, `status ${internal.status}`);
  const loopback = await api('/integrations', {
    method: 'POST',
    body: JSON.stringify({ slug: 'zz-check-loopback', label: 'Loopback', url: 'http://127.0.0.1:4000/' }),
  });
  ok('so is loopback', loopback.status === 409, `status ${loopback.status}`);
}

/* ── 15. Rich copy cannot be flattened ───────────────────────────────────── */
console.log('\nRich copy protection');
{
  const key = 'index.body.rainbow-la-plateforme-souveraine';
  const before = await api(`/strings?q=${encodeURIComponent(key)}`);
  const row = (before.body?.items || []).find(i => i.key === key);
  ok('the homepage headline is a rich string', !!row && /<\d/.test(row.values?.fr || ''),
    JSON.stringify((row?.values?.fr || '').slice(0, 40)));

  const attempt = await api('/strings/bulk', {
    method: 'POST',
    body: JSON.stringify({ items: [{ key, values: { fr: 'Flattened plain text' } }] }),
  });
  ok('flattening it is refused', attempt.status === 400 || attempt.body?.refused?.length > 0,
    `status ${attempt.status} ${JSON.stringify(attempt.body).slice(0, 120)}`);

  const after = await api(`/strings?q=${encodeURIComponent(key)}`);
  const still = (after.body?.items || []).find(i => i.key === key);
  ok('the markup survived the attempt', /<\d/.test(still?.values?.fr || ''),
    JSON.stringify((still?.values?.fr || '').slice(0, 40)));

  // A plain string in the same breath must still save.
  const plainKey = 'index.fonctionnalites.tout-ce-dont-vos-equipes-ont';
  const plain = await api('/strings/bulk', {
    method: 'POST',
    body: JSON.stringify({ items: [{ key: plainKey, values: { fr: 'ZZ check plain edit' } }] }),
  });
  ok('a plain string still saves normally', plain.status === 200 && !plain.body?.refused?.length,
    JSON.stringify(plain.body).slice(0, 120));
}

/* ── 16. Article sections and the contents list ──────────────────────────── */
console.log('\nArticle sections');
let articleId;
{
  const sections = [
    { type: 'keyPoints', data: { title: 'ZZ key points', items: ['One', 'Two'] } },
    { type: 'heading', data: { text: 'ZZ First chapter', level: 2 } },
    { type: 'rich', data: { html: '<p>Body copy that is not a chapter.</p>' } },
    { type: 'heading', data: { text: 'ZZ Sub point', level: 3 } },
    { type: 'quote', data: { text: 'A quote is not a chapter either.' } },
    { type: 'custom', data: { html: '<div class="zz-custom">Custom</div>', css: '.zz-custom { color: rgb(4, 5, 6); }' } },
    { type: 'heading', data: { text: 'ZZ First chapter', level: 2 } },
  ];

  const made = await api('/blog', {
    method: 'POST',
    body: JSON.stringify({
      locale: 'fr',
      title: 'ZZ check article',
      slug: 'zz-check-article',
      excerpt: 'A scratch article used to verify that sections build the contents list.',
      category: 'ZZ Category',
      authorName: 'Verifier',
      coverImage: '/images/collaboration_hero.jpg',
      coverAlt: 'Cover',
      sections,
      status: 'draft',
    }),
  });
  ok('an article can be composed from sections', made.status === 201,
    JSON.stringify(made.body).slice(0, 160));
  articleId = made.body?.post?._id;
  ok('every section gets a key', (made.body?.post?.sections || []).every(s => !!s.key));

  const draftPage = await page('/fr/blog/zz-check-article');
  ok('a draft article is not public', draftPage.status === 404, `status ${draftPage.status}`);

  const published = await api(`/blog/${articleId}/publish`, { method: 'POST' });
  ok('it can be published', published.status === 200);
  await new Promise(r => setTimeout(r, 1500));

  const live = await page('/fr/blog/zz-check-article');
  ok('the published article renders', live.status === 200, `status ${live.status}`);

  // The contents list: headings and the key-points box, not paragraphs or quotes.
  const tocBlock = /<ol class="toc-list" id="toc-list">([\s\S]*?)<\/ol>/.exec(live.html);
  ok('a contents list is emitted', !!tocBlock);
  const anchors = (tocBlock?.[1].match(/href="#([^"]+)"/g) || []).map(a => a.slice(7, -1));
  ok('it lists the headings and the key points', anchors.length === 4,
    JSON.stringify(anchors));
  ok('two chapters with the same name get distinct anchors',
    new Set(anchors).size === anchors.length, JSON.stringify(anchors));
  ok('body copy and quotes are not listed',
    !anchors.some(a => /body-copy|a-quote/.test(a)), JSON.stringify(anchors));
  ok('every contents anchor exists in the page',
    anchors.every(a => live.html.includes(`id="${a}"`)), JSON.stringify(anchors));

  ok('custom section CSS is scoped to the section',
    /\.article-section-[a-z0-9-]+ \.zz-custom/.test(live.html),
    (live.html.match(/\.article-section-[^{]*\{[^}]*\}/) || ['none'])[0]);

  // The breadcrumb and related row come from the post, not the template.
  ok('the breadcrumb shows this article\'s category', live.html.includes('ZZ Category'));
  ok('the breadcrumb links the category to a filtered blog URL',
    live.html.includes('category=zz-category'),
    (live.html.match(/href="[^"]*category=[^"]*"/) || ['none'])[0]);
  ok('the breadcrumb ends on this article', live.html.includes('ZZ check article'));
  ok('the share links are filled in server-side',
    /id="share-x"[^>]*href="https:\/\/twitter\.com/.test(live.html)
    || /href="https:\/\/twitter\.com[^"]*"[^>]*id="share-x"/.test(live.html));

  // Reading time is derived when the author leaves it at zero.
  ok('reading time is derived from the word count', /\d+ min/.test(live.html));
}

/* ── 17. Related articles ────────────────────────────────────────────────── */
console.log('\nRelated articles');
{
  const live = await page('/fr/blog/zz-check-article');
  const related = /aria-labelledby="related-articles-heading"[\s\S]*?<\/section>/.exec(live.html);
  ok('a related section is rendered', !!related);
  const links = (related?.[0].match(/href="\/fr\/blog\/([^"]+)"/g) || []);
  ok('it links only to real articles', links.length > 0 && !links.some(l => l.includes('qu-est-ce-qu-un-webinar')),
    JSON.stringify(links));
  ok('it does not link to itself', !links.some(l => l.includes('zz-check-article')), JSON.stringify(links));
}

/* ── 18. Pages edit the body only ────────────────────────────────────────── */
console.log('\nPages carry body blocks only');
{
  const sections = await api('/pages/index/sections');
  const items = sections.body?.items || [];
  const chrome = items.filter(s => s.role);
  ok('the page still holds its chrome placeholders', chrome.length === 2,
    JSON.stringify(chrome.map(s => s.role)));
  ok('each placeholder is locked', chrome.every(s => s.locked));

  const payload = await api('/site/page?route=&locale=fr');
  const shaped = (payload.body?.page?.sections || []).filter(s => s.role);
  ok('the render payload marks them by role', shaped.length === 2);
  ok('and does not ship a second copy of their markup',
    shaped.every(s => !s.html), JSON.stringify(shaped.map(s => (s.html || '').length)));
  ok('but does ship their leading trivia, so the bytes stay right',
    shaped.every(s => typeof s.trivia === 'string'));
}

/* ── 19. Named image assets ──────────────────────────────────────────────── */
console.log('\nNamed image assets');
{
  // Found by reference, not by filename: the filename changes the moment somebody
  // replaces the image, which is the behaviour under test.
  const list = await api('/media?q=images-collaboration-hero&limit=5');
  const hero = (list.body?.items || []).find(i => i.slug === 'images-collaboration-hero');
  ok('the library has the hero image', !!hero,
    JSON.stringify((list.body?.items || []).map(i => i.slug)));
  if (!hero) throw new Error('the hero asset is missing — run the seed first');
  ok('it has a reference, not just a filename', !!hero.slug, JSON.stringify(hero.slug));

  const usage = await api(`/media/${hero._id}/usage`);
  ok('its uses are reported', usage.status === 200 && usage.body.usage.total > 0,
    `total=${usage.body?.usage?.total}`);
  ok('and split into managed and pinned',
    typeof usage.body.usage.byReference === 'number' && typeof usage.body.usage.byUrl === 'number',
    JSON.stringify({ ref: usage.body.usage.byReference, url: usage.body.usage.byUrl }));

  // Adopting repoints hard-coded uses at the reference.
  const adopted = await api(`/media/${hero._id}/adopt`, { method: 'POST' });
  ok('it can be adopted', adopted.status === 200, JSON.stringify(adopted.body).slice(0, 160));
  const afterAdopt = await api(`/media/${hero._id}/usage`);
  ok('nothing is left pinned to the filename', afterAdopt.body.usage.byUrl === 0,
    `byUrl=${afterAdopt.body.usage.byUrl}`);
  await new Promise(r => setTimeout(r, 1500));

  // The reference must never reach the browser: the renderer resolves it.
  const article = await page('/fr/blog/the-power-of-rainbow');
  ok('the article renders', article.status === 200, `status ${article.status}`);
  ok('no raw reference survives into the HTML', !article.html.includes('/media/a/'),
    (article.html.match(/\/media\/a\/[a-z0-9-]+/) || ['none'])[0]);
  ok('the current file is what ships', article.html.includes(hero.url), hero.url);

  // Replacing the file changes every managed use at once.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'zz-check-replacement.png');
  const replaced = await fetch(`${BASE}/api/v1/media/${hero._id}/replace`, {
    method: 'POST', headers: auth(), body: form,
  });
  const replacedBody = await replaced.json();
  ok('a bundled image can be replaced', replaced.status === 200, JSON.stringify(replacedBody).slice(0, 160));
  const newUrl = replacedBody.item?.url;
  ok('the reference is unchanged by a replacement', replacedBody.item?.slug === hero.slug);
  ok('the previous file is kept', (replacedBody.item?.history || []).length > 0);
  await new Promise(r => setTimeout(r, 1500));

  const afterReplace = await page('/fr/blog/the-power-of-rainbow');
  ok('the page follows the replacement without being edited',
    afterReplace.html.includes(newUrl), newUrl);
  ok('and stops serving the old file', !afterReplace.html.includes(hero.url));

  // Renaming keeps the old reference alive.
  const renamed = await api(`/media/${hero._id}`, {
    method: 'PATCH',
    body: JSON.stringify({ slug: 'zz-check-renamed-ref' }),
  });
  ok('a reference can be renamed', renamed.status === 200, JSON.stringify(renamed.body).slice(0, 140));
  ok('the old reference is kept as an alias',
    (renamed.body.item?.aliases || []).includes(hero.slug),
    JSON.stringify(renamed.body.item?.aliases));
  await new Promise(r => setTimeout(r, 1500));
  ok('pages written against the old reference still work',
    (await page('/fr/blog/the-power-of-rainbow')).html.includes(newUrl));
  // The fallback lives on the API — it is what catches a reference the render
  // pass missed, wherever that reference ended up.
  const alias = await fetch(`${BASE}/api/v1/site/asset/${hero.slug}`, { redirect: 'manual' });
  ok('the old reference still resolves on its own', alias.status === 302, `status ${alias.status}`);

  // Deleting something in use has to be refused.
  const refused = await api(`/media/${hero._id}`, { method: 'DELETE' });
  ok('deleting an image in use is refused', refused.status === 400, `status ${refused.status}`);

  // Put everything back.
  const restored = await api(`/media/${hero._id}/restore`, { method: 'POST' });
  ok('a replacement can be undone', restored.status === 200 && restored.body.item.url === hero.url,
    restored.body?.item?.url);
  await api(`/media/${hero._id}`, { method: 'PATCH', body: JSON.stringify({ slug: hero.slug }) });
  await new Promise(r => setTimeout(r, 1500));
  ok('the original file is serving again',
    (await page('/fr/blog/the-power-of-rainbow')).html.includes(hero.url));
}

/* ── 20. The header is not editable from a page ──────────────────────────── */
console.log('\nChrome is out of bounds on a page');
{
  const url = await api('/pages/index/preview-url?locale=fr&edit=1');
  const exchange = await fetch(url.body.url, { redirect: 'manual' });
  const cookie = (exchange.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const edit = await page('/fr', { cookie });

  ok('the header is marked as a chrome region',
    /<nav[^>]*id="navbar"[^>]*data-cms-chrome-region="navbar"/.test(edit.html));
  ok('the footer is marked too', edit.html.includes('data-cms-chrome-region="footer"'));
  ok('neither is offered as an editable block',
    !/<nav[^>]*id="navbar"[^>]*data-cms-block=/.test(edit.html)
    && !/<footer[^>]*data-cms-block=/.test(edit.html));
  ok('the page keeps its own editable blocks', edit.html.includes('data-cms-block='));
}

/* ── Cleanup ─────────────────────────────────────────────────────────────── */
console.log('\nCleanup');
{
  const baseRoute = (await api('/pages/tarifs')).body?.page?.baseRoute;
  await api('/pages/tarifs', { method: 'PATCH', body: JSON.stringify({ routes: { en: '', de: '' } }) });
  const reverted = await api('/pages/tarifs');
  ok('localized routes can be cleared', !reverted.body?.page?.routes?.en,
    JSON.stringify(reverted.body?.page?.routes));

  for (const key of ['zz-check-page-b', 'zz-check-page', 'zz-check-convert', 'zz-check-landing']) {
    await api(`/pages/${key}`, { method: 'DELETE' });
  }
  if (articleId) {
    const gone = await api(`/blog/${articleId}`, { method: 'DELETE' });
    ok('the scratch article is removed', gone.status === 200, `status ${gone.status}`);
  }
  // The plain string edited above goes back to its authored wording.
  await api('/strings/bulk', {
    method: 'POST',
    body: JSON.stringify({
      items: [{
        key: 'index.fonctionnalites.tout-ce-dont-vos-equipes-ont',
        values: { fr: 'Tout ce dont vos équipes ont besoin se trouve dans Rainbow' },
      }],
    }),
  });
  for (const key of ['zz-check-block', 'zz-check-page-test', 'zz-check-cookie']) {
    await api(`/experiments/${key}`, { method: 'DELETE' });
  }
  const redirects = await api('/redirects');
  for (const r of redirects.body?.items || []) {
    if (r.from?.startsWith('/en/') && r.to === '/en/pricing') {
      await api(`/redirects/${r._id}`, { method: 'DELETE' });
    }
  }
  await new Promise(r => setTimeout(r, 1200));
  const restored = await page(`/en/${baseRoute || 'tarifs'}`);
  ok('the pricing page is back on its shared path', restored.status === 200, `status ${restored.status}`);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
