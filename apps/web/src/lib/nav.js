/*
 * nav.js — translate the CMS navigation into the shape the megamenu script
 * already understands.
 *
 * The shipped mega-menu.js builds its markup from a COPY object and two arrays
 * of hrefs and icons per menu. Rather than rewrite that script (and risk the
 * markup changing), the CMS data is reshaped into exactly that structure and
 * handed to it through window.__CMS__. The script prefers it when present and
 * falls back to its built-in copy when it is not, so the menu renders
 * identically whether or not the API answered.
 *
 * Zones are optional by design (reco.md 10.2): an empty `features` zone
 * produces no side copy at all, and the script's own layout rules take over.
 */

const pick = (map, locale) => {
  if (!map) return '';
  // Mongo returns Maps as plain objects over JSON.
  return map[locale] ?? map.fr ?? '';
};

function linksOf(zone, { column = null, variant = 'item' } = {}) {
  return (zone?.links || []).filter(l => (
    (l.variant || 'item') === variant && (column === null || (l.column || 1) === column)
  ));
}

function menuFor(item, locale, images) {
  const mm = item.megamenu || {};
  const main = mm.main || {};
  const features = mm.features || {};
  const footer = mm.footer || {};

  const showcase = linksOf(features, { variant: 'showcase' })[0] || null;
  const cta = linksOf(features, { variant: 'cta' })[0] || null;
  // The showcase card is a thumbnail, not an icon: a custom image wins, then
  // the cover image of whatever article or page it links to, and only when
  // neither exists does the caller fall back to its own default icon.
  const imageFor = (link) => (link?.image || images?.get(link?.href) || '');

  const mainItems = linksOf(main, { column: 1 });
  const secondColumn = linksOf(main, { column: 2 });

  return {
    copy: {
      sectionTitle: pick(main.title, locale),
      items: mainItems.map(l => [pick(l.label, locale), pick(l.description, locale)]),
      itemsMobile: mainItems.map(l => pick(l.mobileDescription, locale) || pick(l.description, locale)),
      leftItems: mainItems.map(l => [pick(l.label, locale), pick(l.description, locale)]),
      rightItems: secondColumn.map(l => [pick(l.label, locale), pick(l.description, locale)]),
      mobileItems: [...mainItems, ...secondColumn].map(l => [
        pick(l.label, locale),
        pick(l.mobileDescription, locale) || pick(l.description, locale),
      ]),
      seeAll: pick(main.seeAll, locale),
      sideTitle: pick(features.title, locale),
      showcaseTitle: showcase ? pick(showcase.label, locale) : '',
      showcaseDesc: showcase ? pick(showcase.description, locale) : '',
      showcaseTag: showcase ? pick(showcase.badge, locale) : '',
      integrationsTitle: cta ? pick(cta.badge, locale) : '',
      integrationsCtaTitle: cta ? pick(cta.label, locale) : '',
      integrationsCtaDesc: cta ? pick(cta.description, locale) : '',
      helpTitle: cta ? pick(cta.badge, locale) : '',
      helpCtaTitle: cta ? pick(cta.label, locale) : '',
      helpCtaDesc: cta ? pick(cta.description, locale) : '',
      footerText: pick(footer.text, locale),
      footerBtnSecondary: pick(footer.secondaryLabel, locale),
      footerBtnPrimary: pick(footer.primaryLabel, locale),
    },
    hrefs: {
      main: mainItems.map(l => l.href || ''),
      second: secondColumn.map(l => l.href || ''),
      seeAll: main.seeAllHref || item.href || '',
      showcase: showcase?.href || '',
      cta: cta?.href || '',
      footerSecondary: footer.secondaryHref || '',
      footerPrimary: footer.primaryHref || '',
    },
    icons: {
      main: mainItems.map(l => l.icon || ''),
      second: secondColumn.map(l => l.icon || ''),
      showcase: showcase?.icon || '',
      cta: cta?.icon || '',
    },
    images: {
      showcase: imageFor(showcase),
      cta: imageFor(cta),
    },
    zones: {
      features: linksOf(features, { variant: 'showcase' }).length > 0 || linksOf(features, { variant: 'cta' }).length > 0,
      footer: !!(pick(footer.text, locale) || pick(footer.primaryLabel, locale)),
    },
  };
}

/** The whole navigation, reshaped for the browser. */
export function navRuntime(navigation, locale, images) {
  const items = (navigation?.items || [])
    .filter(i => i.visible !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const menus = {};
  const navWords = {};
  for (const item of items) {
    navWords[item.key] = pick(item.label, locale);
    if (item.megamenu?.enabled) menus[item.key] = menuFor(item, locale, images);
  }

  return {
    order: items.map(i => i.key),
    navWords,
    menus,
    links: Object.fromEntries(items.map(i => [i.key, i.href || ''])),
  };
}
