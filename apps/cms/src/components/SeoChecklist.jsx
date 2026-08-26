/*
 * SeoChecklist — what is actually wrong with this page, measured on the page.
 *
 * Every field in the SEO tab can be filled in perfectly while the rendered page
 * still has two H1s and eleven images with no alt text. So this fetches the page
 * as a crawler would receive it and reads the result, rather than scoring the
 * form the editor just filled in.
 *
 * Only checks that change a decision are listed. "Add a focus keyword" is not a
 * check, it is a plugin selling itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { Panel, Icon, Spinner } from './ui.jsx';

export default function SeoChecklist({ page, locale, seo }) {
  const [state, setState] = useState({ loading: false, error: null, checks: null, stats: null });

  const route = page.routes?.[locale] || page.route;
  const url = `/${locale}${route ? `/${route}` : ''}`;

  const run = useCallback(async () => {
    setState({ loading: true, error: null, checks: null, stats: null });
    try {
      // Same origin through the gateway, so this is the published bytes — not a
      // reconstruction, and not the draft.
      const res = await fetch(url, { headers: { accept: 'text/html' }, credentials: 'omit' });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      setState({ loading: false, error: null, ...audit(doc, { page, locale, seo, status: res.status }) });
    } catch (err) {
      setState({ loading: false, error: err, checks: null, stats: null });
    }
  }, [url, page, locale, seo]);

  useEffect(() => { run(); }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const failed = (state.checks || []).filter(c => c.level === 'fail').length;
  const warned = (state.checks || []).filter(c => c.level === 'warn').length;

  return (
    <Panel
      title="On-page check"
      actions={(
        <button className="btn btn--sm" onClick={run} disabled={state.loading}>
          <Icon name="refresh" /> Re-check
        </button>
      )}
    >
      {state.loading && <Spinner label="Reading the live page…" />}
      {state.error && (
        <p className="muted">
          Could not read {url} — {state.error.message}
        </p>
      )}

      {state.checks && (
        <>
          <div className="inline" style={{ marginBottom: 12 }}>
            {failed === 0 && warned === 0
              ? <span className="badge badge--ok">Nothing to fix</span>
              : (
                <>
                  {failed > 0 && <span className="badge badge--danger">{failed} to fix</span>}
                  {warned > 0 && <span className="badge badge--warn">{warned} to look at</span>}
                </>
              )}
            {state.stats && (
              <span className="muted" style={{ fontSize: 12 }}>
                {state.stats.words.toLocaleString()} words · {state.stats.images} images ·{' '}
                {state.stats.links} links
              </span>
            )}
          </div>

          <ul className="checks">
            {state.checks.map(check => (
              <li key={check.id} className={`checks__row is-${check.level}`}>
                <span className="checks__icon" aria-hidden="true">
                  {check.level === 'pass' ? '✓' : check.level === 'warn' ? '!' : '×'}
                </span>
                <span>
                  <strong>{check.label}</strong>
                  {check.detail && <span className="checks__detail"> {check.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/**
 * Read a rendered document and report what a crawler would hold against it.
 *
 * The thresholds are the ones that correspond to observable behaviour — the
 * ~60 characters Google renders of a title, the single H1 that defines a page's
 * subject, the alt text image search reads — not round numbers.
 */
function audit(doc, { page, locale, status }) {
  const checks = [];
  const add = (id, level, label, detail) => checks.push({ id, level, label, detail });

  const text = doc.body?.textContent || '';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const images = [...doc.querySelectorAll('img')];
  const links = [...doc.querySelectorAll('a[href]')];

  if (status !== 200) add('status', 'fail', `The page answers ${status}`, 'Publish it, or fix the route.');

  const title = doc.querySelector('title')?.textContent?.trim() || '';
  if (!title) add('title', 'fail', 'No title tag', 'This is the single most important tag on the page.');
  else if (title.length > 65) add('title', 'warn', `Title is ${title.length} characters`, 'Google shows about 60 — the rest is cut off.');
  else if (title.length < 25) add('title', 'warn', `Title is only ${title.length} characters`, 'There is room to say more.');
  else add('title', 'pass', 'Title length is right', `${title.length} characters.`);

  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
  if (!description) add('desc', 'fail', 'No meta description', 'Google will invent one from the page copy.');
  else if (description.length > 165) add('desc', 'warn', `Description is ${description.length} characters`, 'About 155 is shown.');
  else if (description.length < 60) add('desc', 'warn', `Description is only ${description.length} characters`, 'Short descriptions get replaced.');
  else add('desc', 'pass', 'Description length is right', `${description.length} characters.`);

  const h1s = [...doc.querySelectorAll('h1')];
  if (h1s.length === 0) add('h1', 'fail', 'No H1', 'Nothing on the page states its subject in a heading.');
  else if (h1s.length > 1) add('h1', 'warn', `${h1s.length} H1 headings`, 'One page, one subject, one H1.');
  else add('h1', 'pass', 'Exactly one H1', truncate(h1s[0].textContent.trim(), 50));

  // Heading order: a jump from H2 to H4 is what breaks screen-reader navigation.
  const levels = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => Number(h.tagName[1]));
  const jump = levels.findIndex((lvl, i) => i > 0 && lvl - levels[i - 1] > 1);
  if (jump > 0) add('headings', 'warn', 'Heading levels skip a step', `H${levels[jump - 1]} is followed by H${levels[jump]}.`);
  else if (levels.length > 1) add('headings', 'pass', 'Heading order is clean');

  const noAlt = images.filter(img => !img.getAttribute('alt')?.trim());
  if (images.length && noAlt.length) {
    add('alt', noAlt.length > images.length / 2 ? 'fail' : 'warn',
      `${noAlt.length} of ${images.length} images have no alt text`,
      'Alt text is what image search reads, and what a screen reader announces.');
  } else if (images.length) {
    add('alt', 'pass', 'Every image has alt text', `${images.length} images.`);
  }

  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const expected = `/${locale}${page.routes?.[locale] || page.route ? `/${page.routes?.[locale] || page.route}` : ''}`;
  if (!canonical) add('canonical', page.noindex ? 'pass' : 'fail', 'No canonical link', 'Expected when the page is noindex.');
  else if (!canonical.includes(expected.replace(/\/$/, ''))) {
    add('canonical', 'warn', 'Canonical points elsewhere', canonical);
  } else add('canonical', 'pass', 'Canonical points at this page');

  const alternates = [...doc.querySelectorAll('link[rel="alternate"][hreflang]')]
    .map(l => l.getAttribute('hreflang')).filter(l => l !== 'x-default');
  const declared = (page.locales || []).filter(Boolean);
  if (declared.length > 1) {
    const missing = declared.filter(l => !alternates.includes(l));
    if (missing.length) add('hreflang', 'warn', `No hreflang for ${missing.join(', ')}`, 'The page says it exists in those languages.');
    else add('hreflang', 'pass', `hreflang lists ${alternates.length} languages`);
  }

  const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  const types = ld.flatMap((s) => {
    try {
      const parsed = JSON.parse(s.textContent);
      return (Array.isArray(parsed) ? parsed : [parsed]).map(p => p['@type']).filter(Boolean);
    } catch { return ['(invalid JSON)']; }
  });
  if (types.includes('(invalid JSON)')) add('ld', 'fail', 'A JSON-LD block does not parse', 'Google will ignore all of it.');
  else if (!types.length) add('ld', 'warn', 'No structured data', 'Rich results need it.');
  else add('ld', 'pass', 'Structured data present', types.join(', '));

  const og = doc.querySelector('meta[property="og:image"]');
  if (!og) add('og', 'warn', 'No social preview image', 'Links to this page will share as a bare text card.');
  else add('og', 'pass', 'Social preview image set');

  if (words < 250 && page.pageKind !== 'form' && page.pageKind !== 'error') {
    add('thin', 'warn', `Only ${words} words of copy`, 'Thin pages struggle to rank for anything competitive.');
  } else if (words >= 250) {
    add('thin', 'pass', `${words.toLocaleString()} words of copy`);
  }

  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
  if (/noindex/i.test(robots)) {
    add('robots', page.noindex ? 'pass' : 'fail', 'This page is set to noindex',
      page.noindex ? 'Deliberate — set under Settings.' : 'Nothing in the CMS asked for that.');
  }

  const emptyLinks = links.filter(a => !a.textContent.trim() && !a.querySelector('img[alt]'));
  if (emptyLinks.length) add('anchors', 'warn', `${emptyLinks.length} links have no text`, 'A crawler cannot tell what they point at.');

  const order = { fail: 0, warn: 1, pass: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level]);

  return { checks, stats: { words, images: images.length, links: links.length } };
}

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
