#!/usr/bin/env node
/*
 * seed.js — load the authored site into MongoDB.
 *
 * This is the migration: the static HTML, its translation catalogues, the
 * navigation copy, the partner directory and the bundled media all become
 * database rows. It is written to be re-runnable — a second run updates the
 * templates but leaves anything an editor has since changed alone, unless
 * --force says otherwise.
 *
 *   node src/seed/seed.js            update templates, keep CMS edits
 *   node src/seed/seed.js --force    overwrite CMS edits with the source files
 *   node src/seed/seed.js --reset    drop content collections first
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { connectMongo, disconnectMongo } from '../lib/mongo.js';
import { bumpRevision, closeRedis } from '../lib/redis.js';
import { logger } from '../lib/log.js';
import { ensureBootstrapUser, migrateGlobalSnippets } from './bootstrap.js';
import {
  Page, ContentString, Settings, Navigation, BlogPost, Media, Partner, Chrome, Integration, Form,
} from '../models/index.js';
import { ingestPage, ingestStrings } from '@rainbow/core/ingest';
import { slugify } from '@rainbow/core/html';
import { withoutLeadingTrivia } from '@rainbow/core/compose';
import { LOCALES } from '@rainbow/core/locales';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = process.env.CONTENT_SOURCE_DIR
  ? path.resolve(process.env.CONTENT_SOURCE_DIR)
  : path.resolve(HERE, '../../../../content-source');
const PUBLIC_DIR = process.env.WEB_PUBLIC_DIR
  ? path.resolve(process.env.WEB_PUBLIC_DIR)
  : path.resolve(HERE, '../../../web/public');

const FORCE = process.argv.includes('--force');
const RESET = process.argv.includes('--reset');

const read = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function main() {
  logger.info({ CONTENT_DIR, force: FORCE, reset: RESET }, 'seeding');
  await connectMongo();

  if (RESET) {
    await Promise.all([
      Page.deleteMany({}), ContentString.deleteMany({}), Navigation.deleteMany({}),
      BlogPost.deleteMany({}), Media.deleteMany({ source: 'bundled' }), Partner.deleteMany({}),
    ]);
    logger.warn('content collections dropped');
  }

  const registry = readJson(path.join(CONTENT_DIR, 'pages.registry.json'));
  const catalogues = {};
  for (const locale of registry.locales) {
    const file = path.join(CONTENT_DIR, 'i18n', `${locale}.json`);
    if (fs.existsSync(file)) catalogues[locale] = readJson(file);
  }

  await ensureBootstrapUser();
  await seedSettings(registry);
  const { seoKeys } = await seedPages(registry, catalogues);
  await seedStrings(catalogues, registry.locales, seoKeys);
  await seedNavigation();
  await seedChrome();
  await migrateGlobalSnippets();
  await seedIntegrations();
  await seedForms();
  await seedBlog(registry, catalogues);
  await seedMedia();
  await seedPartners();

  await bumpRevision('seed');
  logger.info('seed complete');
}

async function seedSettings(registry) {
  const existing = await Settings.findOne({ key: 'global' });
  if (existing && !FORCE) {
    logger.info('settings already present — left as they are');
    return existing;
  }
  const locales = LOCALES.map((l, i) => ({ ...l, order: i }))
    .map(l => ({ ...l, active: registry.routedLocales.includes(l.code) }));

  const doc = await Settings.findOneAndUpdate(
    { key: 'global' },
    {
      $set: {
        siteName: 'Rainbow by ALE',
        baseUrl: process.env.SITE_URL || 'http://localhost:3000',
        defaultLocale: registry.sourceLocale,
        sourceLocale: registry.sourceLocale,
        locales,
        defaultTitle: 'Rainbow by ALE — Cloud Communication & Collaboration Platform',
        defaultDescription: 'Rainbow by Alcatel-Lucent: secure cloud communication and collaboration. Messaging, video conferencing and file sharing for teams of all sizes.',
        defaultOgImage: '/images/Rainbow-AL-logo-banner.webp',
        organizationName: 'ALE International',
        organizationLogo: '/images/rainbow-logo.png',
      },
    },
    { upsert: true, new: true },
  );
  logger.info('settings seeded');
  return doc;
}

async function seedPages(registry, catalogues) {
  const seoKeys = new Set();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const spec of registry.pages) {
    const file = path.join(CONTENT_DIR, 'pages', spec.file);
    if (!fs.existsSync(file)) {
      logger.warn({ file: spec.file }, 'template missing — skipped');
      continue;
    }
    const html = read(file);
    const hash = sha(html);
    const doc = ingestPage(spec, html, catalogues, registry.locales);
    doc.locales = registry.routedLocales;
    doc.sourceFile = spec.file;
    doc.sourceHash = hash;
    for (const k of doc.seoKeys) seoKeys.add(k);

    const existing = await Page.findOne({ key: spec.key });
    if (!existing) {
      await Page.create({ ...doc, publishedAt: new Date() });
      created++;
      continue;
    }
    if (existing.sourceHash === hash && !FORCE) { skipped++; continue; }
    if (existing.editedInCms && !FORCE) {
      logger.warn({ key: spec.key }, 'page edited in the CMS and the template changed — run with --force to overwrite');
      skipped++;
      continue;
    }
    // Keep what the CMS owns; refresh what the template owns.
    await Page.updateOne({ key: spec.key }, {
      $set: {
        doctype: doc.doctype,
        htmlOpen: doc.htmlOpen,
        bodyOpen: doc.bodyOpen,
        bodyOpenRaw: doc.bodyOpenRaw,
        headRaw: doc.headRaw,
        sections: doc.sections,
        jsonLd: doc.jsonLd,
        seoKeys: doc.seoKeys,
        sourceFile: doc.sourceFile,
        sourceHash: doc.sourceHash,
        ...(FORCE ? { seo: doc.seo, editedInCms: false } : {}),
      },
    });
    updated++;
  }

  logger.info({ created, updated, skipped }, 'pages seeded');
  return { seoKeys };
}

async function seedStrings(catalogues, locales, seoKeys) {
  const rows = ingestStrings(catalogues, locales, seoKeys);
  const existing = new Map(
    (await ContentString.find({}, { key: 1, _id: 0 }).lean()).map(r => [r.key, true]),
  );

  const ops = [];
  for (const row of rows) {
    if (existing.has(row.key) && !FORCE) {
      // Only fill locales that have no value yet: never clobber a translation
      // somebody improved in the CMS.
      const set = {};
      for (const [locale, value] of Object.entries(row.values)) {
        set[`values.${locale}`] = value;
      }
      ops.push({
        updateOne: {
          filter: { key: row.key },
          update: [{
            $set: Object.fromEntries(Object.entries(set).map(([field, value]) => [
              field,
              { $cond: [{ $in: [{ $ifNull: [`$${field}`, ''] }, ['', null]] }, value, `$${field}`] },
            ])),
          }],
        },
      });
    } else {
      ops.push({ updateOne: { filter: { key: row.key }, update: { $set: row }, upsert: true } });
    }
  }
  for (let i = 0; i < ops.length; i += 500) {
    await ContentString.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  }
  logger.info({ strings: rows.length }, 'content strings seeded');
}

async function seedNavigation() {
  const file = path.join(CONTENT_DIR, 'navigation.seed.json');
  if (!fs.existsSync(file)) return;
  const existing = await Navigation.findOne({ key: 'main' });
  if (existing && !FORCE) {
    logger.info('navigation already present — left as it is');
    return;
  }
  const seed = readJson(file);
  seed.items = seed.items.map((item, i) => ({ ...item, order: i }));
  await Navigation.findOneAndUpdate({ key: 'main' }, { $set: seed }, { upsert: true });
  logger.info({ items: seed.items.length }, 'navigation seeded');
}

/**
 * The one authored article becomes a real blog post so the collection is not
 * empty on day one. It keeps a pointer to the page that renders it verbatim,
 * so the published URL is unchanged while new articles use the template.
 */
/**
 * Consolidate the header and footer into one document, and mark the placeholder
 * on every page.
 *
 * Each migrated page arrived with its own copy of both. The markup was the same
 * everywhere; what differed was the translation key on each string, because the
 * extractor minted a fresh key every time it met the same sentence on a new
 * page. In French that was invisible. In English and German it was not: the same
 * footer said different things — or nothing, falling back to French — depending
 * on which page you were reading.
 *
 * `CMS_PAGE_SECTIONS.md` already names the homepage's header and footer as the
 * canonical pair, so those are the ones kept. Every page's own copy stays in the
 * database untouched, as the record of what that page used to ship; it simply
 * stops being rendered.
 *
 * Re-runnable: the marking is idempotent, and an edited chrome document is left
 * alone unless --force.
 */
async function seedChrome() {
  const home = await Page.findOne({ pageKind: 'home' }).lean()
    || await Page.findOne({ route: '' }).lean();
  if (!home) {
    logger.warn('no homepage found — header and footer not consolidated');
    return;
  }

  const pick = (predicate) => (home.sections || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .find(predicate);

  const navbar = pick(s => s.tag === 'nav' && (s.anchorId === 'navbar' || s.key === 'navbar'));
  const footer = pick(s => s.tag === 'footer');

  // The element only. The whitespace and comment that preceded it in the
  // authored page belong to the page, not to the header — a page that nests its
  // navbar inside a wrapper has its own surroundings, and re-emitting the
  // homepage's would insert stray bytes there. Each placeholder contributes its
  // own trivia back at render time.
  const navHtml = withoutLeadingTrivia(navbar?.html || '');
  const footerHtml = withoutLeadingTrivia(footer?.html || '');

  const existing = await Chrome.findOne({ key: 'default' });
  if (!existing) {
    await Chrome.create({
      key: 'default',
      navbar: { html: navHtml, authoredHtml: navHtml, visible: !!navbar },
      footer: { html: footerHtml, authoredHtml: footerHtml, visible: !!footer },
    });
    logger.info({ navbar: navHtml.length, footer: footerHtml.length },
      'header and footer consolidated from the homepage');
  } else if (FORCE) {
    existing.navbar.html = navHtml;
    existing.navbar.authoredHtml = navHtml;
    existing.navbar.edited = false;
    existing.footer.html = footerHtml;
    existing.footer.authoredHtml = footerHtml;
    existing.footer.edited = false;
    await existing.save();
    logger.warn('header and footer reset to the authored homepage copies');
  } else {
    logger.info('header and footer already set up — left as they are');
  }

  // Mark where the chrome goes on every page. A page with no header block (the
  // standalone form pages) simply gets no placeholder and renders without one.
  let marked = 0;
  for (const page of await Page.find({}, { sections: 1, key: 1 })) {
    let touched = false;
    for (const section of page.sections) {
      const isNav = section.tag === 'nav' && (section.anchorId === 'navbar' || section.key === 'navbar');
      const isFooter = section.tag === 'footer';
      const role = isNav ? 'navbar' : isFooter ? 'footer' : null;
      if (role && section.role !== role) {
        section.role = role;
        // The placeholder is structural: its position is the page's layout, and
        // its content is not this page's to edit.
        section.locked = true;
        touched = true;
      }
    }
    if (touched) { await page.save(); marked++; }
  }
  logger.info({ pages: marked }, 'chrome placeholders marked');
}

/**
 * Register the outbound endpoints the authored pages call.
 *
 * Seeding these is what switches the proxy on: until an integration exists, the
 * renderer has nothing to repoint and the pages keep calling the automation
 * platform directly, exactly as they did before. Existing records are left
 * alone — the CMS owns them once they are here.
 */
/**
 * The forms the site needs, with the field names its endpoints demand.
 *
 * Created once and then left alone. A form is editorial from the moment somebody
 * opens it — the wording, the field order, the thank-you copy are all theirs —
 * so a re-seed that "corrected" them would undo a morning's work. The
 * integrations' transport is repaired on re-seed because a method is a fact;
 * a consent line is not.
 */
async function seedForms() {
  const file = path.join(CONTENT_DIR, 'forms.json');
  if (!fs.existsSync(file)) {
    logger.info('no forms.json — no forms seeded');
    return;
  }
  const { forms = [] } = readJson(file);
  let created = 0;
  let skipped = 0;

  for (const spec of forms) {
    if (!FORCE && await Form.exists({ key: spec.key })) { skipped++; continue; }
    await Form.findOneAndUpdate(
      { key: spec.key },
      {
        $set: {
          ...spec,
          // Positions from the file's own order, so reordering the JSON is how
          // you reorder the form rather than editing forty `order` numbers.
          fields: (spec.fields || []).map((f, i) => ({ ...f, order: i })),
        },
      },
      { upsert: true },
    );
    created++;
  }

  logger.info({ created, skipped }, 'forms seeded');
}

async function seedIntegrations() {
  const file = path.join(CONTENT_DIR, 'integrations.json');
  if (!fs.existsSync(file)) {
    logger.info('no integrations.json — outbound endpoints left as authored');
    return;
  }
  const { integrations = [] } = readJson(file);
  let created = 0;
  let repaired = 0;
  let skipped = 0;

  /*
   * Which fields the file still owns after the first run.
   *
   * The editorial fields — the label, the note, whether a lead is captured —
   * belong to whoever is running the site, and a re-seed must not undo their
   * decisions. `method` and `queryFields` are not decisions: they are facts
   * about how the endpoint is registered, and getting them wrong means the form
   * receives nothing. Two of them *were* wrong, so a re-seed corrects them.
   */
  const TRANSPORT = ['method', 'queryFields'];

  for (const spec of integrations) {
    const existing = await Integration.findOne({ slug: spec.slug }).lean();

    if (existing && !FORCE) {
      const drift = {};
      for (const field of TRANSPORT) {
        const wanted = spec[field] ?? (field === 'method' ? 'POST' : []);
        const held = existing[field] ?? (field === 'method' ? 'POST' : []);
        if (JSON.stringify(wanted) !== JSON.stringify(held)) drift[field] = wanted;
      }
      if (Object.keys(drift).length) {
        await Integration.updateOne({ slug: spec.slug }, { $set: drift });
        logger.info({ slug: spec.slug, ...drift }, 'integration transport corrected');
        repaired++;
      } else {
        skipped++;
      }
      continue;
    }

    const doc = {
      slug: spec.slug,
      label: spec.label || spec.slug,
      note: spec.note || '',
      url: spec.url,
      method: spec.method || 'POST',
      queryFields: spec.queryFields || [],
      responseMode: spec.responseMode || 'ok',
      responseFields: spec.responseFields || [],
      captureLead: !!spec.captureLead,
      leadType: spec.leadType || 'other',
      enabled: spec.enabled !== false,
    };
    await Integration.findOneAndUpdate({ slug: spec.slug }, { $set: doc }, { upsert: true });
    created++;
  }
  logger.info({ created, repaired, skipped }, 'integrations seeded');
}

async function seedBlog(registry, catalogues) {
  const spec = registry.pages.find(p => p.pageKind === 'blogPost');
  if (!spec) return;
  if (await BlogPost.countDocuments({}) && !FORCE) {
    logger.info('blog posts already present — left as they are');
    return;
  }

  const slug = spec.route.split('/').pop();
  for (const locale of registry.routedLocales) {
    const cat = catalogues[locale] || {};
    const branch = cat['blog-the-power-of-rainbow'] || {};
    const meta = branch.meta || {};
    await BlogPost.findOneAndUpdate(
      { slug, locale },
      {
        $set: {
          slug,
          locale,
          groupId: slug,
          title: meta.title || spec.title,
          excerpt: meta.description || '',
          category: 'Product',
          tags: ['rainbow', 'collaboration'],
          coverImage: '/images/blog-banner.webp',
          authorName: 'Rainbow Team',
          readingMinutes: 8,
          featured: true,
          status: 'published',
          publishedAt: new Date('2024-06-01T09:00:00Z'),
          pageKey: spec.key,
          seo: {
            title: meta.title || spec.title,
            description: meta.description || '',
            keywords: meta.keywords || '',
          },
        },
      },
      { upsert: true },
    );
  }
  logger.info('blog seeded');
}

/**
 * Index the images that ship with the frontend so editors can pick them.
 *
 * The API container does not carry the site's 260 MB of imagery, so the
 * manifest written by tools/build-media-index.mjs is the source of truth;
 * walking the directory is the fallback when running from a full checkout.
 */
/**
 * `images/collaboration-page/hero_wide` → `hero wide`.
 *
 * The folder is already a filter in the library, so repeating it in every label
 * only means 160 names that all begin with the same word.
 */
function readableName(stem) {
  const last = String(stem).split('/').pop() || stem;
  return last.replace(/[-_]+/g, ' ').trim();
}

async function seedMedia() {
  const manifest = path.join(CONTENT_DIR, 'media.bundled.json');
  const entries = fs.existsSync(manifest)
    ? readJson(manifest)
    : [...bundledFromDisk()];

  /*
   * Every bundled image gets a readable name and a reference on first index.
   *
   * `$setOnInsert` for those two, so re-seeding never overwrites a name somebody
   * has since improved or a slug pages are already pointing at. The name is only
   * a label; the slug is the address, which is why it is de-duplicated against
   * the filename rather than the basename — two `logo.png` in different folders
   * are two assets.
   */
  const taken = new Set(
    (await Media.find({ slug: { $nin: [null, ''] } }, { slug: 1, _id: 0 }).lean()).map(m => m.slug),
  );
  const ops = entries.map((item) => {
    const stem = String(item.filename).replace(/\.[a-z0-9]+$/i, '');
    let slug = slugify(stem, 60) || 'image';
    let n = 1;
    while (taken.has(slug)) slug = `${slugify(stem, 52) || 'image'}-${++n}`;
    taken.add(slug);
    return {
      updateOne: {
        filter: { filename: item.filename },
        update: {
          $set: { ...item, source: 'bundled' },
          $setOnInsert: { slug, name: readableName(stem) },
        },
        upsert: true,
      },
    };
  });
  for (let i = 0; i < ops.length; i += 500) {
    await Media.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  }

  /*
   * Backfill.
   *
   * `$setOnInsert` above only fires for rows that did not exist, so a database
   * seeded before assets had names keeps 160 images with no reference — and an
   * image with no reference is pinned to its filename, which is the whole thing
   * this is meant to fix. Naming them here is idempotent: a row that already has
   * a slug is skipped, so nothing an editor renamed is touched.
   */
  const unnamed = await Media.find({ $or: [{ slug: null }, { slug: '' }, { slug: { $exists: false } }] });
  if (unnamed.length) {
    const taken2 = new Set(
      (await Media.find({ slug: { $nin: [null, ''] } }, { slug: 1, _id: 0 }).lean()).map(m => m.slug),
    );
    for (const item of unnamed) {
      const stem = String(item.filename).replace(/\.[a-z0-9]+$/i, '');
      let slug = slugify(stem, 60) || 'image';
      let n = 1;
      while (taken2.has(slug)) slug = `${slugify(stem, 52) || 'image'}-${++n}`;
      taken2.add(slug);
      item.slug = slug;
      if (!item.name) item.name = readableName(stem);
      await item.save();
    }
    logger.info({ named: unnamed.length }, 'existing media given references');
  }

  logger.info({ files: ops.length }, 'bundled media indexed');
}

async function seedPartners() {
  const file = path.join(CONTENT_DIR, 'data', 'partners.json');
  if (!fs.existsSync(file)) return;
  if (await Partner.countDocuments({}) && !FORCE) {
    logger.info('partners already present — left as they are');
    return;
  }
  const data = readJson(file);
  const rows = Array.isArray(data) ? data : (data.partners || data.items || []);
  const ops = rows.map((raw, i) => {
    const name = raw.name || raw.company || raw.title || `Partner ${i + 1}`;
    return {
      updateOne: {
        filter: { externalId: String(raw.id ?? raw.externalId ?? `${name}-${i}`) },
        update: {
          $set: {
            externalId: String(raw.id ?? raw.externalId ?? `${name}-${i}`),
            name,
            country: raw.country || raw.pays || '',
            city: raw.city || raw.ville || '',
            address: raw.address || '',
            postalCode: raw.zip || raw.postalCode || '',
            website: raw.website || raw.url || '',
            phone: raw.phone || '',
            email: raw.email || '',
            level: raw.level || raw.tier || '',
            lat: numberOrNull(raw.lat ?? raw.latitude),
            lng: numberOrNull(raw.lng ?? raw.lon ?? raw.longitude),
            active: true,
            raw,
          },
        },
        upsert: true,
      },
    };
  });
  for (let i = 0; i < ops.length; i += 500) {
    await Partner.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  }
  logger.info({ partners: ops.length }, 'partners seeded');
}

function* bundledFromDisk() {
  for (const root of ['images', 'img']) {
    const dir = path.join(PUBLIC_DIR, root);
    if (!fs.existsSync(dir)) continue;
    for (const entry of walk(dir)) {
      const rel = path.relative(PUBLIC_DIR, entry).split(path.sep).join('/');
      yield {
        filename: rel,
        originalName: path.basename(entry),
        url: `/${rel}`,
        mime: mimeOf(entry),
        size: fs.statSync(entry).size,
        folder: path.dirname(rel),
      };
    }
  }
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.pdf': 'application/pdf',
};
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
const numberOrNull = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

main()
  .then(async () => {
    await disconnectMongo();
    await closeRedis();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'seed failed');
    await disconnectMongo().catch(() => {});
    await closeRedis().catch(() => {});
    process.exit(1);
  });
