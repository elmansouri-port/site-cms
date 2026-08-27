/*
 * bootstrap.js — what has to be true before the API can serve a request.
 *
 * Everything here is idempotent and safe on a database that already has content:
 * it runs on every boot, and its job is to make sure a fresh deploy, an older
 * database and a restored backup all end up in the same working state rather
 * than in one that only the seed script knows how to reach.
 */
import bcrypt from 'bcryptjs';
import { Chrome, Page, Settings, User } from '../models/index.js';
import { config, isProd } from '../config.js';
import { logger } from '../lib/log.js';
import { withoutLeadingTrivia } from '@rainbow/core/compose';

/**
 * Make sure there is always one way in. On an empty database the configured
 * bootstrap account is created; if it is still the default password in
 * production, that is logged loudly rather than silently accepted.
 */
export async function ensureBootstrapUser() {
  const count = await User.countDocuments({});
  if (count > 0) return null;

  const user = await User.create({
    email: config.bootstrap.email.toLowerCase(),
    name: config.bootstrap.name,
    role: 'admin',
    passwordHash: await bcrypt.hash(config.bootstrap.password, 12),
  });

  logger.info({ email: user.email }, 'bootstrap administrator created');
  if (isProd && config.bootstrap.password === 'ChangeMe!2024') {
    logger.warn('the bootstrap administrator is using the default password — change it now');
  }
  return user;
}

/**
 * Make sure the header and footer are editable.
 *
 * The chrome document is created by the seed, from the homepage. A database
 * seeded before that feature existed — or restored from one — has pages that
 * still carry their own header markup and a CMS screen that can only say "run
 * the seed", which is not an answer anybody wants in production at 9am.
 *
 * So the same consolidation runs at boot when the document is missing. It reads
 * the homepage and writes one record; it never touches a document that exists,
 * so an edited header is safe.
 */
export async function ensureChrome() {
  if (await Chrome.exists({ key: 'default' })) return null;

  const home = await Page.findOne({ pageKind: 'home' }).lean()
    || await Page.findOne({ route: '' }).lean();
  if (!home) {
    logger.warn('no homepage yet — the header and footer will be set up by the seed');
    return null;
  }

  const ordered = (home.sections || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const navbar = ordered.find(s => s.tag === 'nav' && (s.anchorId === 'navbar' || s.key === 'navbar'));
  const footer = ordered.find(s => s.tag === 'footer');

  // The element only. The whitespace and comment that preceded it belong to the
  // page, not to the header — each placeholder contributes its own back.
  const navHtml = withoutLeadingTrivia(navbar?.html || '');
  const footerHtml = withoutLeadingTrivia(footer?.html || '');

  const doc = await Chrome.create({
    key: 'default',
    navbar: { html: navHtml, authoredHtml: navHtml, visible: !!navbar },
    footer: { html: footerHtml, authoredHtml: footerHtml, visible: !!footer },
  });

  logger.info(
    { navbar: navHtml.length, footer: footerHtml.length },
    'header and footer consolidated from the homepage at boot',
  );
  return doc;
}

/** The add-in a legacy global snippet becomes, per zone. */
const LEGACY_SNIPPETS = [
  {
    field: 'globalHeadSnippet',
    key: 'legacy-head',
    zone: 'head',
    label: 'Site head code',
    note: 'Migrated from the old site-wide head snippet. Rename it once you know what it does.',
  },
  {
    field: 'globalBodySnippet',
    key: 'legacy-body',
    zone: 'bodyStart',
    label: 'Site body code',
    note: 'Migrated from the old site-wide body snippet. Rename it once you know what it does.',
  },
  {
    field: 'globalFooterSnippet',
    key: 'legacy-footer',
    zone: 'bodyEnd',
    label: 'Site footer code',
    note: 'Migrated from the old site-wide footer snippet. Rename it once you know what it does.',
  },
];

/**
 * Move the three anonymous site-wide snippets into named add-ins.
 *
 * They did the same job an add-in does, minus the name, the note, the switch and
 * the page filter — which is exactly why nobody dared touch them. Keeping both
 * mechanisms alive would mean two places to look when a tracking tag fires twice,
 * so the fields are migrated once and then unset.
 *
 * Carried over as **enabled**, because they were running: a migration that
 * silently switched off a consent banner would be a worse bug than the one it
 * was fixing.
 */
export async function migrateGlobalSnippets() {
  const settings = await Settings.findOne({ key: 'global' });
  if (!settings) return 0;

  const pending = LEGACY_SNIPPETS.filter(s => String(settings.get(s.field) || '').trim());
  if (!pending.length) return 0;

  const chrome = await Chrome.findOne({ key: 'default' }) || await ensureChrome();
  if (!chrome) return 0;

  let moved = 0;
  for (const snippet of pending) {
    const html = String(settings.get(snippet.field));
    if (!chrome.addIns.some(a => a.key === snippet.key)) {
      chrome.addIns.push({
        key: snippet.key,
        label: snippet.label,
        note: snippet.note,
        zone: snippet.zone,
        html,
        enabled: true,
        order: chrome.addIns.length,
        pages: [],
      });
      moved++;
    }
    settings.set(snippet.field, undefined);
  }

  if (moved) {
    chrome.markModified('addIns');
    await chrome.save();
  }
  // `$unset` rather than `save()`: the fields are gone from the schema, so
  // Mongoose would not write the removal on its own.
  await Settings.updateOne(
    { key: 'global' },
    { $unset: Object.fromEntries(LEGACY_SNIPPETS.map(s => [s.field, ''])) },
  );

  logger.info({ moved }, 'site-wide snippets migrated to named add-ins');
  return moved;
}

/** Everything that has to hold before the first request. */
export async function bootstrap() {
  await ensureBootstrapUser();
  await ensureChrome();
  await migrateGlobalSnippets();
}
