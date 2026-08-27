/*
 * Integration tests for the content API.
 *
 * They run against a real MongoDB — the behaviour worth testing here is the
 * behaviour of the queries, the access rules and the cache, none of which a
 * mocked driver would exercise. The database name is suffixed so a run never
 * touches development content, and it is dropped at the end.
 *
 * Set MONGODB_URI to point elsewhere; the suite skips itself if no database
 * answers, so `npm test` stays useful on a machine with nothing running.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

const BASE_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rainbow_cms';
process.env.MONGODB_URI = BASE_URI.replace(/(\/[^/?]+)(\?|$)/, '$1_test$2');
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.CACHE_ENABLED = 'false';
process.env.ADMIN_EMAIL = 'test-admin@rainbow.local';
process.env.ADMIN_PASSWORD = 'TestPassword!2026';
process.env.JWT_SECRET = 'test-secret-not-used-anywhere-else';

const { createApp } = await import('../src/app.js');
const { connectMongo, disconnectMongo } = await import('../src/lib/mongo.js');
const { ensureBootstrapUser } = await import('../src/seed/bootstrap.js');
const models = await import('../src/models/index.js');
const mongoose = (await import('mongoose')).default;

let server;
let base;
let token;
let reachable = true;

before(async () => {
  try {
    await connectMongo();
  } catch {
    reachable = false;
    return;
  }
  await mongoose.connection.dropDatabase();
  await ensureBootstrapUser();
  await seedFixtures();

  server = createApp().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const res = await post('/api/v1/auth/login', {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  token = (await res.json()).token;
});

after(async () => {
  if (!reachable) return;
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
  server?.close();
});

async function seedFixtures() {
  await models.Settings.create({
    key: 'global',
    siteName: 'Rainbow test',
    baseUrl: 'https://example.test',
    locales: [
      { code: 'fr', label: 'French', active: true, order: 0 },
      { code: 'en', label: 'English', active: true, order: 1 },
      { code: 'de', label: 'German', active: false, order: 2 },
    ],
  });

  await models.Page.create({
    key: 'home',
    route: '',
    title: 'Home',
    pageKind: 'home',
    status: 'published',
    locales: ['fr', 'en'],
    headRaw: '<meta charset="UTF-8">',
    bodyOpen: '<body>',
    seo: { fr: { title: 'Accueil' }, en: { title: 'Home' } },
    sections: [
      { key: 'hero', label: 'Hero', type: 'html', order: 0, visible: true, html: '<section id="hero"><h1 data-i18n="home.hero.title">Bonjour</h1></section>', keys: ['home.hero.title'] },
      { key: 'foot', label: 'Footer', type: 'html', order: 1, visible: true, html: '<footer>x</footer>', keys: [] },
    ],
  });

  await models.Page.create({
    key: 'secret',
    route: 'secret',
    title: 'Unpublished',
    status: 'draft',
    locales: ['fr'],
    sections: [],
  });

  await models.ContentString.create({
    key: 'home.hero.title',
    page: 'home',
    zone: 'hero',
    values: { fr: 'Bonjour', en: 'Hello' },
  });
}

const url = (path) => `${base}${path}`;
const get = (path, opts = {}) => fetch(url(path), opts);
const post = (path, body, opts = {}) => fetch(url(path), {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  body: JSON.stringify(body),
});
const auth = () => ({ authorization: `Bearer ${token}` });

/*
 * Skip at run time, not at registration time.
 *
 * `test(name, { skip })` reads the option when the test is *registered*, which
 * is while this module is still being evaluated — before `before()` has had a
 * chance to try the connection. So the flag was always still `true` and the
 * suite never skipped: with no database answering, every case ran anyway and
 * failed against `undefined/api/v1/...`, which reads as thirty broken endpoints
 * rather than one absent service.
 *
 * `t.skip()` inside the body is evaluated when the test runs, which is after
 * `before()` has set the flag.
 */
const maybe = (name, fn) => test(name, async (t) => {
  if (!reachable) return t.skip('no MongoDB reachable');
  return fn(t);
});

describe('health', () => {
  maybe('healthz answers without touching the database', async () => {
    const res = await get('/healthz');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  });

  maybe('readyz reports the dependencies', async () => {
    const body = await (await get('/readyz')).json();
    assert.equal(body.mongo, true);
    assert.ok('redis' in body);
  });
});

describe('public content API', () => {
  maybe('bootstrap exposes settings, navigation and experiments', async () => {
    const body = await (await get('/api/v1/site/bootstrap')).json();
    assert.equal(body.settings.siteName, 'Rainbow test');
    assert.ok(Array.isArray(body.settings.locales));
    assert.ok(Array.isArray(body.experiments));
  });

  maybe('a published page is served for a locale it exists in', async () => {
    const res = await get('/api/v1/site/page?route=&locale=fr');
    assert.equal(res.status, 200);
    const { page } = await res.json();
    assert.equal(page.key, 'home');
    assert.equal(page.seo.title, 'Accueil');
    assert.equal(page.sections.length, 2);
  });

  maybe('a locale the page does not cover is a 404', async () => {
    const res = await get('/api/v1/site/page?route=&locale=de');
    assert.equal(res.status, 404);
  });

  maybe('a draft page is invisible without the preview secret', async () => {
    assert.equal((await get('/api/v1/site/page?route=secret&locale=fr')).status, 404);
    const previewed = await get('/api/v1/site/page?route=secret&locale=fr&preview=1', {
      headers: { 'x-preview-secret': process.env.PREVIEW_SECRET || 'dev-preview-secret' },
    });
    assert.equal(previewed.status, 200);
  });

  maybe('the catalogue is returned as a nested object', async () => {
    const body = await (await get('/api/v1/site/catalogue/en')).json();
    assert.equal(body.catalogue.home.hero.title, 'Hello');
  });

  maybe('the route index only lists published pages', async () => {
    const body = await (await get('/api/v1/site/routes')).json();
    assert.ok(body.pages.some(p => p.key === 'home'));
    assert.ok(!body.pages.some(p => p.key === 'secret'));
    assert.deepEqual(body.locales, ['fr', 'en']);
  });

  maybe('an invalid locale is rejected rather than guessed', async () => {
    assert.equal((await get('/api/v1/site/page?route=&locale=not-a-locale')).status, 400);
  });
});

describe('authentication', () => {
  maybe('the admin API refuses anonymous callers', async () => {
    assert.equal((await get('/api/v1/pages')).status, 401);
  });

  maybe('a wrong password is rejected with the same message as a wrong address', async () => {
    const wrongPassword = await post('/api/v1/auth/login', { email: process.env.ADMIN_EMAIL, password: 'nope-not-it-at-all' });
    const wrongEmail = await post('/api/v1/auth/login', { email: 'nobody@rainbow.local', password: 'nope-not-it-at-all' });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongEmail.status, 401);
    assert.equal((await wrongPassword.json()).error, (await wrongEmail.json()).error);
  });

  maybe('a signed-in editor can list pages', async () => {
    const res = await get('/api/v1/pages', { headers: auth() });
    assert.equal(res.status, 200);
    const { items } = await res.json();
    assert.equal(items.length, 2);
    assert.ok(items.every(p => typeof p.sectionCount === 'number'));
  });
});

describe('editing', () => {
  maybe('metadata edits are validated', async () => {
    const res = await fetch(url('/api/v1/pages/home'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({ title: '', unknownField: 1 }),
    });
    assert.equal(res.status, 400);
  });

  maybe('SEO is stored per locale', async () => {
    const res = await fetch(url('/api/v1/pages/home'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({ seo: { fr: { description: 'Une description' } } }),
    });
    assert.equal(res.status, 200);
    const page = await models.Page.findOne({ key: 'home' }).lean();
    assert.equal(page.seo.fr.description, 'Une description');
    assert.equal(page.seo.fr.title, 'Accueil', 'other fields survive the patch');
    assert.equal(page.seo.en.title, 'Home', 'other locales are untouched');
  });

  maybe('reordering sections rejects unknown keys', async () => {
    const res = await post('/api/v1/pages/home/sections/reorder', { order: ['hero', 'nope'] }, { headers: auth() });
    assert.equal(res.status, 400);
  });

  maybe('reordering sections persists the new order', async () => {
    const res = await post('/api/v1/pages/home/sections/reorder', { order: ['foot', 'hero'] }, { headers: auth() });
    assert.equal(res.status, 200);
    const page = await models.Page.findOne({ key: 'home' }).lean();
    assert.deepEqual(page.sections.map(s => s.key), ['foot', 'hero']);
  });

  maybe('editing a block re-derives the copy keys it holds', async () => {
    const res = await fetch(url('/api/v1/pages/home/sections/hero'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({ html: '<section id="hero"><h1 data-i18n="home.hero.other">Salut</h1></section>' }),
    });
    assert.equal(res.status, 200);
    const page = await models.Page.findOne({ key: 'home' }).lean();
    const hero = page.sections.find(s => s.key === 'hero');
    assert.deepEqual(hero.keys, ['home.hero.other']);
  });

  maybe('a page keeps one route to itself', async () => {
    const res = await fetch(url('/api/v1/pages/secret'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({ route: '' }),
    });
    assert.equal(res.status, 409);
  });

  maybe('bulk copy edits apply in one request', async () => {
    const res = await post('/api/v1/strings/bulk', {
      items: [{ key: 'home.hero.title', values: { en: 'Hi there' } }],
    }, { headers: auth() });
    assert.equal(res.status, 200);
    const row = await models.ContentString.findOne({ key: 'home.hero.title' }).lean();
    assert.equal(row.values.en, 'Hi there');
    assert.equal(row.values.fr, 'Bonjour', 'the other language is untouched');
  });

  maybe('publishing a page records when it happened', async () => {
    const res = await post('/api/v1/pages/secret/publish', {}, { headers: auth() });
    assert.equal(res.status, 200);
    const page = await models.Page.findOne({ key: 'secret' }).lean();
    assert.equal(page.status, 'published');
    assert.ok(page.publishedAt instanceof Date);
  });

  maybe('an edit is recorded in the audit log', async () => {
    const entries = await models.AuditLog.find({ action: 'page.update' }).lean();
    assert.ok(entries.length > 0);
    assert.equal(entries[0].userEmail, process.env.ADMIN_EMAIL);
  });

  maybe('a version snapshot is taken before an edit', async () => {
    const versions = await models.Version.find({ entity: 'page', entityId: 'home' }).lean();
    assert.ok(versions.length > 0);
    assert.ok(versions[0].snapshot.sections);
  });
});

describe('forms', () => {
  maybe('a submission is stored', async () => {
    const res = await post('/api/v1/forms/whitepaper', {
      email: 'lead@example.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      locale: 'fr',
      payload: { document: 'livre-blanc' },
    });
    assert.equal(res.status, 201);
    const lead = await models.Lead.findOne({ email: 'lead@example.test' }).lean();
    assert.equal(lead.name, 'Ada Lovelace');
    assert.equal(lead.type, 'whitepaper');
    assert.equal(lead.payload.document, 'livre-blanc');
  });

  maybe('a honeypot submission is accepted and dropped', async () => {
    const res = await post('/api/v1/forms/demo', { email: 'bot@example.test', website: 'http://spam.test' });
    assert.equal(res.status, 202);
    assert.equal(await models.Lead.countDocuments({ email: 'bot@example.test' }), 0);
  });

  maybe('an unknown form type is filed rather than refused', async () => {
    const res = await post('/api/v1/forms/anything-else', { email: 'x@example.test' });
    assert.equal(res.status, 201);
    const lead = await models.Lead.findOne({ email: 'x@example.test' }).lean();
    assert.equal(lead.type, 'other');
  });
});
