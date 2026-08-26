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
import { ensureBootstrapUser } from './bootstrap.js';
import {
  Page, ContentString, Settings, Navigation, BlogPost, Media, Partner,
} from '../models/index.js';
import { ingestPage, ingestStrings } from '@rainbow/core/ingest';
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
async function seedMedia() {
  const manifest = path.join(CONTENT_DIR, 'media.bundled.json');
  const entries = fs.existsSync(manifest)
    ? readJson(manifest)
    : [...bundledFromDisk()];

  const ops = entries.map(item => ({
    updateOne: {
      filter: { filename: item.filename },
      update: { $set: { ...item, source: 'bundled' } },
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += 500) {
    await Media.bulkWrite(ops.slice(i, i + 500), { ordered: false });
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
