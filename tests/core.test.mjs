/*
 * Unit tests for the render core — the part that must never drift, because a
 * bug here changes what visitors see on every page at once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scan, parseAttrs, applyEdits, flatten, unflatten, slugify, attr, replaceElementInner,
} from '../packages/core/src/html.js';
import { collectUnits, stripMarkers } from '../packages/core/src/units.js';
import { render } from '../packages/core/src/render.js';
import { sliceBody, sliceDocument, extractHeadMeta, uniqueKeys } from '../packages/core/src/slice.js';
import { buildHead, buildJsonLd, pageUrl } from '../packages/core/src/seo.js';
import { composeParts, composeDocument } from '../packages/core/src/compose.js';
import { ingestPage, keysIn } from '../packages/core/src/ingest.js';

const DOC = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title data-i18n="p.meta.title">Bonjour</title>
    <meta name="description" content="Une description" data-i18n-attr="content:p.meta.description">
    <link rel="canonical" href="https://example.invalid/">
    <script type="application/ld+json" data-i18n-raw="p.meta.schema">{"@type":"WebPage"}</script>
    <style>.a { color: red }</style>
</head>
<body class="page">
    <nav id="navbar"><a href="/fr/tarifs" data-i18n="p.nav.pricing">Tarifs</a></nav>
    <section id="hero">
        <h1 data-i18n-rich="p.hero.title">Bienvenue chez <span class="brand">Rainbow</span></h1>
        <img src="/x.png" alt="Un logo" data-i18n-attr="alt:p.hero.alt" width="10" height="10">
    </section>
    <footer><p data-i18n="p.footer.copy">Tous droits reserves</p></footer>
    <script>console.log('x => y');</script>
</body>
</html>
`;

const CATALOGUE = {
  p: {
    meta: { title: 'Hello', description: 'A description', schema: '{"@type":"WebPage","name":"Hello"}' },
    nav: { pricing: 'Pricing' },
    hero: { title: 'Welcome to <0>Rainbow</0>', alt: 'A logo' },
    footer: { copy: 'All rights reserved' },
  },
};

test('the scanner does not end a tag on a > inside an attribute value', () => {
  const spans = scan('<div onclick="a => b">x</div>');
  const tags = spans.filter(s => s.kind === 'tag');
  assert.equal(tags.length, 2);
  assert.equal(tags[0].raw, '<div onclick="a => b">');
});

test('raw-text elements are one opaque span', () => {
  const spans = scan('<script>if (a < b) {}</script>');
  const raw = spans.find(s => s.kind === 'raw');
  assert.equal(raw.raw, 'if (a < b) {}');
});

test('attribute offsets point at the value, not the quotes', () => {
  const html = '<img alt="hello">';
  const span = scan(html).find(s => s.kind === 'tag');
  const [a] = parseAttrs(span, html);
  assert.equal(html.slice(a.valueStart, a.valueEnd), 'hello');
});

test('applyEdits refuses overlapping edits', () => {
  assert.throws(() => applyEdits('abcdef', [{ start: 0, end: 3, text: 'X' }, { start: 2, end: 4, text: 'Y' }]));
});

test('flatten and unflatten round trip', () => {
  const nested = { a: { b: { c: 'x' } }, d: 'y' };
  assert.deepEqual(unflatten(flatten(nested)), nested);
});

test('slugify strips accents and caps length', () => {
  assert.equal(slugify('Télécharger l\'application'), 'telecharger-l-application');
  assert.equal(slugify(''), 'txt');
});

test('units are elements, and a marked child yields to its parent', () => {
  const { order } = collectUnits(DOC);
  const rich = order.find(u => u.type === 'rich');
  assert.ok(rich, 'the h1 with inline markup is a rich unit');
  assert.equal(rich.value, 'Bienvenue chez <0>Rainbow</0>');
});

test('render translates text, rich markup and attributes', () => {
  const out = render(DOC, CATALOGUE, 'en');
  assert.match(out, /<title>Hello<\/title>/);
  assert.match(out, /content="A description"/);
  assert.match(out, /<h1>Welcome to <span class="brand">Rainbow<\/span><\/h1>/);
  assert.match(out, /alt="A logo"/);
  assert.match(out, /All rights reserved/);
});

test('render rewrites internal links to the rendered locale', () => {
  const out = render(DOC, CATALOGUE, 'en');
  assert.match(out, /href="\/en\/tarifs"/);
  assert.match(out, /<html lang="en">/);
});

test('render leaves the document untouched when the catalogue is empty', () => {
  const out = render(DOC, {}, 'fr');
  assert.match(out, /Bienvenue chez <span class="brand">Rainbow<\/span>/);
  // The copy markers come off even with nothing to splice in. data-i18n-raw
  // stays: the JSON-LD it marks is lifted into the page's SEO fields at ingest,
  // so it never reaches a published page through this path.
  assert.ok(!/data-i18n(?:-rich|-attr)?=/.test(out), 'copy markers are stripped');
});

test('a missing key leaves the source copy in place and is reported', () => {
  const missing = [];
  const out = render(DOC, { p: { nav: { pricing: 'Pricing' } } }, 'en', { onMissing: k => missing.push(k) });
  assert.match(out, /Bienvenue chez/);
  assert.ok(missing.includes('p.hero.title'));
});

test('slicing the body is lossless', () => {
  const { blocks, bodyInner } = sliceDocument(DOC);
  assert.equal(blocks.map(b => b.html).join(''), bodyInner);
  assert.deepEqual(blocks.map(b => b.tag), ['nav', 'section', 'footer', 'script']);
});

test('inline scripts are marked structural', () => {
  const blocks = sliceBody('<section>a</section>\n<script>var x = 1;</script>');
  assert.equal(blocks[1].type, 'script');
});

test('block keys are made unique within a page', () => {
  const keyed = uniqueKeys([{ key: 'hero' }, { key: 'hero' }, { key: 'hero' }]);
  assert.deepEqual(keyed.map(b => b.key), ['hero', 'hero-2', 'hero-3']);
});

test('head extraction lifts the metadata and keeps the rest verbatim', () => {
  const { headRaw } = sliceDocument(DOC);
  const { meta, jsonLd, headRest } = extractHeadMeta(headRaw);
  assert.equal(meta.title.value, 'Bonjour');
  assert.equal(meta.title.i18nKey, 'p.meta.title');
  assert.equal(meta.description.i18nKey, 'p.meta.description');
  assert.equal(jsonLd.length, 1);
  assert.match(headRest, /<meta charset="UTF-8">/);
  assert.match(headRest, /<style>/);
  assert.ok(!headRest.includes('<title'));
  assert.ok(!headRest.includes('ld+json'));
});

test('ingest produces a page whose blocks carry their keys', () => {
  const page = ingestPage({ key: 'p', route: 'p', title: 'P' }, DOC, { fr: CATALOGUE, en: CATALOGUE }, ['fr', 'en']);
  assert.equal(page.route, 'p');
  assert.equal(page.seo.en.title, 'Hello');
  assert.ok(page.sections.length >= 3);
  const hero = page.sections.find(s => s.key === 'hero');
  assert.deepEqual(hero.keys, ['p.hero.title', 'p.hero.alt']);
});

test('keysIn lists every marker kind', () => {
  const keys = keysIn('<p data-i18n="a.b">Copy</p><img alt="A logo" data-i18n-attr="alt:c.d"><script data-i18n-js="e.js"></script>');
  assert.deepEqual(keys, ['a.b', 'c.d', 'e.js']);
});

test('stripMarkers removes every marker attribute', () => {
  const out = stripMarkers('<p data-i18n="a.b" class="c" data-i18n-attr="alt:x">y</p>');
  assert.equal(out, '<p class="c">y</p>');
});

test('composition reproduces the authored body byte for byte', () => {
  const page = ingestPage({ key: 'p', route: 'p', title: 'P' }, DOC, { fr: CATALOGUE }, ['fr']);
  const { parts } = composeParts(page, { locale: 'fr', catalogue: {}, sourceLocale: 'fr', settings: {} });
  const body = parts.map(p => p.html).join('');
  const { bodyInner } = sliceDocument(DOC);
  assert.equal(body, stripMarkers(bodyInner).replace(/ data-i18n-raw="[^"]*"/g, ''));
});

test('a hidden block contributes nothing', () => {
  const page = ingestPage({ key: 'p', route: 'p', title: 'P' }, DOC, { fr: CATALOGUE }, ['fr']);
  page.sections.find(s => s.tag === 'footer').visible = false;
  const { parts } = composeParts(page, { locale: 'fr', catalogue: CATALOGUE, sourceLocale: 'fr', settings: {} });
  assert.ok(!parts.map(p => p.html).join('').includes('<footer>'));
});

test('an A/B variant replaces only its own block', () => {
  const page = ingestPage({ key: 'p', route: 'p', title: 'P' }, DOC, { fr: CATALOGUE }, ['fr']);
  const hero = page.sections.find(s => s.key === 'hero');
  hero.experiment = { key: 'hero-test', variants: [{ key: 'B', html: '<section id="hero">variant</section>' }] };

  // No catalogue: the authored French copy is what should survive in the control.
  const control = composeParts(page, { locale: 'fr', catalogue: {}, sourceLocale: 'fr', settings: {} });
  const variant = composeParts(page, { locale: 'fr', catalogue: {}, sourceLocale: 'fr', settings: {}, variants: { 'hero-test': 'B' } });

  assert.ok(control.parts.some(p => p.html.includes('Bienvenue')));
  assert.ok(variant.parts.some(p => p.html.includes('variant')));
  assert.ok(variant.parts.some(p => p.html.includes('<footer>')), 'other blocks are untouched');
});

test('snippets land in their zones as markup, per page and site-wide', () => {
  const page = ingestPage({ key: 'p', route: 'p', title: 'P' }, DOC, { fr: CATALOGUE }, ['fr']);
  page.snippets = { head: '<meta name="verify" content="1">', body: '<!-- body -->', footer: '<!-- foot -->' };
  const doc = composeDocument(page, {
    locale: 'fr',
    catalogue: CATALOGUE,
    sourceLocale: 'fr',
    baseUrl: 'https://example.test',
    settings: {},
    translations: [],
    // Site-wide code is an add-in on the chrome document: named, switchable and
    // filterable, rather than the three anonymous settings fields it replaced.
    chrome: {
      addIns: [{ key: 'analytics', zone: 'head', html: '<!-- global -->', enabled: true }],
    },
  });
  assert.match(doc, /<!-- global -->/);
  assert.match(doc, /<meta name="verify" content="1">/);
  assert.ok(doc.indexOf('<!-- body -->') < doc.indexOf('<!-- foot -->'));
  assert.ok(doc.indexOf('<!-- foot -->') < doc.indexOf('</body>'));
});

test('a switched-off add-in is not emitted', () => {
  const page = ingestPage({ key: 'p', route: 'p', title: 'P' }, DOC, { fr: CATALOGUE }, ['fr']);
  const doc = composeDocument(page, {
    locale: 'fr',
    catalogue: CATALOGUE,
    sourceLocale: 'fr',
    baseUrl: 'https://example.test',
    settings: {},
    translations: [],
    chrome: {
      addIns: [{ key: 'chat', zone: 'bodyEnd', html: '<!-- chat widget -->', enabled: false }],
    },
  });
  assert.ok(!doc.includes('<!-- chat widget -->'));
});

test('canonical is the current locale and hreflang omits missing translations', () => {
  const head = buildHead(
    { route: 'tarifs', seo: { title: 'Pricing', description: 'd' } },
    {
      locale: 'en',
      baseUrl: 'https://example.test',
      settings: { siteName: 'Rainbow' },
      translations: [
        { locale: 'en', url: 'https://example.test/en/tarifs/' },
        { locale: 'fr', url: 'https://example.test/fr/tarifs/' },
      ],
    },
  );
  assert.match(head, /<link rel="canonical" href="https:\/\/example\.test\/en\/tarifs\/">/);
  assert.match(head, /hreflang="x-default" href="https:\/\/example\.test\/en\/tarifs\/"/);
  assert.ok(!head.includes('hreflang="de"'), 'a locale with no translation gets no entry');
});

test('a campaign entry point is noindex and drops its canonical', () => {
  const head = buildHead({ route: 'lp', seo: { title: 't' } }, {
    locale: 'fr', baseUrl: 'https://example.test', settings: {}, translations: [], noindex: true,
  });
  assert.match(head, /content="noindex, nofollow"/);
  assert.ok(!head.includes('rel="canonical"'));
});

test('empty metadata emits no tag at all', () => {
  const head = buildHead({ route: '', seo: {} }, {
    locale: 'fr', baseUrl: 'https://example.test', settings: {}, translations: [],
  });
  assert.ok(!head.includes('content=""'));
  assert.ok(!head.includes('<title>'));
});

test('structured data is generated per page type', () => {
  const home = buildJsonLd({ pageKind: 'home', seo: {} }, {
    locale: 'fr', baseUrl: 'https://example.test', settings: { siteName: 'Rainbow' },
  });
  assert.match(home, /"@type": "Organization"/);
  assert.match(home, /"@type": "WebSite"/);

  const post = buildJsonLd({ pageKind: 'blogPost', route: 'blog/x', seo: { title: 'T' } }, {
    locale: 'fr', baseUrl: 'https://example.test', settings: {},
    post: { title: 'T', publishedAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.match(post, /"@type": "Article"/);
  assert.match(post, /"@type": "BreadcrumbList"/);
});

test('replaceAutoLd swaps the generated data out entirely', () => {
  const out = buildJsonLd(
    { pageKind: 'home', seo: { replaceAutoLd: true, jsonLdOverride: '{"@type":"Thing"}' } },
    { locale: 'fr', baseUrl: 'https://example.test', settings: {} },
  );
  assert.match(out, /"@type":"Thing"/);
  assert.ok(!out.includes('"@type": "Organization"'));
});

test('page URLs always carry their locale', () => {
  assert.equal(pageUrl('https://example.test/', 'fr', ''), 'https://example.test/fr/');
  assert.equal(pageUrl('https://example.test', 'de', '/products/'), 'https://example.test/de/products/');
});

test('replaceElementInner replaces a whole nested container', () => {
  // The article body is a div full of divs. A lazy regex stops at the first
  // inner </div> and leaves the tail of the old article on the page.
  const html = '<article><div itemprop="articleBody"><p>old</p><div class="box"><ul><li>x</li></ul></div><p>tail</p></div><footer>f</footer></article>';
  const out = replaceElementInner(html, 'itemprop="articleBody"', '<p>new</p>');
  assert.equal(out, '<article><div itemprop="articleBody"><p>new</p></div><footer>f</footer></article>');
  assert.ok(!out.includes('tail'), 'nothing of the old contents survives');
  assert.ok(out.includes('<footer>f</footer>'), 'siblings are untouched');
});

test('replaceElementInner skips a void element carrying the same attribute', () => {
  const html = '<meta itemprop="articleSection" content="Old"><span itemprop="articleSection">Old</span>';
  const out = replaceElementInner(html, 'itemprop="articleSection"', 'New');
  assert.equal(out, '<meta itemprop="articleSection" content="Old"><span itemprop="articleSection">New</span>');
});

test('replaceElementInner leaves markup alone when it cannot match safely', () => {
  assert.equal(replaceElementInner('<p>x</p>', 'itemprop="nope"', 'y'), '<p>x</p>');
  // Unbalanced: no closing tag to anchor on, so nothing is rewritten.
  assert.equal(replaceElementInner('<div itemprop="body"><p>x</p>', 'itemprop="body"', 'y'), '<div itemprop="body"><p>x</p>');
});

test('attr reads a value off a raw tag', () => {
  assert.equal(attr('<div id="x" class=\'y\'>', 'class'), 'y');
  assert.equal(attr('<div>', 'id'), null);
});
