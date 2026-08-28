/*
 * Unit tests for the admin's own helpers.
 *
 * Only the pure ones: this runs under `node --test` with no DOM and no bundler,
 * so nothing here imports a component. What it covers is the logic that decides
 * what an editor *reads* — which is where the failures are quiet, because a
 * screen that renders "[object Object]" still renders.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { describeDetails, describeError } from '../apps/cms/src/lib/apiErrors.js';
import {
  isTranslated, translated, pickLocale, localesOf, localiseData,
} from '../packages/core/src/i18nData.js';
import {
  copyUnits, copyEdits, linkTargets, replaceLink, matchLineEndings, structurallyEqual,
} from '../packages/core/src/copy.js';

/* ── The "[object Object]" bug ────────────────────────────────────────────── */

test('a validation failure names the fields it means', () => {
  // The exact shape middleware/validate.js sends.
  const details = [
    { path: 'key', message: 'The key cannot be empty' },
    { path: 'name', message: 'Give the test a name' },
  ];
  const out = describeDetails(details);
  assert.ok(!out.includes('[object Object]'), out);
  assert.ok(out.includes('Give the test a name'), out);
  assert.ok(out.includes('key: The key cannot be empty'), out);
});

test('a duplicate key names the field and the value', () => {
  // The shape the 11000 branch in middleware/error.js used to send raw.
  const out = describeDetails({ slug: 'tarifs' });
  assert.equal(out, 'slug: tarifs');
});

test('a nested field path reads as a path', () => {
  const out = describeDetails([{ path: 'targeting.allocation', message: 'Too small' }]);
  assert.equal(out, 'targeting → allocation: Too small');
});

test('details that are already strings are left alone', () => {
  assert.equal(describeDetails(['Invalid email', 'Missing name']), 'Invalid email; Missing name');
});

test('nothing at all produces nothing, not "undefined"', () => {
  for (const value of [undefined, null, '', [], {}]) {
    assert.equal(describeDetails(value), '', JSON.stringify(value));
  }
});

test('an unrecognised object is dropped rather than stringified', () => {
  // A shape nobody anticipated must not become "[object Object]" again.
  const out = describeDetails([{ nested: { deeper: true } }]);
  assert.ok(!out.includes('[object Object]'), out);
});

test('the same message twice is said once', () => {
  const out = describeDetails([
    { path: 'key', message: 'Required' },
    { path: 'key', message: 'Required' },
  ]);
  assert.equal(out, 'key: Required');
});

test('a long list is truncated with a count', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}`, message: 'Required' }));
  const out = describeDetails(many);
  assert.ok(out.includes('and 4 more'), out);
});

test('the whole error reads as one line', () => {
  assert.equal(
    describeError({ message: 'Validation failed', details: [{ path: 'name', message: 'Give the test a name' }] }),
    'Validation failed — name: Give the test a name',
  );
  // A message with nothing to add does not gain a dangling dash.
  assert.equal(describeError({ message: 'Not allowed' }), 'Not allowed');
  assert.equal(describeError('Session expired'), 'Session expired');
  assert.equal(describeError(undefined), 'Something went wrong');
});

/* ── Translated block data ────────────────────────────────────────────────── */

test('a translation map is recognised only by its marker', () => {
  assert.equal(isTranslated({ __i18n: true, fr: 'a' }), true);
  // A block's ordinary data must never be mistaken for one.
  assert.equal(isTranslated({ fr: 'a' }), false);
  assert.equal(isTranslated('plain'), false);
  assert.equal(isTranslated(['fr']), false);
  assert.equal(isTranslated(null), false);
});

test('an empty language is not stored', () => {
  const value = translated({ fr: 'Blog', en: '', de: null });
  assert.deepEqual(localesOf(value), ['fr']);
});

test('a missing translation falls back to the source language', () => {
  const value = translated({ fr: 'Articles récents', en: 'Recent articles' });
  assert.equal(pickLocale(value, 'en', 'fr'), 'Recent articles');
  assert.equal(pickLocale(value, 'de', 'fr'), 'Articles récents');
});

test('a plain string passes through untouched', () => {
  assert.equal(pickLocale('Blog', 'de', 'fr'), 'Blog');
});

test('data with no translations is returned as the same object', () => {
  const data = { title: 'Blog', promo: { badge: 'Guide' } };
  // Identity, not equality: the page payload is cached and must not be copied
  // on every request to translate a page that has nothing to translate.
  assert.equal(localiseData(data, 'de', 'fr'), data);
});

test('translations resolve at any depth', () => {
  const data = {
    title: translated({ fr: 'Blog Rainbow', de: 'Rainbow Blog' }),
    promo: { badge: translated({ fr: 'Guide pratique', de: 'Praktischer Leitfaden' }) },
    items: [{ label: translated({ fr: 'Un', de: 'Eins' }) }],
  };
  assert.deepEqual(localiseData(data, 'de', 'fr'), {
    title: 'Rainbow Blog',
    promo: { badge: 'Praktischer Leitfaden' },
    items: [{ label: 'Eins' }],
  });
});

/* ── The header's copy and links ──────────────────────────────────────────── */

const NAV = `<nav id="navbar">
  <a href="/fr" class="logo"><img src="/logo.webp" alt="Rainbow" data-i18n-attr="alt:common.nav.logo_alt"></a>
  <a href="/fr/tarifs" data-i18n="common.nav.tarifs">Tarifs</a>
  <a href="#" data-i18n-rich="common.nav.resources">Ressources <span class="chev">v</span></a>
  <a href="https://example.invalid/login" data-i18n="common.nav.signin">Se connecter</a>
  <div class="mobile"><a href="/fr/tarifs" data-i18n="common.nav.tarifs">Tarifs</a></div>
</nav>`;

test('every marked string in the header is listed, in the catalogue\'s own shape', () => {
  const units = copyUnits(NAV);
  const byKey = new Map(units.map(u => [u.key, u]));
  assert.equal(byKey.get('common.nav.tarifs').value, 'Tarifs');
  assert.equal(byKey.get('common.nav.logo_alt').kind, 'attr');
  assert.equal(byKey.get('common.nav.logo_alt').value, 'Rainbow');
  // A rich unit's value is the numbered-placeholder form, which is what the
  // catalogue stores — so the same list can read it and write it.
  assert.match(byKey.get('common.nav.resources').value, /Ressources\s*<0>v<\/0>/);
});

test('editing a word in the markup is reported as a copy change', () => {
  const edited = NAV.replace('>Se connecter<', '>Connexion<');
  const edits = copyEdits(NAV, edited);
  assert.equal(edits.length, 1);
  assert.deepEqual(
    { key: edits[0].key, from: edits[0].from, to: edits[0].to },
    { key: 'common.nav.signin', from: 'Se connecter', to: 'Connexion' },
  );
});

test('a key marked twice is one change, and says so', () => {
  // The desktop bar and the mobile drawer both carry `common.nav.tarifs`, and
  // the catalogue holds one value for it.
  const edited = NAV.split('>Tarifs<').join('>Nos tarifs<');
  const edits = copyEdits(NAV, edited);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].alsoAt, 1);
});

test('adding or removing a marker is not a copy change', () => {
  const withNew = NAV.replace('<div class="mobile">', '<div class="mobile"><span data-i18n="brand.new">Neuf</span>');
  assert.deepEqual(copyEdits(NAV, withNew), []);
});

test('a structural change is not a copy change, and vice versa', () => {
  const copyOnly = NAV.replace('>Tarifs<', '>Nos tarifs<');
  assert.equal(structurallyEqual(NAV, copyOnly), true);

  const structural = NAV.replace('id="navbar"', 'id="navbar" data-sticky="1"');
  assert.equal(structurallyEqual(NAV, structural), false);
});

test('every link is listed, with its own anchor text, and repointed one at a time', () => {
  const links = linkTargets(NAV);
  assert.deepEqual(links.map(l => l.value), [
    '/fr', '/fr/tarifs', 'https://example.invalid/login', '/fr/tarifs',
  ]);
  assert.equal(links[1].label, 'Tarifs');
  assert.equal(links[2].external, true);
  assert.equal(links[0].external, false);

  // Changing the desktop link must leave the mobile one alone.
  const out = replaceLink(NAV, links[1], '/fr/nos-tarifs');
  assert.equal(linkTargets(out).map(l => l.value).join(','), '/fr,/fr/nos-tarifs,https://example.invalid/login,/fr/tarifs');
});

test('an href pointing at an anchor is not a destination to repoint', () => {
  assert.equal(linkTargets(NAV).some(l => l.value === '#'), false);
});

test('a stale offset is refused rather than splicing over the wrong bytes', () => {
  const links = linkTargets(NAV);
  assert.throws(() => replaceLink(NAV, { ...links[1], value: '/fr/moved' }, '/x'), /changed underneath/);
});

test('the textarea\'s line endings are put back the way the file has them', () => {
  assert.equal(matchLineEndings('a\nb\nc', 'x\r\ny'), 'a\r\nb\r\nc');
  assert.equal(matchLineEndings('a\r\nb', 'x\ny'), 'a\nb');
  // Idempotent: saving twice must not double anything.
  assert.equal(matchLineEndings(matchLineEndings('a\nb', 'x\r\ny'), 'x\r\ny'), 'a\r\nb');
});
