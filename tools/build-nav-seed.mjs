#!/usr/bin/env node
/*
 * build-nav-seed.mjs — lift the megamenu's built-in copy into a CMS seed.
 *
 * The static site carried its navigation as a COPY object inside
 * js/mega-menu.js. Rather than retype it (and drift from what visitors see),
 * this reads that object plus the href/icon tables next to it and writes
 * content-source/navigation.seed.json in the shape the Navigation collection
 * stores. Run it again if the shipped menu ever changes upstream.
 *
 *   node tools/build-nav-seed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MENU_JS = path.join(ROOT, 'apps', 'web', 'public', 'js', 'mega-menu.js');
const OUT = path.join(ROOT, 'content-source', 'navigation.seed.json');

const src = fs.readFileSync(MENU_JS, 'utf8');

/**
 * Read an object/array literal declared with `var NAME = ...;` out of the file.
 *
 * The declaration may be wrapped — the tables now read
 * `orDefault(<cms value>, [...])` so the CMS can override them — so the scan
 * starts at the first bracket after the name, which is the shipped literal in
 * both the wrapped and the plain form.
 */
function literal(name) {
  const start = src.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`${name} not found in mega-menu.js`);
  let from = start + `var ${name} = `.length;
  while (from < src.length && src[from] !== '[' && src[from] !== '{') from++;
  const open = src[from];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return eval(`(${src.slice(from, i + 1)})`);
    }
  }
  throw new Error(`could not read ${name}`);
}

const COPY = literal('COPY');
const LOCALES = Object.keys(COPY);

const PRODUCT_HREFS = literal('PRODUCT_HREFS');
const PRODUCT_ICONS = literal('PRODUCT_ICONS');
const RESSOURCES_LEFT_HREFS = literal('RESSOURCES_LEFT_HREFS');
const RESSOURCES_LEFT_ICONS = literal('RESSOURCES_LEFT_ICONS');
const RESSOURCES_RIGHT_HREFS = literal('RESSOURCES_RIGHT_HREFS');
const RESSOURCES_RIGHT_ICONS = literal('RESSOURCES_RIGHT_ICONS');
const TARIFS_HREFS = literal('TARIFS_HREFS');
const TARIFS_ICONS = literal('TARIFS_ICONS');

/** Collect one value per locale into the localised map the CMS stores. */
const perLocale = (pick) => Object.fromEntries(
  LOCALES.map(l => [l, pick(COPY[l])]).filter(([, v]) => v !== undefined && v !== null),
);

function links(listKey, hrefs, icons, { column = 1, mobileKey = null, mobileOffset = 0 } = {}) {
  const count = COPY.fr[listKey.menu][listKey.list].length;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      label: perLocale(c => c[listKey.menu][listKey.list][i]?.[0]),
      description: perLocale(c => c[listKey.menu][listKey.list][i]?.[1]),
      // The mobile drawer has its own shorter copy, in one flat list across
      // both columns — hence the offset for the second column.
      mobileDescription: mobileKey
        ? perLocale((c) => {
          const m = c[listKey.menu][mobileKey]?.[i + mobileOffset];
          return Array.isArray(m) ? m[1] : m;
        })
        : {},
      href: hrefs[i] || '',
      icon: icons[i] || '',
      badge: {},
      column,
      variant: 'item',
    });
  }
  return out;
}

const items = [
  {
    key: 'products',
    label: perLocale(c => c.navWords.produits),
    href: '/products',
    visible: true,
    target: '_self',
    megamenu: {
      enabled: true,
      main: {
        title: perLocale(c => c.products.sectionTitle),
        links: links({ menu: 'products', list: 'items' }, PRODUCT_HREFS, PRODUCT_ICONS, { mobileKey: 'itemsMobile' }),
        seeAll: perLocale(c => c.products.seeAll),
        seeAllHref: '/products',
      },
      features: {
        title: perLocale(c => c.products.sideTitle),
        links: [
          {
            label: perLocale(c => c.products.showcaseTitle),
            description: perLocale(c => c.products.showcaseDesc),
            mobileDescription: {},
            href: '/products/collaboration',
            icon: 'chat',
            badge: perLocale(c => c.products.showcaseTag),
            column: 1,
            variant: 'showcase',
          },
          {
            label: perLocale(c => c.products.integrationsCtaTitle),
            description: perLocale(c => c.products.integrationsCtaDesc),
            mobileDescription: {},
            href: '/integrations',
            icon: 'calendar',
            badge: perLocale(c => c.products.integrationsTitle),
            column: 1,
            variant: 'cta',
          },
        ],
      },
      footer: {
        text: perLocale(c => c.products.footerText),
        secondaryLabel: perLocale(c => c.products.footerBtnSecondary),
        secondaryHref: '/form-al',
        primaryLabel: perLocale(c => c.products.footerBtnPrimary),
        primaryHref: '/form-al',
      },
    },
  },
  {
    key: 'ressources',
    label: perLocale(c => c.navWords.ressources),
    href: '',
    visible: true,
    target: '_self',
    megamenu: {
      enabled: true,
      main: {
        title: perLocale(c => c.ressources.sectionTitle),
        links: [
          ...links({ menu: 'ressources', list: 'leftItems' }, RESSOURCES_LEFT_HREFS, RESSOURCES_LEFT_ICONS, { column: 1, mobileKey: 'mobileItems' }),
          ...links({ menu: 'ressources', list: 'rightItems' }, RESSOURCES_RIGHT_HREFS, RESSOURCES_RIGHT_ICONS, {
            column: 2,
            mobileKey: 'mobileItems',
            mobileOffset: COPY.fr.ressources.leftItems.length,
          }),
        ],
        seeAll: {},
        seeAllHref: '',
      },
      features: {
        title: perLocale(c => c.ressources.sideTitle),
        links: [
          {
            label: perLocale(c => c.ressources.showcaseTitle),
            description: perLocale(c => c.ressources.showcaseDesc),
            mobileDescription: {},
            href: '/tutorials',
            icon: 'academic-cap',
            badge: perLocale(c => c.ressources.showcaseTag),
            column: 1,
            variant: 'showcase',
          },
          {
            label: perLocale(c => c.ressources.helpCtaTitle),
            description: perLocale(c => c.ressources.helpCtaDesc),
            mobileDescription: {},
            href: '/centre-aide-rainbow',
            icon: 'lifebuoy',
            badge: perLocale(c => c.ressources.helpTitle),
            column: 1,
            variant: 'cta',
          },
        ],
      },
      footer: {
        text: perLocale(c => c.ressources.footerText),
        secondaryLabel: perLocale(c => c.ressources.footerBtnSecondary),
        secondaryHref: '/blog',
        primaryLabel: perLocale(c => c.ressources.footerBtnPrimary),
        primaryHref: '/centre-aide-rainbow',
      },
    },
  },
  {
    key: 'tarifs',
    label: perLocale(c => c.navWords.tarifs),
    href: '/tarifs',
    visible: true,
    target: '_self',
    megamenu: {
      enabled: true,
      main: {
        title: perLocale(c => c.tarifs.sectionTitle),
        links: links({ menu: 'tarifs', list: 'items' }, TARIFS_HREFS, TARIFS_ICONS, { mobileKey: 'itemsMobile' }),
        seeAll: perLocale(c => c.tarifs.seeAll),
        seeAllHref: '/tarifs',
      },
      // No side zone on the pricing menu: the frontend renders `main` full
      // width when `features` is empty (reco.md 10.2).
      features: { title: {}, links: [] },
      footer: {
        text: perLocale(c => c.tarifs.footerText),
        secondaryLabel: {},
        secondaryHref: '',
        primaryLabel: perLocale(c => c.tarifs.footerBtnPrimary),
        primaryHref: '/form-al',
      },
    },
  },
];

const seed = { key: 'main', label: 'Main navigation', items };
fs.writeFileSync(OUT, JSON.stringify(seed, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)} — ${items.length} items, locales: ${LOCALES.join(', ')}`);
